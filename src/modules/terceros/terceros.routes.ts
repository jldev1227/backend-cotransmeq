import { FastifyInstance } from 'fastify';
import { TercerosController } from './terceros.controller';
import { authMiddleware } from '../../middlewares/auth.middleware';

export async function tercerosRoutes(app: FastifyInstance) {
  // Todas las rutas requieren autenticación
  app.addHook('onRequest', authMiddleware);

  // ─── Rutas específicas (antes de /:id) ───

  // Importar terceros desde la tabla de vehículos
  app.post('/terceros/importar-vehiculos', {
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
