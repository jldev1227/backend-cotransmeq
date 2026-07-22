import { FastifyInstance } from 'fastify'
import { PesvController } from './pesv.controller'

export async function pesvRoutes(app: FastifyInstance) {

  // Dashboard principal PESV
  app.get('/pesv/dashboard', {
    schema: {
      description: 'Obtener dashboard PESV con indicadores y tabla agregada',
      tags: ['pesv'],
      querystring: {
        type: 'object',
        properties: {
          mes: { type: 'string' },
          anio: { type: 'string' },
          conductor_id: { type: 'string' },
          vehiculo_id: { type: 'string' },
          cliente_id: { type: 'string' },
          municipio_origen_id: { type: 'string' },
          municipio_destino_id: { type: 'string' },
          placa: { type: 'string' },
          page: { type: 'string' },
          limit: { type: 'string' },
        }
      }
    }
  }, PesvController.getDashboard)

  // Opciones de filtros (conductores, vehiculos, clientes, municipios)
  app.get('/pesv/options', {
    schema: {
      description: 'Obtener opciones de filtros para PESV',
      tags: ['pesv'],
    }
  }, PesvController.getFilterOptions)

  // ==================== EXCESOS VELOCIDAD ====================

  app.get('/pesv/excesos', {
    schema: {
      description: 'Obtener excesos de velocidad',
      tags: ['pesv'],
      querystring: {
        type: 'object',
        properties: {
          conductor_id: { type: 'string' },
          vehiculo_id: { type: 'string' },
          mes: { type: 'string' },
          anio: { type: 'string' },
        }
      }
    }
  }, PesvController.getExcesos)

  app.post('/pesv/excesos', {
    schema: {
      description: 'Crear o actualizar exceso de velocidad',
      tags: ['pesv'],
      body: {
        type: 'object',
        required: ['conductor_id', 'vehiculo_id', 'mes', 'anio', 'cantidad'],
        properties: {
          conductor_id: { type: 'string', format: 'uuid' },
          vehiculo_id: { type: 'string', format: 'uuid' },
          mes: { type: 'number', minimum: 1, maximum: 12 },
          anio: { type: 'number', minimum: 2020 },
          cantidad: { type: 'number', minimum: 0 },
          observaciones: { type: 'string' },
        }
      }
    }
  }, PesvController.upsertExceso)

  app.delete('/pesv/excesos/:id', {
    schema: {
      description: 'Eliminar registro de exceso de velocidad',
      tags: ['pesv'],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' }
        }
      }
    }
  }, PesvController.deleteExceso)

  // ==================== PREOPERACIONALES ====================

  app.get('/pesv/preoperacionales', {
    schema: {
      description: 'Obtener preoperacionales',
      tags: ['pesv'],
      querystring: {
        type: 'object',
        properties: {
          conductor_id: { type: 'string' },
          vehiculo_id: { type: 'string' },
          mes: { type: 'string' },
          anio: { type: 'string' },
          fecha_desde: { type: 'string' },
          fecha_hasta: { type: 'string' },
        }
      }
    }
  }, PesvController.getPreoperacionales)

  app.post('/pesv/preoperacionales', {
    schema: {
      description: 'Crear o actualizar preoperacional',
      tags: ['pesv'],
      body: {
        type: 'object',
        required: ['conductor_id', 'vehiculo_id', 'fecha', 'realizado'],
        properties: {
          conductor_id: { type: 'string', format: 'uuid' },
          vehiculo_id: { type: 'string', format: 'uuid' },
          fecha: { type: 'string', format: 'date' },
          realizado: { type: 'boolean' },
          observaciones: { type: 'string' },
        }
      }
    }
  }, PesvController.upsertPreoperacional)

  app.delete('/pesv/preoperacionales/:id', {
    schema: {
      description: 'Eliminar registro de preoperacional',
      tags: ['pesv'],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' }
        }
      }
    }
  }, PesvController.deletePreoperacional)

  // ==================== REGISTROS DIARIOS (TABLA PESV) ====================

  app.get('/pesv/registros-diarios', {
    schema: {
      description: 'Obtener registros diarios PESV con información de conductor, vehículo, cliente, origen/destino',
      tags: ['pesv'],
      querystring: {
        type: 'object',
        properties: {
          mes: { type: 'string' },
          anio: { type: 'string' },
          conductor_id: { type: 'string' },
          vehiculo_id: { type: 'string' },
          cliente_id: { type: 'string' },
        }
      }
    }
  }, PesvController.getRegistrosDiarios)

  app.patch('/pesv/registros-diarios/:id', {
    schema: {
      description: 'Actualizar campos PESV de un día laboral (horas sueño, excesos, preoperacional, siniestros)',
      tags: ['pesv'],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' }
        }
      },
      body: {
        type: 'object',
        properties: {
          horas_sueno: { type: ['number', 'null'] },
          excesos_velocidad_dia: { type: 'number', minimum: 0 },
          preoperacional_realizado: { type: 'boolean' },
          siniestros: { type: 'number', minimum: 0 },
          siniestros_detalle: { type: ['string', 'null'] },
        }
      }
    }
  }, PesvController.updateRegistroDiaPesv)
}
