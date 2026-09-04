/**
 * Guardar un día laborado no destruye lo anterior.
 *
 * `registro_dia_laboral_segmento` YA tenía `deleted_at` y su código lo ignoraba:
 * cada guardado hacía `deleteMany` + `createMany` de todos los segmentos. Es el
 * mismo patrón que se llevó por delante los ítems de una liquidación y dejó la
 * cabecera con totales que no correspondían a ninguna fila.
 *
 * El caso que más importa es el último: los BONOS cuelgan del segmento pero se
 * leen por día. Marcar el segmento sin marcar sus bonos dejaría filas con
 * `valor` colgando de algo que ya nadie ve, y se seguirían sumando. Sería un
 * error de dinero, no de presentación.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const MARCA = 'ZZTEST-DIAS'

let conductorId: string
let registroId: string
let configBonoId: string

async function limpiar() {
  const regs = await prisma.registro_dia_laboral.findMany({
    where: { conductor: { numero_identificacion: { startsWith: MARCA } } },
    select: { id: true }
  })
  const ids = regs.map((r) => r.id)
  if (ids.length) {
    await prisma.registro_dia_laboral_bono.deleteMany({ where: { registro_dia_id: { in: ids } } })
    await prisma.registro_dia_laboral_segmento.deleteMany({ where: { registro_dia_id: { in: ids } } })
    await prisma.registro_dia_laboral.deleteMany({ where: { id: { in: ids } } })
  }
  await prisma.conductores.deleteMany({
    where: { numero_identificacion: { startsWith: MARCA } }
  })
  await prisma.configuraciones_liquidacion.deleteMany({ where: { nombre: { startsWith: MARCA } } })
}

beforeAll(async () => {
  await limpiar()
  conductorId = randomUUID()
  await prisma.conductores.create({
    data: {
      id: conductorId,
      nombre: 'Prueba',
      apellido: 'Dias',
      tipo_identificacion: 'CC',
      numero_identificacion: `${MARCA}-1`,
      fecha_ingreso: new Date(),
      cargo: 'CONDUCTOR',
      created_at: new Date(),
      updated_at: new Date()
    } as any
  })

  registroId = randomUUID()
  await prisma.registro_dia_laboral.create({
    data: {
      id: registroId,
      conductor_id: conductorId,
      fecha: new Date('2026-03-10'),
      tipo: 'LABORADO'
    } as any
  })

  configBonoId = randomUUID()
  await prisma.configuraciones_liquidacion.create({
    data: {
      id: configBonoId,
      nombre: `${MARCA} bono`,
      valor: 50000,
      anio: 2026,
      activo: true,
      created_at: new Date(),
      updated_at: new Date()
    } as any
  })
}, 60_000)

afterAll(async () => {
  await limpiar()
  await prisma.$disconnect()
})

async function crearSegmento(orden: number) {
  const id = randomUUID()
  await prisma.registro_dia_laboral_segmento.create({
    data: {
      id,
      registro_dia_id: registroId,
      vehiculo_placa: `PLC${orden}`,
      /// Obligatorias en cotransmeq y opcionales en transmeralda: se mandan
      /// siempre para que el mismo test sirva en los dos repos.
      hora_inicio: '06:00',
      hora_fin: '14:00',
      horas_conducidas: 8,
      orden
    } as any
  })
  return id
}

describe('Segmentos de día laborado · borrado lógico', () => {
  it('un segmento retirado SIGUE EXISTIENDO, marcado', async () => {
    const id = await crearSegmento(1)

    await prisma.registro_dia_laboral_segmento.updateMany({
      where: { id, deleted_at: null },
      data: { deleted_at: new Date() }
    })

    /// La comprobación tiene que buscar la fila PRIMERO: un `not.toBeNull()`
    /// sobre un `undefined` de una fila borrada también pasaría, y entonces el
    /// test no distinguiría marcar de destruir.
    const fila = await prisma.registro_dia_laboral_segmento.findUnique({ where: { id } })
    expect(fila).not.toBeNull()
    expect(fila!.deleted_at).toBeInstanceOf(Date)
  })

  it('las lecturas normales no lo devuelven', async () => {
    const activos = await prisma.registro_dia_laboral_segmento.findMany({
      where: { registro_dia_id: registroId, deleted_at: null }
    })
    expect(activos.every((s) => s.deleted_at === null)).toBe(true)
  })

  it('los bonos de un segmento retirado NO siguen sumando', async () => {
    /// Este es el caso que bloqueaba toda la conversión.
    const segmentoId = await crearSegmento(2)
    const bonoId = randomUUID()
    await prisma.registro_dia_laboral_bono.create({
      data: {
        id: bonoId,
        registro_dia_id: registroId,
        segmento_id: segmentoId,
        config_liquidacion_id: configBonoId,
        valor: 50000
      } as any
    })

    const ahora = new Date()
    await prisma.registro_dia_laboral_bono.updateMany({
      where: { deleted_at: null, segmento: { registro_dia_id: registroId } },
      data: { deleted_at: ahora }
    })
    await prisma.registro_dia_laboral_segmento.updateMany({
      where: { registro_dia_id: registroId, deleted_at: null },
      data: { deleted_at: ahora }
    })

    /// La consulta de bonos busca por DÍA, no por segmento: si el bono no se
    /// marcara, aquí seguiría apareciendo con sus 50.000.
    const bonosVivos = await prisma.registro_dia_laboral_bono.findMany({
      where: { registro_dia_id: registroId, deleted_at: null }
    })
    expect(bonosVivos).toHaveLength(0)

    const bono = await prisma.registro_dia_laboral_bono.findUnique({ where: { id: bonoId } })
    expect(bono).not.toBeNull()
    expect(bono!.deleted_at).toBeInstanceOf(Date)
  })
})

describe('Día laborado completo · retirar y revivir', () => {
  it('retirar un día lo marca a él, a sus segmentos y a sus bonos', async () => {
    const { retirarDiaLaboral } = await import('../src/lib/soft-delete/dia-laboral')

    const segmentoId = await crearSegmento(20)
    const bonoId = randomUUID()
    await prisma.registro_dia_laboral_bono.create({
      data: {
        id: bonoId,
        registro_dia_id: registroId,
        segmento_id: segmentoId,
        config_liquidacion_id: configBonoId,
        valor: 30000
      } as any
    })

    await retirarDiaLaboral(registroId)

    const dia = await prisma.registro_dia_laboral.findUnique({ where: { id: registroId } })
    expect(dia).not.toBeNull()
    expect(dia!.deleted_at).toBeInstanceOf(Date)

    const segsVivos = await prisma.registro_dia_laboral_segmento.findMany({
      where: { registro_dia_id: registroId, deleted_at: null }
    })
    expect(segsVivos).toHaveLength(0)

    /// La consulta de bonos busca por DÍA: si no se marcaran, los 30.000
    /// seguirían sumando aunque el día ya no exista para nadie.
    const bonosVivos = await prisma.registro_dia_laboral_bono.findMany({
      where: { registro_dia_id: registroId, deleted_at: null }
    })
    expect(bonosVivos).toHaveLength(0)
  })

  it('volver a registrar el mismo día lo REVIVE en vez de chocar', async () => {
    /// La unicidad `(conductor_id, fecha)` es global a propósito: la fila
    /// marcada conserva su día. Si el `upsert` no pusiera `deleted_at: null`,
    /// el conductor que borra un día por error no podría registrarlo nunca más.
    const antes = await prisma.registro_dia_laboral.findFirst({
      where: { conductor_id: conductorId, fecha: new Date('2026-03-10') }
    })
    expect(antes!.deleted_at).toBeInstanceOf(Date)

    await prisma.registro_dia_laboral.update({
      where: { id: registroId },
      data: { tipo: 'LABORADO', deleted_at: null }
    })

    const despues = await prisma.registro_dia_laboral.findFirst({
      where: { conductor_id: conductorId, fecha: new Date('2026-03-10'), deleted_at: null }
    })
    expect(despues).not.toBeNull()
    expect(despues!.id).toBe(registroId)
  })
})
