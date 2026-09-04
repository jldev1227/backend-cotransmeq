/**
 * Borrado lógico y reconciliación en el árbol de liquidaciones de servicios.
 *
 * EL INCIDENTE QUE ORIGINA ESTO
 *
 * Una liquidación se restauró poniendo `deleted_at = NULL` y quedó vacía: sus
 * ítems no tenían borrado lógico y la cascada los había borrado físicamente.
 * La cabecera volvió con unos totales que no correspondían a ninguna fila.
 *
 * Cada caso de aquí fija una de las formas en que se perdía información. Si
 * alguien vuelve a poner un `deleteMany` en el camino de edición, varios se
 * ponen rojos.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'

vi.mock('pdfmake/build/pdfmake', () => ({ default: {}, createPdf: () => ({}) }))
vi.mock('pdfmake/build/vfs_fonts', () => ({ default: { vfs: {} }, vfs: {} }))

import {
  eliminarLiquidacionServicio,
  restaurarLiquidacionServicio,
  estaEliminada,
} from '../src/lib/soft-delete/liquidacion-servicio'
import {
  reconciliarItems,
  totalesDeItemsActivos,
  ReconciliacionVacia,
} from '../src/lib/soft-delete/reconciliar-items'

const prisma = new PrismaClient()

/** Marca para poder limpiar solo lo que crea esta suite. */
const MARCA = 'ZZTEST-SOFTDEL'

let clienteId: string
let usuarioId: string

/** Crea una liquidación con `n` ítems y devuelve sus ids. */
async function crearLiquidacion(n = 3): Promise<{ id: string; itemIds: string[] }> {
  const id = randomUUID()
  await prisma.liquidacion_servicio.create({
    data: {
      id,
      consecutivo: `${MARCA}-${id.slice(0, 8)}`,
      cliente_id: clienteId,
      mes: 1,
      anio: 2026,
      estado: 'BORRADOR' as any,
      subtotal: 0,
      total: 0,
      creado_por_id: usuarioId,
      actualizado_por_id: usuarioId,
    },
  })

  const itemIds: string[] = []
  for (let i = 0; i < n; i++) {
    const item = await prisma.liquidacion_servicio_item.create({
      data: {
        liquidacion_id: id,
        placa: `ABC${i}${i}${i}`,
        fecha_inicial: new Date('2026-01-01'),
        fecha_final: new Date('2026-01-02'),
        recorrido: `Recorrido ${i}`,
        tipo_servicio: 'TRANSPORTE_DE_PERSONAL_EN_CAMIONETA' as any,
        cantidad: 1,
        valor_unitario: 100,
        subtotal: 100,
        valor_final: 100,
        orden: i,
      },
      select: { id: true },
    })
    itemIds.push(item.id)
  }
  return { id, itemIds }
}

/** Campos mínimos de un ítem para la reconciliación. */
function itemBase(placa: string) {
  return {
    placa,
    fecha_inicial: new Date('2026-01-01'),
    fecha_final: new Date('2026-01-02'),
    recorrido: `R-${placa}`,
    tipo_servicio: 'TRANSPORTE_DE_PERSONAL_EN_CAMIONETA' as any,
    cantidad: 1,
    valor_unitario: 100,
    subtotal: 100,
    valor_final: 100,
  }
}

async function limpiar() {
  const liqs = await prisma.liquidacion_servicio.findMany({
    where: { consecutivo: { startsWith: MARCA } },
    select: { id: true },
  })
  const ids = liqs.map((l) => l.id)
  if (ids.length === 0) return
  // En orden inverso a las dependencias: aquí sí se borra de verdad, porque
  // son datos de prueba y la base es desechable.
  await prisma.liquidacion_tercero_concepto.deleteMany({
    where: { liquidacion_tercero: { liquidacion_id: { in: ids } } },
  })
  await prisma.liquidacion_tercero.deleteMany({ where: { liquidacion_id: { in: ids } } })
  await prisma.factura_liquidacion_item.deleteMany({ where: { liquidacion_id: { in: ids } } })
  await prisma.liquidacion_servicio_item.deleteMany({ where: { liquidacion_id: { in: ids } } })
  await prisma.liquidacion_servicio.deleteMany({ where: { id: { in: ids } } })
  await prisma.factura_liquidacion_servicio.deleteMany({
    where: { numero_factura: { startsWith: MARCA } },
  })
}

