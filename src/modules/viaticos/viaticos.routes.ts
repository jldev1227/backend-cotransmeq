/**
 * Rutas del panel para viáticos. Leer exige `read` sobre `viaticos`; crear,
 * editar, anular y resolver solicitudes, `full` (administración y operaciones).
 * La lógica vive en `viaticos.service.ts`.
 */

import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import { authMiddleware } from '../../middlewares/auth.middleware'
import { requirePermission } from '../../middlewares/permissions.middleware'
import { leerComprobante } from './viaticos-comprobante.service'
import {
  actualizarAnticipo,
  anularGasto,
  crearAnticipo,
  detalleAnticipo,
  detalleSolicitud,
  firmarSubidaComprobante,
  listarAnticipos,
  listarSolicitudes,
  parsear,
  rechazarSolicitud,
  retirarAnticipo,
  ViaticosError
} from './viaticos.service'
import { z } from 'zod'

type ConId = FastifyRequest<{ Params: { id: string } }>

function responderError(request: FastifyRequest, reply: FastifyReply, err: unknown, mensaje: string) {
  if (err instanceof ViaticosError) {
    return reply.status(err.status).send({ success: false, message: err.message, code: err.code })
  }
  request.log.error({ err }, `[viaticos] ${mensaje}`)
  return reply.status(500).send({ success: false, message: mensaje })
}

const usuarioId = (request: FastifyRequest) => (request as any).user?.id as string

const leerSchema = z.object({
  key: z.string().min(1).max(300),
  mime_type: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
})

export async function viaticosRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authMiddleware)
  const puedeLeer = { preHandler: requirePermission('viaticos', 'read') }
  const puedeEscribir = { preHandler: requirePermission('viaticos', 'full') }

  app.get('/viaticos/anticipos', puedeLeer, async (request, reply) => {
    try {
      return reply.send({ success: true, ...(await listarAnticipos(request.query)) })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible listar los anticipos')
    }
  })

  app.get('/viaticos/anticipos/:id', puedeLeer, async (request: ConId, reply) => {
    try {
      return reply.send({ success: true, data: await detalleAnticipo(request.params.id) })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible cargar el anticipo')
    }
  })

  app.post('/viaticos/anticipos', puedeEscribir, async (request, reply) => {
    try {
      return reply.status(201).send({ success: true, data: await crearAnticipo(usuarioId(request), request.body) })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible registrar el anticipo')
    }
  })

  app.put('/viaticos/anticipos/:id', puedeEscribir, async (request: ConId, reply) => {
    try {
      return reply.send({ success: true, data: await actualizarAnticipo(usuarioId(request), request.params.id, request.body) })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible actualizar el anticipo')
    }
  })

  app.delete('/viaticos/anticipos/:id', puedeEscribir, async (request: ConId, reply) => {
    try {
      return reply.send({ success: true, data: await retirarAnticipo(usuarioId(request), request.params.id) })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible eliminar el anticipo')
    }
  })

  app.post('/viaticos/comprobantes/presign', puedeEscribir, async (request, reply) => {
    try {
      return reply.send({ success: true, data: await firmarSubidaComprobante(usuarioId(request), request.body) })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible preparar la subida del comprobante')
    }
  })

  app.post('/viaticos/comprobantes/leer', puedeEscribir, async (request, reply) => {
    try {
      const input = parsear(leerSchema, request.body)
      if (!input.key.startsWith('viaticos/comprobantes/') || input.key.includes('..')) {
        throw new ViaticosError('El comprobante no es válido.', 400, 'COMPROBANTE_INVALIDO')
      }
      return reply.send({ success: true, data: await leerComprobante(input.key, input.mime_type) })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible leer el comprobante')
    }
  })

  app.post('/viaticos/gastos/:id/anular', puedeEscribir, async (request: ConId, reply) => {
    try {
      return reply.send({ success: true, data: await anularGasto(usuarioId(request), request.params.id, request.body) })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible anular el gasto')
    }
  })

  app.get('/viaticos/solicitudes', puedeLeer, async (request, reply) => {
    try {
      return reply.send({ success: true, data: await listarSolicitudes(request.query) })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible listar las solicitudes')
    }
  })

  app.get('/viaticos/solicitudes/:id', puedeLeer, async (request: ConId, reply) => {
    try {
      return reply.send({ success: true, data: await detalleSolicitud(request.params.id) })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible cargar la solicitud')
    }
  })

  app.post('/viaticos/solicitudes/:id/rechazar', puedeEscribir, async (request: ConId, reply) => {
    try {
      return reply.send({ success: true, data: await rechazarSolicitud(usuarioId(request), request.params.id, request.body) })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible rechazar la solicitud')
    }
  })
}
