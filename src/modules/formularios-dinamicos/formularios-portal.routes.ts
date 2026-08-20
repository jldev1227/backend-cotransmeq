import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import jwt from 'jsonwebtoken'
import { ZodError, type ZodSchema } from 'zod'
import { env } from '../../config/env'
import { logger } from '../../utils/logger'
import { isFormError, type SubmissionInput } from './domain'
import { formEvents } from './formularios-dinamicos.events'
import {
	contextoDePeticion,
	medir,
	registrarEvento
} from './formularios-dinamicos.observabilidad'
import * as portal from './formularios-portal.service'
import {
  backupDraftSchema,
  completeAttachmentSchema,
  enviarSubmissionSchema,
  initAttachmentSchema,
  listarEnviosPortalSchema,
} from './formularios-dinamicos.schema'

/**
 * Rutas del portal del conductor para formularios dinámicos.
 *
 * Middleware propio y no `authMiddleware`: el portal se autentica con el JWT del
 * magic link (`tipo: 'conductor_portal'`), que NO es un usuario del dashboard y
 * no tiene áreas ni permisos por módulo. Es el mismo criterio que ya usa
 * `conductor-portal.routes.ts`; se replica aquí en vez de importarse porque allí
 * la función es privada del archivo.
 *
 * La comprobación de `tipo` es lo que impide que un token de dashboard —o uno de
 * otro flujo— sirva para enviar preoperacionales en nombre de un conductor.
 */
