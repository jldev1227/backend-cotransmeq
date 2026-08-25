/**
 * Traducción entre filas de Prisma (snake_case, `Decimal`, `BigInt`) y los DTO
 * de la API (camelCase, números y strings JSON-safe).
 *
 * Vive en un archivo aparte y no en el service por dos razones concretas:
 *
 *  1. `Decimal` y `BigInt` de Prisma **no** son serializables por
 *     `JSON.stringify` (BigInt lanza `TypeError`). Cualquier ruta que devuelva
 *     una fila cruda revienta o pierde precisión, así que la conversión tiene
 *     que estar en un solo sitio por el que pase todo.
 *  2. El árbol de la definición se reconstruye aquí (los hijos llegan planos de
 *     la base, con `parent_field_id`), y esa lógica la comparten el builder, el
 *     preview y el runner del portal.
 */

import type { FieldType } from './domain'

// ─── DTOs ────────────────────────────────────────────────────────────────────

export interface FormOptionDto {
  id: string
  value: string
  label: string
  color: string | null
  score: number | null
  sortOrder: number
  metadata: Record<string, unknown>
}

export interface FormFieldDto {
  id: string
  key: string
  parentFieldId: string | null
  type: FieldType
  label: string
  helpText: string | null
  placeholder: string | null
  required: boolean
  sortOrder: number
  config: Record<string, unknown>
  validation: Record<string, unknown>
  visibilityRule: unknown | null
  defaultValue: unknown
  options: FormOptionDto[]
  children: FormFieldDto[]
}

export interface FormSectionDto {
  id: string
  key: string
  title: string
  description: string | null
  sortOrder: number
  settings: Record<string, unknown>
  fields: FormFieldDto[]
}

export interface FormVersionSummaryDto {
  id: string
  formId: string
  versionNumber: number
  status: string
  title: string
  revision: number
  createdAt: string
  updatedAt: string
  publishedAt: string | null
  archivedAt: string | null
}

export interface FormVersionDto extends FormVersionSummaryDto {
  description: string | null
  instructions: string | null
  settings: Record<string, unknown>
  sourceMetadata: Record<string, unknown>
  sections: FormSectionDto[]
}

export interface FormDefinitionDto {
  id: string
  code: string
  slug: string
  name: string
  description: string | null
  ownerArea: string
  deletedAt: string | null
  createdAt: string
  updatedAt: string
  activeVersion: FormVersionSummaryDto | null
  draftVersion: FormVersionSummaryDto | null
  versions?: FormVersionSummaryDto[]
  counts?: { assignments: number; submissions: number }
}

// ─── Utilidades de conversión ────────────────────────────────────────────────

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null
}

/** `Date` de una columna `DATE`, en `YYYY-MM-DD` y sin desplazar por zona. */
function dateOnly(value: Date | null | undefined): string | null {
  if (!value) return null
  /// Prisma devuelve las columnas `DATE` como medianoche UTC. `toISOString()`
  /// conserva ese día; formatear en local lo movería un día hacia atrás para
  /// cualquier zona al oeste de Greenwich, Bogotá incluida.
  return value.toISOString().slice(0, 10)
}

