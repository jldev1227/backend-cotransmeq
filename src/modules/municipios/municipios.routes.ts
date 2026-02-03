import { FastifyInstance } from 'fastify'
import { MunicipiosController } from './municipios.controller'

export async function municipiosRoutes(app: FastifyInstance) {
  // Listar todos los municipios
  app.get('/municipios', {
    schema: {
      description: 'Obtener todos los municipios ordenados por departamento y nombre',
      tags: ['municipios'],
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              codigo_departamento: { type: 'number' },
              nombre_departamento: { type: 'string' },
              codigo_municipio: { type: 'number' },
              nombre_municipio: { type: 'string' },
              tipo: { type: 'string' },
              longitud: { type: 'number' },
              latitud: { type: 'number' }
            }
          }
        }
      }
    }
  }, MunicipiosController.listar)

  // Buscar municipios con filtros
  app.get('/municipios/buscar', {
    schema: {
      description: 'Buscar municipios con filtros y paginación',
      tags: ['municipios'],
      querystring: {
        type: 'object',
        properties: {
          nombre: { type: 'string', description: 'Nombre del municipio a buscar' },
          departamento: { type: 'string', description: 'Nombre del departamento a buscar' },
          tipo: { type: 'string', enum: ['Municipio', 'Área no municipalizada'], description: 'Tipo de municipio' },
          codigo_departamento: { type: 'number', description: 'Código del departamento' },
          page: { type: 'number', minimum: 1, default: 1 },
          limit: { type: 'number', minimum: 1, maximum: 100, default: 20 }
        }
      }
    }
  }, MunicipiosController.buscar)

  // Obtener municipios por departamento
  app.get('/municipios/departamento/:codigoDepartamento', {
    schema: {
      description: 'Obtener todos los municipios de un departamento',
      tags: ['municipios'],
      params: {
        type: 'object',
        properties: {
          codigoDepartamento: { type: 'string', description: 'Código del departamento' }
        }
      }
    }
  }, MunicipiosController.obtenerPorDepartamento)

  // Obtener municipio por ID (debe ir al final para evitar conflictos)
  app.get('/municipios/:id', {
    schema: {
      description: 'Obtener municipio por ID',
      tags: ['municipios'],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' }
        }
      }
    }
  }, MunicipiosController.obtenerPorId)
}
