import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { authMiddleware } from '../../middlewares/auth.middleware'
import { obtenerAnaliticaIndividual } from './analitica-individual.service'

const paramsSchema = z.object({
  tipo: z.enum(['conductor', 'vehiculo', 'cliente', 'tercero']),
  id: z.string().uuid(),
})
const querySchema = z.object({
  desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  historico: z.enum(['1']).optional(),
})

export async function analiticaIndividualRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authMiddleware)
  app.get('/analitica-individual/:tipo/:id', async (request: FastifyRequest, reply) => {
    try {
      const { tipo, id } = paramsSchema.parse(request.params)
      const { desde, hasta, historico } = querySchema.parse(request.query)
      const inicio = new Date(`${desde}T00:00:00.000Z`)
      const fin = new Date(`${hasta}T23:59:59.999Z`)
      if (inicio > fin) return reply.status(422).send({ success: false, message: 'El período es inválido' })
      const data = await obtenerAnaliticaIndividual(tipo, id, { desde: inicio, hasta: fin, desdeIso: desde, hastaIso: hasta, historico: tipo === 'cliente' && historico === '1' })
      return reply.send({ success: true, data })
    } catch (error) {
      if (error instanceof z.ZodError)
        return reply.status(422).send({ success: false, message: error.errors[0]?.message ?? 'Datos inválidos' })
      const mensaje = error instanceof Error ? error.message : 'No se pudo calcular la analítica individual'
      if (/no encontrado/i.test(mensaje)) return reply.status(404).send({ success: false, message: mensaje })
      request.log.error({ err: error }, '[analitica-individual] error')
      return reply.status(500).send({ success: false, message: 'No se pudo calcular la analítica individual' })
    }
  })
}
