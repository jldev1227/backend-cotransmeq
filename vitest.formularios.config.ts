/**
 * Config de vitest para el dominio de formularios dinámicos.
 *
 * Existe solo para NO cargar `tests/setup.ts`, que abre una `PrismaClient` y
 * hace `SELECT 1` contra la base configurada en `DATABASE_URL`. Los tests del
 * dominio son puros y no deben abrir ninguna conexión, ni siquiera de lectura.
 *
 *   npm run test:formularios
 */
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/formularios-dinamicos-*.test.ts'],
  },
})
