/**
 * Eliminar un certificado tributario no borra la constancia de que se envió.
 *
 * `deleteCertificado()` destruía tres cosas de golpe: el archivo, los vínculos
 * con los terceros a los que se emitió, y los `certificacion_envio` —el
 * registro de CUÁNDO y A QUIÉN se envió—.
 *
 * Ese último es evidencia de entrega de un documento tributario. Sin él, la
 * empresa no puede demostrar que lo mandó ante un tercero que diga no haberlo
 * recibido.
 *
 * El archivo de S3 sí se borra: la función devuelve su `s3_key` para eso. Lo
 * que se conserva es la constancia de que existió y de a quién se entregó.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const MARCA = 'ZZTEST-CERT'

let terceroId: string
let certificadoId: string

async function limpiar() {
  const arch = await prisma.certificado_archivo.findMany({
    where: { s3_key: { startsWith: MARCA } }, select: { id: true }
  })
  const ids = arch.map((a) => a.id)
  if (ids.length) {
    await prisma.certificacion_envio.deleteMany({ where: { certificado_id: { in: ids } } })
    await prisma.certificado_tercero.deleteMany({ where: { certificado_id: { in: ids } } })
    await prisma.certificado_archivo.deleteMany({ where: { id: { in: ids } } })
  }
  await prisma.terceros.deleteMany({ where: { identificacion: { startsWith: MARCA } } })
}

beforeAll(async () => {
  await limpiar()
  const now = new Date()

  terceroId = randomUUID()
  await prisma.terceros.create({
    data: {
      id: terceroId, nombre_completo: 'Tercero Cert',
      identificacion: `${MARCA}-T1`, created_at: now, updated_at: now
    } as any
  })

  certificadoId = randomUUID()
  await prisma.certificado_archivo.create({
    data: {
      id: certificadoId, s3_key: `${MARCA}/2026/retefuente.pdf`,
      filename: 'retefuente.pdf', nit: `${MARCA}-NIT`, anio: 2026,
      tipo: 'RETEFUENTE', tercero_id: terceroId,
      created_at: now, updated_at: now
    } as any
  })
  await prisma.certificado_tercero.create({
    data: { id: randomUUID(), tercero_id: terceroId, certificado_id: certificadoId } as any
  })
  await prisma.certificacion_envio.create({
    data: {
      id: randomUUID(), tercero_id: terceroId, certificado_id: certificadoId,
      token_acceso: `${MARCA}-token`, email_destino: 'tercero@ejemplo.com',
      created_at: now
    } as any
  })
}, 60_000)

afterAll(async () => {
  await limpiar()
  await prisma.$disconnect()
})

describe('Certificados tributarios · borrado lógico', () => {
  it('retirar un certificado marca las tres tablas', async () => {
    const ahora = new Date()
    await prisma.certificado_tercero.updateMany({
      where: { certificado_id: certificadoId, deleted_at: null }, data: { deleted_at: ahora }
    })
    await prisma.certificacion_envio.updateMany({
      where: { certificado_id: certificadoId, deleted_at: null }, data: { deleted_at: ahora }
    })
    await prisma.certificado_archivo.update({
      where: { id: certificadoId }, data: { deleted_at: ahora }
    })

    const arch = await prisma.certificado_archivo.findUnique({ where: { id: certificadoId } })
    expect(arch).not.toBeNull()
    expect(arch!.deleted_at).toBeInstanceOf(Date)
  })

  it('LA CONSTANCIA DE ENVÍO SOBREVIVE, con su destinatario', async () => {
    /// Esto es lo que justifica el cambio: sin ello no se puede demostrar que
    /// el certificado se envió.
    const envios = await prisma.certificacion_envio.findMany({
      where: { certificado_id: certificadoId }
    })
    expect(envios).toHaveLength(1)
    expect(envios[0].email_destino).toBe('tercero@ejemplo.com')
  })

  it('las listas no devuelven lo retirado', async () => {
    const vivos = await prisma.certificado_archivo.findMany({
      where: { tercero_id: terceroId, deleted_at: null }
    })
    expect(vivos).toHaveLength(0)
  })

  it('se puede volver a emitir el MISMO certificado al MISMO tercero', async () => {
    /// Con la unicidad global sobre `(tercero_id, certificado_id)`, el vínculo
    /// archivado seguiría ocupando el par y este `create` reventaría: el
    /// tercero se quedaría sin poder recibir ese certificado nunca más.
    const nuevo = randomUUID()
    await prisma.certificado_tercero.create({
      data: { id: nuevo, tercero_id: terceroId, certificado_id: certificadoId } as any
    })

    const activos = await prisma.certificado_tercero.findMany({
      where: { certificado_id: certificadoId, deleted_at: null }
    })
    expect(activos).toHaveLength(1)
    expect(activos[0].id).toBe(nuevo)
  })
})
