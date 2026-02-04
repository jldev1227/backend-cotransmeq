import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { CronService } from '../../services/cron.service'

export async function cronRoutes(app: FastifyInstance) {
  // Ejecutar manualmente la actualización de servicios (solo para admins)
  app.post('/api/cron/ejecutar-actualizacion', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Aquí podrías agregar verificación de rol admin si lo necesitas
      // const userId = (request as any).userId
      // if (!userId || !isAdmin(userId)) {
      //   return reply.status(403).send({ success: false, message: 'No autorizado' })
      // }

      await CronService.ejecutarActualizacionManual()

      reply.send({
        success: true,
        message: 'Actualización manual ejecutada correctamente',
        timestamp: new Date().toISOString()
      })
    } catch (error) {
      console.error('Error en ejecución manual del CRON:', error)
      reply.status(500).send({
        success: false,
        message: 'Error al ejecutar la actualización manual'
      })
    }
  })
}
