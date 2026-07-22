import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import jwt from 'jsonwebtoken'
import { env } from '../../config/env'
import { authMiddleware } from '../../middlewares/auth.middleware'
import { requireBonosPlanilla } from '../../middlewares/bonos.middleware'
import { DiasLaboradosController } from './dias-laborados.controller'
import { BonosController } from './bonos.controller'
import { BonoConfigVisualController } from './bonos-config-visual.controller'

/**
 * Middleware de autenticación para conductores (dias-laborados).
 * Verifica el JWT emitido por el magic link.
 */
async function conductorAuthMiddleware(request: FastifyRequest, reply: FastifyReply) {
  const auth = request.headers['authorization']
  if (!auth) return reply.status(401).send({ success: false, message: 'Token no proporcionado' })

  const parts = auth.split(' ')
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return reply.status(401).send({ success: false, message: 'Formato de token inválido' })
  }

  try {
    const payload = jwt.verify(parts[1], env.JWT_SECRET) as any
    if (payload.tipo !== 'conductor_dias_laborados') {
      return reply.status(401).send({ success: false, message: 'Token no autorizado para este recurso' })
    }

    ;(request as any).conductorDiasLaborados = {
      id: payload.sub,
      cedula: payload.cedula,
      nombre: payload.nombre
    }
  } catch (err) {
    return reply.status(401).send({ success: false, message: 'Token inválido o expirado' })
  }
}

