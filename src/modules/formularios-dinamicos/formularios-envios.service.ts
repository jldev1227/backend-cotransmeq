/**
 * Consulta administrativa de envíos y anulación.
 *
 * Lo que este archivo NO hace, y es lo importante: no edita respuestas. Un
 * `SUBMITTED` es terminal. La única operación destructiva disponible es
 * `anular`, que conserva todas las respuestas y añade un evento con actor y
 * motivo. Corregir un envío es crear otro con `supersedes_submission_id`, y eso
 * lo hace el conductor desde el portal, no un administrador desde aquí.
 */

import { randomUUID } from 'crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '../../config/prisma'
import { getS3SignedUrl } from '../../config/aws'
import { logger } from '../../utils/logger'
import { FormError } from './domain'
import {
  toSubmissionDetailDto,
  toSubmissionSummaryDto,
  type FormVersionDto,
} from './formularios-dinamicos.mapper'
import { toVersionDto } from './formularios-dinamicos.mapper'
import { findVersionAggregate } from './formularios-dinamicos.repository'
import type { AnularEnvioInput, ListarEnviosQuery } from './formularios-dinamicos.schema'
import type { AdminActor } from './formularios-dinamicos.service'

const listSelect = {
  id: true,
  client_submission_id: true,
  assignment_id: true,
  version_id: true,
  conductor_id: true,
  vehicle_id: true,
  service_id: true,
  supersedes_submission_id: true,
  status: true,
  business_date: true,
  period_key: true,
  context_json: true,
  started_at: true,
  submitted_at: true,
  voided_at: true,
  void_reason: true,
  conductor: { select: { id: true, nombre: true, apellido: true, numero_identificacion: true } },
  vehiculo: { select: { id: true, placa: true } },
  assignment: { select: { id: true, name: true, frequency: true } },
  version: {
    select: { id: true, form_id: true, version_number: true, title: true, form: { select: { code: true } } },
  },
  _count: { select: { answers: true, attachments: true } },
} satisfies Prisma.form_submissionSelect

function buildWhere(query: ListarEnviosQuery): Prisma.form_submissionWhereInput {
  const where: Prisma.form_submissionWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.assignmentId ? { assignment_id: query.assignmentId } : {}),
    ...(query.versionId ? { version_id: query.versionId } : {}),
    ...(query.conductorId ? { conductor_id: query.conductorId } : {}),
    ...(query.vehicleId ? { vehicle_id: query.vehicleId } : {}),
    ...(query.formId ? { version: { form_id: query.formId } } : {}),
  }

  if (query.businessDateFrom || query.businessDateTo) {
    /// `business_date` es DATE: se construye la medianoche UTC porque es
    /// exactamente lo que Postgres guarda. Usar `new Date('YYYY-MM-DD')` con
    /// hora local desplazaría el filtro un día en Bogotá.
    where.business_date = {
      ...(query.businessDateFrom ? { gte: new Date(`${query.businessDateFrom}T00:00:00.000Z`) } : {}),
      ...(query.businessDateTo ? { lte: new Date(`${query.businessDateTo}T00:00:00.000Z`) } : {}),
    }
  }

  if (query.search) {
    /// Búsqueda por conductor o placa. No se busca dentro de las respuestas:
    /// requeriría un LIKE sobre `form_answers` sin índice y con millones de
    /// filas, y el explorador tiene filtros estructurados para eso.
    where.OR = [
      { conductor: { nombre: { contains: query.search, mode: 'insensitive' } } },
      { conductor: { apellido: { contains: query.search, mode: 'insensitive' } } },
      { conductor: { numero_identificacion: { contains: query.search } } },
      { vehiculo: { placa: { contains: query.search, mode: 'insensitive' } } },
    ]
  }

  return where
}

