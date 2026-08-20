/**
 * Validador puro del agregado de definición.
 *
 * Sin Prisma, sin Fastify, sin red: entra un árbol y salen issues. Es lo que
 * permite probarlo sin base de datos y, sobre todo, es lo que hace que el
 * backend pueda re-validar en `publish` exactamente lo mismo que el builder
 * mostró en pantalla. Si esta función necesitara la base, el frontend tendría
 * que reimplementarla y las dos copias divergirían.
 *
 * Distingue error de warning:
 *
 *   - **error**   bloquea publicar. Es algo que la base rechazaría, que el
 *                 runner no sabría renderizar, o que produciría datos que
 *                 después no se pueden interpretar.
 *   - **warning** no bloquea. Es algo sospechoso que HSEQ debe mirar (una
 *                 opción única, un texto duplicado de la transcripción del
 *                 Excel) pero que funciona.
 *
 * `mode: 'draft'` relaja solo los requisitos de completitud: un borrador a
 * medio construir no tiene por qué tener ya un campo diligenciable.
 */

import type { FormFieldDraft, FormOptionDraft, FormSectionDraft, FormVersionDraft } from './definition'
import { VALIDATION_KEYS, type FieldValidationConfig } from './definition'
import { capabilitiesOf, isAnswerable, isContainer, isFieldType, LOOKUP_SOURCES } from './field-types'
import {
  ARRAY_OPERATORS,
  NUMERIC_OPERATORS,
  VALUELESS_OPERATORS,
  isRuleAction,
  isRuleOperator,
  ruleConditions,
  type Rule,
} from './rules'
import { DEFINITION_LIMITS, KEY_PATTERN, OPTION_VALUE_PATTERN, SUBMISSION_LIMITS } from './limits'

export type IssueSeverity = 'error' | 'warning'

export interface ValidationIssue {
  /** Código estable; el builder lo usa para enlazar el issue con la card. */
  code: string
  severity: IssueSeverity
  message: string
  /** Ruta dentro del árbol, p. ej. `sections[0].fields[2].options[1]`. */
  path: string
  meta?: Record<string, unknown>
}

export interface DefinitionValidationResult {
  /** `false` si hay al menos un error. Los warnings no invalidan. */
  valid: boolean
  errors: ValidationIssue[]
  warnings: ValidationIssue[]
}

export interface ValidateOptions {
  /**
   * `publish` exige que la versión esté completa; `draft` solo que sea
   * coherente. El autosave valida en modo draft para no llenar el builder de
   * errores rojos mientras se construye.
   */
  mode?: 'draft' | 'publish'
}

/** Funciones permitidas en la fórmula de un `CALCULATED`. */
const FORMULA_FUNCTIONS = new Set(['sum', 'min', 'max', 'round', 'abs', 'avg', 'count', 'if'])

/** Qué claves de `validation` tienen sentido en cada familia de campo. */
const VALIDATION_APPLIES: Record<keyof FieldValidationConfig, (type: string) => boolean> = {
  minLength: (t) => ['SHORT_TEXT', 'LONG_TEXT', 'TIME'].includes(t),
  maxLength: (t) => ['SHORT_TEXT', 'LONG_TEXT', 'TIME'].includes(t),
  pattern: (t) => ['SHORT_TEXT', 'LONG_TEXT', 'TIME'].includes(t),
  min: (t) => ['INTEGER', 'DECIMAL', 'CALCULATED'].includes(t),
  max: (t) => ['INTEGER', 'DECIMAL', 'CALCULATED'].includes(t),
  precision: (t) => ['DECIMAL', 'CALCULATED'].includes(t),
  /// También SIGNATURE: el validador de respuestas lo honra, con default 1.
  maxFiles: (t) => ['PHOTO', 'FILE', 'SIGNATURE'].includes(t),
  minRows: (t) => ['REPEATABLE_GROUP', 'MATRIX'].includes(t),
  maxRows: (t) => ['REPEATABLE_GROUP', 'MATRIX'].includes(t),
  minSelected: (t) => t === 'MULTIPLE_CHOICE',
  maxSelected: (t) => t === 'MULTIPLE_CHOICE',
}

interface FlatField {
  field: FormFieldDraft
  path: string
  depth: number
  parentKey: string | null
}

