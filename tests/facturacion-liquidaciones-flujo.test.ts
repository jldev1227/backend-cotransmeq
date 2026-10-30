/**
 * Facturación de liquidaciones de servicios: crear, anular, eliminar y
 * restaurar una factura, entrando por `FacturacionLiquidacionesService` y,
 * para restaurar, por su controlador.
 *
 * Lo que ya cubren otras suites y aquí no se repite:
 *   - `facturacion-revertir-aprobada`: anular o quitar dejando una liquidación
 *     en APROBADA, y editar una FACTURADA.
 *   - `cartera-y-pagos-terceros`: valor, abonos, vencimientos y edades.
 *
 * Aquí va el camino de siempre —el que recorre facturación cada mes— y sus
 * reglas: qué se puede facturar, qué le pasa a cada liquidación en cada paso,
 * qué queda en el historial, y que una factura sacada de la papelera vuelva
 * entera (antes volvía con «_ELIMINADA» pegado al número y su evento no
 * llegaba a ningún otro navegador).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'

vi.mock('pdfmake/build/pdfmake', () => ({ default: {}, createPdf: () => ({}) }))
vi.mock('pdfmake/build/vfs_fonts', () => ({ default: { vfs: {} }, vfs: {} }))

/// Lo que el controlador emite se apunta aquí: importa QUÉ sale (que lleve la
/// factura), no el transporte, que ya prueban las suites de sockets.
const emitidos = vi.hoisted(() => [] as Array<{ evento: string; data: any; meta: any }>)
vi.mock('../src/sockets', () => ({
  emitFacturacionLiquidacion: (evento: string, data: any, meta?: any) => {
    emitidos.push({ evento, data, meta })
  },
  emitNotificacion: vi.fn(),
  eventoMeta: (meta: Record<string, unknown>) => ({ ...meta, ts: new Date().toISOString() }),
}))

import { FacturacionLiquidacionesService as Facturas } from '../src/modules/facturacion-liquidaciones/facturacion-liquidaciones.service'
import { FacturacionLiquidacionesController } from '../src/modules/facturacion-liquidaciones/facturacion-liquidaciones.controller'
import {
  prismaFlujo as prisma,
  sembrarEscenario,
  limpiarRastros,
  type EscenarioFlujo,
} from './helpers/liquidaciones-flujo'

const MARCA = 'ZZTEST-FACTFLUJO'
let esc: EscenarioFlujo

/** Liquidación lista para facturar (o no), con su total. */
async function liquidacion(estado: 'BORRADOR' | 'LIQUIDADA' | 'APROBADA', total: number) {
  const id = randomUUID()
  await prisma.liquidacion_servicio.create({
    data: {
      id,
      consecutivo: `${MARCA}-${id.slice(0, 8)}`,
      cliente_id: esc.clienteId,
      mes: 1,
      anio: 2026,
      estado: estado as any,
      subtotal: total,
      total,
      creado_por_id: esc.creadorId,
      actualizado_por_id: esc.creadorId,
      aprobado_por_id: estado === 'APROBADA' ? esc.adminId : null,
    } as any,
  })
  return id
}

function numero() {
  return `${MARCA}-FE-${randomUUID().slice(0, 6)}`
}

async function estadoDe(id: string) {
  return prisma.liquidacion_servicio.findUniqueOrThrow({
    where: { id },
    select: { estado: true, fecha_facturacion: true },
  })
}

/** Respuesta de Fastify mínima: guarda el código y el cuerpo enviados. */
function respuesta() {
  const r = {
    codigo: 200,
    cuerpo: undefined as any,
    status(c: number) {
      r.codigo = c
      return r
    },
    send(b: any) {
      r.cuerpo = b
      return r
    },
  }
  return r
}

beforeAll(async () => {
  esc = await sembrarEscenario(MARCA)
}, 30_000)

beforeEach(() => {
  emitidos.length = 0
})

afterAll(async () => {
  await limpiarRastros(MARCA)
  await prisma.$disconnect()
})

