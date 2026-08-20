/**
 * Validación de RESPUESTAS contra una definición publicada.
 *
 * Es la contraparte de `validateFormDefinition`: aquella valida el formulario,
 * esta valida lo que el conductor contestó. También es pura —recibe la
 * definición ya cargada y devuelve el resultado— para poder probarla sin base
 * de datos y para que el runner del portal pueda ejecutar la misma lógica antes
 * de enviar.
 *
 * Hace dos cosas a la vez, y por eso no está partida:
 *
 *  1. **Valida**: required, tipo, rango, opciones existentes, ocurrencias,
 *     adjuntos y visibilidad.
 *  2. **Tipa**: decide en qué columna de `form_answers` va cada valor.
 *
 * Están juntas porque son la misma decisión. Separarlas obligaría a resolver dos
 * veces "¿de qué tipo es este campo y qué valor admite?", y la segunda copia se
 * desincronizaría en el primer tipo nuevo.
 *
 * **Los campos ocultos por regla no se exigen.** Un `required` dentro de una
 * rama que la regla apagó no es un campo sin contestar: es un campo que el
 * conductor no vio. Exigirlo bloquearía envíos correctos.
 */

import {
  capabilitiesOf,
  isFieldType,
  sanitizeJson,
  sanitizeText,
  SUBMISSION_LIMITS,
  type FieldValidationConfig,
  type Rule,
  type RuleCondition,
} from './domain'
import type { FormFieldDto, FormVersionDto } from './formularios-dinamicos.mapper'
import type { AnswerInput, AttachmentInput } from './domain'

export interface AnswerIssue {
  fieldId: string
  fieldKey: string
  occurrenceId: string | null
  code: string
  message: string
}

/** Respuesta lista para insertar: el valor ya está en su columna. */
export interface PreparedAnswer {
  fieldId: string
  occurrenceId: string | null
  rowIndex: number | null
  valueText: string | null
  valueDecimal: number | null
  valueBoolean: boolean | null
  /** `YYYY-MM-DD`; el llamador lo convierte a `Date` UTC. */
  valueDate: string | null
  /** ISO-8601. */
  valueDatetime: string | null
  valueJson: unknown | null
  optionIds: string[]
  /** Lo rellena el service tras el INSERT, para enlazar adjuntos. */
  answerId?: string
}

export interface AnswerValidationResult {
  errors: AnswerIssue[]
  prepared: PreparedAnswer[]
}

interface FlatField {
  field: FormFieldDto
  parent: FormFieldDto | null
}

const vacio = (v: unknown): boolean => v === undefined || v === null || (typeof v === 'string' && v.trim() === '')

