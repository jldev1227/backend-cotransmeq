/**
 * Borrado lógico y restauración del árbol de una liquidación de servicios.
 *
 * EL PROBLEMA QUE RESUELVE
 *
 * Una liquidación se restauró poniendo `deleted_at = NULL` y quedó vacía: los
 * `liquidacion_servicio_item` no tenían borrado lógico y la cascada
 * `ON DELETE CASCADE` los había borrado físicamente. Con ellos se fueron los
 * `liquidacion_tercero` que cuelgan de cada ítem, y de estos sus conceptos.
 * Quedó una cabecera con totales que no correspondían a ninguna fila.
 *
 * Aquí no hay middleware de Prisma que oculte filas por arte de magia: los
 * filtros son explícitos. Un middleware global habría escondido también las
 * filas que la auditoría necesita ver, y habría hecho imposible razonar sobre
 * qué consulta ve qué.
 *
 * QUÉ SE MARCA Y QUÉ NO
 *
 *   se marca   → ítems, terceros del servicio, conceptos de esos terceros,
 *                ítems de factura
 *   NO se toca → historial de estados y snapshots: son evidencia de lo que
 *                pasó, y alterarlos al borrar destruiría justamente el rastro
 *                que sirve para reconstruir
 */

import type { Prisma, PrismaClient } from '@prisma/client'
import { prisma } from '../../config/prisma'

/** Cliente de Prisma o transacción; todo lo de aquí funciona con ambos. */
type ClienteDb = PrismaClient | Prisma.TransactionClient

export interface ResultadoBorrado {
  liquidacion_id: string
  items: number
  terceros: number
  conceptos: number
  items_factura: number
}

/**
 * Filtro de fila viva. Se repite tanto que tenerlo en un sitio evita que a
 * alguien se le olvide en una consulta nueva y empiece a devolver eliminados.
 */
export const SOLO_ACTIVOS = { deleted_at: null } as const

/**
 * Registra en `auditoria.borrado_logico` quién eliminó o restauró qué.
 *
 * Va con SQL crudo porque la tabla vive en el schema `auditoria`, que Prisma
 * no gestiona a propósito: así ninguna migración futura propone borrarla.
 *
 * No lanza si falla. Perder una línea de auditoría es malo, pero deshacer por
 * ello una restauración que el usuario pidió es peor: se quedaría con la
 * liquidación rota que justamente intentaba arreglar.
 */
async function auditar(
  db: ClienteDb,
  datos: {
    entidad: string
    registro_id: string
    accion: 'ELIMINAR' | 'RESTAURAR'
    usuario_id?: string | null
    motivo?: string | null
    relacionadas?: Record<string, number>
  },
): Promise<void> {
  try {
    await db.$executeRaw`
      INSERT INTO auditoria.borrado_logico
        (entidad, registro_id, accion, usuario_id, motivo, relacionadas)
      VALUES (
        ${datos.entidad},
        ${datos.registro_id},
        ${datos.accion},
        ${datos.usuario_id ?? null},
        ${datos.motivo ?? null},
        ${JSON.stringify(datos.relacionadas ?? {})}::jsonb
      )`
  } catch (e) {
    console.error('[soft-delete] no se pudo auditar:', e)
  }
}

/**
 * Marca como eliminada una liquidación y todo su árbol recuperable.
 *
 * Transaccional: o se marca todo o no se marca nada. Una liquidación cuyos
 * ítems quedaran activos mientras la cabecera está eliminada saldría en los
 * informes que suman ítems y no en los que listan liquidaciones.
 *
 * Idempotente: `deleted_at: null` en el WHERE hace que volver a borrar algo ya
 * borrado no cambie su fecha original, que es el dato que dice cuándo pasó.
 */
