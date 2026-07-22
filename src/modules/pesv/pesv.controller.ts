import { FastifyReply, FastifyRequest } from 'fastify'
import { PesvService } from './pesv.service'

interface DashboardQuery {
  mes?: string
  anio?: string
  conductor_id?: string
  vehiculo_id?: string
  cliente_id?: string
  municipio_origen_id?: string
  municipio_destino_id?: string
  placa?: string
  page?: string
  limit?: string
}

interface ExcesoBody {
  conductor_id: string
  vehiculo_id: string
  mes: number
  anio: number
  cantidad: number
  observaciones?: string
}

interface PreoperacionalBody {
  conductor_id: string
  vehiculo_id: string
  fecha: string
  realizado: boolean
  observaciones?: string
}

interface IdParams {
  id: string
}

interface RegistroDiaPesvBody {
  horas_sueno?: number | null
  excesos_velocidad_dia?: number
  preoperacional_realizado?: boolean
  siniestros?: number
  siniestros_detalle?: string | null
}

export class PesvController {

  static async getDashboard(request: FastifyRequest<{ Querystring: DashboardQuery }>, reply: FastifyReply) {
    try {
      const { mes, anio } = request.query

      const data = await PesvService.getDashboard({
        mes: mes ? parseInt(mes) : undefined,
        anio: anio ? parseInt(anio) : undefined,
      })

      return reply.send({ success: true, data })
    } catch (error: any) {
      console.error('Error en getDashboard PESV:', error)
      return reply.status(500).send({ success: false, error: error.message })
    }
  }

  static async getFilterOptions(_request: FastifyRequest, reply: FastifyReply) {
    try {
      const options = await PesvService.getFilterOptions()
      return reply.send({ success: true, data: options })
    } catch (error: any) {
      console.error('Error en getFilterOptions PESV:', error)
      return reply.status(500).send({ success: false, error: error.message })
    }
  }

  // ==================== EXCESOS VELOCIDAD ====================

  static async getExcesos(request: FastifyRequest<{ Querystring: DashboardQuery }>, reply: FastifyReply) {
    try {
      const { conductor_id, vehiculo_id, mes, anio } = request.query
      const data = await PesvService.getExcesos({
        conductor_id,
        vehiculo_id,
        mes: mes ? parseInt(mes) : undefined,
        anio: anio ? parseInt(anio) : undefined,
      })
      return reply.send({ success: true, data })
    } catch (error: any) {
      console.error('Error en getExcesos PESV:', error)
      return reply.status(500).send({ success: false, error: error.message })
    }
  }

  static async upsertExceso(request: FastifyRequest<{ Body: ExcesoBody }>, reply: FastifyReply) {
    try {
      const data = await PesvService.upsertExceso(request.body)
      return reply.send({ success: true, data })
    } catch (error: any) {
      console.error('Error en upsertExceso PESV:', error)
      return reply.status(500).send({ success: false, error: error.message })
    }
  }

  static async deleteExceso(request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) {
    try {
      await PesvService.deleteExceso(request.params.id)
      return reply.send({ success: true })
    } catch (error: any) {
      console.error('Error en deleteExceso PESV:', error)
      return reply.status(500).send({ success: false, error: error.message })
    }
  }

  // ==================== PREOPERACIONALES ====================

  static async getPreoperacionales(request: FastifyRequest<{ Querystring: DashboardQuery & { fecha_desde?: string; fecha_hasta?: string } }>, reply: FastifyReply) {
    try {
      const { conductor_id, vehiculo_id, mes, anio } = request.query
      const data = await PesvService.getPreoperacionales({
        conductor_id,
        vehiculo_id,
        fecha_desde: request.query.fecha_desde,
        fecha_hasta: request.query.fecha_hasta,
        mes: mes ? parseInt(mes) : undefined,
        anio: anio ? parseInt(anio) : undefined,
      })
      return reply.send({ success: true, data })
    } catch (error: any) {
      console.error('Error en getPreoperacionales PESV:', error)
      return reply.status(500).send({ success: false, error: error.message })
    }
  }

  static async upsertPreoperacional(request: FastifyRequest<{ Body: PreoperacionalBody }>, reply: FastifyReply) {
    try {
      const data = await PesvService.upsertPreoperacional(request.body)
      return reply.send({ success: true, data })
    } catch (error: any) {
      console.error('Error en upsertPreoperacional PESV:', error)
      return reply.status(500).send({ success: false, error: error.message })
    }
  }

  static async deletePreoperacional(request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) {
    try {
      await PesvService.deletePreoperacional(request.params.id)
      return reply.send({ success: true })
    } catch (error: any) {
      console.error('Error en deletePreoperacional PESV:', error)
      return reply.status(500).send({ success: false, error: error.message })
    }
  }

  // ==================== REGISTROS DIARIOS ====================

  static async getRegistrosDiarios(request: FastifyRequest<{ Querystring: DashboardQuery }>, reply: FastifyReply) {
    try {
      const { mes, anio, conductor_id, vehiculo_id, cliente_id } = request.query
      const currentDate = new Date()
      const data = await PesvService.getRegistrosDiarios({
        mes: mes ? parseInt(mes) : (currentDate.getMonth() + 1),
        anio: anio ? parseInt(anio) : currentDate.getFullYear(),
        conductor_id,
        vehiculo_id,
        cliente_id,
      })
      return reply.send({ success: true, data })
    } catch (error: any) {
      console.error('Error en getRegistrosDiarios PESV:', error)
      return reply.status(500).send({ success: false, error: error.message })
    }
  }

  static async updateRegistroDiaPesv(request: FastifyRequest<{ Params: IdParams; Body: RegistroDiaPesvBody }>, reply: FastifyReply) {
    try {
      const data = await PesvService.updateRegistroDiaPesv(request.params.id, request.body)
      return reply.send({ success: true, data })
    } catch (error: any) {
      console.error('Error en updateRegistroDiaPesv PESV:', error)
      return reply.status(500).send({ success: false, error: error.message })
    }
  }
}
