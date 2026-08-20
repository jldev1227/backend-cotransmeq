/**
 * API del portal del conductor.
 *
 * Tres cosas gobiernan todo este archivo:
 *
 *  1. **La identidad viene del token, nunca del payload.** Cada función recibe
 *     un `PortalActor` que el middleware derivó del JWT del magic link. Ningún
 *     `conductorId` del cuerpo de la petición autoriza nada; si lo hiciera,
 *     cualquiera podría enviar preoperacionales en nombre de otro.
 *
 *  2. **El envío es idempotente por `client_submission_id`.** El teléfono
 *     genera ese UUID antes de empezar. Si la red se corta después de que el
 *     servidor guardó, el reintento devuelve el MISMO envío con
 *     `idempotentReplay: true` en vez de crear un duplicado. Si el payload
 *     cambió, se rechaza con `IDEMPOTENCY_PAYLOAD_MISMATCH` en vez de
 *     confirmar en silencio algo que no se guardó.
 *
 *  3. **El servidor revalida todo.** Required, tipos, rangos, opciones,
 *     visibilidad y adjuntos se comprueban aquí otra vez, porque el runner
 *     puede estar cacheado, desactualizado o simplemente saltado.
 */

import { createHash, randomUUID } from 'crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '../../config/prisma'
import {
  computeS3ObjectSha256,
  getS3SignedUrl,
  getS3UploadUrl,
  headS3Object,
  sha256HexToBase64,
} from '../../config/aws'
import { env } from '../../config/env'
import { logger } from '../../utils/logger'
import {
  ATTACHMENT_LIMITS,
  BUSINESS_TIMEZONE,
  FormError,
  businessDateFor,
  capabilitiesOf,
  periodKeyFor,
  submissionFingerprintPayload,
  type AnswerInput,
  type AttachmentInput,
  type AttachmentKind,
  type SubmissionInput,
} from './domain'
import { toSubmissionDetailDto, toSubmissionSummaryDto, toVersionDto } from './formularios-dinamicos.mapper'
import { findVersionAggregate } from './formularios-dinamicos.repository'
import {
  lockIdempotencia,
  lockLimite,
  lockSubmissionPorClientId,
  lockSubmissionPorId,
  TX_OPCIONES,
} from './formularios-portal.locks'
import { validateSubmissionAnswers, type PreparedAnswer } from './formularios-respuestas'
import type {
  BackupDraftInput,
  CompleteAttachmentInput,
  InitAttachmentInput,
  ListarEnviosPortalQuery,
} from './formularios-dinamicos.schema'

/** Conductor autenticado por magic link. Sale del JWT `tipo: conductor_portal`. */
export interface PortalActor {
  id: string
  cedula?: string
  nombre?: string
}

const PREFIJO_S3 = 'formularios-dinamicos'

// ─────────────────────────────────────────────────────────────────────────────
// Acceso: qué asignaciones alcanza este conductor
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Filtro de asignaciones accesibles por un conductor.
 *
 * Se construye como cláusula de Prisma y no como filtro en memoria para que la
 * lista y la comprobación de acceso a UNA asignación usen literalmente la misma
 * definición de "accesible". Si fueran dos implementaciones, una acabaría
 * dejando pasar lo que la otra oculta.
 */
async function condicionAcceso(conductorId: string): Promise<Prisma.form_assignmentWhereInput> {
  const conductor = await prisma.conductores.findFirst({
    where: { id: conductorId, deleted_at: null },
    select: { id: true, sede_trabajo: true },
  })
  if (!conductor) throw new FormError('FORBIDDEN', 'El conductor no existe o está inactivo.')

  /// Vehículos asignados al conductor: un target VEHICLE alcanza al conductor
  /// que conduce ese vehículo.
  const vehiculos = await prisma.vehiculos.findMany({
    where: { conductor_id: conductorId, deleted_at: null },
    select: { id: true },
  })

  const targetOr: Prisma.form_assignment_targetWhereInput[] = [
    { target_type: 'ALL_CONDUCTORS' },
    { target_type: 'CONDUCTOR', conductor_id: conductorId },
  ]
  if (vehiculos.length) {
    targetOr.push({ target_type: 'VEHICLE', vehicle_id: { in: vehiculos.map((v) => v.id) } })
  }
  if (conductor.sede_trabajo) {
    targetOr.push({ target_type: 'SEDE', sede: String(conductor.sede_trabajo) })
  }

  return {
    deleted_at: null,
    /// `PAUSED` queda fuera: pausar debe hacer desaparecer la tarjeta, que es
    /// justamente el rollback funcional del módulo.
    status: 'ACTIVE',
    /// Solo versiones publicadas. Una versión archivada conserva el histórico
    /// pero no admite envíos nuevos.
    version: { status: 'PUBLISHED', form: { deleted_at: null } },
    targets: { some: { OR: targetOr } },
  }
}

/** Vigencia respecto a "ahora". Se evalúa en servidor: el reloj del móvil miente. */
function dentroDeVigencia(assignment: { starts_at: Date | null; ends_at: Date | null }, now: Date): boolean {
  if (assignment.starts_at && now < assignment.starts_at) return false
  if (assignment.ends_at && now > assignment.ends_at) return false
  return true
}

const listaAssignmentSelect = {
  id: true,
  version_id: true,
  name: true,
  status: true,
  frequency: true,
  limit_policy: true,
  timezone: true,
  starts_at: true,
  ends_at: true,
  context_schema_json: true,
  settings_json: true,
  version: {
    select: {
      id: true,
      form_id: true,
      version_number: true,
      title: true,
      revision: true,
      form: { select: { code: true, name: true } },
    },
  },
} satisfies Prisma.form_assignmentSelect

/**
 * Tarjetas del portal: qué puede diligenciar hoy, qué lleva hecho y qué tiene a
 * medias.
 *
 * Los conteos se resuelven con dos `groupBy` en lugar de una consulta por
 * tarjeta: un conductor con doce asignaciones haría veinticuatro consultas, y
 * esta es la pantalla que se abre con mala cobertura.
 */
export async function listarAsignacionesPortal(actor: PortalActor) {
  const now = new Date()
  const where = await condicionAcceso(actor.id)

  const asignaciones = await prisma.form_assignment.findMany({
    where,
    select: listaAssignmentSelect,
    orderBy: { created_at: 'asc' },
  })

  const vigentes = asignaciones.filter((a) => dentroDeVigencia(a, now))
  const ids = vigentes.map((a) => a.id)

  const [enviosPorPeriodo, borradores] = await Promise.all([
    ids.length
      ? prisma.form_submission.groupBy({
          by: ['assignment_id', 'period_key'],
          where: { conductor_id: actor.id, assignment_id: { in: ids }, status: 'SUBMITTED' },
          _count: { _all: true },
        })
      : [],
    ids.length
      ? prisma.form_submission.findMany({
          where: { conductor_id: actor.id, assignment_id: { in: ids }, status: 'DRAFT' },
          select: {
            assignment_id: true,
            client_submission_id: true,
            updated_at: true,
            context_json: true,
            device_json: true,
          },
          orderBy: { updated_at: 'desc' },
        })
      : [],
  ])

  const borradorPorAsignacion = new Map<string, (typeof borradores)[number]>()
  for (const b of borradores) if (!borradorPorAsignacion.has(b.assignment_id)) borradorPorAsignacion.set(b.assignment_id, b)

  const data = vigentes.map((a) => {
    const businessDate = businessDateFor(now, a.timezone || BUSINESS_TIMEZONE)
    const periodKey = periodKeyFor(a.frequency as any, businessDate)

    const delPeriodo = (enviosPorPeriodo as any[]).filter(
      (g) => g.assignment_id === a.id && (periodKey === null || g.period_key === periodKey),
    )
    const enviadosPeriodo = delPeriodo.reduce((sum, g) => sum + g._count._all, 0)

    /// `ONE_PER_CONTEXT` no puede saberse aquí: depende del vehículo que el
    /// conductor elija al abrir el formulario, y todavía no lo ha elegido. Se
    /// deja como AVAILABLE y el límite se comprueba en el POST, que es donde el
    /// contexto ya existe.
    const agotado =
      (a.limit_policy === 'ONE_PER_PERIOD' || a.frequency === 'ONCE') && enviadosPeriodo > 0

    const borrador = borradorPorAsignacion.get(a.id)
    const settings = (a.settings_json ?? {}) as Record<string, unknown>
    const contextSchema = (a.context_schema_json ?? {}) as Record<string, { required?: boolean }>

    return {
      assignmentId: a.id,
      formId: a.version.form_id,
      versionId: a.version_id,
      code: a.version.form.code,
      title: a.version.title || a.version.form.name,
      name: a.name,
      frequency: a.frequency,
      limitPolicy: a.limit_policy,
      dueState: agotado ? 'DONE' : 'AVAILABLE',
      submittedThisPeriod: enviadosPeriodo,
      periodKey,
      businessDate,
      draft: borrador
        ? {
            clientSubmissionId: borrador.client_submission_id,
            updatedAt: borrador.updated_at.toISOString(),
            progress: Number((borrador.device_json as any)?.progress ?? 0) || 0,
            context: borrador.context_json,
          }
        : null,
      allowOffline: settings.allowOffline !== false,
      requiresContext: Object.entries(contextSchema)
        .filter(([, v]) => v?.required)
        .map(([k]) => k),
      revision: a.version.revision,
    }
  })

  return {
    data,
    meta: {
      today: businessDateFor(now),
      pending: data.filter((d) => d.dueState === 'AVAILABLE').length,
      drafts: data.filter((d) => d.draft).length,
    },
  }
}

