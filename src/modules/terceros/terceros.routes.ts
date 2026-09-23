import { FastifyInstance } from 'fastify';
import { TercerosController } from './terceros.controller';
import { authMiddleware } from '../../middlewares/auth.middleware'
import { requirePermission } from '../../middlewares/permissions.middleware';

export async function tercerosRoutes(app: FastifyInstance) {
  // Todas las rutas requieren autenticación
  app.addHook('onRequest', authMiddleware)

  /**
   * Escribir exige nivel `full` sobre el módulo `terceros`.
   *
   * Las LECTURAS se quedan sólo con la sesión a propósito: exigirles `read`
   * dejaría fuera a quien tenga `limited`, que hoy sí consulta, y esto no va de
   * recortar a nadie sino de que «Consulta» deje de ser decorativo.
   *
   * Respeta `PERMISSIONS_MODE`: en `warn` los rechazos por ÁREA sólo se
   * registran, mientras que un recorte escrito en `permisos_rutas` se aplica
   * siempre (ver `permissions.middleware.ts`).
   */
  const puedeEscribir = { preHandler: requirePermission('terceros', 'full') }
;

  // ─── Rutas específicas (antes de /:id) ───

  // Importar terceros desde la tabla de vehículos
  app.post('/terceros/importar-vehiculos', {
    ...puedeEscribir,
    schema: {
      description: 'Importar terceros desde propietarios de vehículos',
      tags: ['terceros'],
    },
  }, TercerosController.importarDesdeVehiculos);

  // Búsqueda ligera para autocomplete (searchable select)
  app.get('/terceros/buscar', {
    schema: {
      description: 'Buscar terceros por nombre o identificación (autocomplete)',
      tags: ['terceros'],
      querystring: {
        type: 'object',
        properties: {
          q: { type: 'string', description: 'Texto de búsqueda' },
        },
      },
    },
  }, TercerosController.buscar);

  // ─── CRUD ───

  // Listar terceros con paginación y filtros
  app.get('/terceros', {
    schema: {
      description: 'Obtener todos los terceros con paginación y filtros',
      tags: ['terceros'],
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'string', default: '1' },
          limit: { type: 'string', default: '20' },
          tipo_persona: { type: 'string', enum: ['PERSONA', 'EMPRESA', 'TODOS'] },
          search: { type: 'string', description: 'Búsqueda en nombre, identificación, teléfono, correo' },
        },
      },
    },
  }, TercerosController.obtenerTodos);

  // Crear tercero
  app.post('/terceros', {
    ...puedeEscribir,
    schema: {
      description: 'Crear un nuevo tercero',
      tags: ['terceros'],
    },
  }, TercerosController.crear);

  // Obtener tercero por ID
  app.get('/terceros/:id', {
    schema: {
      description: 'Obtener un tercero por ID',
      tags: ['terceros'],
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } },
        required: ['id'],
      },
    },
  }, TercerosController.obtenerPorId);

  // Actualizar tercero
  app.put('/terceros/:id', {
    ...puedeEscribir,
    schema: {
      description: 'Actualizar un tercero',
      tags: ['terceros'],
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } },
        required: ['id'],
      },
    },
  }, TercerosController.actualizar);

  // Eliminar tercero (soft delete)
  app.delete('/terceros/:id', {
    ...puedeEscribir,
    schema: {
      description: 'Eliminar un tercero',
      tags: ['terceros'],
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } },
        required: ['id'],
      },
    },
  }, TercerosController.eliminar);
}
