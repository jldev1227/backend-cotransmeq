import { z } from 'zod'
import {
  ASSIGNMENT_FREQUENCIES,
  sanitizeJson,
  sanitizeText,
  ATTACHMENT_KINDS,
  DEFINITION_LIMITS,
  FIELD_TYPES,
  LIMIT_POLICIES,
  RULE_ACTIONS,
  RULE_OPERATORS,
  SUBMISSION_LIMITS,
  SUBMISSION_STATUSES,
  TARGET_TYPES,
} from './domain'

/**
 * Validación de entrada del módulo de formularios dinámicos.
 *
 * Zod aquí hace **una sola cosa**: comprobar que el payload tiene la FORMA
 * esperada (tipos, enums, longitudes, UUIDs). La coherencia del formulario
 * —claves únicas, ciclos de reglas, opciones que existen— la decide
 * `validateFormDefinition` en `domain/`, no este archivo.
 *
 * Están separados a propósito: el validador de dominio produce una lista de
 * issues con severidad y ruta, que es lo que el builder necesita para pintar
 * warnings sin bloquear. Un `ZodError` solo sabe decir "inválido", así que
 * mezclarlos convertiría todos los warnings en errores 400.
 */

// ─── Piezas reutilizables ────────────────────────────────────────────────────

const uuid = z.string().uuid()

/**
 * Texto de una sola línea, saneado.
 *
 * `transform` y no `refine`: el objetivo no es rechazar el texto sucio sino
 * limpiarlo. Un título con un espacio de ancho cero pegado desde un PDF debe
 * guardarse limpio, no hacer fallar el guardado del borrador.
 *
 * El `min(1)` va DESPUÉS del transform: un título que solo tenía caracteres
 * invisibles queda vacío al sanear, y ahí sí hay que rechazarlo.
 */
const textoLinea = (max: number) =>
  z
    .string()
    .max(max * 2)
    .transform((v) => sanitizeText(v, { singleLine: true, maxLength: max }))
    .pipe(z.string().min(1).max(max))

/** Texto multilínea saneado. Admite vacío y `null`. */
const textoLargo = (max: number) =>
  z
    .string()
    .max(max * 2)
    .transform((v) => sanitizeText(v, { maxLength: max }))

/** JSON de configuración saneado en profundidad. */
const jsonSaneado = z.record(z.unknown()).transform((v) => sanitizeJson(v) as Record<string, unknown>)

/// `.passthrough()` en los JSONB de configuración: la definición guarda
/// propiedades que el backend no interpreta (colores, hints del builder) y
/// recortarlas silenciosamente las perdería en cada autosave.
const jsonObject = jsonSaneado

const key = z
  .string()
  .min(1)
  .max(DEFINITION_LIMITS.maxKeyLength)

const sortOrder = z.number().int().min(0).max(1_000_000)

export const ruleConditionSchema = z.object({
  fieldKey: key,
  operator: z.enum(RULE_OPERATORS),
  value: z.unknown().optional(),
})

export const ruleSchema = z.object({
  version: z.literal(1),
  all: z.array(ruleConditionSchema).max(DEFINITION_LIMITS.maxConditionsPerRule).optional(),
  any: z.array(ruleConditionSchema).max(DEFINITION_LIMITS.maxConditionsPerRule).optional(),
  effect: z.object({
    action: z.enum(RULE_ACTIONS),
    targetFieldKey: key.optional(),
  }),
})

export const optionSchema = z.object({
  id: uuid.optional(),
  value: textoLinea(DEFINITION_LIMITS.maxOptionValueLength),
  label: textoLinea(DEFINITION_LIMITS.maxOptionLabelLength),
  color: z.string().max(20).nullish(),
  score: z.number().finite().nullish(),
  sortOrder,
  metadata: jsonObject.optional(),
})

/**
 * Campo del árbol.
 *
 * `children` es recursivo pero acotado a UN nivel con dos schemas en vez de un
 * `z.lazy` infinito: el esquema solo tiene una columna `occurrence_id`, así que
 * un tercer nivel no se podría almacenar y aceptarlo en la entrada solo
 * retrasaría el error hasta el `INSERT`.
 */
const baseFieldShape = {
  id: uuid.optional(),
  key,
  type: z.enum(FIELD_TYPES),
  label: textoLinea(DEFINITION_LIMITS.maxLabelLength),
  helpText: textoLargo(4000).nullish(),
  placeholder: textoLinea(500).nullish(),
  required: z.boolean().optional(),
  sortOrder,
  config: jsonObject.optional(),
  validation: jsonObject.optional(),
  visibilityRule: ruleSchema.nullish(),
  defaultValue: z.unknown().optional(),
  options: z.array(optionSchema).max(DEFINITION_LIMITS.maxOptionsPerField).optional(),
}

