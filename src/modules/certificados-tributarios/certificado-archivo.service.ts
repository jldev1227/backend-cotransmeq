import { PrismaClient } from '@prisma/client'
import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { parseS3Key, TIPOS_VALIDOS } from '../certificados-tributarios/certificados.helper'
import { env } from '../../config/env'

const prisma = new PrismaClient()

const URL_TTL_SECONDS = 3600

function getS3Client(): S3Client {
  return new S3Client({
    region: env.AWS_REGION,
    credentials: {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY
    }
  })
}

export async function getPresignedUrl(s3Key: string): Promise<string> {
  const client = getS3Client()
  return getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: env.AWS_S3_BUCKET_NAME, Key: s3Key }),
    { expiresIn: URL_TTL_SECONDS }
  )
}

export async function syncS3ToDB(): Promise<{ created: number; skipped: number; linked: number; errors: number }> {
  const client = getS3Client()
  const prefix = 'certificados-tributarios/'

  const allObjects: any[] = []
  let continuationToken: string | undefined

  do {
    const res = await client.send(
      new ListObjectsV2Command({
        Bucket: env.AWS_S3_BUCKET_NAME,
        Prefix: prefix,
        ContinuationToken: continuationToken
      })
    )
    allObjects.push(...(res.Contents ?? []))
    continuationToken = res.NextContinuationToken
  } while (continuationToken)

  const terceros = await prisma.terceros.findMany({
    where: { activo: true, deleted_at: null },
    select: { id: true, identificacion: true }
  })

  const nitToTercero = new Map<string, string>()
  for (const t of terceros) {
    if (t.identificacion) {
      nitToTercero.set(t.identificacion.replace(/\D/g, ''), t.id)
    }
  }

  const tiposCert = await prisma.tipo_certificado.findMany({ where: { activo: true } })
  const tipoByCodigo = new Map(tiposCert.map((t) => [t.codigo, t.id]))

  let created = 0
  let skipped = 0
  let linked = 0
  let errors = 0

  for (const obj of allObjects) {
    if (!obj.Key) continue
    const parsed = parseS3Key(obj.Key)
    if (!parsed) continue

    try {
      /// A propósito SIN filtrar por `deleted_at`: `s3_key` es único, así que
      /// un certificado archivado sigue ocupando su clave. Si el archivo vuelve
      /// a aparecer en S3 hay que encontrar esa fila y reutilizarla, no crear
      /// otra que reventaría contra la unicidad.
      const existing = await prisma.certificado_archivo.findUnique({
        where: { s3_key: obj.Key }
      })

      if (existing) {
        skipped++
        continue
      }

      const terceroId = nitToTercero.get(parsed.nit) || null
      const tipoCertId = tipoByCodigo.get(parsed.tipo) || null

      await prisma.certificado_archivo.create({
        data: {
          s3_key: obj.Key,
          filename: parsed.filename,
          nit: parsed.nit,
          anio: parsed.anio,
          tipo: parsed.tipo,
          size: obj.Size ?? 0,
          tercero_id: terceroId,
          tipo_certificado_id: tipoCertId
        }
      })

      created++
      if (terceroId) linked++
    } catch {
      errors++
    }
  }

  return { created, skipped, linked, errors }
}

export async function getCertificadosByNit(nit: string) {
  const archivos = await prisma.certificado_archivo.findMany({
    where: { nit },
    include: {
      tercero: {
        select: { id: true, nombre_completo: true, identificacion: true, correo: true }
      },
      tipo_certificado: true
    },
    orderBy: [{ anio: 'desc' }, { created_at: 'desc' }]
  })

  const withUrls = await Promise.all(
    archivos.map(async (a) => {
      try {
        const url = await getPresignedUrl(a.s3_key)
        return { ...a, url }
      } catch {
        return { ...a, url: null }
      }
    })
  )

  return withUrls
}

