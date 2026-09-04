/**
 * Reiniciar la aprobación de una acción correctiva no borra quién la aprobó.
 *
 * `resetAprobacion()` BORRABA la fila cuando cambiaba el tipo de hallazgo. La
 * intención es correcta —al cambiar el hallazgo cambia el rol que debe aprobar,
 * así que la aprobación anterior deja de valer—, pero el registro decía QUIÉN
 * aprobó, CUÁNDO y con qué comentario, y eso desaparecía sin rastro.
 *
 * Es la misma clase de dato que la firma de un desprendible: no un documento de
 * trabajo, sino la constancia de una decisión de una persona.
 *
 * El tercer caso es el que obliga al índice único parcial: si la archivada
 * siguiera ocupando su acción, el reset dejaría a esa acción SIN PODER
 * APROBARSE NUNCA MÁS.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const MARCA = 'ZZTEST-APR'

let accionId: string

async function limpiar() {
  const acc = await prisma.acciones_correctivas_preventivas.findMany({
    where: { descripcion_hallazgo: { startsWith: MARCA } },
    select: { id: true }
  })
  const ids = acc.map((a) => a.id)
  if (ids.length) {
    await prisma.aprobaciones_accion.deleteMany({ where: { accion_id: { in: ids } } })
    await prisma.acciones_correctivas_preventivas.deleteMany({ where: { id: { in: ids } } })
  }
}

beforeAll(async () => {
  await limpiar()
  accionId = randomUUID()
  await prisma.acciones_correctivas_preventivas.create({
    data: {
      id: accionId,
      accion_numero: `${MARCA}-001`,
      descripcion_hallazgo: `${MARCA} hallazgo`,
      created_at: new Date(),
      updated_at: new Date()
    } as any
  })
}, 60_000)

afterAll(async () => {
  await limpiar()
  await prisma.$disconnect()
})

async function crearAprobacion(comentario: string) {
  const id = randomUUID()
  await prisma.aprobaciones_accion.create({
    data: {
      id, accion_id: accionId, orden: 1, rol: 'HSEQ',
      estado: 'APROBADO', comentario,
      created_at: new Date(), updated_at: new Date()
    } as any
  })
  return id
}

describe('Aprobaciones de acciones correctivas · borrado lógico', () => {
  it('una aprobación reiniciada SIGUE EXISTIENDO, con su comentario', async () => {
    const id = await crearAprobacion('Aprobado por el jefe de HSEQ')
    await prisma.aprobaciones_accion.updateMany({
      where: { accion_id: accionId, deleted_at: null },
      data: { deleted_at: new Date() }
    })

    const fila = await prisma.aprobaciones_accion.findUnique({ where: { id } })
    expect(fila).not.toBeNull()
    expect(fila!.deleted_at).toBeInstanceOf(Date)
    /// Lo que antes se perdía: quién y por qué.
    expect(fila!.comentario).toBe('Aprobado por el jefe de HSEQ')
  })

  it('las lecturas no devuelven la archivada', async () => {
    const activa = await prisma.aprobaciones_accion.findFirst({
      where: { accion_id: accionId, deleted_at: null }
    })
    expect(activa).toBeNull()
  })

  it('la acción SE PUEDE VOLVER A APROBAR tras el reset', async () => {
    /// Con la unicidad global sobre `accion_id`, la fila archivada seguiría
    /// ocupando su acción y este `create` reventaría con P2002: la acción
    /// quedaría sin poder aprobarse nunca más.
    const nueva = await crearAprobacion('Aprobado por operaciones tras cambiar el hallazgo')

    const activas = await prisma.aprobaciones_accion.findMany({
      where: { accion_id: accionId, deleted_at: null }
    })
    expect(activas).toHaveLength(1)
    expect(activas[0].id).toBe(nueva)

    const todas = await prisma.aprobaciones_accion.findMany({ where: { accion_id: accionId } })
    expect(todas).toHaveLength(2)
  })
})
