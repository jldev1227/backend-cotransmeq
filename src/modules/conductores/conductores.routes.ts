import { FastifyInstance } from 'fastify'
import { ConductoresController } from './conductores.controller'
import { authMiddleware } from '../../middlewares/auth.middleware'

export async function conductoresRoutes(app: FastifyInstance) {
  // Todas las rutas de conductores requieren autenticación
  app.addHook('onRequest', authMiddleware)

  // GET /api/conductores/ocultos - Obtener conductores ocultos (solo admin)
  // IMPORTANTE: Esta ruta debe ir ANTES de /conductores/:id
  app.get('/conductores/ocultos', ConductoresController.obtenerOcultos)

  // GET /api/conductores/papelera - Obtener conductores en la papelera (solo admin)
  app.get('/conductores/papelera', ConductoresController.obtenerPapelera)

  // POST /api/conductores/masivo - Operaciones masivas (ocultar, eliminar, restaurar)
  app.post('/conductores/masivo', ConductoresController.operacionesMasivas)

  // GET /api/conductores - Obtener todos los conductores
  app.get('/conductores', ConductoresController.obtenerTodos)

  // GET /api/conductores/:id - Obtener un conductor por ID
  app.get('/conductores/:id', ConductoresController.obtenerPorId)

  // POST /api/conductores - Crear un nuevo conductor
  app.post('/conductores', ConductoresController.crear)

  // PUT /api/conductores/:id - Actualizar un conductor
  app.put('/conductores/:id', ConductoresController.actualizar)

  // PATCH /api/conductores/:id/estado - Actualizar solo el estado
  app.patch('/conductores/:id/estado', ConductoresController.actualizarEstado)

  // PATCH /api/conductores/:id/ocultar - Ocultar/mostrar conductor (solo admin)
  app.patch('/conductores/:id/ocultar', ConductoresController.cambiarEstadoOculto)

  // PATCH /api/conductores/:id/restaurar - Restaurar conductor de la papelera
  app.patch('/conductores/:id/restaurar', ConductoresController.restaurar)

  // DELETE /api/conductores/:id/permanente - Eliminar permanentemente
  app.delete('/conductores/:id/permanente', ConductoresController.eliminarPermanente)

  // GET /api/conductores/:id/relaciones - Preview de relaciones antes del borrado permanente
  app.get('/conductores/:id/relaciones', ConductoresController.obtenerRelaciones)

  // DELETE /api/conductores/:id - Eliminar conductor (soft delete)
  app.delete('/conductores/:id', ConductoresController.eliminar)

  // POST /api/conductores/:id/foto - Subir foto del conductor
  app.post('/conductores/:id/foto', {
    onRequest: authMiddleware
  }, ConductoresController.subirFoto)

  // DELETE /api/conductores/:id/foto - Eliminar foto del conductor
  app.delete('/conductores/:id/foto', ConductoresController.eliminarFoto)
}
