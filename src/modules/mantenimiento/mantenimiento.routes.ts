/**
 * Rutas del módulo de mantenimiento de flota.
 *
 * Leer pide `mantenimiento` en `read` (operaciones y HSEQ consultan); crear,
 * editar, cerrar y adjuntar piden `full` (mantenimiento y administración).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { ZodError } from 'zod'
import { authMiddleware } from '../../middlewares/auth.middleware'
import { requirePermission } from '../../middlewares/permissions.middleware'
import {
  actualizarOrdenSchema,
  actualizarPlanSchema,
  cambiarEstadoOrdenSchema,
  costosSchema,
  crearOrdenSchema,
  crearPlanSchema,
  listarOrdenesSchema,
  listarPlanesSchema,
  tipoAdjuntoSchema,
} from './mantenimiento.schema'
import { MantenimientoError, MantenimientoService as svc } from './mantenimiento.service'
import { novedadesDeEnvio } from './aviso-preoperacional'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/// Factura escaneada o foto del celular. Las fotos ya llegan comprimidas desde
/// el panel; 15 MB deja margen para un PDF de varias páginas.
const MAX_BYTES = 15 * 1024 * 1024
const TIPOS_ARCHIVO = /^(application\/pdf|image\/(png|jpe?g|webp|heic|heif))$/

type ConId = FastifyRequest<{ Params: { id: string } }>

function responderError(request: FastifyRequest, reply: FastifyReply, err: unknown, mensaje: string) {
  if (err instanceof ZodError) {
    return reply.status(422).send({
      success: false,
      message: err.errors[0]?.message ?? 'Datos inválidos',
      details: err.errors.map((e) => `${e.path.join('.') || 'campo'}: ${e.message}`),
    })
  }
  if (err instanceof MantenimientoError) {
    return reply.status(err.status).send({ success: false, message: err.message, code: err.code })
  }
  request.log.error({ err }, `[mantenimiento] ${mensaje}`)
  return reply.status(500).send({ success: false, message: mensaje })
}

const usuarioDe = (request: FastifyRequest) => ((request as any).user?.id as string | undefined) ?? null

export async function mantenimientoRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authMiddleware)
  /// Un id mal formado llegaba hasta Prisma y salía como 500.
  app.addHook('preValidation', async (request, reply) => {
    const params = (request.params ?? {}) as Record<string, string | undefined>
    for (const clave of ['id', 'adjuntoId']) {
      const v = params[clave]
      if (v !== undefined && !UUID.test(v)) return reply.status(400).send({ success: false, message: 'Identificador inválido' })
    }
  })
  const leer = { preHandler: requirePermission('mantenimiento', 'read') }
  const escribir = { preHandler: requirePermission('mantenimiento', 'full') }

  app.get('/mantenimiento/opciones', leer, async (request, reply) => {
    try {
      return reply.send({ success: true, data: await svc.opciones() })
    } catch (err) {
      return responderError(request, reply, err, 'No se pudieron cargar las opciones')
    }
  })

  app.get('/mantenimiento/resumen', leer, async (request, reply) => {
    try {
      return reply.send({ success: true, data: await svc.resumen() })
    } catch (err) {
      return responderError(request, reply, err, 'No se pudo calcular el resumen')
    }
  })

  // ── Planes ──
  app.get('/mantenimiento/planes', leer, async (request, reply) => {
    try {
      return reply.send({ success: true, data: await svc.listarPlanes(listarPlanesSchema.parse(request.query ?? {})) })
    } catch (err) {
      return responderError(request, reply, err, 'No se pudieron listar los planes')
    }
  })

  app.get('/mantenimiento/planes/:id', leer, async (request: ConId, reply) => {
    try {
      return reply.send({ success: true, data: await svc.detallePlan(request.params.id) })
    } catch (err) {
      return responderError(request, reply, err, 'No se pudo abrir el plan')
    }
  })

  app.post('/mantenimiento/planes', escribir, async (request, reply) => {
    try {
      const r = await svc.crearPlanes(crearPlanSchema.parse(request.body ?? {}), usuarioDe(request))
      return reply.status(201).send({ success: true, data: r })
    } catch (err) {
      return responderError(request, reply, err, 'No se pudo crear el plan')
    }
  })

  app.patch('/mantenimiento/planes/:id', escribir, async (request: ConId, reply) => {
    try {
      return reply.send({ success: true, data: await svc.actualizarPlan(request.params.id, actualizarPlanSchema.parse(request.body ?? {})) })
    } catch (err) {
      return responderError(request, reply, err, 'No se pudo guardar el plan')
    }
  })

  app.delete('/mantenimiento/planes/:id', escribir, async (request: ConId, reply) => {
    try {
      await svc.eliminarPlan(request.params.id)
      return reply.send({ success: true })
    } catch (err) {
      return responderError(request, reply, err, 'No se pudo eliminar el plan')
    }
  })

  // ── Órdenes de trabajo ──
  app.get('/mantenimiento/ordenes', leer, async (request, reply) => {
    try {
      return reply.send({ success: true, data: await svc.listarOrdenes(listarOrdenesSchema.parse(request.query ?? {})) })
    } catch (err) {
      return responderError(request, reply, err, 'No se pudieron listar las órdenes')
    }
  })

  app.get('/mantenimiento/ordenes/:id', leer, async (request: ConId, reply) => {
    try {
      return reply.send({ success: true, data: await svc.detalleOrden(request.params.id) })
    } catch (err) {
      return responderError(request, reply, err, 'No se pudo abrir la orden')
    }
  })

  app.post('/mantenimiento/ordenes', escribir, async (request, reply) => {
    try {
      const orden = await svc.crearOrden(crearOrdenSchema.parse(request.body ?? {}), usuarioDe(request))
      return reply.status(201).send({ success: true, data: orden })
    } catch (err) {
      return responderError(request, reply, err, 'No se pudo crear la orden')
    }
  })

  app.patch('/mantenimiento/ordenes/:id', escribir, async (request: ConId, reply) => {
    try {
      return reply.send({ success: true, data: await svc.actualizarOrden(request.params.id, actualizarOrdenSchema.parse(request.body ?? {})) })
    } catch (err) {
      return responderError(request, reply, err, 'No se pudo guardar la orden')
    }
  })

  app.post('/mantenimiento/ordenes/:id/estado', escribir, async (request: ConId, reply) => {
    try {
      const orden = await svc.cambiarEstadoOrden(request.params.id, cambiarEstadoOrdenSchema.parse(request.body ?? {}), usuarioDe(request))
      return reply.send({ success: true, data: orden })
    } catch (err) {
      return responderError(request, reply, err, 'No se pudo cambiar el estado de la orden')
    }
  })

  /// multipart: el campo `tipo` (FACTURA | FOTO | OTRO) ANTES del archivo `archivo`.
  app.post('/mantenimiento/ordenes/:id/adjuntos', escribir, async (request: ConId, reply) => {
    try {
      let tipo = 'OTRO'
      let archivo: { buffer: Buffer; nombre: string; mimetype: string } | undefined
      for await (const parte of (request as any).parts()) {
        if (parte.type === 'file') {
          if (!TIPOS_ARCHIVO.test(parte.mimetype)) return reply.status(400).send({ success: false, message: 'Solo PDF o imagen' })
          const buffer = await parte.toBuffer()
          if (buffer.length > MAX_BYTES) return reply.status(413).send({ success: false, message: 'El archivo supera 15 MB' })
          archivo = { buffer, nombre: parte.filename || 'adjunto', mimetype: parte.mimetype }
        } else if (parte.fieldname === 'tipo') {
          tipo = String(parte.value ?? 'OTRO')
        }
      }
      if (!archivo) return reply.status(400).send({ success: false, message: 'Falta el archivo' })
      const adjunto = await svc.subirAdjunto(request.params.id, tipoAdjuntoSchema.parse(tipo), archivo, usuarioDe(request))
      return reply.status(201).send({ success: true, data: adjunto })
    } catch (err) {
      return responderError(request, reply, err, 'No se pudo subir el adjunto')
    }
  })

  app.get(
    '/mantenimiento/ordenes/:id/adjuntos/:adjuntoId/url',
    leer,
    async (request: FastifyRequest<{ Params: { id: string; adjuntoId: string } }>, reply) => {
      try {
        return reply.send({ success: true, data: { url: await svc.urlAdjunto(request.params.id, request.params.adjuntoId) } })
      } catch (err) {
        return responderError(request, reply, err, 'No se pudo abrir el adjunto')
      }
    },
  )

  app.delete(
    '/mantenimiento/ordenes/:id/adjuntos/:adjuntoId',
    escribir,
    async (request: FastifyRequest<{ Params: { id: string; adjuntoId: string } }>, reply) => {
      try {
        await svc.eliminarAdjunto(request.params.id, request.params.adjuntoId)
        return reply.send({ success: true })
      } catch (err) {
        return responderError(request, reply, err, 'No se pudo eliminar el adjunto')
      }
    },
  )

  /// Novedades de un preoperacional para quien lo va a reparar: es a donde
  /// lleva el aviso de «ítems en Malo» (ver `aviso-preoperacional.ts`).
  app.get('/mantenimiento/preoperacionales/:id', leer, async (request: ConId, reply) => {
    try {
      const data = await novedadesDeEnvio(request.params.id)
      if (!data) return reply.status(404).send({ success: false, message: 'Preoperacional no encontrado', code: 'NO_ENCONTRADO' })
      return reply.send({ success: true, data })
    } catch (err) {
      return responderError(request, reply, err, 'No se pudo abrir el preoperacional')
    }
  })

  // ── Ficha del vehículo y costos ──
  app.get('/mantenimiento/vehiculos/:id', leer, async (request: ConId, reply) => {
    try {
      return reply.send({ success: true, data: await svc.resumenVehiculo(request.params.id) })
    } catch (err) {
      return responderError(request, reply, err, 'No se pudo cargar el mantenimiento del vehículo')
    }
  })

  app.get('/mantenimiento/costos', leer, async (request, reply) => {
    try {
      return reply.send({ success: true, data: await svc.costos(costosSchema.parse(request.query ?? {})) })
    } catch (err) {
      return responderError(request, reply, err, 'No se pudieron calcular los costos')
    }
  })
}
