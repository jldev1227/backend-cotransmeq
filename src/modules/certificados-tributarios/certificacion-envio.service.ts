import { prisma } from '../../config/prisma'
import { randomUUID } from 'crypto'
import { EmailService } from '../../services/email.service'
import { getPresignedUrl } from './certificado-archivo.service'
import { env } from '../../config/env'

export async function generateTerceroToken(terceroId: string) {
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + 90)

  const token = randomUUID()

  const tokenRecord = await prisma.tercero_token.create({
    data: {
      tercero_id: terceroId,
      token,
      expires_at: expiresAt
    },
    include: {
      tercero: true
    }
  })

  return tokenRecord
}

export async function verifyTerceroToken(token: string) {
  const tokenRecord = await prisma.tercero_token.findUnique({
    where: { token },
    include: {
      tercero: true
    }
  })

  if (!tokenRecord) return null
  if (tokenRecord.expires_at < new Date()) return null

  return tokenRecord
}

export async function getCertificadosForTercero(terceroId: string) {
  const archivos = await prisma.certificado_archivo.findMany({
    where: { tercero_id: terceroId },
    include: {
      tipo_certificado: true
    },
    orderBy: { anio: 'desc' }
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

export async function enviarCertificacionEmail({
  tercero_id,
  certificado_ids,
  email_destino,
  mensaje_personalizado,
  tipo_envio = 'individual'
}: {
  tercero_id: string
  certificado_ids: string[]
  email_destino: string
  mensaje_personalizado?: string
  tipo_envio?: 'individual' | 'masivo'
}) {
  const tercero = await prisma.terceros.findUnique({ where: { id: tercero_id } })
  if (!tercero) throw new Error('Tercero no encontrado')

  const tokenRecord = await generateTerceroToken(tercero_id)

  const archivos = await prisma.certificado_archivo.findMany({
    where: { id: { in: certificado_ids } }
  })

  const certificadosWithUrls = await Promise.all(
    archivos.map(async (a) => {
      try {
        const url = await getPresignedUrl(a.s3_key)
        const tipo = a.tipo_certificado_id
          ? (await prisma.tipo_certificado.findUnique({ where: { id: a.tipo_certificado_id } }))?.codigo || a.tipo
          : a.tipo
        return { tipo, anio: a.anio, url }
      } catch {
        return null
      }
    })
  ).then(items => items.filter(Boolean))

  await EmailService.sendCertificacionAccessLink({
    to: email_destino,
    terceroNombre: tercero.nombre_completo,
    certificados: certificadosWithUrls as any[],
    token: tokenRecord.token,
    mensaje_personalizado
  })

  const envios = await Promise.all(
    archivos.map(async (a) => {
      return prisma.certificacion_envio.create({
        data: {
          tercero_id,
          certificado_id: a.id,
          token_acceso: tokenRecord.token,
          email_destino,
          tipo_envio
        }
      })
    })
  )

  return { success: true, envios, token: tokenRecord.token }
}

export async function getEnviosByTercero(terceroId: string) {
  return prisma.certificacion_envio.findMany({
    where: { tercero_id: terceroId },
    include: {
      certificado: {
        include: {
          tipo_certificado: true
        }
      }
    },
    orderBy: { emitido_at: 'desc' }
  })
}

export async function getAllEnvios({ page, limit }: { page: number; limit: number }) {
  const [envios, total] = await Promise.all([
    prisma.certificacion_envio.findMany({
      include: {
        tercero: {
          select: {
            nombre_completo: true,
            identificacion: true,
            correo: true
          }
        },
        certificado: {
          select: {
            filename: true,
            nit: true,
            anio: true,
            tipo: true
          }
        }
      },
      orderBy: { emitido_at: 'desc' },
      skip: (page - 1) * limit,
      take: limit
    }),
    prisma.certificacion_envio.count()
  ])

  return { envios, total, page, totalPages: Math.ceil(total / limit) }
}
