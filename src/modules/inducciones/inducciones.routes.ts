import type { FastifyInstance } from 'fastify'
import { InduccionesController } from './inducciones.controller'
import { authMiddleware } from '../../middlewares/auth.middleware'

export async function induccionesRoutes(app: FastifyInstance) {
  // ============================================
  // RUTA PÚBLICA — crear inducción (visitante)
  // ============================================

  // Crear inducción (sin autenticación — el visitante lo llena desde su celular)
  app.post('/inducciones', {
    schema: {
      description: 'Registrar una nueva inducción/reinducción de visitante (HSEQ-FR-66)',
      tags: ['inducciones'],
      body: {
        type: 'object',
        required: [
          'sede', 'fecha',
          'visitante_nombre', 'visitante_cargo', 'visitante_cedula',
          'visitante_entidad', 'visitante_firma', 'temas_informados'
        ],
        properties: {
          sede: { type: 'string', enum: ['yopal', 'villanueva', 'ambas', 'lugar_prestacion'] },
          fecha: { type: 'string', format: 'date-time' },
          visitante_nombre: { type: 'string' },
          visitante_cargo: { type: 'string' },
          visitante_cedula: { type: 'string' },
          visitante_entidad: { type: 'string' },
          visitante_firma: { type: 'string', description: 'Firma en Base64' },
          temas_informados: { type: 'object', additionalProperties: true },
          observaciones: { type: 'string' }
        }
      },
      response: {
        201: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' },
            data: { type: 'object', additionalProperties: true }
          }
        }
      }
    }
  }, InduccionesController.crear)

  // Obtener todas las inducciones con filtros y paginación
  app.get('/inducciones', {
    onRequest: authMiddleware,
    schema: {
      description: 'Obtener listado de inducciones con filtros y paginación',
      tags: ['inducciones'],
      querystring: {
        type: 'object',
        properties: {
          sede: { type: 'string', enum: ['yopal', 'villanueva', 'ambas', 'lugar_prestacion'] },
          fecha_desde: { type: 'string', format: 'date-time' },
          fecha_hasta: { type: 'string', format: 'date-time' },
          visitante_nombre: { type: 'string' },
          visitante_entidad: { type: 'string' },
          page: { type: 'integer', minimum: 1, default: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'array',
              items: { type: 'object', additionalProperties: true }
            },
            pagination: {
              type: 'object',
              properties: {
                total: { type: 'integer' },
                page: { type: 'integer' },
                limit: { type: 'integer' },
                totalPages: { type: 'integer' }
              }
            }
          }
        }
      }
    }
  }, InduccionesController.obtenerTodos)

  // Estadísticas — ANTES de /:id para evitar colisión
  app.get('/inducciones/estadisticas', {
    onRequest: authMiddleware,
    schema: {
      description: 'Estadísticas de inducciones (total, por sede, conformidad promedio)',
      tags: ['inducciones'],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                total: { type: 'integer' },
                ultimo_mes: { type: 'integer' },
                promedio_conformidad: { type: 'integer' },
                por_sede: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      sede: { type: 'string' },
                      cantidad: { type: 'integer' }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }, InduccionesController.obtenerEstadisticas)

  // Obtener inducción por ID
  app.get('/inducciones/:id', {
    onRequest: authMiddleware,
    schema: {
      description: 'Obtener una inducción por ID',
      tags: ['inducciones'],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string' }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'object', additionalProperties: true }
          }
        }
      }
    }
  }, InduccionesController.obtenerPorId)

  // Actualizar inducción
  app.patch('/inducciones/:id', {
    onRequest: authMiddleware,
    schema: {
      description: 'Actualizar una inducción existente',
      tags: ['inducciones'],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string' }
        }
      },
      body: {
        type: 'object',
        properties: {
          sede: { type: 'string', enum: ['yopal', 'villanueva', 'ambas', 'lugar_prestacion'] },
          fecha: { type: 'string', format: 'date-time' },
          visitante_nombre: { type: 'string' },
          visitante_cargo: { type: 'string' },
          visitante_cedula: { type: 'string' },
          visitante_entidad: { type: 'string' },
          visitante_firma: { type: 'string' },
          temas_informados: { type: 'object', additionalProperties: true },
          observaciones: { type: 'string' }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' },
            data: { type: 'object', additionalProperties: true }
          }
        }
      }
    }
  }, InduccionesController.actualizar)

  // Eliminar inducción
  app.delete('/inducciones/:id', {
    onRequest: authMiddleware,
    schema: {
      description: 'Eliminar una inducción',
      tags: ['inducciones'],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string' }
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
  }, InduccionesController.eliminar)

  // Exportar a Excel
  app.get('/inducciones/:id/exportar/excel', {
    onRequest: authMiddleware,
    schema: {
      description: 'Exportar una inducción a Excel (HSEQ-FR-66)',
      tags: ['inducciones'],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string' }
        }
      }
    }
  }, InduccionesController.exportarExcel)

  // Exportar a PDF
  app.get('/inducciones/:id/exportar/pdf', {
    onRequest: authMiddleware,
    schema: {
      description: 'Exportar una inducción a PDF (HSEQ-FR-66)',
      tags: ['inducciones'],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string' }
        }
      }
    }
  }, InduccionesController.exportarPDF)
}