/**
 * Editar una planilla de recargos no destruye la versión anterior.
 *
 * `dias_laborales_planillas` y `detalles_recargos_dias` YA tenían `deleted_at`,
 * y las quince lecturas con `include` del proyecto YA lo filtraban: el código
 * estaba escrito para borrado lógico. Lo que no lo estaba era el guardado, que
 * hacía `deleteMany` de todos los días y los recreaba, y cuya cascada arrastraba
 * además los detalles. Cada edición destruía la anterior sin dejar rastro.
 *
 * El caso que decide todo es el tercero: la tabla tiene unicidad por
 * `(recargo_planilla_id, dia)`. Si esa restricción sigue siendo global, marcar
 * el día 15 y volver a crearlo CHOCA, y el guardado falla. Por eso la migración
 * la sustituye por una parcial que solo mira las filas activas.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const MARCA = 'ZZTEST-RECDIAS'

let planillaId: string
let conductorId: string
let vehiculoId: string
let empresaId: string

async function limpiar() {
  const pl = await prisma.recargos_planillas.findMany({
    where: { numero_planilla: { startsWith: MARCA } },
    select: { id: true }
  })
  const ids = pl.map((p) => p.id)
  if (ids.length) {
    const dias = await prisma.dias_laborales_planillas.findMany({
      where: { recargo_planilla_id: { in: ids } },
      select: { id: true }
    })
    await prisma.detalles_recargos_dias.deleteMany({
      where: { dia_laboral_id: { in: dias.map((d) => d.id) } }
    })
    await prisma.dias_laborales_planillas.deleteMany({ where: { recargo_planilla_id: { in: ids } } })
    await prisma.recargos_planillas.deleteMany({ where: { id: { in: ids } } })
  }
  await prisma.conductores.deleteMany({ where: { numero_identificacion: { startsWith: MARCA } } })
  await prisma.vehiculos.deleteMany({ where: { placa: { startsWith: 'ZZR' } } })
  await prisma.clientes.deleteMany({ where: { nombre: { startsWith: MARCA } } })
}

beforeAll(async () => {
  await limpiar()
  const now = new Date()

  conductorId = randomUUID()
  await prisma.conductores.create({
    data: {
      id: conductorId, nombre: 'Prueba', apellido: 'Recargos',
      tipo_identificacion: 'CC', numero_identificacion: `${MARCA}-1`,
      fecha_ingreso: now, cargo: 'CONDUCTOR', created_at: now, updated_at: now
    } as any
  })

  vehiculoId = randomUUID()
  await prisma.vehiculos.create({
    data: {
      id: vehiculoId, placa: 'ZZR001', clase_vehiculo: 'CAMIONETA',
      created_at: now, updated_at: now
    } as any
  })

  empresaId = randomUUID()
  /// `empresa_id` de la planilla referencia a `clientes`, no a un modelo
  /// `empresas`: el nombre de la columna despista.
  await prisma.clientes.create({
    data: {
      id: empresaId, nombre: `${MARCA} Empresa`, nit: `${MARCA}-NIT`,
      representante: 'X', cedula: '1', telefono: '1', direccion: 'X',
      createdAt: now, updatedAt: now
    } as any
  })

  planillaId = randomUUID()
  await prisma.recargos_planillas.create({
    data: {
      id: planillaId, conductor_id: conductorId, vehiculo_id: vehiculoId,
      empresa_id: empresaId, numero_planilla: `${MARCA}-001`,
      mes: 3, a_o: 2026, created_at: now, updated_at: now
    } as any
  })
}, 60_000)

afterAll(async () => {
  await limpiar()
  await prisma.$disconnect()
})

async function crearDia(dia: number) {
  const id = randomUUID()
  await prisma.dias_laborales_planillas.create({
    data: {
      id, recargo_planilla_id: planillaId, dia, total_horas: 8,
      created_at: new Date(), updated_at: new Date()
    } as any
  })
  return id
}

describe('Días de planilla de recargos · borrado lógico', () => {
  it('un día retirado SIGUE EXISTIENDO, marcado', async () => {
    const id = await crearDia(1)
    await prisma.dias_laborales_planillas.updateMany({
      where: { id, deleted_at: null },
      data: { deleted_at: new Date() }
    })

    /// Se busca la fila PRIMERO: un `not.toBeNull()` sobre el `undefined` de
    /// una fila destruida también pasaría, y el test no distinguiría marcar de
    /// borrar.
    const fila = await prisma.dias_laborales_planillas.findUnique({ where: { id } })
    expect(fila).not.toBeNull()
    expect(fila!.deleted_at).toBeInstanceOf(Date)
  })

  it('los detalles del día también se marcan: sin borrado físico no hay cascada', async () => {
    const diaId = await crearDia(2)
    const tipo = await prisma.tipos_recargos.findFirst({ select: { id: true } })
    if (!tipo) return // sin catálogo de tipos no aplica

    const detalleId = randomUUID()
    await prisma.detalles_recargos_dias.create({
      data: {
        id: detalleId, dia_laboral_id: diaId, tipo_recargo_id: tipo.id, horas: 3,
        created_at: new Date(), updated_at: new Date()
      } as any
    })

    const ahora = new Date()
    await prisma.detalles_recargos_dias.updateMany({
      where: { deleted_at: null, dias_laborales_planillas: { recargo_planilla_id: planillaId } },
      data: { deleted_at: ahora }
    })
    await prisma.dias_laborales_planillas.updateMany({
      where: { recargo_planilla_id: planillaId, deleted_at: null },
      data: { deleted_at: ahora }
    })

    const detalle = await prisma.detalles_recargos_dias.findUnique({ where: { id: detalleId } })
    expect(detalle).not.toBeNull()
    expect(detalle!.deleted_at).toBeInstanceOf(Date)

    const vivos = await prisma.detalles_recargos_dias.findMany({
      where: { dia_laboral_id: diaId, deleted_at: null }
    })
    expect(vivos).toHaveLength(0)
  })

  it('se puede volver a crear el MISMO día tras marcarlo', async () => {
    /// Este es el caso que exige el índice único parcial. Con la restricción
    /// global `(recargo_planilla_id, dia)`, la fila marcada seguiría ocupando
    /// el par y este `create` reventaría con P2002: el guardado de la planilla
    /// fallaría entero.
    const primero = await crearDia(15)
    await prisma.dias_laborales_planillas.updateMany({
      where: { id: primero },
      data: { deleted_at: new Date() }
    })

    const segundo = await crearDia(15)
    expect(segundo).not.toBe(primero)

    const activos = await prisma.dias_laborales_planillas.findMany({
      where: { recargo_planilla_id: planillaId, dia: 15, deleted_at: null }
    })
    expect(activos).toHaveLength(1)
    expect(activos[0].id).toBe(segundo)
  })
})
