/**
 * Carga el entorno de la suite y lo entrega a Vitest.
 *
 * Vive aquí y no dentro de cada `vitest.*.config.ts` porque hay cuatro configs
 * (general, formularios, nómina, declaración) y las cuatro deben apuntar a la
 * MISMA base desechable. Cuando esto estaba duplicado bastaba con olvidar una
 * para que esa suite corriera contra lo que hubiera en `.env` — que hoy es
 * producción.
 *
 * `override: true` es deliberado: `.env.test` manda sobre `.env`. La suite no
 * puede depender de qué DATABASE_URL esté activa en ese momento; el 28-ago-2026
 * esa dependencia costó 2042 respuestas de asistencia borradas.
 */

import { config } from 'dotenv'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const RUTA_ENV_TEST = resolve(__dirname, '../.env.test')

export function cargarEnvDeTest(): Record<string, string> {
	if (!existsSync(RUTA_ENV_TEST)) {
		throw new Error(
			`\n\n  Falta ${RUTA_ENV_TEST}\n\n` +
				`  Sin él la suite correría con el .env de desarrollo, que apunta a\n` +
				`  producción. Se versiona en el repo; si no está, recupéralo con git.\n`
		)
	}

	const { parsed, error } = config({ path: RUTA_ENV_TEST, override: true })
	if (error) throw error

	return parsed ?? {}
}

/**
 * Lo que se le pasa a `test.env` en la config de Vitest. Vitest lo inyecta en
 * `process.env` de cada worker ANTES de importar nada, que es la única forma de
 * ganarle al `dotenv.config()` que `src/config/env.ts` ejecuta al importarse.
 */
export const envDeTest = cargarEnvDeTest()
