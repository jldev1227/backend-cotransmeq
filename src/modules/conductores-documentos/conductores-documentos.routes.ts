import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { authMiddleware } from '../../middlewares/auth.middleware'
import { requirePermission } from '../../middlewares/permissions.middleware'
import { CATEGORIAS_LICENCIA } from './catalogo'
import { ConductoresDocumentosService } from './conductores-documentos.service'

/**
 * Documentos de la hoja de vida del conductor.
 *
 * A diferencia de la ficha del conductor (que se lee solo con sesión), aquí
 * leer pide `conductores` en `read`: son exámenes médicos y antecedentes, y
 * un acceso `limited` no debería abrirlos. Subir, corregir y borrar piden
 * `full`.
 */
const MAX_BYTES = 25 * 1024 * 1024
const TIPOS = /^(application\/pdf|image\/(png|jpe?g|webp))$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha YYYY-MM-DD')
const texto = (max: number) => z.string().trim().max(max)
const categoriaLicencia = z.enum(CATEGORIAS_LICENCIA, { errorMap: () => ({ message: 'Categoría de licencia no válida' }) })

/// Los campos del multipart llegan como texto: '' equivale a «sin dato».
const vacioANulo = (v: unknown) => (v === '' ? null : v)
const subirSchema = z.object({
  categoria: z.string().min(1, 'Falta la categoría'),
  fecha_vencimiento: z.preprocess(vacioANulo, fecha.nullish()),
  fecha_expedicion: z.preprocess(vacioANulo, fecha.nullish()),
  numero: z.preprocess(vacioANulo, texto(80).nullish()),
  emisor: z.preprocess(vacioANulo, texto(255).nullish()),
  categoria_licencia: z.preprocess(vacioANulo, categoriaLicencia.nullish()),
  no_aplica: z.preprocess((v) => v === 'true', z.boolean()),
})

const actualizarSchema = z
  .object({
    fecha_vencimiento: fecha.nullish(),
    fecha_expedicion: fecha.nullish(),
    numero: texto(80).nullish(),
    emisor: texto(255).nullish(),
    categoria_licencia: categoriaLicencia.nullish(),
  })
  .strict()

function responderError(request: FastifyRequest, reply: FastifyReply, error: any) {
  if (error instanceof z.ZodError) {
    return reply.status(400).send({ success: false, message: error.errors[0]?.message ?? 'Datos no válidos' })
  }
  const status = error?.statusCode ?? 500
  if (status >= 500) request.log.error({ err: error }, '[conductores-documentos]')
  return reply.status(status).send({ success: false, message: status >= 500 ? 'Error interno' : error.message })
}

type ConId = FastifyRequest<{ Params: { id: string } }>
type ConDoc = FastifyRequest<{ Params: { id: string; docId: string } }>

export async function conductoresDocumentosRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authMiddleware)
  /// Un id mal formado llegaba hasta Prisma y salía como 500.
  app.addHook('preValidation', async (request, reply) => {
    const { id, docId } = (request.params ?? {}) as { id?: string; docId?: string }
    if ((id !== undefined && !UUID.test(id)) || (docId !== undefined && !UUID.test(docId))) {
      return reply.status(400).send({ success: false, message: 'Identificador inválido' })
    }
  })
  const leer = { preHandler: requirePermission('conductores', 'read') }
  const escribir = { preHandler: requirePermission('conductores', 'full') }

  app.get('/conductores/documentos/catalogo', leer, async (_req, reply) =>
    reply.send({ success: true, data: ConductoresDocumentosService.catalogo() }),
  )

  app.get('/conductores/:id/documentos', leer, async (request: ConId, reply) => {
    try {
      return reply.send({ success: true, data: await ConductoresDocumentosService.listar(request.params.id) })
    } catch (error) {
      return responderError(request, reply, error)
    }
  })

  /// multipart: campos `categoria`, `fecha_vencimiento`, `fecha_expedicion`,
  /// `numero`, `emisor`, `categoria_licencia`, `no_aplica` ANTES del archivo
  /// `archivo` (opcional si no_aplica).
  app.post('/conductores/:id/documentos', escribir, async (request: ConId, reply) => {
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
      const datos = subirSchema.parse(campos)
      const doc = await ConductoresDocumentosService.subir({
        conductorId: request.params.id,
        ...datos,
        /// Sin `strict` en el tsconfig, zod infiere todo como opcional.
        categoria: datos.categoria as string,
        archivo,
        usuarioId: (request as any).user?.id ?? null,
      })
      return reply.send({ success: true, data: doc })
    } catch (error) {
      return responderError(request, reply, error)
    }
  })

  app.patch('/conductores/:id/documentos/:docId', escribir, async (request: ConDoc, reply) => {
    try {
      const datos = actualizarSchema.parse(request.body ?? {})
      const doc = await ConductoresDocumentosService.actualizar(request.params.id, request.params.docId, datos)
      return reply.send({ success: true, data: doc })
    } catch (error) {
      return responderError(request, reply, error)
    }
  })

  app.delete('/conductores/:id/documentos/:docId', escribir, async (request: ConDoc, reply) => {
    try {
      await ConductoresDocumentosService.eliminar(request.params.id, request.params.docId)
      return reply.send({ success: true })
    } catch (error) {
      return responderError(request, reply, error)
    }
  })

  app.get('/conductores/:id/documentos/:docId/url', leer, async (request: ConDoc, reply) => {
    try {
      return reply.send({ success: true, data: { url: await ConductoresDocumentosService.url(request.params.id, request.params.docId) } })
    } catch (error) {
      return responderError(request, reply, error)
    }
  })
}