export function validateSubmissionAnswers(params: {
  definition: FormVersionDto
  answers: AnswerInput[]
  attachments: AttachmentInput[]
}): AnswerValidationResult {
  const errors: AnswerIssue[] = []
  const prepared: PreparedAnswer[] = []

  // ── Índices de la definición ─────────────────────────────────────────────
  const flat = new Map<string, FlatField>()
  const byKey = new Map<string, FormFieldDto>()
  for (const section of params.definition.sections) {
    const walk = (fields: FormFieldDto[], parent: FormFieldDto | null) => {
      for (const field of fields) {
        flat.set(field.id, { field, parent })
        byKey.set(field.key, field)
        if (field.children.length) walk(field.children, field)
      }
    }
    walk(section.fields, null)
  }

  const push = (field: FormFieldDto | null, occurrenceId: string | null, code: string, message: string, fieldId?: string) =>
    errors.push({
      fieldId: field?.id ?? fieldId ?? '',
      fieldKey: field?.key ?? '',
      occurrenceId,
      code,
      message,
    })

  // ── Agrupar lo recibido ──────────────────────────────────────────────────
  //
  // La clave es `fieldId|occurrenceId` porque eso es exactamente lo que los
  // índices únicos parciales de la base consideran duplicado.
  const recibidas = new Map<string, AnswerInput>()
  for (const answer of params.answers) {
    const entrada = flat.get(answer.fieldId)
    if (!entrada) {
      push(null, answer.occurrenceId ?? null, 'FIELD_NOT_IN_VERSION', 'La respuesta apunta a un campo que no existe en esta versión.', answer.fieldId)
      continue
    }
    const clave = `${answer.fieldId}|${answer.occurrenceId ?? ''}`
    if (recibidas.has(clave)) {
      push(entrada.field, answer.occurrenceId ?? null, 'ANSWER_DUPLICATE', 'Hay dos respuestas para el mismo campo y ocurrencia.')
      continue
    }
    recibidas.set(clave, answer)
  }

  /** Valor efectivo de una key, para evaluar reglas. */
  const valorDe = (key: string, occurrenceId: string | null): unknown => {
    const field = byKey.get(key)
    if (!field) return undefined
    /// Se busca primero en la misma ocurrencia (una regla dentro de una fila de
    /// repetible mira las celdas de SU fila) y si no, en el nivel raíz.
    const enFila = occurrenceId ? recibidas.get(`${field.id}|${occurrenceId}`) : undefined
    const answer = enFila ?? recibidas.get(`${field.id}|`)
    if (!answer) return undefined
    if ((answer.optionValues ?? []).length) return answer.optionValues
    return answer.value
  }

  const visible = (field: FormFieldDto, occurrenceId: string | null): boolean =>
    esVisible(field, occurrenceId, flat, valorDe)

  // ── Ocurrencias declaradas por contenedor ────────────────────────────────
  const ocurrenciasPorContenedor = new Map<string, Set<string>>()
  for (const answer of recibidas.values()) {
    const entrada = flat.get(answer.fieldId)!
    if (!entrada.parent || !answer.occurrenceId) continue
    const set = ocurrenciasPorContenedor.get(entrada.parent.id) ?? new Set<string>()
    set.add(answer.occurrenceId)
    ocurrenciasPorContenedor.set(entrada.parent.id, set)
  }

  // ── Adjuntos por campo/ocurrencia ────────────────────────────────────────
  const adjuntosPorCampo = new Map<string, number>()
  for (const attachment of params.attachments) {
    const clave = `${attachment.fieldId}|${attachment.occurrenceId ?? ''}`
    adjuntosPorCampo.set(clave, (adjuntosPorCampo.get(clave) ?? 0) + 1)
  }

  // ── Validación campo a campo ─────────────────────────────────────────────
  for (const { field, parent } of flat.values()) {
    if (!isFieldType(field.type)) continue
    const cap = capabilitiesOf(field.type)
    const validation = (field.validation ?? {}) as FieldValidationConfig

    if (cap.children) {
      const ocurrencias = ocurrenciasPorContenedor.get(field.id) ?? new Set<string>()
      if (!visible(field, null)) continue

      if (field.required && ocurrencias.size === 0) {
        push(field, null, 'REQUIRED', `"${field.label}" necesita al menos una fila.`)
      }
      if (validation.minRows != null && ocurrencias.size > 0 && ocurrencias.size < validation.minRows) {
        push(field, null, 'MIN_ROWS', `"${field.label}" necesita al menos ${validation.minRows} filas.`)
      }
      if (validation.maxRows != null && ocurrencias.size > validation.maxRows) {
        push(field, null, 'MAX_ROWS', `"${field.label}" admite como máximo ${validation.maxRows} filas.`)
      }
      if (ocurrencias.size > SUBMISSION_LIMITS.maxOccurrencesPerContainer) {
        push(field, null, 'MAX_ROWS', `"${field.label}" supera el máximo de ${SUBMISSION_LIMITS.maxOccurrencesPerContainer} filas.`)
      }
      continue
    }

    if (cap.slot === 'none') continue

    /// Un campo hijo se valida UNA VEZ POR OCURRENCIA existente. Si el
    /// contenedor no tiene filas, sus hijos no se exigen: no hay fila que
    /// rellenar.
    const contextos: (string | null)[] = parent
      ? [...(ocurrenciasPorContenedor.get(parent.id) ?? new Set<string>())]
      : [null]

    for (const occurrenceId of contextos) {
      if (parent && !visible(parent, null)) continue
      if (!visible(field, occurrenceId)) continue

      const answer = recibidas.get(`${field.id}|${occurrenceId ?? ''}`)
      const adjuntosDeclarados = adjuntosPorCampo.get(`${field.id}|${occurrenceId ?? ''}`) ?? 0

      if (cap.attachment) {
        if (field.required && adjuntosDeclarados === 0) {
          push(field, occurrenceId, 'REQUIRED', `"${field.label}" necesita evidencia.`)
        }
        const maxFiles = validation.maxFiles ?? (field.type === 'SIGNATURE' ? 1 : undefined)
        if (maxFiles != null && adjuntosDeclarados > maxFiles) {
          push(field, occurrenceId, 'MAX_FILES', `"${field.label}" admite como máximo ${maxFiles} archivo(s).`)
        }
        continue
      }

      const sinResponder = !answer || (vacio(answer.value) && (answer.optionValues ?? []).length === 0)
      if (sinResponder) {
        if (field.required) push(field, occurrenceId, 'REQUIRED', `"${field.label}" es obligatorio.`)
        continue
      }

      const resultado = tipar(field, answer!, occurrenceId)
      if (resultado.error) {
        push(field, occurrenceId, resultado.error.code, resultado.error.message)
        continue
      }

      const rango = comprobarRango(field, resultado.prepared!, validation)
      if (rango) {
        push(field, occurrenceId, rango.code, rango.message)
        continue
      }

      prepared.push(resultado.prepared!)
    }
  }

  // ── Adjuntos que no corresponden a ningún campo válido ───────────────────
  for (const attachment of params.attachments) {
    const entrada = flat.get(attachment.fieldId)
    if (!entrada) {
      push(null, attachment.occurrenceId ?? null, 'FIELD_NOT_IN_VERSION', 'Un adjunto apunta a un campo que no existe en esta versión.', attachment.fieldId)
      continue
    }
    if (!isFieldType(entrada.field.type) || !capabilitiesOf(entrada.field.type).attachment) {
      push(entrada.field, attachment.occurrenceId ?? null, 'ATTACHMENT_NOT_ALLOWED', `Un campo ${entrada.field.type} no admite adjuntos.`)
    }
  }

  if (prepared.length > SUBMISSION_LIMITS.maxAnswersPerSubmission) {
    errors.push({
      fieldId: '',
      fieldKey: '',
      occurrenceId: null,
      code: 'TOO_MANY_ANSWERS',
      message: `El envío supera el máximo de ${SUBMISSION_LIMITS.maxAnswersPerSubmission} respuestas.`,
    })
  }

  return { errors, prepared }
}

