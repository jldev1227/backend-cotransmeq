import { FastifyRequest, FastifyReply } from 'fastify'
import { MunicipiosService } from './municipios.service'
import { BuscarMunicipiosInput } from './municipios.schema'

export class MunicipiosController {
  static async listar(request: FastifyRequest, reply: FastifyReply) {
    try {
      const municipios = await MunicipiosService.list()
      return reply.status(200).send(municipios)
    } catch (error) {
      console.error('Error al obtener municipios:', error)
      return reply.status(500).send({ error: 'Error al obtener municipios' })
    }
  }

  static async buscar(
    request: FastifyRequest<{ Querystring: BuscarMunicipiosInput }>,
    reply: FastifyReply
  ) {
    try {
      const result = await MunicipiosService.buscar(request.query)
      return reply.status(200).send(result)
    } catch (error) {
      console.error('Error al buscar municipios:', error)
      return reply.status(500).send({ error: 'Error al buscar municipios' })
    }
  }

  static async obtenerPorId(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply
  ) {
    try {
      const { id } = request.params
      const municipio = await MunicipiosService.findById(id)
      
      if (!municipio) {
        return reply.status(404).send({ error: 'Municipio no encontrado' })
      }
      
      return reply.status(200).send(municipio)
    } catch (error) {
      console.error('Error al obtener municipio:', error)
      return reply.status(500).send({ error: 'Error al obtener municipio' })
    }
  }

  static async obtenerPorDepartamento(
    request: FastifyRequest<{ Params: { codigoDepartamento: string } }>,
    reply: FastifyReply
  ) {
    try {
      const codigoDepartamento = parseInt(request.params.codigoDepartamento)
      
      if (isNaN(codigoDepartamento)) {
        return reply.status(400).send({ error: 'Código de departamento inválido' })
      }

      const municipios = await MunicipiosService.findByDepartamento(codigoDepartamento)
      return reply.status(200).send(municipios)
    } catch (error) {
      console.error('Error al obtener municipios por departamento:', error)
      return reply.status(500).send({ error: 'Error al obtener municipios por departamento' })
    }
  }
}