export async function getAllCertificados({
  search,
  page,
  limit
}: {
  search?: string
  page: number
  limit: number
}) {
  /// `deleted_at: null` en el punto de partida: el listado y su conteo
  /// comparten este `where`.
  const where: any = { deleted_at: null }
  if (search) {
    where.OR = [
      { nit: { contains: search, mode: 'insensitive' } },
      { filename: { contains: search, mode: 'insensitive' } },
      { tipo: { contains: search, mode: 'insensitive' } }
    ]
  }

  const [archivos, total] = await Promise.all([
    prisma.certificado_archivo.findMany({
      where,
      include: {
        tercero: {
          select: { id: true, nombre_completo: true, identificacion: true, correo: true, telefono: true }
        },
        tipo_certificado: true
      },
      orderBy: { created_at: 'desc' },
      skip: (page - 1) * limit,
      take: limit
    }),
    prisma.certificado_archivo.count({ where })
  ])

  const withUrls = await Promise.all(
    archivos.map(async (a) => {
      try {
        const url = await getPresignedUrl(a.s3_key)
        return { ...a, url }
      } catch {
        return { ...a, url: null }
      }
    })
  )

  return { archivos: withUrls, total, page, totalPages: Math.ceil(total / limit) }
}

export async function getTercerosWithCertificados({
  search,
  page,
  limit
}: {
  search?: string
  page: number
  limit: number
}) {
  const where: any = {
    deleted_at: null,
    activo: true,
    certificados_archivo: { some: {} }
  }

  if (search) {
    where.OR = [
      { nombre_completo: { contains: search, mode: 'insensitive' } },
      { identificacion: { contains: search, mode: 'insensitive' } },
      { correo: { contains: search, mode: 'insensitive' } }
    ]
  }

  const [terceros, total] = await Promise.all([
    prisma.terceros.findMany({
      where,
      select: {
        id: true,
        nombre_completo: true,
        identificacion: true,
        correo: true,
        telefono: true,
        tipo_persona: true,
        activo: true,
        certificados_archivo: {
          select: {
            id: true,
            nit: true,
            anio: true,
            tipo: true,
            filename: true,
            s3_key: true,
            tipo_certificado: true
          },
          orderBy: { created_at: 'desc' }
        },
        _count: {
          select: { certificados_archivo: true }
        }
      },
      orderBy: { nombre_completo: 'asc' },
      skip: (page - 1) * limit,
      take: limit
    }),
    prisma.terceros.count({ where })
  ])

  return { terceros, total, page, totalPages: Math.ceil(total / limit) }
}

export async function linkCertificadoToTercero(certificadoId: string, terceroId: string) {
  await prisma.certificado_archivo.update({
    where: { id: certificadoId },
    data: { tercero_id: terceroId }
  })

  return prisma.certificado_tercero.create({
    data: {
      tercero_id: terceroId,
      certificado_id: certificadoId
    },
    include: {
      tercero: true,
      certificado: {
        include: {
          tipo_certificado: true
        }
      }
    }
  })
}

export async function deleteCertificado(id: string) {
  /// Un certificado ya retirado se trata como inexistente.
  const archivo = await prisma.certificado_archivo.findFirst({
    where: { id, deleted_at: null }
  })
  if (!archivo) throw new Error('Certificado no encontrado')

  /// Se MARCAN las tres, no se borran.
  ///
  /// `certificacion_envio` es el registro de CUÁNDO y A QUIÉN se envió el
  /// certificado. Borrarlo dejaba a la empresa sin forma de demostrar que lo
  /// mandó, ante un tercero que dijera no haberlo recibido.
  ///
  /// El archivo físico de S3 sí se va —la función devuelve `s3_key` para que
  /// quien llama lo borre—; lo que se conserva es la constancia de que existió
  /// y de a quién se le entregó.
  const ahora = new Date()
  await prisma.certificado_tercero.updateMany({
    where: { certificado_id: id, deleted_at: null },
    data: { deleted_at: ahora }
  })
  await prisma.certificacion_envio.updateMany({
    where: { certificado_id: id, deleted_at: null },
    data: { deleted_at: ahora }
  })
  await prisma.certificado_archivo.update({
    where: { id },
    data: { deleted_at: ahora }
  })

  return { success: true, s3_key: archivo.s3_key }
}
