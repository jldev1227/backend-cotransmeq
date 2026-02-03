import type { FastifyInstance } from 'fastify'
import { AsistenciasController } from './asistencias.controller'
import { authMiddleware } from '../../middlewares/auth.middleware'

export async function asistenciasRoutes(app: FastifyInstance) {
  // ============================================
  // RUTAS PROTEGIDAS (requieren autenticación)
  // ============================================

  // Crear formulario
  app.post('/asistencias/formularios', {
    onRequest: authMiddleware,
    schema: {
      description: 'Crear un nuevo formulario de asistencia',
      tags: ['asistencias'],
      body: {
        type: 'object',
        required: ['tematica', 'fecha'],
        properties: {
          tematica: { type: 'string' },
          objetivo: { type: 'string' },
          fecha: { type: 'string', format: 'date-time' },
          hora_inicio: { type: 'string', pattern: '^([0-1][0-9]|2[0-3]):([0-5][0-9])$' },
          hora_finalizacion: { type: 'string', pattern: '^([0-1][0-9]|2[0-3]):([0-5][0-9])$' },
          tipo_evento: { 
            type: 'string', 
            enum: ['capacitacion', 'asesoria', 'charla', 'induccion', 'reunion', 'divulgacion', 'otro']
          },
          tipo_evento_otro: { type: 'string' },
          lugar_sede: { type: 'string' },
          nombre_instructor: { type: 'string' }
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
  }, AsistenciasController.crear)

  // Obtener todos los formularios
  app.get('/asistencias/formularios', {
    onRequest: authMiddleware,
    schema: {
      description: 'Obtener todos los formularios de asistencia',
      tags: ['asistencias'],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: true
              }
            }
          }
        }
      }
    }
  }, AsistenciasController.obtenerTodos)

  // Obtener formulario por ID
  app.get('/asistencias/formularios/:id', {
    onRequest: authMiddleware,
    schema: {
      description: 'Obtener un formulario de asistencia por ID',
      tags: ['asistencias'],
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
              additionalProperties: true
            }
          }
        }
      }
    }
  }, AsistenciasController.obtenerPorId)

  // Actualizar formulario
  app.put('/asistencias/formularios/:id', {
    onRequest: authMiddleware,
    schema: {
      description: 'Actualizar un formulario de asistencia',
      tags: ['asistencias'],
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
            data: { 
              type: 'object',
              additionalProperties: true
            }
          }
        }
      }
    }
  }, AsistenciasController.actualizar)

  // Eliminar formulario
  app.delete('/asistencias/formularios/:id', {
    onRequest: authMiddleware,
    schema: {
      description: 'Eliminar un formulario de asistencia',
      tags: ['asistencias'],
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
  }, AsistenciasController.eliminar)

  // Obtener respuestas de un formulario
  app.get('/asistencias/formularios/:id/respuestas', {
    onRequest: authMiddleware,
    schema: {
      description: 'Obtener todas las respuestas de un formulario',
      tags: ['asistencias'],
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
            data: { type: 'array' }
          }
        }
      }
    }
  }, AsistenciasController.obtenerRespuestas)

  // Exportar respuestas a Excel
  app.get('/asistencias/formularios/:id/exportar', {
    onRequest: authMiddleware,
    schema: {
      description: 'Exportar respuestas de un formulario a Excel',
      tags: ['asistencias'],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' }
        }
      }
    }
  }, AsistenciasController.exportarRespuestas)

  // Exportar respuestas a PDF
  app.get('/asistencias/formularios/:id/exportar-pdf', {
    onRequest: authMiddleware,
    schema: {
      description: 'Exportar respuestas de un formulario a PDF',
      tags: ['asistencias'],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' }
        }
      }
    }
  }, AsistenciasController.exportarRespuestasPDF)

  // ============================================
  // RUTAS PÚBLICAS (sin autenticación)
  // ============================================

  // Obtener formulario por token (público)
  app.get('/public/asistencias/:token', {
    schema: {
      description: 'Obtener formulario de asistencia por token (público)',
      tags: ['asistencias-public'],
      params: {
        type: 'object',
        properties: {
          token: { type: 'string' }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                token: { type: 'string' },
                tematica: { type: 'string' },
                objetivo: { type: ['string', 'null'] },
                fecha: { type: 'string' },
                hora_inicio: { type: ['string', 'null'] },
                hora_finalizacion: { type: ['string', 'null'] },
                duracion_minutos: { type: ['number', 'null'] },
                tipo_evento: { type: 'string' },
                tipo_evento_otro: { type: ['string', 'null'] },
                lugar_sede: { type: ['string', 'null'] },
                nombre_instructor: { type: ['string', 'null'] },
                activo: { type: 'boolean' },
                created_at: { type: 'string' }
              }
            }
          }
        }
      }
    }
  }, AsistenciasController.obtenerPorToken)

  // Verificar si ya respondí (público)
  app.get('/public/asistencias/:token/verificar', {
    schema: {
      description: 'Verificar si un dispositivo ya respondió el formulario',
      tags: ['asistencias-public'],
      params: {
        type: 'object',
        properties: {
          token: { type: 'string' }
        }
      },
      querystring: {
        type: 'object',
        properties: {
          device_fingerprint: { type: 'string' }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { 
              type: 'object',
              additionalProperties: true
            }
          }
        }
      }
    }
  }, AsistenciasController.verificarMiRespuesta)

  // Enviar respuesta (público)
  app.post('/public/asistencias/:token/responder', {
    schema: {
      description: 'Enviar respuesta a un formulario de asistencia (público)',
      tags: ['asistencias-public'],
      params: {
        type: 'object',
        properties: {
          token: { type: 'string' }
        }
      },
      body: {
        type: 'object',
        required: ['nombre_completo', 'numero_documento', 'cargo', 'numero_telefono', 'firma', 'device_fingerprint'],
        properties: {
          nombre_completo: { type: 'string' },
          numero_documento: { type: 'string' },
          cargo: { type: 'string' },
          numero_telefono: { type: 'string' },
          firma: { type: 'string' },
          device_fingerprint: { type: 'string' }
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
  }, AsistenciasController.crearRespuesta)
}
