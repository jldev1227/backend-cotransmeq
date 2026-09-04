import { defineConfig } from 'vitest/config'
import { envDeTest } from './tests/env-test'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // `.env.test` se inyecta ANTES de que los workers importen nada. Es la
    // única forma de ganarle al `dotenv.config()` de `src/config/env.ts`, que
    // cargaría `.env` al importarse.
    env: envDeTest,
    setupFiles: ['./tests/setup.ts'],
    // `dist/` contiene los mismos specs ya compilados a CommonJS. Vitest los
    // recogía y fallaban todos con «Vitest cannot be imported in a CommonJS
    // module»: 8 fallos que no eran de nadie, porque el test de verdad ya
    // corre desde `src/`. Se excluyen para que un `npm run build` previo no
    // ensucie el resultado de la suite.
    exclude: ['**/node_modules/**', '**/dist/**'],
    // Los archivos de test comparten UNA sola base y varios hacen
    // `deleteMany()` sin filtro en su `beforeAll`. Corriendo en paralelo se
    // borraban los datos entre ellos y el número de fallos cambiaba en cada
    // ejecución (37 → 36 → 35 sin tocar una línea). Una suite que no da el
    // mismo resultado dos veces no sirve para detectar regresiones, así que
    // los archivos van de uno en uno.
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        'tests/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/mockData'
      ]
    }
  }
})