export async function eliminarLiquidacionServicio(
  id: string,
  opciones: { usuarioId?: string | null; motivo?: string | null } = {},
): Promise<ResultadoBorrado> {
  const ahora = new Date()

  return prisma.$transaction(async (tx) => {
    const items = await tx.liquidacion_servicio_item.updateMany({
      where: { liquidacion_id: id, ...SOLO_ACTIVOS },
      data: { deleted_at: ahora },
    })

    const terceros = await tx.liquidacion_tercero.updateMany({
      where: { liquidacion_id: id, ...SOLO_ACTIVOS },
      data: { deleted_at: ahora },
    })

    /// Los conceptos cuelgan del tercero, no de la liquidación: hay que
    /// alcanzarlos por la relación o quedarían activos colgando de un padre
    /// eliminado.
    const conceptos = await tx.liquidacion_tercero_concepto.updateMany({
      where: { liquidacion_tercero: { liquidacion_id: id }, ...SOLO_ACTIVOS },
      data: { deleted_at: ahora },
    })

    const itemsFactura = await tx.factura_liquidacion_item.updateMany({
      where: { liquidacion_id: id, ...SOLO_ACTIVOS },
      data: { deleted_at: ahora },
    })

    await tx.liquidacion_servicio.updateMany({
      where: { id, ...SOLO_ACTIVOS },
      data: { deleted_at: ahora },
    })

    /// El historial de estados NO se toca. Es la evidencia de por qué la
    /// liquidación llegó a donde llegó, y es lo único que queda si algún día
    /// hay que reconstruirla a mano.

    const resultado: ResultadoBorrado = {
      liquidacion_id: id,
      items: items.count,
      terceros: terceros.count,
      conceptos: conceptos.count,
      items_factura: itemsFactura.count,
    }

    await auditar(tx, {
      entidad: 'liquidacion_servicio',
      registro_id: id,
      accion: 'ELIMINAR',
      usuario_id: opciones.usuarioId,
      motivo: opciones.motivo,
      relacionadas: {
        items: resultado.items,
        terceros: resultado.terceros,
        conceptos: resultado.conceptos,
        items_factura: resultado.items_factura,
      },
    })

    return resultado
  })
}

/**
 * Restaura una liquidación y su árbol.
 *
 * Restaura TODO lo que se marcó, sin mirar la fecha: una restauración parcial
 * —solo lo borrado en el último minuto, por ejemplo— dejaría la cabecera con
 * unos totales que no cuadran con sus ítems, que es exactamente el estado del
 * que venimos.
 */
export async function restaurarLiquidacionServicio(
  id: string,
  opciones: { usuarioId?: string | null; motivo?: string | null } = {},
): Promise<ResultadoBorrado> {
  return prisma.$transaction(async (tx) => {
    const items = await tx.liquidacion_servicio_item.updateMany({
      where: { liquidacion_id: id, deleted_at: { not: null } },
      data: { deleted_at: null },
    })

    const terceros = await tx.liquidacion_tercero.updateMany({
      where: { liquidacion_id: id, deleted_at: { not: null } },
      data: { deleted_at: null },
    })

    const conceptos = await tx.liquidacion_tercero_concepto.updateMany({
      where: {
        liquidacion_tercero: { liquidacion_id: id },
        deleted_at: { not: null },
      },
      data: { deleted_at: null },
    })

    /// Los ítems de factura solo se restauran si su factura sigue viva: si la
    /// factura se anuló por su cuenta, revivir el pivote la resucitaría a
    /// medias y aparecería en los informes de facturación.
    const itemsFactura = await tx.factura_liquidacion_item.updateMany({
      where: {
        liquidacion_id: id,
        deleted_at: { not: null },
        factura: { deleted_at: null },
      },
      data: { deleted_at: null },
    })

    await tx.liquidacion_servicio.updateMany({
      where: { id, deleted_at: { not: null } },
      data: { deleted_at: null },
    })

    const resultado: ResultadoBorrado = {
      liquidacion_id: id,
      items: items.count,
      terceros: terceros.count,
      conceptos: conceptos.count,
      items_factura: itemsFactura.count,
    }

    await auditar(tx, {
      entidad: 'liquidacion_servicio',
      registro_id: id,
      accion: 'RESTAURAR',
      usuario_id: opciones.usuarioId,
      motivo: opciones.motivo,
      relacionadas: {
        items: resultado.items,
        terceros: resultado.terceros,
        conceptos: resultado.conceptos,
        items_factura: resultado.items_factura,
      },
    })

    return resultado
  })
}

/**
 * ¿Está eliminada?
 *
 * Lo usan las operaciones de escritura antes de tocar nada: editar o
 * autoguardar una liquidación eliminada volvería a llenarla de ítems activos
 * bajo una cabecera que nadie ve, y esos ítems no se restaurarían nunca porque
 * la restauración solo revive lo que tiene `deleted_at`.
 */
export async function estaEliminada(id: string): Promise<boolean> {
  const fila = await prisma.liquidacion_servicio.findUnique({
    where: { id },
    select: { deleted_at: true },
  })
  return fila?.deleted_at != null
}