// ─────────────────────────────────────────────────────────────────────────────
// Visibilidad
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ¿El campo está visible con las respuestas dadas?
 *
 * Solo se consideran las reglas cuyo efecto recae SOBRE este campo, y solo las
 * de tipo `show`/`hide`: `require` y `disable` no ocultan nada.
 *
 * Se recorren las reglas de todos los campos porque el efecto puede venir de
 * otro (`targetFieldKey`); una regla que solo mirara la propia
 * `visibilityRule` del campo se perdería el patrón "estado NC ⇒ mostrar
 * observación" declarado en el estado.
 */
function esVisible(
  field: FormFieldDto,
  occurrenceId: string | null,
  flat: Map<string, FlatField>,
  valorDe: (key: string, occurrenceId: string | null) => unknown,
): boolean {
  let visible = true
  let hayShow = false

  for (const { field: otro } of flat.values()) {
    const rule = otro.visibilityRule as Rule | null
    if (!rule || typeof rule !== 'object' || !rule.effect) continue
    const action = rule.effect.action
    if (action !== 'show' && action !== 'hide') continue

    const target = rule.effect.targetFieldKey ?? otro.key
    if (target !== field.key) continue

    const cumple = evaluarRegla(rule, occurrenceId, valorDe)
    if (action === 'show') {
      hayShow = true
      /// Varias reglas `show` sobre el mismo campo se combinan con OR: basta que
      /// una se cumpla. Con AND, dos condiciones alternativas ("mostrar si NC" y
      /// "mostrar si NA") se anularían entre sí.
      if (cumple) return true
    } else if (cumple) {
      visible = false
    }
  }

  /// Si hay reglas `show` y ninguna se cumplió, el campo está oculto: `show`
  /// implica que por defecto no se ve.
  if (hayShow) return false
  return visible
}

