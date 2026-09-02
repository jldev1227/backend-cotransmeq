// @ts-nocheck
import { prisma } from '../../config/prisma'
import type {
	CreateCustomPlaceInput,
	UpdateCustomPlaceInput,
	SearchCustomPlaceInput
} from './custom-places.schema'

/**
 * Convierte un row de Prisma al shape que consume el frontend
 * (consistente con la respuesta de HERE en /api/maps/autocomplete).
 */
function toApiShape(row: any) {
	return {
		id: `local:cp:${row.id}`,
		// El `id` interno (UUID) por si se necesita consultar a NestJS
		_id: row.id,
		nombre: row.nombre,
		title: row.nombre,
		categoria: row.categoria,
		descripcion: row.descripcion,
		subtitle: row.categoria
			? `${row.categoria}${row.direccion ? ' · ' + row.direccion : ''}`
			: row.direccion ?? null,
		address: row.direccion ?? row.nombre,
		latitud: Number(row.latitud),
		longitud: Number(row.longitud),
		veces_usado: row.veces_usado,
		source: 'local'
	}
}

export const CustomPlacesService = {
	/**
	 * Crea un nuevo lugar personalizado.
	 * `creado_por_id` es el id del usuario autenticado (FK a usuarios).
	 */
	async create(data: CreateCustomPlaceInput, creado_por_id: string) {
		return prisma.custom_places.create({
			data: {
				nombre: data.nombre,
				categoria: data.categoria ?? null,
				descripcion: data.descripcion ?? null,
				direccion: data.direccion ?? null,
				latitud: data.latitud,
				longitud: data.longitud,
				municipio_id: data.municipio_id ?? null,
				creado_por_id
			}
		})
	},

	/**
	 * Búsqueda por nombre (case-insensitive substring match).
	 * Ordena por:
	 *   1. Coincidencia exacta (ignorando mayúsculas)
	 *   2. Coincidencia por prefijo
	 *   3. veces_usado DESC (los más usados primero)
	 *   4. nombre alfabético
	 */
	async search(params: SearchCustomPlaceInput) {
		const { q, categoria, limit } = params

		const where: any = {
			activo: true,
			deleted_at: null
		}

		if (categoria) where.categoria = categoria

		if (q && q.trim().length > 0) {
			// Postgres: ILIKE = case-insensitive LIKE
			where.nombre = { contains: q.trim(), mode: 'insensitive' }
		}

		const rows = await prisma.custom_places.findMany({
			where,
			orderBy: [{ veces_usado: 'desc' }, { nombre: 'asc' }],
			take: limit
		})

		return rows.map(toApiShape)
	},

	async findById(id: string) {
		return prisma.custom_places.findUnique({ where: { id } })
	},

	/**
	 * Busca por id interno (UUID de la tabla) y devuelve el shape API
	 * con coordenadas listas para guardar en un servicio.
	 */
	async lookupById(id: string) {
		const row = await prisma.custom_places.findUnique({ where: { id } })
		if (!row || !row.activo || row.deleted_at) return null
		// Incrementar contador de uso (no bloquea la respuesta si falla)
		prisma.custom_places
			.update({ where: { id }, data: { veces_usado: { increment: 1 } } })
			.catch(() => {})
		return {
			...toApiShape(row),
			lat: Number(row.latitud),
			lng: Number(row.longitud)
		}
	},

	async update(id: string, data: UpdateCustomPlaceInput) {
		return prisma.custom_places.update({ where: { id }, data })
	},

	async softDelete(id: string) {
		return prisma.custom_places.update({
			where: { id },
			data: { activo: false, deleted_at: new Date() }
		})
	}
}
