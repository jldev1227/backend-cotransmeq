import { FastifyInstance } from 'fastify'
import { ExtractosController } from './extractos.controller'
import { authMiddleware } from '../../middlewares/auth.middleware'

export async function extractosRoutes(app: FastifyInstance) {
  // Todas las rutas requieren autenticación
  app.addHook('onRequest', authMiddleware)

  // Obtener extractos históricos paginados con filtros
  app.get('/extractos', {
    schema: {
      description: 'Obtener extractos de contrato históricos',
      tags: ['extractos'],
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'string' },
          limit: { type: 'string' },
          search: { type: 'string' },
          contratante: { type: 'string' },
          placa: { type: 'string' },
          conductor: { type: 'string' },
          desde: { type: 'string' },
          hasta: { type: 'string' },
        }
      }
    }
  }, ExtractosController.getAll)

  // Obtener matches con la base de datos (placas, conductores, clientes)
  app.get('/extractos/matches', {
    schema: {
      description: 'Obtener matches de extractos con datos de la BD',
      tags: ['extractos'],
    }
  }, ExtractosController.getMatches)

  // Obtener lista de contratantes únicos
  app.get('/extractos/contratantes', {
    schema: {
      description: 'Obtener contratantes únicos de extractos históricos',
      tags: ['extractos'],
    }
  }, ExtractosController.getContratantes)

  // Sincronizar entidades de extractos.txt con la BD (crear faltantes)
  app.post('/extractos/sync', {
    schema: {
      description: 'Sincronizar contratantes, vehículos y conductores de extractos con la BD',
      tags: ['extractos'],
    }
  }, ExtractosController.syncToDatabase)

  // Obtener siguiente consecutivo
  app.get('/extractos/next-consecutivo', {
    schema: {
      description: 'Obtener el siguiente número de consecutivo disponible',
      tags: ['extractos'],
    }
  }, ExtractosController.getNextConsecutivo)

  // Crear nuevo extracto (append a extractos.txt)
  app.post('/extractos', {
    schema: {
      description: 'Crear un nuevo extracto de contrato',
      tags: ['extractos'],
      body: {
        type: 'object',
        properties: {
          contratante: { type: 'string' },
          origen_destino: { type: 'string' },
          fecha_inicial: { type: 'string' },
          fecha_final: { type: 'string' },
          placa: { type: 'string' },
          num_interno: { type: 'string' },
          num_tarjeta_operacion: { type: 'string' },
          conductor_1: { type: 'string' },
          vigencia_pase_1: { type: 'string' },
          conductor_2: { type: 'string' },
          vigencia_pase_2: { type: 'string' },
          conductor_3: { type: 'string' },
          vigencia_pase_3: { type: 'string' },
        }
      }
    }
  }, ExtractosController.createExtracto)

  // Eliminar todos los extractos
  app.delete('/extractos/all', {
    schema: {
      description: 'Eliminar todos los extractos del archivo',
      tags: ['extractos'],
    }
  }, ExtractosController.deleteAllExtractos)

  // Eliminar un extracto específico
  app.delete('/extractos/:consecutivo', {
    schema: {
      description: 'Eliminar un extracto específico por consecutivo',
      tags: ['extractos'],
      params: {
        type: 'object',
        properties: {
          consecutivo: { type: 'string' }
        },
        required: ['consecutivo']
      }
    }
  }, ExtractosController.deleteExtracto)
}
