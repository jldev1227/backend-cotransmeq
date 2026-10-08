import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { avisarPreoperacional } from '../avisos-equipo/avisos-equipo.service'
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
import { FormulariosDocumentoPdfService } from './formularios-documento-pdf.service'
import * as portal from './formularios-portal.service'
import {
  assignmentIdParamSchema,
  backupDraftSchema,
  clientSubmissionIdParamSchema,
  completeAttachmentSchema,
  enviarSubmissionSchema,
  idParamSchema,
  initAttachmentSchema,
  listarEnviosPortalSchema,
  listarPapeleraPortalSchema,
} from './formularios-dinamicos.schema'

/** Prefijo de todas las rutas de este módulo. Vive a nivel de archivo porque el
 *  middleware de autenticación —declarado fuera de la función— necesita
 *  nombrar una ruta concreta para acotar el token de impresión. */
const BASE = '/conductor-portal/formularios'

/** Ruta —tal y como la declara Fastify— que el token de impresión puede usar. */
const RUTA_DETALLE_ENVIO = `${BASE}/submissions/:id`

/**
 * Vida del token de impresión.
 *
 * Solo tiene que sobrevivir a una navegación de Chromium y a la lectura que
 * hace la página. Tres minutos dan margen a un arranque lento del portal sin
 * dejar credenciales útiles rondando.
 */
const IMPRESION_TTL_SEGUNDOS = 180

