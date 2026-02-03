import { FastifyInstance } from 'fastify'
import { ClientesController } from './clientes.controller'
import { authMiddleware } from '../../middlewares/auth.middleware'

export async function clientesRoutes(app: FastifyInstance) {
  // Todas las rutas de clientes requieren autenticación
  app.addHook('onRequest', authMiddleware)
  
  // ⚠️ IMPORTANTE: Las rutas específicas DEBEN ir ANTES que las rutas con parámetros dinámicos

  // Rutas específicas (van antes que /:id)
  app.get('/empresas/basicos', {
    schema: {
      description: 'Obtener lista básica de clientes/empresas',
      tags: ['clientes'],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'array' },
            count: { type: 'number' }
          }
        }
      }
    }
  }, ClientesController.obtenerBasicos)

  // Alias para empresas (apunta a empresas/basicos)
  app.get('/empresas', {
    schema: {
      description: 'Obtener lista básica de clientes/empresas (alias)',
      tags: ['clientes'],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'array' },
            count: { type: 'number' }
          }
        }
      }
    }
  }, ClientesController.obtenerBasicos)

  app.get('/clientes/buscar', {
    schema: {
      description: 'Buscar clientes con filtros',
      tags: ['clientes'],
      querystring: {
        type: 'object',
        properties: {
          tipo: { type: 'string', enum: ['EMPRESA', 'PERSONA'] },
          requiere_osi: { type: 'string' },
          paga_recargos: { type: 'string' },
          search: { type: 'string' },
          page: { type: 'string' },
          limit: { type: 'string' }
        }
      }
    }
  }, ClientesController.buscar)

  // Rutas CRUD básicas
  app.get('/clientes', {
    schema: {
      description: 'Obtener todos los clientes con paginación y filtros',
      tags: ['clientes'],
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'string', default: '1' },
          limit: { type: 'string', default: '10' },
          tipo: { type: 'string', enum: ['EMPRESA', 'PERSONA_NATURAL', 'TODOS'] },
          search: { type: 'string', description: 'Búsqueda en nombre, NIT, representante, cédula, teléfono, correo y dirección' }
        }
      }
    }
  }, ClientesController.obtenerTodos)

  // Listar clientes ocultos (solo para administradores)
  // IMPORTANTE: Esta ruta debe ir ANTES de /clientes/:id
  app.get('/clientes/ocultos', {
    schema: {
      description: 'Obtener lista de clientes ocultos (solo admin)',
      tags: ['clientes'],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' },
            data: { type: 'array' },
            total: { type: 'number' }
          }
        },
        403: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' }
          }
        }
      }
    }
  }, ClientesController.obtenerOcultos)

  app.post('/clientes', {
    schema: {
      description: 'Crear nuevo cliente',
      tags: ['clientes'],
      body: {
        type: 'object',
        required: ['nombre'],
        properties: {
          tipo: { 
            type: 'string', 
            enum: ['EMPRESA', 'PERSONA'],
            default: 'EMPRESA'
          },
          nit: { type: 'string', nullable: true },
          nombre: { type: 'string' },
          representante: { type: 'string', nullable: true },
          cedula: { type: 'string', nullable: true },
          telefono: { type: 'string', nullable: true },
          direccion: { type: 'string', nullable: true },
          correo: { type: 'string', format: 'email', nullable: true },
          requiere_osi: { type: 'boolean', default: false },
          paga_recargos: { type: 'boolean', default: false }
        }
      }
    }
  }, ClientesController.crear)

  app.get('/clientes/:id', {
    schema: {
      description: 'Obtener cliente por ID',
      tags: ['clientes'],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid' }
        }
      }
    }
  }, ClientesController.obtenerPorId)

  app.put('/clientes/:id', {
    schema: {
      description: 'Actualizar cliente',
      tags: ['clientes'],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid' }
        }
      },
      body: {
        type: 'object',
        properties: {
          tipo: { type: 'string', enum: ['EMPRESA', 'PERSONA'] },
          nit: { type: 'string', nullable: true },
          nombre: { type: 'string' },
          representante: { type: 'string', nullable: true },
          cedula: { type: 'string', nullable: true },
          telefono: { type: 'string', nullable: true },
          direccion: { type: 'string', nullable: true },
          correo: { type: 'string', format: 'email', nullable: true },
          requiere_osi: { type: 'boolean' },
          paga_recargos: { type: 'boolean' }
        }
      }
    }
  }, ClientesController.actualizar)

  app.delete('/clientes/:id', {
    schema: {
      description: 'Eliminar cliente (soft delete)',
      tags: ['clientes'],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid' }
        }
      }
    }
  }, ClientesController.eliminar)

  // Rutas adicionales (van después de las rutas CRUD básicas)
  app.post('/clientes/:id/restore', {
    schema: {
      description: 'Restaurar cliente eliminado',
      tags: ['clientes'],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid' }
        }
      }
    }
  }, ClientesController.restaurar)

  app.get('/clientes/:id/stats', {
    schema: {
      description: 'Obtener estadísticas del cliente',
      tags: ['clientes'],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid' }
        }
      }
    }
  }, ClientesController.obtenerEstadisticas)

  // Cambiar estado de ocultamiento de un cliente (solo para administradores)
  app.patch('/clientes/:id/ocultar', {
    schema: {
      description: 'Ocultar o mostrar un cliente (solo admin)',
      tags: ['clientes'],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' }
        }
      },
      body: {
        type: 'object',
        required: ['oculto'],
        properties: {
          oculto: { type: 'boolean' }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' },
            data: { type: 'object' }
          }
        },
        403: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' }
          }
        },
        404: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' }
          }
        }
      }
    }
  }, ClientesController.cambiarEstadoOculto)
}