function evaluarRegla(
  rule: Rule,
  occurrenceId: string | null,
  valorDe: (key: string, occurrenceId: string | null) => unknown,
): boolean {
  const all = rule.all ?? []
  const any = rule.any ?? []
  if (all.length === 0 && any.length === 0) return false

  const okAll = all.every((c) => evaluarCondicion(c, occurrenceId, valorDe))
  const okAny = any.length === 0 ? true : any.some((c) => evaluarCondicion(c, occurrenceId, valorDe))
  return okAll && okAny
}

function evaluarCondicion(
  condition: RuleCondition,
  occurrenceId: string | null,
  valorDe: (key: string, occurrenceId: string | null) => unknown,
): boolean {
  const actual = valorDe(condition.fieldKey, occurrenceId)
  const esperado = condition.value

  /// Un valor multivaluado (MULTIPLE_CHOICE) cumple si CUALQUIERA de sus
  /// elementos cumple: "si marcó 'derrame'" no debe fallar porque además marcó
  /// otras dos casillas.
  const comparar = (fn: (v: unknown) => boolean): boolean =>
    Array.isArray(actual) ? actual.some(fn) : fn(actual)

  switch (condition.operator) {
    case 'exists':
      return Array.isArray(actual) ? actual.length > 0 : !vacio(actual)
    case 'equals':
      return comparar((v) => String(v) === String(esperado))
    case 'notEquals':
      return !comparar((v) => String(v) === String(esperado))
    case 'in':
      return Array.isArray(esperado) && comparar((v) => esperado.some((e) => String(e) === String(v)))
    case 'notIn':
      return Array.isArray(esperado) && !comparar((v) => esperado.some((e) => String(e) === String(v)))
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const a = numeroComparable(actual)
      const b = numeroComparable(esperado)
      if (a === null || b === null) return false
      if (condition.operator === 'gt') return a > b
      if (condition.operator === 'gte') return a >= b
      if (condition.operator === 'lt') return a < b
      return a <= b
    }
    default:
      return false
  }
}

/** Número o fecha como número, para los operadores de orden. */
function numeroComparable(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || value.trim() === '') return null
  const asNumber = Number(value)
  if (Number.isFinite(asNumber)) return asNumber
  const asDate = Date.parse(value)
  return Number.isNaN(asDate) ? null : asDate
}

// ─────────────────────────────────────────────────────────────────────────────
// Tipado del valor
// ─────────────────────────────────────────────────────────────────────────────

function base(field: FormFieldDto, answer: AnswerInput, occurrenceId: string | null): PreparedAnswer {
  return {
    fieldId: field.id,
    occurrenceId,
    rowIndex: answer.rowIndex ?? null,
    valueText: null,
    valueDecimal: null,
    valueBoolean: null,
    valueDate: null,
    valueDatetime: null,
    valueJson: null,
    optionIds: [],
  }
}

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/
const RE_HORA = /^([01]\d|2[0-3]):[0-5]\d$/

/**
 * Coloca el valor en la columna correcta del tipo del campo.
 *
 * Es estricto con los formatos: acepta `YYYY-MM-DD` y `HH:mm`, no "cualquier
 * cosa que `new Date()` sepa parsear". `new Date('01/02/2026')` da enero o
 * febrero según la configuración regional, y esa ambigüedad en un preoperacional
 * no se puede auditar después.
 */
