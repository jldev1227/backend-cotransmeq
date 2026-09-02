import { PrismaClient } from '@prisma/client'
import { beforeAll, afterAll } from 'vitest'
import crypto from 'crypto'

const prisma = new PrismaClient()

/**
 * Comprueba que la base contra la que se va a borrar es de pruebas.
 *
 * El `beforeAll` de aquí abajo corre en CADA archivo de test y hace
 * `deleteMany()` sin ningún filtro. Con la `DATABASE_URL` de producción en el
 * entorno —que es lo normal, está en el `.env` que carga el proyecto— un
 * `npm test` borra los formularios de asistencia reales. Ya pasó: se
 * perdieron 87.
 *
 * Se exige que el host sea local o que el nombre de la base diga `test`. Si no,
 * se aborta antes de tocar nada en vez de avisar por consola, porque un aviso
 * en medio del ruido de vitest no lo lee nadie.
 */
function exigirBaseDePruebas(): void {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('[tests] No hay DATABASE_URL. Define una base de pruebas antes de correr los tests.')

  let host: string
  let nombre: string
  try {
    const u = new URL(url)
    host = u.hostname
    nombre = u.pathname.replace(/^\//, '')
  } catch {
    throw new Error('[tests] DATABASE_URL no es una URL válida.')
  }

  const esLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1'
  const diceTest = /test/i.test(nombre)
  if (!esLocal && !diceTest) {
    throw new Error(
      `[tests] ABORTADO: la DATABASE_URL apunta a "${nombre}" en ${host}, que no parece una base de pruebas.\n` +
        `        El setup de tests borra formularios_asistencia y respuestas_asistencia SIN filtro.\n` +
        `        Usa un host local o una base cuyo nombre contenga "test".`
    )
  }
}

// Setup antes de todos los tests
beforeAll(async () => {
  exigirBaseDePruebas()
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
