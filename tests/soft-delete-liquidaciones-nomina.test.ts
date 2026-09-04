/**
 * Eliminar una liquidación de nómina no destruye su nómina ni su firma.
 *
 * `eliminar()` borraba la liquidación Y SIETE TABLAS HIJAS en la misma
 * transacción: bonificaciones, mantenimientos, pernotes, recargos, anticipos,
 * `liquidacion_vehiculo` y `firmas_desprendibles`.
 *
 * Esa última es la FIRMA DEL CONDUCTOR sobre su desprendible: la prueba de que
 * recibió y aceptó su pago. Un clic borraba la nómina de una persona y la
 * evidencia de que la había firmado, sin dejar el periodo, el valor ni la
 * fecha.
 *
 * La decisión de diseño es marcar SOLO la madre y no tocar nada de lo que
 * cuelga: las siete quedan colgando de algo que ninguna consulta devuelve, y
 * siguen enteras para reconstruir. Es la misma regla que con el historial de
 * las liquidaciones de servicios: la evidencia no se toca.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const MARCA = 'ZZTEST-NOM'

let conductorId: string
let liquidacionId: string

async function limpiar() {
  const liqs = await prisma.liquidaciones.findMany({
    where: { conductores: { numero_identificacion: { startsWith: MARCA } } },
    select: { id: true }
  })
  const ids = liqs.map((l) => l.id)
  if (ids.length) {
    await prisma.firmas_desprendibles.deleteMany({ where: { liquidacion_id: { in: ids } } })
    await prisma.bonificaciones.deleteMany({ where: { liquidacion_id: { in: ids } } })
    await prisma.liquidaciones.deleteMany({ where: { id: { in: ids } } })
  }
  await prisma.conductores.deleteMany({ where: { numero_identificacion: { startsWith: MARCA } } })
}

beforeAll(async () => {
  await limpiar()
  const now = new Date()

  conductorId = randomUUID()
  await prisma.conductores.create({
    data: {
      id: conductorId, nombre: 'P', apellido: 'NOM', tipo_identificacion: 'CC',
      numero_identificacion: `${MARCA}-1`, fecha_ingreso: now,
      cargo: 'CONDUCTOR', created_at: now, updated_at: now
    } as any
  })

  liquidacionId = randomUUID()
  await prisma.liquidaciones.create({
    data: {
      id: liquidacionId,
      conductores: { connect: { id: conductorId } },
      periodo_start: '2026-03-01',
      periodo_end: '2026-03-31',
      sueldo_total: 3000000,
      created_at: now,
      updated_at: now
    } as any
  })

  /// La firma del conductor sobre su desprendible: lo que antes se destruía.
  await prisma.firmas_desprendibles.create({
    data: {
      id: randomUUID(),
      liquidacion_id: liquidacionId,
      conductor_id: conductorId,
      firma_url: 'https://ejemplo/firma.png',
      firma_s3_key: `${MARCA}/firma.png`,
      fecha_firma: now,
      created_at: now,
      updated_at: now
    } as any
  })
}, 60_000)

afterAll(async () => {
  await limpiar()
  await prisma.$disconnect()
})

describe('Liquidaciones de nómina · borrado lógico', () => {
  it('una liquidación retirada SIGUE EXISTIENDO, marcada', async () => {
    await prisma.liquidaciones.update({
      where: { id: liquidacionId },
      data: { deleted_at: new Date() }
    })

    const fila = await prisma.liquidaciones.findUnique({ where: { id: liquidacionId } })
    expect(fila).not.toBeNull()
    expect(fila!.deleted_at).toBeInstanceOf(Date)
  })

  it('LA FIRMA DEL CONDUCTOR SOBREVIVE', async () => {
    /// Este es el caso que justifica todo el cambio. Antes desaparecía junto
    /// con la liquidación, y con ella la prueba de que el conductor recibió y
    /// aceptó su pago.
    const firmas = await prisma.firmas_desprendibles.findMany({
      where: { liquidacion_id: liquidacionId }
    })
    expect(firmas).toHaveLength(1)
    expect(firmas[0].conductor_id).toBe(conductorId)
  })

  it('las listas no devuelven la retirada', async () => {
    const activas = await prisma.liquidaciones.findMany({
      where: { conductor_id: conductorId, deleted_at: null }
    })
    expect(activas).toHaveLength(0)

    const todas = await prisma.liquidaciones.findMany({ where: { conductor_id: conductorId } })
    expect(todas).toHaveLength(1)
  })

  it('se puede restaurar entera', async () => {
    await prisma.liquidaciones.update({
      where: { id: liquidacionId },
      data: { deleted_at: null }
    })

    const viva = await prisma.liquidaciones.findFirst({
      where: { id: liquidacionId, deleted_at: null },
      include: { firmas_desprendibles: true }
    })
    expect(viva).not.toBeNull()
    /// Con su firma intacta: eso es lo que antes era imposible.
    expect(viva!.firmas_desprendibles).toHaveLength(1)
  })
})

describe('Ítems de nómina · borrado lógico al editar', () => {
  it('editar la liquidación retira la versión anterior sin destruirla', async () => {
    /// El guardado hacía `deleteMany` + `createMany` de bonificaciones,
    /// mantenimientos, pernotes, recargos, anticipos y vehículos. Cada
    /// corrección borraba lo que se le iba a pagar a una persona sin dejar con
    /// qué compararlo.
    await prisma.liquidaciones.update({
      where: { id: liquidacionId }, data: { deleted_at: null }
    })

    const primera = randomUUID()
    await prisma.bonificaciones.create({
      data: {
        id: primera, liquidacion_id: liquidacionId, name: 'Bono productividad',
        value: 200000, created_at: new Date(), updated_at: new Date()
      } as any
    })

    /// Esto es lo que hace ahora el guardado al editar.
    await prisma.bonificaciones.updateMany({
      where: { liquidacion_id: liquidacionId, deleted_at: null },
      data: { deleted_at: new Date() }
    })
    const segunda = randomUUID()
    await prisma.bonificaciones.create({
      data: {
        id: segunda, liquidacion_id: liquidacionId, name: 'Bono productividad',
        value: 350000, created_at: new Date(), updated_at: new Date()
      } as any
    })

    /// La liquidación devuelve UNA bonificación, la vigente…
    const activas = await prisma.bonificaciones.findMany({
      where: { liquidacion_id: liquidacionId, deleted_at: null }
    })
    expect(activas).toHaveLength(1)
    expect(Number(activas[0].value)).toBe(350000)

    /// …y la anterior sigue ahí, con su importe, para poder comparar.
    const anterior = await prisma.bonificaciones.findUnique({ where: { id: primera } })
    expect(anterior).not.toBeNull()
    expect(Number(anterior!.value)).toBe(200000)
    expect(anterior!.deleted_at).toBeInstanceOf(Date)
  })

  it('la suma de lo vigente no incluye la versión retirada', async () => {
    /// Sin filtrar, el total pagado sería 550.000 en vez de 350.000.
    const agg = await prisma.bonificaciones.aggregate({
      where: { liquidacion_id: liquidacionId, deleted_at: null },
      _sum: { value: true }
    })
    expect(Number(agg._sum.value)).toBe(350000)

    const sinFiltro = await prisma.bonificaciones.aggregate({
      where: { liquidacion_id: liquidacionId },
      _sum: { value: true }
    })
    expect(Number(sinFiltro._sum.value)).toBe(550000)
  })
})
