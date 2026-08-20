/**
 * Forma del agregado de definición.
 *
 * Un solo juego de tipos cubre las dos direcciones del contrato, porque son la
 * misma estructura: lo que el builder envía en `PUT .../versions/:id` y lo que
 * la API devuelve en `GET`. La diferencia es que en la entrada los `id` son
 * opcionales (un nodo nuevo todavía no tiene uno) y en la salida siempre
 * vienen; de ahí `FormVersionDraft` (entrada) y `FormVersionDto` (salida).
 *
 * camelCase a propósito: Prisma habla snake_case y la API camelCase, y la
 * traducción vive en el adaptador del módulo, no repartida por el dominio.
 */

import type { FieldType } from './field-types'
import type { Rule } from './rules'

export const VERSION_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const
export type VersionStatus = (typeof VERSION_STATUSES)[number]

export interface FormOptionDraft {
  id?: string
  /** Token estable que referencian las reglas. No es texto de presentación. */
  value: string
  label: string
  color?: string | null
  score?: number | null
  sortOrder: number
  metadata?: Record<string, unknown>
}

export interface FormFieldDraft {
  id?: string
  key: string
  type: FieldType
  label: string
  helpText?: string | null
  placeholder?: string | null
  required?: boolean
  sortOrder: number
  config?: Record<string, unknown>
  validation?: Record<string, unknown>
  visibilityRule?: Rule | null
  defaultValue?: unknown
  options?: FormOptionDraft[]
  /** Solo `REPEATABLE_GROUP` y `MATRIX`. Un nivel; no hay repetibles anidados. */
  children?: FormFieldDraft[]
}

export interface FormSectionDraft {
  id?: string
  key: string
  title: string
  description?: string | null
  sortOrder: number
  settings?: Record<string, unknown>
  fields: FormFieldDraft[]
}

export interface FormVersionDraft {
  title: string
  description?: string | null
  instructions?: string | null
  settings?: Record<string, unknown>
  sections: FormSectionDraft[]
}

/** Payload de `PUT .../versions/:id`: el árbol más el control de concurrencia. */
export interface FormVersionUpdateInput extends FormVersionDraft {
  /** `revision` que el builder cree vigente. Si no coincide → REVISION_CONFLICT. */
  revision: number
  /** Idempotencia del autosave; permite ignorar un reintento del mismo guardado. */
  clientMutationId?: string
}

/**
 * `validation` reconocidas por el validador y por el runner.
 *
 * Se declara como interfaz aunque la columna sea JSONB libre: lo que no esté
 * aquí se conserva pero no se aplica, y el validador lo reporta como warning
 * para que no se publique una regla que nadie va a ejecutar.
 */
export interface FieldValidationConfig {
  minLength?: number
  maxLength?: number
  min?: number
  max?: number
  /** Decimales permitidos en `DECIMAL`. */
  precision?: number
  /** Máximo de adjuntos en `PHOTO`/`FILE`. */
  maxFiles?: number
  /** Mínimo/máximo de ocurrencias en contenedores. */
  minRows?: number
  maxRows?: number
  /** Mínimo/máximo de opciones marcadas en `MULTIPLE_CHOICE`. */
  minSelected?: number
  maxSelected?: number
  /** Expresión regular aplicada a texto. Se compila en el validador. */
  pattern?: string
}

export const VALIDATION_KEYS: readonly (keyof FieldValidationConfig)[] = [
  'minLength',
  'maxLength',
  'min',
  'max',
  'precision',
  'maxFiles',
  'minRows',
  'maxRows',
  'minSelected',
  'maxSelected',
  'pattern',
]
