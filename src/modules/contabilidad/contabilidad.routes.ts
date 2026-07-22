import { FastifyInstance } from 'fastify'
import { ConciliacionTercerosController } from './conciliacion-terceros.controller'
import { authMiddleware } from '../../middlewares/auth.middleware'

export async function contabilidadRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authMiddleware)

  // Conciliación de facturas con terceros - procesar y devolver JSON
  app.post('/contabilidad/conciliacion-terceros', {
    schema: {
      description: 'Procesar conciliación de facturas entre software contable y liquidaciones de terceros',
      tags: ['contabilidad'],
      consumes: ['multipart/form-data'],
    }
  }, ConciliacionTercerosController.procesar)

  // Conciliación de facturas con terceros - generar y descargar Excel
  app.post('/contabilidad/conciliacion-terceros/excel', {
    schema: {
      description: 'Generar Excel de conciliación de facturas con terceros',
      tags: ['contabilidad'],
      consumes: ['multipart/form-data'],
    }
  }, ConciliacionTercerosController.descargarExcel)
}
