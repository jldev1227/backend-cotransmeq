/**
 * IDs determinísticos para las semillas (UUID v5).
 *
 * ¿Por qué determinísticos? Porque la carga la ejecuta el usuario, posiblemente
 * más de una vez y en más de un entorno. Con `randomUUID()`, cargar dos veces la
 * misma semilla crearía dos formularios distintos con el mismo código HSEQ —y el
 * segundo `INSERT` fallaría por `uq_form_definitions_code` dejando la mitad
 * dentro—. Con UUID v5 derivado de `code + revisión + ruta del nodo`, el mismo
 * artefacto produce siempre los mismos ids y la carga es idempotente por
 * `ON CONFLICT DO NOTHING`.
 *
 * Se implementa aquí en vez de añadir la dependencia `uuid`: son veinte líneas,
 * el algoritmo está fijado por la RFC 4122 y no cambia.
 */

import { createHash } from 'crypto'

/**
 * Namespace propio del módulo.
 *
 * Es un UUID v4 fijo, generado una vez y escrito a mano a propósito: si se
 * generara al azar en cada arranque, los ids dejarían de ser determinísticos, que
 * es justamente lo que se busca. NO cambiar — cambiarlo reasigna todos los ids de
 * todas las semillas.
 */
export const SEED_NAMESPACE = '6b1f2a52-9c3e-4d7a-8f61-2b0d4e9a17c8'

function parseUuid(uuid: string): Buffer {
	const hex = uuid.replace(/-/g, '')
	if (hex.length !== 32) throw new Error(`UUID inválido: ${uuid}`)
	return Buffer.from(hex, 'hex')
}

/**
 * UUID v5 (SHA-1) según RFC 4122.
 *
 * v5 y no v3 porque MD5 está desaconsejado; aquí no hay requisito criptográfico
 * —solo determinismo— pero no hay motivo para usar el peor de los dos.
 */
export function uuidv5(name: string, namespace: string = SEED_NAMESPACE): string {
	const hash = createHash('sha1').update(parseUuid(namespace)).update(Buffer.from(name, 'utf8')).digest()

	const bytes = Buffer.from(hash.subarray(0, 16))
	/// Versión 5: los 4 bits altos del byte 6 valen 0101.
	bytes[6] = (bytes[6] & 0x0f) | 0x50
	/// Variante RFC 4122: los 2 bits altos del byte 8 valen 10.
	bytes[8] = (bytes[8] & 0x3f) | 0x80

	const hex = bytes.toString('hex')
	return [
		hex.slice(0, 8),
		hex.slice(8, 12),
		hex.slice(12, 16),
		hex.slice(16, 20),
		hex.slice(20, 32)
	].join('-')
}

/**
 * Ids de los nodos de una semilla.
 *
 * La `revision` entra en la semilla del hash: si HSEQ publica una revisión nueva
 * del documento, los ids cambian y la carga crea una versión nueva en vez de
 * pisar la anterior —que puede tener envíos colgando—.
 */
export function seedIds(code: string, revision: string) {
	const raiz = `${code}@${revision}`
	return {
		form: uuidv5(`form:${code}`),
		/// El formulario NO lleva revisión: su identidad es el código HSEQ y
		/// sobrevive a todas sus versiones.
		version: uuidv5(`version:${raiz}`),
		section: (sectionKey: string) => uuidv5(`section:${raiz}:${sectionKey}`),
		field: (fieldKey: string) => uuidv5(`field:${raiz}:${fieldKey}`),
		option: (fieldKey: string, value: string) => uuidv5(`option:${raiz}:${fieldKey}:${value}`)
	}
}

export type SeedIds = ReturnType<typeof seedIds>
