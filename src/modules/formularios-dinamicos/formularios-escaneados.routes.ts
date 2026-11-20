import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import { requirePermission } from '../../middlewares/permissions.middleware'
import { isFormError } from './domain'
import * as escaneados from './formularios-escaneados.service'
import { fechaEscaneadoSchema, nuevoEscaneadoSchema } from './formularios-escaneados.schema'

const id = z.string().uuid()

function fail(reply: FastifyReply, error: unknown) {
  if (isFormError(error)) return reply.status(error.status).send(error.toBody())
  if (error instanceof z.ZodError)
    return reply.status(400).send({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: error.issues[0]?.message ?? 'Datos inválidos.',
      },
    })
  reply.log.error({ err: error }, 'Error al gestionar un PDF escaneado de formulario')
  return reply.status(500).send({
    success: false,
    error: { code: 'INTERNAL_ERROR', message: 'No se pudo procesar el PDF escaneado.' },
  })
}

/** Estas rutas viven dentro del módulo autenticado de formularios. */
export function registrarRutasEscaneados(app: FastifyInstance) {
  const leer = { preHandler: requirePermission('formularios', 'read') }
  const editar = { preHandler: requirePermission('formularios', 'full') }
  app.get('/formularios/escaneados/opciones', leer, async (request, reply) => {
    try {
      const { q } = z.object({ q: z.string().max(100).default('') }).parse(request.query)
      return reply.send({ success: true, data: await escaneados.opcionesEscaneados(q) })
    } catch (error) {
      return fail(reply, error)
    }
  })
  app.get('/formularios/escaneados', leer, async (request, reply) => {
    try {
      const query = z
        .object({
          page: z.coerce.number().int().min(1).default(1),
          search: z.string().max(100).optional(),
          coveredOn: fechaEscaneadoSchema.optional(),
        })
        .parse(request.query)
      return reply.send({
        success: true,
        data: await escaneados.listarEscaneados(
          query as { page: number; search?: string; coveredOn?: string },
        ),
      })
    } catch (error) {
      return fail(reply, error)
    }
  })
  app.post('/formularios/escaneados/init', editar, async (request, reply) => {
    try {
      const input = nuevoEscaneadoSchema.parse(request.body)
      const actorId = id.parse((request as any).user?.id)
      return reply.status(201).send({
        success: true,
        data: await escaneados.iniciarEscaneado(input as escaneados.NuevoEscaneado, actorId),
      })
    } catch (error) {
      return fail(reply, error)
    }
  })
  app.post('/formularios/escaneados/:id/complete', editar, async (request, reply) => {
    try {
      return reply.send({
        success: true,
        data: await escaneados.completarEscaneado(id.parse((request.params as any).id)),
      })
    } catch (error) {
      return fail(reply, error)
    }
  })
  app.get('/formularios/escaneados/:id/url', leer, async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    try {
      return reply.send({
        success: true,
        data: await escaneados.urlEscaneado(id.parse((request.params as any).id)),
      })
    } catch (error) {
      return fail(reply, error)
    }
  })
}
