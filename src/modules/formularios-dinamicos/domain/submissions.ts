/**
 * Envíos: estados, respuestas y adjuntos.
 *
 * `SYNCING` y `FAILED` NO están aquí. Son estados de la outbox del dispositivo:
 * el servidor no puede distinguir "el conductor está sincronizando" de "el
 * conductor cerró la app", así que persistirlos produciría envíos colgados
 * para siempre.
 */

export const SUBMISSION_STATUSES = ['DRAFT', 'SUBMITTED', 'VOIDED'] as const
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number]

export const ATTACHMENT_KINDS = ['PHOTO', 'FILE', 'SIGNATURE'] as const
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number]

export const ATTACHMENT_STATUSES = ['PENDING', 'UPLOADED', 'FAILED'] as const
export type AttachmentStatus = (typeof ATTACHMENT_STATUSES)[number]

export const ACTOR_TYPES = ['CONDUCTOR', 'USER', 'SYSTEM'] as const
export type ActorType = (typeof ACTOR_TYPES)[number]

/** Tipos de evento de la bitácora `form_submission_events`. */
export const SUBMISSION_EVENT_TYPES = [
  'CREATED',
  'DRAFT_BACKED_UP',
  'SUBMITTED',
  'IDEMPOTENT_REPLAY',
  'ATTACHMENT_ATTACHED',
  'VOIDED',
  'VALIDATION_REJECTED',
] as const
export type SubmissionEventType = (typeof SUBMISSION_EVENT_TYPES)[number]

export interface AnswerInput {
  /** Campo de la MISMA versión del envío. Se verifica en servidor. */
  fieldId: string
  /** Fila de un repetible. Comparte `occurrenceId` con el resto de su fila. */
  occurrenceId?: string | null
  rowIndex?: number | null
  /**
   * Valor sin tipar a propósito: el tipo real depende del `type` del campo, que
   * el servidor lee de la definición. Aceptar un union aquí solo movería la
   * comprobación de sitio, no la evitaría.
   */
  value?: unknown
  /** `value` de las opciones marcadas, para SINGLE_CHOICE/MULTIPLE_CHOICE. */
  optionValues?: string[]
}

export interface AttachmentInput {
  clientAttachmentId: string
  fieldId: string
  occurrenceId?: string | null
  kind: AttachmentKind
  mimeType: string
  byteSize: number
  sha256: string
  originalName?: string | null
  metadata?: Record<string, unknown>
}

export interface DeviceInfo {
  installationId?: string
  appVersion?: string
  offlineCreated?: boolean
  platform?: string
}

export interface SubmissionInput {
  /** UUID generado en el dispositivo ANTES de empezar. Hace idempotente el POST. */
  clientSubmissionId: string
  assignmentId: string
  versionId: string
  context?: Record<string, unknown>
  startedAt?: string
  completedAt?: string
  answers: AnswerInput[]
  attachments?: AttachmentInput[]
  device?: DeviceInfo
}

/**
 * Huella del payload de un envío, para detectar reintentos que NO son el mismo
 * envío.
 *
 * Sin esto, dos POST con el mismo `clientSubmissionId` y respuestas distintas
 * devolverían el primer envío como si fuera el segundo, y el conductor creería
 * haber enviado algo que nunca se guardó. Con esto, el segundo recibe
 * `IDEMPOTENCY_PAYLOAD_MISMATCH`.
 *
 * Se normaliza antes de serializar: el orden de `answers` y de `optionValues`
 * depende de cómo la outbox recorrió el formulario y no es parte del
 * significado del envío.
 */
export function submissionFingerprintPayload(input: SubmissionInput): unknown {
  const answers = input.answers
    .map((a) => ({
      fieldId: a.fieldId,
      occurrenceId: a.occurrenceId ?? null,
      value: a.value ?? null,
      optionValues: [...(a.optionValues ?? [])].sort(),
    }))
    .sort((x, y) =>
      x.fieldId === y.fieldId
        ? String(x.occurrenceId).localeCompare(String(y.occurrenceId))
        : x.fieldId.localeCompare(y.fieldId),
    )

  const attachments = [...(input.attachments ?? [])]
    .map((a) => ({ clientAttachmentId: a.clientAttachmentId, sha256: a.sha256 }))
    .sort((x, y) => x.clientAttachmentId.localeCompare(y.clientAttachmentId))

  return {
    assignmentId: input.assignmentId,
    versionId: input.versionId,
    context: input.context ?? {},
    answers,
    attachments,
  }
}
