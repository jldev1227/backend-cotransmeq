/**
 * Logs estructurados y métricas del módulo.
 *
 * Todos los logs llevan el mismo juego de claves (`request_id`, `actor_id`,
 * `actor_type`, `form_id`, `version_id`, `assignment_id`, `submission_id`,
 * `client_submission_id`) porque el objetivo es poder seguir UN envío desde el
 * primer `attachments/init` hasta el `SUBMITTED`, atravesando reintentos de la
 * outbox y varios dispositivos. Con claves distintas por sitio, ese seguimiento
 * hay que hacerlo a ojo entre líneas sueltas.
 *
 * Las métricas son contadores en memoria del proceso, no un cliente de Prometheus:
 * el repositorio no tiene uno y añadirlo excede el alcance. Sirven para
 * responder «¿cuántos replays idempotentes hubo hoy?» desde un endpoint interno y
 * para que un scraper futuro los lea sin reescribir los puntos de instrumentación.
 * Se reinician al reiniciar el proceso, y eso está documentado en la respuesta.
 */

import type { FastifyRequest } from 'fastify'
import { logger } from '../../utils/logger'

// ─── Contexto común ──────────────────────────────────────────────────────────

export interface FormLogContext {
	requestId?: string
	actorId?: string | null
	actorType?: 'CONDUCTOR' | 'USER' | 'SYSTEM'
	formId?: string | null
	versionId?: string | null
	assignmentId?: string | null
	submissionId?: string | null
	clientSubmissionId?: string | null
	attachmentId?: string | null
	clientAttachmentId?: string | null
	revision?: number | null
	/** Milisegundos de la operación, cuando se mide. */
	durationMs?: number
	[extra: string]: unknown
}

/**
 * Contexto derivado de la petición.
 *
 * `request.id` lo genera Fastify por petición; se usa como `request_id` en vez de
 * inventar otro identificador, para que los logs del módulo se puedan cruzar con
 * los de acceso del servidor.
 */
export function contextoDePeticion(request: FastifyRequest): FormLogContext {
	const admin = (request as any).user
	const portal = (request as any).portalActor

	return {
		requestId: request.id,
		...(portal
			? { actorId: portal.id, actorType: 'CONDUCTOR' as const }
			: admin
				? { actorId: admin.id, actorType: 'USER' as const }
				: { actorId: null, actorType: 'SYSTEM' as const })
	}
}

/** Serializa el contexto a `snake_case`, que es la convención de los logs del repo. */
function serializar(ctx: FormLogContext) {
	const {
		requestId,
		actorId,
		actorType,
		formId,
		versionId,
		assignmentId,
		submissionId,
		clientSubmissionId,
		attachmentId,
		clientAttachmentId,
		revision,
		durationMs,
		...resto
	} = ctx

	return {
		module: 'formularios-dinamicos',
		request_id: requestId ?? null,
		actor_id: actorId ?? null,
		actor_type: actorType ?? null,
		...(formId !== undefined ? { form_id: formId } : {}),
		...(versionId !== undefined ? { version_id: versionId } : {}),
		...(assignmentId !== undefined ? { assignment_id: assignmentId } : {}),
		...(submissionId !== undefined ? { submission_id: submissionId } : {}),
		...(clientSubmissionId !== undefined ? { client_submission_id: clientSubmissionId } : {}),
		...(attachmentId !== undefined ? { attachment_id: attachmentId } : {}),
		...(clientAttachmentId !== undefined ? { client_attachment_id: clientAttachmentId } : {}),
		...(revision !== undefined ? { revision } : {}),
		...(durationMs !== undefined ? { duration_ms: durationMs } : {}),
		...resto
	}
}

// ─── Métricas ────────────────────────────────────────────────────────────────

/**
 * Contadores del módulo.
 *
 * Los nombres son los del documento: «envíos idempotentes repetidos, profundidad y
 * edad de outbox reportada, fallos de adjuntos y conflictos de versión».
 */
