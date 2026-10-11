import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { authMiddleware } from '../../middlewares/auth.middleware'
import { requirePermission } from '../../middlewares/permissions.middleware'
import { VehiculosDocumentosService } from './vehiculos-documentos.service'

/**
 * Documentos de la hoja de vida del vehículo.
 *
 * Leer pide sesión (como el resto de `flota`); subir, corregir y borrar piden
 * `flota` en `full`.
 */
const MAX_BYTES = 25 * 1024 * 1024
const TIPOS = /^(application\/pdf|image\/(png|jpe?g|webp))$/

function responderError(reply: FastifyReply, error: any) {
  const status = error?.statusCode ?? 500
  return reply.status(status).send({ success: false, message: error?.message ?? 'Error interno' })
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function vehiculosDocumentosRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authMiddleware)
  /// Un id mal formado llegaba hasta Prisma y salía como 500.
  app.addHook('preValidation', async (request, reply) => {
    const { id, docId } = (request.params ?? {}) as { id?: string; docId?: string }
    if ((id !== undefined && !UUID.test(id)) || (docId !== undefined && !UUID.test(docId))) {
      return reply.status(400).send({ success: false, message: 'Identificador inválido' })
    }
  })
  const escribir = { preHandler: requirePermission('flota', 'full') }

  app.get('/vehiculos/documentos/catalogo', async (_req, reply) =>
    reply.send({ success: true, data: VehiculosDocumentosService.catalogo() }),
  )

  app.get('/vehiculos/:id/documentos', async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    try {
      return reply.send({ success: true, data: await VehiculosDocumentosService.listar(request.params.id) })
    } catch (error) {
      return responderError(reply, error)
    }
  })

  /// multipart: campos `categoria`, `fecha_vencimiento`, `fecha_expedicion`,
  /// `numero`, `emisor`, `no_aplica` ANTES del archivo `archivo` (opcional si no_aplica).
  app.post('/vehiculos/:id/documentos', escribir, async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    try {
      const campos: Record<string, string> = {}
      let archivo: { buffer: Buffer; nombre: string; mimetype: string } | undefined
      for await (const parte of (request as any).parts()) {
        if (parte.type === 'file') {
          if (!TIPOS.test(parte.mimetype)) return reply.status(400).send({ success: false, message: 'Solo PDF o imagen' })
          const buffer = await parte.toBuffer()
          if (buffer.length > MAX_BYTES) return reply.status(413).send({ success: false, message: 'El archivo supera 25 MB' })
          archivo = { buffer, nombre: parte.filename, mimetype: parte.mimetype }
        } else {
          campos[parte.fieldname] = String(parte.value ?? '')
        }
      }
      const doc = await VehiculosDocumentosService.subir({
        vehiculoId: request.params.id,
        categoria: campos.categoria,
        archivo,
        fecha_vencimiento: campos.fecha_vencimiento || null,
        fecha_expedicion: campos.fecha_expedicion || null,
        numero: campos.numero || null,
        emisor: campos.emisor || null,
        no_aplica: campos.no_aplica === 'true',
        usuarioId: (request as any).user?.id ?? null,
      })
      return reply.send({ success: true, data: doc })
    } catch (error) {
      return responderError(reply, error)
    }
  })

  app.patch(
    '/vehiculos/:id/documentos/:docId',
    escribir,
    async (request: FastifyRequest<{ Params: { id: string; docId: string }; Body: Record<string, string | null> }>, reply) => {
      try {
        const b = request.body ?? {}
        const doc = await VehiculosDocumentosService.actualizar(request.params.id, request.params.docId, {
          fecha_vencimiento: b.fecha_vencimiento,
          fecha_expedicion: b.fecha_expedicion,
          numero: b.numero,
          emisor: b.emisor,
        })
        return reply.send({ success: true, data: doc })
      } catch (error) {
        return responderError(reply, error)
      }
    },
  )

  app.delete('/vehiculos/:id/documentos/:docId', escribir, async (request: FastifyRequest<{ Params: { id: string; docId: string } }>, reply) => {
    try {
      await VehiculosDocumentosService.eliminar(request.params.id, request.params.docId)
      return reply.send({ success: true })
    } catch (error) {
      return responderError(reply, error)
    }
  })

  app.get('/vehiculos/:id/documentos/:docId/url', async (request: FastifyRequest<{ Params: { id: string; docId: string } }>, reply) => {
    try {
      return reply.send({ success: true, data: { url: await VehiculosDocumentosService.url(request.params.id, request.params.docId) } })
    } catch (error) {
      return responderError(reply, error)
    }
  })
}
