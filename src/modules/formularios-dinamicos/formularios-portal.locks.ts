/**
 * Exclusión mutua del portal: claves de lock y orden de adquisición.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  ORDEN GLOBAL DE LOCKS — respetarlo es lo que evita deadlocks
 *
 *   1. advisory  clase IDEMPOTENCIA  →  hash32(clientSubmissionId)
 *   2. advisory  clase LIMITE        →  hash32(clave lógica de límite)
 *   3. fila       form_submissions   →  SELECT ... FOR UPDATE
 *
 *  Toda transacción que necesite varios adquiere SIEMPRE en ese orden, y nunca
 *  suelta uno para tomar otro. Quien necesite solo el (3) puede tomarlo sin más:
 *  un proceso que retiene un único recurso y no espera ninguno no puede formar
 *  un ciclo.
 *
 *  Quién toma qué:
 *
 *   - `enviarSubmission`  → 1, luego 2 (si la política lo exige), luego 3 (si el
 *                           borrador ya existe).
 *   - `iniciarAdjunto`    → 3.
 *   - `completarAdjunto`  → 3.
 *   - `descartarAdjunto`  → 3.
 *   - `guardarBorrador`   → 3 (si el borrador ya existe).
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * **Se usa la forma de DOS argumentos de `pg_advisory_xact_lock`.** No es un
 * detalle estético: Postgres guarda `pg_advisory_xact_lock(bigint)` y
 * `pg_advisory_xact_lock(int4, int4)` en espacios de lock distintos (el
 * `locktag` los diferencia). Este repositorio ya usa la forma de un argumento en
 * `liquidaciones-terceros-descuentos`, así que con la de dos argumentos los locks
 * de este módulo NO pueden colisionar con los de ese, ni las dos familias entre
 * sí aunque sus hashes coincidan.
 */

import { createHash } from 'crypto'
import type { Prisma } from '@prisma/client'

/** Cliente transaccional. Solo se usa la parte de SQL crudo. */
type Tx = Prisma.TransactionClient

/**
 * Clases de lock del módulo.
 *
 * El `classid` separa las familias: `(1, k)` y `(2, k)` son locks distintos
 * aunque `k` sea el mismo. Eso vuelve estructuralmente imposible el deadlock
 * cruzado entre idempotencia y límite, sin depender de que dos SHA-1 truncados
 * no coincidan nunca.
 *
 * Los números son arbitrarios pero FIJOS: cambiarlos en caliente haría que una
 * versión nueva del servidor no viera los locks de la vieja durante el despliegue.
 */
export const LOCK_CLASS = {
	/** Un `client_submission_id`: serializa los reintentos del MISMO envío. */
	IDEMPOTENCIA: 918_401,
	/** Una clave lógica de límite: serializa envíos DISTINTOS que compiten por él. */
	LIMITE: 918_402
} as const

/**
 * Hash de 31 bits de una cadena, para el `objid` de un advisory lock.
 *
 * `int4` de Postgres es firmado; se fuerza el bit alto a cero para no tener que
 * razonar sobre negativos en los logs de `pg_locks`. Perder un bit de 32 no
 * cambia nada: una colisión solo provoca una serialización de más, nunca una
 * de menos, y eso es seguro por definición.
 */
export function hashLock32(value: string): number {
	const digest = createHash('sha1').update(value).digest()
	return digest.readUInt32BE(0) & 0x7fffffff
}

/**
 * Adquiere un advisory lock transaccional.
 *
 * Se libera solo, al COMMIT o al ROLLBACK: no hay forma de olvidarse de
 * soltarlo, que es la razón de usar `_xact_` y no `pg_advisory_lock`.
 */
export async function advisoryLock(tx: Tx, classId: number, objId: number): Promise<void> {
	await tx.$executeRaw`SELECT pg_advisory_xact_lock(${classId}::int4, ${objId}::int4)`
}

/** Lock de idempotencia: paso 1 del orden global. */
export async function lockIdempotencia(tx: Tx, clientSubmissionId: string): Promise<number> {
	const objId = hashLock32(`forms-idem:v1:${clientSubmissionId}`)
	await advisoryLock(tx, LOCK_CLASS.IDEMPOTENCIA, objId)
	return objId
}

// ─────────────────────────────────────────────────────────────────────────────
// Clave lógica de límite
// ─────────────────────────────────────────────────────────────────────────────

export interface LimiteLockParams {
	assignmentId: string
	conductorId: string
	limitPolicy: string
	frequency: string
	/** Ya resuelto con la zona de la asignación. `null` en ON_DEMAND/PER_SERVICE. */
	periodKey: string | null
	contexto: Record<string, unknown>
}

/**
 * Clave canónica del límite, o `null` si esta combinación no tiene límite.
 *
 * Tiene que coincidir EXACTAMENTE con lo que consulta `verificarLimite`: si la
 * clave del lock y el criterio de la consulta no describen el mismo conjunto, el
 * lock serializa una cosa y la comprobación mira otra, y la carrera sigue abierta.
 *
 * Se construye con separadores explícitos y un prefijo de versión, no con
 * `JSON.stringify` sobre un objeto: el orden de las claves de un objeto no está
 * garantizado entre motores, y dos representaciones distintas de la misma clave
 * producirían dos locks distintos.
 */
