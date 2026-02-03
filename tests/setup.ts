import { PrismaClient } from '@prisma/client'
import { beforeAll, afterAll } from 'vitest'
import crypto from 'crypto'

const prisma = new PrismaClient()

// Setup antes de todos los tests
beforeAll(async () => {
  // Limpiar base de datos de test
  await prisma.respuestas_asistencia.deleteMany()
  await prisma.formularios_asistencia.deleteMany()
})

// Cleanup después de todos los tests
afterAll(async () => {
  await prisma.$disconnect()
})

/**
 * Función helper para obtener o crear usuario de test
 */
export async function getTestUser() {
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
