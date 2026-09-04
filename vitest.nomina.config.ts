import { defineConfig } from 'vitest/config'
import { envDeTest } from './tests/env-test'

/**
 * Tests del cálculo de nómina.
 *
 * Como en `vitest.declaracion.config.ts`, aquí NO se carga `tests/setup.ts`:
 * ese setup abre una conexión Prisma real contra `DATABASE_URL` nada más
 * importarse y aborta si la base no parece desechable. Todo lo que hay bajo
 * `src/lib/nomina/` son funciones puras —aritmética de periodo y de
 * liquidación— y no debe tocar la base ni para saludarla.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // `.env.test` se inyecta ANTES de que los workers importen nada, para
    // ganarle al `dotenv.config()` de `src/config/env.ts`.
    env: envDeTest,
    include: ['src/lib/nomina/**/*.spec.ts'],
    setupFiles: []
  }
})