function tipar(
  field: FormFieldDto,
  answer: AnswerInput,
  occurrenceId: string | null,
): { prepared?: PreparedAnswer; error?: { code: string; message: string } } {
  const prepared = base(field, answer, occurrenceId)
  const raw = answer.value

  switch (field.type) {
    case 'SHORT_TEXT':
    case 'LONG_TEXT': {
      if (typeof raw !== 'string') return { error: { code: 'TYPE', message: `"${field.label}" espera texto.` } }
      if (raw.length > SUBMISSION_LIMITS.maxTextLength) {
        return { error: { code: 'MAX_LENGTH', message: `"${field.label}" supera el máximo de caracteres.` } }
      }
      /// Se sanea AQUÍ, en el único punto por el que pasa todo texto que se
      /// persiste. Un `U+0000` pegado desde un PDF hace fallar el INSERT con un
      /// error del driver que el conductor no puede interpretar, y una marca
      /// bidireccional permitiría que la observación se lea distinta de como se
      /// guardó.
      ///
      /// El saneamiento NO invalida la respuesta: la longitud se comprueba antes
      /// (contra lo que el conductor escribió) y el rango después (contra lo que
      /// se guarda), así que quitar caracteres invisibles no puede convertir un
      /// texto válido en uno que incumpla `minLength`… salvo que el texto fuera
      /// solo caracteres invisibles, y en ese caso el rechazo es correcto.
      prepared.valueText = sanitizeText(raw, {
        singleLine: field.type === 'SHORT_TEXT',
        maxLength: SUBMISSION_LIMITS.maxTextLength
      })
      return { prepared }
    }

    case 'TIME': {
      if (typeof raw !== 'string' || !RE_HORA.test(raw)) {
        return { error: { code: 'TYPE', message: `"${field.label}" espera una hora HH:mm.` } }
      }
      prepared.valueText = raw
      return { prepared }
    }

    case 'INTEGER':
    case 'DECIMAL':
    case 'CALCULATED': {
      const n = typeof raw === 'number' ? raw : Number(String(raw).replace(',', '.'))
      if (!Number.isFinite(n)) return { error: { code: 'TYPE', message: `"${field.label}" espera un número.` } }
      if (field.type === 'INTEGER' && !Number.isInteger(n)) {
        return { error: { code: 'TYPE', message: `"${field.label}" espera un número entero.` } }
      }
      prepared.valueDecimal = n
      return { prepared }
    }

    case 'BOOLEAN': {
      if (typeof raw === 'boolean') {
        prepared.valueBoolean = raw
        return { prepared }
      }
      /// Se aceptan las formas que produce un `<select>`: el runner envía
      /// booleanos, pero las semillas y los imports traen "SI"/"NO".
      const texto = String(raw).trim().toLowerCase()
      if (['true', 'si', 'sí', '1'].includes(texto)) {
        prepared.valueBoolean = true
        return { prepared }
      }
      if (['false', 'no', '0'].includes(texto)) {
        prepared.valueBoolean = false
        return { prepared }
      }
      return { error: { code: 'TYPE', message: `"${field.label}" espera sí o no.` } }
    }

    case 'DATE': {
      if (typeof raw !== 'string' || !RE_FECHA.test(raw) || Number.isNaN(Date.parse(`${raw}T00:00:00Z`))) {
        return { error: { code: 'TYPE', message: `"${field.label}" espera una fecha YYYY-MM-DD.` } }
      }
      prepared.valueDate = raw
      return { prepared }
    }

    case 'DATETIME': {
      if (typeof raw !== 'string' || Number.isNaN(Date.parse(raw))) {
        return { error: { code: 'TYPE', message: `"${field.label}" espera una fecha y hora ISO.` } }
      }
      prepared.valueDatetime = new Date(raw).toISOString()
      return { prepared }
    }

    case 'SINGLE_CHOICE':
    case 'MULTIPLE_CHOICE': {
      const valores = (answer.optionValues ?? []).length
        ? answer.optionValues!
        : Array.isArray(raw)
          ? raw.map(String)
          : raw != null
            ? [String(raw)]
            : []

      if (field.type === 'SINGLE_CHOICE' && valores.length > 1) {
        return { error: { code: 'TOO_MANY_OPTIONS', message: `"${field.label}" admite una sola opción.` } }
      }

      const porValor = new Map(field.options.map((o) => [o.value, o.id]))
      const ids: string[] = []
      for (const valor of valores) {
        const id = porValor.get(valor)
        if (!id) {
          return {
            error: { code: 'OPTION_UNKNOWN', message: `"${valor}" no es una opción de "${field.label}".` },
          }
        }
        ids.push(id)
      }
      /// Duplicados sin error: el runner puede enviar la misma opción dos veces
      /// tras un doble toque, y rechazarlo por eso sería absurdo. El PK
      /// compuesto de `form_answer_options` no admitiría el segundo INSERT.
      prepared.optionIds = [...new Set(ids)]
      return { prepared }
    }

    case 'LOCATION': {
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        return { error: { code: 'TYPE', message: `"${field.label}" espera una ubicación.` } }
      }
      const { lat, lng } = raw as { lat?: unknown; lng?: unknown }
      if (typeof lat !== 'number' || typeof lng !== 'number' || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        return { error: { code: 'TYPE', message: `"${field.label}" espera lat/lng válidos.` } }
      }
      prepared.valueJson = raw
      return { prepared }
    }

    case 'LOOKUP': {
      if (typeof raw === 'string') {
        prepared.valueJson = { id: raw }
        return { prepared }
      }
      if (typeof raw === 'object' && raw !== null && typeof (raw as any).id === 'string') {
        /// Se conserva el snapshot que envía el cliente (placa, marca, clase):
        /// es lo que permite leer el envío años después aunque el vehículo se
        /// haya dado de baja. Se sanea porque son cadenas que acabarán en un
        /// informe.
        prepared.valueJson = sanitizeJson(raw)
        return { prepared }
      }
      return { error: { code: 'TYPE', message: `"${field.label}" espera una referencia con id.` } }
    }

    default:
      return { error: { code: 'TYPE', message: `El tipo ${field.type} no acepta respuesta directa.` } }
  }
}

