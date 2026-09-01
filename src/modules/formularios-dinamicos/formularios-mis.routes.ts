import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { ZodError, type ZodSchema } from 'zod'
import { authMiddleware } from '../../middlewares/auth.middleware'
import { requirePermission } from '../../middlewares/permissions.middleware'
import { logger } from '../../utils/logger'
import { isFormError, type FormActor, type SubmissionInput } from './domain'
import { contextoDePeticion, medir, registrarEvento } from './formularios-dinamicos.observabilidad'
import * as portal from './formularios-portal.service'
import {
  backupDraftSchema,
  completeAttachmentSchema,
  enviarSubmissionSchema,
  initAttachmentSchema,
  listarEnviosPortalSchema,
} from './formularios-dinamicos.schema'

/**
 * «Mis formularios»: diligenciamiento por un usuario interno del dashboard.
 *
 * Es la segunda puerta al MISMO service que usa el portal del conductor
 * (`formularios-portal.service.ts`). Lo único que cambia es de dónde sale la
 * identidad; los límites, la idempotencia, la validación de respuestas y la
 * cadena de adjuntos son literalmente el mismo código, que es lo que evita que
 * las dos audiencias se desincronicen.
 *
 * ── Por qué un prefijo propio y no `/api/formularios/mis-...` ───────────────
 *
 *  1. **Permiso distinto.** `formulariosDinamicosRoutes` exige el módulo
 *     `formularios` en todas sus rutas, y ese permiso es el del CONSTRUCTOR:
 *     solo `administracion` y `hseq`. Diligenciar no puede depender de él, o a
 *     alguien de contabilidad al que HSEQ le asigna una inspección no le
 *     aparecería. Aquí se exige `mis-formularios`, que es `general: true`.
 *  2. **Orden de rutas.** Bajo `/formularios` habría que declarar cada literal
 *     antes que `/:formId` o Fastify resolvería `mis-formularios` como el id de
 *     un formulario. Un prefijo aparte lo hace imposible por construcción.
 *
 * ── Qué NO está aquí ────────────────────────────────────────────────────────
 *
 * No hay `ping`: la sonda existe para que la outbox del móvil distinga «no hay
 * red» de «hay wifi pero no llega nada», y este runner es en línea, sin outbox.
 * Tampoco emite eventos de socket: las rooms del gateway son de conductores.
 */

/**
 * Actor a partir del JWT del dashboard.
 *
 * Solo la identidad. Las áreas y el cargo NO se toman del token aunque viajen
 * en él: un JWT dura días y alguien a quien se le retiró un área seguiría
 * viendo sus formularios hasta que caducara. `condicionAcceso` los relee de la
 * base en cada petición.
 */
function actorDe(request: FastifyRequest): FormActor {
  const user = (request as any).user
  return { kind: 'USER', id: user.id, nombre: user.nombre || user.name || user.correo }
}

function parse<T>(schema: ZodSchema<T>, value: unknown): T {
  return schema.parse(value)
}

/**
 * Traducción de errores.
 *
 * Misma forma de respuesta que el portal (`{ success, error: { code, ... } }`)
 * para que el cliente pueda compartir el tipo de error, aunque este runner no
 * tenga outbox que decida reintentos con el `code`.
 */
function fail(reply: FastifyReply, err: unknown, contexto: string) {
  if (err instanceof ZodError) {
    return reply.status(400).send({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'El formulario no tiene el formato esperado.',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    })
  }
  if (isFormError(err)) {
    const ctx = contextoDePeticion(reply.request)
    switch (err.code) {
      case 'SUBMISSION_LIMIT_REACHED':
        registrarEvento('submission.limit-reached', { ...ctx, ...(err.details as Record<string, unknown>) })
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
    }
    return reply.status(err.status).send(err.toBody())
  }
  logger.error(
    { type: 'forms-mis-unhandled', contexto, error: err instanceof Error ? err.stack : String(err) },
    `[formularios/mis] error no manejado en ${contexto}`,
  )
  return reply
    .status(500)
    .send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Error interno. Inténtalo de nuevo.' } })
}

