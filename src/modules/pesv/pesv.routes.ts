import { FastifyInstance } from 'fastify'
import { authMiddleware } from '../../middlewares/auth.middleware'
import { requirePermission } from '../../middlewares/permissions.middleware'
import { PesvController } from './pesv.controller'

/**
 * Rutas HEREDADAS del panel PESV anterior.
 *
 * Se conservan durante la transición como adaptadores: la tabla de registros
 * diarios y las series de `excesos_velocidad` y `preoperacionales` siguen
 * sirviéndose desde aquí mientras el centro de cumplimiento
 * (`pesv-centro.routes.ts`) toma el relevo. Retirarlas ahora dejaría muda la
 * pantalla que la gente usa hoy.
 *
 * **No tenían autenticación.** Cualquiera con la URL leía el panel completo
 * —conductores, vehículos, clientes y siniestros— y podía escribir en
 * `dias_laborales_planillas`. Ahora exigen sesión y permiso del módulo, con la
 * escritura en `full` y la lectura en `read`.
 */
export async function pesvRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authMiddleware)

  const puedeLeer = { preHandler: requirePermission('pesv', 'read') }
  /// Escritura en `full`: estas rutas escriben campos PESV del día laboral y
  /// series históricas, que es justo lo que el expediente usa como referencia.
  const puedeEditar = { preHandler: requirePermission('pesv', 'full') }

  // Dashboard principal PESV
  app.get('/pesv/dashboard', {
    ...puedeLeer,
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
    ...puedeLeer,
    schema: {
      description: 'Obtener opciones de filtros para PESV',
      tags: ['pesv'],
    }
  }, PesvController.getFilterOptions)

  // ==================== EXCESOS VELOCIDAD ====================

  app.get('/pesv/excesos', {
    ...puedeLeer,
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
    ...puedeEditar,
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
    ...puedeEditar,
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
    ...puedeLeer,
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
    ...puedeEditar,
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
    ...puedeEditar,
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
    ...puedeLeer,
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
    ...puedeEditar,
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
