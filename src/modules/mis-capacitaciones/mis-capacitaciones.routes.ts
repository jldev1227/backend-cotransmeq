/**
 * Asistencias y evaluaciones de capacitación para los usuarios del dashboard, desde la app de
 * gestión. Mismo servicio que la app del conductor (`conductor-portal/capacitaciones.service.ts`):
 * cambia solo de dónde salen los datos de quien firma.
 *
 * - `GET  /mis-capacitaciones`: asistencias por firmar, evaluaciones por responder e historial.
 * - `GET|POST /mis-capacitaciones/asistencias/:token`: ver y firmar una asistencia.
 * - `GET|POST /mis-capacitaciones/evaluaciones/:id`: ver y responder una evaluación.
 *
 * Los usuarios no tenían cédula: si falta, el POST la recibe en `numero_documento` y la guarda en
 * su perfil antes de firmar o responder.
 */

import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import { prisma } from '../../config/prisma'
import { authMiddleware } from '../../middlewares/auth.middleware'
import {
  CapacitacionesError,
  firmarAsistencia,
  listarCapacitaciones,
  obtenerAsistencia,
  obtenerEvaluacion,
  personaUsuario,
  responderEvaluacion
} from '../conductor-portal/capacitaciones.service'

function responderError(request: FastifyRequest, reply: FastifyReply, err: unknown, mensaje: string) {
  if (err instanceof CapacitacionesError) {
    return reply.status(err.status).send({ success: false, message: err.message })
  }
  request.log.error({ err }, `[mis-capacitaciones] ${mensaje}`)
  return reply.status(500).send({ success: false, message: mensaje })
}

const meta = (request: FastifyRequest) => ({
  ip: request.ip || 'unknown',
  userAgent: request.headers['user-agent'] || 'unknown'
})

const usuarioId = (request: FastifyRequest) => (request as any).user.id as string

/** La persona que firma; si aún no tiene cédula y el cuerpo la trae, la guarda primero. */
async function personaParaResponder(request: FastifyRequest) {
  const persona = await personaUsuario(usuarioId(request))
  if (persona.numero_documento) return persona
  const documento = String((request.body as { numero_documento?: unknown } | null)?.numero_documento ?? '').replace(/\D/g, '')
  if (!documento) return persona
  if (documento.length < 5 || documento.length > 15) {
    throw new CapacitacionesError('Revisa tu número de cédula', 400)
  }
  await prisma.usuarios.update({ where: { id: usuarioId(request) }, data: { numero_documento: documento } })
  return { ...persona, numero_documento: documento }
}

const tokenParams = { type: 'object', required: ['token'], properties: { token: { type: 'string' } } }
const idParams = { type: 'object', required: ['id'], properties: { id: { type: 'string' } } }

export async function misCapacitacionesRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authMiddleware)

  app.get('/mis-capacitaciones', async (request, reply) => {
    try {
      return reply.send({ success: true, data: await listarCapacitaciones(await personaUsuario(usuarioId(request))) })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible consultar las capacitaciones')
    }
  })

  app.get<{ Params: { token: string } }>('/mis-capacitaciones/asistencias/:token', { schema: { params: tokenParams } }, async (request, reply) => {
    try {
      const data = await obtenerAsistencia(request.params.token, await personaUsuario(usuarioId(request)))
      return reply.send({ success: true, data })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible consultar la asistencia')
    }
  })

  app.post<{ Params: { token: string } }>('/mis-capacitaciones/asistencias/:token', { schema: { params: tokenParams } }, async (request, reply) => {
    try {
      const data = await firmarAsistencia(request.params.token, await personaParaResponder(request), request.body, meta(request))
      return reply.status(201).send({ success: true, data })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible registrar la asistencia')
    }
  })

  app.get<{ Params: { id: string } }>('/mis-capacitaciones/evaluaciones/:id', { schema: { params: idParams } }, async (request, reply) => {
    try {
      const data = await obtenerEvaluacion(request.params.id, await personaUsuario(usuarioId(request)))
      return reply.send({ success: true, data })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible consultar la evaluación')
    }
  })

  app.post<{ Params: { id: string } }>('/mis-capacitaciones/evaluaciones/:id', { schema: { params: idParams } }, async (request, reply) => {
    try {
      const data = await responderEvaluacion(request.params.id, await personaParaResponder(request), request.body, meta(request))
      return reply.status(201).send({ success: true, data })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible registrar la evaluación')
    }
  })
}
