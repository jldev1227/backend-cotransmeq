/**
 * Códigos de error del módulo y su traducción a HTTP.
 *
 * El código es lo que consume el cliente: la outbox del portal decide si
 * reintenta, bloquea o pide login mirando el `code`, nunca el texto del
 * mensaje. Por eso el mapa de status vive junto a la lista y no en cada
 * `catch` del controller.
 */

export const FORM_ERROR_CODES = [
  // No encontrado
  'FORM_NOT_FOUND',
  'VERSION_NOT_FOUND',
  'ASSIGNMENT_NOT_FOUND',
  'SUBMISSION_NOT_FOUND',
  'ATTACHMENT_NOT_FOUND',
  'TEMPLATE_NOT_FOUND',

  // Ciclo de vida de la definición
  'VERSION_IMMUTABLE',
  'VERSION_NOT_PUBLISHED',
  'VERSION_ARCHIVED',
  'REVISION_CONFLICT',
  'FORM_HAS_ACTIVE_ASSIGNMENTS',
  'FORM_CODE_TAKEN',

  // Validación de la definición
  'FORM_DEFINITION_INVALID',
  'FIELD_RULE_CYCLE',
  'FIELD_VALUE_INVALID',

  // Asignación y límites
  'ASSIGNMENT_NOT_AVAILABLE',
  'ASSIGNMENT_TARGET_DENIED',
  'ASSIGNMENT_CONTEXT_REQUIRED',
  'SUBMISSION_LIMIT_REACHED',

  // Envío
  'SUBMISSION_IMMUTABLE',
  'SUBMISSION_ALREADY_VOIDED',
  'IDEMPOTENCY_PAYLOAD_MISMATCH',

  // Adjuntos
  'ATTACHMENT_MISSING',
  'ATTACHMENT_HASH_MISMATCH',
  'ATTACHMENT_TOO_LARGE',
  'ATTACHMENT_TYPE_NOT_ALLOWED',
  'ATTACHMENT_CONFLICT',
  'ATTACHMENT_NOT_DECLARED',

  // Genéricos
  'PAYLOAD_TOO_LARGE',
  'FORBIDDEN',
] as const

export type FormErrorCode = (typeof FORM_ERROR_CODES)[number]

const STATUS_BY_CODE: Record<FormErrorCode, number> = {
  FORM_NOT_FOUND: 404,
  VERSION_NOT_FOUND: 404,
  ASSIGNMENT_NOT_FOUND: 404,
  SUBMISSION_NOT_FOUND: 404,
  ATTACHMENT_NOT_FOUND: 404,
  TEMPLATE_NOT_FOUND: 404,

  VERSION_IMMUTABLE: 409,
  VERSION_NOT_PUBLISHED: 409,
  VERSION_ARCHIVED: 409,
  REVISION_CONFLICT: 409,
  FORM_HAS_ACTIVE_ASSIGNMENTS: 409,
  FORM_CODE_TAKEN: 409,

  FORM_DEFINITION_INVALID: 422,
  FIELD_RULE_CYCLE: 422,
  FIELD_VALUE_INVALID: 422,

  /// 403 y no 404: el conductor autenticado existe, lo que no le corresponde
  /// es esta asignación. Ocultarla como 404 impediría distinguir un target mal
  /// configurado de un id inventado cuando toque depurar en producción.
  ASSIGNMENT_TARGET_DENIED: 403,
  ASSIGNMENT_NOT_AVAILABLE: 409,
  ASSIGNMENT_CONTEXT_REQUIRED: 422,
  /// 409 y no 422: el payload es válido; lo que falla es el estado del
  /// servidor. La outbox NO debe reintentar ni marcar el borrador como
  /// corregible.
  SUBMISSION_LIMIT_REACHED: 409,

  SUBMISSION_IMMUTABLE: 409,
  SUBMISSION_ALREADY_VOIDED: 409,
  IDEMPOTENCY_PAYLOAD_MISMATCH: 409,

  ATTACHMENT_MISSING: 422,
  ATTACHMENT_HASH_MISMATCH: 422,
  ATTACHMENT_TOO_LARGE: 413,
  ATTACHMENT_TYPE_NOT_ALLOWED: 415,
  /// 409 y no 422: el payload es válido; lo que choca es el estado del adjunto
  /// que ya existe con ese `client_attachment_id`. La outbox NO debe reintentarlo:
  /// hace falta un id nuevo o descartar el anterior.
  ATTACHMENT_CONFLICT: 409,
  /// 422: hay evidencia en el borrador que el envío no declara. Es corregible por
  /// el cliente —declararla o descartarla— así que no se reintenta a ciegas.
  ATTACHMENT_NOT_DECLARED: 422,

  PAYLOAD_TOO_LARGE: 413,
  FORBIDDEN: 403,
}

export interface FormErrorBody {
  success: false
  error: {
    code: FormErrorCode
    message: string
    details?: unknown
  }
}

/**
 * Error del dominio con código estable.
 *
 * Se lanza desde el service y el controller lo traduce; así el service no
 * necesita conocer `FastifyReply` y sigue siendo testeable sin HTTP.
 */
export class FormError extends Error {
  readonly code: FormErrorCode
  readonly status: number
  readonly details?: unknown

  constructor(code: FormErrorCode, message: string, details?: unknown) {
    super(message)
    this.name = 'FormError'
    this.code = code
    this.status = STATUS_BY_CODE[code]
    this.details = details
  }

  toBody(): FormErrorBody {
    return {
      success: false,
      error: { code: this.code, message: this.message, ...(this.details ? { details: this.details } : {}) },
    }
  }
}

export function isFormError(err: unknown): err is FormError {
  return err instanceof FormError
}

export function httpStatusFor(code: FormErrorCode): number {
  return STATUS_BY_CODE[code]
}
