/**
 * Rutas de solicitudes web.
 *  - `POST /public/solicitudes`: la landing, sin sesión. Límite por IP y
 *    validación estricta: es la única puerta anónima que escribe en la base.
 *  - `/solicitudes/*`: la bandeja del panel; leer pide `read` sobre
 *    `solicitudes`, gestionar pide `full`.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { ZodError } from 'zod'
import { authMiddleware } from '../../middlewares/auth.middleware'
import { requirePermission } from '../../middlewares/permissions.middleware'
import { excedeLimite } from './limitador'
import { crearSolicitudPublicaSchema, gestionarSolicitudSchema, listarSolicitudesSchema } from './solicitudes-web.schema'
import { crearDesdeLanding, detalle, gestionar, listar, resumenPendientes, SolicitudesWebError } from './solicitudes-web.service'

type ConId = FastifyRequest<{ Params: { id: string } }>

function responderError(request: FastifyRequest, reply: FastifyReply, err: unknown, mensaje: string) {
  if (err instanceof ZodError) {
    return reply.status(422).send({
      success: false,
      message: 'Datos inválidos',
      details: err.errors.map((e) => `${e.path.join('.') || 'campo'}: ${e.message}`)
    })
  }
  if (err instanceof SolicitudesWebError) {
    return reply.status(err.status).send({ success: false, message: err.message, code: err.code })
  }
  request.log.error({ err }, `[solicitudes-web] ${mensaje}`)
  return reply.status(500).send({ success: false, message: mensaje })
}

function ipDe(request: FastifyRequest): string | null {
  const xff = request.headers['x-forwarded-for']
  const primera = Array.isArray(xff) ? xff[0] : xff?.split(',')[0]?.trim()
  return primera || request.ip || null
}

export async function solicitudesWebPublicRoutes(app: FastifyInstance) {
  app.post('/public/solicitudes', async (request, reply) => {
    const ip = ipDe(request)
    // 5 envíos por hora y 20 por día desde la misma IP. Una oficina con NAT no
    // manda más que eso; un script sí.
    if (ip && (excedeLimite(`h:${ip}`, 5, 3_600_000) || excedeLimite(`d:${ip}`, 20, 86_400_000))) {
      return reply.status(429).send({ success: false, message: 'Has enviado varias solicitudes seguidas. Intenta de nuevo más tarde.' })
    }
    try {
      const input = crearSolicitudPublicaSchema.parse(request.body ?? {})
      const r = await crearDesdeLanding(input, {
        ip,
        userAgent: (request.headers['user-agent'] as string) ?? null,
        referer: (request.headers['referer'] as string) ?? null
      })
      return reply.status(201).send({ success: true, radicado: r.radicado, urgente: r.urgente })
    } catch (err) {
      return responderError(request, reply, err, 'No se pudo registrar la solicitud. Intenta de nuevo.')
    }
  })
}

export async function solicitudesWebRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authMiddleware)
  const puedeLeer = { preHandler: requirePermission('solicitudes', 'read') }
  const puedeGestionar = { preHandler: requirePermission('solicitudes', 'full') }

  app.get('/solicitudes', puedeLeer, async (request, reply) => {
    try {
      return reply.send({ success: true, ...(await listar(listarSolicitudesSchema.parse(request.query ?? {}))) })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible listar las solicitudes')
    }
  })

  app.get('/solicitudes/resumen', puedeLeer, async (request, reply) => {
    try {
      return reply.send({ success: true, ...(await resumenPendientes()) })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible contar las solicitudes')
    }
  })

  app.get('/solicitudes/:id', puedeLeer, async (request: ConId, reply) => {
    try {
      return reply.send({ success: true, solicitud: await detalle(request.params.id) })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible abrir la solicitud')
    }
  })

  app.patch('/solicitudes/:id', puedeGestionar, async (request: ConId, reply) => {
    try {
      const user = (request as any).user as { id: string; nombre?: string; name?: string }
      const cambios = gestionarSolicitudSchema.parse(request.body ?? {})
      const s = await gestionar(request.params.id, cambios, { id: user.id, nombre: user.nombre ?? user.name ?? 'Usuario' })
      return reply.send({ success: true, solicitud: s })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible actualizar la solicitud')
    }
  })
}