/** `tipo` exclusivo del token de impresión: ningún otro módulo lo acepta. */
const TIPO_TOKEN_IMPRESION = 'conductor_portal_print'

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

    /**
     * Token de IMPRESIÓN: alcance mínimo, una sola lectura.
     *
     * Lo firma la ruta del PDF del recibo para que Chromium pueda renderizar
     * la página del portal (ver la cabecera de
     * `formularios-documento-pdf.service.ts`). Aquí se le pone el cerco: solo
     * vale para leer EL envío que lleva dentro, y nada más.
     *
     * Lleva un `tipo` PROPIO y no `conductor_portal` con una marca dentro.
     * Ese `tipo` lo comprueban también `conductor-portal.routes`, primas y
     * liquidaciones, cada una con su copia del middleware; un token con el
     * tipo del portal serviría allí aunque aquí estuviera acotado, porque
     * esas copias no saben de esta marca. Con un tipo aparte, todo lo que no
     * sea este archivo lo rechaza sin tener que enterarse de nada.
     *
     * El alcance se compara contra la ruta DECLARADA y no contra
     * `request.url`: `/submissions/:id/pdf` comparte el mismo parámetro, así
     * que mirar solo el `:id` dejaría que el impresor se invocara a sí mismo
     * en cadena con un token que ya no es el del conductor.
     */
    const esImpresion = payload.tipo === TIPO_TOKEN_IMPRESION
    if (payload.tipo !== 'conductor_portal' && !esImpresion) {
      return reply
        .status(401)
        .send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Token no autorizado para el portal.' } })
    }

    if (esImpresion) {
      const rutaDeclarada: string | undefined =
        (request as any).routeOptions?.url ?? (request as any).routerPath
      const idPedido = (request.params as { id?: string } | undefined)?.id
      const dentroDeAlcance =
        request.method === 'GET' &&
        typeof rutaDeclarada === 'string' &&
        rutaDeclarada.endsWith(RUTA_DETALLE_ENVIO) &&
        typeof payload.sid === 'string' &&
        idPedido === payload.sid
      if (!dentroDeAlcance) {
        return reply.status(403).send({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Token fuera de su alcance.' },
        })
      }
    }

    ;(request as any).portalActor = {
      kind: 'CONDUCTOR',
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
    const issues = err.issues.map((i) => ({
      code: i.code,
      path: i.path.join('.'),
      message: i.message,
    }))
    /// Este fallo ocurre ANTES del servicio: no es una regla del formulario ni
    /// algo que el conductor pueda corregir. Registrar las rutas rechazadas es lo
    /// que permite distinguir un cliente viejo, un UUID corrupto o un límite sin
    /// guardar respuestas ni otros datos personales en el log.
    registrarEvento('submission.payload-invalid', {
      ...contextoDePeticion(reply.request),
      operation: contexto,
      issues,
    })
    return reply.status(400).send({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'El envío no tiene el formato esperado.',
        details: issues,
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

  const base = BASE

  /// Nada de este módulo se cachea en disco compartido: son datos personales de
  /// un conductor concreto. El portal los guarda en su propio IndexedDB, que es
  /// por sesión y por dispositivo.
  app.addHook('onSend', async (_request, reply, payload) => {
    if (!reply.getHeader('Cache-Control')) reply.header('Cache-Control', 'no-store')
    return payload
  })

  // ── Sonda de conectividad ────────────────────────────────────────────────

  /**
   * Responde lo mínimo para demostrar que se llegó al servidor.
   *
   * La outbox del portal necesita distinguir «no hay red» de «la interfaz dice
   * que sí pero no llega nada» —portal cautivo de hotel, datos agotados—, así
   * que sondea antes de cada ronda de sincronización. Preguntaba por `base`, que
   * arma la lista completa de asignaciones con sus borradores: una consulta cara
   * y repetida para responder un sí/no que no necesita ningún dato.
   *
   * Aquí no se toca la base de datos. Llegar al handler ya prueba las dos cosas
   * que importan: hay ruta hasta el servidor y el token del portal es válido,
   * porque `portalAuthMiddleware` corre antes.
   *
   * Va declarada antes que `/:assignmentId` por legibilidad; el router de
   * Fastify prioriza el segmento estático igualmente.
   */
  app.get(`${base}/ping`, async (_request, reply) => reply.send({ success: true }))

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
      const { assignmentId } = parse(assignmentIdParamSchema, request.params)
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
      const { id } = parse(idParamSchema, request.params)
      return reply.send({ success: true, data: await portal.obtenerEnvioPortal(actorDe(request), id) })
    } catch (err) {
      return fail(reply, err, 'obtener envío del portal')
    }
  })

  /**
   * PDF del documento de un envío.
   *
   * No compone documento: manda a Chromium a imprimir la MISMA página del
   * portal web que el conductor puede abrir —`…/envios/<id>/documento`, el
   * mismo `PreviewEnvioPDF` que el dashboard exporta—. El razonamiento
   * completo —y las cuatro garantías que sostienen que esto siga siendo seguro
   * pese a que ahora la página de Puppeteer sí lleva sesión— están en la
   * cabecera de `formularios-documento-pdf.service.ts`.
   *
   * El token de impresión NO cambia de alcance: esa página se alimenta del
   * mismo `GET /submissions/:id` que ya era su única lectura permitida.
   */
  app.get(`${base}/submissions/:id/pdf`, async (request, reply) => {
    try {
      const { id } = parse(idParamSchema, request.params)
      const actor = actorDe(request)

      /// Propiedad ANTES de imprimir. Filtra por `conductor_id` y lanza
      /// `SUBMISSION_NOT_FOUND` si el envío es de otro, así que lo que se
      /// navega es el id de la fila devuelta y no el del parámetro.
      const { submission } = await portal.obtenerEnvioPortal(actor, id)

      const expiraEn = new Date(Date.now() + IMPRESION_TTL_SEGUNDOS * 1000)
      const tokenDeImpresion = jwt.sign(
        {
          tipo: TIPO_TOKEN_IMPRESION,
          sid: submission.id,
          cedula: actor.kind === 'CONDUCTOR' ? actor.cedula : undefined,
          nombre: actor.nombre,
        },
        env.JWT_SECRET,
        { subject: actor.id, expiresIn: IMPRESION_TTL_SEGUNDOS },
      )

      const pdf = await FormulariosDocumentoPdfService.imprimirDocumentoDeEnvio(submission.id, {
        token: tokenDeImpresion,
        conductor: {
          id: actor.id,
          nombre: actor.nombre ?? '',
          apellido: '',
          numero_identificacion: (actor.kind === 'CONDUCTOR' ? actor.cedula : null) ?? '',
        },
        expiresAt: expiraEn.toISOString(),
      })

      const nombre = `documento-${submission.id}`.replace(/[^a-z0-9_\-]/gi, '_')
      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `inline; filename="${nombre}.pdf"`)
        .header('Content-Length', String(pdf.length))
        .header('Cache-Control', 'private, max-age=0, no-store')
        .send(pdf)
    } catch (err) {
      return fail(reply, err, 'imprimir el documento del envío')
    }
  })

  // ── Borradores ───────────────────────────────────────────────────────────

  /**
   * Red de rescate del portal.
   *
   * IndexedDB sigue siendo el original. Esta lectura solo entra cuando la outbox
   * sobrevivió pero el borrador local desapareció: devuelve la copia propia del
   * mismo conductor para reconstruir la cola en vez de obligarlo a diligenciarla
   * otra vez.
   */
  /**
   * Papelera del conductor.
   *
   * Declarada antes que `/drafts/:clientSubmissionId` por legibilidad; el router
   * de Fastify prioriza el segmento estático igualmente, y `papelera` tampoco
   * pasaría el `uuid` del parámetro.
   */
  app.get(`${base}/drafts/papelera`, async (request, reply) => {
    try {
      const query = parse(listarPapeleraPortalSchema, request.query)
      const { data, meta } = await portal.listarPapeleraPortal(actorDe(request), query)
      return reply.send({ success: true, data, meta })
    } catch (err) {
      return fail(reply, err, 'listar la papelera del portal')
    }
  })

  app.post(`${base}/drafts/:clientSubmissionId/restaurar`, async (request, reply) => {
    try {
      const { clientSubmissionId } = parse(clientSubmissionIdParamSchema, request.params)
      return reply.send({
        success: true,
        data: await portal.restaurarBorradorPortal(actorDe(request), clientSubmissionId),
      })
    } catch (err) {
      return fail(reply, err, 'restaurar borrador del portal')
    }
  })

  app.get(`${base}/drafts/:clientSubmissionId`, async (request, reply) => {
    try {
      const { clientSubmissionId } = parse(clientSubmissionIdParamSchema, request.params)
      return reply.send({
        success: true,
        data: await portal.obtenerBorrador(actorDe(request), clientSubmissionId),
      })
    } catch (err) {
      return fail(reply, err, 'recuperar borrador del portal')
    }
  })

  /// `bodyLimit` explícito: el default de Fastify es 1 MiB y un borrador del
  /// preoperacional FR-09 con 280 respuestas lo roza. Sin esto, el backup del
  /// borrador fallaría con un `413` que la outbox interpretaría como error de
  /// validación y bloquearía el envío.
  app.put(`${base}/drafts/:clientSubmissionId`, { bodyLimit: 2 * 1024 * 1024 }, async (request, reply) => {
    try {
      const { clientSubmissionId } = parse(clientSubmissionIdParamSchema, request.params)
      const input = parse(backupDraftSchema, request.body)
      const data = await portal.guardarBorradorPortal(actorDe(request), clientSubmissionId, input)
      return reply.send({ success: true, data })
    } catch (err) {
      return fail(reply, err, 'guardar borrador del portal')
    }
  })

  app.delete(`${base}/drafts/:clientSubmissionId`, async (request, reply) => {
    try {
      const { clientSubmissionId } = parse(clientSubmissionIdParamSchema, request.params)
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
      const { id } = parse(idParamSchema, request.params)
      return reply.send({ success: true, data: await portal.descartarAdjunto(actorDe(request), id) })
    } catch (err) {
      return fail(reply, err, 'descartar adjunto')
    }
  })

  app.post(`${base}/attachments/:id/complete`, async (request, reply) => {
    try {
      const { id } = parse(idParamSchema, request.params)
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
        /// Esta ruta es la del portal: su middleware exige
        /// `tipo === 'conductor_portal'`, así que el actor siempre es un
        /// conductor y `actorId` es su id. La room del socket solo existe para
        /// conductores; los envíos del dashboard no emiten por aquí.
        conductorId: resultado.actorId,
        submissionId: resultado.submissionId,
        clientSubmissionId: input.clientSubmissionId,
        assignmentId: resultado.assignmentId,
        businessDate: resultado.businessDate,
        idempotentReplay: resultado.idempotentReplay,
      })
      /// Si es un preoperacional, operaciones y HSEQ se enteran (un reintento no vuelve a avisar).
      if (!resultado.idempotentReplay) void avisarPreoperacional(resultado.submissionId)

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
