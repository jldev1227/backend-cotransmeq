import type { FastifyInstance } from 'fastify'
import { FormulariosSarlaftController } from './formularios-sarlaft.controller'
import { authMiddleware } from '../../middlewares/auth.middleware'

/**
 * Rutas para los formularios SARLAFT + PTEE.
 * - Públicas: las que diligencian clientes/proveedores/accionistas/empleados
 *   desde el sitio web público (sin auth).
 * - Admin: para el dashboard de cumplimiento (requieren auth).
 */
export async function formulariosSarlaftRoutes(app: FastifyInstance) {
  // Listado resumido de formularios disponibles
  app.get(
    '/public/formularios-sarlaft',
    {
      schema: {
        description: 'Lista de formularios SARLAFT + PTEE disponibles para diligenciamiento público',
        tags: ['formularios-sarlaft-publicos'],
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              formularios: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    codigo: { type: 'string' },
                    tipo: { type: 'string' },
                    titulo: { type: 'string' },
                    version: { type: 'string' },
                    fecha_documento: { type: 'string' },
                    total_secciones: { type: 'integer' },
                    total_preguntas: { type: 'integer' }
                  }
                }
              },
              marco_normativo: { type: 'array', items: { type: 'string' } },
              empresa: { type: 'string' }
            }
          }
        }
      }
    },
    FormulariosSarlaftController.listarFormulariosPublicos
  )

  // Estructura completa de un formulario específico
  app.get(
    '/public/formularios-sarlaft/:codigo',
    {
      schema: {
        description: 'Estructura completa del formulario (secciones + preguntas) para renderizado dinámico',
        tags: ['formularios-sarlaft-publicos'],
        params: {
          type: 'object',
          properties: {
            codigo: { type: 'string', enum: ['GC-FR-04', 'GC-FR-05', 'GC-FR-06'] }
          },
          required: ['codigo']
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              formulario: { type: 'object', additionalProperties: true }
            }
          },
          404: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: { type: 'string' }
            }
          }
        }
      }
    },
    FormulariosSarlaftController.obtenerFormularioPublico
  )

  // Documentos requeridos para un formulario
  app.get(
    '/public/formularios-sarlaft/:codigo/documentos',
    {
      schema: {
        description: 'Lista de documentos a anexar para el formulario indicado',
        tags: ['formularios-sarlaft-publicos'],
        querystring: {
          type: 'object',
          properties: {
            tipo_cliente: { type: 'string', enum: ['Persona Natural', 'Persona Jurídica'] }
          }
        }
      }
    },
    FormulariosSarlaftController.obtenerDocumentosRequeridos
  )

  // Recepción del envío (submit) — multipart con archivos.
  // preHandler que parsea el multipart manualmente y adjunta los archivos
  // y el payload como propiedades del request para el controller.
  app.post(
    '/public/formularios-sarlaft',
    {
      preHandler: async (request: any, _reply: any) => {
        if (request.isMultipart && request.isMultipart()) {
          const archivos: any[] = []
          let payloadStr: string | null = null
          const parts = request.parts()
          for await (const part of parts) {
            if (part.type === 'file') {
              const buffer = await part.toBuffer()
              archivos.push({
                fieldname: part.fieldname,
                filename: part.filename,
                mimetype: part.mimetype,
                buffer,
                size: buffer.length
              })
            } else if (part.fieldname === 'payload') {
              payloadStr = typeof part.value === 'string' ? part.value : part.value?.toString?.('utf-8')
            }
          }
          request.sarlaftArchivos = archivos
          request.sarlaftPayloadStr = payloadStr
        }
      }
    },
    FormulariosSarlaftController.submit as any
  )

  // ════════════════════════════════════════════════════════
  // RUTAS ADMIN (requieren autenticación)
  // ════════════════════════════════════════════════════════

  // Listado paginado
  app.get(
    '/formularios-sarlaft',
    {
      preHandler: [authMiddleware],
      schema: {
        description: 'Listado paginado de formularios SARLAFT recibidos (admin)',
        tags: ['formularios-sarlaft-admin'],
        querystring: {
          type: 'object',
          properties: {
            page: { type: 'integer', minimum: 1, default: 1 },
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
            search: { type: 'string' },
            tipo_formulario: { type: 'string', enum: ['cliente_proveedor', 'accionistas', 'personal'] },
            estado: { type: 'string' },
            fecha_desde: { type: 'string', format: 'date' },
            fecha_hasta: { type: 'string', format: 'date' }
          }
        }
      }
    },
    FormulariosSarlaftController.listarAdmin as any
  )

  // Detalle completo
  app.get(
    '/formularios-sarlaft/:id',
    {
      preHandler: [authMiddleware],
      schema: {
        description: 'Detalle completo de un formulario con respuestas y documentos',
        tags: ['formularios-sarlaft-admin'],
        params: {
          type: 'object',
          properties: { id: { type: 'string', format: 'uuid' } },
          required: ['id']
        }
      }
    },
    FormulariosSarlaftController.obtenerDetalleAdmin as any
  )

  // URL firmada de S3 para descargar un documento
  app.get(
    '/formularios-sarlaft/:id/documentos/:docId/url',
    {
      preHandler: [authMiddleware],
      schema: {
        description: 'Devuelve URL firmada (5 min) para descargar un documento',
        tags: ['formularios-sarlaft-admin'],
        params: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            docId: { type: 'string', format: 'uuid' }
          },
          required: ['id', 'docId']
        }
      }
    },
    FormulariosSarlaftController.obtenerUrlDescarga as any
  )

  // Actualizar evaluación interna (Oficial de Cumplimiento)
  app.patch(
    '/formularios-sarlaft/:id/evaluacion',
    {
      preHandler: [authMiddleware],
      schema: {
        description: 'Actualiza el estado y concepto de evaluación interna',
        tags: ['formularios-sarlaft-admin'],
        params: {
          type: 'object',
          properties: { id: { type: 'string', format: 'uuid' } },
          required: ['id']
        },
        body: {
          type: 'object',
          properties: {
            estado: { type: 'string', enum: ['en_revision', 'aprobado', 'rechazado', 'escalado'] },
            concepto: { type: 'string', nullable: true },
            observaciones: { type: 'string', nullable: true }
          }
        }
      }
    },
    FormulariosSarlaftController.actualizarEvaluacion as any
  )
}