export function validateFormDefinition(
  draft: FormVersionDraft,
  options: ValidateOptions = {},
): DefinitionValidationResult {
  const mode = options.mode ?? 'publish'
  const issues: ValidationIssue[] = []

  const add = (
    severity: IssueSeverity,
    code: string,
    path: string,
    message: string,
    meta?: Record<string, unknown>,
  ) => {
    issues.push({ severity, code, path, message, ...(meta ? { meta } : {}) })
  }
  /// En modo draft casi todo lo estructural sigue siendo error (la base lo
  /// rechazaría igual); lo que se degrada a warning es la completitud.
  const completeness = (code: string, path: string, message: string) =>
    add(mode === 'publish' ? 'error' : 'warning', code, path, message)

  // ── Cabecera ──────────────────────────────────────────────────────────────
  if (!isNonEmpty(draft.title)) {
    add('error', 'VERSION_TITLE_REQUIRED', 'title', 'La versión necesita un título.')
  } else if (draft.title.length > DEFINITION_LIMITS.maxTitleLength) {
    add('error', 'VERSION_TITLE_TOO_LONG', 'title', `El título supera ${DEFINITION_LIMITS.maxTitleLength} caracteres.`)
  }

  const sections = Array.isArray(draft.sections) ? draft.sections : []
  if (sections.length === 0) {
    completeness('NO_SECTIONS', 'sections', 'La versión no tiene secciones.')
  }
  if (sections.length > DEFINITION_LIMITS.maxSections) {
    add('error', 'LIMIT_EXCEEDED', 'sections', `Máximo ${DEFINITION_LIMITS.maxSections} secciones por versión.`, {
      limit: DEFINITION_LIMITS.maxSections,
      actual: sections.length,
    })
  }

  // ── Recorrido: se aplana primero y se valida después ──────────────────────
  //
  // El orden importa: las reglas referencian keys de cualquier parte del árbol
  // (una condición puede mirar un campo de la sección 1 desde la sección 9), así
  // que el índice completo de keys tiene que existir antes de validar reglas.
  const flat: FlatField[] = []
  const sectionKeys = new Map<string, string>()
  const sectionOrders = new Map<number, string>()
  const seenIds = new Map<string, string>()

  const registerId = (id: string | undefined, path: string) => {
    if (!id) return
    const previous = seenIds.get(id)
    if (previous) {
      add('error', 'ID_DUPLICATE', path, `El id "${id}" se repite (también en ${previous}).`, { id })
      return
    }
    seenIds.set(id, path)
  }

  sections.forEach((section, sIndex) => {
    const sPath = `sections[${sIndex}]`
    registerId(section.id, sPath)
    validateSectionShape(section, sPath, add)

    if (isNonEmpty(section.key)) {
      const previous = sectionKeys.get(section.key)
      if (previous) {
        add('error', 'SECTION_KEY_DUPLICATE', `${sPath}.key`, `La clave de sección "${section.key}" ya se usa en ${previous}.`, {
          key: section.key,
        })
      } else {
        sectionKeys.set(section.key, sPath)
      }
    }

    if (Number.isInteger(section.sortOrder)) {
      const previous = sectionOrders.get(section.sortOrder)
      if (previous) {
        add('error', 'SECTION_ORDER_DUPLICATE', `${sPath}.sortOrder`, `El orden ${section.sortOrder} ya lo usa ${previous}.`, {
          sortOrder: section.sortOrder,
        })
      } else {
        sectionOrders.set(section.sortOrder, sPath)
      }
    }

    const fields = Array.isArray(section.fields) ? section.fields : []
    if (fields.length === 0) {
      add('warning', 'SECTION_EMPTY', sPath, `La sección "${section.title || section.key}" no tiene campos.`)
    }
    if (fields.length > DEFINITION_LIMITS.maxFieldsPerSection) {
      add('error', 'LIMIT_EXCEEDED', `${sPath}.fields`, `Máximo ${DEFINITION_LIMITS.maxFieldsPerSection} campos por sección.`, {
        limit: DEFINITION_LIMITS.maxFieldsPerSection,
        actual: fields.length,
      })
    }

    collectFields(fields, `${sPath}.fields`, 1, null, flat, registerId, add)
  })

  if (flat.length > DEFINITION_LIMITS.maxFieldsPerVersion) {
    add('error', 'LIMIT_EXCEEDED', 'sections', `Máximo ${DEFINITION_LIMITS.maxFieldsPerVersion} campos por versión.`, {
      limit: DEFINITION_LIMITS.maxFieldsPerVersion,
      actual: flat.length,
    })
  }

  // ── Índice global de keys ────────────────────────────────────────────────
  //
  // La unicidad de `key` es por VERSIÓN, no por sección: `uq_form_fields_key`
  // es `(version_id, key)` y las reglas resuelven `fieldKey` sin decir en qué
  // sección buscarlo.
  const fieldByKey = new Map<string, FlatField>()
  for (const entry of flat) {
    if (!isNonEmpty(entry.field.key)) continue
    const previous = fieldByKey.get(entry.field.key)
    if (previous) {
      add('error', 'FIELD_KEY_DUPLICATE', `${entry.path}.key`, `La clave "${entry.field.key}" ya se usa en ${previous.path}.`, {
        key: entry.field.key,
      })
      continue
    }
    fieldByKey.set(entry.field.key, entry)
  }

  const answerable = flat.filter((f) => isFieldType(f.field.type) && isAnswerable(f.field.type))
  if (answerable.length === 0 && sections.length > 0) {
    completeness('NO_ANSWERABLE_FIELD', 'sections', 'La versión no tiene ningún campo diligenciable.')
  }

  // ── Campo por campo ──────────────────────────────────────────────────────
  for (const entry of flat) {
    validateField(entry, fieldByKey, add)
  }

  // ── Etiquetas repetidas (síntoma típico de transcripción del Excel) ───────
  const labelOwners = new Map<string, string>()
  for (const entry of flat) {
    const label = normalizeLabel(entry.field.label)
    if (!label) continue
    const previous = labelOwners.get(label)
    if (previous) {
      add('warning', 'FIELD_LABEL_DUPLICATE', `${entry.path}.label`, `La etiqueta se repite (también en ${previous}).`, {
        label: entry.field.label,
      })
    } else {
      labelOwners.set(label, entry.path)
    }
  }

  // ── Grafo de reglas ──────────────────────────────────────────────────────
  detectRuleCycles(flat, fieldByKey, add)

  const errors = issues.filter((i) => i.severity === 'error')
  const warnings = issues.filter((i) => i.severity === 'warning')
  return { valid: errors.length === 0, errors, warnings }
}

