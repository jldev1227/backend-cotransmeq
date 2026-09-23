import { FastifyInstance } from 'fastify'
import { ConductoresController } from './conductores.controller'
import { authMiddleware } from '../../middlewares/auth.middleware'
import { requirePermission } from '../../middlewares/permissions.middleware'

export async function conductoresRoutes(app: FastifyInstance) {
  // Todas las rutas de conductores requieren autenticación
  app.addHook('onRequest', authMiddleware)

  /**
   * Escribir exige nivel `full` sobre el módulo `conductores`.
   *
   * Las LECTURAS se quedan sólo con la sesión a propósito: exigirles `read`
   * dejaría fuera a quien tenga `limited`, que hoy sí consulta, y esto no va de
   * recortar a nadie sino de que «Consulta» deje de ser decorativo.
   *
   * Respeta `PERMISSIONS_MODE`: en `warn` los rechazos por ÁREA sólo se
   * registran, mientras que un recorte escrito en `permisos_rutas` se aplica
   * siempre (ver `permissions.middleware.ts`).
   */
  const puedeEscribir = { preHandler: requirePermission('conductores', 'full') }


  // GET /api/conductores/ocultos - Obtener conductores ocultos (solo admin)
  // IMPORTANTE: Esta ruta debe ir ANTES de /conductores/:id
  app.get('/conductores/ocultos', ConductoresController.obtenerOcultos)

  // GET /api/conductores/papelera - Obtener conductores en la papelera (solo admin)
  app.get('/conductores/papelera', ConductoresController.obtenerPapelera)

  // POST /api/conductores/masivo - Operaciones masivas (ocultar, eliminar, restaurar)
  app.post('/conductores/masivo', puedeEscribir, ConductoresController.operacionesMasivas)

  // GET /api/conductores/select-list - Listado liviano para <select>
  // Solo activos, no ocultos, sin fotos (optimizado para formularios
  // donde solo se necesita id + nombre + identificación).
  // IMPORTANTE: esta ruta debe ir ANTES de /:id.
  app.get('/conductores/select-list', ConductoresController.listarParaSelect)

  // GET /api/conductores - Obtener todos los conductores
  app.get('/conductores', ConductoresController.obtenerTodos)

  // GET /api/conductores/:id - Obtener un conductor por ID
  app.get('/conductores/:id', ConductoresController.obtenerPorId)

  // POST /api/conductores - Crear un nuevo conductor
  app.post('/conductores', puedeEscribir, ConductoresController.crear)

  // PUT /api/conductores/:id - Actualizar un conductor
  app.put('/conductores/:id', puedeEscribir, ConductoresController.actualizar)

  // PATCH /api/conductores/:id/estado - Actualizar solo el estado
  app.patch('/conductores/:id/estado', puedeEscribir, ConductoresController.actualizarEstado)

  // PATCH /api/conductores/:id/ocultar - Ocultar/mostrar conductor (solo admin)
  app.patch('/conductores/:id/ocultar', puedeEscribir, ConductoresController.cambiarEstadoOculto)

  // PATCH /api/conductores/:id/restaurar - Restaurar conductor de la papelera
  app.patch('/conductores/:id/restaurar', puedeEscribir, ConductoresController.restaurar)

  // DELETE /api/conductores/:id/permanente - Eliminar permanentemente
  app.delete('/conductores/:id/permanente', puedeEscribir, ConductoresController.eliminarPermanente)

  // GET /api/conductores/:id/relaciones - Preview de relaciones antes del borrado permanente
  app.get('/conductores/:id/relaciones', ConductoresController.obtenerRelaciones)

  // DELETE /api/conductores/:id - Eliminar conductor (soft delete)
  app.delete('/conductores/:id', puedeEscribir, ConductoresController.eliminar)

  // POST /api/conductores/:id/foto - Subir foto del conductor
  app.post('/conductores/:id/foto', {
    ...puedeEscribir,
    onRequest: authMiddleware
  }, ConductoresController.subirFoto)

  // DELETE /api/conductores/:id/foto - Eliminar foto del conductor
  app.delete('/conductores/:id/foto', puedeEscribir, ConductoresController.eliminarFoto)
}
