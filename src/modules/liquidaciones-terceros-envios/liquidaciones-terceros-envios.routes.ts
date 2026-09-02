import { FastifyInstance } from 'fastify'
import { LiquidacionesTercerosEnviosController } from './liquidaciones-terceros-envios.controller'
import { authMiddleware } from '../../middlewares/auth.middleware'
import { requirePermission } from '../../middlewares/permissions.middleware'

const MODULO = 'liquidaciones-terceros'

export async function liquidacionesTercerosEnviosRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authMiddleware)

  const puedeLeer = { preHandler: requirePermission(MODULO, 'limited') }
  const puedeEscribir = { preHandler: requirePermission(MODULO, 'full') }

  // Encolar un lote de envíos. `bodyLimit` como el del pdf-zip: viajan los
  // HTML de las hojas del periodo más los adjuntos extra en base64.
  app.post(
    '/liquidaciones-terceros/envios/lote',
    { ...puedeEscribir, bodyLimit: 40 * 1024 * 1024 },
    LiquidacionesTercerosEnviosController.encolar,
  )

  // Estado agregado por cierre del periodo (para pintar ENVIADO y cuándo).
  app.get(
    '/liquidaciones-terceros/envios/periodo',
    puedeLeer,
    LiquidacionesTercerosEnviosController.estadoPeriodo,
  )

  // Constancias de un periodo para ingresos/ocasional (lista, no agregado).
  app.get(
    '/liquidaciones-terceros/envios/historial',
    puedeLeer,
    LiquidacionesTercerosEnviosController.historialPeriodo,
  )

  // Historial de un cierre concreto.
  app.get(
    '/liquidaciones-terceros/envios/cierre/:cierreId',
    puedeLeer,
    LiquidacionesTercerosEnviosController.historialCierre,
  )

  app.get(
    '/liquidaciones-terceros/envios/status/:jobId',
    puedeLeer,
    LiquidacionesTercerosEnviosController.status,
  )

  app.delete(
    '/liquidaciones-terceros/envios/job/:jobId',
    puedeEscribir,
    LiquidacionesTercerosEnviosController.cancelar,
  )
}