// ─────────────────────────────────────────────────────────────────────────────
// Recorrido
// ─────────────────────────────────────────────────────────────────────────────

type AddIssue = (
  severity: IssueSeverity,
  code: string,
  path: string,
  message: string,
  meta?: Record<string, unknown>,
) => void

function collectFields(
  fields: FormFieldDraft[],
  basePath: string,
  depth: number,
  parentKey: string | null,
  out: FlatField[],
  registerId: (id: string | undefined, path: string) => void,
  add: AddIssue,
): void {
  /// El orden es único entre HERMANOS, no en toda la sección: los hijos de un
  /// repetible tienen su propia secuencia (`uq_form_fields_order` incluye
  /// `parent_field_id`).
  const orders = new Map<number, string>()

  fields.forEach((field, index) => {
    const path = `${basePath}[${index}]`
    registerId(field.id, path)
    out.push({ field, path, depth, parentKey })

    if (Number.isInteger(field.sortOrder)) {
      const previous = orders.get(field.sortOrder)
      if (previous) {
        add('error', 'FIELD_ORDER_DUPLICATE', `${path}.sortOrder`, `El orden ${field.sortOrder} ya lo usa ${previous}.`, {
          sortOrder: field.sortOrder,
        })
      } else {
        orders.set(field.sortOrder, path)
      }
    }

    const children = Array.isArray(field.children) ? field.children : []
    if (children.length === 0) return

    if (depth >= DEFINITION_LIMITS.maxNestingDepth) {
      /// Ya se reporta como NESTED_CONTAINER en `validateField`; aquí solo se
      /// corta el recorrido para no aplanar un árbol arbitrariamente profundo.
      return
    }
    collectFields(children, `${path}.children`, depth + 1, field.key ?? null, out, registerId, add)
  })
}