export const childFieldSchema = z.object(baseFieldShape)

export const fieldSchema = z.object({
  ...baseFieldShape,
  children: z.array(childFieldSchema).max(DEFINITION_LIMITS.maxChildrenPerContainer).optional(),
})

export const sectionSchema = z.object({
  id: uuid.optional(),
  key,
  title: textoLinea(DEFINITION_LIMITS.maxTitleLength),
  description: textoLargo(4000).nullish(),
  sortOrder,
  settings: jsonObject.optional(),
  fields: z.array(fieldSchema).max(DEFINITION_LIMITS.maxFieldsPerSection),
})

export const versionDraftSchema = z.object({
  title: textoLinea(DEFINITION_LIMITS.maxTitleLength),
  description: textoLargo(8000).nullish(),
  instructions: textoLargo(20000).nullish(),
  settings: jsonObject.optional(),
  sections: z.array(sectionSchema).max(DEFINITION_LIMITS.maxSections),
})

// ─── Catálogo ────────────────────────────────────────────────────────────────

/// El código HSEQ se normaliza a mayúsculas antes de comparar: `hseq-fr-08` y
/// `HSEQ-FR-08` son el mismo documento y `uq_form_definitions_code` es
/// sensible a mayúsculas.
export const formCodeSchema = z
  .string()
  .min(2)
  .max(50)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'Solo letras, números, ".", "_" y "-".')
  .transform((v) => v.toUpperCase())

export const slugSchema = z
  .string()
  .min(2)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Solo minúsculas, números y guiones.')

export const crearFormularioSchema = z.object({
  code: formCodeSchema,
  /// Opcional: si no viene se deriva del nombre. Pedirlo siempre obligaría al
  /// builder a implementar la misma normalización.
  slug: slugSchema.optional(),
  name: textoLinea(255),
  description: textoLargo(8000).nullish(),
  ownerArea: textoLinea(80).optional(),
  /// Título de la versión 1. Por defecto el nombre del formulario.
  versionTitle: textoLinea(255).optional(),
})

