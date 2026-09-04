import { PrismaClient } from '@prisma/client'
import { beforeAll, afterAll } from 'vitest'
import crypto from 'crypto'
import { exigirBaseDesechable } from './guard-db'

// Antes de abrir siquiera la conexión: si la base no es desechable, no corremos.
exigirBaseDesechable()

let prisma: PrismaClient | null = null
try {
  prisma = new PrismaClient()
  // Verifica que la BD responda; si no, no fallamos los tests
  // que no dependen de Prisma (ej. generación de PDF SARLAFT).
  await prisma.$queryRaw`SELECT 1`
} catch (err) {
  console.warn(
    '[tests/setup] Prisma no disponible — los tests que no usen BD se ejecutarán normalmente.'
  )
  prisma = null
}

// Setup antes de todos los tests
beforeAll(async () => {
  if (!prisma) return
  // Limpiar base de datos de test
  exigirBaseDesechable()
  try {
    await prisma.respuestas_asistencia.deleteMany()
    await prisma.formularios_asistencia.deleteMany()
  } catch (err) {
    console.warn('[tests/setup] No se pudo limpiar BD de test:', err)
  }
})

// Cleanup después de todos los tests
afterAll(async () => {
  if (!prisma) return
  try {
    await prisma.$disconnect()
  } catch {}
})

/**
 * Función helper para obtener o crear usuario de test
 */
export async function getTestUser() {
  if (!prisma) throw new Error('Prisma no disponible en este entorno de test')
  const existingUser = await prisma.usuarios.findFirst({
    where: { correo: 'test@asistencias.com' }
  })

  if (existingUser) {
    return existingUser
  }

  // Crear nuevo usuario de test con todos los campos requeridos
  const newUser = await prisma.usuarios.create({
    data: {
      id: crypto.randomUUID(),
      nombre: 'Test User',
      correo: 'test@asistencias.com',
      password: 'hashedpassword123',
      role: 'admin',
      created_at: new Date(),
      updated_at: new Date()
    }
  })

  return newUser
}

export { prisma }
