import { Prisma } from '@prisma/client'
import { z } from 'zod'

import { getS3SignedUrl } from '../../config/aws'
import { prisma } from '../../config/prisma'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MARGEN_RELOJ_MS = 10 * 60_000
const RETENCION_DIAS = 90
const RETENCION_MS = RETENCION_DIAS * 24 * 60 * 60_000
const MAX_PUNTOS_DETALLE = 5_000

export class RastreoServicioError extends Error {
	constructor(message: string, readonly status: number, readonly code?: string) {
		super(message)
	}
}

const iso = z.string().datetime({ offset: true }).transform((valor) => new Date(valor))

const iniciarSesionSchema = z.object({
	id: z.string().regex(UUID_RE, 'id debe ser UUID'),
	consent_at: iso,
	consent_version: z.string().trim().min(1).max(40),
	platform: z.enum(['ios', 'android']),
	started_at: iso
}).strict()

const puntoSchema = z.object({
	id: z.string().regex(UUID_RE, 'id debe ser UUID'),
	latitud: z.number().finite().min(-90).max(90),
	longitud: z.number().finite().min(-180).max(180),
	precision_m: z.number().finite().min(0).max(10_000),
	velocidad_mps: z.number().finite().min(0).max(150).nullable(),
	rumbo_grados: z.number().finite().min(0).lt(360).nullable(),
	capturado_at: iso
}).strict()

const guardarPuntosSchema = z.object({
	puntos: z.array(puntoSchema).min(1).max(100)
}).strict().superRefine((input, ctx) => {
	const ids = new Set<string>()
	for (const [index, punto] of input.puntos.entries()) {
		if (ids.has(punto.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['puntos', index, 'id'], message: 'id duplicado en el lote' })
		ids.add(punto.id)
	}
})

const detenerSesionSchema = z.object({
	stopped_at: iso,
	reason: z.string().trim().min(1).max(80)
}).strict()

type Sesion = Prisma.servicio_rastreo_sesionGetPayload<{}>

