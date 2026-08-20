/**
 * Catálogo, versiones y plantillas.
 *
 * Reglas que se sostienen aquí y no en la base, porque cruzan varias tablas:
 *
 *  - solo una versión `DRAFT` acepta escritura;
 *  - publicar valida el árbol completo y congela la versión;
 *  - "editar" una versión publicada es clonarla, no mutarla;
 *  - borrar un formulario es lógico y solo si no tiene asignaciones vivas.
 *
 * Ninguna función de este archivo emite eventos de socket: los eventos se
 * emiten en el controller, DESPUÉS de que la transacción haya hecho commit.
 * Emitir aquí avisaría a los clientes de un cambio que un rollback puede
 * deshacer.
 */

import { randomUUID } from 'crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '../../config/prisma'
import {
  FormError,
  validateFormDefinition,
  type DefinitionValidationResult,
  type FormVersionDraft,
} from './domain'
import {
  copyVersionTree,
  countActiveAssignments,
  findFormWithVersions,
  findVersionAggregate,
  nextVersionNumber,
  replaceVersionAggregate,
  versionSummarySelect,
} from './formularios-dinamicos.repository'
import {
  toDefinitionDto,
  toTemplateDto,
  toVersionDto,
  type FormDefinitionDto,
  type FormVersionDto,
} from './formularios-dinamicos.mapper'
import type {
  ActualizarFormularioInput,
  ActualizarPlantillaInput,
  CrearFormularioInput,
  DuplicarFormularioInput,
  GuardarVersionInput,
  ListarFormulariosQuery,
  PlantillaInput,
} from './formularios-dinamicos.schema'

/** Actor de una operación administrativa. Siempre derivado del JWT. */
export interface AdminActor {
  id: string
  nombre?: string
}

function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)
}

// ─────────────────────────────────────────────────────────────────────────────
// Catálogo
// ─────────────────────────────────────────────────────────────────────────────