function json(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

/** `Decimal | null` → `number | null`, sin arrastrar el objeto de Prisma. */
function decimal(value: unknown): number | null {
  if (value == null) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

// ─── Definición ──────────────────────────────────────────────────────────────

export function toOptionDto(row: any): FormOptionDto {
  return {
    id: row.id,
    value: row.value,
    label: row.label,
    color: row.color ?? null,
    score: decimal(row.score),
    sortOrder: row.sort_order,
    metadata: json(row.metadata_json),
  }
}

/**
 * Reconstruye el árbol de campos desde las filas planas.
 *
 * Se hace en dos pasadas (índice y luego enganche) para que el orden en que la
 * consulta devolvió las filas no importe: un hijo puede venir antes que su
 * padre y con una sola pasada se perdería.
 */
export function buildFieldTree(rows: any[]): FormFieldDto[] {
  const byId = new Map<string, FormFieldDto>()
  for (const row of rows) {
    byId.set(row.id, {
      id: row.id,
      key: row.key,
      parentFieldId: row.parent_field_id ?? null,
      type: row.type,
      label: row.label,
      helpText: row.help_text ?? null,
      placeholder: row.placeholder ?? null,
      required: row.required,
      sortOrder: row.sort_order,
      config: json(row.config_json),
      validation: json(row.validation_json),
      visibilityRule: row.visibility_rule_json ?? null,
      defaultValue: row.default_value_json ?? null,
      options: (row.options ?? []).map(toOptionDto).sort(bySortOrder),
      children: [],
    })
  }

  const roots: FormFieldDto[] = []
  for (const row of rows) {
    const dto = byId.get(row.id)!
    const parent = row.parent_field_id ? byId.get(row.parent_field_id) : null
    if (parent) parent.children.push(dto)
    else roots.push(dto)
  }

  for (const dto of byId.values()) dto.children.sort(bySortOrder)
  return roots.sort(bySortOrder)
}

function bySortOrder(a: { sortOrder: number }, b: { sortOrder: number }): number {
  return a.sortOrder - b.sortOrder
}

export function toVersionSummaryDto(row: any): FormVersionSummaryDto {
  return {
    id: row.id,
    formId: row.form_id,
    versionNumber: row.version_number,
    status: row.status,
    title: row.title,
    revision: row.revision,
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
    publishedAt: iso(row.published_at),
    archivedAt: iso(row.archived_at),
  }
}

/**
 * Versión completa con su árbol.
 *
 * Espera `row.sections` y `row.fields`: los campos se piden por VERSIÓN y no
 * anidados por sección porque un hijo y su padre siempre están en la misma
 * sección, pero la consulta anidada obligaría a Prisma a un `include` por nivel.
 */
export function toVersionDto(row: any): FormVersionDto {
  const fieldsBySection = new Map<string, any[]>()
  for (const field of row.fields ?? []) {
    const list = fieldsBySection.get(field.section_id) ?? []
    list.push(field)
    fieldsBySection.set(field.section_id, list)
  }

  const sections: FormSectionDto[] = (row.sections ?? [])
    .map((section: any) => ({
      id: section.id,
      key: section.key,
      title: section.title,
      description: section.description ?? null,
      sortOrder: section.sort_order,
      settings: json(section.settings_json),
      fields: buildFieldTree(fieldsBySection.get(section.id) ?? []),
    }))
    .sort(bySortOrder)

  return {
    ...toVersionSummaryDto(row),
    description: row.description ?? null,
    instructions: row.instructions ?? null,
    settings: json(row.settings_json),
    sourceMetadata: json(row.source_metadata_json),
    sections,
  }
}

export function toDefinitionDto(row: any): FormDefinitionDto {
  const versions: any[] = row.versions ?? []
  /// La versión "activa" es la publicada más reciente. Puede haber varias
  /// publicadas a la vez porque archivar es opcional: una asignación vieja
  /// sigue apuntando a la v2 mientras las nuevas usan la v3.
  const published = versions
    .filter((v) => v.status === 'PUBLISHED')
    .sort((a, b) => b.version_number - a.version_number)
  const draft = versions
    .filter((v) => v.status === 'DRAFT')
    .sort((a, b) => b.version_number - a.version_number)

  const dto: FormDefinitionDto = {
    id: row.id,
    code: row.code,
    slug: row.slug,
    name: row.name,
    description: row.description ?? null,
    ownerArea: row.owner_area,
    deletedAt: iso(row.deleted_at),
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
    activeVersion: published[0] ? toVersionSummaryDto(published[0]) : null,
    draftVersion: draft[0] ? toVersionSummaryDto(draft[0]) : null,
  }

  if (row.versions) dto.versions = versions.map(toVersionSummaryDto)
  if (row._counts) dto.counts = row._counts
  return dto
}

export function toTemplateDto(row: any) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    fieldType: row.field_type,
    template: row.template_json,
    ownerArea: row.owner_area ?? null,
    isGlobal: row.is_global,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  }
}

