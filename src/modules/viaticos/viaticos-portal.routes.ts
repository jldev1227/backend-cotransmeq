/**
 * Viáticos en el portal del conductor. Se registran DENTRO del bloque
 * protegido de `conductor-portal.routes.ts`: el conductor sale del token
 * (`request.conductorPortal.id`), nunca del cuerpo ni de la URL.
 *
 * Consultar lo pueden la app y el portal web; reportar gastos y solicitar más
 * dinero, solo la app (la web no muestra esos botones).
 */

import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import {
  anticiposDelConductor,
  completarAdjuntoGasto,
  crearSolicitud,
  detalleAnticipo,
  iniciarAdjuntoGasto,
  registrarGasto,
  ViaticosError
} from './viaticos.service'

const conductorId = (request: FastifyRequest) => (request as any).conductorPortal.id as string

function responderError(request: FastifyRequest, reply: FastifyReply, err: unknown, mensaje: string) {
  if (err instanceof ViaticosError) {
    return reply.status(err.status).send({ success: false, message: err.message, code: err.code })
  }
  request.log.error({ err }, `[viaticos-portal] ${mensaje}`)
  return reply.status(500).send({ success: false, message: mensaje })
}

type P<T> = FastifyRequest<{ Params: T }>

export function registrarViaticosPortal(app: FastifyInstance) {
  app.get('/conductor-portal/viaticos', async (request, reply) => {
    try {
      return reply.send({ success: true, data: await anticiposDelConductor(conductorId(request)) })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible cargar tus viáticos')
    }
  })

  app.get('/conductor-portal/viaticos/:id', async (request: P<{ id: string }>, reply) => {
    try {
      return reply.send({ success: true, data: await detalleAnticipo(request.params.id, conductorId(request)) })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible cargar el anticipo')
    }
  })

  app.post('/conductor-portal/viaticos/:id/gastos', async (request: P<{ id: string }>, reply) => {
    try {
      return reply.send({ success: true, data: await registrarGasto(conductorId(request), request.params.id, request.body) })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible registrar el gasto')
    }
  })

  app.post('/conductor-portal/viaticos/gastos/:gastoId/adjuntos/init', async (request: P<{ gastoId: string }>, reply) => {
    try {
      return reply.send({ success: true, data: await iniciarAdjuntoGasto(conductorId(request), request.params.gastoId, request.body) })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible preparar la subida de la factura')
    }
  })

  app.post(
    '/conductor-portal/viaticos/gastos/:gastoId/adjuntos/:id/complete',
    async (request: P<{ gastoId: string; id: string }>, reply) => {
      try {
        return reply.send({
          success: true,
          data: await completarAdjuntoGasto(conductorId(request), request.params.gastoId, request.params.id)
        })
      } catch (err) {
        return responderError(request, reply, err, 'No fue posible confirmar la factura')
      }
    }
  )

  app.post('/conductor-portal/viaticos/:id/solicitudes', async (request: P<{ id: string }>, reply) => {
    try {
      return reply.send({ success: true, data: await crearSolicitud(conductorId(request), request.params.id, request.body) })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible enviar la solicitud')
    }
  })
}
