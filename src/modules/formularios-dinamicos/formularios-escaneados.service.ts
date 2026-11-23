import { createHash, randomUUID } from 'crypto'
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { PassThrough, Transform } from 'stream'
import type { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { Prisma } from '@prisma/client'
import { prisma } from '../../config/prisma'
import {
  BUCKET_NAME,
  s3Client,
  computeS3ObjectSha256,
  deleteFromS3,
  getS3SignedUrl,
  getS3UploadUrl,
  headS3Object,
  sha256HexToBase64,
  uploadToS3,
} from '../../config/aws'
import { ATTACHMENT_LIMITS, FormError } from './domain'
import { diasCubiertos } from './formularios-escaneados.schema'

export type ActualizarEscaneado = {
  dateFrom: string
  dateTo: string
  explanation: string
  details: Record<string, string>
  novedades: Array<{ fecha: string; descripcion: string }>
}

export type NuevoEscaneado = {
  formId: string
  conductorId: string
  vehicleId: string
  dateFrom: string
  dateTo: string
  explanation: string
  details: Record<string, string>
  novedades: Array<{ fecha: string; descripcion: string }>
  originalName: string
  byteSize: number
  sha256: string
}

/** El escaneo representa un solo documento físico, aunque cubra varios días. */
export async function iniciarEscaneado(input: NuevoEscaneado, actorId: string) {
  if (input.byteSize > ATTACHMENT_LIMITS.maxFileBytes) {
    throw new FormError('ATTACHMENT_TOO_LARGE', 'El PDF supera el límite de 25 MB.')
  }
  const [version, conductor, vehicle] = await Promise.all([
    prisma.form_version.findFirst({
      where: {
        form_id: input.formId,
        status: 'PUBLISHED',
        form: { deleted_at: null },
        assignments: { some: { deleted_at: null } },
      },
      orderBy: { version_number: 'desc' },
      select: {
        id: true,
        assignments: {
          where: { deleted_at: null },
          orderBy: { created_at: 'desc' },
          take: 1,
          select: { id: true },
        },
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
  const versionFisica = version ?? await prisma.form_version.findFirst({
    where: {
      form_id: input.formId,
      status: 'ARCHIVED',
      form: { deleted_at: null },
      assignments: { some: { deleted_at: null } },
    },
    orderBy: { version_number: 'desc' },
    select: {
      id: true,
      assignments: {
        where: { deleted_at: null },
        orderBy: { created_at: 'desc' },
        take: 1,
        select: { id: true },
      },
    },
  })
  if (!versionFisica || versionFisica.assignments.length === 0) {
    throw new FormError(
      'ASSIGNMENT_NOT_FOUND',
      'El formato no tiene una versión publicada disponible.',
    )
  }
  if (!conductor || !vehicle)
    throw new FormError('FIELD_VALUE_INVALID', 'Selecciona un conductor y un vehículo vigentes.')

  const id = randomUUID()
  const key = `formularios-escaneados/${versionFisica.id}/${id}.pdf`
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
      assignment_id: versionFisica.assignments[0].id,
      version_id: versionFisica.id,
      conductor_id: conductor.id,
      vehicle_id: vehicle.id,
      created_by_id: actorId,
      date_from: new Date(`${input.dateFrom}T00:00:00.000Z`),
      date_to: new Date(`${input.dateTo}T00:00:00.000Z`),
      explanation: input.explanation,
      details_json: {
        ...input.details,
        ...(input.novedades.length ? { novedades: input.novedades } : {}),
      } as Prisma.InputJsonValue,
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

/**
 * Valida y envía el PDF desde el multipart como stream, sin acumular el archivo
 * completo en memoria. El tamaño conocido se declara a S3 como Content-Length.
 */
async function subirPdfComoStream(
  key: string,
  archivo: Readable & { truncated?: boolean },
  byteSizeEsperado: number,
  sha256Esperado?: string,
) {
  let byteSize = 0
  let prefijo = Buffer.alloc(0)
  let almacenado = false
  const hash = createHash('sha256')
  const cuerpoS3 = new PassThrough()
  const validar = new Transform({
    transform(chunk: Buffer | string, _encoding, callback) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      byteSize += buffer.length
      if (byteSize > ATTACHMENT_LIMITS.maxFileBytes) {
        callback(new FormError('ATTACHMENT_TOO_LARGE', 'El PDF supera el límite de 25 MB.'))
        return
      }
      if (byteSize > byteSizeEsperado) {
        callback(new FormError('ATTACHMENT_MISSING', 'El tamaño del PDF no coincide con el registrado.'))
        return
      }
      hash.update(buffer)
      if (prefijo.length < 1024) {
        prefijo = Buffer.concat([prefijo, buffer.subarray(0, 1024 - prefijo.length)])
      }
      callback(null, buffer)
    },
  })

  const transferir = pipeline(archivo, validar, cuerpoS3)
  const subir = s3Client.send(new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: cuerpoS3,
    ContentLength: byteSizeEsperado,
    ContentType: 'application/pdf',
    ...(sha256Esperado ? { ChecksumSHA256: sha256HexToBase64(sha256Esperado) } : {}),
  })).then(() => {
    almacenado = true
  })

  try {
    await Promise.all([transferir, subir])
    if (archivo.truncated) {
      throw new FormError('ATTACHMENT_TOO_LARGE', 'El PDF supera el límite de 25 MB.')
    }
    if (byteSize !== byteSizeEsperado) {
      throw new FormError('ATTACHMENT_MISSING', 'El tamaño del PDF no coincide con el registrado.')
    }
    if (byteSize === 0 || !prefijo.includes(Buffer.from('%PDF-'))) {
      throw new FormError('ATTACHMENT_TYPE_NOT_ALLOWED', 'El archivo no contiene una cabecera PDF válida.')
    }
    const sha256 = hash.digest('hex')
    if (sha256Esperado && sha256 !== sha256Esperado) {
      throw new FormError('ATTACHMENT_HASH_MISMATCH', 'El contenido del PDF no coincide con su huella SHA-256.')
    }
    return { byteSize, sha256 }
  } catch (error) {
    archivo.destroy()
    cuerpoS3.destroy()
    await Promise.allSettled([transferir, subir])
    if (almacenado) {
      await deleteFromS3(key).catch((cleanupError) => {
        console.warn('No se pudo retirar un PDF después de fallar su validación:', cleanupError)
      })
    }
    throw error
  }
}

/** Recibe el multipart de Fastify como stream y lo sube a S3 en paralelo. */
export async function subirEscaneadoDesdeStream(
  id: string,
  archivo: Readable & { truncated?: boolean },
) {
  const row = await prisma.form_scanned_document.findFirst({
    where: { id, deleted_at: null },
  })
  if (!row || row.status !== 'PENDING') {
    throw new FormError('ATTACHMENT_NOT_FOUND', 'No hay un PDF pendiente para esta carga.')
  }
  await subirPdfComoStream(row.object_key, archivo, Number(row.byte_size), row.sha256)
  return completarEscaneado(id)
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

/** Reemplaza el PDF de un escaneado existente sin perder su historial de metadatos. */
export async function reemplazarArchivoEscaneado(id: string, buffer: Buffer, originalName: string) {
  const row = await prisma.form_scanned_document.findFirst({
    where: { id, status: 'UPLOADED', deleted_at: null },
    select: { id: true, version_id: true, object_key: true },
  })
  if (!row) throw new FormError('ATTACHMENT_NOT_FOUND', 'El PDF escaneado no existe.')
  if (buffer.length === 0) throw new FormError('ATTACHMENT_MISSING', 'Selecciona un PDF válido.')
  if (buffer.length > ATTACHMENT_LIMITS.maxFileBytes) {
    throw new FormError('ATTACHMENT_TOO_LARGE', 'El PDF supera el límite de 25 MB.')
  }
  if (!buffer.subarray(0, 1024).includes(Buffer.from('%PDF-'))) {
    throw new FormError('ATTACHMENT_TYPE_NOT_ALLOWED', 'El archivo no contiene una cabecera PDF válida.')
  }

  const sha256 = createHash('sha256').update(buffer).digest('hex')
  const newKey = `formularios-escaneados/${row.version_id}/${id}-${randomUUID()}.pdf`
  await uploadToS3(newKey, buffer, 'application/pdf')

  let result: { count: number }
  try {
    result = await prisma.form_scanned_document.updateMany({
      where: { id, status: 'UPLOADED', deleted_at: null, object_key: row.object_key },
      data: {
        object_key: newKey,
        original_name: originalName.slice(0, 255),
        byte_size: BigInt(buffer.length),
        sha256,
        uploaded_at: new Date(),
      },
    })
  } catch (error) {
    await deleteFromS3(newKey).catch((cleanupError) => {
      console.warn('No se pudo retirar el PDF de reemplazo después de fallar la base:', cleanupError)
    })
    throw error
  }
  if (!result.count) {
    await deleteFromS3(newKey).catch((error) => {
      console.warn('No se pudo retirar el PDF de reemplazo sin referencia:', error)
    })
    throw new FormError('ATTACHMENT_NOT_FOUND', 'El PDF escaneado cambió o fue eliminado. Recarga la lista e inténtalo de nuevo.')
  }

  // El nuevo objeto ya está referenciado. Si S3 no permite retirar el anterior,
  // el reemplazo sigue siendo válido y el huérfano se puede limpiar después.
  await deleteFromS3(row.object_key).catch((error) => {
    console.warn('No se pudo retirar el PDF anterior después del reemplazo:', error)
  })
  return {
    id,
    status: 'UPLOADED' as const,
    originalName: originalName.slice(0, 255),
    byteSize: buffer.length,
    uploadedAt: new Date().toISOString(),
  }
}

/** Reemplaza el objeto desde el multipart sin acumular el PDF en memoria. */
export async function reemplazarArchivoEscaneadoDesdeStream(
  id: string,
  archivo: Readable & { truncated?: boolean },
  byteSizeEsperado: number,
  originalName: string,
) {
  const row = await prisma.form_scanned_document.findFirst({
    where: { id, status: 'UPLOADED', deleted_at: null },
    select: { id: true, version_id: true, object_key: true },
  })
  if (!row) throw new FormError('ATTACHMENT_NOT_FOUND', 'El PDF escaneado no existe.')
  if (!Number.isSafeInteger(byteSizeEsperado) || byteSizeEsperado <= 0) {
    throw new FormError('ATTACHMENT_MISSING', 'Selecciona un PDF válido.')
  }
  if (byteSizeEsperado > ATTACHMENT_LIMITS.maxFileBytes) {
    throw new FormError('ATTACHMENT_TOO_LARGE', 'El PDF supera el límite de 25 MB.')
  }

  const newKey = `formularios-escaneados/${row.version_id}/${id}-${randomUUID()}.pdf`
  const archivoSubido = await subirPdfComoStream(newKey, archivo, byteSizeEsperado)

  let result: { count: number }
  try {
    result = await prisma.form_scanned_document.updateMany({
      where: { id, status: 'UPLOADED', deleted_at: null, object_key: row.object_key },
      data: {
        object_key: newKey,
        original_name: originalName.slice(0, 255),
        byte_size: BigInt(archivoSubido.byteSize),
        sha256: archivoSubido.sha256,
        uploaded_at: new Date(),
      },
    })
  } catch (error) {
    await deleteFromS3(newKey).catch((cleanupError) => {
      console.warn('No se pudo retirar el PDF de reemplazo después de fallar la base:', cleanupError)
    })
    throw error
  }
  if (!result.count) {
    await deleteFromS3(newKey).catch((error) => {
      console.warn('No se pudo retirar el PDF de reemplazo sin referencia:', error)
    })
    throw new FormError('ATTACHMENT_NOT_FOUND', 'El PDF escaneado cambió o fue eliminado. Recarga la lista e inténtalo de nuevo.')
  }

  await deleteFromS3(row.object_key).catch((error) => {
    console.warn('No se pudo retirar el PDF anterior después del reemplazo:', error)
  })
  return {
    id,
    status: 'UPLOADED' as const,
    originalName: originalName.slice(0, 255),
    byteSize: archivoSubido.byteSize,
    uploadedAt: new Date().toISOString(),
  }
}

export async function opcionesEscaneados(query: string, formId?: string) {
  const q = query.trim()
  const contains = { contains: q, mode: 'insensitive' as const }
  const palabras = q.split(/\s+/).filter(Boolean)
  const [formularios, conductores, vehiculos] = await Promise.all([
    prisma.form_definition.findMany({
      where: {
        deleted_at: null,
        ...(formId ? { id: formId } : {}),
        versions: { some: { status: { in: ['PUBLISHED', 'ARCHIVED'] }, assignments: { some: { deleted_at: null } } } },
        ...(q
          ? {
              OR: [{ code: contains }, { name: contains }],
            }
          : {}),
      },
      take: 40,
      orderBy: { code: 'asc' },
      select: { id: true, code: true, name: true },
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
  return { formatos: formularios, conductores, vehiculos }
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
      formCode: r.assignment.version.form.code,
      formName: r.assignment.version.form.name,
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

/** Actualiza solo los datos asociados al PDF físico; el objeto original queda intacto. */
export async function actualizarEscaneado(id: string, input: ActualizarEscaneado) {
  const details: Record<string, unknown> = { ...input.details }
  if (input.novedades.length) details.novedades = input.novedades
  const result = await prisma.form_scanned_document.updateMany({
    where: { id, status: 'UPLOADED', deleted_at: null },
    data: {
      date_from: new Date(`${input.dateFrom}T00:00:00.000Z`),
      date_to: new Date(`${input.dateTo}T00:00:00.000Z`),
      explanation: input.explanation,
      details_json: details as Prisma.InputJsonValue,
    },
  })
  if (!result.count) throw new FormError('ATTACHMENT_NOT_FOUND', 'El PDF escaneado no existe.')
  return { id, updated: true }
}

/** Retiro lógico: conserva el PDF original para trazabilidad y evita borrarlo del bucket. */
export async function eliminarEscaneado(id: string) {
  const result = await prisma.form_scanned_document.updateMany({
    where: { id, status: 'UPLOADED', deleted_at: null },
    data: { deleted_at: new Date() },
  })
  if (!result.count) throw new FormError('ATTACHMENT_NOT_FOUND', 'El PDF escaneado no existe.')
  return { id, deleted: true }
}

export async function urlEscaneado(id: string) {
  const row = await prisma.form_scanned_document.findFirst({
    where: { id, status: 'UPLOADED', deleted_at: null },
    select: { object_key: true },
  })
  if (!row) throw new FormError('ATTACHMENT_NOT_FOUND', 'El PDF escaneado no existe.')
  return { url: await getS3SignedUrl(row.object_key, 300) }
}
