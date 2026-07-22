import { FastifyInstance } from 'fastify'
import { LiquidacionesChatController } from './liquidaciones-chat.controller'
import { authMiddleware } from '../../middlewares/auth.middleware'

export async function liquidacionesChatRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authMiddleware)

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
