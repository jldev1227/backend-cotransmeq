import { FastifyInstance } from 'fastify'
import { ServiciosController } from './servicios.controller'

export async function serviciosRoutes(app: FastifyInstance) {
  
  // ⚠️ IMPORTANTE: Las rutas específicas DEBEN ir ANTES que las rutas con parámetros dinámicos

  // Rutas públicas (sin autenticación)
  app.get('/servicios/public/:token', {
    schema: {
      description: 'Obtener servicio por token público (sin autenticación)',
      tags: ['servicios-publico'],
      params: {
        type: 'object',
        properties: {
          token: { type: 'string' }
        }
      }
    }
  }, ServiciosController.obtenerPorTokenPublico)

  // Rutas específicas protegidas (van antes que /:id)
  app.get('/servicios/stats', {
    schema: {
      description: 'Obtener estadísticas de servicios',
      tags: ['servicios'],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                total: { type: 'number' },
                solicitado: { type: 'number' },
                en_curso: { type: 'number' },
                planificado: { type: 'number' },
                realizado: { type: 'number' },
                cancelado: { type: 'number' },
                liquidado: { type: 'number' }
              }
            }
          }
        }
      }
    }
  }, ServiciosController.obtenerStats)

  app.get('/servicios/buscar', {
    schema: {
      description: 'Buscar servicios con filtros',
      tags: ['servicios'],
      querystring: {
        type: 'object',
        properties: {
          estado: { type: 'string', enum: ['solicitado', 'asignado', 'en_curso', 'completado', 'cancelado'] },
          conductor_id: { type: 'string', format: 'uuid' },
          vehiculo_id: { type: 'string', format: 'uuid' },
          cliente_id: { type: 'string', format: 'uuid' },
          fecha_desde: { type: 'string', format: 'date-time' },
          fecha_hasta: { type: 'string', format: 'date-time' },
          proposito_servicio: { type: 'string', enum: ['personal', 'empresarial', 'medico', 'aeropuerto'] },
          page: { type: 'string' },
          limit: { type: 'string' }
        }
      }
    }
  }, ServiciosController.buscarServicios)

  // Rutas para obtener listas para filtros
  app.get('/servicios/filtros/conductores', {
    schema: {
      description: 'Obtener lista de conductores para filtros',
      tags: ['servicios-filtros'],
      querystring: {
        type: 'object',
        properties: {
          search: { type: 'string', description: 'Búsqueda por nombre, apellido o teléfono' }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'array' }
          }
        }
      }
    }
  }, ServiciosController.obtenerConductores)

  app.get('/servicios/filtros/vehiculos', {
    schema: {
      description: 'Obtener lista de vehículos para filtros',
      tags: ['servicios-filtros'],
      querystring: {
        type: 'object',
        properties: {
          search: { type: 'string', description: 'Búsqueda por placa, marca o modelo' }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'array' }
          }
        }
      }
    }
  }, ServiciosController.obtenerVehiculos)

  app.get('/servicios/filtros/clientes', {
    schema: {
      description: 'Obtener lista de clientes para filtros',
      tags: ['servicios-filtros'],
      querystring: {
        type: 'object',
        properties: {
          search: { type: 'string', description: 'Búsqueda por nombre o NIT' }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'array' }
          }
        }
      }
    }
  }, ServiciosController.obtenerClientes)

  // Rutas CRUD básicas
  app.get('/servicios', {
    schema: {
      description: 'Obtener lista de servicios con filtros avanzados',
      tags: ['servicios'],
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'string' },
          limit: { type: 'string' },
          estado: { type: 'string', enum: ['solicitado', 'en_curso', 'planificado', 'realizado', 'cancelado', 'liquidado'] },
          search: { type: 'string', description: 'Búsqueda por texto en origen, destino, cliente, conductor, vehículo' },
          conductor_id: { type: 'string', format: 'uuid', description: 'Filtrar por conductor' },
          vehiculo_id: { type: 'string', format: 'uuid', description: 'Filtrar por vehículo' },
          cliente_id: { type: 'string', format: 'uuid', description: 'Filtrar por cliente' },
          fecha_desde: { type: 'string', format: 'date', description: 'Fecha inicial para rango de búsqueda (formato: YYYY-MM-DD)' },
          fecha_hasta: { type: 'string', format: 'date', description: 'Fecha final para rango de búsqueda (formato: YYYY-MM-DD)' },
          campo_fecha: { type: 'string', enum: ['fecha_solicitud', 'fecha_realizacion', 'created_at', 'fecha_finalizacion'], description: 'Campo de fecha a usar para el filtro de rango (por defecto: fecha_solicitud)' },
          orderBy: { type: 'string', enum: ['fecha_solicitud', 'fecha_realizacion', 'estado', 'cliente', 'conductor'], description: 'Campo para ordenar' },
          orderDirection: { type: 'string', enum: ['asc', 'desc'], description: 'Dirección de ordenamiento' }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'array' },
            stats: {
              type: 'object',
              properties: {
                total: { type: 'number' },
                solicitado: { type: 'number' },
                en_curso: { type: 'number' },
                planificado: { type: 'number' },
                realizado: { type: 'number' },
                cancelado: { type: 'number' },
                liquidado: { type: 'number' }
              }
            },
            pagination: {
              type: 'object',
              properties: {
                page: { type: 'number' },
                limit: { type: 'number' },
                total: { type: 'number' },
                totalPages: { type: 'number' }
              }
            }
          }
        }
      }
    }
  }, ServiciosController.obtenerTodos)

  app.get('/servicios/:id', {
    schema: {
      description: 'Obtener servicio por ID',
      tags: ['servicios'],
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
              additionalProperties: true  // Permitir propiedades adicionales
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
  }, ServiciosController.obtenerPorId)

  // Ruta para generar rutograma en PDF
  app.get('/servicios/:id/rutograma', {
    schema: {
      description: 'Generar rutograma en PDF para un servicio',
      tags: ['servicios'],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' }
        },
        required: ['id']
      },
      response: {
        200: {
          description: 'PDF del rutograma',
          type: 'string',
          format: 'binary'
        },
        400: {
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
  }, ServiciosController.generarRutograma)

  // Rutas que requieren permisos de creación/edición
  app.post('/servicios', {
    schema: {
      description: 'Crear nuevo servicio',
      tags: ['servicios'],
      body: {
        type: 'object',
      required: ['cliente_id', 'origen_id', 'destino_id', 'fecha_solicitud'],
      properties: {
        conductor_id: { type: ['string', 'null'], format: 'uuid' },
        vehiculo_id: { type: ['string', 'null'], format: 'uuid' },
        cliente_id: { type: 'string', format: 'uuid' },
        origen_id: { type: 'string', format: 'uuid' },
        destino_id: { type: 'string', format: 'uuid' },
        origen_especifico: { type: 'string' },
        destino_especifico: { type: 'string' },
        estado: { type: 'string', enum: ['solicitado', 'planificado', 'en_curso', 'pendiente', 'realizado', 'planilla_asignada', 'liquidado', 'cancelado'] },
        proposito_servicio: { type: 'string', enum: ['personal', 'personal y herramienta', 'personal_y_herramienta'] },
        fecha_solicitud: { type: 'string', format: 'date-time' },
        fecha_realizacion: { type: 'string', format: 'date-time' },
        fecha_finalizacion: { type: ['string', 'null'], format: 'date-time' },
        origen_latitud: { type: 'number' },
        origen_longitud: { type: 'number' },
          destino_latitud: { type: 'number' },
          destino_longitud: { type: 'number' },
          valor: { type: 'number', minimum: 0 },
          numero_planilla: { type: 'string' },
          observaciones: { type: 'string' }
        }
      },
      response: {
        201: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' },
            data: { type: 'object' }
          }
        }
      }
    }
  }, ServiciosController.crear)

  app.put('/servicios/:id', {
    schema: {
      description: 'Actualizar servicio',
      tags: ['servicios'],
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
  }, ServiciosController.actualizar)

  // TODO: Agregar middleware de roles para estas rutas
  app.delete('/servicios/:id', {
    schema: {
      description: 'Eliminar servicio (requiere rol gestor_servicio o admin)',
      tags: ['servicios'],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' }
        }
      }
    }
  }, ServiciosController.eliminar)

  app.patch('/servicios/:id/cancelar', {
    schema: {
      description: 'Cancelar servicio (requiere rol gestor_servicio o admin)',
      tags: ['servicios'],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' }
        }
      },
      body: {
        type: 'object',
        properties: {
          observaciones: { type: 'string' }
        }
      }
    }
  }, ServiciosController.cancelar)

  // Rutas específicas para cambiar estado
  app.patch('/servicios/:id/estado', {
    schema: {
      description: 'Cambiar estado del servicio',
      tags: ['servicios'],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' }
        }
      },
      body: {
        type: 'object',
        required: ['estado'],
        properties: {
          estado: { type: 'string', enum: ['solicitado', 'asignado', 'en_curso', 'completado', 'cancelado'] },
          observaciones: { type: 'string' }
        }
      }
    }
  }, ServiciosController.cambiarEstado)

  // TODO: Agregar middleware de roles para esta ruta
  app.patch('/servicios/:id/planilla', {
    schema: {
      description: 'Asignar número de planilla (requiere rol gestor_planillas o admin)',
      tags: ['servicios'],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' }
        }
      },
      body: {
        type: 'object',
        required: ['numero_planilla'],
        properties: {
          numero_planilla: { type: 'string', minLength: 1 }
        }
      }
    }
  }, ServiciosController.asignarNumeroPlanilla)

  // Rutas para gestión de tokens públicos (TODO: Implementar JWT)
  app.post('/servicios/:id/compartir', {
    schema: {
      description: 'Generar enlace público para servicio',
      tags: ['servicios'],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' }
        }
      }
    }
  }, ServiciosController.generarEnlacePublico)

  app.delete('/servicios/token/:token', {
    schema: {
      description: 'Revocar token público',
      tags: ['servicios'],
      params: {
        type: 'object',
        properties: {
          token: { type: 'string' }
        }
      }
    }
  }, ServiciosController.revocarToken)
}