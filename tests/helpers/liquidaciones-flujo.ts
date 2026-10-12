/**
 * Escenario propio para los tests de flujo de liquidaciones de servicios y de
 * su facturación (`liquidaciones-servicios-flujo` y
 * `facturacion-liquidaciones-flujo`).
 *
 * Cada suite siembra SU cliente y SUS dos usuarios, marcados con un prefijo, y
 * limpia todo lo que cuelga de ellos. No se reutiliza «el primer cliente que
 * haya»: los listados y los conteos de estos tests se acotan por `cliente_id`,
 * y compartir cliente con otra suite haría que una fila ajena cambiara un
 * conteo sin que este código hubiera tocado nada.
 *
 * La limpieza busca por PREFIJO y no por los ids de esta ejecución: si una
 * corrida anterior murió a medias, sus filas siguen ahí y una liquidación
 * sobrante del año reservado al consecutivo automático cambiaría el número
 * que se genera.
 */

import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'node:crypto'

export const prismaFlujo = new PrismaClient()

export interface EscenarioFlujo {
  marca: string
  clienteId: string
  /** Usuario de operaciones: crea y liquida. */
  creadorId: string
  /** Usuario de Administración: aprueba, factura, anula. */
  adminId: string
}

/** Crea cliente y usuarios con el prefijo `marca` en nombre y correo. */
export async function sembrarEscenario(marca: string): Promise<EscenarioFlujo> {
  await limpiarRastros(marca)

  const corto = randomUUID().slice(0, 8)
  const clienteId = randomUUID()
  await prismaFlujo.clientes.create({
    data: {
      id: clienteId,
      nombre: `${marca} Cliente ${corto}`,
      /// `nit` es único: uno fijo chocaría con el de una corrida anterior que
      /// no llegó a limpiar.
      nit: `${marca}-${corto}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  })

  const usuario = async (rol: 'creador' | 'admin') => {
    const id = randomUUID()
    await prismaFlujo.usuarios.create({
      data: {
        // `usuarios` no tiene @default ni en `id` ni en las marcas de tiempo.
        id,
        nombre: `${marca} ${rol}`,
        correo: `${marca.toLowerCase()}-${rol}-${corto}@example.test`,
        password: 'no-se-usa-en-tests',
        role: rol === 'admin' ? 'admin' : 'usuario',
        area: rol === 'admin' ? ['administracion'] : ['operaciones'],
        created_at: new Date(),
        updated_at: new Date(),
      },
    })
    return id
  }

  return { marca, clienteId, creadorId: await usuario('creador'), adminId: await usuario('admin') }
}

/**
 * Borra EN DURO todo lo que sembró una suite con ese prefijo.
 *
 * En duro porque son datos de prueba en una base desechable: marcarlos los
 * dejaría para siempre y los agregados globales (`estadisticas`) los
 * arrastrarían. El orden respeta las claves ajenas; la auditoría de borrado
 * lógico vive en otro schema y no tiene FK, así que se limpia a mano.
 */
export async function limpiarRastros(marca: string): Promise<void> {
  const clientes = await prismaFlujo.clientes.findMany({
    where: { nombre: { startsWith: marca } },
    select: { id: true },
  })
  const usuarios = await prismaFlujo.usuarios.findMany({
    where: { correo: { startsWith: marca.toLowerCase() } },
    select: { id: true },
  })
  const clienteIds = clientes.map((c) => c.id)
  const usuarioIds = usuarios.map((u) => u.id)

  const liqs = await prismaFlujo.liquidacion_servicio.findMany({
    where: { cliente_id: { in: clienteIds } },
    select: { id: true },
  })
  const liqIds = liqs.map((l) => l.id)

  if (liqIds.length > 0) {
    await prismaFlujo.$executeRaw`
      DELETE FROM auditoria.borrado_logico WHERE registro_id = ANY(${liqIds}::text[])`
  }
  await prismaFlujo.historial_estado_liquidacion.deleteMany({
    where: { liquidacion_id: { in: liqIds } },
  })
  await prismaFlujo.liquidacion_tercero_concepto.deleteMany({
    where: { liquidacion_tercero: { liquidacion_id: { in: liqIds } } },
  })
  await prismaFlujo.liquidacion_tercero.deleteMany({ where: { liquidacion_id: { in: liqIds } } })
  await prismaFlujo.factura_liquidacion_item.deleteMany({
    where: {
      OR: [
        { liquidacion_id: { in: liqIds } },
        { factura: { facturado_por_id: { in: usuarioIds } } },
      ],
    },
  })
  await prismaFlujo.factura_liquidacion_servicio.deleteMany({
    where: { facturado_por_id: { in: usuarioIds } },
  })
  await prismaFlujo.liquidacion_servicio_item.deleteMany({
    where: { liquidacion_id: { in: liqIds } },
  })
  await prismaFlujo.liquidacion_servicio_draft.deleteMany({
    where: { OR: [{ usuario_id: { in: usuarioIds } }, { liquidacion_id: { in: liqIds } }] },
  })
  await prismaFlujo.liquidacion_servicio.deleteMany({ where: { id: { in: liqIds } } })
  await prismaFlujo.usuarios.deleteMany({ where: { id: { in: usuarioIds } } })
  await prismaFlujo.clientes.deleteMany({ where: { id: { in: clienteIds } } })
}

/** Ítem válido del payload de `crear`/`actualizar`, con lo mínimo. */
export function itemDePrueba(
  placa: string,
  extra: Partial<{
    cantidad: number
    valor_unitario: number
    porcentaje_descuento: number
    id: string
    client_key: string
  }> = {},
) {
  return {
    placa,
    fecha_inicial: '2026-01-05',
    fecha_final: '2026-01-06',
    recorrido: `RUTA ${placa}`,
    tipo_servicio: 'TRANSPORTE_DE_PERSONAL_EN_CAMIONETA' as const,
    cantidad: 1,
    valor_unitario: 100000,
    porcentaje_descuento: 0,
    ...extra,
  }
}

/** Placa única por llamada: `metadata.placas` y los filtros son globales al cliente. */
export function placaUnica(): string {
  return `Z${randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase()}`
}
