/**
 * Devolver una liquidación FACTURADA a APROBADA, y editarla ya facturada.
 *
 * Administración puede sacar una liquidación de su factura de dos formas
 * —anulando la factura entera o quitándola solo a ella— y pedir que quede
 * APROBADA en lugar de LIQUIDADA. Y puede editar una FACTURADA: la factura
 * tiene que seguir sumando lo que de verdad valen sus liquidaciones.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'

vi.mock('pdfmake/build/pdfmake', () => ({ default: {}, createPdf: () => ({}) }))
vi.mock('pdfmake/build/vfs_fonts', () => ({ default: { vfs: {} }, vfs: {} }))

import { FacturacionLiquidacionesService } from '../src/modules/facturacion-liquidaciones/facturacion-liquidaciones.service'

const prisma = new PrismaClient()

/** Marca para poder limpiar solo lo que crea esta suite. */
const MARCA = 'ZZTEST-FACTAPROB'

let clienteId: string
let usuarioId: string
let aprobadorId: string

async function crearFacturada(total: number, aprobadoPor: string | null): Promise<string> {
  const id = randomUUID()
  await prisma.liquidacion_servicio.create({
    data: {
      id,
      consecutivo: `${MARCA}-${id.slice(0, 8)}`,
      cliente_id: clienteId,
      mes: 1,
      anio: 2026,
      estado: 'FACTURADA' as any,
      subtotal: total,
      total,
      creado_por_id: usuarioId,
      actualizado_por_id: usuarioId,
      aprobado_por_id: aprobadoPor,
      fecha_aprobacion: aprobadoPor ? new Date('2026-01-15') : null,
      fecha_facturacion: new Date('2026-01-20'),
    } as any,
  })
  return id
}

async function crearFactura(liquidaciones: { id: string; valor: number }[]) {
  const factura = await prisma.factura_liquidacion_servicio.create({
    data: {
      numero_factura: `${MARCA}-${randomUUID().slice(0, 8)}`,
      facturado_por_id: usuarioId,
      estado: 'ACTIVA' as any,
      valor_total: liquidaciones.reduce((s, l) => s + l.valor, 0),
    } as any,
    select: { id: true },
  })
  for (const l of liquidaciones) {
    await prisma.factura_liquidacion_item.create({
      data: { factura_id: factura.id, liquidacion_id: l.id, valor_liquidacion: l.valor } as any,
    })
  }
  return factura.id
}

async function limpiar() {
  const liqs = await prisma.liquidacion_servicio.findMany({
    where: { consecutivo: { startsWith: MARCA } },
    select: { id: true },
  })
  const ids = liqs.map((l) => l.id)
  await prisma.historial_estado_liquidacion.deleteMany({ where: { liquidacion_id: { in: ids } } })
  await prisma.factura_liquidacion_item.deleteMany({ where: { liquidacion_id: { in: ids } } })
  await prisma.liquidacion_servicio.deleteMany({ where: { id: { in: ids } } })
  await prisma.factura_liquidacion_servicio.deleteMany({
    where: { numero_factura: { startsWith: MARCA } },
  })
}

beforeAll(async () => {
  const cliente = await prisma.clientes.findFirst({ select: { id: true } })
  const usuarios = await prisma.usuarios.findMany({ select: { id: true }, take: 2 })

  if (cliente) {
    clienteId = cliente.id
  } else {
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
  }

  const ids = usuarios.map((u) => u.id)
  while (ids.length < 2) {
    const id = randomUUID()
    await prisma.usuarios.create({
      data: {
        id,
        nombre: `${MARCA} Usuario ${ids.length}`,
        correo: `${MARCA}-${ids.length}@example.test`,
        password: 'x',
        role: 'admin',
        created_at: new Date(),
        updated_at: new Date(),
      } as any,
    })
    ids.push(id)
  }
  ;[usuarioId, aprobadorId] = ids
}, 30_000)

beforeEach(limpiar)

afterAll(async () => {
  await limpiar()
  await prisma.$disconnect()
})

