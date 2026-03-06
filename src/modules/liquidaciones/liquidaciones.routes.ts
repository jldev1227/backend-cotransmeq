import { FastifyInstance } from 'fastify'
import { LiquidacionesController } from './liquidaciones.controller'
import { authMiddleware } from '../../middlewares/auth.middleware'

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

  // Crear liquidación
  fastify.post('/liquidaciones', LiquidacionesController.crear)

  // Actualizar liquidación
  fastify.put('/liquidaciones/:id', LiquidacionesController.actualizar)

  // Eliminar liquidación
  fastify.delete('/liquidaciones/:id', LiquidacionesController.eliminar)
}
