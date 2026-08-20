/**
 * Controller HTTP del módulo.
 *
 * Tiene tres responsabilidades y ninguna más:
 *
 *  1. parsear con Zod y traducir `ZodError` a `400`;
 *  2. traducir `FormError` al status que le corresponde;
 *  3. emitir los eventos de socket **después** de que el service haya hecho
 *     commit.
 *
 * Ese punto 3 es la razón de que los eventos no vivan en el service: aquí ya se
 * sabe que la transacción terminó bien. Emitir dentro del `$transaction` avisa
 * a los clientes de un cambio que un rollback puede deshacer, y el portal
 * respondería invalidando su caché y pidiendo datos que no existen.
 */

import type { FastifyReply, FastifyRequest } from 'fastify'
import { ZodError, type ZodSchema } from 'zod'
import { logger } from '../../utils/logger'
import { isFormError } from './domain'
import { formEvents } from './formularios-dinamicos.events'
import {
  auditarConsultaAdministrativa,
  contextoDePeticion,
  medir,
  registrarEvento
} from './formularios-dinamicos.observabilidad'
import * as catalogo from './formularios-dinamicos.service'
import * as asignaciones from './formularios-asignaciones.service'
import * as envios from './formularios-envios.service'
import {
  actualizarAsignacionSchema,
  actualizarFormularioSchema,
  actualizarPlantillaSchema,
  anularEnvioSchema,
  crearAsignacionSchema,
  crearFormularioSchema,
  duplicarFormularioSchema,
  guardarVersionSchema,
  listarAsignacionesSchema,
  listarEnviosSchema,
  listarFormulariosSchema,
  plantillaSchema,
} from './formularios-dinamicos.schema'

/** Actor administrativo. Sale de `request.user`, que puso `authMiddleware`. */
function actor(request: FastifyRequest): catalogo.AdminActor {
  const user = (request as any).user
  return { id: user.id, nombre: user.nombre || user.name || user.correo }
}

function ok(reply: FastifyReply, data: unknown, meta?: unknown) {
  return reply.send({ success: true, data, ...(meta ? { meta } : {}) })
}

/**
 * Traduce cualquier error a la envoltura `{ success: false, error }`.
 *
 * Un error inesperado se registra completo y se devuelve como `500` genérico:
 * el mensaje de una excepción de Prisma puede contener nombres de columna y
 * fragmentos de consulta, y eso no sale al cliente.
 */
function fail(reply: FastifyReply, err: unknown, contexto: string) {
  if (err instanceof ZodError) {
    return reply.status(400).send({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'El payload no es válido.',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    })
  }

  if (isFormError(err)) {
    /// Se instrumenta AQUÍ y no en cada `catch`: este es el único punto por el
    /// que pasan todos los `FormError` del módulo administrativo, así que no
    /// quedan casos sin contar.
    const ctx = contextoDePeticion(reply.request)
    if (err.code === 'REVISION_CONFLICT') {
      registrarEvento('version.revision-conflict', {
        ...ctx,
        ...(err.details as Record<string, unknown>)
      })
    } else if (err.code === 'FORM_DEFINITION_INVALID' || err.code === 'FIELD_RULE_CYCLE') {
      registrarEvento('version.publish-blocked', {
        ...ctx,
        errores: (err.details as any)?.errors?.length ?? null
      })
    }
    return reply.status(err.status).send(err.toBody())
  }

  logger.error(
    { type: 'forms-unhandled', contexto, error: err instanceof Error ? err.stack : String(err) },
    `[formularios] error no manejado en ${contexto}`,
  )
  return reply.status(500).send({
    success: false,
    error: { code: 'INTERNAL_ERROR', message: 'Error interno al procesar la solicitud.' },
  })
}

function parse<T>(schema: ZodSchema<T>, value: unknown): T {
  return schema.parse(value)
}