export interface FormMetrics {
	/** Envíos aceptados por primera vez. */
	submissionsAccepted: number
	/** POST repetidos que devolvieron el envío existente. */
	idempotentReplays: number
	/** POST con el mismo id y otro contenido. Es un bug del cliente, no red. */
	idempotencyMismatches: number
	/** Rechazos por `ONE_PER_PERIOD` / `ONE_PER_CONTEXT`. */
	limitReached: number
	/** Rechazos por validación de respuestas. */
	validationRejections: number
	/** `attachments/complete` que no encontró el objeto o vino incompleto. */
	attachmentFailures: number
	/** Adjuntos verificados correctamente. */
	attachmentsVerified: number
	/** `409 REVISION_CONFLICT` en el autosave del builder. */
	revisionConflicts: number
	/** Versiones publicadas. */
	versionsPublished: number
	/** Intentos de publicar que la validación bloqueó. */
	publishBlocked: number
	/** Accesos denegados por target (`ASSIGNMENT_TARGET_DENIED`). */
	targetDenied: number
	/** Textos que llegaron con caracteres que hubo que sanear. */
	sanitizedTexts: number
}

const metrics: FormMetrics = {
	submissionsAccepted: 0,
	idempotentReplays: 0,
	idempotencyMismatches: 0,
	limitReached: 0,
	validationRejections: 0,
	attachmentFailures: 0,
	attachmentsVerified: 0,
	revisionConflicts: 0,
	versionsPublished: 0,
	publishBlocked: 0,
	targetDenied: 0,
	sanitizedTexts: 0
}

/**
 * Latencias observadas, para percentiles.
 *
 * Ventana deslizante acotada: guardar todas las latencias de un proceso que lleva
 * semanas levantado sería una fuga de memoria lenta. Con 500 muestras el p95 es
 * suficientemente estable para detectar una degradación.
 */
const VENTANA_LATENCIA = 500

/**
 * Series separadas por PUERTA de entrada, no agregadas.
 *
 * `listPortal`/`submit` son el portal del conductor (móvil, red mala) y
 * `listMis`/`submitMis` el dashboard (escritorio, cableado). Sumarlos daría un
 * p95 sin significado: una degradación del portal quedaría diluida por el
 * tráfico rápido del dashboard, que es justo la que hay que ver.
 */
const latencias: Record<'submit' | 'listPortal' | 'saveVersion' | 'listMis' | 'submitMis', number[]> = {
	submit: [],
	listPortal: [],
	saveVersion: [],
	listMis: [],
	submitMis: []
}

export function observarLatencia(operacion: keyof typeof latencias, ms: number): void {
	const serie = latencias[operacion]
	serie.push(ms)
	if (serie.length > VENTANA_LATENCIA) serie.shift()
}

function percentil(serie: number[], p: number): number | null {
	if (serie.length === 0) return null
	const ordenada = [...serie].sort((a, b) => a - b)
	const index = Math.min(ordenada.length - 1, Math.floor((p / 100) * ordenada.length))
	return Math.round(ordenada[index])
}

const arrancadoEn = new Date().toISOString()

/** Instantánea de las métricas, para un endpoint interno o un scraper. */
export function snapshotMetricas() {
	return {
		module: 'formularios-dinamicos',
		/// Se declara explícitamente que son contadores del PROCESO: quien los lea
		/// tiene que saber que un reinicio los pone a cero, o interpretará una caída
		/// del contador como una caída del tráfico.
		scope: 'process',
		since: arrancadoEn,
		counters: { ...metrics },
		latencyMs: {
			submit: { p50: percentil(latencias.submit, 50), p95: percentil(latencias.submit, 95) },
			listPortal: {
				p50: percentil(latencias.listPortal, 50),
				p95: percentil(latencias.listPortal, 95)
			},
			saveVersion: {
				p50: percentil(latencias.saveVersion, 50),
				p95: percentil(latencias.saveVersion, 95)
			},
			listMis: { p50: percentil(latencias.listMis, 50), p95: percentil(latencias.listMis, 95) },
			submitMis: { p50: percentil(latencias.submitMis, 50), p95: percentil(latencias.submitMis, 95) }
		}
	}
}

// ─── Eventos ─────────────────────────────────────────────────────────────────

