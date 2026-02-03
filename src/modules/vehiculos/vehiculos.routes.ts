import { FastifyInstance } from 'fastify'
import { VehiculosController } from './vehiculos.controller'
import { authMiddleware } from '../../middlewares/auth.middleware'

export async function vehiculosRoutes(app: FastifyInstance) {
  // Todas las rutas de vehículos requieren autenticación
  app.addHook('onRequest', authMiddleware)

  // Listar vehículos básicos (debe ir antes de /vehiculos para evitar conflictos)
  app.get('/flota/basicos', {
    schema: {
      description: 'Obtener lista básica de vehículos',
      tags: ['vehiculos'],
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
  }, VehiculosController.listBasicos)

  // Listar todos los vehículos
  app.get('/vehiculos', {
    schema: {
      description: 'Obtener lista de vehículos',
      tags: ['vehiculos'],
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
  }, VehiculosController.list)

  // Listar vehículos ocultos (solo para administradores)
  // IMPORTANTE: Esta ruta debe ir ANTES de /vehiculos/:id
  app.get('/vehiculos/ocultos', {
    schema: {
      description: 'Obtener lista de vehículos ocultos (solo admin)',
      tags: ['vehiculos'],
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
  }, VehiculosController.obtenerOcultos)

  // Crear nuevo vehículo
  app.post('/vehiculos', {
    schema: {
      description: 'Crear nuevo vehículo',
      tags: ['vehiculos'],
      body: {
        type: 'object',
        required: ['placa', 'clase_vehiculo'],
        properties: {
          placa: { type: 'string', minLength: 6 },
          marca: { type: 'string', minLength: 2 },
          linea: { type: 'string', minLength: 2 },
          modelo: { type: 'string', minLength: 1 },
          color: { type: 'string' },
          clase_vehiculo: { type: 'string', minLength: 2 },
          tipo_carroceria: { type: 'string' },
          combustible: { type: 'string' },
          numero_motor: { type: 'string' },
          vin: { type: 'string' },
          numero_serie: { type: 'string' },
          numero_chasis: { type: 'string' },
          propietario_nombre: { type: 'string' },
          propietario_identificacion: { type: 'string' },
          kilometraje: { type: 'number', minimum: 0 },
          capacidad_pasajeros: { type: 'number', minimum: 1 },
          estado: { type: 'string', enum: ['DISPONIBLE', 'SERVICIO', 'MANTENIMIENTO', 'DESVINCULADO'] },
          fecha_matricula: { type: 'string' },
          conductor_id: { type: 'string', format: 'uuid' }
        }
      },
      response: {
        201: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' },
            data: { 
              type: 'object',
              additionalProperties: true
            }
          }
        }
      }
    }
  }, VehiculosController.create)

  // Obtener vehículo por ID
  app.get('/vehiculos/:id', {
    schema: {
      description: 'Obtener vehículo por ID',
      tags: ['vehiculos'],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { 
              type: 'object',
              additionalProperties: true  // ¡PERMITIR TODAS LAS PROPIEDADES!
            }
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
  }, VehiculosController.getById)

  // Actualizar vehículo
  app.put('/vehiculos/:id', {
    schema: {
      description: 'Actualizar vehículo',
      tags: ['vehiculos'],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' }
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
        }
      }
    }
  }, VehiculosController.update)

  // Eliminar vehículo (soft delete)
  app.delete('/vehiculos/:id', {
    schema: {
      description: 'Eliminar vehículo (soft delete)',
      tags: ['vehiculos'],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' }
          }
        }
      }
    }
  }, VehiculosController.delete)

  // Listar vehículos eliminados (solo para administradores)
  app.get('/vehiculos/deleted/list', {
    schema: {
      description: 'Obtener lista de vehículos eliminados',
      tags: ['vehiculos'],
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
  }, VehiculosController.listDeleted)

  // Restaurar vehículo eliminado (solo para administradores)
  app.post('/vehiculos/:id/restore', {
    schema: {
      description: 'Restaurar vehículo eliminado',
      tags: ['vehiculos'],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' }
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
        }
      }
    }
  }, VehiculosController.restore)

  // Cambiar estado de ocultamiento de un vehículo (solo para administradores)
  app.patch('/vehiculos/:id/ocultar', {
    schema: {
      description: 'Ocultar o mostrar un vehículo (solo admin)',
      tags: ['vehiculos'],
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
  }, VehiculosController.cambiarEstadoOculto)
}