export async function diasLaboradosRoutes(app: FastifyInstance) {

  // ═══════════════════════════════════════════
  // RUTAS PÚBLICAS (sin autenticación)
  // ═══════════════════════════════════════════

  // Solicitar acceso: envía magic link por email
  app.post('/dias-laborados/solicitar-acceso', {
    schema: {
      description: 'Solicitar acceso al reporte diario (envía email con magic link)',
      tags: ['dias-laborados'],
      body: {
        type: 'object',
        required: ['numero_identificacion'],
        properties: {
          numero_identificacion: { type: 'string', minLength: 5, maxLength: 12 }
        }
      }
    }
  }, DiasLaboradosController.solicitarAcceso)

  // Verificar token (al hacer clic en el magic link)
  app.get('/dias-laborados/verificar-token', {
    schema: {
      description: 'Verificar token de acceso al reporte diario',
      tags: ['dias-laborados'],
      querystring: {
        type: 'object',
        required: ['token'],
        properties: {
          token: { type: 'string' }
        }
      }
    }
  }, DiasLaboradosController.verificarToken)

  // ═══════════════════════════════════════════
  // RUTA ADMIN: Calendar global (auth de admin)
  // ═══════════════════════════════════════════
  app.get('/dias-laborados/calendar-admin', {
    onRequest: authMiddleware,
    schema: {
      description: 'Calendario de días laborados de todos los conductores (admin)',
      tags: ['dias-laborados'],
      querystring: {
        type: 'object',
        required: ['mes', 'anio'],
        properties: {
          mes: { type: 'number', minimum: 1, maximum: 12 },
          anio: { type: 'number', minimum: 2020, maximum: 2100 },
          conductor_id: { type: 'string' }
        }
      }
    }
  }, DiasLaboradosController.calendarAdmin)

  // ═══════════════════════════════════════════
  // RUTAS: BONOS de planilla (lectura libre para usuarios autenticados,
  //        escritura protegida por requireBonosPlanilla)
  // ═══════════════════════════════════════════

  // GET /api/dias-laborados/bonos — listar bonos en un rango de fechas
  // (solo lectura; cualquier usuario autenticado con acceso a conductores
  //  puede ver los bonos ya otorgados).
  app.get('/dias-laborados/bonos', {
    onRequest: authMiddleware,
    schema: {
      description: 'Listar bonos de planilla en un rango de fechas',
      tags: ['dias-laborados', 'bonos'],
      querystring: {
        type: 'object',
        required: ['desde', 'hasta'],
        properties: {
          desde: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          hasta: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          conductor_id: { type: 'string' }
        }
      }
    }
  }, BonosController.listar)

  // POST /api/dias-laborados/bonos/sync — sincronizar diff (crear/eliminar)
  // Protegido por requireBonosPlanilla (permiso individual).
  app.post('/dias-laborados/bonos/sync', {
    preHandler: [authMiddleware, requireBonosPlanilla],
    schema: {
      description: 'Sincronizar bonos de planilla (crear/eliminar)',
      tags: ['dias-laborados', 'bonos'],
      body: {
        type: 'object',
        properties: {
          crear: {
            type: 'array',
            items: {
              type: 'object',
              required: ['registro_dia_id', 'config_liquidacion_id'],
              properties: {
                registro_dia_id: { type: 'string' },
                segmento_id: { type: 'string', nullable: true },
                config_liquidacion_id: { type: 'string', format: 'uuid' },
                valor: { type: 'number', nullable: true },
                observaciones: { type: 'string', nullable: true }
              }
            }
          },
          eliminar: { type: 'array', items: { type: 'string' } }
        }
      }
    }
  }, BonosController.sincronizar)

  // POST /api/dias-laborados/bonos — crear un bono (protegido)
  app.post('/dias-laborados/bonos', {
    preHandler: [authMiddleware, requireBonosPlanilla],
    schema: {
      description: 'Crear un bono de planilla',
      tags: ['dias-laborados', 'bonos'],
      body: {
        type: 'object',
        required: ['registro_dia_id', 'config_liquidacion_id'],
        properties: {
          registro_dia_id: { type: 'string' },
          segmento_id: { type: 'string', nullable: true },
          config_liquidacion_id: { type: 'string', format: 'uuid' },
          valor: { type: 'number', nullable: true },
          observaciones: { type: 'string', nullable: true }
        }
      }
    }
  }, BonosController.crear)

  // DELETE /api/dias-laborados/bonos/:id — eliminar (protegido)
  app.delete('/dias-laborados/bonos/:id', {
    preHandler: [authMiddleware, requireBonosPlanilla],
    schema: {
      description: 'Eliminar un bono de planilla',
      tags: ['dias-laborados', 'bonos'],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string' }
        }
      }
    }
  }, BonosController.eliminar)

  // ═══════════════════════════════════════════════════
  // RUTAS: VISIBILIDAD de bonos (qué configs se exponen
  // como columna en la pestaña de Recorridos).
  //   - GET  /api/dias-laborados/bonos-config-visual?anio=YYYY
  //   - PUT  /api/dias-laborados/bonos-config-visual
  //         body: { anio: number, visibles: string[] }
  // La escritura está protegida con `bonos-planilla` para que
  // solo los usuarios autorizados cambien la configuración global.
  // ═══════════════════════════════════════════════════
  app.get('/dias-laborados/bonos-config-visual', {
    onRequest: authMiddleware,
    schema: {
      description:
        'Lista las configs activas del año con el flag `visible` resuelto (default true si no hay registro)',
      tags: ['dias-laborados', 'bonos'],
      querystring: {
        type: 'object',
        required: ['anio'],
        properties: {
          anio: { type: 'integer', minimum: 2000, maximum: 2100 }
        }
      }
    }
  }, BonoConfigVisualController.listar)

  app.put('/dias-laborados/bonos-config-visual', {
    preHandler: [authMiddleware, requireBonosPlanilla],
    schema: {
      description:
        'Reemplaza en bloque la selección de visibilidad de bonos para un año (global)',
      tags: ['dias-laborados', 'bonos'],
      body: {
        type: 'object',
        required: ['anio', 'visibles'],
        properties: {
          anio: { type: 'integer', minimum: 2000, maximum: 2100 },
          visibles: { type: 'array', items: { type: 'string', format: 'uuid' } }
        }
      }
    }
  }, BonoConfigVisualController.guardar)

  // ═══════════════════════════════════════════
  // RUTAS PROTEGIDAS (requieren token de conductor)
  // ═══════════════════════════════════════════

  // Sub-scope con middleware de conductor
  app.register(async function protectedRoutes(protectedApp) {
    protectedApp.addHook('onRequest', conductorAuthMiddleware)

    // Guardar/actualizar registro de un día
    protectedApp.post('/dias-laborados/registros', {
      schema: {
        description: 'Crear o actualizar registro de día laboral',
        tags: ['dias-laborados'],
        body: {
          type: 'object',
          required: ['fecha', 'tipo'],
          properties: {
            fecha: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
            tipo: { type: 'string', enum: ['LABORADO', 'DISPONIBLE', 'DESCANSO', 'MANTENIMIENTO'] },
            hora_inicio: { type: 'string' },
            hora_fin: { type: 'string' },
            horas_conducidas: { type: 'number' },
            cliente_id: { type: 'string' },
            cliente_nombre: { type: 'string' },
            vehiculo_placa: { type: 'string' },
            observaciones: { type: 'string' }
          }
        }
      }
    }, DiasLaboradosController.guardarRegistro)

    // Listar registros
    protectedApp.get('/dias-laborados/registros', {
      schema: {
        description: 'Listar registros de días laborados',
        tags: ['dias-laborados'],
        querystring: {
          type: 'object',
          properties: {
            mes: { type: 'string', pattern: '^\\d{4}-\\d{2}$' },
            desde: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
            hasta: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }
          }
        }
      }
    }, DiasLaboradosController.listarRegistros)

    // Eliminar registro
    protectedApp.delete('/dias-laborados/registros/:fecha', {
      schema: {
        description: 'Eliminar registro de un día',
        tags: ['dias-laborados'],
        params: {
          type: 'object',
          required: ['fecha'],
          properties: {
            fecha: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }
          }
        }
      }
    }, DiasLaboradosController.eliminarRegistro)

    // Listar clientes (para select en formulario)
    protectedApp.get('/dias-laborados/clientes', {
      schema: {
        description: 'Obtener lista de clientes para el formulario',
        tags: ['dias-laborados']
      }
    }, DiasLaboradosController.listarClientes)

    // Listar vehículos (para select en formulario)
    protectedApp.get('/dias-laborados/vehiculos', {
      schema: {
        description: 'Obtener lista de vehículos para el formulario',
        tags: ['dias-laborados']
      }
    }, DiasLaboradosController.listarVehiculos)
  })
}
