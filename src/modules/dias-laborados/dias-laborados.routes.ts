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
  // RUTA ADMIN: Guardado MASIVO de recorridos
  //
  // El operador envía patrones (uno por cada tipo de día: LABORADO,
  // DISPONIBLE, DESCANSO, MANTENIMIENTO) y las fechas en que aplica
  // cada uno. El backend expande y crea los registros. Reemplaza
  // cualquier registro existente SOLO en las fechas tocadas
  // (idempotente). Los días no incluidos en ningún patrón NO se
  // tocan — el operador debe crear un patrón explícitamente para
  // marcarlos.
  // ═══════════════════════════════════════════
  app.post('/dias-laborados/admin/registros-masivos', {
    onRequest: authMiddleware,
    schema: {
      description:
        'Guardar recorridos de un mes completo para un conductor, a partir de patrones (uno por tipo de día) y asignación de fechas',
      tags: ['dias-laborados', 'admin'],
      body: {
        type: 'object',
        required: ['conductor_id', 'mes', 'anio', 'patrones'],
        properties: {
          conductor_id: { type: 'string', format: 'uuid' },
          mes: { type: 'integer', minimum: 1, maximum: 12 },
          anio: { type: 'integer', minimum: 2000, maximum: 2100 },
          patrones: {
            type: 'array',
            items: {
              type: 'object',
              required: ['fechas'],
              properties: {
                tipo: {
                  type: 'string',
                  enum: ['LABORADO', 'DISPONIBLE', 'DESCANSO', 'MANTENIMIENTO'],
                  default: 'LABORADO'
                },
                fechas: {
                  type: 'array',
                  items: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
                  minItems: 1
                },
                segmento: {
                  type: 'object',
                  properties: {
                    cliente_id: { type: 'string', format: 'uuid', nullable: true },
                    cliente_nombre: { type: 'string', nullable: true },
                    vehiculo_id: { type: 'string', format: 'uuid', nullable: true },
                    vehiculo_placa: { type: 'string', maxLength: 20, nullable: true },
                    hora_inicio: { type: 'string', pattern: '^\\d{2}:\\d{2}$', nullable: true },
                    hora_fin: { type: 'string', pattern: '^\\d{2}:\\d{2}$', nullable: true },
                    horas_conducidas: { type: 'number', minimum: 0, maximum: 24, nullable: true },
                    km_inicial: { type: 'integer', minimum: 0, nullable: true },
                    km_final: { type: 'integer', minimum: 0, nullable: true },
                    pernocte: { type: 'boolean' },
                    observaciones: { type: 'string', nullable: true }
                  }
                },
                observaciones: { type: 'string', nullable: true }
              }
            },
            maxItems: 60
          }
        }
      }
    }
  }, DiasLaboradosController.guardarRegistrosMasivos)

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
  // RUTAS ADMIN: Catálogos auxiliares (clientes / vehículos)
  // para alimentar los selects del modal de registro masivo de
  // recorridos. Se exponen a nivel de la app (no dentro del
  // sub-scope `conductorAuthMiddleware`) para que usuarios
  // autenticados con token de admin/dashboard puedan consumirlos.
  // ═══════════════════════════════════════════
  app.get('/dias-laborados/clientes', {
    onRequest: authMiddleware,
    schema: {
      description: 'Lista de clientes activos (para selects del modal admin)',
      tags: ['dias-laborados', 'admin']
    }
  }, DiasLaboradosController.listarClientes)

  app.get('/dias-laborados/vehiculos', {
    onRequest: authMiddleware,
    schema: {
      description: 'Lista de vehículos activos (para selects del modal admin)',
      tags: ['dias-laborados', 'admin']
    }
  }, DiasLaboradosController.listarVehiculos)

  // ═══════════════════════════════════════════
  // RUTAS ADMIN: Editar / soft-delete de un segmento
  // Usado por los botones de acción del canvas de Recorridos.
  // El soft delete marca `deleted_at`; la query de `calendar`
  // filtra esos segmentos para que dejen de aparecer.
  // ═══════════════════════════════════════════
  app.put('/dias-laborados/admin/segmento/:id', {
    onRequest: authMiddleware,
    schema: {
      description: 'Editar un segmento (tramo) específico',
      tags: ['dias-laborados', 'admin'],
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } }
      },
      body: {
        type: 'object',
        properties: {
          cliente_id: { type: 'string', format: 'uuid', nullable: true },
          cliente_nombre: { type: 'string', maxLength: 255, nullable: true },
          vehiculo_id: { type: 'string', format: 'uuid', nullable: true },
          vehiculo_placa: { type: 'string', maxLength: 20, nullable: true },
          hora_inicio: { type: 'string', pattern: '^\\d{2}:\\d{2}$', nullable: true },
          hora_fin: { type: 'string', pattern: '^\\d{2}:\\d{2}$', nullable: true },
          inicio_dia_siguiente: { type: 'boolean' },
          fin_dia_siguiente: { type: 'boolean' },
          horas_conducidas: { type: 'number', minimum: 0, maximum: 24, nullable: true },
          km_inicial: { type: 'integer', minimum: 0, nullable: true },
          km_final: { type: 'integer', minimum: 0, nullable: true },
          pernocte: { type: 'boolean' },
          observaciones: { type: 'string', maxLength: 500, nullable: true }
        }
      }
    }
  }, DiasLaboradosController.editarSegmento)

  app.delete('/dias-laborados/admin/segmento/:id', {
    onRequest: authMiddleware,
    schema: {
      description: 'Soft delete de un segmento (marca deleted_at)',
      tags: ['dias-laborados', 'admin'],
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } }
      }
    }
  }, DiasLaboradosController.softDeleteSegmento)

  // ═══════════════════════════════════════════
  // RUTAS ADMIN: Editar / soft-delete de un REGISTRO (día)
  // Cubre días DESCANSO / MANTENIMIENTO / DISPONIBLE sin
  // segmentos, o el caso de querer borrar un día completo.
  // ═══════════════════════════════════════════
  app.put('/dias-laborados/admin/registro/:id', {
    onRequest: authMiddleware,
    schema: {
      description: 'Editar metadata de un registro (tipo + observaciones + segmento opcional)',
      tags: ['dias-laborados', 'admin'],
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } }
      },
      body: {
        type: 'object',
        properties: {
          tipo: {
            type: 'string',
            enum: ['LABORADO', 'DISPONIBLE', 'DESCANSO', 'MANTENIMIENTO']
          },
          observaciones: { type: 'string', maxLength: 500, nullable: true },
          segmento: {
            type: 'object',
            nullable: true,
            properties: {
              cliente_id: { type: 'string', format: 'uuid', nullable: true },
              cliente_nombre: { type: 'string', maxLength: 255, nullable: true },
              vehiculo_id: { type: 'string', format: 'uuid', nullable: true },
              vehiculo_placa: { type: 'string', maxLength: 20, nullable: true },
              hora_inicio: { type: 'string', pattern: '^\\d{2}:\\d{2}$', nullable: true },
              hora_fin: { type: 'string', pattern: '^\\d{2}:\\d{2}$', nullable: true },
              inicio_dia_siguiente: { type: 'boolean' },
              fin_dia_siguiente: { type: 'boolean' },
              horas_conducidas: { type: 'number', minimum: 0, maximum: 24, nullable: true },
              km_inicial: { type: 'integer', minimum: 0, nullable: true },
              km_final: { type: 'integer', minimum: 0, nullable: true },
              pernocte: { type: 'boolean' },
              observaciones: { type: 'string', maxLength: 500, nullable: true }
            }
          }
        }
      }
    }
  }, DiasLaboradosController.editarRegistro)

  app.delete('/dias-laborados/admin/registro/:id', {
    onRequest: authMiddleware,
    schema: {
      description: 'Soft delete de un registro (día completo) — marca deleted_at en padre y segmentos',
      tags: ['dias-laborados', 'admin'],
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } }
      }
    }
  }, DiasLaboradosController.softDeleteRegistro)

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

    // NOTA: Los endpoints /dias-laborados/clientes y
    // /dias-laborados/vehiculos están a nivel de la app principal
    // (protegidos con `authMiddleware`) para que el dashboard
    // administrativo pueda consumirlos. Aquí solo vive el flujo
    // del portal público del conductor.
  })
}