async function portalAuthMiddleware(request: FastifyRequest, reply: FastifyReply) {
  const auth = request.headers['authorization']
  if (!auth) {
    return reply.status(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Token no proporcionado.' } })
  }
  const parts = auth.split(' ')
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return reply.status(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Formato de token inválido.' } })
  }

  try {
    const payload = jwt.verify(parts[1], env.JWT_SECRET) as any
    if (payload.tipo !== 'conductor_portal') {
      return reply
        .status(401)
        .send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Token no autorizado para el portal.' } })
    }
    ;(request as any).portalActor = {
      id: payload.sub,
      cedula: payload.cedula,
      nombre: payload.nombre,
    } satisfies portal.PortalActor
  } catch {
    return reply
      .status(401)
      .send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Token inválido o expirado.' } })
  }
}

function actorDe(request: FastifyRequest): portal.PortalActor {
  return (request as any).portalActor
}

function parse<T>(schema: ZodSchema<T>, value: unknown): T {
  return schema.parse(value)
}

/**
 * Traducción de errores para el portal.
 *
 * El `code` importa más que el mensaje: la outbox decide con él si reintenta
 * (`5xx`, red), si bloquea el borrador para que el conductor lo corrija
 * (`FIELD_VALUE_INVALID`), si lo conserva como copia (`SUBMISSION_LIMIT_REACHED`)
 * o si pide un magic link nuevo (`401`).
 */
function fail(reply: FastifyReply, err: unknown, contexto: string) {
  if (err instanceof ZodError) {
    return reply.status(400).send({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'El envío no tiene el formato esperado.',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    })
  }
  if (isFormError(err)) {
    /// Único punto por el que pasan los `FormError` del portal: instrumentar aquí
    /// no deja casos sin contar.
    const ctx = contextoDePeticion(reply.request)
    switch (err.code) {
      case 'IDEMPOTENCY_PAYLOAD_MISMATCH':
        /// `warn`: no es red ni error del conductor, es un cliente que reusó un id
        /// de idempotencia con otro contenido. Hay un bug que hay que encontrar.
        registrarEvento('submission.idempotency-mismatch', {
          ...ctx,
          ...(err.details as Record<string, unknown>),
        })
        break
      case 'SUBMISSION_LIMIT_REACHED':
        registrarEvento('submission.limit-reached', {
          ...ctx,
          ...(err.details as Record<string, unknown>),
        })
        break
      case 'FIELD_VALUE_INVALID':
        registrarEvento('submission.validation-rejected', {
          ...ctx,
          errores: (err.details as any)?.errors?.length ?? null,
        })
        break
      case 'ASSIGNMENT_TARGET_DENIED':
        registrarEvento('assignment.target-denied', ctx)
        break
      case 'ATTACHMENT_MISSING':
      case 'ATTACHMENT_HASH_MISMATCH':
        registrarEvento('attachment.failed', {
          ...ctx,
          motivo: err.code,
          ...(err.details as Record<string, unknown>),
        })
        break
    }
    return reply.status(err.status).send(err.toBody())
  }
  logger.error(
    { type: 'forms-portal-unhandled', contexto, error: err instanceof Error ? err.stack : String(err) },
    `[formularios/portal] error no manejado en ${contexto}`,
  )
  return reply
    .status(500)
    .send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Error interno. Inténtalo de nuevo.' } })
}

export async function formulariosPortalRoutes(app: FastifyInstance) {
  app.addHook('onRequest', portalAuthMiddleware)

  const base = '/conductor-portal/formularios'

  /// Nada de este módulo se cachea en disco compartido: son datos personales de
  /// un conductor concreto. El portal los guarda en su propio IndexedDB, que es
  /// por sesión y por dispositivo.
  app.addHook('onSend', async (_request, reply, payload) => {
    if (!reply.getHeader('Cache-Control')) reply.header('Cache-Control', 'no-store')
    return payload
  })

  // ── Listado y definición ─────────────────────────────────────────────────

  app.get(base, async (request, reply) => {
    try {
      const { data, meta } = await medir('listPortal', contextoDePeticion(request), () =>
        portal.listarAsignacionesPortal(actorDe(request)),
      )
      return reply.send({ success: true, data, meta })
    } catch (err) {
      return fail(reply, err, 'listar asignaciones del portal')
    }
  })

  app.get(`${base}/:assignmentId`, async (request, reply) => {
    try {
      const { assignmentId } = request.params as { assignmentId: string }
      const { etag, data } = await portal.obtenerDefinicionPortal(actorDe(request), assignmentId)

      /// `304` cuando el cliente ya tiene esta versión: la definición de una
      /// versión publicada no cambia, y el árbol de un preoperacional pesa
      /// cientos de kilobytes que no hay que reenviar por datos móviles.
      const ifNoneMatch = request.headers['if-none-match']
      if (ifNoneMatch && ifNoneMatch === etag) {
        reply.header('ETag', etag)
        reply.header('Cache-Control', 'private, max-age=0, must-revalidate')
        return reply.status(304).send()
      }

      reply.header('ETag', etag)
      reply.header('Cache-Control', 'private, max-age=0, must-revalidate')
      return reply.send({ success: true, data })
    } catch (err) {
      return fail(reply, err, 'obtener definición del portal')
    }
  })

  // ── Historial propio (antes de `/:assignmentId` no hace falta: la ruta es
  //    más específica y Fastify prioriza el segmento literal, pero se declara
  //    después para dejar el orden de lectura por temas) ────────────────────

  app.get(`${base}/submissions`, async (request, reply) => {
    try {
      const query = parse(listarEnviosPortalSchema, request.query)
      const { data, meta } = await portal.listarEnviosPortal(actorDe(request), query)
      return reply.send({ success: true, data, meta })
    } catch (err) {
      return fail(reply, err, 'listar envíos del portal')
    }
  })

  app.get(`${base}/submissions/:id`, async (request, reply) => {
    try {
      const { id } = request.params as { id: string }
      return reply.send({ success: true, data: await portal.obtenerEnvioPortal(actorDe(request), id) })
    } catch (err) {
      return fail(reply, err, 'obtener envío del portal')
    }
  })

  // ── Borradores ───────────────────────────────────────────────────────────

  /// `bodyLimit` explícito: el default de Fastify es 1 MiB y un borrador del
  /// preoperacional FR-09 con 280 respuestas lo roza. Sin esto, el backup del
  /// borrador fallaría con un `413` que la outbox interpretaría como error de
  /// validación y bloquearía el envío.
  app.put(`${base}/drafts/:clientSubmissionId`, { bodyLimit: 2 * 1024 * 1024 }, async (request, reply) => {
    try {
      const { clientSubmissionId } = request.params as { clientSubmissionId: string }
      const input = parse(backupDraftSchema, request.body)
      const data = await portal.guardarBorradorPortal(actorDe(request), clientSubmissionId, input)
      return reply.send({ success: true, data })
    } catch (err) {
      return fail(reply, err, 'guardar borrador del portal')
    }
  })

  app.delete(`${base}/drafts/:clientSubmissionId`, async (request, reply) => {
    try {
      const { clientSubmissionId } = request.params as { clientSubmissionId: string }
      return reply.send({ success: true, data: await portal.descartarBorradorPortal(actorDe(request), clientSubmissionId) })
    } catch (err) {
      return fail(reply, err, 'descartar borrador del portal')
    }
  })

  // ── Adjuntos ─────────────────────────────────────────────────────────────

  app.post(`${base}/attachments/init`, async (request, reply) => {
    try {
      const input = parse(initAttachmentSchema, request.body)
      return reply.send({ success: true, data: await portal.iniciarAdjunto(actorDe(request), input) })
    } catch (err) {
      return fail(reply, err, 'iniciar adjunto')
    }
  })

  /**
   * Descarta un adjunto del borrador.
   *
   * Sin esta ruta, quitar una foto en el runner dejaba la fila en el servidor y el
   * envío llegaba con evidencia que el payload no declaraba. Ahora el submit
   * rechaza ese caso (`ATTACHMENT_NOT_DECLARED`) y esta es la forma de resolverlo.
   */
  app.delete(`${base}/attachments/:id`, async (request, reply) => {
    try {
      const { id } = request.params as { id: string }
      return reply.send({ success: true, data: await portal.descartarAdjunto(actorDe(request), id) })
    } catch (err) {
      return fail(reply, err, 'descartar adjunto')
    }
  })

  app.post(`${base}/attachments/:id/complete`, async (request, reply) => {
    try {
      const { id } = request.params as { id: string }
      const input = parse(completeAttachmentSchema, request.body)
      const actor = actorDe(request)
      const data = await portal.completarAdjunto(actor, id, input)

      /// Post-commit: el adjunto ya está verificado, así que la outbox puede
      /// continuar con el SUBMIT que depende de él. Solo en la primera
      /// verificación: un `complete` repetido no es novedad para nadie.
      if (!data.alreadyUploaded) {
        registrarEvento('attachment.verified', {
          ...contextoDePeticion(request),
          submissionId: data.submissionId,
          attachmentId: data.attachmentId,
          clientAttachmentId: data.clientAttachmentId,
          /// `native-checksum` o `streaming-hash`. Si en un entorno con checksum
          /// nativo habilitado empiezan a aparecer verificaciones por streaming,
          /// es un problema de configuración del bucket que hay que ver.
          verifiedBy: (data as any).verifiedBy ?? null,
        })
        formEvents.attachmentReady({
          conductorId: actor.id,
          submissionId: data.submissionId,
          attachmentId: data.attachmentId,
          clientAttachmentId: data.clientAttachmentId,
        })
      }

      return reply.send({ success: true, data })
    } catch (err) {
      return fail(reply, err, 'completar adjunto')
    }
  })

  // ── Envío final ──────────────────────────────────────────────────────────

  /// El envío final lleva respuestas Y la lista de adjuntos declarados: se le da
  /// el doble de margen que al borrador.
  app.post(`${base}/submissions`, { bodyLimit: 4 * 1024 * 1024 }, async (request, reply) => {
    try {
      /// Zod ya garantizó la forma; el `as` solo reconcilia el tipo inferido
      /// con el del dominio, que es el que consume el service.
      const input = parse(enviarSubmissionSchema, request.body) as unknown as SubmissionInput
      const resultado = await medir(
        'submit',
        { ...contextoDePeticion(request), clientSubmissionId: input.clientSubmissionId },
        () => portal.enviarSubmission(actorDe(request), input),
      )

      registrarEvento(
        resultado.idempotentReplay ? 'submission.idempotent-replay' : 'submission.accepted',
        {
          ...contextoDePeticion(request),
          submissionId: resultado.submissionId,
          clientSubmissionId: input.clientSubmissionId,
          assignmentId: resultado.assignmentId,
          versionId: input.versionId,
          businessDate: resultado.businessDate,
          respuestas: input.answers.length,
          adjuntos: input.attachments?.length ?? 0,
          offlineCreated: input.device?.offlineCreated ?? false,
        },
      )

      /// Post-commit. `idempotentReplay` distingue "guardado ahora" de "ya
      /// estaba": el portal no debe mostrar dos confirmaciones por un reintento.
      formEvents.submissionAccepted({
        conductorId: resultado.conductorId,
        submissionId: resultado.submissionId,
        clientSubmissionId: input.clientSubmissionId,
        assignmentId: resultado.assignmentId,
        businessDate: resultado.businessDate,
        idempotentReplay: resultado.idempotentReplay,
      })

      /// `200` y no `201` en el replay: el recurso no se creó en esta petición,
      /// y la outbox lo trata como éxito en los dos casos.
      return reply.status(resultado.idempotentReplay ? 200 : 201).send({
        success: true,
        data: {
          submissionId: resultado.submissionId,
          clientSubmissionId: input.clientSubmissionId,
          businessDate: resultado.businessDate,
          periodKey: resultado.periodKey,
          submittedAt: resultado.submittedAt,
          idempotentReplay: resultado.idempotentReplay,
        },
      })
    } catch (err) {
      return fail(reply, err, 'enviar submission')
    }
  })
}