function validateSectionShape(section: FormSectionDraft, path: string, add: AddIssue): void {
  if (!isNonEmpty(section.key)) {
    add('error', 'SECTION_KEY_REQUIRED', `${path}.key`, 'La sección necesita una clave.')
  } else if (!KEY_PATTERN.test(section.key)) {
    add(
      'error',
      'SECTION_KEY_INVALID',
      `${path}.key`,
      `"${section.key}" no es una clave válida: minúsculas, números y "_", empezando por letra.`,
    )
  } else if (section.key.length > DEFINITION_LIMITS.maxKeyLength) {
    add('error', 'SECTION_KEY_TOO_LONG', `${path}.key`, `La clave supera ${DEFINITION_LIMITS.maxKeyLength} caracteres.`)
  }

  if (!isNonEmpty(section.title)) {
    add('error', 'SECTION_TITLE_REQUIRED', `${path}.title`, 'La sección necesita un título.')
  } else if (section.title.length > DEFINITION_LIMITS.maxTitleLength) {
    add('error', 'SECTION_TITLE_TOO_LONG', `${path}.title`, `El título supera ${DEFINITION_LIMITS.maxTitleLength} caracteres.`)
  }

  if (!Number.isInteger(section.sortOrder) || section.sortOrder < 0) {
    add('error', 'SECTION_ORDER_INVALID', `${path}.sortOrder`, 'El orden debe ser un entero ≥ 0.')
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Campo
// ─────────────────────────────────────────────────────────────────────────────

function validateField(entry: FlatField, fieldByKey: Map<string, FlatField>, add: AddIssue): void {
  const { field, path } = entry

  if (!isNonEmpty(field.key)) {
    add('error', 'FIELD_KEY_REQUIRED', `${path}.key`, 'El campo necesita una clave.')
  } else if (!KEY_PATTERN.test(field.key)) {
    add(
      'error',
      'FIELD_KEY_INVALID',
      `${path}.key`,
      `"${field.key}" no es una clave válida: minúsculas, números y "_", empezando por letra.`,
    )
  } else if (field.key.length > DEFINITION_LIMITS.maxKeyLength) {
    add('error', 'FIELD_KEY_TOO_LONG', `${path}.key`, `La clave supera ${DEFINITION_LIMITS.maxKeyLength} caracteres.`)
  }

  if (!isFieldType(field.type)) {
    add('error', 'FIELD_TYPE_INVALID', `${path}.type`, `Tipo de campo desconocido: "${String(field.type)}".`)
    /// Sin tipo válido no se puede decir nada más del campo: si admite opciones,
    /// hijos o qué `validation` tiene sentido depende justamente del tipo.
    return
  }

  const cap = capabilitiesOf(field.type)

  if (!isNonEmpty(field.label)) {
    add('error', 'FIELD_LABEL_REQUIRED', `${path}.label`, 'El campo necesita una etiqueta.')
  } else if (field.label.length > DEFINITION_LIMITS.maxLabelLength) {
    add('error', 'FIELD_LABEL_TOO_LONG', `${path}.label`, `La etiqueta supera ${DEFINITION_LIMITS.maxLabelLength} caracteres.`)
  }

  if (!Number.isInteger(field.sortOrder) || field.sortOrder < 0) {
    add('error', 'FIELD_ORDER_INVALID', `${path}.sortOrder`, 'El orden debe ser un entero ≥ 0.')
  }

  if (field.required && field.type === 'INFO') {
    add('warning', 'INFO_REQUIRED_IGNORED', `${path}.required`, 'Un campo informativo no se responde; "obligatorio" se ignora.')
  }

  validateOptions(field, cap.options, path, add)
  validateChildren(entry, cap.children, add)
  validateValidationConfig(field, path, add)
  validateTypeConfig(field, fieldByKey, path, add)

  if (field.visibilityRule != null) {
    validateRule(field.visibilityRule, field, fieldByKey, `${path}.visibilityRule`, add)
  }
}

function validateOptions(
  field: FormFieldDraft,
  allowsOptions: boolean,
  path: string,
  add: AddIssue,
): void {
  const options = Array.isArray(field.options) ? field.options : []

  if (!allowsOptions) {
    if (options.length > 0) {
      add(
        'error',
        'FIELD_OPTIONS_NOT_ALLOWED',
        `${path}.options`,
        `Un campo ${field.type} no lleva opciones; usa SINGLE_CHOICE o MULTIPLE_CHOICE.`,
      )
    }
    return
  }

  if (options.length === 0) {
    add('error', 'FIELD_OPTIONS_REQUIRED', `${path}.options`, `Un campo ${field.type} necesita al menos una opción.`)
    return
  }
  if (options.length === 1) {
    add('warning', 'FIELD_OPTIONS_SINGLE', `${path}.options`, 'Una sola opción: el conductor no tiene nada que elegir.')
  }
  if (options.length > DEFINITION_LIMITS.maxOptionsPerField) {
    add('error', 'LIMIT_EXCEEDED', `${path}.options`, `Máximo ${DEFINITION_LIMITS.maxOptionsPerField} opciones por campo.`, {
      limit: DEFINITION_LIMITS.maxOptionsPerField,
      actual: options.length,
    })
  }

  const values = new Map<string, number>()
  const orders = new Map<number, number>()
  const labels = new Map<string, number>()

  options.forEach((option: FormOptionDraft, index) => {
    const oPath = `${path}.options[${index}]`

    if (!isNonEmpty(option.value)) {
      add('error', 'OPTION_VALUE_REQUIRED', `${oPath}.value`, 'La opción necesita un valor.')
    } else if (!OPTION_VALUE_PATTERN.test(option.value)) {
      add('error', 'OPTION_VALUE_INVALID', `${oPath}.value`, `"${option.value}" no es un valor de opción válido.`)
    } else if (option.value.length > DEFINITION_LIMITS.maxOptionValueLength) {
      add('error', 'OPTION_VALUE_TOO_LONG', `${oPath}.value`, `El valor supera ${DEFINITION_LIMITS.maxOptionValueLength} caracteres.`)
    } else {
      const previous = values.get(option.value)
      if (previous !== undefined) {
        add('error', 'OPTION_VALUE_DUPLICATE', `${oPath}.value`, `El valor "${option.value}" ya lo usa options[${previous}].`, {
          value: option.value,
        })
      } else {
        values.set(option.value, index)
      }
    }

    if (!isNonEmpty(option.label)) {
      add('error', 'OPTION_LABEL_REQUIRED', `${oPath}.label`, 'La opción necesita una etiqueta.')
    } else if (option.label.length > DEFINITION_LIMITS.maxOptionLabelLength) {
      add('error', 'OPTION_LABEL_TOO_LONG', `${oPath}.label`, `La etiqueta supera ${DEFINITION_LIMITS.maxOptionLabelLength} caracteres.`)
    } else {
      const key = normalizeLabel(option.label)
      const previous = labels.get(key)
      if (previous !== undefined) {
        add('warning', 'OPTION_LABEL_DUPLICATE', `${oPath}.label`, `La etiqueta se repite (también en options[${previous}]).`)
      } else {
        labels.set(key, index)
      }
    }

    if (!Number.isInteger(option.sortOrder) || option.sortOrder < 0) {
      add('error', 'OPTION_ORDER_INVALID', `${oPath}.sortOrder`, 'El orden debe ser un entero ≥ 0.')
    } else {
      const previous = orders.get(option.sortOrder)
      if (previous !== undefined) {
        add('error', 'OPTION_ORDER_DUPLICATE', `${oPath}.sortOrder`, `El orden ${option.sortOrder} ya lo usa options[${previous}].`)
      } else {
        orders.set(option.sortOrder, index)
      }
    }

    if (option.score != null && !Number.isFinite(option.score)) {
      add('error', 'OPTION_SCORE_INVALID', `${oPath}.score`, 'El puntaje debe ser numérico.')
    }
  })
}

function validateChildren(entry: FlatField, allowsChildren: boolean, add: AddIssue): void {
  const { field, path } = entry
  const children = Array.isArray(field.children) ? field.children : []

  if (!allowsChildren) {
    if (children.length > 0) {
      add(
        'error',
        'FIELD_CHILDREN_NOT_ALLOWED',
        `${path}.children`,
        `Un campo ${field.type} no admite campos hijos; usa REPEATABLE_GROUP o MATRIX.`,
      )
    }
    return
  }

  if (children.length === 0) {
    add('error', 'CONTAINER_EMPTY', `${path}.children`, `Un campo ${field.type} necesita al menos un campo hijo.`)
    return
  }
  if (children.length > DEFINITION_LIMITS.maxChildrenPerContainer) {
    add('error', 'LIMIT_EXCEEDED', `${path}.children`, `Máximo ${DEFINITION_LIMITS.maxChildrenPerContainer} hijos por contenedor.`, {
      limit: DEFINITION_LIMITS.maxChildrenPerContainer,
      actual: children.length,
    })
  }

  /// Un repetible dentro de otro repetible haría que `occurrence_id` deje de
  /// identificar una fila: harían falta dos niveles de ocurrencia y el esquema
  /// solo tiene uno.
  children.forEach((child, index) => {
    if (isFieldType(child.type) && isContainer(child.type)) {
      add(
        'error',
        'NESTED_CONTAINER',
        `${path}.children[${index}]`,
        `No se admite un ${child.type} dentro de un ${field.type}: solo hay un nivel de repetición.`,
      )
    }
  })

  if (field.type === 'MATRIX') {
    const types = new Set(children.map((c) => c.type))
    if (types.size > 1) {
      add(
        'warning',
        'MATRIX_MIXED_TYPES',
        `${path}.children`,
        'Las columnas de la matriz tienen tipos distintos; se renderiza pero deja de leerse como tabla.',
      )
    }
  }
}

function validateValidationConfig(field: FormFieldDraft, path: string, add: AddIssue): void {
  const raw = field.validation
  if (raw == null) return
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    add('error', 'VALIDATION_MALFORMED', `${path}.validation`, '`validation` debe ser un objeto.')
    return
  }

  const v = raw as FieldValidationConfig & Record<string, unknown>

  for (const key of Object.keys(raw)) {
    if (!(VALIDATION_KEYS as readonly string[]).includes(key)) {
      add('warning', 'VALIDATION_UNKNOWN_KEY', `${path}.validation.${key}`, `"${key}" no la aplica ningún validador; se conserva pero se ignora.`)
      continue
    }
    const applies = VALIDATION_APPLIES[key as keyof FieldValidationConfig]
    if (!applies(field.type)) {
      add('warning', 'VALIDATION_NOT_APPLICABLE', `${path}.validation.${key}`, `"${key}" no aplica a un campo ${field.type}.`)
    }
  }

  const pairs: [keyof FieldValidationConfig, keyof FieldValidationConfig][] = [
    ['minLength', 'maxLength'],
    ['min', 'max'],
    ['minRows', 'maxRows'],
    ['minSelected', 'maxSelected'],
  ]
  for (const [lo, hi] of pairs) {
    const a = v[lo]
    const b = v[hi]
    if (typeof a === 'number' && typeof b === 'number' && a > b) {
      add('error', 'VALIDATION_RANGE_INVALID', `${path}.validation.${lo}`, `${lo} (${a}) no puede ser mayor que ${hi} (${b}).`)
    }
  }

  if (v.precision != null && (!Number.isInteger(v.precision) || v.precision < 0 || v.precision > 6)) {
    /// `form_answers.value_decimal` es DECIMAL(18,6): pedir más decimales
    /// prometería una precisión que la base truncaría en silencio.
    add('error', 'VALIDATION_PRECISION_INVALID', `${path}.validation.precision`, 'La precisión debe ser un entero entre 0 y 6.')
  }

  if (typeof v.maxLength === 'number' && v.maxLength > SUBMISSION_LIMITS.maxTextLength) {
    add('warning', 'VALIDATION_MAXLENGTH_CAPPED', `${path}.validation.maxLength`, `El servidor recorta a ${SUBMISSION_LIMITS.maxTextLength} caracteres.`)
  }

  if (v.pattern != null) {
    if (typeof v.pattern !== 'string') {
      add('error', 'VALIDATION_PATTERN_INVALID', `${path}.validation.pattern`, '`pattern` debe ser una cadena.')
    } else {
      try {
        new RegExp(v.pattern)
      } catch {
        add('error', 'VALIDATION_PATTERN_INVALID', `${path}.validation.pattern`, `"${v.pattern}" no es una expresión regular válida.`)
      }
    }
  }
}

function validateTypeConfig(
  field: FormFieldDraft,
  fieldByKey: Map<string, FlatField>,
  path: string,
  add: AddIssue,
): void {
  const config = (field.config ?? {}) as Record<string, unknown>

  if (field.type === 'LOOKUP') {
    const source = config.source
    if (typeof source !== 'string' || !(LOOKUP_SOURCES as readonly string[]).includes(source)) {
      add(
        'error',
        'LOOKUP_SOURCE_INVALID',
        `${path}.config.source`,
        `Un LOOKUP necesita config.source en ${LOOKUP_SOURCES.join(' | ')}.`,
      )
    }
  }

  if (field.type === 'CALCULATED') {
    const formula = config.formula
    if (typeof formula !== 'string' || !isNonEmpty(formula)) {
      add('error', 'CALCULATED_FORMULA_MISSING', `${path}.config.formula`, 'Un CALCULATED necesita config.formula.')
    } else {
      /// La fórmula es declarativa y NUNCA se evalúa como JavaScript. Aquí solo
      /// se comprueba que sus referencias existan: un total que apunta a una key
      /// borrada se quedaría en blanco sin avisar a nadie.
      for (const token of new Set(formula.match(/[a-zA-Z_][a-zA-Z0-9_]*/g) ?? [])) {
        const lower = token.toLowerCase()
        if (FORMULA_FUNCTIONS.has(lower)) continue
        if (fieldByKey.has(token)) continue
        add('error', 'CALCULATED_REF_UNKNOWN', `${path}.config.formula`, `La fórmula referencia "${token}", que no es un campo de esta versión.`, {
          token,
        })
      }
    }
  }

  if ((field.type === 'PHOTO' || field.type === 'FILE') && config.maxFiles != null) {
    add('warning', 'CONFIG_MOVED_TO_VALIDATION', `${path}.config.maxFiles`, 'El límite de adjuntos se declara en `validation.maxFiles`.')
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Reglas
// ─────────────────────────────────────────────────────────────────────────────

/** Campo sobre el que recae el efecto: el declarado, o el dueño de la regla. */
function effectTargetKey(rule: Rule, owner: FormFieldDraft): string | undefined {
  return rule.effect?.targetFieldKey ?? owner.key
}

function validateRule(
  rule: Rule,
  owner: FormFieldDraft,
  fieldByKey: Map<string, FlatField>,
  path: string,
  add: AddIssue,
): void {
  if (typeof rule !== 'object' || rule === null || Array.isArray(rule)) {
    add('error', 'RULE_MALFORMED', path, 'La regla debe ser un objeto.')
    return
  }

  if (rule.version !== 1) {
    add('error', 'RULE_VERSION_UNSUPPORTED', `${path}.version`, 'Solo se admiten reglas con "version": 1.')
  }

  const effect = rule.effect
  if (typeof effect !== 'object' || effect === null) {
    add('error', 'RULE_MALFORMED', `${path}.effect`, 'La regla necesita un `effect`.')
  } else {
    if (!isRuleAction(effect.action)) {
      add('error', 'RULE_ACTION_INVALID', `${path}.effect.action`, `Acción desconocida: "${String(effect.action)}".`)
    }
    const target = effectTargetKey(rule, owner)
    if (target && !fieldByKey.has(target)) {
      add('error', 'RULE_TARGET_UNKNOWN', `${path}.effect.targetFieldKey`, `El efecto apunta a "${target}", que no es un campo de esta versión.`, {
        fieldKey: target,
      })
    }
  }

  const all = Array.isArray(rule.all) ? rule.all : []
  const any = Array.isArray(rule.any) ? rule.any : []
  const conditions = [...all, ...any]

  if (conditions.length === 0) {
    add('error', 'RULE_NO_CONDITIONS', path, 'La regla no tiene condiciones en `all` ni en `any`.')
    return
  }
  if (conditions.length > DEFINITION_LIMITS.maxConditionsPerRule) {
    add('error', 'LIMIT_EXCEEDED', path, `Máximo ${DEFINITION_LIMITS.maxConditionsPerRule} condiciones por regla.`, {
      limit: DEFINITION_LIMITS.maxConditionsPerRule,
      actual: conditions.length,
    })
  }

  const target = effectTargetKey(rule, owner)

  conditions.forEach((condition, index) => {
    /// La ruta distingue `all` de `any`: el builder resalta la condición exacta.
    const group = index < all.length ? 'all' : 'any'
    const localIndex = index < all.length ? index : index - all.length
    const cPath = `${path}.${group}[${localIndex}]`

    if (typeof condition !== 'object' || condition === null) {
      add('error', 'RULE_MALFORMED', cPath, 'La condición debe ser un objeto.')
      return
    }

    if (!isNonEmpty(condition.fieldKey)) {
      add('error', 'RULE_FIELD_REQUIRED', `${cPath}.fieldKey`, 'La condición necesita `fieldKey`.')
      return
    }

    const source = fieldByKey.get(condition.fieldKey)
    if (!source) {
      add('error', 'RULE_FIELD_UNKNOWN', `${cPath}.fieldKey`, `La condición mira "${condition.fieldKey}", que no es un campo de esta versión.`, {
        fieldKey: condition.fieldKey,
      })
      return
    }

    if (condition.fieldKey === target) {
      add(
        'error',
        'RULE_SELF_REFERENCE',
        cPath,
        `La regla condiciona "${target}" a su propio valor, así que nunca se puede resolver.`,
        { fieldKey: target },
      )
    }

    if (!isRuleOperator(condition.operator)) {
      add('error', 'RULE_OPERATOR_INVALID', `${cPath}.operator`, `Operador desconocido: "${String(condition.operator)}".`)
      return
    }

    const op = condition.operator

    if (VALUELESS_OPERATORS.includes(op)) {
      if (condition.value !== undefined) {
        add('warning', 'RULE_VALUE_IGNORED', `${cPath}.value`, `El operador "${op}" no usa \`value\`.`)
      }
      return
    }

    if (condition.value === undefined || condition.value === null) {
      add('error', 'RULE_VALUE_REQUIRED', `${cPath}.value`, `El operador "${op}" necesita \`value\`.`)
      return
    }

    if (ARRAY_OPERATORS.includes(op)) {
      if (!Array.isArray(condition.value) || condition.value.length === 0) {
        add('error', 'RULE_VALUE_INVALID', `${cPath}.value`, `El operador "${op}" necesita un array no vacío.`)
        return
      }
    } else if (Array.isArray(condition.value)) {
      add('error', 'RULE_VALUE_INVALID', `${cPath}.value`, `El operador "${op}" no acepta un array; usa "in"/"notIn".`)
      return
    }

    if (NUMERIC_OPERATORS.includes(op) && !isComparable(condition.value)) {
      add('error', 'RULE_VALUE_INVALID', `${cPath}.value`, `El operador "${op}" necesita un número o una fecha ISO.`)
      return
    }

    /// Una condición contra un valor que ya no existe entre las opciones es la
    /// forma más común de regla muerta: al renombrar `NC` a `NO_CUMPLE` la
    /// observación condicional deja de pedirse y nadie se entera.
    if (isFieldType(source.field.type) && capabilitiesOf(source.field.type).options) {
      const declared = new Set((source.field.options ?? []).map((o) => o.value))
      const wanted = Array.isArray(condition.value) ? condition.value : [condition.value]
      for (const value of wanted) {
        if (typeof value !== 'string' || declared.has(value)) continue
        add('error', 'RULE_OPTION_UNKNOWN', `${cPath}.value`, `"${value}" no es una opción de "${condition.fieldKey}".`, {
          fieldKey: condition.fieldKey,
          value,
        })
      }
    }
  })
}

/**
 * Ciclos en el grafo de reglas.
 *
 * Aristas `condición → objetivo`: si `observacion` solo se pide cuando
 * `estado = NC`, y `estado` solo se muestra cuando `observacion` existe,
 * ninguno de los dos se puede resolver nunca y el runner se quedaría en un
 * bucle. Se detecta antes de publicar porque en tiempo de diligenciamiento ya
 * no hay nada que hacer.
 *
 * Se reporta UNA vez por ciclo (no una por arista) para que el builder muestre
 * un mensaje entendible y no doce.
 */
function detectRuleCycles(flat: FlatField[], fieldByKey: Map<string, FlatField>, add: AddIssue): void {
  const graph = new Map<string, Set<string>>()
  const rulePathByEdge = new Map<string, string>()

  for (const { field, path } of flat) {
    const rule = field.visibilityRule
    if (!rule || typeof rule !== 'object') continue
    const target = effectTargetKey(rule, field)
    if (!target || !fieldByKey.has(target)) continue

    for (const condition of ruleConditions(rule)) {
      const from = condition?.fieldKey
      if (!from || !fieldByKey.has(from) || from === target) continue
      if (!graph.has(from)) graph.set(from, new Set())
      graph.get(from)!.add(target)
      rulePathByEdge.set(`${from}->${target}`, `${path}.visibilityRule`)
    }
  }

  const WHITE = 0
  const GREY = 1
  const BLACK = 2
  const color = new Map<string, number>()
  const stack: string[] = []
  const reported = new Set<string>()

  const visit = (node: string): void => {
    color.set(node, GREY)
    stack.push(node)

    for (const next of graph.get(node) ?? []) {
      const state = color.get(next) ?? WHITE
      if (state === GREY) {
        const cycle = stack.slice(stack.indexOf(next))
        /// Firma canónica del ciclo: rotarlo para que empiece siempre por el
        /// mismo nodo evita reportar «a→b→a» y «b→a→b» como dos ciclos.
        const signature = canonicalCycle(cycle)
        if (!reported.has(signature)) {
          reported.add(signature)
          const chain = [...cycle, next].join(' → ')
          add('error', 'RULE_CYCLE', rulePathByEdge.get(`${node}->${next}`) ?? 'sections', `Las reglas forman un ciclo: ${chain}.`, {
            cycle,
          })
        }
        continue
      }
      if (state === WHITE) visit(next)
    }

    stack.pop()
    color.set(node, BLACK)
  }

  for (const node of graph.keys()) {
    if ((color.get(node) ?? WHITE) === WHITE) visit(node)
  }
}

function canonicalCycle(cycle: string[]): string {
  let best = cycle.join('|')
  for (let i = 1; i < cycle.length; i += 1) {
    const rotated = [...cycle.slice(i), ...cycle.slice(0, i)].join('|')
    if (rotated < best) best = rotated
  }
  return best
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilidades
// ─────────────────────────────────────────────────────────────────────────────

function isNonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/** Compara etiquetas ignorando acentos, mayúsculas y espacios sobrantes. */
function normalizeLabel(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** ¿Es comparable con `gt`/`lt`? Números y fechas ISO lo son. */
function isComparable(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'string') return false
  if (value.trim() !== '' && Number.isFinite(Number(value))) return true
  return !Number.isNaN(Date.parse(value))
}