/**
 * Definición publicada de una asignación accesible.
 *
 * Devuelve también un ETag para que el portal pueda revalidar sin volver a
 * descargar el árbol completo. El ETag se deriva de `versionId` + `revision`:
 * una versión publicada es inmutable, así que si esos dos no cambian el
 * contenido tampoco.
 */
export async function obtenerDefinicionPortal(actor: PortalActor, assignmentId: string) {
  const where = await condicionAcceso(actor.id)
  const assignment = await prisma.form_assignment.findFirst({
    where: { AND: [where, { id: assignmentId }] },
    select: listaAssignmentSelect,
  })
  if (!assignment) {
    /// 403 explícito: distinguir "no existe" de "no te corresponde" es lo que
    /// permite depurar un target mal configurado en producción.
    throw new FormError('ASSIGNMENT_TARGET_DENIED', 'Este formulario no está asignado a ti.')
  }
  if (!dentroDeVigencia(assignment, new Date())) {
    throw new FormError('ASSIGNMENT_NOT_AVAILABLE', 'La asignación no está vigente.')
  }

  const version = await findVersionAggregate(prisma, assignment.version_id)
  if (!version) throw new FormError('VERSION_NOT_FOUND', 'La versión no existe.')

  const now = new Date()
  const businessDate = businessDateFor(now, assignment.timezone || BUSINESS_TIMEZONE)

  return {
    etag: `"${assignment.version_id}-${version.revision}"`,
    data: {
      assignment: {
        id: assignment.id,
        name: assignment.name,
        frequency: assignment.frequency,
        limitPolicy: assignment.limit_policy,
        timezone: assignment.timezone,
        contextSchema: assignment.context_schema_json,
        settings: assignment.settings_json,
        businessDate,
        periodKey: periodKeyFor(assignment.frequency as any, businessDate),
      },
      definition: toVersionDto(version),
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Borradores (backup en servidor)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Backup del borrador.
 *
 * Es un extra, no el camino principal: la fuente de verdad del borrador es
 * IndexedDB en el teléfono. Esto solo existe para que un conductor que pierde
 * el móvil no pierda dos horas de inspección, así que nunca debe bloquear la
 * captura y no guarda adjuntos.
 */
export async function guardarBorradorPortal(
  actor: PortalActor,
  clientSubmissionId: string,
  input: BackupDraftInput,
) {
  const where = await condicionAcceso(actor.id)
  const assignment = await prisma.form_assignment.findFirst({
    where: { AND: [where, { id: input.assignmentId }] },
    select: { id: true, version_id: true, frequency: true, timezone: true },
  })
  if (!assignment) throw new FormError('ASSIGNMENT_TARGET_DENIED', 'Este formulario no está asignado a ti.')
  if (assignment.version_id !== input.versionId) {
    throw new FormError('VERSION_NOT_PUBLISHED', 'La versión del borrador ya no es la vigente de esta asignación.', {
      currentVersionId: assignment.version_id,
    })
  }

  const existente = await prisma.form_submission.findUnique({
    where: { client_submission_id: clientSubmissionId },
    select: { id: true, conductor_id: true, status: true },
  })

  if (existente) {
    if (existente.conductor_id !== actor.id) {
      throw new FormError('FORBIDDEN', 'Ese borrador no es tuyo.')
    }
    if (existente.status !== 'DRAFT') {
      /// Ya se envió. No es un error del conductor: su outbox venía retrasada.
      return { id: existente.id, status: existente.status, alreadySubmitted: true }
    }
  }

  const now = new Date()
  const businessDate = businessDateFor(now, assignment.timezone || BUSINESS_TIMEZONE)
  const periodKey = periodKeyFor(assignment.frequency as any, businessDate)
  const contexto = (input.context ?? {}) as Record<string, unknown>

  const submissionId = existente?.id ?? randomUUID()

  await prisma.$transaction(async (tx) => {
    /// Paso 3 del orden global. La comprobación de arriba es optimista: entre
    /// ella y esta escritura cabe un `enviarSubmission`, y sin el lock el backup
    /// borraría las respuestas de un envío ya entregado (`deleteMany` más abajo).
    if (existente) {
      const bloqueada = await lockSubmissionPorId(tx, existente.id)
      if (!bloqueada) throw new FormError('SUBMISSION_NOT_FOUND', 'El borrador ya no existe.')
      if (bloqueada.status !== 'DRAFT') {
        /// Se entregó mientras el backup estaba en vuelo. No es un error: la
        /// outbox venía retrasada y el envío final ya escribió lo definitivo.
        return
      }
    }

    if (!existente) {
      await tx.form_submission.create({
        data: {
          id: submissionId,
          client_submission_id: clientSubmissionId,
          assignment_id: assignment.id,
          version_id: assignment.version_id,
          conductor_id: actor.id,
          vehicle_id: typeof contexto.vehicleId === 'string' ? contexto.vehicleId : null,
          service_id: typeof contexto.serviceId === 'string' ? contexto.serviceId : null,
          status: 'DRAFT',
          business_date: new Date(`${businessDate}T00:00:00.000Z`),
          period_key: periodKey,
          context_json: contexto as Prisma.InputJsonValue,
          device_json: { ...(input.device ?? {}), progress: input.progress ?? 0 } as Prisma.InputJsonValue,
        },
      })
      await tx.form_submission_event.create({
        data: {
          id: randomUUID(),
          submission_id: submissionId,
          event_type: 'CREATED',
          actor_type: 'CONDUCTOR',
          actor_id: actor.id,
          payload_json: { source: 'draft-backup' } as Prisma.InputJsonValue,
        },
      })
    } else {
      await tx.form_submission.update({
        where: { id: submissionId },
        data: {
          vehicle_id: typeof contexto.vehicleId === 'string' ? contexto.vehicleId : null,
          service_id: typeof contexto.serviceId === 'string' ? contexto.serviceId : null,
          context_json: contexto as Prisma.InputJsonValue,
          device_json: { ...(input.device ?? {}), progress: input.progress ?? 0 } as Prisma.InputJsonValue,
        },
      })
      /// El borrador se reescribe entero: un diff por respuesta sería más
      /// código para el mismo resultado, y el backup no necesita historial.
      await tx.form_answer.deleteMany({ where: { submission_id: submissionId } })
    }

    /// Las respuestas del backup se guardan SIN validar tipos ni required: es
    /// un borrador a medias por definición. La validación es del POST final.
    await escribirRespuestasCrudas(tx, submissionId, input.answers as unknown as AnswerInput[])
  }, TX_OPCIONES)

  return { id: submissionId, status: 'DRAFT', alreadySubmitted: false }
}

/**
 * Vuelca respuestas de borrador tal como llegan.
 *
 * Todo va a `value_text`/`value_json` sin interpretar el tipo del campo. Es
 * deliberado: un número a medio escribir ("12,") no es un decimal válido y
 * rechazarlo perdería lo que el conductor llevaba escrito.
 */
async function escribirRespuestasCrudas(
  tx: Prisma.TransactionClient,
  submissionId: string,
  answers: AnswerInput[],
): Promise<void> {
  if (answers.length === 0) return

  /**
   * `createMany` y no un `create` por respuesta.
   *
   * Esto era un viaje de red por cada respuesta, dentro de la transacción. Contra
   * una base remota se midió en ~0,7 s por respuesta: 13 respuestas tardaban casi
   * 9 s, y un preoperacional completo (más de 270) habría superado el `timeout` de
   * la transacción, así que el backup del borrador NUNCA habría funcionado en un
   * formulario real. Con una sola sentencia es un viaje, no doscientos setenta.
   *
   * Los ids se generan aquí porque `createMany` no los devuelve. No hace falta
   * conocerlos: estas respuestas son un backup crudo que el envío final reescribe
   * por completo, y nada apunta a ellas.
   */
  await tx.form_answer.createMany({
    data: answers.map((answer) => {
      const tieneOpciones = (answer.optionValues ?? []).length > 0
      return {
        id: randomUUID(),
        submission_id: submissionId,
        field_id: answer.fieldId,
        occurrence_id: answer.occurrenceId ?? null,
        row_index: answer.rowIndex ?? null,
        value_json: tieneOpciones
          ? ({ draftOptionValues: answer.optionValues } as Prisma.InputJsonValue)
          : answer.value === undefined || answer.value === null
            ? Prisma.DbNull
            : ({ draftValue: answer.value } as Prisma.InputJsonValue),
      }
    }),
  })
}

export async function descartarBorradorPortal(actor: PortalActor, clientSubmissionId: string) {
  const existente = await prisma.form_submission.findUnique({
    where: { client_submission_id: clientSubmissionId },
    select: { id: true, conductor_id: true, status: true },
  })
  if (!existente) return { id: null, deleted: false }
  if (existente.conductor_id !== actor.id) throw new FormError('FORBIDDEN', 'Ese borrador no es tuyo.')
  if (existente.status !== 'DRAFT') {
    throw new FormError('SUBMISSION_IMMUTABLE', 'Un envío entregado no se descarta.')
  }
  await prisma.form_submission.delete({ where: { id: existente.id } })
  return { id: existente.id, deleted: true }
}

// ─────────────────────────────────────────────────────────────────────────────
// Adjuntos
// ─────────────────────────────────────────────────────────────────────────────

function limitesPorTipo(kind: AttachmentKind) {
  switch (kind) {
    case 'PHOTO':
      return { maxBytes: ATTACHMENT_LIMITS.maxPhotoBytes, mimes: ATTACHMENT_LIMITS.allowedPhotoMime }
    case 'SIGNATURE':
      return { maxBytes: ATTACHMENT_LIMITS.maxSignatureBytes, mimes: ATTACHMENT_LIMITS.allowedSignatureMime }
    case 'FILE':
      return { maxBytes: ATTACHMENT_LIMITS.maxFileBytes, mimes: ATTACHMENT_LIMITS.allowedFileMime }
  }
}

/**
 * Reserva la metadata del adjunto y devuelve una URL firmada de subida.
 *
 * Todo ocurre dentro de UNA transacción que bloquea la fila del envío
 * (`SELECT ... FOR UPDATE`) y RELEE su estado. Antes esto era una lectura suelta
 * seguida de un `create`, y en ese hueco cabía un `enviarSubmission`: se leía
 * `DRAFT`, el envío pasaba a `SUBMITTED` y después se insertaba el adjunto, que
 * quedaba colgando de un documento ya entregado.
 *
 * Es idempotente por `client_attachment_id`, pero solo cuando los metadatos
 * COINCIDEN. Un reintento con otro tamaño, otro tipo u otro hash no es un
 * reintento: es otro archivo con el mismo id, y firmar una URL para los
 * parámetros nuevos sobre una fila que conserva los viejos dejaría la fila y el
 * objeto describiendo cosas distintas. Ese caso se rechaza con
 * `ATTACHMENT_CONFLICT`.
 */
export async function iniciarAdjunto(actor: PortalActor, input: InitAttachmentInput) {
  const { maxBytes, mimes } = limitesPorTipo(input.kind)
  if (input.byteSize > maxBytes) {
    throw new FormError('ATTACHMENT_TOO_LARGE', `El archivo supera el límite de ${Math.round(maxBytes / 1024 / 1024)} MB.`, {
      maxBytes,
      byteSize: input.byteSize,
    })
  }
  if (!mimes.includes(input.mimeType)) {
    throw new FormError('ATTACHMENT_TYPE_NOT_ALLOWED', `Tipo no permitido para ${input.kind}: ${input.mimeType}.`, {
      allowed: mimes,
    })
  }

  /// El checksum en base64 se DERIVA del hexadecimal, que es lo que se persiste.
  /// Una sola fuente de verdad: si el cliente enviara los dos y discreparan, no
  /// habría forma de saber cuál es el bueno.
  const checksumBase64 = sha256HexToBase64(input.sha256)

  const plan = await prisma.$transaction(async (tx) => {
    /// Paso 3 del orden global de locks (ver `formularios-portal.locks.ts`).
    /// Esta operación solo necesita este recurso.
    const submission = await lockSubmissionPorClientId(tx, input.clientSubmissionId)
    if (!submission) {
      throw new FormError('SUBMISSION_NOT_FOUND', 'Guarda el borrador antes de subir evidencia.', {
        clientSubmissionId: input.clientSubmissionId,
      })
    }
    if (submission.conductor_id !== actor.id) throw new FormError('FORBIDDEN', 'Ese envío no es tuyo.')
    /// Estado RELEÍDO bajo lock: es la comprobación que cierra la carrera.
    if (submission.status !== 'DRAFT') {
      throw new FormError('SUBMISSION_IMMUTABLE', 'No se añaden adjuntos a un envío ya entregado.', {
        status: submission.status,
      })
    }

    const campo = await tx.form_field.findFirst({
      where: { id: input.fieldId, version_id: submission.version_id },
      select: { id: true, type: true },
    })
    if (!campo) throw new FormError('FIELD_VALUE_INVALID', 'El campo no pertenece a la versión de este envío.')
    if (!capabilitiesOf(campo.type as any).attachment) {
      throw new FormError('FIELD_VALUE_INVALID', `Un campo ${campo.type} no admite adjuntos.`)
    }

    const existente = await tx.form_attachment.findUnique({
      where: { client_attachment_id: input.clientAttachmentId },
      select: {
        id: true,
        submission_id: true,
        status: true,
        object_key: true,
        mime_type: true,
        byte_size: true,
        sha256: true,
        kind: true,
        metadata_json: true,
      },
    })

    if (existente) {
      if (existente.submission_id !== submission.id) {
        throw new FormError('FORBIDDEN', 'Ese adjunto pertenece a otro envío.')
      }
      if (existente.status === 'UPLOADED') {
        /// Ya verificado contra S3. La outbox puede seguir con el SUBMIT.
        return {
          attachmentId: existente.id,
          objectKey: existente.object_key,
          alreadyUploaded: true as const,
          checksumBase64: sha256HexToBase64(existente.sha256),
          mimeType: existente.mime_type,
          byteSize: Number(existente.byte_size),
        }
      }

      /// Reintento sobre una fila `PENDING`/`FAILED`: los metadatos tienen que
      /// ser los MISMOS. Se comparan todos los que describen el objeto y su
      /// destino, porque cualquiera que cambie hace que la fila y el objeto
      /// dejen de describir lo mismo.
      const metaPrevia = (existente.metadata_json ?? {}) as Record<string, unknown>
      const diferencias: Record<string, { previo: unknown; nuevo: unknown }> = {}
      const comparar = (clave: string, previo: unknown, nuevo: unknown) => {
        if (previo !== nuevo) diferencias[clave] = { previo, nuevo }
      }
      comparar('kind', existente.kind, input.kind)
      comparar('mimeType', existente.mime_type, input.mimeType)
      comparar('byteSize', Number(existente.byte_size), input.byteSize)
      comparar('sha256', existente.sha256, input.sha256)
      comparar('fieldId', metaPrevia.fieldId ?? null, input.fieldId)
      comparar('occurrenceId', metaPrevia.occurrenceId ?? null, input.occurrenceId ?? null)

      if (Object.keys(diferencias).length > 0) {
        throw new FormError(
          'ATTACHMENT_CONFLICT',
          'Ya existe un adjunto con ese identificador y metadatos distintos. Descártalo o usa un identificador nuevo.',
          { clientAttachmentId: input.clientAttachmentId, diferencias },
        )
      }

      return {
        attachmentId: existente.id,
        objectKey: existente.object_key!,
        alreadyUploaded: false as const,
        checksumBase64,
        mimeType: input.mimeType,
        byteSize: input.byteSize,
      }
    }

    /// La clave incluye el `client_attachment_id`, que es único: dos intentos de
    /// la misma foto escriben el mismo objeto y no dejan basura huérfana en S3.
    const extension = input.mimeType.split('/')[1]?.replace(/[^a-z0-9]/gi, '') || 'bin'
    const objectKey = `${PREFIJO_S3}/${submission.version_id}/${submission.id}/${input.clientAttachmentId}.${extension}`

    const attachmentId = randomUUID()
    await tx.form_attachment.create({
      data: {
        id: attachmentId,
        submission_id: submission.id,
        client_attachment_id: input.clientAttachmentId,
        kind: input.kind,
        status: 'PENDING',
        object_key: objectKey,
        original_name: input.originalName ?? null,
        mime_type: input.mimeType,
        byte_size: BigInt(input.byteSize),
        sha256: input.sha256,
        metadata_json: {
          fieldId: input.fieldId,
          occurrenceId: input.occurrenceId ?? null,
        } as Prisma.InputJsonValue,
      },
    })

    return {
      attachmentId,
      objectKey,
      alreadyUploaded: false as const,
      checksumBase64,
      mimeType: input.mimeType,
      byteSize: input.byteSize,
    }
  }, TX_OPCIONES)

  if (plan.alreadyUploaded) {
    return {
      attachmentId: plan.attachmentId,
      uploadUrl: null,
      alreadyUploaded: true,
      objectKey: plan.objectKey,
      checksumSha256: plan.checksumBase64,
    }
  }

  /// La URL se firma FUERA de la transacción: presignar es cómputo local, pero
  /// mantenerlo dentro alargaría sin necesidad el tiempo que la fila del envío
  /// está bloqueada.
  ///
  /// El checksum va en la firma cuando está habilitado: a partir de ahí S3
  /// RECHAZA la subida si los bytes recibidos no producen ese digest, y es lo que
  /// convierte la verificación posterior en una comprobación real y no en
  /// «el cliente dijo lo mismo dos veces».
  const uploadUrl = await getS3UploadUrl(
    plan.objectKey!,
    plan.mimeType,
    plan.byteSize,
    env.FORMS_S3_NATIVE_CHECKSUM ? plan.checksumBase64 : null,
  )

  return {
    attachmentId: plan.attachmentId,
    uploadUrl,
    alreadyUploaded: false,
    objectKey: plan.objectKey,
    /// El cliente debe enviar EXACTAMENTE este valor en `x-amz-checksum-sha256`.
    /// Se devuelve derivado por el backend para que el navegador no tenga que
    /// convertir hex a base64 y arriesgarse a mandar el base64 del texto.
    checksumSha256: env.FORMS_S3_NATIVE_CHECKSUM ? plan.checksumBase64 : null,
  }
}

/**
 * Verifica contra S3 que el objeto almacenado es el esperado y marca `UPLOADED`.
 *
 * ANTES esta función comparaba el hash que el cliente declaró en `complete`
 * contra el que el mismo cliente declaró en `init`. Eso es cliente contra
 * cliente: un objeto distinto del mismo tamaño se aceptaba si el cliente repetía
 * el hash original. Ahora la comparación es contra el checksum que confirma S3
 * sobre los BYTES ALMACENADOS.
 *
 * Dos caminos, en este orden:
 *
 *  1. **Checksum nativo** (`FORMS_S3_NATIVE_CHECKSUM`, el default). El PUT se
 *     firmó con `ChecksumSHA256`, así que S3 ya rechazó cualquier subida cuyos
 *     bytes no cuadraran; `HeadObject` con `ChecksumMode: 'ENABLED'` lo devuelve
 *     y aquí se compara.
 *  2. **Lectura en streaming.** Si el proveedor no expone checksum nativo, se
 *     descarga el objeto y se hashea de forma incremental. Cuesta red, pero es
 *     una verificación real.
 *
 * Todo bajo el lock de la fila del envío y con el estado releído: `complete` ya
 * NO puede marcar un adjunto ni escribir un evento sobre un envío entregado.
 */
export async function completarAdjunto(
  actor: PortalActor,
  attachmentId: string,
  input: CompleteAttachmentInput,
) {
  /**
   * El rechazo se DEVUELVE, no se lanza, cuando hay que dejar rastro.
   *
   * Marcar el adjunto `FAILED` y acto seguido lanzar desde dentro de la
   * transacción no sirve de nada: el `throw` provoca ROLLBACK y la marca se
   * deshace con él, así que la fila se quedaba `PENDING` y el fallo no quedaba
   * registrado en ninguna parte. Devolviendo el error como valor, la transacción
   * COMMITEA la marca y el error se lanza después, ya fuera.
   *
   * Los rechazos que NO escriben nada —adjunto inexistente, envío ajeno, envío ya
   * entregado, hash incoherente entre `init` y `complete`— sí se lanzan dentro:
   * ahí el rollback es lo correcto porque no hay nada que conservar.
   */
  const salida = await prisma.$transaction(async (tx) => {
    const attachment = await tx.form_attachment.findUnique({
      where: { id: attachmentId },
      select: {
        id: true,
        submission_id: true,
        client_attachment_id: true,
        status: true,
        object_key: true,
        mime_type: true,
        byte_size: true,
        sha256: true,
        kind: true,
      },
    })
    if (!attachment) throw new FormError('ATTACHMENT_NOT_FOUND', 'El adjunto no existe.')

    /// Paso 3 del orden global: se bloquea la fila del ENVÍO, no la del adjunto.
    /// Es el envío el que decide si se puede escribir, y es con `enviarSubmission`
    /// con quien hay que serializar.
    const submission = await lockSubmissionPorId(tx, attachment.submission_id)
    if (!submission) throw new FormError('SUBMISSION_NOT_FOUND', 'El envío del adjunto no existe.')
    if (submission.conductor_id !== actor.id) throw new FormError('FORBIDDEN', 'Ese adjunto no es tuyo.')

    const identidad = {
      attachmentId,
      submissionId: submission.id,
      clientAttachmentId: attachment.client_attachment_id,
    }

    /// Un adjunto ya verificado se responde igual sin volver a tocar nada: es el
    /// reintento normal de la outbox cuando pierde la respuesta.
    if (attachment.status === 'UPLOADED') {
      return { ...identidad, status: 'UPLOADED', alreadyUploaded: true, verifiedBy: 'previous' as const }
    }

    /// Estado RELEÍDO bajo lock. Esta comprobación NO existía: `complete` podía
    /// marcar `UPLOADED` y escribir un evento sobre un envío ya `SUBMITTED`.
    if (submission.status !== 'DRAFT') {
      throw new FormError(
        'SUBMISSION_IMMUTABLE',
        'El envío ya fue entregado: no se puede completar evidencia sobre él.',
        { status: submission.status },
      )
    }

    /// El hash declarado en `complete` tiene que seguir siendo el de `init`. Ya no
    /// es LA verificación —eso lo hace S3 más abajo— pero sigue detectando un
    /// cliente que cambió de archivo entre las dos llamadas, y ahorra el viaje a
    /// S3 en ese caso.
    if (attachment.sha256 !== input.sha256) {
      throw new FormError('ATTACHMENT_HASH_MISMATCH', 'El hash no coincide con el declarado al iniciar la subida.', {
        expected: attachment.sha256,
        received: input.sha256,
      })
    }

    const esperadoBytes = Number(attachment.byte_size)

    /// Marca el adjunto y devuelve el error para que lo lance quien llama, ya con
    /// la transacción commiteada.
    const fallar = async (
      code: 'ATTACHMENT_MISSING' | 'ATTACHMENT_HASH_MISMATCH',
      mensaje: string,
      detalles?: unknown,
    ) => {
      await tx.form_attachment.update({ where: { id: attachmentId }, data: { status: 'FAILED' } })
      return { fallo: new FormError(code, mensaje, detalles) }
    }

    const metadata = attachment.object_key ? await headS3Object(attachment.object_key) : null
    if (!metadata) {
      return fallar('ATTACHMENT_MISSING', 'El archivo no llegó a almacenarse. Vuelve a subirlo.')
    }

    if (metadata.contentLength !== esperadoBytes) {
      return fallar('ATTACHMENT_MISSING', 'El archivo almacenado está incompleto. Vuelve a subirlo.', {
        expectedBytes: esperadoBytes,
        storedBytes: metadata.contentLength,
      })
    }

    // ── Verificación de integridad contra los bytes ALMACENADOS ──────────────
    const esperadoBase64 = sha256HexToBase64(attachment.sha256)
    let verifiedBy: 'native-checksum' | 'streaming-hash'

    if (metadata.checksumSha256) {
      if (metadata.checksumSha256 !== esperadoBase64) {
        return fallar(
          'ATTACHMENT_HASH_MISMATCH',
          'El archivo almacenado no coincide con el que se declaró. Vuelve a subirlo.',
          { expectedChecksum: esperadoBase64, storedChecksum: metadata.checksumSha256 },
        )
      }
      verifiedBy = 'native-checksum'
    } else {
      /// El proveedor no devolvió checksum. Si el nativo está habilitado esto es
      /// una señal de configuración —bucket antiguo, proveedor incompatible— y se
      /// registra, pero NO se acepta el adjunto sin verificar: se cae al plan B.
      if (env.FORMS_S3_NATIVE_CHECKSUM) {
        logger.warn(
          {
            type: 'forms-s3-sin-checksum-nativo',
            attachment_id: attachmentId,
            object_key: attachment.object_key,
          },
          '[formularios] S3 no devolvió ChecksumSHA256; se verifica leyendo el objeto',
        )
      }

      let calculado: { sha256Hex: string; byteLength: number } | null
      try {
        /// El tope es el tamaño declarado + un margen: si el objeto creció, la
        /// lectura se corta en vez de convertirse en una descarga sin fin.
        calculado = await computeS3ObjectSha256(attachment.object_key!, esperadoBytes + 1024)
      } catch (err) {
        return fallar('ATTACHMENT_MISSING', 'El archivo almacenado no se pudo verificar. Vuelve a subirlo.', {
          motivo: err instanceof Error ? err.message : String(err),
        })
      }

      if (!calculado) {
        return fallar('ATTACHMENT_MISSING', 'El archivo no llegó a almacenarse. Vuelve a subirlo.')
      }
      if (calculado.sha256Hex !== attachment.sha256) {
        return fallar(
          'ATTACHMENT_HASH_MISMATCH',
          'El archivo almacenado no coincide con el que se declaró. Vuelve a subirlo.',
          { expectedSha256: attachment.sha256, storedSha256: calculado.sha256Hex },
        )
      }
      verifiedBy = 'streaming-hash'
    }

    await tx.form_attachment.update({
      where: { id: attachmentId },
      data: { status: 'UPLOADED', uploaded_at: new Date() },
    })
    await tx.form_submission_event.create({
      data: {
        id: randomUUID(),
        submission_id: submission.id,
        event_type: 'ATTACHMENT_ATTACHED',
        actor_type: 'CONDUCTOR',
        actor_id: actor.id,
        payload_json: {
          attachmentId,
          kind: attachment.kind,
          byteSize: esperadoBytes,
          /// Se registra CÓMO se verificó: si un día aparecen adjuntos verificados
          /// por streaming en un entorno que debería usar checksum nativo, es un
          /// problema de configuración que conviene poder ver en la auditoría.
          verifiedBy,
        } as Prisma.InputJsonValue,
      },
    })

    return { ...identidad, status: 'UPLOADED', alreadyUploaded: false, verifiedBy }
  }, TX_OPCIONES)

  /// Ya fuera de la transacción: la marca `FAILED` está commiteada y ahora sí se
  /// puede lanzar sin deshacerla.
  if ('fallo' in salida) throw salida.fallo
  return salida
}

/**
 * Descarta un adjunto del borrador.
 *
 * Existe porque sin él la evidencia queda ambigua: el runner permite quitar una
 * foto, pero si el servidor ya tenía la fila, el envío llegaría con un adjunto
 * `UPLOADED` que el payload no declara. Antes eso se ignoraba en silencio; ahora
 * el submit lo rechaza (`ATTACHMENT_NOT_DECLARED`) y este endpoint es la forma
 * limpia de resolverlo.
 *
 * Borra la FILA, no el objeto de S3. Limpiar S3 aquí sería una operación
 * destructiva improvisada dentro de una transacción que puede hacer rollback; los
 * objetos huérfanos se retiran con una política de ciclo de vida sobre el prefijo
 * del módulo, documentada como tarea aparte.
 */
export async function descartarAdjunto(actor: PortalActor, attachmentId: string) {
  return prisma.$transaction(async (tx) => {
    const attachment = await tx.form_attachment.findUnique({
      where: { id: attachmentId },
      select: { id: true, submission_id: true, client_attachment_id: true, object_key: true },
    })
    if (!attachment) {
      /// Idempotente: descartar algo que ya no está no es un error, es el
      /// reintento de una operación que ya funcionó.
      return { attachmentId, discarded: false, alreadyGone: true }
    }

    const submission = await lockSubmissionPorId(tx, attachment.submission_id)
    if (!submission) throw new FormError('SUBMISSION_NOT_FOUND', 'El envío del adjunto no existe.')
    if (submission.conductor_id !== actor.id) throw new FormError('FORBIDDEN', 'Ese adjunto no es tuyo.')
    if (submission.status !== 'DRAFT') {
      throw new FormError(
        'SUBMISSION_IMMUTABLE',
        'El envío ya fue entregado: su evidencia no se puede descartar.',
        { status: submission.status },
      )
    }

    await tx.form_attachment.delete({ where: { id: attachmentId } })

    logger.info(
      {
        type: 'forms-attachment-discarded',
        attachment_id: attachmentId,
        submission_id: submission.id,
        /// La clave del objeto queda en el log para que la limpieza de S3 pueda
        /// auditarse después.
        object_key: attachment.object_key,
      },
      '[formularios] adjunto descartado del borrador',
    )

    return { attachmentId, discarded: true, alreadyGone: false }
  }, TX_OPCIONES)
}

// ─────────────────────────────────────────────────────────────────────────────
// Envío final
// ─────────────────────────────────────────────────────────────────────────────

/** Huella estable del payload, para detectar reintentos con contenido distinto. */
function huella(input: SubmissionInput): string {
  return createHash('sha256').update(JSON.stringify(submissionFingerprintPayload(input))).digest('hex')
}

export interface ResultadoEnvio {
  submissionId: string
  clientSubmissionId: string
  businessDate: string
  periodKey: string | null
  submittedAt: string
  idempotentReplay: boolean
  conductorId: string
  assignmentId: string
}

/**
 * Finaliza un envío. Es la operación crítica del módulo.
 *
 * Secuencia, y el orden importa:
 *
 *  1. resolver acceso y vigencia con la identidad del token;
 *  2. cortocircuitar por idempotencia si el `client_submission_id` ya está
 *     entregado;
 *  3. validar respuestas contra la definición versionada;
 *  4. comprobar que los adjuntos declarados existen y están `UPLOADED`;
 *  5. dentro de una transacción con bloqueo: reconfirmar idempotencia y
 *     límites, escribir respuestas, enlazar adjuntos y marcar `SUBMITTED`.
 *
 * El paso 5 repite las comprobaciones del 2 y del 4 a propósito: entre la
 * lectura y la escritura pueden entrar dos POST simultáneos del mismo teléfono
 * —dos pestañas, dos reintentos de la outbox— y solo el bloqueo decide cuál
 * gana.
 */
export async function enviarSubmission(actor: PortalActor, input: SubmissionInput): Promise<ResultadoEnvio> {
  const where = await condicionAcceso(actor.id)
  const assignment = await prisma.form_assignment.findFirst({
    where: { AND: [where, { id: input.assignmentId }] },
    select: {
      id: true,
      version_id: true,
      frequency: true,
      limit_policy: true,
      timezone: true,
      starts_at: true,
      ends_at: true,
      context_schema_json: true,
    },
  })
  if (!assignment) throw new FormError('ASSIGNMENT_TARGET_DENIED', 'Este formulario no está asignado a ti.')
  if (!dentroDeVigencia(assignment, new Date())) {
    throw new FormError('ASSIGNMENT_NOT_AVAILABLE', 'La asignación no está vigente.')
  }
  if (assignment.version_id !== input.versionId) {
    throw new FormError('VERSION_NOT_PUBLISHED', 'Esta asignación ya usa otra versión del formulario.', {
      currentVersionId: assignment.version_id,
    })
  }

  const fingerprint = huella(input)

  // 2. Idempotencia optimista (sin bloquear nada todavía).
  const previo = await prisma.form_submission.findUnique({
    where: { client_submission_id: input.clientSubmissionId },
    select: {
      id: true,
      conductor_id: true,
      status: true,
      business_date: true,
      period_key: true,
      submitted_at: true,
      assignment_id: true,
      device_json: true,
    },
  })
  if (previo) {
    if (previo.conductor_id !== actor.id) throw new FormError('FORBIDDEN', 'Ese envío no es tuyo.')
    if (previo.status === 'SUBMITTED' || previo.status === 'VOIDED') {
      return confirmarReplay(previo, fingerprint)
    }
  }

  // 3. Validación contra la definición versionada.
  const version = await findVersionAggregate(prisma, assignment.version_id)
  if (!version) throw new FormError('VERSION_NOT_FOUND', 'La versión no existe.')

  const contexto = (input.context ?? {}) as Record<string, unknown>
  verificarContexto(assignment.context_schema_json as any, contexto)

  const validacion = validateSubmissionAnswers({
    definition: toVersionDto(version),
    answers: input.answers,
    attachments: input.attachments ?? [],
  })
  if (validacion.errors.length) {
    throw new FormError('FIELD_VALUE_INVALID', 'Hay respuestas que no cumplen el formulario.', {
      errors: validacion.errors,
    })
  }

  // 4. Adjuntos declarados: tienen que existir y estar verificados.
  const adjuntos = await resolverAdjuntos(actor.id, input)

  const now = new Date()
  const businessDate = businessDateFor(now, assignment.timezone || BUSINESS_TIMEZONE)
  const periodKey = periodKeyFor(assignment.frequency as any, businessDate)

  // 5. Escritura.
  const resultado = await prisma.$transaction(async (tx) => {
    // ── Paso 1 del orden global: lock de IDEMPOTENCIA ──────────────────────
    //
    // Serializa los reintentos del MISMO `client_submission_id`. Se toma antes
    // que cualquier otro y por `client_submission_id` y no por `id`, porque en el
    // primer envío la fila todavía no existe y no hay nada que bloquear.
    await lockIdempotencia(tx, input.clientSubmissionId)

    const actualizado = await tx.form_submission.findUnique({
      where: { client_submission_id: input.clientSubmissionId },
      select: {
        id: true,
        conductor_id: true,
        status: true,
        business_date: true,
        period_key: true,
        submitted_at: true,
        assignment_id: true,
        device_json: true,
      },
    })
    if (actualizado && (actualizado.status === 'SUBMITTED' || actualizado.status === 'VOIDED')) {
      return confirmarReplay(actualizado, fingerprint)
    }

    // ── Paso 2 del orden global: lock de LÍMITE LÓGICO ─────────────────────
    //
    // ESTE es el fix de la carrera que el lock de idempotencia NO cubría. Dos
    // envíos con `client_submission_id` DISTINTOS —dos pestañas, dos
    // dispositivos— compiten por el mismo límite de negocio: mismo assignment,
    // mismo conductor, mismo período y, en `ONE_PER_CONTEXT`, mismo vehículo.
    // Cada uno tomaba un lock de idempotencia diferente, los dos consultaban
    // antes de que el otro confirmara, y los dos creaban un `SUBMITTED`.
    //
    // La clave la construye `claveLimite()` para que describa EXACTAMENTE el
    // mismo conjunto que consulta `verificarLimite`. Devuelve `null` cuando no
    // hay límite que proteger (`UNLIMITED` que no sea `ONCE`), y en ese caso no
    // se bloquea nada: serializar ahí penalizaría a conductores independientes
    // sin ganar nada.
    const claveLimiteUsada = await lockLimite(tx, {
      assignmentId: assignment.id,
      conductorId: actor.id,
      limitPolicy: assignment.limit_policy,
      frequency: assignment.frequency,
      periodKey,
      contexto,
    })

    // ── Paso 3 del orden global: lock de la FILA del envío ─────────────────
    //
    // Solo si el borrador ya existe. Serializa con `iniciarAdjunto`,
    // `completarAdjunto` y `descartarAdjunto`, que bloquean esta misma fila: sin
    // él, un `complete` en vuelo podría marcar evidencia sobre el envío justo
    // después de que este lo pase a `SUBMITTED`.
    if (actualizado) {
      const bloqueada = await lockSubmissionPorId(tx, actualizado.id)
      /// Relectura tras el lock: entre la consulta de arriba y este punto otra
      /// transacción pudo entregarlo.
      if (bloqueada && bloqueada.status !== 'DRAFT') {
        const refrescado = await tx.form_submission.findUnique({
          where: { id: actualizado.id },
          select: {
            id: true,
            conductor_id: true,
            status: true,
            business_date: true,
            period_key: true,
            submitted_at: true,
            assignment_id: true,
            device_json: true,
          },
        })
        if (refrescado) return confirmarReplay(refrescado, fingerprint)
      }
    }

    await verificarLimite(tx, {
      assignmentId: assignment.id,
      limitPolicy: assignment.limit_policy,
      frequency: assignment.frequency,
      conductorId: actor.id,
      periodKey,
      contexto,
      excluirSubmissionId: actualizado?.id ?? null,
    })

    // ── Política de adjuntos no declarados ─────────────────────────────────
    //
    // Se comprueba DENTRO de la transacción y con la fila bloqueada, para que el
    // conjunto que se valida sea el mismo que quedará congelado.
    await verificarConjuntoAdjuntos(tx, {
      submissionId: actualizado?.id ?? null,
      declarados: (input.attachments ?? []).map((a) => a.clientAttachmentId),
    })

    const submissionId = actualizado?.id ?? randomUUID()
    const datosComunes = {
      vehicle_id: typeof contexto.vehicleId === 'string' ? contexto.vehicleId : null,
      service_id: typeof contexto.serviceId === 'string' ? contexto.serviceId : null,
      status: 'SUBMITTED' as const,
      business_date: new Date(`${businessDate}T00:00:00.000Z`),
      period_key: periodKey,
      context_json: contexto as Prisma.InputJsonValue,
      device_json: {
        ...(input.device ?? {}),
        /// La huella se guarda en `device_json` y no en columna propia para no
        /// añadir una migración por una comprobación de idempotencia. Es un
        /// dato del cliente, que es exactamente lo que esa columna contiene.
        fingerprint,
      } as Prisma.InputJsonValue,
      submitted_at: now,
    }

    if (actualizado) {
      await tx.form_submission.update({ where: { id: submissionId }, data: datosComunes })
      await tx.form_answer.deleteMany({ where: { submission_id: submissionId } })
    } else {
      await tx.form_submission.create({
        data: {
          id: submissionId,
          client_submission_id: input.clientSubmissionId,
          assignment_id: assignment.id,
          version_id: assignment.version_id,
          conductor_id: actor.id,
          started_at: input.startedAt ? new Date(input.startedAt) : now,
          ...datosComunes,
        },
      })
    }

    await escribirRespuestas(tx, submissionId, validacion.prepared)
    await enlazarAdjuntos(tx, submissionId, adjuntos, validacion.prepared)

    await tx.form_submission_event.create({
      data: {
        id: randomUUID(),
        submission_id: submissionId,
        event_type: 'SUBMITTED',
        actor_type: 'CONDUCTOR',
        actor_id: actor.id,
        payload_json: {
          answers: validacion.prepared.length,
          attachments: adjuntos.length,
          offlineCreated: input.device?.offlineCreated ?? false,
          appVersion: input.device?.appVersion ?? null,
          /// Queda en la auditoría qué clave lógica serializó este envío. Si
          /// alguna vez aparecen dos `SUBMITTED` que deberían excluirse, esto dice
          /// si tomaron el mismo lock o no.
          limitLockKey: claveLimiteUsada,
        } as Prisma.InputJsonValue,
      },
    })

    return {
      submissionId,
      clientSubmissionId: input.clientSubmissionId,
      businessDate,
      periodKey,
      submittedAt: now.toISOString(),
      idempotentReplay: false,
      conductorId: actor.id,
      assignmentId: assignment.id,
    }
  }, TX_OPCIONES)

  return resultado
}

/**
 * Resuelve un reintento sobre un envío ya entregado.
 *
 * Si la huella coincide es el mismo envío y se devuelve tal cual. Si no
 * coincide, el cliente está intentando entregar OTRO contenido bajo el mismo id
 * de idempotencia: devolver el primero le haría creer que se guardó lo segundo,
 * así que se rechaza.
 */
function confirmarReplay(
  previo: {
    id: string
    status: string
    business_date: Date
    period_key: string | null
    submitted_at: Date | null
    assignment_id: string
    conductor_id: string
    device_json: unknown
  },
  fingerprint: string,
): ResultadoEnvio {
  const guardada = (previo.device_json as any)?.fingerprint
  if (guardada && guardada !== fingerprint) {
    throw new FormError(
      'IDEMPOTENCY_PAYLOAD_MISMATCH',
      'Ya existe un envío con ese identificador y un contenido distinto. Genera un envío nuevo.',
      { submissionId: previo.id },
    )
  }
  return {
    submissionId: previo.id,
    clientSubmissionId: '',
    businessDate: previo.business_date.toISOString().slice(0, 10),
    periodKey: previo.period_key,
    submittedAt: previo.submitted_at?.toISOString() ?? '',
    idempotentReplay: true,
    conductorId: previo.conductor_id,
    assignmentId: previo.assignment_id,
  }
}


function verificarContexto(schema: Record<string, { required?: boolean }> | null, contexto: Record<string, unknown>) {
  const faltan = Object.entries(schema ?? {})
    .filter(([clave, def]) => def?.required && (contexto[clave] === undefined || contexto[clave] === null || contexto[clave] === ''))
    .map(([clave]) => clave)
  if (faltan.length) {
    throw new FormError('ASSIGNMENT_CONTEXT_REQUIRED', `Falta el contexto obligatorio: ${faltan.join(', ')}.`, {
      missing: faltan,
    })
  }
}

/**
 * Aplica la política de límite.
 *
 * `ONE_PER_PERIOD` cuenta por asignación + conductor + período.
 * `ONE_PER_CONTEXT` añade el contexto (para un preoperacional, el vehículo):
 * un conductor que maneja dos vehículos el mismo día debe poder entregar dos
 * preoperacionales, uno por vehículo, y una sola clave de período lo impediría.
 *
 * Los `VOIDED` NO cuentan: anular existe precisamente para permitir rehacer.
 */
async function verificarLimite(
  tx: Prisma.TransactionClient,
  params: {
    assignmentId: string
    limitPolicy: string
    frequency: string
    conductorId: string
    periodKey: string | null
    contexto: Record<string, unknown>
    excluirSubmissionId: string | null
  },
): Promise<void> {
  if (params.limitPolicy === 'UNLIMITED' && params.frequency !== 'ONCE') return

  const base: Prisma.form_submissionWhereInput = {
    assignment_id: params.assignmentId,
    conductor_id: params.conductorId,
    status: 'SUBMITTED',
    ...(params.excluirSubmissionId ? { id: { not: params.excluirSubmissionId } } : {}),
  }

  if (params.limitPolicy === 'ONE_PER_CONTEXT') {
    const vehicleId = typeof params.contexto.vehicleId === 'string' ? params.contexto.vehicleId : null
    const existe = await tx.form_submission.findFirst({
      where: {
        ...base,
        ...(params.periodKey ? { period_key: params.periodKey } : {}),
        vehicle_id: vehicleId,
      },
      select: { id: true },
    })
    if (existe) {
      throw new FormError(
        'SUBMISSION_LIMIT_REACHED',
        'Ya entregaste este formulario para ese vehículo en este período.',
        { existingSubmissionId: existe.id, periodKey: params.periodKey, vehicleId },
      )
    }
    return
  }

  /// `ONCE` con `UNLIMITED` sigue siendo "una sola vez": la frecuencia también
  /// limita, no solo la política.
  const existe = await tx.form_submission.findFirst({
    where: { ...base, ...(params.periodKey ? { period_key: params.periodKey } : {}) },
    select: { id: true },
  })
  if (existe) {
    throw new FormError('SUBMISSION_LIMIT_REACHED', 'Ya entregaste este formulario en este período.', {
      existingSubmissionId: existe.id,
      periodKey: params.periodKey,
    })
  }
}

/**
 * El conjunto de adjuntos del borrador tiene que coincidir con el declarado.
 *
 * Antes, un adjunto que el servidor conocía pero el payload no declaraba se
 * ignoraba en silencio: quedaba una fila `UPLOADED` colgando de un envío
 * entregado, y quien revisara el envío no podía saber si esa foto formaba parte de
 * la evidencia o era basura. Evidencia ambigua en un documento con valor legal.
 *
 * La política, explícita:
 *
 *  - **Adjunto `PENDING`/`FAILED` en el borrador** → se rechaza con
 *    `ATTACHMENT_MISSING` (422, recuperable). La outbox aún tiene su cadena
 *    `INIT → UPLOAD → COMPLETE` pendiente: cuando termine, el reintento del
 *    submit pasará. Es el caso normal de una outbox que se adelantó.
 *  - **Adjunto `UPLOADED` que el payload no declara** → se rechaza con
 *    `ATTACHMENT_NOT_DECLARED` (422). El cliente tiene que decidir: declararlo o
 *    descartarlo con `DELETE /attachments/:id`. No se decide por él.
 *
 * Los dos son 4xx corregibles y NO reintentables a ciegas: la outbox los marca
 * `BLOCKED` y el conductor ve qué falta.
 */
async function verificarConjuntoAdjuntos(
  tx: Prisma.TransactionClient,
  params: { submissionId: string | null; declarados: string[] },
): Promise<void> {
  /// Sin borrador previo no hay nada guardado en el servidor: el primer POST crea
  /// el envío y sus adjuntos no pueden existir todavía.
  if (!params.submissionId) return

  const existentes = await tx.form_attachment.findMany({
    where: { submission_id: params.submissionId },
    select: { id: true, client_attachment_id: true, status: true },
  })
  if (existentes.length === 0) return

  const declarados = new Set(params.declarados)

  const pendientes = existentes.filter((a) => a.status !== 'UPLOADED')
  if (pendientes.length > 0) {
    throw new FormError(
      'ATTACHMENT_MISSING',
      `Hay ${pendientes.length} adjunto(s) sin terminar de subir. Se enviará en cuanto la evidencia esté completa.`,
      {
        pendientes: pendientes.map((a) => ({
          clientAttachmentId: a.client_attachment_id,
          status: a.status,
        })),
      },
    )
  }

  const noDeclarados = existentes.filter((a) => !declarados.has(a.client_attachment_id))
  if (noDeclarados.length > 0) {
    throw new FormError(
      'ATTACHMENT_NOT_DECLARED',
      `El envío no declara ${noDeclarados.length} adjunto(s) que ya están guardados. Decláralos o descártalos antes de enviar.`,
      {
        noDeclarados: noDeclarados.map((a) => ({
          attachmentId: a.id,
          clientAttachmentId: a.client_attachment_id,
        })),
      },
    )
  }
}

/**
 * Comprueba los adjuntos declarados en el envío.
 *
 * Todos deben existir, ser de este conductor y estar `UPLOADED`. Un adjunto
 * `PENDING` significa que la outbox se adelantó al SUBMIT: se rechaza con
 * `ATTACHMENT_MISSING` para que reintente en orden en vez de guardar un envío
 * con evidencia que nunca se subió.
 */
async function resolverAdjuntos(conductorId: string, input: SubmissionInput) {
  const declarados = input.attachments ?? []
  if (!declarados.length) return []

  const filas = await prisma.form_attachment.findMany({
    where: { client_attachment_id: { in: declarados.map((a) => a.clientAttachmentId) } },
    include: { submission: { select: { conductor_id: true, client_submission_id: true } } },
  })
  const porClientId = new Map(filas.map((f) => [f.client_attachment_id, f]))

  for (const declarado of declarados) {
    const fila = porClientId.get(declarado.clientAttachmentId)
    if (!fila) {
      throw new FormError('ATTACHMENT_MISSING', 'Hay evidencia sin registrar. Súbela antes de enviar.', {
        clientAttachmentId: declarado.clientAttachmentId,
      })
    }
    if (fila.submission.conductor_id !== conductorId) {
      throw new FormError('FORBIDDEN', 'Uno de los adjuntos no es tuyo.')
    }
    if (fila.submission.client_submission_id !== input.clientSubmissionId) {
      throw new FormError('ATTACHMENT_MISSING', 'Un adjunto pertenece a otro envío.', {
        clientAttachmentId: declarado.clientAttachmentId,
      })
    }
    if (fila.status !== 'UPLOADED') {
      throw new FormError('ATTACHMENT_MISSING', 'Hay evidencia sin terminar de subir.', {
        clientAttachmentId: declarado.clientAttachmentId,
        status: fila.status,
      })
    }
    if (fila.sha256 !== declarado.sha256) {
      throw new FormError('ATTACHMENT_HASH_MISMATCH', 'El hash de un adjunto no coincide con el registrado.', {
        clientAttachmentId: declarado.clientAttachmentId,
      })
    }
  }

  return declarados.map((d) => ({ declarado: d, fila: porClientId.get(d.clientAttachmentId)! }))
}

/** Escribe las respuestas ya tipadas por el validador. */
async function escribirRespuestas(
  tx: Prisma.TransactionClient,
  submissionId: string,
  prepared: PreparedAnswer[],
): Promise<void> {
  if (prepared.length === 0) return

  /**
   * Dos sentencias en total: una para las respuestas y otra para sus opciones.
   *
   * Antes era un `create` por respuesta más un `createMany` por sus opciones, o
   * sea dos viajes de red por respuesta DENTRO de la transacción. Medido contra
   * una base remota, cada viaje ronda los 0,7 s: un preoperacional de 273
   * respuestas pasaba de tres minutos y reventaba el `timeout` de 20 s, así que el
   * envío de un formulario grande no podía completarse nunca.
   *
   * El id se asigna AQUÍ, antes de insertar, y eso es lo que hace viable el lote:
   * `createMany` no devuelve ids, pero no hacen falta si ya los conocemos.
   * `answer.answerId` se rellena igual, porque `enlazarAdjuntos` lo necesita para
   * colgar cada foto de su respuesta.
   */
  for (const answer of prepared) {
    answer.answerId = randomUUID()
  }

  await tx.form_answer.createMany({
    data: prepared.map((answer) => ({
      id: answer.answerId!,
      submission_id: submissionId,
      field_id: answer.fieldId,
      occurrence_id: answer.occurrenceId,
      row_index: answer.rowIndex,
      value_text: answer.valueText,
      value_decimal: answer.valueDecimal,
      value_boolean: answer.valueBoolean,
      value_date: answer.valueDate ? new Date(`${answer.valueDate}T00:00:00.000Z`) : null,
      value_datetime: answer.valueDatetime ? new Date(answer.valueDatetime) : null,
      value_json: answer.valueJson === null ? Prisma.DbNull : (answer.valueJson as Prisma.InputJsonValue),
    })),
  })

  /// Todas las opciones de todas las respuestas en una sola sentencia. Un
  /// preoperacional son cientos de filas aquí, y una por viaje era insostenible.
  const opciones = prepared.flatMap((answer) =>
    answer.optionIds.map((option_id) => ({ answer_id: answer.answerId!, option_id })),
  )
  if (opciones.length) {
    await tx.form_answer_option.createMany({ data: opciones })
  }
}

/**
 * Cuelga cada adjunto de su respuesta.
 *
 * `answer_id` se rellena aquí y no en `iniciarAdjunto` porque en ese momento la
 * respuesta todavía no existe: el conductor sube la foto mientras diligencia y
 * las respuestas se escriben al enviar.
 */
async function enlazarAdjuntos(
  tx: Prisma.TransactionClient,
  submissionId: string,
  adjuntos: { declarado: AttachmentInput; fila: { id: string } }[],
  prepared: PreparedAnswer[],
): Promise<void> {
  for (const { declarado, fila } of adjuntos) {
    const respuesta = prepared.find(
      (p) => p.fieldId === declarado.fieldId && (p.occurrenceId ?? null) === (declarado.occurrenceId ?? null),
    )
    await tx.form_attachment.update({
      where: { id: fila.id },
      data: { submission_id: submissionId, answer_id: respuesta?.answerId ?? null },
    })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Historial propio
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Historial del conductor autenticado.
 *
 * `conductor_id` se fija con el actor del token en el `where`, no con un
 * parámetro: así no hay ninguna ruta de código por la que un filtro del cliente
 * pueda ampliar el alcance a los envíos de otro.
 */
export async function listarEnviosPortal(actor: PortalActor, query: ListarEnviosPortalQuery) {
  const where: Prisma.form_submissionWhereInput = {
    conductor_id: actor.id,
    status: { in: ['SUBMITTED', 'VOIDED'] },
    ...(query.assignmentId ? { assignment_id: query.assignmentId } : {}),
  }

  const [total, rows] = await Promise.all([
    prisma.form_submission.count({ where }),
    prisma.form_submission.findMany({
      where,
      orderBy: [{ submitted_at: 'desc' }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      include: {
        assignment: { select: { id: true, name: true, frequency: true } },
        vehiculo: { select: { id: true, placa: true } },
        version: {
          select: { id: true, form_id: true, version_number: true, title: true, form: { select: { code: true } } },
        },
        _count: { select: { answers: true, attachments: true } },
      },
    }),
  ])

  return {
    data: rows.map(toSubmissionSummaryDto),
    meta: { total, page: query.page, limit: query.limit, totalPages: Math.ceil(total / query.limit) || 1 },
  }
}

export async function obtenerEnvioPortal(actor: PortalActor, submissionId: string) {
  const row = await prisma.form_submission.findFirst({
    where: { id: submissionId, conductor_id: actor.id },
    include: {
      assignment: { select: { id: true, name: true, frequency: true } },
      vehiculo: { select: { id: true, placa: true } },
      version: {
        select: { id: true, form_id: true, version_number: true, title: true, form: { select: { code: true } } },
      },
      answers: {
        orderBy: [{ row_index: 'asc' }, { created_at: 'asc' }],
        include: {
          field: { select: { key: true, type: true } },
          options: { include: { option: { select: { value: true, label: true } } } },
        },
      },
      attachments: { orderBy: { created_at: 'asc' } },
      events: { orderBy: { created_at: 'asc' } },
    },
  })
  if (!row) {
    /// 404 y no 403: para el conductor, un envío de otro simplemente no existe.
    /// Aquí sí conviene ocultar la diferencia, porque el actor no es personal
    /// interno que vaya a depurar targets.
    throw new FormError('SUBMISSION_NOT_FOUND', 'El envío no existe.')
  }

  const urls = new Map<string, string>()
  for (const attachment of row.attachments) {
    if (attachment.status !== 'UPLOADED' || !attachment.object_key) continue
    try {
      urls.set(attachment.id, await getS3SignedUrl(attachment.object_key))
    } catch (err) {
      logger.warn(
        { type: 'forms-portal-sign-failed', attachmentId: attachment.id, error: String(err) },
        '[formularios] no se pudo firmar el adjunto del recibo',
      )
    }
  }

  const version = await findVersionAggregate(prisma, row.version_id)
  return { submission: toSubmissionDetailDto(row, urls), definition: toVersionDto(version) }
}
