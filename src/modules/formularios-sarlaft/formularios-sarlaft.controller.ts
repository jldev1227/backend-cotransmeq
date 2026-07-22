import type { FastifyRequest, FastifyReply } from 'fastify'
import { FormulariosSarlaftService } from './formularios-sarlaft.service'
import { submitFormularioSarlaftSchema, type ArchivoUpload } from './formularios-sarlaft.schema'
import { listarFormularios, getFormularioPorCodigo, getDocumentosRequeridos } from './formularios-sarlaft.constants'

export const FormulariosSarlaftController = {
  /**
   * GET /api/public/formularios-sarlaft
   */
  async listarFormulariosPublicos(_request: FastifyRequest, reply: FastifyReply) {
    const formularios = listarFormularios().map(f => ({
      codigo: f.codigo,
      tipo: f.tipo,
      titulo: f.titulo,
      version: f.version,
      fecha_documento: f.fecha_documento,
      total_secciones: f.secciones.length,
      total_preguntas: f.secciones.reduce((acc, s) => acc + s.preguntas.length, 0)
    }))

    return reply.send({
      success: true,
      formularios,
      marco_normativo: [
        'Resolución 2328 de 2025',
        'Resolución 14673 de 2025',
        'Ley 1581 de 2012',
        'Decreto 1377 de 2013'
      ],
      empresa: 'TRANSMERALDA S.A.S.'
    })
  },

  /**
   * GET /api/public/formularios-sarlaft/:codigo
   */
  async obtenerFormularioPublico(request: FastifyRequest, reply: FastifyReply) {
    const { codigo } = request.params as { codigo: string }
    const formulario = getFormularioPorCodigo(codigo)
    if (!formulario) {
      return reply.status(404).send({
        success: false,
        error: `Formulario ${codigo} no encontrado.`
      })
    }

    return reply.send({
      success: true,
      formulario
    })
  },

  /**
   * GET /api/public/formularios-sarlaft/:codigo/documentos?tipo_cliente=...
   * Devuelve la lista de documentos requeridos para este formulario.
   */
  async obtenerDocumentosRequeridos(request: FastifyRequest, reply: FastifyReply) {
    const { codigo } = request.params as { codigo: string }
    const query = request.query as { tipo_cliente?: string }
    const formulario = getFormularioPorCodigo(codigo)
    if (!formulario) {
      return reply.status(404).send({ success: false, error: 'Formulario no encontrado' })
    }
    const tipoCliente = query.tipo_cliente === 'Persona Natural' || query.tipo_cliente === 'Persona Jurídica'
      ? query.tipo_cliente
      : null
    const docs = getDocumentosRequeridos(formulario.tipo, tipoCliente)
    return reply.send({
      success: true,
      documentos: docs,
      config: {
        max_bytes: 10 * 1024 * 1024,
        mimes_permitidos: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'],
        extensiones_permitidas: ['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif']
      }
    })
  },

  /**
   * GET /api/formularios-sarlaft
   * Listado paginado para el dashboard admin.
   * Auth requerida.
   */
  async listarAdmin(request: FastifyRequest, reply: FastifyReply) {
    try {
      const q = request.query as {
        page?: string
        limit?: string
        search?: string
        tipo_formulario?: string
        estado?: string
        fecha_desde?: string
        fecha_hasta?: string
      }
      const data = await FormulariosSarlaftService.listarAdmin({
        page: q.page ? Number(q.page) : undefined,
        limit: q.limit ? Number(q.limit) : undefined,
        search: q.search,
        tipo_formulario:
          q.tipo_formulario === 'cliente_proveedor' ||
          q.tipo_formulario === 'accionistas' ||
          q.tipo_formulario === 'personal'
            ? q.tipo_formulario
            : null,
        estado: q.estado,
        fecha_desde: q.fecha_desde,
        fecha_hasta: q.fecha_hasta
      })
      return reply.send({ success: true, ...data })
    } catch (err: any) {
      request.log.error({ err }, 'Error al listar formularios SARLAFT')
      return reply.status(500).send({ success: false, error: err.message })
    }
  },

  /**
   * GET /api/formularios-sarlaft/:id
   * Detalle completo de un envío (respuestas + documentos).
   * Auth requerida.
   */
  async obtenerDetalleAdmin(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string }
      const detalle = await FormulariosSarlaftService.obtenerDetalle(id)
      if (!detalle) return reply.status(404).send({ success: false, error: 'Formulario no encontrado' })
      return reply.send({ success: true, formulario: detalle })
    } catch (err: any) {
      request.log.error({ err }, 'Error al obtener detalle SARLAFT')
      return reply.status(500).send({ success: false, error: err.message })
    }
  },

  /**
   * GET /api/formularios-sarlaft/:id/documentos/:docId/url
   * Devuelve URL firmada de S3 (5 min) para descargar un documento.
   * Auth requerida.
   */
  async obtenerUrlDescarga(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { docId } = request.params as { docId: string }
      const data = await FormulariosSarlaftService.obtenerUrlDescargaDocumento(docId)
      if (!data) return reply.status(404).send({ success: false, error: 'Documento no encontrado' })
      return reply.send({ success: true, ...data })
    } catch (err: any) {
      request.log.error({ err }, 'Error al generar URL de descarga')
      return reply.status(500).send({ success: false, error: err.message })
    }
  },

  /**
   * PATCH /api/formularios-sarlaft/:id/evaluacion
   * Actualiza el estado y concepto de evaluación.
   * Auth requerida.
   */
  async actualizarEvaluacion(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string }
      const user = (request as any).user
      const body = request.body as {
        estado?: string
        concepto?: string
        observaciones?: string
      }
      const actualizado = await FormulariosSarlaftService.actualizarEvaluacion(id, {
        ...body,
        userId: user?.sub ?? user?.id
      })
      return reply.send({ success: true, formulario: actualizado })
    } catch (err: any) {
      request.log.error({ err }, 'Error al actualizar evaluación')
      return reply.status(500).send({ success: false, error: err.message })
    }
  },

  /**
   * POST /api/public/formularios-sarlaft
   * multipart/form-data con:
   *  - 'payload': JSON string con las respuestas del formulario
   *  - 'doc_<tipo>': uno o más archivos (uno por documento requerido)
   */
  async submit(request: FastifyRequest, reply: FastifyReply) {
    try {
      // El preHandler en routes.ts parsea el multipart y adjunta los datos
      // a request.sarlaftArchivos y request.sarlaftPayloadStr.
      const archivos: ArchivoUpload[] = (request as any).sarlaftArchivos ?? []
      const payloadStr: string | null = (request as any).sarlaftPayloadStr ?? null

      if (!payloadStr || typeof payloadStr !== 'string') {
        return reply.status(400).send({
          success: false,
          error: 'Falta el campo "payload" con las respuestas del formulario.'
        })
      }

      let parsedPayload: any
      try {
        parsedPayload = JSON.parse(payloadStr)
      } catch {
        return reply.status(400).send({
          success: false,
          error: 'El campo "payload" no es un JSON válido.'
        })
      }

      const input = submitFormularioSarlaftSchema.parse(parsedPayload)

      const ip = (request.ip as string) || (request.headers['x-forwarded-for'] as string) || null
      const userAgent = (request.headers['user-agent'] as string) || null
      const referer = (request.headers['referer'] as string) || null

      const resultado = await FormulariosSarlaftService.submit(input, archivos, {
        ip: Array.isArray(ip) ? ip[0] : ip,
        userAgent,
        referer
      })

      return reply.status(201).send({
        success: true,
        ...resultado
      })
    } catch (err: any) {
      request.log.error({ err }, 'Error al procesar formulario SARLAFT')

      if (err.name === 'ZodError') {
        return reply.status(422).send({
          success: false,
          error: 'Datos inválidos',
          details: err.errors?.map((e: any) => `${e.path?.join('.') || 'campo'}: ${e.message}`) ?? ['Datos inválidos']
        })
      }

      if (err.statusCode === 422 || err.statusCode === 400) {
        return reply.status(err.statusCode).send({
          success: false,
          error: err.message,
          details: err.details
        })
      }

      return reply.status(500).send({
        success: false,
        error: 'Error al procesar el formulario. Por favor intenta nuevamente.'
      })
    }
  }
}