export const actualizarFormularioSchema = z
  .object({
    code: formCodeSchema.optional(),
    slug: slugSchema.optional(),
    name: z.string().min(1).max(255).optional(),
    description: z.string().max(8000).nullish(),
    ownerArea: z.string().max(80).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nada que actualizar.' })

export const guardarVersionSchema = versionDraftSchema.extend({
  /// Revisión que el builder cree vigente. Si no coincide con la de la base se
  /// responde 409 REVISION_CONFLICT en vez de sobrescribir el trabajo de otra
  /// pestaña.
  revision: z.number().int().min(1),
  clientMutationId: uuid.optional(),
})

export const duplicarFormularioSchema = z.object({
  code: formCodeSchema,
  slug: slugSchema.optional(),
  name: z.string().min(1).max(255),
})

// ─── Plantillas de cards ─────────────────────────────────────────────────────

export const plantillaSchema = z.object({
  name: z.string().min(1).max(255),
  category: z.string().min(1).max(100),
  fieldType: z.enum(FIELD_TYPES),
  /// Snapshot del campo tal como se insertará. Se valida como campo completo
  /// para que una plantilla rota se detecte al guardarla y no al usarla.
  template: fieldSchema.omit({ id: true, sortOrder: true }).extend({
    sortOrder: sortOrder.optional(),
  }),
  ownerArea: z.string().max(80).nullish(),
  isGlobal: z.boolean().optional(),
})

export const actualizarPlantillaSchema = plantillaSchema.partial().refine(
  (v) => Object.keys(v).length > 0,
  { message: 'Nada que actualizar.' },
)

// ─── Asignaciones ────────────────────────────────────────────────────────────

/** Columnas de valor de un target. El orden no importa; la exhaustividad sí. */
const CAMPOS_TARGET = ['conductorId', 'vehicleId', 'sede', 'groupKey', 'usuarioId', 'area', 'cargo'] as const
type CampoTarget = (typeof CAMPOS_TARGET)[number]

/**
 * Qué columna necesita cada tipo de target. `null` = ninguna (los dos «todos»).
 *
 * Es el espejo EXACTO de `ck_form_assignment_targets_value`. Si aquí y en la
 * migración no coinciden, Zod deja pasar algo que Postgres rechaza con un error
 * de constraint ilegible, o al revés: la API rechaza algo que la base admitiría.
 */
const CAMPO_POR_TIPO: Record<string, CampoTarget | null> = {
  ALL_CONDUCTORS: null,
  CONDUCTOR: 'conductorId',
  VEHICLE: 'vehicleId',
  SEDE: 'sede',
  GROUP: 'groupKey',
  ALL_USERS: null,
  USER: 'usuarioId',
  AREA: 'area',
  CARGO: 'cargo',
}

export const targetSchema = z
  .object({
    type: z.enum(TARGET_TYPES),
    conductorId: uuid.nullish(),
    vehicleId: uuid.nullish(),
    sede: z.string().min(1).max(80).nullish(),
    groupKey: z.string().min(1).max(120).nullish(),
    usuarioId: uuid.nullish(),
    /// El valor concreto se valida contra `AREAS` en el servicio, no aquí: el
    /// schema no debe importar la config de permisos para no acoplar las capas.
    area: z.string().min(1).max(40).nullish(),
    cargo: z.string().min(1).max(255).nullish(),
  })
  .superRefine((t, ctx) => {
    /// Se comprueba aquí además de en la base para devolver un 400 con el campo
    /// señalado, en vez del error genérico de constraint de Postgres.
    const needed = CAMPO_POR_TIPO[t.type]
    for (const campo of CAMPOS_TARGET) {
      const valor = t[campo]
      if (campo === needed) {
        if (valor == null) {
          ctx.addIssue({ code: 'custom', path: [campo], message: `Un target ${t.type} necesita ${campo}.` })
        }
      } else if (valor != null) {
        ctx.addIssue({ code: 'custom', path: [campo], message: `Un target ${t.type} no lleva ${campo}.` })
      }
    }
  })

const contextSchemaSchema = z.record(z.object({ required: z.boolean().optional() }))

export const crearAsignacionSchema = z
  .object({
    versionId: uuid,
    name: z.string().min(1).max(255),
    frequency: z.enum(ASSIGNMENT_FREQUENCIES),
    limitPolicy: z.enum(LIMIT_POLICIES),
    timezone: z.string().min(1).max(64).optional(),
    startsAt: z.string().datetime().nullish(),
    endsAt: z.string().datetime().nullish(),
    targets: z.array(targetSchema).min(1).max(500),
    contextSchema: contextSchemaSchema.optional(),
    settings: jsonObject.optional(),
  })
  .refine((v) => !v.startsAt || !v.endsAt || new Date(v.endsAt) > new Date(v.startsAt), {
    message: 'La fecha de fin debe ser posterior a la de inicio.',
    path: ['endsAt'],
  })

export const actualizarAsignacionSchema = crearAsignacionSchema
  .innerType()
  .omit({ versionId: true })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nada que actualizar.' })
  .refine((v) => !v.startsAt || !v.endsAt || new Date(v.endsAt) > new Date(v.startsAt), {
    message: 'La fecha de fin debe ser posterior a la de inicio.',
    path: ['endsAt'],
  })

// ─── Listados ────────────────────────────────────────────────────────────────

/// `limit` tope 100 por el contrato REST; el default es 20 porque el catálogo
/// del dashboard cabe en una pantalla.
export const paginacionSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(200).optional(),
})

export const listarFormulariosSchema = paginacionSchema.extend({
  ownerArea: z.string().max(80).optional(),
  /// `true` incluye los borrados lógicos; el catálogo normal los oculta.
  includeDeleted: z.coerce.boolean().optional(),
})

export const listarAsignacionesSchema = paginacionSchema.extend({
  formId: uuid.optional(),
  versionId: uuid.optional(),
  status: z.enum(['ACTIVE', 'PAUSED', 'CLOSED']).optional(),
})

const fechaSimple = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato YYYY-MM-DD.')

export const listarEnviosSchema = paginacionSchema.extend({
  formId: uuid.optional(),
  versionId: uuid.optional(),
  assignmentId: uuid.optional(),
  conductorId: uuid.optional(),
  /// Filtra por el usuario interno que diligenció. Es el espejo de
  /// `conductorId`: desde que una asignación puede apuntar a las dos
  /// poblaciones, filtrar solo por conductor deja fuera media lista.
  usuarioId: uuid.optional(),
  vehicleId: uuid.optional(),
  status: z.enum(SUBMISSION_STATUSES).optional(),
  businessDateFrom: fechaSimple.optional(),
  businessDateTo: fechaSimple.optional(),
})

export const anularEnvioSchema = z.object({
  /// Motivo obligatorio y con longitud mínima real: `VOIDED` es la única
  /// operación que invalida un registro firmado, y "error" no es una
  /// justificación auditable. El `min(10)` se comprueba DESPUÉS de sanear.
  reason: textoLargo(2000).pipe(z.string().min(10)),
})