describe('Crear una factura', () => {
  it('exige número y al menos una liquidación', async () => {
    const l = await liquidacion('LIQUIDADA', 100)
    await expect(Facturas.crear({ numero_factura: '  ', liquidacion_ids: [l] }, esc.adminId)).rejects.toThrow(
      /número de factura es obligatorio/,
    )
    await expect(Facturas.crear({ numero_factura: numero(), liquidacion_ids: [] }, esc.adminId)).rejects.toThrow(
      /al menos una liquidación/,
    )
  })

  it('un BORRADOR no se factura, y el intento no deja nada a medias', async () => {
    const lista = await liquidacion('LIQUIDADA', 100)
    const borrador = await liquidacion('BORRADOR', 50)
    const num = numero()

    await expect(
      Facturas.crear({ numero_factura: num, liquidacion_ids: [lista, borrador] }, esc.adminId),
    ).rejects.toThrow(/no están en estado para facturar/)

    // Ni factura creada ni la liquidación buena tomada: la validación corre
    // antes de la transacción.
    expect(await prisma.factura_liquidacion_servicio.count({ where: { numero_factura: num } })).toBe(0)
    expect((await estadoDe(lista)).estado).toBe('LIQUIDADA')
  })

  it('factura LIQUIDADAS y APROBADAS: quedan FACTURADAS, con historial y el total sumado', async () => {
    const a = await liquidacion('LIQUIDADA', 1_200_000)
    const b = await liquidacion('APROBADA', 800_000.5)
    const num = numero()

    const factura = await Facturas.crear({ numero_factura: `  ${num}  `, liquidacion_ids: [a, b] }, esc.adminId)

    // El número se guarda recortado: es el que se busca después.
    expect(factura.numero_factura).toBe(num)
    expect(factura.estado).toBe('ACTIVA')
    // Sin condiciones explícitas la factura vale la suma de sus liquidaciones.
    expect(Number(factura.valor_total)).toBeCloseTo(2_000_000.5, 2)
    expect(factura.items.map((i: any) => i.valor_liquidacion).sort((x: number, y: number) => x - y)).toEqual([
      800_000.5, 1_200_000,
    ])

    for (const id of [a, b]) {
      const e = await estadoDe(id)
      expect(e.estado).toBe('FACTURADA')
      expect(e.fecha_facturacion).not.toBeNull()
    }

    // Cada una deja su paso en el historial, desde el estado que tenía.
    const historial = await prisma.historial_estado_liquidacion.findMany({
      where: { liquidacion_id: { in: [a, b] }, estado_nuevo: 'FACTURADA' },
      select: { liquidacion_id: true, estado_anterior: true, usuario_id: true },
    })
    expect(historial).toHaveLength(2)
    expect(historial.find((h) => h.liquidacion_id === a)?.estado_anterior).toBe('LIQUIDADA')
    expect(historial.find((h) => h.liquidacion_id === b)?.estado_anterior).toBe('APROBADA')
    expect(historial.every((h) => h.usuario_id === esc.adminId)).toBe(true)
  })

  it('no repite el número de una factura viva', async () => {
    const num = numero()
    await Facturas.crear({ numero_factura: num, liquidacion_ids: [await liquidacion('LIQUIDADA', 10)] }, esc.adminId)
    await expect(
      Facturas.crear({ numero_factura: num, liquidacion_ids: [await liquidacion('LIQUIDADA', 20)] }, esc.adminId),
    ).rejects.toThrow(/Ya existe una factura con el número/)
  })

  it('una liquidación ya facturada se rechaza diciendo en qué factura está', async () => {
    const l = await liquidacion('LIQUIDADA', 10)
    const num = numero()
    await Facturas.crear({ numero_factura: num, liquidacion_ids: [l] }, esc.adminId)

    // El mensaje útil es DÓNDE está, no que «no está en estado para facturar»,
    // aunque las dos cosas sean ciertas.
    await expect(Facturas.crear({ numero_factura: numero(), liquidacion_ids: [l] }, esc.adminId)).rejects.toThrow(
      new RegExp(`ya están facturadas: .*\\(Factura: ${num}\\)`),
    )
  })
})

describe('Anular una factura', () => {
  it('devuelve sus liquidaciones a APROBADA, con historial y motivo, y se pueden volver a facturar', async () => {
    const a = await liquidacion('LIQUIDADA', 100)
    const b = await liquidacion('APROBADA', 200)
    const factura = await Facturas.crear({ numero_factura: numero(), liquidacion_ids: [a, b] }, esc.adminId)

    const anulada = await Facturas.anular(factura.id, esc.adminId, 'número equivocado')
    expect(anulada.estado).toBe('ANULADA')
    expect(anulada.motivo_anulacion).toBe('número equivocado')
    expect(anulada.anulado_por?.id).toBe(esc.adminId)
    // Al anular por defecto se conserva la aprobación de todas las liquidaciones.
    expect(anulada.estados_resultantes).toEqual({ [a]: 'APROBADA', [b]: 'APROBADA' })

    for (const id of [a, b]) {
      const e = await estadoDe(id)
      expect(e.estado).toBe('APROBADA')
      expect(e.fecha_facturacion).toBeNull()
    }
    const vuelta = await prisma.historial_estado_liquidacion.findMany({
      where: { liquidacion_id: { in: [a, b] }, estado_anterior: 'FACTURADA', estado_nuevo: 'APROBADA' },
      select: { motivo: true },
    })
    expect(vuelta).toHaveLength(2)
    expect(vuelta.every((h) => h.motivo === `Factura ${factura.numero_factura} anulada: número equivocado`)).toBe(true)

    // El pivote de la factura anulada ya no la cuenta como facturada.
    const otra = await Facturas.crear({ numero_factura: numero(), liquidacion_ids: [a, b] }, esc.adminId)
    expect(otra.estado).toBe('ACTIVA')
  })

  it('no se anula dos veces', async () => {
    const factura = await Facturas.crear(
      { numero_factura: numero(), liquidacion_ids: [await liquidacion('LIQUIDADA', 10)] },
      esc.adminId,
    )
    await Facturas.anular(factura.id, esc.adminId, 'x')
    await expect(Facturas.anular(factura.id, esc.adminId, 'x')).rejects.toThrow(/ya está anulada/)
  })
})

