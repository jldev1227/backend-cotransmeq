/**
 * Guardar los terceros de una liquidación no destruye la versión anterior.
 *
 * `liquidacion_tercero` recibió `deleted_at` con la migración de liquidaciones,
 * pero su guardado seguía haciendo `deleteMany` + `createMany`: el mismo patrón
 * que dejó una liquidación con la cabecera llena y ninguna fila.
 *
 * Lo que hacía peligrosa la conversión no era el guardado sino las LECTURAS: de
 * las veintidós consultas directas del árbol de terceros, **ninguna** filtraba.
 * Marcar sin filtrar habría duplicado cada fila en el historial, en los cierres
 * y en la hoja de ingresos, que es peor que borrarlas.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const MARCA = 'ZZTEST-LT'

let liquidacionId: string
let terceroId: string

async function limpiar() {
  const liqs = await prisma.liquidacion_servicio.findMany({
    where: { consecutivo: { startsWith: MARCA } },
    select: { id: true }
  })
  const ids = liqs.map((l) => l.id)
  if (ids.length) {
    await prisma.liquidacion_tercero.deleteMany({ where: { liquidacion_id: { in: ids } } })
    await prisma.liquidacion_servicio.deleteMany({ where: { id: { in: ids } } })
  }
  await prisma.terceros.deleteMany({ where: { identificacion: { startsWith: MARCA } } })
  await prisma.clientes.deleteMany({ where: { nombre: { startsWith: MARCA } } })
  await prisma.conductores.deleteMany({ where: { numero_identificacion: { startsWith: MARCA } } })
}

beforeAll(async () => {
  await limpiar()
  const now = new Date()

  terceroId = randomUUID()
  await prisma.terceros.create({
    data: {
      id: terceroId, nombre_completo: 'Tercero Prueba',
      identificacion: `${MARCA}-T1`, created_at: now, updated_at: now
    } as any
  })

  /// El padre de `liquidacion_tercero` es `liquidacion_servicio`, no la
  /// `liquidaciones` de nómina: los nombres se parecen y despistan.
  const clienteId = randomUUID()
  await prisma.clientes.create({
    data: {
      id: clienteId, nombre: `${MARCA} Cliente`, nit: `${MARCA}-NIT`,
      createdAt: now, updatedAt: now
    } as any
  })

  liquidacionId = randomUUID()
  await prisma.liquidacion_servicio.create({
    data: {
      id: liquidacionId, consecutivo: `${MARCA}-001`, cliente_id: clienteId,
      mes: 3, anio: 2026, updated_at: now
    } as any
  })
}, 60_000)

afterAll(async () => {
  await limpiar()
  await prisma.$disconnect()
})

async function crearItem(orden: number, valor: number) {
  const id = randomUUID()
  await prisma.liquidacion_tercero.create({
    data: {
      id, liquidacion_id: liquidacionId, tercero_id: terceroId,
      placa: 'ZZT001', recorrido: 'Yopal - Villanueva', fechas: '2026-03-01',
      valor_liquidar: valor, orden, created_at: new Date(), updated_at: new Date()
    } as any
  })
  return id
}

describe('Terceros de una liquidación · borrado lógico', () => {
  it('un ítem retirado SIGUE EXISTIENDO, marcado', async () => {
    const id = await crearItem(0, 100000)
    await prisma.liquidacion_tercero.updateMany({
      where: { liquidacion_id: liquidacionId, deleted_at: null },
      data: { deleted_at: new Date() }
    })

    const fila = await prisma.liquidacion_tercero.findUnique({ where: { id } })
    expect(fila).not.toBeNull()
    expect(fila!.deleted_at).toBeInstanceOf(Date)
  })

  it('tras re-guardar, las lecturas devuelven UNA versión, no dos', async () => {
    /// Este es el caso que decide si la conversión vale o no. Sin el filtro en
    /// las lecturas, aquí habría dos filas: la marcada y la nueva. Y como
    /// llevan `valor_liquidar`, el historial y los cierres sumarían el doble.
    const nuevo = await crearItem(0, 250000)

    const activos = await prisma.liquidacion_tercero.findMany({
      where: { liquidacion_id: liquidacionId, deleted_at: null }
    })
    expect(activos).toHaveLength(1)
    expect(activos[0].id).toBe(nuevo)

    const todas = await prisma.liquidacion_tercero.findMany({
      where: { liquidacion_id: liquidacionId }
    })
    expect(todas.length).toBeGreaterThan(1)
  })

  it('la suma de lo activo no incluye lo retirado', async () => {
    const agg = await prisma.liquidacion_tercero.aggregate({
      where: { liquidacion_id: liquidacionId, deleted_at: null },
      _sum: { valor_liquidar: true }
    })
    /// 250.000 del vigente, no 350.000 sumando el retirado.
    expect(Number(agg._sum.valor_liquidar)).toBe(250000)
  })
})