// ─────────────────────────────────────────────────────────────────────────────
// Catálogo
// ─────────────────────────────────────────────────────────────────────────────

export const FormulariosController = {
  async listar(request: FastifyRequest, reply: FastifyReply) {
    try {
      const query = parse(listarFormulariosSchema, request.query)
      const { data, meta } = await catalogo.listarFormularios(query)
      return ok(reply, data, meta)
    } catch (err) {
      return fail(reply, err, 'listar formularios')
    }
  },

  async obtener(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { formId } = request.params as { formId: string }
      return ok(reply, await catalogo.obtenerFormulario(formId))
    } catch (err) {
      return fail(reply, err, 'obtener formulario')
    }
  },

  async crear(request: FastifyRequest, reply: FastifyReply) {
    try {
      const input = parse(crearFormularioSchema, request.body)
      const data = await catalogo.crearFormulario(input, actor(request))
      return reply.status(201).send({ success: true, data })
    } catch (err) {
      return fail(reply, err, 'crear formulario')
    }
  },

  async actualizar(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { formId } = request.params as { formId: string }
      const input = parse(actualizarFormularioSchema, request.body)
      return ok(reply, await catalogo.actualizarFormulario(formId, input, actor(request)))
    } catch (err) {
      return fail(reply, err, 'actualizar formulario')
    }
  },

  async eliminar(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { formId } = request.params as { formId: string }
      return ok(reply, await catalogo.eliminarFormulario(formId, actor(request)))
    } catch (err) {
      return fail(reply, err, 'eliminar formulario')
    }
  },

  async restaurar(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { formId } = request.params as { formId: string }
      return ok(reply, await catalogo.restaurarFormulario(formId, actor(request)))
    } catch (err) {
      return fail(reply, err, 'restaurar formulario')
    }
  },

  async duplicar(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { formId } = request.params as { formId: string }
      const { versionId } = request.query as { versionId?: string }
      const input = parse(duplicarFormularioSchema, request.body)
      const data = await catalogo.duplicarFormulario(formId, versionId, input, actor(request))
      return reply.status(201).send({ success: true, data })
    } catch (err) {
      return fail(reply, err, 'duplicar formulario')
    }
  },

  // ── Versiones ────────────────────────────────────────────────────────────

  async obtenerVersion(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { formId, versionId } = request.params as { formId: string; versionId: string }
      const data = await catalogo.obtenerVersion(formId, versionId)
      /// ETag privado: la definición de una versión PUBLICADA es inmutable, así
      /// que `versionId + revision` la identifica sin ambigüedad. En DRAFT
      /// también sirve porque cada guardado sube `revision`.
      reply.header('Cache-Control', 'private, max-age=0, must-revalidate')
      reply.header('ETag', `"${data.id}-${data.revision}"`)
      return ok(reply, data)
    } catch (err) {
      return fail(reply, err, 'obtener versión')
    }
  },

  async guardarVersion(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { formId, versionId } = request.params as { formId: string; versionId: string }
      const input = parse(guardarVersionSchema, request.body)
      const { version, validation } = await medir(
        'saveVersion',
        { ...contextoDePeticion(request), formId, versionId, revision: input.revision },
        () => catalogo.guardarVersion(formId, versionId, input, actor(request))
      )
      return ok(reply, version, { validation, revision: version.revision })
    } catch (err) {
      return fail(reply, err, 'guardar versión')
    }
  },

  async validarVersion(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { formId, versionId } = request.params as { formId: string; versionId: string }
      const { mode } = request.query as { mode?: 'draft' | 'publish' }
      return ok(reply, await catalogo.validarVersion(formId, versionId, mode === 'draft' ? 'draft' : 'publish'))
    } catch (err) {
      return fail(reply, err, 'validar versión')
    }
  },

  async clonarVersion(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { formId, versionId } = request.params as { formId: string; versionId: string }
      const data = await catalogo.clonarVersion(formId, versionId, actor(request))
      return reply.status(201).send({ success: true, data })
    } catch (err) {
      return fail(reply, err, 'clonar versión')
    }
  },

  async publicarVersion(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { formId, versionId } = request.params as { formId: string; versionId: string }
      const resultado = await catalogo.publicarVersion(formId, versionId, actor(request))

      /// Post-commit. Solo se avisa si la publicación es NUEVA: republicar por
      /// reintento no debe invalidar la caché de todos los conductores otra vez.
      if (!resultado.alreadyPublished) {
        registrarEvento('version.published', {
          ...contextoDePeticion(request),
          formId,
          versionId,
          revision: resultado.version.revision
        })
        formEvents.versionPublished({
          formId,
          versionId,
          versionNumber: resultado.version.versionNumber,
          revision: resultado.version.revision,
        })
      }

      return ok(reply, resultado.version, {
        validation: resultado.validation,
        alreadyPublished: resultado.alreadyPublished,
      })
    } catch (err) {
      return fail(reply, err, 'publicar versión')
    }
  },

  async archivarVersion(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { formId, versionId } = request.params as { formId: string; versionId: string }
      return ok(reply, await catalogo.archivarVersion(formId, versionId, actor(request)))
    } catch (err) {
      return fail(reply, err, 'archivar versión')
    }
  },

  // ── Plantillas ───────────────────────────────────────────────────────────

  async listarPlantillas(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { category, search } = request.query as { category?: string; search?: string }
      return ok(reply, await catalogo.listarPlantillas({ category, search }))
    } catch (err) {
      return fail(reply, err, 'listar plantillas')
    }
  },

  async crearPlantilla(request: FastifyRequest, reply: FastifyReply) {
    try {
      const input = parse(plantillaSchema, request.body)
      const data = await catalogo.crearPlantilla(input, actor(request))
      return reply.status(201).send({ success: true, data })
    } catch (err) {
      return fail(reply, err, 'crear plantilla')
    }
  },

  async actualizarPlantilla(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string }
      const input = parse(actualizarPlantillaSchema, request.body)
      return ok(reply, await catalogo.actualizarPlantilla(id, input))
    } catch (err) {
      return fail(reply, err, 'actualizar plantilla')
    }
  },

  async eliminarPlantilla(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string }
      return ok(reply, await catalogo.eliminarPlantilla(id))
    } catch (err) {
      return fail(reply, err, 'eliminar plantilla')
    }
  },

  // ── Asignaciones ─────────────────────────────────────────────────────────

  async listarAsignaciones(request: FastifyRequest, reply: FastifyReply) {
    try {
      const query = parse(listarAsignacionesSchema, request.query)
      const { data, meta } = await asignaciones.listarAsignaciones(query)
      return ok(reply, data, meta)
    } catch (err) {
      return fail(reply, err, 'listar asignaciones')
    }
  },

  async obtenerAsignacion(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string }
      return ok(reply, await asignaciones.obtenerAsignacion(id))
    } catch (err) {
      return fail(reply, err, 'obtener asignación')
    }
  },

  async crearAsignacion(request: FastifyRequest, reply: FastifyReply) {
    try {
      const input = parse(crearAsignacionSchema, request.body)
      const { assignment, warnings } = await asignaciones.crearAsignacion(input, actor(request))

      formEvents.assignmentChanged({
        assignmentId: assignment.id,
        versionId: assignment.versionId,
        formId: assignment.version?.formId ?? '',
        status: assignment.status,
        conductorIds: await asignaciones.conductoresAfectados(assignment.id),
      })

      return reply.status(201).send({ success: true, data: assignment, meta: { warnings } })
    } catch (err) {
      return fail(reply, err, 'crear asignación')
    }
  },

  async actualizarAsignacion(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string }
      const input = parse(actualizarAsignacionSchema, request.body)
      /// Los conductores afectados se calculan ANTES de tocar los targets:
      /// quitar a alguien de la audiencia también le tiene que llegar el aviso,
      /// y después del UPDATE ya no aparecería en la lista.
      const previos = await asignaciones.conductoresAfectados(id)
      const { assignment, warnings } = await asignaciones.actualizarAsignacion(id, input, actor(request))
      const actuales = await asignaciones.conductoresAfectados(id)

      formEvents.assignmentChanged({
        assignmentId: assignment.id,
        versionId: assignment.versionId,
        formId: assignment.version?.formId ?? '',
        status: assignment.status,
        conductorIds: [...new Set([...previos, ...actuales])],
      })

      return ok(reply, assignment, { warnings })
    } catch (err) {
      return fail(reply, err, 'actualizar asignación')
    }
  },

  cambiarEstadoAsignacion(destino: 'ACTIVE' | 'PAUSED' | 'CLOSED') {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { id } = request.params as { id: string }
        const assignment = await asignaciones.cambiarEstadoAsignacion(id, destino)

        formEvents.assignmentChanged({
          assignmentId: assignment.id,
          versionId: assignment.versionId,
          formId: assignment.version?.formId ?? '',
          status: assignment.status,
          conductorIds: await asignaciones.conductoresAfectados(id),
        })

        return ok(reply, assignment)
      } catch (err) {
        return fail(reply, err, `cambiar asignación a ${destino}`)
      }
    }
  },

  // ── Envíos ───────────────────────────────────────────────────────────────

  async listarEnvios(request: FastifyRequest, reply: FastifyReply) {
    try {
      const query = parse(listarEnviosSchema, request.query)
      const { data, meta } = await envios.listarEnvios(query)
      /// Los envíos traen datos de salud, fatiga y firmas: quién consultó qué es
      /// parte del control de acceso, no un extra.
      auditarConsultaAdministrativa(request, {
        recurso: 'submissions.list',
        filtros: query,
        resultados: data.length
      })
      return ok(reply, data, meta)
    } catch (err) {
      return fail(reply, err, 'listar envíos')
    }
  },

  async obtenerEnvio(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string }
      const { submission, definition } = await envios.obtenerEnvio(id)
      auditarConsultaAdministrativa(request, { recurso: 'submissions.detail', filtros: { id } })
      /// No cacheable: contiene datos personales y URLs firmadas con caducidad.
      reply.header('Cache-Control', 'no-store')
      return ok(reply, { submission, definition })
    } catch (err) {
      return fail(reply, err, 'obtener envío')
    }
  },

  async anularEnvio(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string }
      const input = parse(anularEnvioSchema, request.body)
      const resultado = await envios.anularEnvio(id, input, actor(request))

      formEvents.submissionVoided({
        conductorId: resultado.conductorId,
        submissionId: id,
        assignmentId: resultado.assignmentId,
      })

      return ok(reply, { submission: resultado.submission, definition: resultado.definition })
    } catch (err) {
      return fail(reply, err, 'anular envío')
    }
  },

  async exportarEnvios(request: FastifyRequest, reply: FastifyReply) {
    try {
      const query = parse(listarEnviosSchema, request.query)
      const csv = await envios.exportarEnviosCsv(query)
      /// El export saca datos personales del sistema en un archivo que viaja por
      /// correo y se queda en discos ajenos. Es la consulta que más importa auditar.
      auditarConsultaAdministrativa(request, { recurso: 'submissions.export-csv', filtros: query })
      const nombre = `envios-formularios-${new Date().toISOString().slice(0, 10)}.csv`
      reply.header('Content-Type', 'text/csv; charset=utf-8')
      reply.header('Content-Disposition', `attachment; filename="${nombre}"`)
      reply.header('Cache-Control', 'no-store')
      return reply.send(csv)
    } catch (err) {
      return fail(reply, err, 'exportar envíos')
    }
  },
}

export const controllerInternals = { fail, actor }
