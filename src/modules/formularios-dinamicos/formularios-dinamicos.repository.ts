/**
 * Acceso a datos del catálogo de formularios.
 *
 * Aquí vive el SQL/Prisma y nada más: ninguna decisión de negocio ni de
 * autorización. El service decide y esta capa ejecuta, para que la lógica de
 * "solo un DRAFT es editable" se pueda leer en un sitio sin ir saltando entre
 * `include`s.
 */

import { randomUUID } from 'crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '../../config/prisma'
import { FormError, type FormFieldDraft, type FormVersionDraft } from './domain'

/** Cliente de Prisma o el cliente transaccional. Todo aquí acepta los dos. */
export type Db = Prisma.TransactionClient | typeof prisma

/**
 * Valor para una columna `Json?`.
 *
 * Prisma NO acepta `null` en un campo Json nullable: lanza en tiempo de
 * ejecución y obliga a elegir entre `Prisma.DbNull` (NULL de SQL) y
 * `Prisma.JsonNull` (el literal JSON `null`). Aquí siempre se quiere NULL de
 * SQL: un campo sin regla de visibilidad no tiene regla, no tiene una regla
 * cuyo valor sea `null`.
 */
function jsonOrDbNull(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value === null || value === undefined ? Prisma.DbNull : (value as Prisma.InputJsonValue)
}

export const versionSummarySelect = {
  id: true,
  form_id: true,
  version_number: true,
  status: true,
  title: true,
  revision: true,
  created_at: true,
  updated_at: true,
  published_at: true,
  archived_at: true,
} satisfies Prisma.form_versionSelect

/**
 * Carga la versión con secciones y campos.
 *
 * Los campos se piden PLANOS (todos los de la versión, con `parent_field_id`) y
 * el árbol se arma en el mapper. Con `include` anidado Prisma necesitaría un
 * nivel de `include` por nivel de anidación y una consulta extra por cada
 * contenedor; así son dos consultas fijas.
 */
export async function findVersionAggregate(db: Db, versionId: string) {
  const version = await db.form_version.findUnique({
    where: { id: versionId },
    include: {
      form: { select: { id: true, code: true, slug: true, name: true, deleted_at: true } },
      sections: { orderBy: { sort_order: 'asc' } },
      fields: {
        orderBy: { sort_order: 'asc' },
        include: { options: { orderBy: { sort_order: 'asc' } } },
      },
    },
  })
  return version
}

export async function findFormWithVersions(db: Db, formId: string) {
  return db.form_definition.findUnique({
    where: { id: formId },
    include: {
      versions: { select: versionSummarySelect, orderBy: { version_number: 'desc' } },
    },
  })
}

export async function nextVersionNumber(db: Db, formId: string): Promise<number> {
  const last = await db.form_version.findFirst({
    where: { form_id: formId },
    orderBy: { version_number: 'desc' },
    select: { version_number: true },
  })
  return (last?.version_number ?? 0) + 1
}

