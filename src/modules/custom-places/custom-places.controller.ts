// @ts-nocheck
import { FastifyRequest, FastifyReply } from 'fastify'
import { CustomPlacesService } from './custom-places.service'
import {
	createCustomPlaceSchema,
	updateCustomPlaceSchema,
	searchCustomPlaceSchema
} from './custom-places.schema'

interface SearchQuery {
	q?: string
	categoria?: string
	limit?: string
}

interface IdParams {
	id: string
}

export const CustomPlacesController = {
	// GET /custom-places?q=&categoria=&limit=
	async search(
		request: FastifyRequest<{ Querystring: SearchQuery }>,
		reply: FastifyReply
	) {
		try {
			const parsed = searchCustomPlaceSchema.safeParse(request.query)
			if (!parsed.success) {
				return reply.status(400).send({
					error: 'Parámetros inválidos',
					details: parsed.error.flatten()
				})
			}
			const results = await CustomPlacesService.search(parsed.data)
			return reply.status(200).send({ results })
		} catch (error: any) {
			console.error('[custom-places] search error:', error)
			return reply
				.status(500)
				.send({ error: 'Error al buscar lugares personalizados' })
		}
	},

	// GET /custom-places/:id  (id interno = UUID)
	async findById(
		request: FastifyRequest<{ Params: IdParams }>,
		reply: FastifyReply
	) {
		try {
			const place = await CustomPlacesService.lookupById(request.params.id)
			if (!place) {
				return reply
					.status(404)
					.send({ error: 'Lugar personalizado no encontrado' })
			}
			return reply.status(200).send(place)
		} catch (error: any) {
			console.error('[custom-places] findById error:', error)
			return reply
				.status(500)
				.send({ error: 'Error al obtener lugar personalizado' })
		}
	},

	// POST /custom-places
	async create(request: FastifyRequest, reply: FastifyReply) {
		try {
			const parsed = createCustomPlaceSchema.safeParse(request.body)
			if (!parsed.success) {
				return reply.status(400).send({
					error: 'Datos inválidos',
					details: parsed.error.flatten()
				})
			}
			const creado_por_id = (request as any).user?.id
			if (!creado_por_id) {
				return reply
					.status(401)
					.send({ error: 'Usuario no autenticado' })
			}
			const created = await CustomPlacesService.create(
				parsed.data,
				creado_por_id
			)
			return reply.status(201).send({
				success: true,
				data: created
			})
		} catch (error: any) {
			console.error('[custom-places] create error:', error)
			return reply
				.status(500)
				.send({ error: 'Error al crear lugar personalizado' })
		}
	},

	// PATCH /custom-places/:id
	async update(
		request: FastifyRequest<{ Params: IdParams }>,
		reply: FastifyReply
	) {
		try {
			const parsed = updateCustomPlaceSchema.safeParse(request.body)
			if (!parsed.success) {
				return reply.status(400).send({
					error: 'Datos inválidos',
					details: parsed.error.flatten()
				})
			}
			const updated = await CustomPlacesService.update(
				request.params.id,
				parsed.data
			)
			return reply.status(200).send({ success: true, data: updated })
		} catch (error: any) {
			console.error('[custom-places] update error:', error)
			return reply
				.status(500)
				.send({ error: 'Error al actualizar lugar personalizado' })
		}
	},

	// DELETE /custom-places/:id  (soft delete)
	async remove(
		request: FastifyRequest<{ Params: IdParams }>,
		reply: FastifyReply
	) {
		try {
			const removed = await CustomPlacesService.softDelete(request.params.id)
			return reply.status(200).send({ success: true, data: removed })
		} catch (error: any) {
			console.error('[custom-places] remove error:', error)
			return reply
				.status(500)
				.send({ error: 'Error al eliminar lugar personalizado' })
		}
	}
}
