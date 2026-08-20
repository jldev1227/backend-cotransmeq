/**
 * Límites del dominio.
 *
 * Existen para acotar el trabajo del servidor y del teléfono, no por gusto: el
 * runner del portal renderiza el árbol completo en un móvil de gama baja y una
 * versión con 5.000 campos lo bloquea. Se centralizan aquí porque el validador,
 * los schemas Zod y el builder tienen que coincidir.
 *
 * Los topes están holgados respecto a las semillas HSEQ reales (la más grande,
 * el preoperacional FR-09, ronda 200 campos).
 */

export const DEFINITION_LIMITS = {
  maxSections: 60,
  /** Contando hijos de repetibles. */
  maxFieldsPerVersion: 800,
  maxFieldsPerSection: 300,
  maxOptionsPerField: 300,
  maxChildrenPerContainer: 120,
  maxConditionsPerRule: 20,
  /** Un solo nivel de anidación: no hay repetibles dentro de repetibles. */
  maxNestingDepth: 2,
  maxKeyLength: 120,
  maxLabelLength: 500,
  maxTitleLength: 255,
  maxOptionValueLength: 120,
  maxOptionLabelLength: 255,
} as const

export const SUBMISSION_LIMITS = {
  maxAnswersPerSubmission: 5000,
  maxAttachmentsPerSubmission: 60,
  maxOccurrencesPerContainer: 200,
  maxTextLength: 20000,
} as const

export const ATTACHMENT_LIMITS = {
  /** Antes de comprimir en el cliente. */
  maxPhotoBytes: 10 * 1024 * 1024,
  maxFileBytes: 25 * 1024 * 1024,
  maxSignatureBytes: 2 * 1024 * 1024,
  /** Suma por borrador local, para no agotar la cuota de IndexedDB. */
  maxDraftBytes: 100 * 1024 * 1024,
  allowedPhotoMime: ['image/jpeg', 'image/png', 'image/webp'] as readonly string[],
  allowedSignatureMime: ['image/png', 'image/webp'] as readonly string[],
  allowedFileMime: [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
  ] as readonly string[],
} as const

/**
 * `key` de sección y de campo.
 *
 * Empieza por letra y admite `_`, sin acentos ni espacios: las reglas
 * condicionales referencian `fieldKey` como texto plano y una key con tilde o
 * mayúsculas variables es una fuente inagotable de reglas que no disparan.
 */
export const KEY_PATTERN = /^[a-z][a-z0-9_]*$/

/** `value` de opción: igual que las keys pero admite números al inicio (`1`, `2a`). */
export const OPTION_VALUE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/