export async function formulariosMisRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authMiddleware)

  const base = '/mis-formularios'

  /// `read` y no `full`: el nivel del módulo `mis-formularios` no gradúa nada
  /// —es `general: true`, o entras o no entras—, y pedir `full` no añadiría
  /// ninguna protección. Lo que decide si puedes diligenciar UNA asignación
  /// concreta son sus targets, en `condicionAcceso`.
  const puedeDiligenciar = { preHandler: requirePermission('mis-formularios', 'read') }

  /// Datos personales de quien diligencia: nunca en una caché compartida.
  app.addHook('onSend', async (_request, reply, payload) => {
    if (!reply.getHeader('Cache-Control')) reply.header('Cache-Control', 'no-store')
    return payload
  })

  // ── Listado y definición ─────────────────────────────────────────────────

  app.get(base, puedeDiligenciar, async (request, reply) => {
    try {
      const { data, meta } = await medir('listMis', contextoDePeticion(request), () =>
        portal.listarAsignacionesPortal(actorDe(request)),
      )
      return reply.send({ success: true, data, meta })
    } catch (err) {
      return fail(reply, err, 'listar mis formularios')
    }
  })

  // ── Envíos propios ───────────────────────────────────────────────────────
  //
  // Antes que `/:assignmentId` para que `submissions` no se resuelva como el id
  // de una asignación.

  app.get(`${base}/submissions`, puedeDiligenciar, async (request, reply) => {
    try {
      const query = parse(listarEnviosPortalSchema, request.query)
      const { data, meta } = await portal.listarEnviosPortal(actorDe(request), query)
      return reply.send({ success: true, data, meta })
    } catch (err) {
      return fail(reply, err, 'listar mis envíos')
    }
  })

  app.get(`${base}/submissions/:id`, puedeDiligenciar, async (request, reply) => {
    try {
      const { id } = request.params as { id: string }
      return reply.send({ success: true, data: await portal.obtenerEnvioPortal(actorDe(request), id) })
    } catch (err) {
      return fail(reply, err, 'obtener mi envío')
    }
  })

  // ── Borradores ───────────────────────────────────────────────────────────

  /**
   * Relee un borrador propio.
   *
   * Es la ruta que NO existe en el portal, y la razón de que este runner pueda
   * ser en línea: sin outbox ni IndexedDB, recargar la página a media
   * inspección solo se recupera si el servidor devuelve lo escrito.
   */
  app.get(`${base}/drafts/:clientSubmissionId`, puedeDiligenciar, async (request, reply) => {
    try {
      const { clientSubmissionId } = request.params as { clientSubmissionId: string }
      return reply.send({ success: true, data: await portal.obtenerBorrador(actorDe(request), clientSubmissionId) })
    } catch (err) {
      return fail(reply, err, 'obtener mi borrador')
    }
  })

  /// Mismo `bodyLimit` que el portal: el autoguardado manda el árbol entero de
  /// respuestas, sin binarios.
  app.put(`${base}/drafts/:clientSubmissionId`, { ...puedeDiligenciar, bodyLimit: 2 * 1024 * 1024 }, async (request, reply) => {
    try {
      const { clientSubmissionId } = request.params as { clientSubmissionId: string }
      const input = parse(backupDraftSchema, request.body)
      return reply.send({ success: true, data: await portal.guardarBorradorPortal(actorDe(request), clientSubmissionId, input) })
    } catch (err) {
      return fail(reply, err, 'guardar mi borrador')
    }
  })

  app.delete(`${base}/drafts/:clientSubmissionId`, puedeDiligenciar, async (request, reply) => {
    try {
      const { clientSubmissionId } = request.params as { clientSubmissionId: string }
      return reply.send({ success: true, data: await portal.descartarBorradorPortal(actorDe(request), clientSubmissionId) })
    } catch (err) {
      return fail(reply, err, 'descartar mi borrador')
    }
  })

  // ── Adjuntos ─────────────────────────────────────────────────────────────
  //
  // Misma cadena que el portal: INIT reserva metadata y URL firmada, el
  // navegador hace el PUT directo a S3 y COMPLETE verifica el sha256 contra el
  // objeto subido. El binario no pasa por el backend en ningún momento.

  app.post(`${base}/attachments/init`, puedeDiligenciar, async (request, reply) => {
    try {
      const input = parse(initAttachmentSchema, request.body)
      return reply.send({ success: true, data: await portal.iniciarAdjunto(actorDe(request), input) })
    } catch (err) {
      return fail(reply, err, 'iniciar adjunto')
    }
  })

  app.post(`${base}/attachments/:id/complete`, puedeDiligenciar, async (request, reply) => {
    try {
      const { id } = request.params as { id: string }
      const input = parse(completeAttachmentSchema, request.body)
      const data = await portal.completarAdjunto(actorDe(request), id, input)
      if (!data.alreadyUploaded) {
        registrarEvento('attachment.verified', {
          ...contextoDePeticion(request),
          submissionId: data.submissionId,
          attachmentId: data.attachmentId,
          clientAttachmentId: data.clientAttachmentId,
          verifiedBy: (data as any).verifiedBy ?? null,
        })
      }
      return reply.send({ success: true, data })
    } catch (err) {
      return fail(reply, err, 'completar adjunto')
    }
  })

  /// Quitar una evidencia del borrador. Sin esta ruta, la fila se quedaría en
  /// el servidor y el envío se rechazaría con `ATTACHMENT_NOT_DECLARED`.
  app.delete(`${base}/attachments/:id`, puedeDiligenciar, async (request, reply) => {
    try {
      const { id } = request.params as { id: string }
      return reply.send({ success: true, data: await portal.descartarAdjunto(actorDe(request), id) })
    } catch (err) {
      return fail(reply, err, 'descartar adjunto')
    }
  })

  // ── Definición ───────────────────────────────────────────────────────────
  //
  // La paramétrica va al final, después de todas las literales.

  app.get(`${base}/:assignmentId`, puedeDiligenciar, async (request, reply) => {
    try {
      const { assignmentId } = request.params as { assignmentId: string }
      const { etag, data } = await portal.obtenerDefinicionPortal(actorDe(request), assignmentId)

      /// El mismo `304` que el portal. Aquí no ahorra datos móviles, pero el
      /// árbol de un preoperacional pesa cientos de kilobytes y se vuelve a
      /// pedir cada vez que alguien abre el formulario.
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
      return fail(reply, err, 'obtener definición')
    }
  })

  // ── Envío final ──────────────────────────────────────────────────────────

  app.post(`${base}/submissions`, { ...puedeDiligenciar, bodyLimit: 4 * 1024 * 1024 }, async (request, reply) => {
    try {
      /// Zod ya garantizó la forma; el `as` solo reconcilia el tipo inferido con
      /// el del dominio, que es el que consume el service.
      const input = parse(enviarSubmissionSchema, request.body) as unknown as SubmissionInput
      const resultado = await medir(
        'submitMis',
        { ...contextoDePeticion(request), clientSubmissionId: input.clientSubmissionId },
        () => portal.enviarSubmission(actorDe(request), input),
      )

      registrarEvento(resultado.idempotentReplay ? 'submission.idempotent-replay' : 'submission.accepted', {
        ...contextoDePeticion(request),
        submissionId: resultado.submissionId,
        clientSubmissionId: input.clientSubmissionId,
        assignmentId: resultado.assignmentId,
        versionId: input.versionId,
        businessDate: resultado.businessDate,
        respuestas: input.answers.length,
        adjuntos: input.attachments?.length ?? 0,
      })

      /// `200` y no `201` en el replay: el recurso no se creó en esta petición.
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
      return fail(reply, err, 'enviar mi formulario')
    }
  })
}
