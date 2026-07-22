import { FastifyInstance } from 'fastify'
import { SalidasNCController } from './salidas-nc.controller'
import { authMiddleware } from '../../middlewares/auth.middleware'

export async function salidasNCRoutes(fastify: FastifyInstance) {
  // Todas las rutas requieren autenticación
  fastify.addHook('onRequest', authMiddleware)

  // POST /api/salidas-nc - Crear nueva salida no conforme
  fastify.post(
    '/salidas-nc',
    {
      schema: {
        tags: ['Salidas No Conformes'],
        description: 'Registrar nueva salida no conforme',
        body: {
          type: 'object',
          required: ['fecha_deteccion', 'fecha_evento', 'detectado_por', 'area_proceso', 'tipo_deteccion', 'descripcion_nc', 'clasificacion_nc', 'tipo_salida_nc'],
          properties: {
            // Sección 1
            fecha_deteccion: { type: 'string', format: 'date' },
            fecha_evento: { type: 'string', format: 'date' },
            detectado_por: { type: 'string' },
            area_proceso: { type: 'string' },
            tipo_deteccion: { type: 'string', enum: ['DURANTE_SERVICIO', 'POST_SERVICIO', 'AUDITORIA_INTERVENTORIA', 'REPORTE_CLIENTE', 'OTRO'] },
            tipo_deteccion_otro: { type: 'string' },
            vehiculo_placa: { type: 'string' },
            ruta_trayecto: { type: 'string' },
            turno_horario: { type: 'string' },
            conductor_nombre: { type: 'string' },
            conductor_cedula: { type: 'string' },
            cliente_contrato: { type: 'string' },
            servicio_afectado: { type: 'string' },
            // Sección 2
            descripcion_nc: { type: 'string' },
            clasificacion_nc: { type: 'string', enum: ['CRITICA', 'MAYOR', 'MENOR'] },
            tipo_salida_nc: { type: 'string', enum: [
              'GPS_SISTEMA_TECNOLOGICO',
              'INCUMPLIMIENTO_RUTA_HORARIO_DESTINO',
              'VEHICULO_DIFERENTE_SIN_APROBACION',
              'FALLA_MECANICA_ELECTRICA',
              'DOCUMENTACION_VENCIDA_INCOMPLETA',
              'CONDUCTOR_NO_APTO_INFRACCION_VIAL',
              'QUEJA_CLIENTE',
              'HALLAZGO_AUDITORIA_INTERVENTORIA_CLIENTE',
              'PERSONAL_NO_AUTORIZADO_TRANSPORTADO',
              'OTRO'
            ]},
            tipo_salida_nc_otro: { type: 'string' },
            // Relaciones
            conductor_id: { type: 'string' },
            vehiculo_id: { type: 'string' },
            cliente_id: { type: 'string' },
            observaciones: { type: 'string' },
          }
        }
      }
    },
    SalidasNCController.crear
  )

  // GET /api/salidas-nc - Listar con filtros y paginación
  fastify.get(
    '/salidas-nc',
    {
      schema: {
        tags: ['Salidas No Conformes'],
        description: 'Listar salidas no conformes con filtros y paginación',
        querystring: {
          type: 'object',
          properties: {
            page: { type: 'integer', default: 1 },
            limit: { type: 'integer', default: 10 },
            clasificacion_nc: { type: 'string' },
            tipo_deteccion: { type: 'string' },
            tipo_salida_nc: { type: 'string' },
            estado: { type: 'string' },
            fecha_desde: { type: 'string' },
            fecha_hasta: { type: 'string' },
            busqueda: { type: 'string' },
            sortBy: { type: 'string' },
            sortOrder: { type: 'string' },
          }
        }
      }
    },
    SalidasNCController.listar
  )

  // GET /api/salidas-nc/estadisticas
  fastify.get(
    '/salidas-nc/estadisticas',
    {
      schema: {
        tags: ['Salidas No Conformes'],
        description: 'Obtener estadísticas de salidas no conformes',
      }
    },
    SalidasNCController.estadisticas
  )

  // GET /api/salidas-nc/siguiente-numero
  fastify.get(
    '/salidas-nc/siguiente-numero',
    {
      schema: {
        tags: ['Salidas No Conformes'],
        description: 'Obtener el siguiente número de SNC',
      }
    },
    SalidasNCController.siguienteNumero
  )

  // GET /api/salidas-nc/:id/pdf - Generar PDF
  fastify.get(
    '/salidas-nc/:id/pdf',
    {
      schema: {
        tags: ['Salidas No Conformes'],
        description: 'Generar PDF de una salida no conforme',
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string' }
          }
        }
      }
    },
    SalidasNCController.generarPDF
  )

  // GET /api/salidas-nc/:id
  fastify.get(
    '/salidas-nc/:id',
    {
      schema: {
        tags: ['Salidas No Conformes'],
        description: 'Obtener salida no conforme por ID',
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string' }
          }
        }
      }
    },
    SalidasNCController.obtenerPorId
  )

  // PUT /api/salidas-nc/:id
  fastify.put(
    '/salidas-nc/:id',
    {
      schema: {
        tags: ['Salidas No Conformes'],
        description: 'Actualizar salida no conforme',
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string' }
          }
        }
      }
    },
    SalidasNCController.actualizar
  )

  // DELETE /api/salidas-nc/:id
  fastify.delete(
    '/salidas-nc/:id',
    {
      schema: {
        tags: ['Salidas No Conformes'],
        description: 'Eliminar salida no conforme',
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string' }
          }
        }
      }
    },
    SalidasNCController.eliminar
  )
}