beforeAll(async () => {
  const cliente = await prisma.clientes.findFirst({ select: { id: true } })
  const usuario = await prisma.usuarios.findFirst({ select: { id: true } })

  if (!cliente || !usuario) {
    // La base efímera arranca vacía; se siembra lo mínimo.
    clienteId = randomUUID()
    await prisma.clientes.create({
      data: {
        id: clienteId,
        nombre: `${MARCA} Cliente`,
        nit: `${MARCA}-NIT`,
        representante: 'X',
        cedula: '1',
        telefono: '1',
        direccion: 'X',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any,
    })
    usuarioId = randomUUID()
    await prisma.usuarios.create({
      data: {
        id: usuarioId,
        nombre: `${MARCA} Usuario`,
        correo: `${MARCA}@example.test`,
        password: 'x',
        role: 'admin',
        created_at: new Date(),
        updated_at: new Date(),
      } as any,
    })
  } else {
    clienteId = cliente.id
    usuarioId = usuario.id
  }
}, 30_000)

beforeEach(limpiar)

afterAll(async () => {
  await limpiar()
  await prisma.$disconnect()
})

describe('1 · Eliminar y restaurar una liquidación con varios ítems', () => {
  it('los ítems sobreviven al borrado y vuelven al restaurar', async () => {
    const { id } = await crearLiquidacion(3)

    const borrado = await eliminarLiquidacionServicio(id, { usuarioId, motivo: 'prueba' })
    expect(borrado.items).toBe(3)

    // Siguen EXISTIENDO, marcados. Antes desaparecían de la base.
    const marcados = await prisma.liquidacion_servicio_item.count({
      where: { liquidacion_id: id, deleted_at: { not: null } },
    })
    expect(marcados).toBe(3)
    expect(await estaEliminada(id)).toBe(true)

    const restaurado = await restaurarLiquidacionServicio(id, { usuarioId })
    expect(restaurado.items).toBe(3)

    const activos = await prisma.liquidacion_servicio_item.count({
      where: { liquidacion_id: id, deleted_at: null },
    })
    expect(activos).toBe(3)
    expect(await estaEliminada(id)).toBe(false)
  })
})

describe('2 · Las relaciones de terceros también se restauran', () => {
  it('terceros y sus conceptos vuelven con la liquidación', async () => {
    const { id, itemIds } = await crearLiquidacion(1)

    const tercero = await prisma.liquidacion_tercero.create({
      data: {
        liquidacion_id: id,
        item_id: itemIds[0],
        placa: 'ABC000',
        recorrido: 'R',
        fechas: '01/01/2026',
      } as any,
      select: { id: true },
    })
    await prisma.liquidacion_tercero_concepto.create({
      data: {
        liquidacion_tercero_id: tercero.id,
        concepto: 'PRUEBA',
        tipo: 'PAGO',
      } as any,
    })

    const borrado = await eliminarLiquidacionServicio(id, { usuarioId })
    expect(borrado.terceros).toBe(1)
    expect(borrado.conceptos).toBe(1)

    const restaurado = await restaurarLiquidacionServicio(id, { usuarioId })
    expect(restaurado.terceros).toBe(1)
    expect(restaurado.conceptos).toBe(1)

    const vivos = await prisma.liquidacion_tercero.count({
      where: { liquidacion_id: id, deleted_at: null },
    })
    expect(vivos).toBe(1)
  })
})

describe('3 y 4 · Reconciliación al editar', () => {
  it('quitar un ítem lo marca, no lo hace desaparecer', async () => {
    const { id, itemIds } = await crearLiquidacion(3)

    // Se guarda sin el tercer ítem.
    const r = await prisma.$transaction((tx) =>
      reconciliarItems(tx, id, [
        { id: itemIds[0], ...itemBase('ABC000') },
        { id: itemIds[1], ...itemBase('ABC111') },
      ]),
    )

    expect(r.eliminados).toBe(1)
    expect(r.actualizados).toBe(2)

    const retirado = await prisma.liquidacion_servicio_item.findUnique({
      where: { id: itemIds[2] },
      select: { deleted_at: true },
    })
    /// Se comprueba primero que la fila EXISTE: con un `deleteMany` de por
    /// medio, `findUnique` devuelve null y `null?.deleted_at` da `undefined`,
    /// que pasaría un `not.toBeNull()` sin que nadie se enterase de que el
    /// ítem se borró de verdad.
    expect(retirado, 'el ítem retirado debe seguir existiendo, marcado').not.toBeNull()
    expect(retirado!.deleted_at).toBeInstanceOf(Date)
  })

  it('volver a añadirlo lo restaura en vez de duplicarlo', async () => {
    const { id, itemIds } = await crearLiquidacion(2)

    await prisma.$transaction((tx) =>
      reconciliarItems(tx, id, [{ id: itemIds[0], ...itemBase('ABC000') }]),
    )

    const r = await prisma.$transaction((tx) =>
      reconciliarItems(tx, id, [
        { id: itemIds[0], ...itemBase('ABC000') },
        { id: itemIds[1], ...itemBase('ABC111') },
      ]),
    )

    expect(r.restaurados).toBe(1)
    expect(r.creados).toBe(0)

    const total = await prisma.liquidacion_servicio_item.count({
      where: { liquidacion_id: id, deleted_at: null },
    })
    expect(total).toBe(2)
  })

  it('correlaciona por client_key cuando el ítem aún no tiene id', async () => {
    const { id } = await crearLiquidacion(0)
    const clave = randomUUID()

    await prisma.$transaction((tx) =>
      reconciliarItems(tx, id, [{ client_key: clave, ...itemBase('NUEVA1') }]),
    )

    // Segundo guardado: el cliente aún no conoce el id de servidor y vuelve a
    // mandar solo su client_key. No debe crear un duplicado.
    const r = await prisma.$transaction((tx) =>
      reconciliarItems(tx, id, [{ client_key: clave, ...itemBase('NUEVA1') }]),
    )

    expect(r.creados).toBe(0)
    expect(r.actualizados).toBe(1)
    expect(
      await prisma.liquidacion_servicio_item.count({
        where: { liquidacion_id: id, deleted_at: null },
      }),
    ).toBe(1)
  })

  it('11 · convive con filas históricas sin client_key', async () => {
    // Las 1112 filas anteriores a la migración tienen `client_key = NULL`; se
    // correlacionan por id, que es lo que el frontend manda para lo guardado.
    const { id, itemIds } = await crearLiquidacion(2)

    const previos = await prisma.liquidacion_servicio_item.findMany({
      where: { liquidacion_id: id },
      select: { client_key: true },
    })
    expect(previos.every((i) => i.client_key === null)).toBe(true)

    const r = await prisma.$transaction((tx) =>
      reconciliarItems(tx, id, [
        { id: itemIds[0], ...itemBase('ABC000') },
        { id: itemIds[1], ...itemBase('ABC111') },
      ]),
    )
    expect(r.actualizados).toBe(2)
    expect(r.creados).toBe(0)
  })
})

describe('5 · Autoguardado con payload vacío', () => {
  it('no borra los ítems si la lista llega vacía', async () => {
    const { id } = await crearLiquidacion(3)

    await expect(
      prisma.$transaction((tx) =>
        reconciliarItems(tx, id, [], { rechazarVaciadoTotal: true }),
      ),
    ).rejects.toBeInstanceOf(ReconciliacionVacia)

    // Ni uno se marcó: la operación se rechazó entera.
    const activos = await prisma.liquidacion_servicio_item.count({
      where: { liquidacion_id: id, deleted_at: null },
    })
    expect(activos).toBe(3)
  })

  it('la edición explícita SÍ puede vaciar', async () => {
    // Vaciar de verdad es una acción deliberada; la guardia solo aplica al
    // autoguardado, donde una lista vacía suele ser un estado a medio cargar.
    const { id } = await crearLiquidacion(2)

    const r = await prisma.$transaction((tx) => reconciliarItems(tx, id, []))
    expect(r.eliminados).toBe(2)
  })
})

describe('7 y 8 · Qué se ve y qué no', () => {
  it('las consultas normales no devuelven ítems eliminados', async () => {
    const { id, itemIds } = await crearLiquidacion(3)
    await prisma.$transaction((tx) =>
      reconciliarItems(tx, id, [{ id: itemIds[0], ...itemBase('ABC000') }]),
    )

    const visibles = await prisma.liquidacion_servicio_item.findMany({
      where: { liquidacion_id: id, deleted_at: null },
    })
    expect(visibles).toHaveLength(1)

    /// Y los otros dos siguen en la base, marcados: si se hubieran borrado
    /// físicamente este recuento daría 1 y la restauración no los devolvería.
    const todos = await prisma.liquidacion_servicio_item.count({
      where: { liquidacion_id: id },
    })
    expect(todos, 'los retirados deben conservarse para poder restaurarlos').toBe(3)
  })

  it('la vista de auditoría sí puede consultarlos', async () => {
    const { id } = await crearLiquidacion(2)
    await eliminarLiquidacionServicio(id, { usuarioId, motivo: 'para auditoría' })

    const todos = await prisma.liquidacion_servicio_item.count({
      where: { liquidacion_id: id },
    })
    expect(todos).toBe(2)

    // Y queda registrado quién y por qué.
    const auditoria: any = await prisma.$queryRaw`
      SELECT accion, usuario_id, motivo, relacionadas
      FROM auditoria.borrado_logico
      WHERE registro_id = ${id} AND accion = 'ELIMINAR'
      ORDER BY ocurrido_en DESC LIMIT 1`
    expect(auditoria[0]?.accion).toBe('ELIMINAR')
    expect(auditoria[0]?.motivo).toBe('para auditoría')
    expect(auditoria[0]?.relacionadas?.items).toBe(2)
  })
})

describe('9 · Totales', () => {
  it('solo suman los ítems activos', async () => {
    const { id, itemIds } = await crearLiquidacion(3)

    const antes = await prisma.$transaction((tx) => totalesDeItemsActivos(tx, id))
    expect(antes.cantidad).toBe(3)
    expect(antes.subtotal).toBe(300)

    await prisma.$transaction((tx) =>
      reconciliarItems(tx, id, [{ id: itemIds[0], ...itemBase('ABC000') }]),
    )

    const despues = await prisma.$transaction((tx) => totalesDeItemsActivos(tx, id))
    // Si los eliminados contaran, el total seguiría en 300 y no cuadraría con
    // lo que el usuario ve en pantalla.
    expect(despues.cantidad).toBe(1)
    expect(despues.subtotal).toBe(100)
  })
})

describe('10 · Facturación', () => {
  it('la liquidación no pierde su relación con la factura al restaurar', async () => {
    const { id } = await crearLiquidacion(1)

    const factura = await prisma.factura_liquidacion_servicio.create({
      data: {
        /// Único por ejecución: si una corrida anterior dejó la factura sin
        /// limpiar, un número fijo choca con el UNIQUE y el test falla por un
        /// motivo que no tiene que ver con lo que prueba.
        numero_factura: `${MARCA}-${randomUUID().slice(0, 8)}`,
        facturado_por_id: usuarioId,
        estado: 'ACTIVA' as any,
      } as any,
      select: { id: true },
    })
    await prisma.factura_liquidacion_item.create({
      data: { factura_id: factura.id, liquidacion_id: id, valor_liquidacion: 100 } as any,
    })

    const borrado = await eliminarLiquidacionServicio(id, { usuarioId })
    expect(borrado.items_factura).toBe(1)

    const restaurado = await restaurarLiquidacionServicio(id, { usuarioId })
    expect(restaurado.items_factura).toBe(1)

    const vivo = await prisma.factura_liquidacion_item.count({
      where: { liquidacion_id: id, deleted_at: null },
    })
    expect(vivo).toBe(1)

    await prisma.factura_liquidacion_item.deleteMany({ where: { factura_id: factura.id } })
    await prisma.factura_liquidacion_servicio.delete({ where: { id: factura.id } })
  })
})

describe('6 · Conflicto entre dos pestañas', () => {
  it('la petición desactualizada no pisa los cambios de la otra', async () => {
    /**
     * El compare-and-swap va sobre `version`: la primera pestaña guarda y la
     * sube, así que la segunda —que sigue con la versión vieja— no encuentra
     * fila que actualizar. Sin esto, la pestaña que llega tarde sobrescribe en
     * silencio lo que acaba de guardar la otra.
     */
    const { id } = await crearLiquidacion(1)
    const inicial = await prisma.liquidacion_servicio.findUnique({
      where: { id },
      select: { version: true },
    })

    // Pestaña A guarda: la versión sube.
    const a = await prisma.liquidacion_servicio.updateMany({
      where: { id, version: inicial!.version },
      data: { version: { increment: 1 }, observaciones: 'guardado por A' },
    })
    expect(a.count).toBe(1)

    // Pestaña B llega con la versión vieja: no afecta a ninguna fila.
    const b = await prisma.liquidacion_servicio.updateMany({
      where: { id, version: inicial!.version },
      data: { observaciones: 'guardado por B' },
    })
    expect(b.count, 'la petición desactualizada debe rechazarse').toBe(0)

    const final = await prisma.liquidacion_servicio.findUnique({
      where: { id },
      select: { observaciones: true },
    })
    expect(final?.observaciones).toBe('guardado por A')
  })
})

describe('16 · No se edita una liquidación eliminada', () => {
  it('`estaEliminada` la detecta para poder frenar la escritura', async () => {
    /// Sin esta guardia, guardar sobre una liquidación eliminada crearía ítems
    /// ACTIVOS colgando de una cabecera que nadie ve, y esos ítems no se
    /// restaurarían nunca: la restauración solo revive lo que tiene
    /// `deleted_at`.
    const { id } = await crearLiquidacion(1)
    expect(await estaEliminada(id)).toBe(false)

    await eliminarLiquidacionServicio(id, { usuarioId })
    expect(await estaEliminada(id)).toBe(true)

    await restaurarLiquidacionServicio(id, { usuarioId })
    expect(await estaEliminada(id)).toBe(false)
  })
})

describe('Historial · no se toca', () => {
  it('el historial de estados sobrevive intacto al borrado', async () => {
    const { id } = await crearLiquidacion(1)
    await prisma.historial_estado_liquidacion.create({
      data: {
        liquidacion_id: id,
        estado_anterior: 'BORRADOR',
        estado_nuevo: 'LIQUIDADA',
        usuario_id: usuarioId,
      } as any,
    })

    await eliminarLiquidacionServicio(id, { usuarioId })

    // Es evidencia: alterarlo al borrar destruiría el rastro que sirve para
    // reconstruir qué pasó.
    const historial = await prisma.historial_estado_liquidacion.count({
      where: { liquidacion_id: id },
    })
    expect(historial).toBe(1)

    await prisma.historial_estado_liquidacion.deleteMany({ where: { liquidacion_id: id } })
  })
})