/** Asignaciones que impiden borrar/archivar. */
export async function countActiveAssignments(db: Db, where: { formId?: string; versionId?: string }) {
  return db.form_assignment.count({
    where: {
      deleted_at: null,
      status: { in: ['ACTIVE', 'PAUSED'] },
      ...(where.versionId ? { version_id: where.versionId } : {}),
      ...(where.formId ? { version: { form_id: where.formId } } : {}),
    },
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Escritura del agregado draft
// ─────────────────────────────────────────────────────────────────────────────

interface ResolvedField {
  id: string
  key: string
  sectionId: string
  parentFieldId: string | null
  depth: number
  draft: FormFieldDraft
}

interface ResolvedPlan {
  sections: { id: string; draft: FormVersionDraft['sections'][number] }[]
  fields: ResolvedField[]
  options: { id: string; fieldId: string; draft: NonNullable<FormFieldDraft['options']>[number] }[]
}

/**
 * Asigna un id a cada nodo del árbol y comprueba pertenencia.
 *
 * Un id que llega en el payload y NO pertenece a esta versión se rechaza en vez
 * de crearse: aceptarlo movería un nodo de otra versión —posiblemente
 * publicada— a este borrador.
 */
function resolvePlan(
  draft: FormVersionDraft,
  existing: { sections: Set<string>; fields: Set<string>; options: Set<string> },
): ResolvedPlan {
  const plan: ResolvedPlan = { sections: [], fields: [], options: [] }

  const claim = (id: string | undefined, pool: Set<string>, kind: string): string => {
    if (!id) return randomUUID()
    if (!pool.has(id)) {
      throw new FormError(
        'FORM_DEFINITION_INVALID',
        `El ${kind} ${id} no pertenece a esta versión.`,
        { id, kind },
      )
    }
    return id
  }

  for (const section of draft.sections) {
    const sectionId = claim(section.id, existing.sections, 'sección')
    plan.sections.push({ id: sectionId, draft: section })

    const walk = (fields: FormFieldDraft[], parentFieldId: string | null, depth: number) => {
      for (const field of fields) {
        const fieldId = claim(field.id, existing.fields, 'campo')
        plan.fields.push({ id: fieldId, key: field.key, sectionId, parentFieldId, depth, draft: field })

        for (const option of field.options ?? []) {
          plan.options.push({ id: claim(option.id, existing.options, 'opción'), fieldId, draft: option })
        }
        if (field.children?.length) walk(field.children, fieldId, depth + 1)
      }
    }
    walk(section.fields, null, 0)
  }

  return plan
}

/**
 * Desplaza claves y órdenes de los nodos existentes a valores temporales
 * únicos, ANTES de escribir los definitivos.
 *
 * Sin este paso, dos operaciones normales del builder fallan a mitad de la
 * transacción:
 *
 *   - reordenar dos cards intercambia sus `sort_order`, y el primer UPDATE
 *     choca con el valor que la otra todavía tiene;
 *   - borrar una card y crear otra con la misma `key` choca con
 *     `uq_form_fields_key` mientras la borrada aún existe.
 *
 * Las constraints de orden son DEFERRABLE, pero `uq_form_fields_top_order` es
 * un índice PARCIAL y en Postgres los índices no se pueden diferir. Aparcar
 * cubre los dos casos sin depender de eso.
 *
 * Los valores temporales son negativos y derivados de `row_number()`, así que
 * son únicos dentro de la versión por construcción.
 */
async function parkExisting(db: Db, versionId: string): Promise<void> {
  await db.$executeRaw`
    UPDATE form_sections s
    SET sort_order = -1 - t.rn,
        key = '__park_' || t.rn
    FROM (
      SELECT id, row_number() OVER (ORDER BY id) AS rn
      FROM form_sections WHERE version_id = ${versionId}::uuid
    ) t
    WHERE s.id = t.id
  `
  await db.$executeRaw`
    UPDATE form_fields f
    SET sort_order = -1 - t.rn,
        key = '__park_' || t.rn
    FROM (
      SELECT id, row_number() OVER (ORDER BY id) AS rn
      FROM form_fields WHERE version_id = ${versionId}::uuid
    ) t
    WHERE f.id = t.id
  `
  await db.$executeRaw`
    UPDATE form_field_options o
    SET sort_order = -1 - t.rn,
        value = '__park_' || t.rn
    FROM (
      SELECT o2.id, row_number() OVER (ORDER BY o2.id) AS rn
      FROM form_field_options o2
      JOIN form_fields f2 ON f2.id = o2.field_id
      WHERE f2.version_id = ${versionId}::uuid
    ) t
    WHERE o.id = t.id
  `
}

/**
 * Reemplaza el árbol de una versión DRAFT dentro de una transacción.
 *
 * Devuelve la `revision` nueva. El orden de las operaciones no es arbitrario:
 *
 *  1. aparcar claves/órdenes existentes;
 *  2. upsert de secciones (los campos que se mueven necesitan la sección
 *     destino ya creada);
 *  3. upsert de campos por profundidad (un hijo necesita su padre);
 *  4. upsert de opciones;
 *  5. borrar lo ausente en orden hijo → padre;
 *  6. subir `revision`.
 *
 * Borrar al final —y no al principio— es lo que permite mover un campo de una
 * sección que desaparece: cuando se borra la sección, el campo ya apunta a otra
 * y el `ON DELETE CASCADE` no se lo lleva.
 */
export async function replaceVersionAggregate(
  db: Db,
  params: {
    versionId: string
    draft: FormVersionDraft
    expectedRevision: number
    currentRevision: number
    existing: { sections: string[]; fields: string[]; options: string[] }
  },
): Promise<number> {
  const existing = {
    sections: new Set(params.existing.sections),
    fields: new Set(params.existing.fields),
    options: new Set(params.existing.options),
  }
  const plan = resolvePlan(params.draft, existing)

  await parkExisting(db, params.versionId)

  // 2. Secciones
  for (const [index, { id, draft }] of plan.sections.entries()) {
    const data = {
      key: draft.key,
      title: draft.title,
      description: draft.description ?? null,
      /// El `sort_order` que manda es la POSICIÓN en el array, no el número que
      /// venga en el payload: el builder puede enviar 100/100 tras un drag y la
      /// posición es la única fuente fiable del orden que el usuario vio.
      sort_order: (index + 1) * 100,
      settings_json: (draft.settings ?? {}) as Prisma.InputJsonValue,
    }
    if (existing.sections.has(id)) {
      await db.form_section.update({ where: { id }, data })
    } else {
      await db.form_section.create({ data: { id, version_id: params.versionId, ...data } })
    }
  }

  // 3. Campos, por profundidad
  const byDepth = new Map<number, ResolvedField[]>()
  for (const field of plan.fields) {
    const list = byDepth.get(field.depth) ?? []
    list.push(field)
    byDepth.set(field.depth, list)
  }
  const siblingCounter = new Map<string, number>()

  for (const depth of [...byDepth.keys()].sort((a, b) => a - b)) {
    for (const field of byDepth.get(depth)!) {
      /// Contador por colección de hermanos: el orden es único por
      /// `(section_id, parent_field_id)`, así que cada grupo empieza en 100.
      const bucket = `${field.sectionId}|${field.parentFieldId ?? 'root'}`
      const position = (siblingCounter.get(bucket) ?? 0) + 1
      siblingCounter.set(bucket, position)

      const data = {
        section_id: field.sectionId,
        parent_field_id: field.parentFieldId,
        key: field.draft.key,
        type: field.draft.type,
        label: field.draft.label,
        help_text: field.draft.helpText ?? null,
        placeholder: field.draft.placeholder ?? null,
        required: field.draft.required ?? false,
        sort_order: position * 100,
        config_json: (field.draft.config ?? {}) as Prisma.InputJsonValue,
        validation_json: (field.draft.validation ?? {}) as Prisma.InputJsonValue,
        visibility_rule_json: jsonOrDbNull(field.draft.visibilityRule),
        default_value_json: jsonOrDbNull(field.draft.defaultValue),
      }
      if (existing.fields.has(field.id)) {
        await db.form_field.update({ where: { id: field.id }, data })
      } else {
        await db.form_field.create({ data: { id: field.id, version_id: params.versionId, ...data } })
      }
    }
  }

  // 4. Opciones
  const optionCounter = new Map<string, number>()
  for (const option of plan.options) {
    const position = (optionCounter.get(option.fieldId) ?? 0) + 1
    optionCounter.set(option.fieldId, position)

    const data = {
      value: option.draft.value,
      label: option.draft.label,
      color: option.draft.color ?? null,
      score: option.draft.score ?? null,
      sort_order: position * 100,
      metadata_json: (option.draft.metadata ?? {}) as Prisma.InputJsonValue,
    }
    if (existing.options.has(option.id)) {
      await db.form_field_option.update({ where: { id: option.id }, data })
    } else {
      await db.form_field_option.create({ data: { id: option.id, field_id: option.fieldId, ...data } })
    }
  }

  // 5. Borrar lo ausente, hijo → padre
  const keepOptions = new Set(plan.options.map((o) => o.id))
  const keepFields = new Set(plan.fields.map((f) => f.id))
  const keepSections = new Set(plan.sections.map((s) => s.id))

  const dropOptions = [...existing.options].filter((id) => !keepOptions.has(id))
  if (dropOptions.length) await db.form_field_option.deleteMany({ where: { id: { in: dropOptions } } })

  const dropFields = [...existing.fields].filter((id) => !keepFields.has(id))
  if (dropFields.length) await db.form_field.deleteMany({ where: { id: { in: dropFields } } })

  const dropSections = [...existing.sections].filter((id) => !keepSections.has(id))
  if (dropSections.length) await db.form_section.deleteMany({ where: { id: { in: dropSections } } })

  // 6. Cabecera y revisión
  const nextRevision = params.currentRevision + 1
  await db.form_version.update({
    where: { id: params.versionId },
    data: {
      title: params.draft.title,
      description: params.draft.description ?? null,
      instructions: params.draft.instructions ?? null,
      settings_json: (params.draft.settings ?? {}) as Prisma.InputJsonValue,
      revision: nextRevision,
    },
  })

  return nextRevision
}

/**
 * Copia el árbol de una versión a otra (clone / duplicate).
 *
 * Se copia nodo a nodo generando ids nuevos en vez de un `INSERT ... SELECT`
 * porque hay que reasignar `parent_field_id` a los ids nuevos; con SQL plano
 * haría falta una tabla temporal de correspondencias.
 */
export async function copyVersionTree(
  db: Db,
  params: { sourceVersionId: string; targetVersionId: string },
): Promise<void> {
  const sections = await db.form_section.findMany({
    where: { version_id: params.sourceVersionId },
    orderBy: { sort_order: 'asc' },
  })
  const fields = await db.form_field.findMany({
    where: { version_id: params.sourceVersionId },
    orderBy: { sort_order: 'asc' },
    include: { options: { orderBy: { sort_order: 'asc' } } },
  })

  const sectionIdMap = new Map<string, string>()
  for (const section of sections) {
    const id = randomUUID()
    sectionIdMap.set(section.id, id)
    await db.form_section.create({
      data: {
        id,
        version_id: params.targetVersionId,
        key: section.key,
        title: section.title,
        description: section.description,
        sort_order: section.sort_order,
        settings_json: section.settings_json as Prisma.InputJsonValue,
      },
    })
  }

  /// Padres antes que hijos: `parent_field_id` es una FK a esta misma tabla.
  const fieldIdMap = new Map<string, string>()
  const ordered = [...fields].sort(
    (a, b) => Number(a.parent_field_id != null) - Number(b.parent_field_id != null),
  )

  for (const field of ordered) {
    const id = randomUUID()
    fieldIdMap.set(field.id, id)
    await db.form_field.create({
      data: {
        id,
        version_id: params.targetVersionId,
        section_id: sectionIdMap.get(field.section_id)!,
        parent_field_id: field.parent_field_id ? fieldIdMap.get(field.parent_field_id)! : null,
        key: field.key,
        type: field.type,
        label: field.label,
        help_text: field.help_text,
        placeholder: field.placeholder,
        required: field.required,
        sort_order: field.sort_order,
        config_json: field.config_json as Prisma.InputJsonValue,
        validation_json: field.validation_json as Prisma.InputJsonValue,
        visibility_rule_json: jsonOrDbNull(field.visibility_rule_json),
        default_value_json: jsonOrDbNull(field.default_value_json),
      },
    })

    for (const option of field.options) {
      await db.form_field_option.create({
        data: {
          id: randomUUID(),
          field_id: id,
          value: option.value,
          label: option.label,
          color: option.color,
          score: option.score,
          sort_order: option.sort_order,
          metadata_json: option.metadata_json as Prisma.InputJsonValue,
        },
      })
    }
  }
}