// ─── Asignaciones ────────────────────────────────────────────────────────────

export function toTargetDto(row: any) {
  return {
    id: row.id,
    type: row.target_type,
    conductorId: row.conductor_id ?? null,
    vehicleId: row.vehicle_id ?? null,
    sede: row.sede ?? null,
    groupKey: row.group_key ?? null,
    conductor: row.conductor
      ? { id: row.conductor.id, nombre: `${row.conductor.nombre} ${row.conductor.apellido}`.trim() }
      : null,
    vehiculo: row.vehiculo ? { id: row.vehiculo.id, placa: row.vehiculo.placa } : null,
  }
}

export function toAssignmentDto(row: any) {
  return {
    id: row.id,
    versionId: row.version_id,
    name: row.name,
    status: row.status,
    frequency: row.frequency,
    limitPolicy: row.limit_policy,
    timezone: row.timezone,
    startsAt: iso(row.starts_at),
    endsAt: iso(row.ends_at),
    contextSchema: json(row.context_schema_json),
    settings: json(row.settings_json),
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
    deletedAt: iso(row.deleted_at),
    targets: (row.targets ?? []).map(toTargetDto),
    version: row.version
      ? {
          id: row.version.id,
          formId: row.version.form_id,
          versionNumber: row.version.version_number,
          status: row.version.status,
          title: row.version.title,
          code: row.version.form?.code ?? null,
        }
      : null,
    submissionCount: row._count?.submissions ?? undefined,
  }
}

// ─── Envíos ──────────────────────────────────────────────────────────────────

/**
 * Envoltura con la que un BORRADOR guarda su respuesta.
 *
 * `escribirRespuestasCrudas` no tipa nada: mete el valor entero en `value_json`
 * bajo `draftValue`, o los tokens marcados bajo `draftOptionValues`. Es
 * deliberado —un número a medio teclear ("12,") no es un decimal válido y
 * tiparlo perdería lo que el conductor llevaba escrito— pero deja los borradores
 * en un formato DISJUNTO del de los envíos entregados, que usan las columnas
 * tipadas y `form_answer_options`.
 */
function envolturaDeBorrador(
  valueJson: unknown,
): { draftValue?: unknown; draftOptionValues?: unknown } | null {
  if (valueJson == null || typeof valueJson !== 'object' || Array.isArray(valueJson)) return null
  const claves = Object.keys(valueJson)
  /// Se exige que la envoltura sea EXACTAMENTE una de las dos formas conocidas:
  /// un campo cuyo valor legítimo fuera un objeto con más claves no debe
  /// desenvolverse y perder el resto de su contenido.
  if (claves.length !== 1) return null
  if (claves[0] !== 'draftValue' && claves[0] !== 'draftOptionValues') return null
  return valueJson as { draftValue?: unknown; draftOptionValues?: unknown }
}

/**
 * Respuesta con su valor ya desnormalizado en un único campo `value`.
 *
 * La base guarda el escalar en la columna que corresponde al tipo (seis
 * columnas mutuamente excluyentes por `ck_form_answers_single_scalar`), pero el
 * cliente solo quiere "el valor": obligarle a mirar seis columnas y adivinar
 * cuál está poblada duplicaría la tabla de tipos en el frontend.
 *
 * Los borradores se deshacen aquí de su envoltura, y no en cada consumidor: sin
 * esto el panel recibía `{"draftOptionValues":["B"]}` donde esperaba `["B"]`, y
 * un preoperacional al 100 % con 131 respuestas se veía ENTERO en blanco.
 */
