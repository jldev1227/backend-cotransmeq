import { FastifyInstance } from 'fastify'
import { AccionesCorrectivasController } from './acciones-correctivas.controller'
import { authMiddleware } from '../../middlewares/auth.middleware'

export async function accionesCorrectivasRoutes(fastify: FastifyInstance) {
  // Todas las rutas requieren autenticación
  fastify.addHook('onRequest', authMiddleware)

  // POST /api/acciones-correctivas - Crear nueva acción
  fastify.post(
    '/acciones-correctivas',
    {
      schema: {
        tags: ['Acciones Correctivas'],
        description: 'Crear nueva acción correctiva/preventiva',
        body: {
          type: 'object',
          required: ['accion_numero'],
          properties: {
            accion_numero: { type: 'string' },
            lugar_sede: { type: 'string' },
            proceso_origen_hallazgo: { type: 'string' },
            componente_elemento_referencia: { type: 'string' },
            fuente_genero_hallazgo: { type: 'string' },
            marco_legal_normativo: { type: 'string' },
            fecha_identificacion_hallazgo: { type: 'string', format: 'date' },
            descripcion_hallazgo: { type: 'string' },
            tipo_hallazgo_detectado: { type: 'string' },
            variable_categoria_analisis: { type: 'string' },
            correccion_solucion_inmediata: { type: 'string' },
            fecha_implementacion: { type: 'string', format: 'date' },
            valoracion_riesgo: { type: 'string', enum: ['ALTO', 'MEDIO', 'BAJO'] },
            requiere_actualizar_matriz: { type: 'string' },
            tipo_accion_ejecutar: { type: 'string', enum: ['CORRECTIVA', 'PREVENTIVA', 'MEJORA'] },
            analisis_causas: { type: 'array', items: { type: 'string' } },
            descripcion_accion_plan: { type: 'string' },
            fecha_limite_implementacion: { type: 'string', format: 'date' },
            responsable_ejecucion: { type: 'string' },
            fecha_seguimiento: { type: 'string', format: 'date' },
            estado_accion_planeada: { type: 'string', enum: ['Cumplidas', 'En Proceso', 'Vencidas'] },
            descripcion_estado_observaciones: { type: 'string' },
            fecha_evaluacion_eficacia: { type: 'string', format: 'date' },
            criterio_evaluacion_eficacia: { type: 'string' },
            analisis_evidencias_cierre: { type: 'string' },
            evaluacion_cierre_eficaz: { type: 'string', enum: ['EFICAZ', 'NO EFICAZ'] },
            soporte_cierre_eficaz: { type: 'string' },
            fecha_cierre_definitivo: { type: 'string', format: 'date' },
            responsable_cierre: { type: 'string' }
          }
        }
      }
    },
    AccionesCorrectivasController.crear
  )

  // GET /api/acciones-correctivas - Listar con filtros
  fastify.get(
    '/acciones-correctivas',
    {
      schema: {
        tags: ['Acciones Correctivas'],
        description: 'Listar acciones correctivas/preventivas con filtros',
        querystring: {
          type: 'object',
          properties: {
            tipo_accion_ejecutar: { type: 'string' },
            estado_accion_planeada: { type: 'string' },
            valoracion_riesgo: { type: 'string' },
            fecha_desde: { type: 'string', format: 'date' },
            fecha_hasta: { type: 'string', format: 'date' },
            busqueda: { type: 'string' },
            page: { type: 'integer', minimum: 1, default: 1 },
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 }
          }
        }
      }
    },
    AccionesCorrectivasController.listar
  )

  // GET /api/acciones-correctivas/estadisticas - Estadísticas
  fastify.get(
    '/acciones-correctivas/estadisticas',
    {
      schema: {
        tags: ['Acciones Correctivas'],
        description: 'Obtener estadísticas de acciones correctivas/preventivas'
      }
    },
    AccionesCorrectivasController.obtenerEstadisticas
  )

  // GET /api/acciones-correctivas/:id - Obtener por ID
  fastify.get(
    '/acciones-correctivas/:id',
    {
      schema: {
        tags: ['Acciones Correctivas'],
        description: 'Obtener acción por ID',
        params: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' }
          },
          required: ['id']
        }
      }
    },
    AccionesCorrectivasController.obtenerPorId
  )

  // GET /api/acciones-correctivas/numero/:accion_numero - Obtener por número
  fastify.get(
    '/acciones-correctivas/numero/:accion_numero',
    {
      schema: {
        tags: ['Acciones Correctivas'],
        description: 'Obtener acción por número',
        params: {
          type: 'object',
          properties: {
            accion_numero: { type: 'string' }
          },
          required: ['accion_numero']
        }
      }
    },
    AccionesCorrectivasController.obtenerPorNumero
  )

  // PUT /api/acciones-correctivas/:id - Actualizar
  fastify.put(
    '/acciones-correctivas/:id',
    {
      schema: {
        tags: ['Acciones Correctivas'],
        description: 'Actualizar acción correctiva/preventiva',
        params: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' }
          },
          required: ['id']
        },
        body: {
          type: 'object',
          properties: {
            accion_numero: { type: 'string' },
            lugar_sede: { type: 'string' },
            proceso_origen_hallazgo: { type: 'string' },
            // ... (resto de campos similares al POST)
          }
        }
      }
    },
    AccionesCorrectivasController.actualizar
  )

  // DELETE /api/acciones-correctivas/:id - Eliminar
  fastify.delete(
    '/acciones-correctivas/:id',
    {
      schema: {
        tags: ['Acciones Correctivas'],
        description: 'Eliminar acción correctiva/preventiva',
        params: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' }
          },
          required: ['id']
        }
      }
    },
    AccionesCorrectivasController.eliminar
  )

  // GET /api/acciones-correctivas/:id/exportar-pdf - Exportar PDF
  fastify.get(
    '/acciones-correctivas/:id/exportar-pdf',
    {
      schema: {
        tags: ['Acciones Correctivas'],
        description: 'Exportar acción a PDF',
        params: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' }
          },
          required: ['id']
        }
      }
    },
    AccionesCorrectivasController.exportarPDF
  )
}
