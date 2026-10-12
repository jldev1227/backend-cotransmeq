/**
 * Rutas de combustible. Leer pide `combustible` en `read` (contabilidad y HSEQ
 * consultan); registrar, corregir, retirar y subir comprobantes piden `full`
 * (administración, operaciones y mantenimiento).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { ZodError } from 'zod'
import { authMiddleware } from '../../middlewares/auth.middleware'
import { requirePermission } from '../../middlewares/permissions.middleware'
import { contextoSchema, filtrosSchema, tanqueoSchema } from './combustible.schema'
import { CombustibleError, CombustibleService } from './combustible.service'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/// Mismo tope y tipos que los documentos del vehículo; en el navegador las
/// fotos ya llegan comprimidas (1800 px, JPEG 0,75).
const MAX_BYTES = 15 * 1024 * 1024
const TIPOS = /^(application\/pdf|image\/(png|jpe?g|webp))$/

type ConId = FastifyRequest<{ Params: { id: string } }>

/// Un id mal formado llegaba hasta Prisma y salía como 500.
async function validarId(request: FastifyRequest, reply: FastifyReply) {
  const { id } = (request.params ?? {}) as { id?: string }
  if (id !== undefined && !UUID.test(id)) {
    return reply.status(400).send({ success: false, message: 'Identificador inválido' })
  }
}

function responderError(request: FastifyRequest, reply: FastifyReply, err: unknown, mensaje: string) {
  if (err instanceof ZodError) {
    return reply.status(400).send({
      success: false,
      message: err.errors[0]?.message ?? 'Datos inválidos',
      details: err.errors.map((e) => `${e.path.join('.') || 'campo'}: ${e.message}`),
    })
  }
  if (err instanceof CombustibleError) {
    return reply.status(err.status).send({ success: false, message: err.message, code: err.code })
  }
  request.log.error({ err }, `[combustible] ${mensaje}`)
  return reply.status(500).send({ success: false, message: mensaje })
}

const usuarioId = (request: FastifyRequest) => ((request as any).user?.id as string | undefined) ?? null

export async function combustibleRoutes(app: FastifyInstance) {
  const leer = { preHandler: [authMiddleware, requirePermission('combustible', 'read'), validarId] }
  const escribir = { preHandler: [authMiddleware, requirePermission('combustible', 'full'), validarId] }

  app.get('/combustible/catalogos', leer, async (request, reply) => {
    try {
      return reply.send({ success: true, data: await CombustibleService.catalogos() })
    } catch (err) {
      return responderError(request, reply, err, 'No se pudieron cargar vehículos y conductores')
    }
  })

  app.get('/combustible/tanqueos', leer, async (request, reply) => {
    try {
      return reply.send({ success: true, ...(await CombustibleService.listar(filtrosSchema.parse(request.query ?? {}))) })
    } catch (err) {
      return responderError(request, reply, err, 'No se pudieron listar los tanqueos')
    }
  })

  app.get('/combustible/tanqueos/exportar', leer, async (request, reply) => {
    try {
      const filtros = filtrosSchema.parse(request.query ?? {})
      const csv = await CombustibleService.exportarCsv(filtros)
      const sufijo = [filtros.desde, filtros.hasta].filter(Boolean).join('_a_') || new Date().toISOString().slice(0, 10)
      reply.header('Content-Type', 'text/csv; charset=utf-8')
      reply.header('Content-Disposition', `attachment; filename="tanqueos-${sufijo}.csv"`)
      reply.header('Cache-Control', 'no-store')
      return reply.send(csv)
    } catch (err) {
      return responderError(request, reply, err, 'No se pudo exportar')
    }
  })

  app.get('/combustible/rendimiento', leer, async (request, reply) => {
    try {
      return reply.send({ success: true, ...(await CombustibleService.rendimientoPorVehiculo(filtrosSchema.parse(request.query ?? {}))) })
    } catch (err) {
      return responderError(request, reply, err, 'No se pudo calcular el rendimiento')
    }
  })

  app.get('/combustible/vehiculos/:id/contexto', leer, async (request: ConId, reply) => {
    try {
      const q = contextoSchema.parse(request.query ?? {})
      return reply.send({ success: true, data: await CombustibleService.contexto(request.params.id, q.fecha_hora, q.excluir) })
    } catch (err) {
      return responderError(request, reply, err, 'No se pudo consultar el vehículo')
    }
  })

  app.post('/combustible/tanqueos', escribir, async (request, reply) => {
    try {
      const tanqueo = await CombustibleService.crear(tanqueoSchema.parse(request.body ?? {}), usuarioId(request))
      return reply.status(201).send({ success: true, data: tanqueo })
    } catch (err) {
      return responderError(request, reply, err, 'No se pudo registrar el tanqueo')
    }
  })

  app.put('/combustible/tanqueos/:id', escribir, async (request: ConId, reply) => {
    try {
      const tanqueo = await CombustibleService.actualizar(request.params.id, tanqueoSchema.parse(request.body ?? {}), usuarioId(request))
      return reply.send({ success: true, data: tanqueo })
    } catch (err) {
      return responderError(request, reply, err, 'No se pudo actualizar el tanqueo')
    }
  })

  app.delete('/combustible/tanqueos/:id', escribir, async (request: ConId, reply) => {
    try {
      await CombustibleService.eliminar(request.params.id, usuarioId(request))
      return reply.send({ success: true })
    } catch (err) {
      return responderError(request, reply, err, 'No se pudo eliminar el tanqueo')
    }
  })

  /// multipart con un solo archivo `archivo`. Va aparte del JSON del tanqueo
  /// para validar los datos con zod antes de subir nada a S3: un tanqueo
  /// rechazado no deja un objeto huérfano en el bucket.
  app.post('/combustible/tanqueos/:id/comprobante', escribir, async (request: ConId, reply) => {
    try {
      const parte = await (request as any).file()
      if (!parte) return reply.status(400).send({ success: false, message: 'Falta el archivo' })
      if (!TIPOS.test(parte.mimetype)) return reply.status(400).send({ success: false, message: 'El comprobante debe ser PDF o imagen' })
      const buffer: Buffer = await parte.toBuffer()
      if (buffer.length > MAX_BYTES) return reply.status(413).send({ success: false, message: 'El comprobante supera 15 MB' })
      const tanqueo = await CombustibleService.subirComprobante(
        request.params.id,
        { buffer, nombre: parte.filename || 'comprobante', mimetype: parte.mimetype },
        usuarioId(request),
      )
      return reply.send({ success: true, data: tanqueo })
    } catch (err) {
      return responderError(request, reply, err, 'No se pudo subir el comprobante')
    }
  })

  app.delete('/combustible/tanqueos/:id/comprobante', escribir, async (request: ConId, reply) => {
    try {
      return reply.send({ success: true, data: await CombustibleService.quitarComprobante(request.params.id, usuarioId(request)) })
    } catch (err) {
      return responderError(request, reply, err, 'No se pudo quitar el comprobante')
    }
  })

  app.get('/combustible/tanqueos/:id/comprobante/url', leer, async (request: ConId, reply) => {
    try {
      return reply.send({ success: true, data: { url: await CombustibleService.urlComprobante(request.params.id) } })
    } catch (err) {
      return responderError(request, reply, err, 'No se pudo abrir el comprobante')
    }
  })
}
