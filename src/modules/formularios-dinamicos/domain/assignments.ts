/**
 * Asignaciones: quién diligencia qué versión, cuándo, y cuántas veces.
 *
 * Los literales son la copia autoritativa de los CHECK
 * `ck_form_assignments_*` y `ck_form_assignment_targets_type`.
 */

export const ASSIGNMENT_STATUSES = ['ACTIVE', 'PAUSED', 'CLOSED'] as const
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number]

export const ASSIGNMENT_FREQUENCIES = [
  'ON_DEMAND',
  'ONCE',
  'DAILY',
  'WEEKLY',
  'MONTHLY',
  'PER_SERVICE',
] as const
export type AssignmentFrequency = (typeof ASSIGNMENT_FREQUENCIES)[number]

export const LIMIT_POLICIES = ['UNLIMITED', 'ONE_PER_PERIOD', 'ONE_PER_CONTEXT'] as const
export type LimitPolicy = (typeof LIMIT_POLICIES)[number]

export const TARGET_TYPES = ['ALL_CONDUCTORS', 'CONDUCTOR', 'VEHICLE', 'SEDE', 'GROUP'] as const
export type TargetType = (typeof TARGET_TYPES)[number]

/** Zona de negocio. Fijarla evita que UTC mueva un preoperacional de día. */
export const BUSINESS_TIMEZONE = 'America/Bogota'

export interface AssignmentTargetInput {
  type: TargetType
  conductorId?: string | null
  vehicleId?: string | null
  sede?: string | null
  groupKey?: string | null
}

export interface AssignmentContextRequirement {
  required?: boolean
}

/** `{"vehicleId": {"required": true}}` — qué debe traer el runner al abrir. */
export type AssignmentContextSchema = Record<string, AssignmentContextRequirement>

export interface AssignmentInput {
  versionId: string
  name: string
  frequency: AssignmentFrequency
  limitPolicy: LimitPolicy
  timezone?: string
  startsAt?: string | null
  endsAt?: string | null
  targets: AssignmentTargetInput[]
  contextSchema?: AssignmentContextSchema
  settings?: Record<string, unknown>
}

/** Estado de la tarjeta en el listado del portal. */
export const DUE_STATES = ['AVAILABLE', 'DONE', 'NOT_YET', 'EXPIRED', 'PAUSED'] as const
export type DueState = (typeof DUE_STATES)[number]

/**
 * Clave de período de `ONE_PER_PERIOD`, derivada de `business_date`.
 *
 * Se calcula sobre la fecha de negocio YA resuelta en la zona de la
 * asignación (`YYYY-MM-DD`) y no sobre un `Date`: si aceptara un timestamp,
 * cada llamador tendría que recordar convertir la zona y alguno no lo haría.
 *
 * `ON_DEMAND` y `PER_SERVICE` devuelven `null`: no tienen período, su unicidad
 * la controla el contexto (`ONE_PER_CONTEXT`) o nada.
 */
export function periodKeyFor(frequency: AssignmentFrequency, businessDate: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(businessDate)
  if (!match) {
    throw new Error(`businessDate debe ser YYYY-MM-DD, se recibió "${businessDate}"`)
  }
  const [, year, month, day] = match

  switch (frequency) {
    case 'DAILY':
      return businessDate
    case 'WEEKLY':
      return isoWeekKey(Number(year), Number(month), Number(day))
    case 'MONTHLY':
      return `${year}-${month}`
    case 'ONCE':
      /// Una sola vez en toda la vigencia: el período es la asignación entera.
      return 'ONCE'
    case 'ON_DEMAND':
    case 'PER_SERVICE':
      return null
  }
}

/**
 * Semana ISO-8601 (`2026-W34`), con el año de la semana y no el del día.
 *
 * El 1 de enero puede pertenecer a la semana 52 del año anterior, así que
 * `${year}-W${week}` con el año del día produciría claves que colisionan entre
 * diciembre y enero.
 */
function isoWeekKey(year: number, month: number, day: number): string {
  const date = new Date(Date.UTC(year, month - 1, day))
  /// Jueves de la misma semana ISO: su año es, por definición, el año ISO.
  const dayOfWeek = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - dayOfWeek)
  const isoYear = date.getUTCFullYear()
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4))
  const firstDayOfWeek = firstThursday.getUTCDay() || 7
  firstThursday.setUTCDate(firstThursday.getUTCDate() + 4 - firstDayOfWeek)
  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000))
  return `${isoYear}-W${String(week).padStart(2, '0')}`
}

/**
 * Fecha de negocio de un instante en una zona dada, en `YYYY-MM-DD`.
 *
 * Vía `Intl` y no con aritmética de offsets: Colombia no tiene horario de
 * verano hoy, pero la asignación puede configurar otra zona y sumar/restar
 * horas a mano se rompe en el cambio de hora.
 */
export function businessDateFor(instant: Date, timezone: string = BUSINESS_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00'
  return `${get('year')}-${get('month')}-${get('day')}`
}
