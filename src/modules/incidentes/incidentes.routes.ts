/**
 * Rutas del módulo de incidentes (accidentes, incidentes y casi-accidentes).
 *
 * Leer pide `incidentes` en `read`; reportar, investigar, cerrar y adjuntar
 * piden `full`. Crear una acción correctiva desde la investigación pide
 * además `acciones-correctivas` en `full`: la acción nace en ese módulo y no
 * debe poder crearla por esta puerta quien no podría crearla por la suya.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { ZodError } from 'zod'
import { authMiddleware } from '../../middlewares/auth.middleware'
import { requirePermission } from '../../middlewares/permissions.middleware'
import {
  cambiarEstadoSchema,
  crearAccionSchema,
  crearIncidenteSchema,
  editarIncidenteSchema,
  indicadoresSchema,
  investigacionSchema,
  listarSchema,
  vincularAccionSchema,
} from './incidentes.schema'
import { IncidenteError, IncidentesService } from './incidentes.service'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const FECHA = /^\d{4}-\d{2}-\d{2}$/
const MAX_BYTES = 25 * 1024 * 1024
const TIPOS_ARCHIVO = /^(application\/pdf|image\/(png|jpe?g|webp))$/

type ConId = FastifyRequest<{ Params: { id: string } }>

function responderError(request: FastifyRequest, reply: FastifyReply, err: unknown, mensaje: string) {
  if (err instanceof ZodError) {
    return reply.status(422).send({
      success: false,
      message: err.errors[0]?.message ?? 'Datos inválidos',
      details: err.errors.map((e) => `${e.path.join('.') || 'campo'}: ${e.message}`),
    })
  }
  if (err instanceof IncidenteError) {
    return reply.status(err.status).send({ success: false, message: err.message, code: err.code, details: err.detalles })
  }
  request.log.error({ err }, `[incidentes] ${mensaje}`)
  return reply.status(500).send({ success: false, message: mensaje })
}

const usuarioDe = (request: FastifyRequest): string | null => (request as any).user?.id ?? null

export async function incidentesRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authMiddleware)
  /// Un id mal formado llegaba hasta Prisma y salía como 500.
  app.addHook('preValidation', async (request, reply) => {
    const p = (request.params ?? {}) as Record<string, string | undefined>
    for (const clave of ['id', 'evId', 'accionId']) {
      const v = p[clave]
      if (v !== undefined && !UUID.test(v)) return reply.status(400).send({ success: false, message: 'Identificador inválido' })
    }
  })

  const leer = { preHandler: requirePermission('incidentes', 'read') }
  const escribir = { preHandler: requirePermission('incidentes', 'full') }
  const escribirAccion = { preHandler: [requirePermission('incidentes', 'full'), requirePermission('acciones-correctivas', 'full')] }

  app.get('/incidentes', leer, async (request, reply) => {
    try {
      return reply.send({ success: true, ...(await IncidentesService.listar(listarSchema.parse(request.query ?? {}))) })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible listar los incidentes')
    }
  })

  app.get('/incidentes/indicadores', leer, async (request, reply) => {
    try {
      const { meses } = indicadoresSchema.parse(request.query ?? {})
      return reply.send({ success: true, data: await IncidentesService.indicadores(meses) })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible calcular los indicadores')
    }
  })

  app.get('/incidentes/opciones', leer, async (request, reply) => {
    try {
      return reply.send({ success: true, data: await IncidentesService.opciones() })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible cargar vehículos y conductores')
    }
  })

  app.get('/incidentes/servicios-candidatos', leer, async (request, reply) => {
    const q = (request.query ?? {}) as Record<string, string | undefined>
    if (!q.fecha || !FECHA.test(q.fecha)) return reply.status(400).send({ success: false, message: 'Falta la fecha' })
    for (const v of [q.vehiculo_id, q.conductor_id]) {
      if (v && !UUID.test(v)) return reply.status(400).send({ success: false, message: 'Identificador inválido' })
    }
    try {
      const data = await IncidentesService.serviciosCandidatos({ fecha: q.fecha, vehiculo_id: q.vehiculo_id || null, conductor_id: q.conductor_id || null })
      return reply.send({ success: true, data })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible buscar los servicios')
    }
  })

  app.get('/incidentes/:id', leer, async (request: ConId, reply) => {
    try {
      return reply.send({ success: true, data: await IncidentesService.detalle(request.params.id) })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible abrir el incidente')
    }
  })

  app.post('/incidentes', escribir, async (request, reply) => {
    try {
      const data = await IncidentesService.crear(crearIncidenteSchema.parse(request.body ?? {}), usuarioDe(request))
      return reply.status(201).send({ success: true, data })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible registrar el reporte')
    }
  })

  app.put('/incidentes/:id', escribir, async (request: ConId, reply) => {
    try {
      const data = await IncidentesService.editar(request.params.id, editarIncidenteSchema.parse(request.body ?? {}))
      return reply.send({ success: true, data })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible guardar el reporte')
    }
  })

  app.put('/incidentes/:id/investigacion', escribir, async (request: ConId, reply) => {
    try {
      const data = await IncidentesService.guardarInvestigacion(request.params.id, investigacionSchema.parse(request.body ?? {}))
      return reply.send({ success: true, data })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible guardar la investigación')
    }
  })

  app.post('/incidentes/:id/estado', escribir, async (request: ConId, reply) => {
    try {
      const b = cambiarEstadoSchema.parse(request.body ?? {})
      const data = await IncidentesService.cambiarEstado(request.params.id, b.accion, b, usuarioDe(request))
      return reply.send({ success: true, data })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible cambiar el estado')
    }
  })

  app.delete('/incidentes/:id', escribir, async (request: ConId, reply) => {
    try {
      await IncidentesService.eliminar(request.params.id)
      return reply.send({ success: true })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible eliminar el incidente')
    }
  })

  // ── Evidencias ──

  /// multipart: el campo `descripcion` ANTES del archivo `archivo`.
  app.post('/incidentes/:id/evidencias', escribir, async (request: ConId, reply) => {
    try {
      let descripcion: string | null = null
      let archivo: { buffer: Buffer; nombre: string; mimetype: string } | undefined
      for await (const parte of (request as any).parts()) {
        if (parte.type === 'file') {
          if (!TIPOS_ARCHIVO.test(parte.mimetype)) return reply.status(400).send({ success: false, message: 'Solo PDF o imagen (JPG, PNG, WEBP)' })
          const buffer = await parte.toBuffer()
          if (buffer.length > MAX_BYTES) return reply.status(413).send({ success: false, message: 'El archivo supera 25 MB' })
          archivo = { buffer, nombre: parte.filename || 'evidencia', mimetype: parte.mimetype }
        } else if (parte.fieldname === 'descripcion') {
          descripcion = String(parte.value ?? '').trim() || null
        }
      }
      if (!archivo) return reply.status(400).send({ success: false, message: 'Falta el archivo' })
      const ev = await IncidentesService.subirEvidencia(request.params.id, archivo, descripcion, usuarioDe(request))
      return reply.status(201).send({ success: true, data: { id: ev.id } })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible subir la evidencia')
    }
  })

  app.get('/incidentes/:id/evidencias/:evId/url', leer, async (request: FastifyRequest<{ Params: { id: string; evId: string } }>, reply) => {
    try {
      return reply.send({ success: true, data: { url: await IncidentesService.urlEvidencia(request.params.id, request.params.evId) } })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible abrir la evidencia')
    }
  })

  app.delete('/incidentes/:id/evidencias/:evId', escribir, async (request: FastifyRequest<{ Params: { id: string; evId: string } }>, reply) => {
    try {
      await IncidentesService.eliminarEvidencia(request.params.id, request.params.evId)
      return reply.send({ success: true })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible quitar la evidencia')
    }
  })

  // ── Acciones correctivas ──

  app.get('/incidentes/:id/acciones/buscar', escribir, async (request: FastifyRequest<{ Params: { id: string }; Querystring: { q?: string } }>, reply) => {
    try {
      const q = String(request.query?.q ?? '').slice(0, 120)
      return reply.send({ success: true, data: await IncidentesService.buscarAcciones(request.params.id, q) })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible buscar acciones')
    }
  })

  app.post('/incidentes/:id/acciones', escribirAccion, async (request: ConId, reply) => {
    try {
      const data = await IncidentesService.crearAccion(request.params.id, crearAccionSchema.parse(request.body ?? {}), usuarioDe(request))
      return reply.status(201).send({ success: true, data })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible crear la acción correctiva')
    }
  })

  app.post('/incidentes/:id/acciones/vincular', escribir, async (request: ConId, reply) => {
    try {
      const { accion_id } = vincularAccionSchema.parse(request.body ?? {})
      return reply.send({ success: true, data: await IncidentesService.vincularAccion(request.params.id, accion_id) })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible vincular la acción')
    }
  })

  app.delete('/incidentes/:id/acciones/:accionId', escribir, async (request: FastifyRequest<{ Params: { id: string; accionId: string } }>, reply) => {
    try {
      return reply.send({ success: true, data: await IncidentesService.desvincularAccion(request.params.id, request.params.accionId) })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible desvincular la acción')
    }
  })
}