function parsear<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
	const resultado = schema.safeParse(body ?? {})
	if (!resultado.success) {
		const detalle = resultado.error.issues.map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`).join('; ')
		throw new RastreoServicioError(`Datos inválidos: ${detalle}`, 400, 'DATOS_INVALIDOS')
	}
	return resultado.data
}

function dtoSesion(sesion: Sesion) {
	return {
		id: sesion.id,
		estado: sesion.finalizado_at ? 'finalizada' as const : 'activa' as const,
		consentimiento_at: sesion.consentimiento_at.toISOString(),
		version: sesion.consentimiento_version,
		plataforma: sesion.plataforma as 'ios' | 'android',
		iniciado_at: sesion.iniciado_at.toISOString(),
		finalizado_at: sesion.finalizado_at?.toISOString() ?? null,
		motivo_finalizacion: sesion.motivo_finalizacion
	}
}

function puntoDto(punto: {
	id: string
	sesion_id: string
	latitud: number
	longitud: number
	precision_m: number
	velocidad_mps: number | null
	rumbo_grados: number | null
	capturado_at: Date
	recibido_at: Date
}) {
	return {
		id: punto.id,
		sesion_id: punto.sesion_id,
		latitud: punto.latitud,
		longitud: punto.longitud,
		precision_m: punto.precision_m,
		velocidad_mps: punto.velocidad_mps,
		rumbo_grados: punto.rumbo_grados,
		capturado_at: punto.capturado_at.toISOString(),
		recibido_at: punto.recibido_at.toISOString()
	}
}

export type PuntoMovimiento = { latitud: number; longitud: number; precision_m: number; velocidad_mps: number | null; capturado_at: Date }

function distanciaMetros(a: PuntoMovimiento, b: PuntoMovimiento): number {
	const radio = 6_371_000
	const rad = (grados: number) => grados * Math.PI / 180
	const dLat = rad(b.latitud - a.latitud)
	const dLng = rad(b.longitud - a.longitud)
	const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitud)) * Math.cos(rad(b.latitud)) * Math.sin(dLng / 2) ** 2
	return 2 * radio * Math.asin(Math.sqrt(Math.min(1, h)))
}

/**
 * Clasifica con varios fixes para que una lectura aislada o el ruido del GPS
 * no cambien el estado. Los umbrales de entrada y salida crean histéresis.
 */
export function estadoMovimiento(puntos: PuntoMovimiento[], sesionActiva: boolean): 'sin_datos' | 'en_movimiento' | 'detenido' | 'sin_senal' {
	if (!puntos.length) return 'sin_datos'
	const ordenados = puntos.slice().sort((a, b) => a.capturado_at.getTime() - b.capturado_at.getTime())
	const validos = ordenados.filter((punto) => punto.precision_m <= 50)
	if (!validos.length) return 'sin_datos'
	const ultimo = validos[validos.length - 1]
	if (sesionActiva && Date.now() - ultimo.capturado_at.getTime() > 2 * 60_000) return 'sin_senal'
	let estado: 'en_movimiento' | 'detenido' | null = null
	let moviles = 0
	let quietos: PuntoMovimiento[] = []
	for (let i = 1; i < validos.length; i++) {
		const anterior = validos[i - 1]
		const actual = validos[i]
		const segundos = (actual.capturado_at.getTime() - anterior.capturado_at.getTime()) / 1000
		if (segundos <= 0 || segundos > 120) {
			moviles = 0
			quietos = []
			continue
		}
		const distancia = distanciaMetros(anterior, actual)
		const gps = actual.velocidad_mps
		const velocidad = gps == null ? distancia / segundos : gps
		const evidenciaMovimiento = velocidad >= 2 && distancia >= Math.max(12, actual.precision_m * 0.25)
		const evidenciaDetenido = velocidad <= 0.8 && distancia <= Math.max(15, actual.precision_m * 0.35)
		if (evidenciaMovimiento) {
			moviles++
			quietos = []
			if (moviles >= 2) estado = 'en_movimiento'
		} else if (evidenciaDetenido) {
			quietos.push(actual)
			moviles = 0
			const duracion = quietos.length > 1
				? quietos[quietos.length - 1].capturado_at.getTime() - quietos[0].capturado_at.getTime()
				: 0
			if (quietos.length >= 3 && duracion >= 60_000) estado = 'detenido'
		} else {
			moviles = 0
			quietos = []
		}
	}
	return estado ?? 'sin_datos'
}

/** Datos mínimos para representar en vivo a los conductores que aceptaron compartir ubicación. */
export async function listarServiciosConRastreo() {
	const sesiones = await prisma.servicio_rastreo_sesion.findMany({
		where: {
			finalizado_at: null,
			servicio: { deleted_at: null, estado: 'en_curso' }
		},
		orderBy: { iniciado_at: 'desc' },
		select: {
			id: true,
			servicio_id: true,
			iniciado_at: true,
			conductor: { select: { id: true, nombre: true, apellido: true, foto_url: true } },
			puntos: {
				orderBy: { capturado_at: 'desc' },
				take: 32,
				select: { latitud: true, longitud: true, precision_m: true, velocidad_mps: true, capturado_at: true }
			},
			servicio: {
				select: {
					numero_planilla: true,
					fecha_realizacion: true,
					estado: true,
					origen_especifico: true,
					destino_especifico: true,
					destino_latitud: true,
					destino_longitud: true,
					clientes: { select: { nombre: true } },
					vehiculos: { select: { placa: true } },
					municipios_servicio_origen_idTomunicipios: { select: { nombre_municipio: true } },
					municipios_servicio_destino_idTomunicipios: { select: { nombre_municipio: true, latitud: true, longitud: true } }
				}
			}
		}
	})
	const masRecientes = new Map<string, typeof sesiones[number]>()
	for (const sesion of sesiones) {
		const anterior = masRecientes.get(sesion.servicio_id)
		if (!anterior || sesion.iniciado_at > anterior.iniciado_at) {
			masRecientes.set(sesion.servicio_id, sesion)
		}
	}
	const activas = [...masRecientes.values()]
	const conductorIds = [...new Set(activas.map((sesion) => sesion.conductor.id))]
	const rutasFoto = new Map<string, string>()
	for (const sesion of activas) {
		const ruta = sesion.conductor.foto_url?.trim()
		if (ruta) rutasFoto.set(sesion.conductor.id, ruta)
	}
	if (conductorIds.length) {
		try {
			const fotosPerfil = await prisma.documento.findMany({
				where: { conductor_id: { in: conductorIds }, categoria: 'FOTO_PERFIL', estado: 'vigente' },
				select: { conductor_id: true, ruta_archivo: true },
				orderBy: { created_at: 'desc' }
			})
			for (const foto of fotosPerfil) {
				if (foto.conductor_id && foto.ruta_archivo?.trim() && !rutasFoto.has(foto.conductor_id)) {
					rutasFoto.set(foto.conductor_id, foto.ruta_archivo.trim())
				}
			}
		} catch (error) {
			console.error('No fue posible buscar fotos de perfil para el mapa GPS:', error)
		}
	}
	const fotosFirmadas = new Map<string, string>()
	await Promise.all([...rutasFoto.entries()].map(async ([conductorId, ruta]) => {
		try {
			fotosFirmadas.set(conductorId, await getS3SignedUrl(ruta, 3600))
		} catch {
			// La foto es opcional: el mapa usa iniciales si el archivo no está disponible.
		}
	}))
	return {
		servicios: [...masRecientes.entries()].map(([servicio_id, sesion]) => {
			const puntos = sesion.puntos.slice().reverse()
			const ultimo = puntos[puntos.length - 1]
			const destino = sesion.servicio.municipios_servicio_destino_idTomunicipios
			return {
				servicio_id,
				sesion_id: sesion.id,
				numero_planilla: sesion.servicio.numero_planilla,
				fecha_realizacion: sesion.servicio.fecha_realizacion?.toISOString() ?? null,
				estado_servicio: sesion.servicio.estado,
				conductor: {
					nombre: sesion.conductor.nombre,
					apellido: sesion.conductor.apellido,
					foto_signed_url: fotosFirmadas.get(sesion.conductor.id) ?? null
				},
				vehiculo: { placa: sesion.servicio.vehiculos?.placa ?? null },
				cliente: { nombre: sesion.servicio.clientes.nombre },
				origen: sesion.servicio.origen_especifico.trim() || sesion.servicio.municipios_servicio_origen_idTomunicipios.nombre_municipio,
				destino: sesion.servicio.destino_especifico.trim() || destino.nombre_municipio,
				destino_latitud: sesion.servicio.destino_latitud ?? Number(destino.latitud),
				destino_longitud: sesion.servicio.destino_longitud ?? Number(destino.longitud),
				estado_actual: estadoMovimiento(puntos, true),
				ultimo_punto_at: ultimo?.capturado_at.toISOString() ?? null,
				ultimo_punto: ultimo ? {
					latitud: ultimo.latitud,
					longitud: ultimo.longitud,
					precision_m: ultimo.precision_m,
					velocidad_mps: ultimo.velocidad_mps,
					capturado_at: ultimo.capturado_at.toISOString()
				} : null
			}
		})
	}
}

/**
 * El mismo DTO alimenta el portal del conductor y la lectura autenticada del
 * equipo. El caller ya limita el recurso al conductor asignado o a un rol
 * operativo expresamente autorizado.
 */
export async function obtenerRastreoServicio(servicioId: string) {
	if (!UUID_RE.test(servicioId)) throw new RastreoServicioError('Servicio no encontrado', 404)
	const servicio = await prisma.servicio.findFirst({
		where: { id: servicioId, deleted_at: null },
		select: { id: true }
	})
	if (!servicio) throw new RastreoServicioError('Servicio no encontrado', 404)

	const sesiones = await prisma.servicio_rastreo_sesion.findMany({
		where: { servicio_id: servicioId },
		orderBy: { iniciado_at: 'asc' }
	})
	const wherePuntos = { sesion_id: { in: sesiones.map((sesion) => sesion.id) } }
	const totalPuntos = sesiones.length ? await prisma.servicio_rastreo_punto.count({ where: wherePuntos }) : 0
	const puntos = totalPuntos <= MAX_PUNTOS_DETALLE
		? sesiones.length
			? await prisma.servicio_rastreo_punto.findMany({
			where: { sesion_id: { in: sesiones.map((sesion) => sesion.id) } },
			orderBy: { capturado_at: 'asc' },
			select: {
				id: true,
				sesion_id: true,
				latitud: true,
				longitud: true,
				precision_m: true,
				velocidad_mps: true,
				rumbo_grados: true,
				capturado_at: true,
				recibido_at: true
			}
			})
			: []
		: await prisma.$queryRaw<Array<{
			id: string
			sesion_id: string
			latitud: number
			longitud: number
			precision_m: number
			velocidad_mps: number | null
			rumbo_grados: number | null
			capturado_at: Date
			recibido_at: Date
		}>>`
			WITH ordenados AS (
				SELECT id, sesion_id, latitud, longitud, precision_m, velocidad_mps, rumbo_grados,
					capturado_at, recibido_at,
					ROW_NUMBER() OVER (ORDER BY capturado_at ASC, id ASC) AS posicion,
					COUNT(*) OVER () AS total
				FROM servicio_rastreo_punto
				WHERE sesion_id IN (${Prisma.join(sesiones.map((sesion) => Prisma.sql`${sesion.id}::uuid`))})
			), resumen AS (
				SELECT COUNT(*) AS total FROM ordenados
			), muestras AS (
				SELECT DISTINCT FLOOR(indice::numeric * (total - 1)::numeric / (${MAX_PUNTOS_DETALLE} - 1))::bigint + 1 AS posicion
				FROM generate_series(0, ${MAX_PUNTOS_DETALLE - 1}) AS serie(indice)
				CROSS JOIN resumen
				WHERE total > 0
			)
			SELECT o.id, o.sesion_id, o.latitud, o.longitud, o.precision_m, o.velocidad_mps,
				o.rumbo_grados, o.capturado_at, o.recibido_at
			FROM ordenados o
			JOIN muestras m ON m.posicion = o.posicion
			ORDER BY o.capturado_at ASC, o.id ASC
		`
	const activas = sesiones.filter((sesion) => !sesion.finalizado_at)
	const sesionReciente = activas[0] ?? sesiones.at(-1)
	const puntosMovimiento = sesionReciente
		? (await prisma.servicio_rastreo_punto.findMany({
			where: { sesion_id: sesionReciente.id },
			orderBy: { capturado_at: 'desc' },
			take: 32,
			select: { latitud: true, longitud: true, precision_m: true, velocidad_mps: true, capturado_at: true }
		})).reverse()
		: []
	return {
		sesion_activa: activas.length ? dtoSesion(activas[0]) : null,
		sesiones: sesiones.map(dtoSesion),
		puntos: puntos.map(puntoDto),
		estado_actual: estadoMovimiento(puntosMovimiento, activas.length > 0)
	}
}

async function cargarServicioAsignado(servicioId: string, conductorId: string) {
	if (!UUID_RE.test(servicioId)) throw new RastreoServicioError('Servicio no encontrado', 404)
	const servicio = await prisma.servicio.findFirst({
		where: { id: servicioId, conductor_id: conductorId, deleted_at: null },
		select: {
			id: true,
			estado: true,
			fecha_finalizacion: true,
			ejecucion: { select: { iniciado_at: true, iniciado_dispositivo_at: true, liberado_at: true } }
		}
	})
	if (!servicio) throw new RastreoServicioError('Servicio no encontrado', 404)
	return servicio
}

function fechaValida(fecha: Date, ahora: Date, etiqueta: string) {
	if (fecha.getTime() > ahora.getTime() + MARGEN_RELOJ_MS) {
		throw new RastreoServicioError(`${etiqueta} no puede estar en el futuro.`, 422, 'HORA_INVALIDA')
	}
}

/**
 * Registra el consentimiento y la sesión antes de encender el GPS. El UUID
 * creado en el teléfono hace que un reintento offline sea idempotente.
 */
export async function iniciarRastreoServicio(servicioId: string, conductorId: string, body: unknown) {
	const input = parsear(iniciarSesionSchema, body)
	const servicio = await cargarServicioAsignado(servicioId, conductorId)
	const ahora = new Date()
	fechaValida(input.consent_at, ahora, 'La aceptación')
	fechaValida(input.started_at, ahora, 'El inicio del rastreo')
	if (input.consent_at > input.started_at) {
		throw new RastreoServicioError('El consentimiento debe registrarse antes de iniciar el rastreo.', 422, 'CONSENTIMIENTO_INVALIDO')
	}
	const inicioServicio = servicio.ejecucion?.iniciado_dispositivo_at ?? servicio.ejecucion?.iniciado_at
	if (!servicio.ejecucion?.iniciado_at || !inicioServicio) {
		throw new RastreoServicioError('El servicio debe estar iniciado desde la app para activar el rastreo.', 409, 'SERVICIO_NO_INICIADO')
	}
	const cierreServicio = servicio.ejecucion.liberado_at ?? servicio.fecha_finalizacion
	const servicioActivo = servicio.estado === 'en_curso' && !servicio.ejecucion.liberado_at
	// El inicio diferido puede llegar después de liberar. Se acepta solo si ocurrió
	// durante la ejecución y la ruta todavía está dentro de la ventana de retención.
	if (!servicioActivo && (!cierreServicio || input.started_at > cierreServicio || ahora.getTime() - cierreServicio.getTime() > RETENCION_MS)) {
		throw new RastreoServicioError('El servicio ya no admite iniciar un rastreo.', 409, 'SERVICIO_CERRADO')
	}
	if (input.started_at < inicioServicio || input.consent_at < inicioServicio) {
		throw new RastreoServicioError('El rastreo debe estar dentro del tiempo del servicio.', 422, 'HORA_FUERA_DEL_SERVICIO')
	}
	if (cierreServicio && input.started_at > cierreServicio) {
		throw new RastreoServicioError('El rastreo debe terminar antes de liberar el servicio.', 422, 'HORA_FUERA_DEL_SERVICIO')
	}

	const existente = await prisma.servicio_rastreo_sesion.findUnique({ where: { id: input.id } })
	if (existente) {
		if (existente.servicio_id !== servicioId || existente.conductor_id !== conductorId ||
			existente.consentimiento_at.getTime() !== input.consent_at.getTime() ||
			existente.consentimiento_version !== input.consent_version || existente.plataforma !== input.platform ||
			existente.iniciado_at.getTime() !== input.started_at.getTime()) {
			throw new RastreoServicioError('El id de sesión ya fue usado con otros datos.', 409, 'SESION_ID_REUTILIZADO')
		}
		return dtoSesion(existente)
	}

	try {
		const sesion = await prisma.$transaction(async (tx) => {
			await tx.$queryRaw`SELECT id FROM servicios WHERE id = ${servicioId}::uuid FOR UPDATE`
			const actual = await tx.servicio.findFirst({
				where: { id: servicioId, conductor_id: conductorId, deleted_at: null },
				select: { estado: true, fecha_finalizacion: true, ejecucion: { select: { iniciado_at: true, iniciado_dispositivo_at: true, liberado_at: true } } }
			})
			if (!actual) throw new RastreoServicioError('Servicio no encontrado', 404)
			const fin = actual.ejecucion?.liberado_at ?? actual.fecha_finalizacion
			const sigueActivo = actual.estado === 'en_curso' && !actual.ejecucion?.liberado_at
			if (!actual.ejecucion?.iniciado_at || (!sigueActivo && (!fin || input.started_at > fin || ahora.getTime() - fin.getTime() > RETENCION_MS))) {
				throw new RastreoServicioError('El servicio ya no admite iniciar un rastreo.', 409, 'SERVICIO_CERRADO')
			}
			const previa = await tx.servicio_rastreo_sesion.findFirst({
				where: { conductor_id: conductorId, finalizado_at: null },
				select: { id: true }
			})
			if (previa) throw new RastreoServicioError('Ya hay un rastreo activo para este conductor.', 409, 'RASTREO_ACTIVO')
			return tx.servicio_rastreo_sesion.create({
				data: {
					id: input.id,
					servicio_id: servicioId,
					conductor_id: conductorId,
					consentimiento_at: input.consent_at,
					consentimiento_version: input.consent_version,
					plataforma: input.platform,
					iniciado_at: input.started_at,
					...(fin ? { finalizado_at: fin, motivo_finalizacion: 'servicio_liberado' } : {})
				}
			})
		})
		return dtoSesion(sesion)
	} catch (error) {
		if (error instanceof RastreoServicioError) throw error
		if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
			const existente = await prisma.servicio_rastreo_sesion.findUnique({ where: { id: input.id } })
			if (existente && existente.servicio_id === servicioId && existente.conductor_id === conductorId &&
				existente.consentimiento_at.getTime() === input.consent_at.getTime() &&
				existente.consentimiento_version === input.consent_version && existente.plataforma === input.platform &&
				existente.iniciado_at.getTime() === input.started_at.getTime()) return dtoSesion(existente)
			throw new RastreoServicioError('Ya hay un rastreo activo para este conductor.', 409, 'RASTREO_ACTIVO')
		}
		throw error
	}
}

/**
 * Recibe puntos una vez creados los metadatos de sesión. Una subida puede
 * llegar después de cerrar el servicio si cada muestra se capturó antes del
 * cierre declarado.
 */
export async function guardarPuntosRastreo(servicioId: string, conductorId: string, sesionId: string, body: unknown) {
	const input = parsear(guardarPuntosSchema, body)
	const servicio = await cargarServicioAsignado(servicioId, conductorId)
	const sesion = await prisma.servicio_rastreo_sesion.findFirst({
		where: { id: sesionId, servicio_id: servicio.id, conductor_id: conductorId }
	})
	if (!sesion) throw new RastreoServicioError('Sesión de rastreo no encontrada', 404)
	const finalizado = sesion.finalizado_at ?? servicio.ejecucion?.liberado_at ?? servicio.fecha_finalizacion
	const corte = finalizado ?? new Date(Date.now() + MARGEN_RELOJ_MS)
	for (const punto of input.puntos) {
		fechaValida(punto.capturado_at, new Date(), 'La captura')
		if (punto.capturado_at < sesion.iniciado_at || punto.capturado_at > corte) {
			throw new RastreoServicioError('Cada punto debe haberse capturado durante la sesión y antes de su cierre.', 422, 'PUNTO_FUERA_DE_SESION')
		}
	}

	const ahora = new Date()
	const cierre = sesion.finalizado_at ?? servicio.ejecucion?.liberado_at ?? servicio.fecha_finalizacion
	if (cierre && ahora.getTime() - cierre.getTime() > RETENCION_MS) {
		throw new RastreoServicioError('La retención del recorrido ya venció.', 410, 'RASTREO_VENCIDO')
	}

	const resultado = await prisma.servicio_rastreo_punto.createMany({
		data: input.puntos.map((punto) => ({
			id: punto.id,
			sesion_id: sesion.id,
			latitud: punto.latitud,
			longitud: punto.longitud,
			precision_m: punto.precision_m,
			velocidad_mps: punto.velocidad_mps,
			rumbo_grados: punto.rumbo_grados,
			capturado_at: punto.capturado_at
		})),
		skipDuplicates: true
	})
	if (resultado.count !== input.puntos.length) {
		const guardados = await prisma.servicio_rastreo_punto.findMany({
			where: { id: { in: input.puntos.map((punto) => punto.id) } },
			select: { id: true, sesion_id: true, latitud: true, longitud: true, precision_m: true, velocidad_mps: true, rumbo_grados: true, capturado_at: true }
		})
		const porId = new Map(guardados.map((punto) => [punto.id, punto]))
		const conflicto = input.puntos.some((punto) => {
			const actual = porId.get(punto.id)
			return !actual || actual.sesion_id !== sesion.id || actual.latitud !== punto.latitud || actual.longitud !== punto.longitud ||
				actual.precision_m !== punto.precision_m || actual.velocidad_mps !== punto.velocidad_mps || actual.rumbo_grados !== punto.rumbo_grados ||
				actual.capturado_at.getTime() !== punto.capturado_at.getTime()
		})
		if (conflicto) throw new RastreoServicioError('Un id de punto ya fue usado con otros datos.', 409, 'PUNTO_ID_REUTILIZADO')
	}
	return { recibidos: input.puntos.length, nuevos: resultado.count }
}

export async function detenerRastreoServicio(servicioId: string, conductorId: string, sesionId: string, body: unknown) {
	const input = parsear(detenerSesionSchema, body)
	const servicio = await cargarServicioAsignado(servicioId, conductorId)
	const sesion = await prisma.servicio_rastreo_sesion.findFirst({
		where: { id: sesionId, servicio_id: servicio.id, conductor_id: conductorId }
	})
	if (!sesion) throw new RastreoServicioError('Sesión de rastreo no encontrada', 404)
	fechaValida(input.stopped_at, new Date(), 'La hora de detención')
	if (input.stopped_at < sesion.iniciado_at) {
		throw new RastreoServicioError('La detención debe ocurrir después de iniciar el rastreo.', 422, 'HORA_INVALIDA')
	}
	if (sesion.finalizado_at) {
		if (sesion.finalizado_at.getTime() === input.stopped_at.getTime() && sesion.motivo_finalizacion === input.reason) return dtoSesion(sesion)
		throw new RastreoServicioError('La sesión ya fue finalizada con otros datos.', 409, 'SESION_FINALIZADA')
	}
	const cierreServicio = servicio.ejecucion?.liberado_at ?? servicio.fecha_finalizacion
	if (cierreServicio && input.stopped_at > cierreServicio) {
		throw new RastreoServicioError('La detención no puede ser posterior a la liberación del servicio.', 422, 'HORA_FUERA_DEL_SERVICIO')
	}
	const actualizado = await prisma.servicio_rastreo_sesion.updateMany({
		where: { id: sesion.id, finalizado_at: null },
		data: { finalizado_at: input.stopped_at, motivo_finalizacion: input.reason }
	})
	const resultado = actualizado.count
		? await prisma.servicio_rastreo_sesion.findUnique({ where: { id: sesion.id } })
		: sesion
	return dtoSesion(resultado!)
}

/** Cierra el tracking activo dentro de la transacción que libera el servicio. */
export async function cerrarRastreoPorLiberacion(
	tx: Prisma.TransactionClient,
	servicioId: string,
	liberadoAt: Date,
	motivo = 'servicio_liberado'
) {
	await tx.servicio_rastreo_sesion.updateMany({
		where: { servicio_id: servicioId, finalizado_at: null },
		data: { finalizado_at: liberadoAt, motivo_finalizacion: motivo }
	})
}

/** El recorrido se conserva 90 días desde el fin de la sesión; sus metadatos siguen auditables. */
export async function purgarPuntosRastreoVencidos(ahora = new Date()) {
	const corte = new Date(ahora.getTime() - RETENCION_MS)
	return prisma.servicio_rastreo_punto.deleteMany({
		where: { sesion: { finalizado_at: { lt: corte } } }
	})
}
