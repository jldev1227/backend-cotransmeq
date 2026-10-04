import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { authMiddleware } from '../../middlewares/auth.middleware'
import { ErrorApiToken, apiTokensService } from './api-tokens.service'

const crearSchema = z.object({ nombre: z.string().trim().min(1).max(60) })

function userId(request: FastifyRequest): string {
  return (request as any).user.id as string
}

function manejar(reply: FastifyReply, e: unknown) {
  if (e instanceof ErrorApiToken) return reply.status(e.status).send({ error: e.message, message: e.message })
  throw e
}

/** Cada usuario administra sus propias conexiones con Claude; nadie ve las de otro. */
export async function apiTokensRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware)

  app.get('/api-tokens', async (request) => apiTokensService.listar(userId(request)))

  app.post('/api-tokens', async (request, reply) => {
    const parsed = crearSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: 'Nombre inválido', message: 'Ponle un nombre a la conexión' })
    try {
      return await apiTokensService.crear(userId(request), parsed.data.nombre)
    } catch (e) {
      return manejar(reply, e)
    }
  })

  app.delete('/api-tokens/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!/^[0-9a-f-]{36}$/i.test(id)) return reply.status(400).send({ error: 'Id inválido' })
    try {
      return await apiTokensService.revocar(userId(request), id)
    } catch (e) {
      return manejar(reply, e)
    }
  })
}
