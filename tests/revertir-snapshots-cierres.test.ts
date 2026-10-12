/**
 * Revertir un snapshot de cierre final o de liquidación ocasional, y el cambio
 * de estado del ocasional, contra la base de pruebas.
 *
 * Hasta oct-2026 revertir copiaba el `estado` guardado en el snapshot sin
 * pasar por la máquina de estados ni por las reglas de área: con nivel
 * `limited` un ANULADA volvía a BORRADOR y un LIQUIDADA a APROBADA. Y el
 * `PATCH /:id/estado` del ocasional escribía cualquier texto, también sobre
 * cabeceras borradas. Aquí se comprueba que:
 *
 * - revertir restaura los datos y deja el estado como está;
 * - no se revierte un cierre/cabecera no editable ni eliminado;
 * - el estado del ocasional valida valor, transición, área y motivo.
 *
 * Sockets y anotaciones se sustituyen: el test no necesita Socket.IO, y las
 * anotaciones del canvas viven en otra tabla que no es de esta suite.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'

vi.mock('pdfmake/build/pdfmake', () => ({ default: {}, createPdf: () => ({}) }))
vi.mock('pdfmake/build/vfs_fonts', () => ({ default: { vfs: {} }, vfs: {} }))
vi.mock('../src/sockets/sheet.gateway', () => ({
  emitSheetReverted: vi.fn(),
  emitSheetEstadoChanged: vi.fn(),
}))
vi.mock('../src/modules/canvas-anotaciones/canvas-anotaciones.service', () => ({
  CanvasAnotacionesService: { restaurar: vi.fn(async () => undefined), exportar: vi.fn(async () => []) },
}))

import { LiquidacionesSnapshotsService } from '../src/modules/liquidaciones-terceros-snapshots/liquidaciones-terceros-snapshots.service'
import { LiquidacionesTercerosOcasionalSnapshotsService } from '../src/modules/liquidaciones-terceros-ocasional-snapshots/liquidaciones-terceros-ocasional-snapshots.service'
import { LiquidacionesTercerosOcasionalService } from '../src/modules/liquidaciones-terceros-ocasional/liquidaciones-terceros-ocasional.service'
import {
  limpiarRastros,
  prismaFlujo as prisma,
  sembrarEscenario,
  type EscenarioFlujo,
} from './helpers/liquidaciones-flujo'

const MARCA = 'ZZTEST-REVSNAP'
/// El ocasional tiene un único `(mes, anio)` total: un año que nadie usa.
const ANIO_OCASIONAL = 2099

let esc: EscenarioFlujo
let liquidacionServicioId: string
let mesOcasional = 0

async function limpiarPropio() {
  const cierres = await prisma.liquidacion_tercero_final.findMany({
    where: { consecutivo: { startsWith: MARCA } },
    select: { id: true },
  })
  const ids = cierres.map((c) => c.id)
  await prisma.liquidacion_tercero_final_snapshot.deleteMany({ where: { liquidacion_tercero_final_id: { in: ids } } })
  await prisma.liquidacion_tercero_final_concepto.deleteMany({ where: { liquidacion_tercero_final_id: { in: ids } } })
  await prisma.liquidacion_tercero_final_item.deleteMany({ where: { liquidacion_tercero_final_id: { in: ids } } })
  await prisma.liquidacion_tercero_final.deleteMany({ where: { id: { in: ids } } })

  const ocasionales = await prisma.liquidacion_tercero_ocasional.findMany({
    where: { consecutivo: { startsWith: MARCA } },
    select: { id: true },
  })
  const oids = ocasionales.map((o) => o.id)
  await prisma.liquidacion_tercero_ocasional_snapshot.deleteMany({ where: { liquidacion_ocasional_id: { in: oids } } })
  await prisma.liquidacion_tercero_ocasional.deleteMany({ where: { id: { in: oids } } })
}

async function crearCierre(estado: string, total_pagar: number) {
  return prisma.liquidacion_tercero_final.create({
    data: {
      consecutivo: `${MARCA}-LTF-${randomUUID().slice(0, 8)}`,
      liquidacion_servicio_id: liquidacionServicioId,
      placa: 'ZZR999',
      mes: 1,
      anio: 2026,
      estado,
      total_pagar,
    },
    select: { id: true },
  })
}

async function crearOcasional(estado: string, total_pagar: number) {
  mesOcasional += 1
  return prisma.liquidacion_tercero_ocasional.create({
    data: {
      consecutivo: `${MARCA}-LOC-${randomUUID().slice(0, 8)}`,
      mes: mesOcasional,
      anio: ANIO_OCASIONAL,
      estado,
      total_pagar,
    },
    select: { id: true },
  })
}

beforeAll(async () => {
  await limpiarPropio()
  esc = await sembrarEscenario(MARCA)
  liquidacionServicioId = randomUUID()
  await prisma.liquidacion_servicio.create({
    data: {
      id: liquidacionServicioId,
      consecutivo: `${MARCA}-LS-${liquidacionServicioId.slice(0, 8)}`,
      cliente_id: esc.clienteId,
      mes: 1,
      anio: 2026,
      estado: 'APROBADA' as any,
      creado_por_id: esc.adminId,
      actualizado_por_id: esc.adminId,
    } as any,
  })
}, 30_000)

afterAll(async () => {
  await limpiarPropio()
  await limpiarRastros(MARCA)
  await prisma.$disconnect()
})

// ════════════════════════════════════════════════════════════════════════════
describe('Revertir snapshot de cierre final', () => {
  it('restaura los datos pero conserva el estado actual', async () => {
    /// El snapshot es de cuando estaba APROBADA; Administración la devolvió a
    /// LIQUIDADA. Antes, revertir con `limited` la dejaba APROBADA otra vez.
    const { id } = await crearCierre('APROBADA', 100)
    const snap = await LiquidacionesSnapshotsService.capturar(id, { origen: 'manual', usuarioId: esc.adminId })
    await prisma.liquidacion_tercero_final.update({ where: { id }, data: { estado: 'LIQUIDADA', total_pagar: 250 } })

    const r = await LiquidacionesSnapshotsService.revertir(id, snap.id, esc.creadorId)

    const fila = await prisma.liquidacion_tercero_final.findUnique({ where: { id } })
    expect(fila?.estado).toBe('LIQUIDADA')
    expect(Number(fila?.total_pagar)).toBe(100)
    expect(r).toMatchObject({ origen: 'revert', estado_conservado: 'LIQUIDADA', estado_del_snapshot: 'APROBADA' })
  })

  it('no conserva el motivo de anulación del snapshot', async () => {
    const { id } = await crearCierre('BORRADOR', 100)
    await prisma.liquidacion_tercero_final.update({ where: { id }, data: { motivo_anulacion: 'viejo' } })
    const snap = await LiquidacionesSnapshotsService.capturar(id, { origen: 'manual', usuarioId: esc.adminId })
    await prisma.liquidacion_tercero_final.update({ where: { id }, data: { motivo_anulacion: null } })

    await LiquidacionesSnapshotsService.revertir(id, snap.id, esc.adminId)
    const fila = await prisma.liquidacion_tercero_final.findUnique({ where: { id } })
    expect(fila?.motivo_anulacion).toBeNull()
  })

  it.each(['ANULADA', 'APROBADA', 'PAGADA', 'REEMPLAZADA'])('no revierte un cierre %s (409)', async (estado) => {
    const { id } = await crearCierre('BORRADOR', 100)
    const snap = await LiquidacionesSnapshotsService.capturar(id, { origen: 'manual', usuarioId: esc.adminId })
    await prisma.liquidacion_tercero_final.update({ where: { id }, data: { estado, total_pagar: 300 } })

    await expect(LiquidacionesSnapshotsService.revertir(id, snap.id, esc.adminId)).rejects.toMatchObject({
      statusCode: 409,
    })
    const fila = await prisma.liquidacion_tercero_final.findUnique({ where: { id } })
    expect(fila?.estado).toBe(estado)
    expect(Number(fila?.total_pagar)).toBe(300)
  })

  it('no revierte un cierre en la papelera (404)', async () => {
    const { id } = await crearCierre('BORRADOR', 100)
    const snap = await LiquidacionesSnapshotsService.capturar(id, { origen: 'manual', usuarioId: esc.adminId })
    await prisma.liquidacion_tercero_final.update({ where: { id }, data: { deleted_at: new Date() } })

    await expect(LiquidacionesSnapshotsService.revertir(id, snap.id, esc.adminId)).rejects.toMatchObject({
      statusCode: 404,
    })
  })
})

// ════════════════════════════════════════════════════════════════════════════
describe('Revertir snapshot de liquidación ocasional', () => {
  it('restaura los datos pero conserva el estado actual', async () => {
    const { id } = await crearOcasional('APROBADA', 100)
    const snap = await LiquidacionesTercerosOcasionalSnapshotsService.capturar(id, {
      origen: 'manual',
      usuarioId: esc.adminId,
    })
    await prisma.liquidacion_tercero_ocasional.update({ where: { id }, data: { estado: 'LIQUIDADA', total_pagar: 250 } })

    const r = await LiquidacionesTercerosOcasionalSnapshotsService.revertir(id, snap.id, esc.creadorId)

    const fila = await prisma.liquidacion_tercero_ocasional.findUnique({ where: { id } })
    expect(fila?.estado).toBe('LIQUIDADA')
    expect(Number(fila?.total_pagar)).toBe(100)
    expect(r).toMatchObject({ estado_conservado: 'LIQUIDADA', estado_del_snapshot: 'APROBADA' })
  })

  it.each(['ANULADA', 'APROBADA', 'FACTURADA'])('no revierte una cabecera %s (409)', async (estado) => {
    const { id } = await crearOcasional('BORRADOR', 100)
    const snap = await LiquidacionesTercerosOcasionalSnapshotsService.capturar(id, {
      origen: 'manual',
      usuarioId: esc.adminId,
    })
    await prisma.liquidacion_tercero_ocasional.update({ where: { id }, data: { estado, total_pagar: 300 } })

    await expect(
      LiquidacionesTercerosOcasionalSnapshotsService.revertir(id, snap.id, esc.adminId),
    ).rejects.toMatchObject({ statusCode: 409 })
    const fila = await prisma.liquidacion_tercero_ocasional.findUnique({ where: { id } })
    expect(fila?.estado).toBe(estado)
    expect(Number(fila?.total_pagar)).toBe(300)
  })

  it('no revierte una cabecera en la papelera (404)', async () => {
    const { id } = await crearOcasional('BORRADOR', 100)
    const snap = await LiquidacionesTercerosOcasionalSnapshotsService.capturar(id, {
      origen: 'manual',
      usuarioId: esc.adminId,
    })
    await prisma.liquidacion_tercero_ocasional.update({ where: { id }, data: { deleted_at: new Date() } })

    await expect(
      LiquidacionesTercerosOcasionalSnapshotsService.revertir(id, snap.id, esc.adminId),
    ).rejects.toMatchObject({ statusCode: 404 })
  })
})

// ════════════════════════════════════════════════════════════════════════════
describe('Estado de la liquidación ocasional', () => {
  const ADMIN = ['administracion']
  const OPERACIONES = ['operaciones']

  it('un valor fuera de la lista es 400 y no toca la fila', async () => {
    const { id } = await crearOcasional('BORRADOR', 0)
    await expect(
      LiquidacionesTercerosOcasionalService.cambiarEstado(id, 'CUALQUIER COSA', esc.adminId, undefined, ADMIN),
    ).rejects.toMatchObject({ statusCode: 400, codigo: 'ESTADO_INVALIDO' })
    expect((await prisma.liquidacion_tercero_ocasional.findUnique({ where: { id } }))?.estado).toBe('BORRADOR')
  })

  it('aprobar es de Administración (403) y desde LIQUIDADA sí la aprueba', async () => {
    const { id } = await crearOcasional('LIQUIDADA', 0)
    await expect(
      LiquidacionesTercerosOcasionalService.cambiarEstado(id, 'APROBADA', esc.creadorId, undefined, OPERACIONES),
    ).rejects.toMatchObject({ statusCode: 403, codigo: 'SIN_PERMISO' })

    const r = await LiquidacionesTercerosOcasionalService.cambiarEstado(id, 'APROBADA', esc.adminId, undefined, ADMIN)
    expect(r.estado).toBe('APROBADA')
    expect(r.actualizado_por_id).toBe(esc.adminId)
  })

  it('a LIQUIDADA no se llega desde BORRADOR por esta ruta (409)', async () => {
    const { id } = await crearOcasional('BORRADOR', 0)
    await expect(
      LiquidacionesTercerosOcasionalService.cambiarEstado(id, 'LIQUIDADA', esc.adminId, undefined, ADMIN),
    ).rejects.toMatchObject({ statusCode: 409, codigo: 'TRANSICION_INVALIDA' })
  })

  it('una ANULADA no se reabre, ni por Administración (409)', async () => {
    const { id } = await crearOcasional('ANULADA', 0)
    await expect(
      LiquidacionesTercerosOcasionalService.cambiarEstado(id, 'BORRADOR', esc.adminId, undefined, ADMIN),
    ).rejects.toMatchObject({ statusCode: 409, codigo: 'TRANSICION_INVALIDA' })
  })

  it('anular exige motivo y lo guarda', async () => {
    const { id } = await crearOcasional('BORRADOR', 0)
    await expect(
      LiquidacionesTercerosOcasionalService.cambiarEstado(id, 'ANULADA', esc.creadorId, '', OPERACIONES),
    ).rejects.toMatchObject({ statusCode: 400, codigo: 'FALTA_MOTIVO' })

    const r = await LiquidacionesTercerosOcasionalService.cambiarEstado(
      id,
      'ANULADA',
      esc.creadorId,
      '  Duplicada  ',
      OPERACIONES,
    )
    expect(r.estado).toBe('ANULADA')
    expect(r.motivo_anulacion).toBe('Duplicada')
  })

  it('no actúa sobre una cabecera en la papelera (404)', async () => {
    const { id } = await crearOcasional('LIQUIDADA', 0)
    await prisma.liquidacion_tercero_ocasional.update({ where: { id }, data: { deleted_at: new Date() } })
    await expect(
      LiquidacionesTercerosOcasionalService.cambiarEstado(id, 'BORRADOR', esc.adminId, undefined, ADMIN),
    ).rejects.toMatchObject({ statusCode: 404, codigo: 'NO_ENCONTRADO' })
    expect((await prisma.liquidacion_tercero_ocasional.findUnique({ where: { id } }))?.estado).toBe('LIQUIDADA')
  })
})
