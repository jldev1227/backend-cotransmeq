import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import { requireAlgunPermiso, requirePermission } from '../../middlewares/permissions.middleware'
import { isFormError } from './domain'
import * as escaneados from './formularios-escaneados.service'
import { formEvents } from './formularios-dinamicos.events'
import { actualizarEscaneadoSchema, fechaEscaneadoSchema, nuevoEscaneadoSchema } from './formularios-escaneados.schema'

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
  const leerEscaneados = {
    preHandler: requireAlgunPermiso(['formularios', 'read'], ['mantenimiento', 'full']),
  }
  const editar = { preHandler: requirePermission('formularios', 'full') }
  const gestionarEscaneados = {
    preHandler: requireAlgunPermiso(['formularios', 'full'], ['mantenimiento', 'full']),
  }
  app.get('/formularios/escaneados/opciones', leer, async (request, reply) => {
    try {
      const { q, formId } = z.object({
        q: z.string().max(100).default(''),
        formId: z.string().uuid().optional(),
      }).parse(request.query)
      return reply.send({ success: true, data: await escaneados.opcionesEscaneados(q, formId) })
    } catch (error) {
      return fail(reply, error)
    }
  })
  app.get('/formularios/escaneados', leerEscaneados, async (request, reply) => {
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
      const resultado = await escaneados.completarEscaneado(id.parse((request.params as any).id))
      if (resultado.status === 'UPLOADED') {
        formEvents.scannedDocumentChanged({ action: 'created', documentId: resultado.id })
      }
      return reply.send({
        success: true,
        data: resultado,
      })
    } catch (error) {
      return fail(reply, error)
    }
  })
  app.post('/formularios/escaneados/:id/archivo', editar, async (request, reply) => {
    try {
      const parte = await (request as any).file({ limits: { files: 1, fileSize: 25 * 1024 * 1024 } })
      if (!parte || parte.mimetype !== 'application/pdf')
        return reply.status(400).send({ success: false, error: { message: 'Selecciona un PDF.' } })
      const resultado = await escaneados.subirEscaneado(id.parse((request.params as any).id), await parte.toBuffer())
      if (resultado.status === 'UPLOADED') {
        formEvents.scannedDocumentChanged({ action: 'created', documentId: resultado.id })
      }
      return reply.send({
        success: true,
        data: resultado,
      })
    } catch (error) {
      return fail(reply, error)
    }
  })
  app.put('/formularios/escaneados/:id/archivo', gestionarEscaneados, async (request, reply) => {
    try {
      const parte = await (request as any).file({ limits: { files: 1, fileSize: 25 * 1024 * 1024 } })
      if (!parte || (parte.mimetype !== 'application/pdf' && !parte.filename?.toLowerCase().endsWith('.pdf')))
        return reply.status(415).send({ success: false, error: { message: 'Selecciona un PDF.' } })
      const resultado = await escaneados.reemplazarArchivoEscaneado(
        id.parse((request.params as any).id),
        await parte.toBuffer(),
        parte.filename || 'documento.pdf',
      )
      formEvents.scannedDocumentChanged({ action: 'updated', documentId: resultado.id })
      return reply.send({ success: true, data: resultado })
    } catch (error) {
      if ((error as any)?.code === 'FST_REQ_FILE_TOO_LARGE') {
        return reply.status(413).send({
          success: false,
          error: { code: 'ATTACHMENT_TOO_LARGE', message: 'El PDF supera el límite de 25 MB.' },
        })
      }
      return fail(reply, error)
    }
  })
  app.get('/formularios/escaneados/:id/url', leerEscaneados, async (request, reply) => {
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
  app.patch('/formularios/escaneados/:id', gestionarEscaneados, async (request, reply) => {
    try {
      const input = actualizarEscaneadoSchema.parse(request.body)
      const documentId = id.parse((request.params as any).id)
      const resultado = await escaneados.actualizarEscaneado(
        documentId,
        input as escaneados.ActualizarEscaneado,
      )
      formEvents.scannedDocumentChanged({ action: 'updated', documentId })
      return reply.send({
        success: true,
        data: resultado,
      })
    } catch (error) {
      return fail(reply, error)
    }
  })
  app.delete('/formularios/escaneados/:id', gestionarEscaneados, async (request, reply) => {
    try {
      const documentId = id.parse((request.params as any).id)
      const resultado = await escaneados.eliminarEscaneado(documentId)
      formEvents.scannedDocumentChanged({ action: 'deleted', documentId })
      return reply.send({
        success: true,
        data: resultado,
      })
    } catch (error) {
      return fail(reply, error)
    }
  })
}