export function claveLimite(params: LimiteLockParams): string | null {
	const { limitPolicy, frequency, periodKey, assignmentId, conductorId } = params

	/// `UNLIMITED` sin `ONCE` no tiene límite que proteger: tomar el lock ahí
	/// serializaría sin motivo a todos los conductores de una asignación a demanda.
	if (limitPolicy === 'UNLIMITED' && frequency !== 'ONCE') return null

	/// `ONCE` conserva su clave canónica: el «período» es la vigencia entera de la
	/// asignación, y `periodKeyFor` ya devuelve la cadena `ONCE`.
	const periodo = frequency === 'ONCE' ? 'ONCE' : (periodKey ?? '-')

	/**
	 * Dimensión de contexto.
	 *
	 * `ONE_PER_CONTEXT` incluye el vehículo porque es lo que `verificarLimite`
	 * filtra. `ONE_PER_PERIOD` usa un valor fijo: si incluyera el vehículo, dos
	 * envíos con vehículos distintos tomarían locks distintos y los dos pasarían
	 * la comprobación, que es exactamente el fallo que este lock evita.
	 *
	 * El vehículo ausente se representa como `sin-vehiculo` y NO como cadena
	 * vacía: `verificarLimite` consulta `vehicle_id: null`, así que ese caso es un
	 * conjunto propio y merece su propia clave.
	 */
	let contextKey = 'fijo'
	if (limitPolicy === 'ONE_PER_CONTEXT') {
		const vehicleId =
			typeof params.contexto.vehicleId === 'string' && params.contexto.vehicleId
				? params.contexto.vehicleId
				: null
		contextKey = `veh=${vehicleId ?? 'sin-vehiculo'}`
	}

	return `forms-limit:v1:${assignmentId}:${conductorId}:${limitPolicy}:${frequency}:${periodo}:${contextKey}`
}

/**
 * Lock del límite: paso 2 del orden global.
 *
 * Devuelve la clave usada (para el log) o `null` si no hacía falta bloquear.
 */
export async function lockLimite(tx: Tx, params: LimiteLockParams): Promise<string | null> {
	const clave = claveLimite(params)
	if (!clave) return null
	await advisoryLock(tx, LOCK_CLASS.LIMITE, hashLock32(clave))
	return clave
}

// ─────────────────────────────────────────────────────────────────────────────
// Lock de fila
// ─────────────────────────────────────────────────────────────────────────────

/** Lo que devuelve el lock de fila. Solo lo necesario para decidir. */
export interface SubmissionLockRow {
	id: string
	conductor_id: string
	status: string
	version_id: string
	assignment_id: string
	client_submission_id: string
}

/**
 * Bloquea la fila del envío y devuelve su estado ya releído: paso 3 del orden
 * global.
 *
 * `SELECT ... FOR UPDATE` y no una lectura normal porque el `status` se usa para
 * DECIDIR si se puede escribir. Sin el lock, entre el `SELECT` y el `INSERT` cabe
 * un `enviarSubmission` que pasa el envío a `SUBMITTED`, y se acabaría añadiendo
 * evidencia a un documento ya entregado.
 *
 * Se usa `$queryRaw` porque Prisma no expresa `FOR UPDATE`. Es un `SELECT`
 * parametrizado: no hay SQL construido por concatenación.
 */
export async function lockSubmissionPorClientId(
	tx: Tx,
	clientSubmissionId: string
): Promise<SubmissionLockRow | null> {
	const filas = await tx.$queryRaw<SubmissionLockRow[]>`
		SELECT id, conductor_id, status, version_id, assignment_id, client_submission_id
		FROM form_submissions
		WHERE client_submission_id = ${clientSubmissionId}::uuid
		FOR UPDATE
	`
	return filas[0] ?? null
}

/** Igual que la anterior pero por `id`, para las operaciones de adjunto. */
export async function lockSubmissionPorId(
	tx: Tx,
	submissionId: string
): Promise<SubmissionLockRow | null> {
	const filas = await tx.$queryRaw<SubmissionLockRow[]>`
		SELECT id, conductor_id, status, version_id, assignment_id, client_submission_id
		FROM form_submissions
		WHERE id = ${submissionId}::uuid
		FOR UPDATE
	`
	return filas[0] ?? null
}

/**
 * Tiempos de las transacciones interactivas del portal.
 *
 * El default de Prisma es 2 s de espera y 5 s de duración. `completarAdjunto`
 * hace un `HeadObject` contra S3 con la fila bloqueada, y por datos móviles eso
 * puede pasar de 5 s: con el default, la transacción abortaría sola y el
 * conductor vería un fallo que no es suyo.
 *
 * El lock es de UNA fila de envío, así que alargar la ventana no bloquea a nadie
 * más que a otra operación del mismo envío.
 */
export const TX_OPCIONES = { maxWait: 5_000, timeout: 20_000 } as const
