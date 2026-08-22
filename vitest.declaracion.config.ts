import { defineConfig } from 'vitest/config'

/**
 * Configuración de los tests de la declaración de empresa de transporte.
 *
 * A diferencia de `vitest.config.ts`, aquí NO se carga `tests/setup.ts`: ese
 * setup abre una conexión Prisma real contra `DATABASE_URL` al importarse, y
 * esta suite no debe tocar ninguna base de datos — ni siquiera para
 * comprobar si responde. Prisma, S3 y el correo van mockeados en los tests
 * que los necesitan.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/declaracion-transporte/**/*.test.ts'],
    setupFiles: []
  }
})