export function toAnswerDto(row: any) {
  const envoltura = envolturaDeBorrador(row.value_json)

  const optionValues: string[] =
    envoltura && Array.isArray(envoltura.draftOptionValues)
      ? envoltura.draftOptionValues.map((v: unknown) => String(v))
      : (row.options ?? []).map((o: any) => o.option?.value ?? o.option_id)

  let value: unknown = null
  if (row.value_text != null) value = row.value_text
  else if (row.value_decimal != null) value = decimal(row.value_decimal)
  else if (row.value_boolean != null) value = row.value_boolean
  else if (row.value_date != null) value = dateOnly(row.value_date)
  else if (row.value_datetime != null) value = iso(row.value_datetime)
  else if (envoltura) value = 'draftValue' in envoltura ? envoltura.draftValue : optionValues
  else if (row.value_json != null) value = row.value_json
  else if (optionValues.length > 0) value = optionValues

  return {
    id: row.id,
    fieldId: row.field_id,
    fieldKey: row.field?.key ?? null,
    occurrenceId: row.occurrence_id ?? null,
    rowIndex: row.row_index ?? null,
    value,
    optionValues,
  }
}

export function toAttachmentDto(row: any, signedUrl?: string | null) {
  return {
    id: row.id,
    clientAttachmentId: row.client_attachment_id,
    answerId: row.answer_id ?? null,
    kind: row.kind,
    status: row.status,
    mimeType: row.mime_type,
    /// `BigInt` → `number`. Los tamaños de este dominio (≤ 25 MB) caben de
    /// sobra en un entero seguro de JS, y `JSON.stringify` no sabe serializar
    /// `BigInt`: dejarlo pasar tal cual rompería la respuesta entera.
    byteSize: row.byte_size != null ? Number(row.byte_size) : null,
    sha256: row.sha256,
    originalName: row.original_name ?? null,
    metadata: json(row.metadata_json),
    createdAt: iso(row.created_at),
    uploadedAt: iso(row.uploaded_at),
    url: signedUrl ?? null,
  }
}

export function toSubmissionEventDto(row: any) {
  return {
    id: row.id,
    eventType: row.event_type,
    actorType: row.actor_type,
    actorId: row.actor_id ?? null,
    payload: json(row.payload_json),
    createdAt: iso(row.created_at)!,
  }
}

export function toSubmissionSummaryDto(row: any) {
  return {
    id: row.id,
    clientSubmissionId: row.client_submission_id,
    assignmentId: row.assignment_id,
    versionId: row.version_id,
    conductorId: row.conductor_id,
    vehicleId: row.vehicle_id ?? null,
    serviceId: row.service_id ?? null,
    supersedesSubmissionId: row.supersedes_submission_id ?? null,
    status: row.status,
    businessDate: dateOnly(row.business_date),
    periodKey: row.period_key ?? null,
    context: json(row.context_json),
    startedAt: iso(row.started_at),
    submittedAt: iso(row.submitted_at),
    updatedAt: iso(row.updated_at),
    voidedAt: iso(row.voided_at),
    voidReason: row.void_reason ?? null,
    conductor: row.conductor
      ? {
          id: row.conductor.id,
          nombre: `${row.conductor.nombre} ${row.conductor.apellido}`.trim(),
          numeroIdentificacion: row.conductor.numero_identificacion ?? null,
        }
      : null,
    vehiculo: row.vehiculo ? { id: row.vehiculo.id, placa: row.vehiculo.placa } : null,
    assignment: row.assignment ? { id: row.assignment.id, name: row.assignment.name, frequency: row.assignment.frequency } : null,
    version: row.version
      ? {
          id: row.version.id,
          formId: row.version.form_id,
          versionNumber: row.version.version_number,
          title: row.version.title,
          code: row.version.form?.code ?? null,
        }
      : null,
    attachmentCount: row._count?.attachments ?? undefined,
    answerCount: row._count?.answers ?? undefined,
  }
}

export function toSubmissionDetailDto(row: any, signedUrls: Map<string, string> = new Map()) {
  return {
    ...toSubmissionSummaryDto(row),
    device: json(row.device_json),
    answers: (row.answers ?? []).map(toAnswerDto),
    attachments: (row.attachments ?? []).map((a: any) => toAttachmentDto(a, signedUrls.get(a.id) ?? null)),
    events: (row.events ?? []).map(toSubmissionEventDto),
  }
}

export const mapperInternals = { iso, dateOnly, json, decimal, bySortOrder }