describe('Anular la factura dejando una liquidación en APROBADA', () => {
  it('la elegida queda APROBADA con su aprobación original; las demás, LIQUIDADA', async () => {
    const elegida = await crearFacturada(100, aprobadorId)
    const otra = await crearFacturada(200, aprobadorId)
    const facturaId = await crearFactura([
      { id: elegida, valor: 100 },
      { id: otra, valor: 200 },
    ])

    const r = await FacturacionLiquidacionesService.anular(facturaId, usuarioId, 'Error en NIT', {
      mantenerAprobada: elegida,
    })

    expect(r.estado).toBe('ANULADA')
    expect(r.estados_resultantes).toEqual({ [elegida]: 'APROBADA', [otra]: 'LIQUIDADA' })

    const [a, b] = await Promise.all([
      prisma.liquidacion_servicio.findUnique({ where: { id: elegida } }),
      prisma.liquidacion_servicio.findUnique({ where: { id: otra } }),
    ])
    expect(a?.estado).toBe('APROBADA')
    expect(a?.aprobado_por_id).toBe(aprobadorId)
    expect(a?.fecha_facturacion).toBeNull()
    expect(b?.estado).toBe('LIQUIDADA')

    const historial = await prisma.historial_estado_liquidacion.findMany({
      where: { liquidacion_id: elegida },
    })
    expect(historial.map((h) => [h.estado_anterior, h.estado_nuevo])).toEqual([
      ['FACTURADA', 'APROBADA'],
    ])
  })

  it('sin la opción, anular sigue devolviendo todo a LIQUIDADA', async () => {
    const id = await crearFacturada(100, aprobadorId)
    const facturaId = await crearFactura([{ id, valor: 100 }])

    await FacturacionLiquidacionesService.anular(facturaId, usuarioId, 'x')

    const liq = await prisma.liquidacion_servicio.findUnique({ where: { id } })
    expect(liq?.estado).toBe('LIQUIDADA')
  })
})

describe('Quitar una liquidación de su factura dejándola APROBADA', () => {
  it('la factura sigue activa, sin ella y con el total recalculado', async () => {
    const elegida = await crearFacturada(100, null)
    const otra = await crearFacturada(200, aprobadorId)
    const facturaId = await crearFactura([
      { id: elegida, valor: 100 },
      { id: otra, valor: 200 },
    ])

    const r = await FacturacionLiquidacionesService.quitarLiquidacion(
      facturaId,
      elegida,
      usuarioId,
      'APROBADA',
    )

    expect(r.factura.estado).toBe('ACTIVA')
    expect(r.factura.valor_total).toBe(200)
    expect(r.liquidaciones_afectadas[0].estado).toBe('APROBADA')

    const liq = await prisma.liquidacion_servicio.findUnique({ where: { id: elegida } })
    expect(liq?.estado).toBe('APROBADA')
    // Se facturó sin aprobación previa: queda firmada por quien la devolvió.
    expect(liq?.aprobado_por_id).toBe(usuarioId)
    expect(liq?.fecha_aprobacion).not.toBeNull()
  })
})

describe('Editar una FACTURADA recalcula su factura', () => {
  it('actualiza el pivote y el total de la factura activa', async () => {
    const id = await crearFacturada(100, aprobadorId)
    const otra = await crearFacturada(200, aprobadorId)
    const facturaId = await crearFactura([
      { id, valor: 100 },
      { id: otra, valor: 200 },
    ])
    await prisma.liquidacion_servicio.update({ where: { id }, data: { total: 150 } })

    const r = await FacturacionLiquidacionesService.sincronizarTotalLiquidacion(id)

    expect(r).toMatchObject({ factura_id: facturaId, valor_anterior: 300, valor_nuevo: 350 })
    const factura = await prisma.factura_liquidacion_servicio.findUnique({ where: { id: facturaId } })
    expect(Number(factura?.valor_total)).toBe(350)
  })

  it('no hace nada si el total no cambió', async () => {
    const id = await crearFacturada(100, aprobadorId)
    await crearFactura([{ id, valor: 100 }])

    expect(await FacturacionLiquidacionesService.sincronizarTotalLiquidacion(id)).toBeNull()
  })
})