describe('Eliminar y restaurar una factura', () => {
  async function facturaAnulada() {
    const num = numero()
    const f = await Facturas.crear(
      { numero_factura: num, liquidacion_ids: [await liquidacion('LIQUIDADA', 10)] },
      esc.adminId,
    )
    await Facturas.anular(f.id, esc.adminId, 'prueba')
    return { id: f.id, num }
  }

  it('una factura ACTIVA no se elimina: primero se anula', async () => {
    const f = await Facturas.crear(
      { numero_factura: numero(), liquidacion_ids: [await liquidacion('LIQUIDADA', 10)] },
      esc.adminId,
    )
    await expect(Facturas.eliminar(f.id)).rejects.toThrow(/No se puede eliminar una factura activa/)
  })

  it('eliminar la manda a la papelera y libera su número', async () => {
    const { id, num } = await facturaAnulada()
    await Facturas.eliminar(id)

    const fila = await prisma.factura_liquidacion_servicio.findUniqueOrThrow({ where: { id } })
    expect(fila.deleted_at).not.toBeNull()

    // Fuera del listado, dentro de la papelera.
    const listado = await Facturas.listar({ busqueda: num, limit: 50 })
    expect(listado.facturas.some((f: any) => f.id === id)).toBe(false)
    expect((await Facturas.listarEliminadas()).some((f) => f.id === id)).toBe(true)

    // El número queda libre para volver a emitirlo.
    const nueva = await Facturas.crear(
      { numero_factura: num, liquidacion_ids: [await liquidacion('LIQUIDADA', 10)] },
      esc.adminId,
    )
    expect(nueva.numero_factura).toBe(num)
  })

  it('restaurar la devuelve con su número ORIGINAL y fuera de la papelera', async () => {
    const { id, num } = await facturaAnulada()
    await Facturas.eliminar(id)

    await Facturas.restaurar(id)

    const fila = await prisma.factura_liquidacion_servicio.findUniqueOrThrow({ where: { id } })
    expect(fila.deleted_at).toBeNull()
    // Antes volvía como «<num>_ELIMINADA» y así se quedaba.
    expect(fila.numero_factura).toBe(num)
    expect((await Facturas.listarEliminadas()).some((f) => f.id === id)).toBe(false)
  })

  it('si otra factura viva ya usa ese número, no se restaura y sigue en la papelera', async () => {
    const { id, num } = await facturaAnulada()
    await Facturas.eliminar(id)
    await Facturas.crear({ numero_factura: num, liquidacion_ids: [await liquidacion('LIQUIDADA', 10)] }, esc.adminId)

    await expect(Facturas.restaurar(id)).rejects.toThrow(/ya existe una factura con el número/)
    const fila = await prisma.factura_liquidacion_servicio.findUniqueOrThrow({ where: { id } })
    expect(fila.deleted_at).not.toBeNull()
  })

  it('restaurar una que no está en la papelera es un error', async () => {
    const { id } = await facturaAnulada()
    await expect(Facturas.restaurar(id)).rejects.toThrow(/no está eliminada/)
  })

  it('el controlador emite la factura restaurada, con id y número, para que reaparezca en los demás navegadores', async () => {
    const { id, num } = await facturaAnulada()
    await Facturas.eliminar(id)

    const reply = respuesta()
    await FacturacionLiquidacionesController.restaurar(
      { params: { id }, user: { id: esc.adminId, nombre: 'Prueba' } } as any,
      reply as any,
    )

    expect(reply.codigo).toBe(200)
    expect(emitidos).toHaveLength(1)
    const [{ evento, data, meta }] = emitidos
    expect(evento).toBe('facturacion-created')
    // Antes se emitía `{ message }`: sin `id` el listado lo descartaba.
    expect(data.id).toBe(id)
    expect(data.numero_factura).toBe(num)
    expect(meta.etiqueta).toBe(num)
    expect(reply.cuerpo.factura.id).toBe(id)
  })

  it('por el controlador, restaurar una que no está en la papelera es 409 y no emite nada', async () => {
    const { id } = await facturaAnulada()
    const reply = respuesta()
    await FacturacionLiquidacionesController.restaurar(
      { params: { id }, user: { id: esc.adminId, nombre: 'Prueba' } } as any,
      reply as any,
    )
    expect(reply.codigo).toBe(409)
    expect(emitidos).toHaveLength(0)
  })
})
