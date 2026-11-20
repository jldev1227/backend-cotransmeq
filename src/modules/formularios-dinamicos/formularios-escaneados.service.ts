import { createHash, randomUUID } from 'crypto'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { Prisma } from '@prisma/client'
import { prisma } from '../../config/prisma'
import {
  BUCKET_NAME,
  s3Client,
  computeS3ObjectSha256,
  getS3SignedUrl,
  getS3UploadUrl,
  headS3Object,
  sha256HexToBase64,
  uploadToS3,
} from '../../config/aws'
import { ATTACHMENT_LIMITS, FormError } from './domain'
import { diasCubiertos } from './formularios-escaneados.schema'

export type NuevoEscaneado = {
  assignmentId: string
  conductorId: string
  vehicleId: string
  dateFrom: string
  dateTo: string
  explanation: string
  details: Record<string, string>
  originalName: string
  byteSize: number
  sha256: string
}

/** El escaneo representa un solo documento físico, aunque cubra varios días. */
export async function iniciarEscaneado(input: NuevoEscaneado, actorId: string) {
  if (input.byteSize > ATTACHMENT_LIMITS.maxFileBytes) {
    throw new FormError('ATTACHMENT_TOO_LARGE', 'El PDF supera el límite de 25 MB.')
  }
  const [assignment, conductor, vehicle] = await Promise.all([
    prisma.form_assignment.findFirst({
      where: { id: input.assignmentId, deleted_at: null },
      select: {
        id: true,
        version_id: true,
        version: { select: { status: true, form: { select: { deleted_at: true } } } },
      },
    }),
    prisma.conductores.findFirst({
      where: { id: input.conductorId, deleted_at: null },
      select: { id: true },
    }),
    prisma.vehiculos.findFirst({
      where: { id: input.vehicleId, deleted_at: null },
      select: { id: true },
    }),
  ])
  if (!assignment || assignment.version.status === 'DRAFT' || assignment.version.form.deleted_at) {
    throw new FormError(
      'ASSIGNMENT_NOT_FOUND',
      'La asignación no tiene una versión publicada disponible.',
    )
  }
  if (!conductor || !vehicle)
    throw new FormError('FIELD_VALUE_INVALID', 'Selecciona un conductor y un vehículo vigentes.')

  const id = randomUUID()
  const key = `formularios-escaneados/${assignment.version_id}/${id}.pdf`
  /// Firmar no escribe en S3; si falta configuración, no dejamos un pendiente
  /// imposible de completar en la base.
  const uploadUrl = await getS3UploadUrl(
    key,
    'application/pdf',
    input.byteSize,
    sha256HexToBase64(input.sha256),
  )
  await prisma.form_scanned_document.create({
    data: {
      id,
      assignment_id: assignment.id,
      version_id: assignment.version_id,
      conductor_id: conductor.id,
      vehicle_id: vehicle.id,
      created_by_id: actorId,
      date_from: new Date(`${input.dateFrom}T00:00:00.000Z`),
      date_to: new Date(`${input.dateTo}T00:00:00.000Z`),
      explanation: input.explanation,
      details_json: input.details as Prisma.InputJsonValue,
      object_key: key,
      original_name: input.originalName,
      byte_size: BigInt(input.byteSize),
      sha256: input.sha256,
    },
  })
  /// Igual que el portal, el checksum va en la URL firmada; el PUT no agrega
  /// cabeceras x-amz que no estén firmadas.
  return { id, uploadUrl }
}

export async function completarEscaneado(id: string) {
  const row = await prisma.form_scanned_document.findFirst({ where: { id, deleted_at: null } })
  if (!row) throw new FormError('ATTACHMENT_NOT_FOUND', 'El escaneo no existe.')
  if (row.status === 'UPLOADED') return { id, status: 'UPLOADED' }
  const object = await headS3Object(row.object_key)
  if (
    !object ||
    object.contentLength !== Number(row.byte_size) ||
    object.contentType?.split(';')[0] !== 'application/pdf'
  ) {
    throw new FormError(
      'ATTACHMENT_MISSING',
      'El PDF todavía no está completo o sus datos no coinciden.',
    )
  }
  const expected = sha256HexToBase64(row.sha256)
  if (
    object.checksumSha256
      ? object.checksumSha256 !== expected
      : (await computeS3ObjectSha256(row.object_key, Number(row.byte_size)))?.sha256Hex !==
        row.sha256
  ) {
    throw new FormError(
      'ATTACHMENT_HASH_MISMATCH',
      'El contenido del PDF no coincide con su huella SHA-256.',
    )
  }
  /// El navegador revisa la firma por comodidad; el servidor la comprueba
  /// también porque un cliente puede llamar la API directamente.
  const head = await s3Client.send(
    new GetObjectCommand({ Bucket: BUCKET_NAME, Key: row.object_key, Range: 'bytes=0-1023' }),
  )
  const prefix = head.Body ? Buffer.from(await head.Body.transformToByteArray()) : Buffer.alloc(0)
  if (!prefix.includes(Buffer.from('%PDF-'))) {
    throw new FormError(
      'ATTACHMENT_TYPE_NOT_ALLOWED',
      'El archivo no contiene una cabecera PDF válida.',
    )
  }
  await prisma.form_scanned_document.updateMany({
    where: { id, status: 'PENDING', deleted_at: null },
    data: { status: 'UPLOADED', uploaded_at: new Date() },
  })
  return { id, status: 'UPLOADED' }
}

