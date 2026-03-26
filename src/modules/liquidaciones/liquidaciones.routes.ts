import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { LiquidacionesController } from './liquidaciones.controller'
import { authMiddleware } from '../../middlewares/auth.middleware'
import { prisma } from '../../config/prisma'

export async function liquidacionesRoutes(fastify: FastifyInstance) {
  // Aplicar middleware de autenticación
  fastify.addHook('onRequest', authMiddleware)

  // Obtener configuraciones (debe ir antes de /:id)
  fastify.get('/configuraciones-liquidacion', LiquidacionesController.obtenerConfiguraciones)

  // Preview de recargos para un conductor (debe ir antes de /:id)
  fastify.get('/liquidaciones/preview-recargos', LiquidacionesController.previewRecargos)

  // Obtener todas las liquidaciones
  fastify.get('/liquidaciones', LiquidacionesController.obtenerTodas)

  // Obtener una liquidación por ID
  fastify.get('/liquidaciones/:id', LiquidacionesController.obtenerPorId)

  // Obtener analisis
  fastify.get('/liquidaciones/analisis', LiquidacionesController.obtenerAnalisis)

  // Crear liquidación
  fastify.post('/liquidaciones', LiquidacionesController.crear)

  // Actualizar liquidación
  fastify.put('/liquidaciones/:id', LiquidacionesController.actualizar)

  // Eliminar liquidación
  fastify.delete('/liquidaciones/:id', LiquidacionesController.eliminar)

  // Generar token para compartir desprendible (requiere auth)
  fastify.post('/liquidaciones/:id/compartir', async (request: FastifyRequest<{
    Params: { id: string }
    Body: { expires_hours?: number }
  }>, reply: FastifyReply) => {
    try {
      const { id } = request.params
      const { expires_hours = 72 } = (request.body as any) || {}

      const liquidacion = await prisma.liquidaciones.findUnique({
        where: { id },
        select: { id: true, share_token: true, share_token_expires_at: true, conductor_id: true }
      })

      if (!liquidacion) {
        return reply.status(404).send({ success: false, message: 'Liquidación no encontrada' })
      }

      // Si ya tiene un token vigente, devolverlo
      if (liquidacion.share_token && liquidacion.share_token_expires_at) {
        if (new Date(liquidacion.share_token_expires_at) > new Date()) {
          return reply.send({
            success: true,
            data: {
              share_token: liquidacion.share_token,
              expires_at: liquidacion.share_token_expires_at,
              liquidacion_id: id
            }
          })
        }
      }

      // Generar nuevo token
      const crypto = await import('crypto')
      const token = crypto.randomBytes(32).toString('hex')
      const expiresAt = new Date()
      expiresAt.setHours(expiresAt.getHours() + expires_hours)

      await prisma.liquidaciones.update({
        where: { id },
        data: {
          share_token: token,
          share_token_expires_at: expiresAt
        }
      })

      return reply.send({
        success: true,
        data: {
          share_token: token,
          expires_at: expiresAt,
          liquidacion_id: id
        }
      })
    } catch (error: any) {
      request.log.error({ error }, 'Error al generar token de compartir')
      return reply.status(500).send({ success: false, message: error.message })
    }
  })
}