export async function listarFormularios(query: ListarFormulariosQuery) {
  const where: Prisma.form_definitionWhereInput = {
    ...(query.includeDeleted ? {} : { deleted_at: null }),
    ...(query.ownerArea ? { owner_area: query.ownerArea } : {}),
    ...(query.search
      ? {
          OR: [
            { code: { contains: query.search, mode: 'insensitive' } },
            { name: { contains: query.search, mode: 'insensitive' } },
            { description: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  }

  const [total, rows] = await Promise.all([
    prisma.form_definition.count({ where }),
    prisma.form_definition.findMany({
      where,
      orderBy: { updated_at: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      include: { versions: { select: versionSummarySelect, orderBy: { version_number: 'desc' } } },
    }),
  ])

  /// Los conteos se piden agrupados y no con `_count` por fila: `_count` sobre
  /// una relación de dos saltos (formulario → versiones → asignaciones) no
  /// existe en Prisma, y hacerlo por fila serían 2N consultas.
  const formIds = rows.map((r) => r.id)
  const [asignaciones, envios] = await Promise.all([
    formIds.length
      ? prisma.form_assignment.groupBy({
          by: ['version_id'],
          where: { deleted_at: null, version: { form_id: { in: formIds } } },
          _count: { _all: true },
        })
      : [],
    formIds.length
      ? prisma.form_submission.groupBy({
          by: ['version_id'],
          where: { status: 'SUBMITTED', version: { form_id: { in: formIds } } },
          _count: { _all: true },
        })
      : [],
  ])

  const versionToForm = new Map<string, string>()
  for (const row of rows) for (const v of row.versions) versionToForm.set(v.id, row.id)

  const acumular = (grupos: { version_id: string; _count: { _all: number } }[]) => {
    const total = new Map<string, number>()
    for (const g of grupos) {
      const formId = versionToForm.get(g.version_id)
      if (!formId) continue
      total.set(formId, (total.get(formId) ?? 0) + g._count._all)
    }
    return total
  }
  const asignacionesPorForm = acumular(asignaciones as any)
  const enviosPorForm = acumular(envios as any)

  const data: FormDefinitionDto[] = rows.map((row) =>
    toDefinitionDto({
      ...row,
      _counts: {
        assignments: asignacionesPorForm.get(row.id) ?? 0,
        submissions: enviosPorForm.get(row.id) ?? 0,
      },
    }),
  )

  return {
    data,
    meta: { total, page: query.page, limit: query.limit, totalPages: Math.ceil(total / query.limit) || 1 },
  }
}

export async function obtenerFormulario(formId: string): Promise<FormDefinitionDto> {
  const row = await findFormWithVersions(prisma, formId)
  if (!row) throw new FormError('FORM_NOT_FOUND', 'El formulario no existe.')
  return toDefinitionDto(row)
}

/**
 * Crea el formulario lógico y su versión 1 en `DRAFT`.
 *
 * Los dos en la misma transacción: un formulario sin ninguna versión no se
 * puede abrir en el builder y quedaría como basura en el catálogo si el segundo
 * INSERT fallara.
 */
export async function crearFormulario(input: CrearFormularioInput, actor: AdminActor) {
  const slug = input.slug ?? slugify(input.name)
  if (!slug) throw new FormError('FORM_DEFINITION_INVALID', 'No se pudo derivar un slug del nombre.')

  const choque = await prisma.form_definition.findFirst({
    where: { OR: [{ code: input.code }, { slug }] },
    select: { id: true, code: true, slug: true, deleted_at: true },
  })
  if (choque) {
    /// Se avisa incluso si el que choca está borrado lógicamente: el UNIQUE de
    /// la base no distingue, así que el INSERT fallaría igual y el usuario
    /// merece un mensaje que le diga que puede restaurarlo.
    throw new FormError(
      'FORM_CODE_TAKEN',
      choque.code === input.code
        ? `El código ${input.code} ya está en uso${choque.deleted_at ? ' (formulario archivado)' : ''}.`
        : `El slug ${slug} ya está en uso${choque.deleted_at ? ' (formulario archivado)' : ''}.`,
      { conflictingId: choque.id, deleted: choque.deleted_at != null },
    )
  }

  const formId = randomUUID()
  const versionId = randomUUID()

  await prisma.$transaction(async (tx) => {
    await tx.form_definition.create({
      data: {
        id: formId,
        code: input.code,
        slug,
        name: input.name,
        description: input.description ?? null,
        owner_area: input.ownerArea ?? 'hseq',
        created_by_id: actor.id,
        updated_by_id: actor.id,
      },
    })
    await tx.form_version.create({
      data: {
        id: versionId,
        form_id: formId,
        version_number: 1,
        status: 'DRAFT',
        title: input.versionTitle ?? input.name,
        created_by_id: actor.id,
      },
    })
  })

  return obtenerFormulario(formId)
}

export async function actualizarFormulario(
  formId: string,
  input: ActualizarFormularioInput,
  actor: AdminActor,
) {
  const actual = await prisma.form_definition.findUnique({ where: { id: formId } })
  if (!actual) throw new FormError('FORM_NOT_FOUND', 'El formulario no existe.')

  if (input.code || input.slug) {
    const choque = await prisma.form_definition.findFirst({
      where: {
        id: { not: formId },
        OR: [...(input.code ? [{ code: input.code }] : []), ...(input.slug ? [{ slug: input.slug }] : [])],
      },
      select: { id: true },
    })
    if (choque) throw new FormError('FORM_CODE_TAKEN', 'Ese código o slug ya está en uso.')
  }

  await prisma.form_definition.update({
    where: { id: formId },
    data: {
      ...(input.code ? { code: input.code } : {}),
      ...(input.slug ? { slug: input.slug } : {}),
      ...(input.name ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description ?? null } : {}),
      ...(input.ownerArea ? { owner_area: input.ownerArea } : {}),
      updated_by_id: actor.id,
    },
  })

  return obtenerFormulario(formId)
}

/**
 * Borrado lógico.
 *
 * Se niega si quedan asignaciones vivas: borrar el formulario dejaría a los
 * conductores con una tarjeta que apunta a algo que ya no se puede consultar,
 * y los envíos históricos sin cabecera legible. Primero se cierran las
 * asignaciones, después se borra.
 */
export async function eliminarFormulario(formId: string, actor: AdminActor) {
  const form = await prisma.form_definition.findUnique({ where: { id: formId }, select: { id: true, deleted_at: true } })
  if (!form) throw new FormError('FORM_NOT_FOUND', 'El formulario no existe.')
  if (form.deleted_at) return { id: formId, deletedAt: form.deleted_at.toISOString() }

  const vivas = await countActiveAssignments(prisma, { formId })
  if (vivas > 0) {
    throw new FormError(
      'FORM_HAS_ACTIVE_ASSIGNMENTS',
      `Hay ${vivas} asignación(es) sin cerrar. Ciérralas antes de archivar el formulario.`,
      { activeAssignments: vivas },
    )
  }

  const updated = await prisma.form_definition.update({
    where: { id: formId },
    data: { deleted_at: new Date(), updated_by_id: actor.id },
  })
  return { id: formId, deletedAt: updated.deleted_at!.toISOString() }
}

export async function restaurarFormulario(formId: string, actor: AdminActor) {
  const form = await prisma.form_definition.findUnique({ where: { id: formId }, select: { id: true } })
  if (!form) throw new FormError('FORM_NOT_FOUND', 'El formulario no existe.')
  await prisma.form_definition.update({
    where: { id: formId },
    data: { deleted_at: null, updated_by_id: actor.id },
  })
  return obtenerFormulario(formId)
}

// ─────────────────────────────────────────────────────────────────────────────
// Versiones
// ─────────────────────────────────────────────────────────────────────────────

async function cargarVersion(formId: string, versionId: string) {
  const version = await findVersionAggregate(prisma, versionId)
  if (!version || version.form_id !== formId) {
    throw new FormError('VERSION_NOT_FOUND', 'La versión no existe en este formulario.')
  }
  return version
}

export async function obtenerVersion(formId: string, versionId: string): Promise<FormVersionDto> {
  return toVersionDto(await cargarVersion(formId, versionId))
}

/** Árbol de la versión en la forma que consume el validador. */
function versionToDraft(version: Awaited<ReturnType<typeof findVersionAggregate>>): FormVersionDraft {
  return toVersionDto(version) as unknown as FormVersionDraft
}

export async function validarVersion(
  formId: string,
  versionId: string,
  mode: 'draft' | 'publish' = 'publish',
): Promise<DefinitionValidationResult> {
  const version = await cargarVersion(formId, versionId)
  return validateFormDefinition(versionToDraft(version), { mode })
}

/**
 * Reemplaza el árbol del borrador.
 *
 * Concurrencia optimista por `revision`, no por `updated_at`: dos autosaves en
 * el mismo milisegundo son indistinguibles por marca de tiempo, y el builder ya
 * conoce su `revision` porque el guardado anterior se la devolvió.
 */
export async function guardarVersion(
  formId: string,
  versionId: string,
  input: GuardarVersionInput,
  _actor: AdminActor,
): Promise<{ version: FormVersionDto; validation: DefinitionValidationResult }> {
  const { revision, clientMutationId, ...draft } = input

  /// Se valida ANTES de abrir la transacción: no tiene sentido bloquear filas
  /// para descubrir que el payload tiene claves duplicadas.
  const validation = validateFormDefinition(draft as FormVersionDraft, { mode: 'draft' })
  if (!validation.valid) {
    throw new FormError('FORM_DEFINITION_INVALID', 'La definición tiene errores.', {
      errors: validation.errors,
      warnings: validation.warnings,
    })
  }

  await prisma.$transaction(async (tx) => {
    /// `FOR UPDATE` sobre la fila de la versión: serializa dos autosaves
    /// simultáneos del mismo borrador. Sin él, los dos leen `revision = 4`,
    /// los dos escriben 5 y el segundo pisa el primero sin conflicto aparente.
    const bloqueada = await tx.$queryRaw<{ id: string; status: string; revision: number; form_id: string }[]>`
      SELECT id, status, revision, form_id
      FROM form_versions
      WHERE id = ${versionId}::uuid
      FOR UPDATE
    `
    const version = bloqueada[0]
    if (!version || version.form_id !== formId) {
      throw new FormError('VERSION_NOT_FOUND', 'La versión no existe en este formulario.')
    }
    if (version.status !== 'DRAFT') {
      throw new FormError(
        'VERSION_IMMUTABLE',
        'Una versión publicada o archivada no se edita. Clónala para crear un borrador nuevo.',
        { status: version.status },
      )
    }
    if (version.revision !== revision) {
      throw new FormError(
        'REVISION_CONFLICT',
        'Alguien más guardó este borrador. Recarga para ver los cambios o duplica la versión.',
        { expected: revision, actual: version.revision },
      )
    }

    const [sections, fields, options] = await Promise.all([
      tx.form_section.findMany({ where: { version_id: versionId }, select: { id: true } }),
      tx.form_field.findMany({ where: { version_id: versionId }, select: { id: true } }),
      tx.form_field_option.findMany({ where: { field: { version_id: versionId } }, select: { id: true } }),
    ])

    await replaceVersionAggregate(tx, {
      versionId,
      draft: draft as FormVersionDraft,
      expectedRevision: revision,
      currentRevision: version.revision,
      existing: {
        sections: sections.map((s) => s.id),
        fields: fields.map((f) => f.id),
        options: options.map((o) => o.id),
      },
    })
  })

  const recargada = await cargarVersion(formId, versionId)
  return {
    version: toVersionDto(recargada),
    /// Se revalida en modo publish para devolver los warnings que HSEQ verá al
    /// publicar; el guardado no se bloquea con ellos.
    validation: validateFormDefinition(versionToDraft(recargada), { mode: 'publish' }),
  }
}

/**
 * Clona una versión en un borrador nuevo.
 *
 * Es la ÚNICA forma de "editar" algo publicado. Conserva claves, opciones y
 * configuración —para que las reglas y los informes sigan cuadrando— pero crea
 * ids nuevos: si compartiera ids, borrar un campo del borrador rompería las
 * respuestas de la versión publicada.
 */
export async function clonarVersion(formId: string, versionId: string, actor: AdminActor) {
  const origen = await cargarVersion(formId, versionId)

  const nuevaId = randomUUID()
  await prisma.$transaction(async (tx) => {
    const numero = await nextVersionNumber(tx, formId)
    await tx.form_version.create({
      data: {
        id: nuevaId,
        form_id: formId,
        version_number: numero,
        status: 'DRAFT',
        title: origen.title,
        description: origen.description,
        instructions: origen.instructions,
        settings_json: origen.settings_json as Prisma.InputJsonValue,
        source_metadata_json: origen.source_metadata_json as Prisma.InputJsonValue,
        created_by_id: actor.id,
      },
    })
    await copyVersionTree(tx, { sourceVersionId: versionId, targetVersionId: nuevaId })
  })

  return obtenerVersion(formId, nuevaId)
}

/**
 * Publica el borrador.
 *
 * La validación se repite aquí aunque el builder ya la haya ejecutado: el
 * cliente puede estar desactualizado, puede haberse saltado la UI, y sobre todo
 * puede haber pasado tiempo desde el último guardado. Los warnings no bloquean;
 * los errores sí, y se devuelven completos para que el builder los sitúe.
 */
export async function publicarVersion(formId: string, versionId: string, actor: AdminActor) {
  const version = await cargarVersion(formId, versionId)
  if (version.status === 'PUBLISHED') {
    /// Idempotente: republicar lo ya publicado no es un error, es un reintento.
    return { version: toVersionDto(version), validation: validateFormDefinition(versionToDraft(version)), alreadyPublished: true }
  }
  if (version.status === 'ARCHIVED') {
    throw new FormError('VERSION_ARCHIVED', 'Una versión archivada no se puede publicar. Clónala.')
  }

  const validation = validateFormDefinition(versionToDraft(version), { mode: 'publish' })
  if (!validation.valid) {
    const ciclo = validation.errors.some((e) => e.code === 'RULE_CYCLE')
    throw new FormError(
      ciclo ? 'FIELD_RULE_CYCLE' : 'FORM_DEFINITION_INVALID',
      'La definición no se puede publicar.',
      { errors: validation.errors, warnings: validation.warnings },
    )
  }

  const publicada = await prisma.$transaction(async (tx) => {
    const bloqueada = await tx.$queryRaw<{ status: string }[]>`
      SELECT status FROM form_versions WHERE id = ${versionId}::uuid FOR UPDATE
    `
    if (bloqueada[0]?.status !== 'DRAFT') {
      throw new FormError('VERSION_IMMUTABLE', 'La versión ya no está en borrador.')
    }
    return tx.form_version.update({
      where: { id: versionId },
      data: { status: 'PUBLISHED', published_at: new Date(), published_by_id: actor.id },
      select: versionSummarySelect,
    })
  })

  return {
    version: { ...toVersionDto(await cargarVersion(formId, versionId)) },
    validation,
    alreadyPublished: false,
    publishedAt: publicada.published_at?.toISOString() ?? null,
  }
}

/**
 * Archiva una versión publicada.
 *
 * No borra nada y no toca los envíos: archivar solo impide asignaciones y
 * envíos nuevos. La consulta histórica sigue funcionando, que es justamente por
 * lo que el estado existe en vez de un `DELETE`.
 */
export async function archivarVersion(formId: string, versionId: string, _actor: AdminActor) {
  const version = await cargarVersion(formId, versionId)
  if (version.status === 'ARCHIVED') return toVersionDto(version)
  if (version.status !== 'PUBLISHED') {
    throw new FormError('VERSION_NOT_PUBLISHED', 'Solo se archiva una versión publicada.')
  }

  const vivas = await countActiveAssignments(prisma, { versionId })
  if (vivas > 0) {
    throw new FormError(
      'FORM_HAS_ACTIVE_ASSIGNMENTS',
      `Hay ${vivas} asignación(es) sin cerrar contra esta versión. Ciérralas o pásalas a otra versión primero.`,
      { activeAssignments: vivas },
    )
  }

  await prisma.form_version.update({
    where: { id: versionId },
    data: { status: 'ARCHIVED', archived_at: new Date() },
  })
  return obtenerVersion(formId, versionId)
}

/**
 * Duplica el formulario completo en uno nuevo, a partir del snapshot de una
 * versión. Sirve para arrancar `HSEQ-FR-09` desde `HSEQ-FR-08`, que comparten
 * casi todo el árbol.
 */
export async function duplicarFormulario(
  formId: string,
  versionId: string | undefined,
  input: DuplicarFormularioInput,
  actor: AdminActor,
) {
  const origen = await findFormWithVersions(prisma, formId)
  if (!origen) throw new FormError('FORM_NOT_FOUND', 'El formulario no existe.')

  /// Sin `versionId` explícito se copia la publicada más reciente y, si no hay
  /// ninguna, el borrador: es lo que el usuario ve como "la versión actual".
  const candidata =
    (versionId && origen.versions.find((v) => v.id === versionId)) ||
    origen.versions.find((v) => v.status === 'PUBLISHED') ||
    origen.versions[0]
  if (!candidata) throw new FormError('VERSION_NOT_FOUND', 'El formulario no tiene versiones que copiar.')

  const slug = input.slug ?? slugify(input.name)
  const choque = await prisma.form_definition.findFirst({
    where: { OR: [{ code: input.code }, { slug }] },
    select: { id: true },
  })
  if (choque) throw new FormError('FORM_CODE_TAKEN', 'Ese código o slug ya está en uso.')

  const nuevoFormId = randomUUID()
  const nuevaVersionId = randomUUID()
  const fuente = await cargarVersion(formId, candidata.id)

  await prisma.$transaction(async (tx) => {
    await tx.form_definition.create({
      data: {
        id: nuevoFormId,
        code: input.code,
        slug,
        name: input.name,
        description: origen.description,
        owner_area: origen.owner_area,
        created_by_id: actor.id,
        updated_by_id: actor.id,
      },
    })
    await tx.form_version.create({
      data: {
        id: nuevaVersionId,
        form_id: nuevoFormId,
        version_number: 1,
        status: 'DRAFT',
        title: fuente.title,
        description: fuente.description,
        instructions: fuente.instructions,
        settings_json: fuente.settings_json as Prisma.InputJsonValue,
        source_metadata_json: {
          ...(fuente.source_metadata_json as object),
          duplicatedFromFormId: formId,
          duplicatedFromVersionId: fuente.id,
        } as Prisma.InputJsonValue,
        created_by_id: actor.id,
      },
    })
    await copyVersionTree(tx, { sourceVersionId: fuente.id, targetVersionId: nuevaVersionId })
  })

  return obtenerFormulario(nuevoFormId)
}

// ─────────────────────────────────────────────────────────────────────────────
// Plantillas de cards
// ─────────────────────────────────────────────────────────────────────────────

export async function listarPlantillas(query: { category?: string; search?: string }) {
  const rows = await prisma.form_field_template.findMany({
    where: {
      deleted_at: null,
      ...(query.category ? { category: query.category } : {}),
      ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
    },
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
  })
  return rows.map(toTemplateDto)
}

export async function crearPlantilla(input: PlantillaInput, actor: AdminActor) {
  const row = await prisma.form_field_template.create({
    data: {
      id: randomUUID(),
      name: input.name,
      category: input.category,
      field_type: input.fieldType,
      template_json: input.template as Prisma.InputJsonValue,
      owner_area: input.ownerArea ?? null,
      is_global: input.isGlobal ?? false,
      created_by_id: actor.id,
    },
  })
  return toTemplateDto(row)
}

export async function actualizarPlantilla(id: string, input: ActualizarPlantillaInput) {
  const existe = await prisma.form_field_template.findFirst({ where: { id, deleted_at: null }, select: { id: true } })
  if (!existe) throw new FormError('TEMPLATE_NOT_FOUND', 'La plantilla no existe.')

  const row = await prisma.form_field_template.update({
    where: { id },
    data: {
      ...(input.name ? { name: input.name } : {}),
      ...(input.category ? { category: input.category } : {}),
      ...(input.fieldType ? { field_type: input.fieldType } : {}),
      ...(input.template ? { template_json: input.template as Prisma.InputJsonValue } : {}),
      ...(input.ownerArea !== undefined ? { owner_area: input.ownerArea ?? null } : {}),
      ...(input.isGlobal !== undefined ? { is_global: input.isGlobal } : {}),
    },
  })
  return toTemplateDto(row)
}

/**
 * Borrado lógico de la plantilla.
 *
 * Lógico y no físico aunque nadie la referencie: insertarla copia el snapshot,
 * así que no hay FK que la proteja, pero conservarla permite saber de dónde
 * salió una card cuando HSEQ audite un formulario viejo.
 */
export async function eliminarPlantilla(id: string) {
  const existe = await prisma.form_field_template.findFirst({ where: { id, deleted_at: null }, select: { id: true } })
  if (!existe) throw new FormError('TEMPLATE_NOT_FOUND', 'La plantilla no existe.')
  await prisma.form_field_template.update({ where: { id }, data: { deleted_at: new Date() } })
  return { id }
}
