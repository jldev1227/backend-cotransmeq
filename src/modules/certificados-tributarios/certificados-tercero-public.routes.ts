import { FastifyInstance } from 'fastify'
import { prisma } from '../../config/prisma'
import * as service from './certificacion-envio.service'

export async function certificadosTerceroPublicRoutes(app: FastifyInstance) {
  app.get('/public/certificados-tercero/verificar-token', async (request, reply) => {
    try {
      const { token } = request.query as any
      if (!token) {
        return reply.status(400).send({ success: false, error: 'Token requerido' })
      }

      const tokenRecord = await service.verifyTerceroToken(token)
      if (!tokenRecord) {
        return reply.status(401).send({
          success: false,
          error: 'Token inválido o expirado'
        })
      }

      const certificados = await service.getCertificadosForTercero(tokenRecord.tercero_id)

      return reply.send({
        success: true,
        tercero: {
          id: tokenRecord.tercero.id,
          nombre_completo: tokenRecord.tercero.nombre_completo,
          identificacion: tokenRecord.tercero.identificacion,
          correo: tokenRecord.tercero.correo
        },
        certificados,
        expires_at: tokenRecord.expires_at
      })
    } catch (err: any) {
      console.error('Error verificar token:', err)
      return reply.status(500).send({ error: 'Error al verificar token', details: err?.message })
    }
  })

  app.post('/public/certificados-tercero/solicitar-acceso', async (request, reply) => {
    try {
      const { identificacion } = request.body as any
      if (!identificacion) {
        return reply.status(400).send({ success: false, error: 'Identificación requerida' })
      }

      const tercero = await prisma.terceros.findFirst({
        where: {
          identificacion,
          activo: true,
          deleted_at: null
        }
      })

      if (!tercero) {
        return reply.status(404).send({
          success: false,
          error: 'No se encontró un tercero con esa identificación'
        })
      }

      if (!tercero.correo) {
        return reply.status(400).send({
          success: false,
          error: 'El tercero no tiene correo registrado'
        })
      }

      const tokenRecord = await service.generateTerceroToken(tercero.id)

      const { EmailService } = await import('../../services/email.service')
      await EmailService.sendCertificacionAccessLink({
        to: tercero.correo,
        terceroNombre: tercero.nombre_completo,
        certificados: [],
        token: tokenRecord.token
      })

      return reply.send({
        success: true,
        message: 'Enlace de acceso enviado a tu correo',
        email: maskEmail(tercero.correo)
      })
    } catch (err: any) {
      console.error('Error solicitar acceso:', err)
      return reply.status(500).send({ error: 'Error al solicitar acceso', details: err?.message })
    }
  })
}

function maskEmail(email: string): string {
  const [user, domain] = email.split('@')
  if (user.length <= 2) return `${user}***@${domain}`
  return `${user.slice(0, 2)}***@${domain}`
}
