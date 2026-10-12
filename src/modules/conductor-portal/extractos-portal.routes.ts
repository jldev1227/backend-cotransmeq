/**
 * Extractos (FUEC) y documentos del vehículo en el portal del conductor. Se
 * registran DENTRO del bloque protegido de `conductor-portal.routes.ts`: el
 * conductor sale del token (`request.conductorPortal.id`), nunca de la URL.
 * El token de impresión del desprendible no entra aquí: el middleware lo
 * limita a su única ruta.
 */
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'

import {
  PortalExtractosError,
  documentosVehiculosDelConductor,
  listarExtractosDelConductor,
  obtenerExtractoDelConductor,
  pdfExtractoDelConductor,
  urlDocumentoDelConductor
} from './extractos-portal.service'

const conductorId = (request: FastifyRequest) => (request as any).conductorPortal.id as string

const uuid = z.string().uuid()

function responderError(request: FastifyRequest, reply: FastifyReply, err: unknown, mensaje: string) {
  if (err instanceof PortalExtractosError) {
    return reply.status(err.status).send({ success: false, message: err.message, code: err.code })
  }
  request.log.error({ err }, `[extractos-portal] ${mensaje}`)
  return reply.status(500).send({ success: false, message: mensaje })
}

/** Un id que no es UUID ni llega a la base: Postgres lo rechazaría con un 500. */
function idsValidos(reply: FastifyReply, ...ids: string[]) {
  if (ids.every((id) => uuid.safeParse(id).success)) return true
  reply.status(400).send({ success: false, message: 'Identificador no válido', code: 'ID_INVALIDO' })
  return false
}

type P<T> = FastifyRequest<{ Params: T }>

export function registrarExtractosPortal(app: FastifyInstance) {
  app.get('/conductor-portal/extractos', async (request, reply) => {
    try {
      return reply.send({ success: true, data: await listarExtractosDelConductor(conductorId(request)) })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible cargar tus extractos')
    }
  })

  app.get('/conductor-portal/extractos/:id', async (request: P<{ id: string }>, reply) => {
    if (!idsValidos(reply, request.params.id)) return reply
    try {
      return reply.send({ success: true, data: await obtenerExtractoDelConductor(conductorId(request), request.params.id) })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible cargar el extracto')
    }
  })

  /// El mismo PDF que descarga el dashboard (`pdfExtractoDoc.ts` es espejo
  /// del front), con QR, logo, firma y la página de la resolución.
  app.get('/conductor-portal/extractos/:id/pdf', async (request: P<{ id: string }>, reply) => {
    if (!idsValidos(reply, request.params.id)) return reply
    try {
      const { buffer, nombre } = await pdfExtractoDelConductor(conductorId(request), request.params.id)
      reply.header('Content-Type', 'application/pdf')
      reply.header('Content-Disposition', `inline; filename="${nombre}"`)
      reply.header('Cache-Control', 'private, no-store')
      return reply.send(buffer)
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible generar el PDF del extracto')
    }
  })

  app.get('/conductor-portal/vehiculos/documentos', async (request, reply) => {
    try {
      return reply.send({ success: true, data: await documentosVehiculosDelConductor(conductorId(request)) })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible cargar los documentos del vehículo')
    }
  })

  app.get(
    '/conductor-portal/vehiculos/:vehiculoId/documentos/:documentoId/url',
    async (request: P<{ vehiculoId: string; documentoId: string }>, reply) => {
      const { vehiculoId, documentoId } = request.params
      if (!idsValidos(reply, vehiculoId, documentoId)) return reply
      try {
        return reply.send({ success: true, data: await urlDocumentoDelConductor(conductorId(request), vehiculoId, documentoId) })
      } catch (err) {
        return responderError(request, reply, err, 'No fue posible abrir el documento')
      }
    }
  )
}
