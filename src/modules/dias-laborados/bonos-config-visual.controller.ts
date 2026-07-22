import { FastifyReply, FastifyRequest } from 'fastify'
import { BonoConfigVisualService } from './bonos-config-visual.service'
import {
	guardarBonoConfigVisualSchema,
	listarBonoConfigVisualSchema
} from './bonos-config-visual.schema'

/**
 * Controller — Visibilidad de Bonos de Planilla
 *
 *  - GET  /api/dias-laborados/bonos-config-visual?anio=YYYY
 *      → Devuelve las configs activas del año con flag `visible` resuelto.
 *        (Lectura libre para usuarios autenticados.)
 *
 *  - PUT  /api/dias-laborados/bonos-config-visual
 *      → Reemplaza en bloque la selección de visibilidad para un año.
 *        (Escritura protegida por `bonos-planilla` en la ruta.)
 */
export const BonoConfigVisualController = {
	async listar(request: FastifyRequest, reply: FastifyReply) {
		try {
			const parsed = listarBonoConfigVisualSchema.parse(request.query)
			const data = await BonoConfigVisualService.listar(parsed)
			return reply.send({ success: true, data })
		} catch (err: any) {
			const status = err.statusCode || 500
			return reply.status(status).send({
				success: false,
				message: err.message || 'Error al listar configuraciones visuales de bonos'
			})
		}
	},

	async guardar(request: FastifyRequest, reply: FastifyReply) {
		try {
			const user = (request as any).user
			const parsed = guardarBonoConfigVisualSchema.parse(request.body)
			const data = await BonoConfigVisualService.guardar(parsed, user.id)
			return reply.send({
				success: true,
				message: 'Visibilidad de bonos actualizada',
				data
			})
		} catch (err: any) {
			const status = err.statusCode || 500
			return reply.status(status).send({
				success: false,
				message: err.message || 'Error al guardar visibilidad de bonos'
			})
		}
	}
}