// ─── Portal del conductor ────────────────────────────────────────────────────

export const answerInputSchema = z.object({
  fieldId: uuid,
  occurrenceId: uuid.nullish(),
  rowIndex: z.number().int().min(0).max(SUBMISSION_LIMITS.maxOccurrencesPerContainer).nullish(),
  value: z.unknown().optional(),
  optionValues: z.array(z.string().min(1).max(DEFINITION_LIMITS.maxOptionValueLength)).max(300).optional(),
})

export const attachmentInputSchema = z.object({
  clientAttachmentId: uuid,
  fieldId: uuid,
  occurrenceId: uuid.nullish(),
  kind: z.enum(ATTACHMENT_KINDS),
  mimeType: z.string().min(3).max(150),
  byteSize: z.number().int().positive(),
  /// Hexadecimal de 64 caracteres. Se compara contra el objeto subido a S3.
  sha256: z.string().regex(/^[0-9a-f]{64}$/, 'sha256 en hexadecimal minúscula.'),
  originalName: z.string().max(255).nullish(),
  metadata: jsonObject.optional(),
})

export const enviarSubmissionSchema = z.object({
  clientSubmissionId: uuid,
  assignmentId: uuid,
  versionId: uuid,
  context: jsonObject.optional(),
  startedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
  answers: z.array(answerInputSchema).max(SUBMISSION_LIMITS.maxAnswersPerSubmission),
  attachments: z.array(attachmentInputSchema).max(SUBMISSION_LIMITS.maxAttachmentsPerSubmission).optional(),
  device: z
    .object({
      installationId: uuid.optional(),
      appVersion: z.string().max(40).optional(),
      offlineCreated: z.boolean().optional(),
      platform: z.string().max(60).optional(),
    })
    .optional(),
})

/**
 * Backup de borrador.
 *
 * Sin adjuntos binarios a propósito: el borrador va al servidor solo para no
 * perder el texto si el teléfono se pierde, y subir las fotos en cada autosave
 * consumiría los datos del conductor sin que nadie las haya pedido todavía.
 */
export const backupDraftSchema = z.object({
  assignmentId: uuid,
  versionId: uuid,
  context: jsonObject.optional(),
  answers: z.array(answerInputSchema).max(SUBMISSION_LIMITS.maxAnswersPerSubmission),
  progress: z.number().int().min(0).max(100).optional(),
  updatedAt: z.string().datetime().optional(),
  device: z.record(z.unknown()).optional(),
})

export const initAttachmentSchema = z.object({
  clientSubmissionId: uuid,
  clientAttachmentId: uuid,
  fieldId: uuid,
  occurrenceId: uuid.nullish(),
  kind: z.enum(ATTACHMENT_KINDS),
  mimeType: z.string().min(3).max(150),
  byteSize: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  originalName: z.string().max(255).nullish(),
})

export const completeAttachmentSchema = z.object({
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  byteSize: z.number().int().positive().optional(),
})

export const listarEnviosPortalSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  assignmentId: uuid.optional(),
})

// ─── Tipos inferidos ─────────────────────────────────────────────────────────

export type CrearFormularioInput = z.infer<typeof crearFormularioSchema>
export type ActualizarFormularioInput = z.infer<typeof actualizarFormularioSchema>
export type GuardarVersionInput = z.infer<typeof guardarVersionSchema>
export type DuplicarFormularioInput = z.infer<typeof duplicarFormularioSchema>
export type PlantillaInput = z.infer<typeof plantillaSchema>
export type ActualizarPlantillaInput = z.infer<typeof actualizarPlantillaSchema>
export type CrearAsignacionInput = z.infer<typeof crearAsignacionSchema>
export type ActualizarAsignacionInput = z.infer<typeof actualizarAsignacionSchema>
export type ListarFormulariosQuery = z.infer<typeof listarFormulariosSchema>
export type ListarAsignacionesQuery = z.infer<typeof listarAsignacionesSchema>
export type ListarEnviosQuery = z.infer<typeof listarEnviosSchema>
export type AnularEnvioInput = z.infer<typeof anularEnvioSchema>
export type EnviarSubmissionInput = z.infer<typeof enviarSubmissionSchema>
export type BackupDraftInput = z.infer<typeof backupDraftSchema>
export type InitAttachmentInput = z.infer<typeof initAttachmentSchema>
export type CompleteAttachmentInput = z.infer<typeof completeAttachmentSchema>
export type ListarEnviosPortalQuery = z.infer<typeof listarEnviosPortalSchema>
