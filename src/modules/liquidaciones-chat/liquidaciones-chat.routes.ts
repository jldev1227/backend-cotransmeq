import { FastifyInstance } from 'fastify'
import { LiquidacionesChatController } from './liquidaciones-chat.controller'
import { authMiddleware } from '../../middlewares/auth.middleware'
import { permisoPorMetodo } from '../../middlewares/permissions.middleware'

export async function liquidacionesChatRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authMiddleware)
  /// Hasta oct-2026 este archivo solo pedía sesión: cualquiera del equipo (o un
  /// conductor con su enlace) leía y escribía aquí. Lectura y escritura del módulo `liquidaciones-terceros`.
  /// El chat y los recordatorios del cierre: los usan todas las áreas del módulo.
  app.addHook('preHandler', permisoPorMetodo('liquidaciones-terceros', { lectura: 'limited', escritura: 'limited' }))

  // ── Chat de liquidaciones ──
  app.get('/liquidaciones-terceros/:id/chat/mensajes', LiquidacionesChatController.listarMensajes)
  app.post('/liquidaciones-terceros/:id/chat/mensajes', LiquidacionesChatController.enviarMensaje)
  app.delete('/liquidaciones-terceros/:id/chat/mensajes/:msgId', LiquidacionesChatController.eliminarMensaje)

  // ── Recordatorios ──
  app.get('/liquidaciones-terceros/:id/recordatorios', LiquidacionesChatController.listarRecordatorios)
  app.post('/liquidaciones-terceros/:id/recordatorios', LiquidacionesChatController.crearRecordatorio)
  app.patch('/liquidaciones-terceros/recordatorios/:recordatorioId/estado', LiquidacionesChatController.cambiarEstadoRecordatorio)

  // ── Matching de recordatorios pendientes por placa/mes/año ──
  app.get('/recordatorios/pendientes', LiquidacionesChatController.pendientesPorPlaca)
}
