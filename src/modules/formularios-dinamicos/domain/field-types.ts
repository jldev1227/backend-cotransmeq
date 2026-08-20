/**
 * Tipos de campo del motor dinámico (v1).
 *
 * Esta lista es la copia autoritativa en TypeScript del CHECK
 * `ck_form_fields_type` de `19-08-2026-formularios-dinamicos/migration.sql`.
 * Si se agrega un tipo hay que tocar los dos sitios: aquí para que el
 * validador lo acepte, y el CHECK para que la base no lo rechace.
 *
 * Las capacidades (¿admite opciones? ¿admite hijos? ¿en qué columna guarda su
 * valor?) se declaran una sola vez en `FIELD_CAPABILITIES` en vez de repartirse
 * en `switch` por todo el módulo: el validador, el adaptador de respuestas y el
 * renderer necesitan exactamente la misma tabla, y tres copias se desincronizan.
 */

export const FIELD_TYPES = [
  'SHORT_TEXT',
  'LONG_TEXT',
  'INTEGER',
  'DECIMAL',
  'DATE',
  'TIME',
  'DATETIME',
  'SINGLE_CHOICE',
  'MULTIPLE_CHOICE',
  'BOOLEAN',
  'SIGNATURE',
  'PHOTO',
  'FILE',
  'LOCATION',
  'INFO',
  'REPEATABLE_GROUP',
  'MATRIX',
  'LOOKUP',
  'CALCULATED',
] as const

export type FieldType = (typeof FIELD_TYPES)[number]

/** Columna de `form_answers` donde aterriza el valor escalar del campo. */
export type AnswerSlot =
  | 'value_text'
  | 'value_decimal'
  | 'value_boolean'
  | 'value_date'
  | 'value_datetime'
  | 'value_json'
  /// El valor vive en `form_answer_options`, no en una columna escalar.
  | 'options'
  /// El valor vive en `form_attachments`.
  | 'attachment'
  /// No produce respuesta (`INFO`) o solo agrupa hijas (contenedores).
  | 'none'

export interface FieldCapability {
  /** Requiere al menos una opción y no acepta valores fuera de ellas. */
  options: boolean
  /** Contenedor: sus hijos son las columnas/celdas de cada ocurrencia. */
  children: boolean
  /** Admite `occurrence_id` en sus respuestas. */
  repeatable: boolean
  /** Produce filas en `form_attachments`. */
  attachment: boolean
  slot: AnswerSlot
}

const base = (slot: AnswerSlot, over: Partial<FieldCapability> = {}): FieldCapability => ({
  options: false,
  children: false,
  repeatable: false,
  attachment: false,
  slot,
  ...over,
})

export const FIELD_CAPABILITIES: Record<FieldType, FieldCapability> = {
  SHORT_TEXT: base('value_text'),
  LONG_TEXT: base('value_text'),
  INTEGER: base('value_decimal'),
  DECIMAL: base('value_decimal'),
  DATE: base('value_date'),
  /// `TIME` va a texto `HH:mm`: no hay tipo `time` en el esquema y guardarlo
  /// como timestamp obligaría a inventar una fecha.
  TIME: base('value_text'),
  DATETIME: base('value_datetime'),
  SINGLE_CHOICE: base('options', { options: true }),
  MULTIPLE_CHOICE: base('options', { options: true }),
  BOOLEAN: base('value_boolean'),
  SIGNATURE: base('attachment', { attachment: true }),
  PHOTO: base('attachment', { attachment: true }),
  FILE: base('attachment', { attachment: true }),
  LOCATION: base('value_json'),
  INFO: base('none'),
  REPEATABLE_GROUP: base('none', { children: true, repeatable: true }),
  MATRIX: base('none', { children: true, repeatable: true }),
  /// Guarda el UUID de la entidad más un snapshot de sus datos legibles, para
  /// que el envío siga contando qué placa era aunque el vehículo se renombre.
  LOOKUP: base('value_json'),
  CALCULATED: base('value_decimal'),
}

/** Fuentes admitidas por `LOOKUP` (`config.source`). */
export const LOOKUP_SOURCES = ['CONDUCTOR', 'VEHICLE', 'SERVICE'] as const
export type LookupSource = (typeof LOOKUP_SOURCES)[number]

export function isFieldType(value: unknown): value is FieldType {
  return typeof value === 'string' && (FIELD_TYPES as readonly string[]).includes(value)
}

export function capabilitiesOf(type: FieldType): FieldCapability {
  return FIELD_CAPABILITIES[type]
}

/**
 * ¿Es un campo que el conductor responde?
 *
 * `INFO` y los contenedores no cuentan: una versión formada solo por
 * instrucciones y grupos vacíos no se puede publicar porque no hay nada que
 * diligenciar.
 */
export function isAnswerable(type: FieldType): boolean {
  const cap = FIELD_CAPABILITIES[type]
  return cap.slot !== 'none'
}

export function isContainer(type: FieldType): boolean {
  return FIELD_CAPABILITIES[type].children
}