/** Rango, longitud y patrón. Se aplica sobre el valor ya tipado. */
function comprobarRango(
  field: FormFieldDto,
  prepared: PreparedAnswer,
  validation: FieldValidationConfig,
): { code: string; message: string } | null {
  if (prepared.valueText != null) {
    const texto = prepared.valueText
    if (validation.minLength != null && texto.length < validation.minLength) {
      return { code: 'MIN_LENGTH', message: `"${field.label}" necesita al menos ${validation.minLength} caracteres.` }
    }
    if (validation.maxLength != null && texto.length > validation.maxLength) {
      return { code: 'MAX_LENGTH', message: `"${field.label}" admite ${validation.maxLength} caracteres como máximo.` }
    }
    if (validation.pattern) {
      try {
        if (!new RegExp(validation.pattern).test(texto)) {
          return { code: 'PATTERN', message: `"${field.label}" no tiene el formato esperado.` }
        }
      } catch {
        /// Un `pattern` que no compila se ignora en vez de bloquear el envío:
        /// el error es de la definición y ya lo reporta el validador de
        /// definiciones. Castigar al conductor por eso sería absurdo.
      }
    }
  }

  if (prepared.valueDecimal != null) {
    const n = prepared.valueDecimal
    if (validation.min != null && n < validation.min) {
      return { code: 'MIN', message: `"${field.label}" debe ser al menos ${validation.min}.` }
    }
    if (validation.max != null && n > validation.max) {
      return { code: 'MAX', message: `"${field.label}" no puede pasar de ${validation.max}.` }
    }
    if (validation.precision != null) {
      const decimales = String(n).split('.')[1]?.length ?? 0
      if (decimales > validation.precision) {
        return {
          code: 'PRECISION',
          message: `"${field.label}" admite ${validation.precision} decimal(es).`,
        }
      }
    }
  }

  if (field.type === 'MULTIPLE_CHOICE') {
    const n = prepared.optionIds.length
    if (validation.minSelected != null && n < validation.minSelected) {
      return { code: 'MIN_SELECTED', message: `"${field.label}" necesita al menos ${validation.minSelected} opciones.` }
    }
    if (validation.maxSelected != null && n > validation.maxSelected) {
      return { code: 'MAX_SELECTED', message: `"${field.label}" admite ${validation.maxSelected} opciones como máximo.` }
    }
  }

  return null
}

export const respuestasInternals = { esVisible, evaluarRegla, evaluarCondicion, tipar, comprobarRango }