export async function listarEnvios(query: ListarEnviosQuery) {
  const where = buildWhere(query)
  const [total, rows] = await Promise.all([
    prisma.form_submission.count({ where }),
    prisma.form_submission.findMany({
      where,
      select: listSelect,
      /// `submitted_at DESC` con nulls al final: los borradores del servidor no
      /// tienen fecha de envío y deben quedar detrás de lo ya entregado.
      orderBy: [{ submitted_at: { sort: 'desc', nulls: 'last' } }, { started_at: 'desc' }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
  ])

  return {
    data: rows.map(toSubmissionSummaryDto),
    meta: { total, page: query.page, limit: query.limit, totalPages: Math.ceil(total / query.limit) || 1 },
  }
}

/**
 * Detalle inmutable: respuestas, adjuntos, eventos y la definición VERSIONADA.
 *
 * La definición se devuelve junto al envío, y no se pide aparte, porque el
 * detalle tiene que renderizarse con las etiquetas y opciones que existían al
 * enviarlo. Pedirla por separado invitaría a leer "la versión actual" del
 * formulario y a mostrar preguntas que el conductor nunca vio.
 */
export async function obtenerEnvio(id: string): Promise<{
  submission: ReturnType<typeof toSubmissionDetailDto>
  definition: FormVersionDto
}> {
  const row = await prisma.form_submission.findUnique({
    where: { id },
    include: {
      conductor: { select: { id: true, nombre: true, apellido: true, numero_identificacion: true } },
      vehiculo: { select: { id: true, placa: true } },
      assignment: { select: { id: true, name: true, frequency: true } },
      version: {
        select: { id: true, form_id: true, version_number: true, title: true, form: { select: { code: true } } },
      },
      answers: {
        orderBy: [{ row_index: 'asc' }, { created_at: 'asc' }],
        include: {
          field: { select: { key: true, type: true, sort_order: true } },
          options: { include: { option: { select: { value: true, label: true } } } },
        },
      },
      attachments: { orderBy: { created_at: 'asc' } },
      events: { orderBy: { created_at: 'asc' } },
    },
  })
  if (!row) throw new FormError('SUBMISSION_NOT_FOUND', 'El envío no existe.')

  const signedUrls = await firmarAdjuntos(row.attachments)
  const version = await findVersionAggregate(prisma, row.version_id)

  return {
    submission: toSubmissionDetailDto(row, signedUrls),
    definition: toVersionDto(version),
  }
}

/**
 * URLs firmadas de los adjuntos subidos.
 *
 * Se firman de una en una y los fallos se registran sin propagarse: un objeto
 * que ya no está en S3 no debe impedir consultar el resto del envío, que es
 * información legal.
 */
async function firmarAdjuntos(attachments: { id: string; object_key: string | null; status: string }[]) {
  const urls = new Map<string, string>()
  for (const attachment of attachments) {
    if (attachment.status !== 'UPLOADED' || !attachment.object_key) continue
    try {
      urls.set(attachment.id, await getS3SignedUrl(attachment.object_key))
    } catch (err) {
      logger.warn(
        {
          type: 'forms-attachment-sign-failed',
          attachmentId: attachment.id,
          error: err instanceof Error ? err.message : String(err),
        },
        '[formularios] no se pudo firmar la URL del adjunto',
      )
    }
  }
  return urls
}

/**
 * Anula un envío.
 *
 * Conserva respuestas y adjuntos: `VOIDED` mantiene `submitted_at` y añade
 * `voided_at`/`voided_by_id`/`void_reason`, tal como exige
 * `ck_form_submissions_terminal`. No reabre nada — el conductor no puede
 * "seguir editando" un envío anulado, tiene que hacer uno nuevo.
 */
export async function anularEnvio(id: string, input: AnularEnvioInput, actor: AdminActor) {
  const resultado = await prisma.$transaction(async (tx) => {
    const filas = await tx.$queryRaw<
      { id: string; status: string; conductor_id: string; assignment_id: string }[]
    >`
      SELECT id, status, conductor_id, assignment_id
      FROM form_submissions
      WHERE id = ${id}::uuid
      FOR UPDATE
    `
    const envio = filas[0]
    if (!envio) throw new FormError('SUBMISSION_NOT_FOUND', 'El envío no existe.')
    if (envio.status === 'VOIDED') throw new FormError('SUBMISSION_ALREADY_VOIDED', 'El envío ya estaba anulado.')
    if (envio.status !== 'SUBMITTED') {
      throw new FormError('SUBMISSION_IMMUTABLE', 'Solo se anula un envío ya entregado.', { status: envio.status })
    }

    const now = new Date()
    await tx.form_submission.update({
      where: { id },
      data: { status: 'VOIDED', voided_at: now, voided_by_id: actor.id, void_reason: input.reason },
    })
    await tx.form_submission_event.create({
      data: {
        id: randomUUID(),
        submission_id: id,
        event_type: 'VOIDED',
        actor_type: 'USER',
        actor_id: actor.id,
        payload_json: { reason: input.reason, actorName: actor.nombre ?? null } as Prisma.InputJsonValue,
      },
    })

    return { conductorId: envio.conductor_id, assignmentId: envio.assignment_id }
  })

  return { ...(await obtenerEnvio(id)), ...resultado }
}

/**
 * Exportación CSV de la lista filtrada.
 *
 * Exporta la CABECERA de cada envío, no sus respuestas: los formularios tienen
 * campos distintos entre sí (y entre versiones del mismo), así que un CSV
 * plano con una columna por pregunta solo tiene sentido filtrando por
 * `versionId`. Cuando llega ese filtro se añaden las columnas de la versión.
 */
export async function exportarEnviosCsv(query: ListarEnviosQuery): Promise<string> {
  const where = buildWhere(query)
  /// Tope duro: el export es sincrónico y una consulta sin límite sobre esta
  /// tabla puede traer cientos de miles de filas y agotar la memoria del
  /// proceso. Si hace falta más, se acota por fechas.
  const MAX_FILAS = 5000

  const rows = await prisma.form_submission.findMany({
    where,
    select: listSelect,
    orderBy: [{ submitted_at: { sort: 'desc', nulls: 'last' } }],
    take: MAX_FILAS,
  })

  const columnasFijas = [
    'submission_id',
    'codigo',
    'version',
    'asignacion',
    'estado',
    'fecha_negocio',
    'periodo',
    'conductor',
    'identificacion',
    'placa',
    'enviado_en',
    'anulado_en',
    'motivo_anulacion',
  ]

  /// Solo con `versionId` se pueden desplegar las respuestas en columnas: es la
  /// única forma de garantizar que todas las filas comparten el mismo conjunto
  /// de preguntas.
  let camposVersion: { id: string; key: string; label: string }[] = []
  let respuestasPorEnvio = new Map<string, Map<string, string>>()

  if (query.versionId && rows.length) {
    const campos = await prisma.form_field.findMany({
      where: { version_id: query.versionId, parent_field_id: null },
      select: { id: true, key: true, label: true, sort_order: true, section: { select: { sort_order: true } } },
      orderBy: [{ section: { sort_order: 'asc' } }, { sort_order: 'asc' }],
    })
    camposVersion = campos.map((c) => ({ id: c.id, key: c.key, label: c.label }))

    const respuestas = await prisma.form_answer.findMany({
      where: { submission_id: { in: rows.map((r) => r.id) }, occurrence_id: null },
      select: {
        submission_id: true,
        field_id: true,
        value_text: true,
        value_decimal: true,
        value_boolean: true,
        value_date: true,
        value_datetime: true,
        value_json: true,
        options: { select: { option: { select: { value: true } } } },
      },
    })

    respuestasPorEnvio = new Map()
    for (const r of respuestas) {
      const porCampo = respuestasPorEnvio.get(r.submission_id) ?? new Map<string, string>()
      porCampo.set(r.field_id, valorPlano(r))
      respuestasPorEnvio.set(r.submission_id, porCampo)
    }
  }

  const header = [...columnasFijas, ...camposVersion.map((c) => `${c.key} | ${c.label}`)]
  const lineas = [header.map(csvCell).join(',')]

  for (const row of rows) {
    const dto = toSubmissionSummaryDto(row)
    const fijas = [
      dto.id,
      dto.version?.code ?? '',
      dto.version ? `v${dto.version.versionNumber}` : '',
      dto.assignment?.name ?? '',
      dto.status,
      dto.businessDate ?? '',
      dto.periodKey ?? '',
      dto.conductor?.nombre ?? '',
      dto.conductor?.numeroIdentificacion ?? '',
      dto.vehiculo?.placa ?? '',
      dto.submittedAt ?? '',
      dto.voidedAt ?? '',
      dto.voidReason ?? '',
    ]
    const dinamicas = camposVersion.map((c) => respuestasPorEnvio.get(row.id)?.get(c.id) ?? '')
    lineas.push([...fijas, ...dinamicas].map(csvCell).join(','))
  }

  if (rows.length === MAX_FILAS) {
    logger.warn(
      { type: 'forms-export-truncated', limit: MAX_FILAS, filters: query },
      '[formularios] el export alcanzó el tope de filas y se truncó',
    )
    lineas.push(csvCell(`-- Truncado en ${MAX_FILAS} filas. Acota el rango de fechas. --`))
  }

  /// BOM UTF-8: sin él Excel en Windows abre el CSV en ANSI y destroza las
  /// tildes de las etiquetas HSEQ.
  return `﻿${lineas.join('\r\n')}\r\n`
}

function valorPlano(r: {
  value_text: string | null
  value_decimal: unknown
  value_boolean: boolean | null
  value_date: Date | null
  value_datetime: Date | null
  value_json: unknown
  options: { option: { value: string } }[]
}): string {
  if (r.options.length) return r.options.map((o) => o.option.value).join('|')
  if (r.value_text != null) return r.value_text
  if (r.value_decimal != null) return String(r.value_decimal)
  if (r.value_boolean != null) return r.value_boolean ? 'SI' : 'NO'
  if (r.value_date != null) return r.value_date.toISOString().slice(0, 10)
  if (r.value_datetime != null) return r.value_datetime.toISOString()
  if (r.value_json != null) return JSON.stringify(r.value_json)
  return ''
}

/**
 * Escapa una celda CSV.
 *
 * El prefijo `'` ante `=`, `+`, `-` y `@` neutraliza la inyección de fórmulas:
 * una observación que empiece por `=cmd|...` se ejecutaría al abrir el archivo
 * en Excel, y esas observaciones las escribe cualquier conductor.
 */
function csvCell(value: unknown): string {
  let texto = value == null ? '' : String(value)
  if (/^[=+\-@\t\r]/.test(texto)) texto = `'${texto}`
  return `"${texto.replace(/"/g, '""')}"`
}
