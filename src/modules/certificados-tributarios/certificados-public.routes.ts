import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { listNitDocuments, S3ConfigError } from './certificados.s3'

const nitSchema = z.string().regex(/^\d{6,15}$/)

export async function certificadosPublicosRoutes(app: FastifyInstance) {
	app.get('/public/certificados-tributarios/:nit', {
		schema: {
			description: 'Portal público: lista los documentos de un NIT con URLs firmadas',
			tags: ['certificados-tributarios-public']
		}
	}, async (request, reply) => {
		try {
			const nit = (request.params as any).nit
			const parsed = nitSchema.safeParse(nit)
			if (!parsed.success) {
				return reply
					.status(400)
					.send({ success: false, code: 'invalid_nit', error: 'NIT inválido' })
			}

			const { documentos, carpetas } = await listNitDocuments(parsed.data)

			if (documentos.length === 0 && carpetas.length === 0) {
				return reply
					.status(404)
					.send({
						success: false,
						code: 'not_found',
						nit: parsed.data,
						error: `No se encontraron certificados para el NIT ${parsed.data}.`,
						documentos: [],
						carpetas: []
					})
			}

			return reply.send({
				success: true,
				nit: parsed.data,
				documentos,
				carpetas,
				total: documentos.length
			})
		} catch (err: any) {
			if (err instanceof S3ConfigError) {
				return reply.status(500).send({ error: err.message, code: 'config_error' })
			}
			console.error('Error portal público certificados:', err)
			return reply
				.status(500)
				.send({ error: 'Error al obtener los certificados', details: err?.message })
		}
	})
}
