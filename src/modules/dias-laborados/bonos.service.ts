import { randomUUID } from 'crypto'
import { prisma } from '../../config/prisma'
import { BonoInput, ListarBonosInput, SincronizarBonosInput } from './bonos.schema'

/**
 * Servicio de Bonos — Planilla de Días Laborados
 *
 *  - Crea / elimina bonos asociados a un día laborado (registro_dia_laboral)
 *    o a un tramo específico (registro_dia_laboral_segmento).
 *  - Cada bono referencia una `configuraciones_liquidacion` activa
 *    (FK `config_liquidacion_id`). El valor monetario siempre se lee
 *    de la config vigente (lectura en vivo).
 *  - El control de acceso por usuario (permiso individual `bonos-planilla`)
 *    se valida en el middleware ANTES de llegar a este servicio.
 */
export const BonosService = {
	// ─────────────────────────────────────────────
	// LISTAR: bonos en un rango de fechas
	// Devuelve los bonos + los datos de la config (nombre, valor, anio)
	// + el segmento (vehiculo_placa) y la fecha del registro_dia para
	// que el frontend pueda agregarlos por (config, vehiculo, mes)
	// y autocompletar las cantidades en el formulario de liquidación.
	// ─────────────────────────────────────────────
	async listar(opts: ListarBonosInput) {
		const { desde, hasta, conductor_id } = opts
		const desdeDate = new Date(desde + 'T00:00:00.000Z')
		const hastaDate = new Date(hasta + 'T23:59:59.999Z')

		const where: any = {
			registro_dia: {
				fecha: { gte: desdeDate, lte: hastaDate }
			}
		}
		if (conductor_id) {
			where.registro_dia.conductor_id = conductor_id
		}

		/// `deleted_at: null` NO es opcional aquí: los bonos llevan `valor` y
		/// esta consulta es la que alimenta lo que se paga. Un bono marcado que
		/// se colara seguiría sumando.
		where.deleted_at = null

		const bonos = await prisma.registro_dia_laboral_bono.findMany({
			where,
			include: {
				config_liquidacion: {
					select: {
						id: true,
						nombre: true,
						valor: true,
						anio: true,
						activo: true
					}
				},
				registro_dia: {
					select: {
						id: true,
						fecha: true,
						conductor_id: true
					}
				},
				segmento: {
					select: {
						id: true,
						vehiculo_id: true,
						vehiculo_placa: true
					}
				}
			},
			orderBy: { created_at: 'asc' }
		})

		// Normalizamos `valor` (Decimal) a Number para que el frontend
		// no tenga que parsearlo. Aplanamos los joins a campos top-level
		// para que el frontend los consuma más fácil.
		return bonos.map((b) => ({
			id: b.id,
			registro_dia_id: b.registro_dia_id,
			segmento_id: b.segmento_id,
			config_liquidacion_id: b.config_liquidacion_id,
			valor: b.valor !== null && b.valor !== undefined ? Number(b.valor) : null,
			creado_por_id: b.creado_por_id,
			observaciones: b.observaciones,
			created_at: b.created_at,
			updated_at: b.updated_at,
			config_liquidacion: b.config_liquidacion
				? { ...b.config_liquidacion, valor: Number(b.config_liquidacion.valor) }
				: null,
			fecha: b.registro_dia?.fecha ?? null,
			conductor_id: b.registro_dia?.conductor_id ?? null,
			vehiculo_id: b.segmento?.vehiculo_id ?? null,
			vehiculo_placa: b.segmento?.vehiculo_placa ?? null
		}))
	},

	// ─────────────────────────────────────────────
	// SINCRONIZAR: aplicar diff entre estado cliente y BD.
	// Crea los bonos nuevos y elimina los que el usuario desmarcó.
	// Devuelve { created, deleted, total }.
	// ─────────────────────────────────────────────
	async sincronizar(input: SincronizarBonosInput, creadoPorId: string) {
		const { crear, eliminar } = input
		let created = 0
		let deleted = 0

		// Pre-cargar las configs referenciadas para (a) validar que existan
		// y estén activas, (b) hidratar `valor` con el snapshot al momento
		// de crear el bono.
		const configIds = Array.from(new Set(crear.map((b) => b.config_liquidacion_id)))
		const configs =
			configIds.length > 0
				? await prisma.configuraciones_liquidacion.findMany({
						where: { id: { in: configIds } }
					})
				: []
		const configById = new Map(configs.map((c) => [c.id, c]))

		await prisma.$transaction(
			async (tx) => {
			// 1) Retirar los bonos que el usuario desmarcó
			//
			//    Se MARCAN, no se borran. Antes desaparecían sin rastro: si
			//    alguien desmarcaba un bono por error, no había forma de saber
			//    cuál era ni cuánto valía. Todas las lecturas filtran por
			//    `deleted_at IS NULL`, así que el efecto visible es el mismo.
			if (eliminar.length > 0) {
				const result = await tx.registro_dia_laboral_bono.updateMany({
					where: { id: { in: eliminar }, deleted_at: null },
					data: { deleted_at: new Date() }
				})
				deleted = result.count
			}

			// 2) Crear los bonos nuevos (ignorar duplicados por si el cliente
			//    envió dos veces el mismo bono)
			for (const b of crear) {
				const cfg = configById.get(b.config_liquidacion_id)
				if (!cfg) {
					throw {
						statusCode: 400,
						message: `configuraciones_liquidacion ${b.config_liquidacion_id} no existe`
					}
				}
				if (!cfg.activo) {
					throw {
						statusCode: 400,
						message: `configuraciones_liquidacion ${cfg.nombre} no está activa`
					}
				}
			try {
				await tx.registro_dia_laboral_bono.create({
					data: {
						id: randomUUID(),
						// Prisma 5: usar RELACIONES (no FKs directos) para todos
						// los campos de relación.
						registro_dia: { connect: { id: b.registro_dia_id } },
						config_liquidacion: { connect: { id: b.config_liquidacion_id } },
						...(b.segmento_id
							? { segmento: { connect: { id: b.segmento_id } } }
							: {}),
						...(creadoPorId
							? { creado_por: { connect: { id: creadoPorId } } }
							: {}),
						valor: cfg.valor,
						observaciones: b.observaciones ?? null
					}
					})
					created += 1
				} catch (err: any) {
					// Si es unique-constraint, ya existe → ignorar silenciosamente
					if (err?.code !== 'P2002') throw err
				}
			}
		},
		{
			// El sync puede crear/eliminar muchos bonos en una sola llamada
			// (paginación grande + varios tramos). 30s es holgado para
			// los casos reales sin bloquear otras queries.
			timeout: 30_000,
			maxWait: 5_000
		}
		)

		return { created, deleted, total: created - deleted }
	},

	// ─────────────────────────────────────────────
	// CREAR (uno solo) — útil para llamadas programáticas
	// ─────────────────────────────────────────────
	async crear(input: BonoInput, creadoPorId: string) {
		const cfg = await prisma.configuraciones_liquidacion.findUnique({
			where: { id: input.config_liquidacion_id }
		})
		if (!cfg) {
			throw { statusCode: 400, message: 'configuraciones_liquidacion no existe' }
		}
		if (!cfg.activo) {
			throw { statusCode: 400, message: `La configuración ${cfg.nombre} no está activa` }
		}
		try {
			const bono = await prisma.registro_dia_laboral_bono.create({
				data: {
					id: randomUUID(),
					// Prisma 5: usar RELACIONES (no FKs directos) para todos
					// los campos de relación.
					registro_dia: { connect: { id: input.registro_dia_id } },
					config_liquidacion: { connect: { id: input.config_liquidacion_id } },
					...(input.segmento_id
						? { segmento: { connect: { id: input.segmento_id } } }
						: {}),
					...(creadoPorId
						? { creado_por: { connect: { id: creadoPorId } } }
						: {}),
					valor: cfg.valor,
					observaciones: input.observaciones ?? null
				},
				include: {
					config_liquidacion: {
						select: { id: true, nombre: true, valor: true, anio: true, activo: true }
					}
				}
			})
			return {
				...bono,
				valor: bono.valor !== null ? Number(bono.valor) : null,
				config_liquidacion: bono.config_liquidacion
					? { ...bono.config_liquidacion, valor: Number(bono.config_liquidacion.valor) }
					: null
			}
		} catch (err: any) {
			if (err?.code === 'P2002') {
				throw { statusCode: 409, message: 'Este bono ya existe para el recorrido seleccionado' }
			}
			throw err
		}
	},

	// ─────────────────────────────────────────────
	// ELIMINAR (uno solo)
	// ─────────────────────────────────────────────
	async eliminar(id: string) {
		const bono = await prisma.registro_dia_laboral_bono.findUnique({ where: { id } })
		/// Un bono ya marcado se trata como inexistente: quien lo pida otra vez
		/// debe recibir 404, no un 200 que sugiera que se borró dos veces.
		if (!bono || bono.deleted_at) throw { statusCode: 404, message: 'Bono no encontrado' }
		await prisma.registro_dia_laboral_bono.update({
			where: { id },
			data: { deleted_at: new Date() }
		})
		return { id, message: 'Bono eliminado' }
	}
}