/** Sube el PDF por la API para evitar depender del CORS del bucket en el dashboard. */
export async function subirEscaneado(id: string, buffer: Buffer) {
  const row = await prisma.form_scanned_document.findFirst({ where: { id, deleted_at: null } })
  if (!row || row.status !== 'PENDING')
    throw new FormError('ATTACHMENT_NOT_FOUND', 'No hay un PDF pendiente para esta carga.')
  if (buffer.length !== Number(row.byte_size) || buffer.length > ATTACHMENT_LIMITS.maxFileBytes)
    throw new FormError('ATTACHMENT_MISSING', 'El tamaño del PDF no coincide con el registrado.')
  if (!buffer.subarray(0, 1024).includes(Buffer.from('%PDF-')))
    throw new FormError('ATTACHMENT_TYPE_NOT_ALLOWED', 'El archivo no contiene una cabecera PDF válida.')
  if (createHash('sha256').update(buffer).digest('hex') !== row.sha256)
    throw new FormError('ATTACHMENT_HASH_MISMATCH', 'El contenido del PDF no coincide con su huella SHA-256.')
  await uploadToS3(row.object_key, buffer, 'application/pdf')
  return completarEscaneado(id)
}

export async function opcionesEscaneados(query: string, formId?: string) {
  const q = query.trim()
  const contains = { contains: q, mode: 'insensitive' as const }
  const palabras = q.split(/\s+/).filter(Boolean)
  const [assignments, conductores, vehiculos] = await Promise.all([
    prisma.form_assignment.findMany({
      where: {
        deleted_at: null,
        version: {
          status: { in: ['PUBLISHED', 'ARCHIVED'] },
          ...(formId ? { form_id: formId } : {}),
          form: { deleted_at: null },
        },
        ...(q
          ? {
              OR: [
                { name: contains },
                { version: { form: { code: contains } } },
                { version: { form: { name: contains } } },
              ],
            }
          : {}),
      },
      take: 40,
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        name: true,
        version: {
          select: {
            title: true,
            version_number: true,
            form: { select: { code: true, name: true } },
          },
        },
      },
    }),
    prisma.conductores.findMany({
      where: {
        deleted_at: null,
        ...(palabras.length ? {
          AND: palabras.map((palabra) => ({
            OR: [
              { nombre: { contains: palabra, mode: 'insensitive' as const } },
              { apellido: { contains: palabra, mode: 'insensitive' as const } },
              { numero_identificacion: { contains: palabra, mode: 'insensitive' as const } },
            ],
          })),
        } : {}),
      },
      take: 40,
      orderBy: { nombre: 'asc' },
      select: { id: true, nombre: true, apellido: true, numero_identificacion: true },
    }),
    prisma.vehiculos.findMany({
      where: { deleted_at: null, ...(q ? { placa: contains } : {}) },
      take: 40,
      orderBy: { placa: 'asc' },
      select: { id: true, placa: true },
    }),
  ])
  return { assignments, conductores, vehiculos }
}

export async function listarEscaneados(input: {
  page: number
  search?: string
  coveredOn?: string
}) {
  const where: Prisma.form_scanned_documentWhereInput = {
    status: 'UPLOADED',
    deleted_at: null,
    ...(input.coveredOn
      ? {
          date_from: { lte: new Date(`${input.coveredOn}T00:00:00.000Z`) },
          date_to: { gte: new Date(`${input.coveredOn}T00:00:00.000Z`) },
        }
      : {}),
    ...(input.search
      ? {
          OR: [
            {
              assignment: {
                version: { form: { name: { contains: input.search, mode: 'insensitive' } } },
              },
            },
            { conductor: { nombre: { contains: input.search, mode: 'insensitive' } } },
            { conductor: { apellido: { contains: input.search, mode: 'insensitive' } } },
            {
              conductor: { numero_identificacion: { contains: input.search, mode: 'insensitive' } },
            },
            {
              assignment: {
                version: { form: { code: { contains: input.search, mode: 'insensitive' } } },
              },
            },
            { vehicle: { placa: { contains: input.search, mode: 'insensitive' } } },
          ],
        }
      : {}),
  }
  const [rows, total] = await Promise.all([
    prisma.form_scanned_document.findMany({
      where,
      take: 25,
      skip: (input.page - 1) * 25,
      orderBy: { created_at: 'desc' },
      include: {
        assignment: {
          select: {
            name: true,
            version: {
              select: { version_number: true, form: { select: { code: true, name: true } } },
            },
          },
        },
        conductor: { select: { nombre: true, apellido: true, numero_identificacion: true } },
        vehicle: { select: { placa: true } },
        created_by: { select: { nombre: true } },
      },
    }),
    prisma.form_scanned_document.count({ where }),
  ])
  return {
    items: rows.map((r) => ({
      id: r.id,
      assignmentId: r.assignment_id,
      formCode: r.assignment.version.form.code,
      formName: r.assignment.version.form.name,
      versionNumber: r.assignment.version.version_number,
      assignmentName: r.assignment.name,
      conductor: `${r.conductor.nombre} ${r.conductor.apellido}`.trim(),
      document: r.conductor.numero_identificacion,
      placa: r.vehicle.placa,
      dateFrom: r.date_from.toISOString().slice(0, 10),
      dateTo: r.date_to.toISOString().slice(0, 10),
      daysCovered: diasCubiertos(r.date_from, r.date_to),
      explanation: r.explanation,
      details: r.details_json,
      originalName: r.original_name,
      byteSize: Number(r.byte_size),
      uploadedAt: r.uploaded_at?.toISOString(),
      createdBy: r.created_by.nombre,
    })),
    total,
    page: input.page,
  }
}

export async function urlEscaneado(id: string) {
  const row = await prisma.form_scanned_document.findFirst({
    where: { id, status: 'UPLOADED', deleted_at: null },
    select: { object_key: true },
  })
  if (!row) throw new FormError('ATTACHMENT_NOT_FOUND', 'El PDF escaneado no existe.')
  return { url: await getS3SignedUrl(row.object_key, 300) }
}
