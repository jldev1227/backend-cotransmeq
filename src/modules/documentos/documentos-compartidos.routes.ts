import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { prisma } from '../../config/prisma'
import { uploadToS3, getS3SignedUrl } from '../../config/aws'
import { randomUUID } from 'crypto'

export async function documentosCompartidosRoutes(app: FastifyInstance) {

  app.get('/desprendible/compartido/:token', async (request: FastifyRequest<{ Params: { token: string } }>, reply: FastifyReply) => {
    try {
      const { token } = request.params
  const doc = await prisma.documentos_compartidos.findUnique({ where: { token }, include: { conductores: true } })
      if (!doc) return reply.status(404).send({ success: false, message: 'Enlace inválido' })

      // check expiry
      if (doc.expires_at && new Date(doc.expires_at) < new Date()) {
        return reply.status(410).send({ success: false, message: 'Este enlace ha expirado' })
      }

      // generate a short-lived presigned URL for viewing (1 hour)
      let presigned = ''
      try { presigned = await getS3SignedUrl(doc.s3_key, 3600) } catch (e) { /* ignore */ }

  return reply.send({ success: true, data: { id: doc.id, token: doc.token, filename: doc.filename, original_name: doc.original_name, signed: doc.signed, presigned_url: presigned, expires_at: doc.expires_at, conductores: doc.conductores } })
    } catch (error: any) {
      request.log.error({ error }, 'Error validating shared document token')
      return reply.status(500).send({ success: false, message: 'Error interno del servidor' })
    }
  })

  app.post('/desprendible/compartido/:token/firmar', async (request: FastifyRequest<{ Params: { token: string } }>, reply: FastifyReply) => {
    try {
      const { token } = request.params
      const data = await request.file()
      if (!data) return reply.status(400).send({ success: false, message: 'Debe proporcionar la firma' })

      const doc = await prisma.documentos_compartidos.findUnique({ where: { token } })
      if (!doc) return reply.status(404).send({ success: false, message: 'Enlace inválido' })
      if (doc.expires_at && new Date(doc.expires_at) < new Date()) return reply.status(410).send({ success: false, message: 'Enlace expirado' })

      const buffer = await data.toBuffer()
      const firmaId = randomUUID()
      const s3Key = `documentos_compartidos/signatures/${token}/${firmaId}.png`
      await uploadToS3(s3Key, buffer, data.mimetype || 'image/png')
      const firmaUrl = await getS3SignedUrl(s3Key, 3600 * 24 * 7)

      const ipAddress = (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || request.ip || '0.0.0.0'
      const userAgent = request.headers['user-agent'] || ''

      const now = new Date()

  const updated = await prisma.documentos_compartidos.update({ where: { token }, data: { signed: true, signature_s3_key: s3Key, signature_url: firmaUrl, ip_address: ipAddress, user_agent: userAgent, updated_at: now }, include: { conductores: true } })

  return reply.send({ success: true, data: { document: updated, signature: { s3_key: s3Key, presignedUrl: firmaUrl } } })
    } catch (error: any) {
      request.log.error({ error }, 'Error registering signature for shared document')
      return reply.status(500).send({ success: false, message: error.message || 'Error al registrar firma' })
    }
  })

  app.get('/desprendible/compartido/:token/datos', async (request: FastifyRequest<{ Params: { token: string } }>, reply: FastifyReply) => {
    try {
      const { token } = request.params
  const doc = await prisma.documentos_compartidos.findUnique({ where: { token }, include: { conductores: true } })
      if (!doc) return reply.status(404).send({ success: false, message: 'Enlace inválido' })
      if (!doc.signed) return reply.status(403).send({ success: false, message: 'Debe firmar primero para acceder al documento' })

      let presigned = ''
      let presignedSignature = ''
      try { presigned = await getS3SignedUrl(doc.s3_key, 3600) } catch {}
      try { if (doc.signature_s3_key) presignedSignature = await getS3SignedUrl(doc.signature_s3_key, 3600) } catch {}

  return reply.send({ success: true, data: { document: { ...doc, presigned_url: presigned }, signature: { presignedUrl: presignedSignature } } })
    } catch (error: any) {
      request.log.error({ error }, 'Error getting shared document data')
      return reply.status(500).send({ success: false, message: 'Error interno del servidor' })
    }
  })

}

export default documentosCompartidosRoutes