/**
 * Eventos que se registran, cada uno con el contador que incrementa.
 *
 * La tabla existe para que instrumentar un caso nuevo sea añadir una línea aquí y
 * no repartir `metrics.x += 1` por todo el módulo, donde se olvidan.
 */
const CONTADOR_POR_EVENTO: Partial<Record<string, keyof FormMetrics>> = {
	'submission.accepted': 'submissionsAccepted',
	'submission.idempotent-replay': 'idempotentReplays',
	'submission.idempotency-mismatch': 'idempotencyMismatches',
	'submission.limit-reached': 'limitReached',
	'submission.validation-rejected': 'validationRejections',
	'attachment.failed': 'attachmentFailures',
	'attachment.verified': 'attachmentsVerified',
	'version.revision-conflict': 'revisionConflicts',
	'version.published': 'versionsPublished',
	'version.publish-blocked': 'publishBlocked',
	'assignment.target-denied': 'targetDenied',
	'text.sanitized': 'sanitizedTexts'
}

export type FormEventName = keyof typeof CONTADOR_POR_EVENTO | (string & {})

/**
 * Registra un evento del módulo e incrementa su contador.
 *
 * El nivel depende del evento, no del llamador: un replay idempotente es `info`
 * (es el sistema funcionando), un `IDEMPOTENCY_PAYLOAD_MISMATCH` es `warn` (hay un
 * bug en un cliente) y un fallo de adjunto es `warn` (el conductor perdió una
 * foto). Decidirlo aquí evita que el mismo hecho se registre con dos niveles según
 * quién lo llame.
 */
export function registrarEvento(event: FormEventName, ctx: FormLogContext = {}): void {
	const contador = CONTADOR_POR_EVENTO[event]
	if (contador) metrics[contador] += 1

	const payload = { type: `forms:${event}`, ...serializar(ctx) }

	if (
		event === 'submission.idempotency-mismatch' ||
		event === 'attachment.failed' ||
		event === 'version.revision-conflict' ||
		event === 'assignment.target-denied'
	) {
		logger.warn(payload, `[formularios] ${event}`)
		return
	}
	logger.info(payload, `[formularios] ${event}`)
}

/**
 * Mide una operación y registra su latencia.
 *
 * Registra el fallo con su duración también: una operación que tarda ocho segundos
 * y después falla es un dato más útil que un simple error, porque distingue «la
 * validación la rechazó» de «la base se quedó colgada».
 */
export async function medir<T>(
	operacion: keyof typeof latencias,
	ctx: FormLogContext,
	fn: () => Promise<T>
): Promise<T> {
	const inicio = Date.now()
	try {
		const resultado = await fn()
		observarLatencia(operacion, Date.now() - inicio)
		return resultado
	} catch (err) {
		const durationMs = Date.now() - inicio
		observarLatencia(operacion, durationMs)
		logger.debug(
			{
				type: `forms:${operacion}.failed`,
				...serializar({ ...ctx, durationMs }),
				error: err instanceof Error ? err.message : String(err)
			},
			`[formularios] ${operacion} falló`
		)
		throw err
	}
}

/**
 * Auditoría de una consulta administrativa.
 *
 * Los envíos contienen datos de salud, fatiga y firmas. Saber quién consultó qué
 * es parte del control de acceso, no un extra: sin esta huella, un acceso indebido
 * es indetectable. Se registra la CONSULTA (filtros y cuántas filas), nunca el
 * contenido.
 */
export function auditarConsultaAdministrativa(
	request: FastifyRequest,
	detalle: { recurso: string; filtros?: Record<string, unknown>; resultados?: number }
): void {
	logger.info(
		{
			type: 'forms:admin.query',
			...serializar(contextoDePeticion(request)),
			recurso: detalle.recurso,
			/// Solo las claves con valor: un objeto con quince `undefined` no dice
			/// nada y ensucia el log.
			filtros: Object.fromEntries(
				Object.entries(detalle.filtros ?? {}).filter(([, v]) => v !== undefined && v !== '')
			),
			resultados: detalle.resultados ?? null,
			method: request.method,
			url: request.url
		},
		'[formularios] consulta administrativa'
	)
}

export const observabilidadInternals = { serializar, percentil, latencias, metrics }
