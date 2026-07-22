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
          additionalProperties: true,
          properties: {
            accion_numero: { type: 'string' },
            lugar_sede: { type: 'string' },
            proceso_origen_hallazgo: { type: 'string' },
            componente_elemento_referencia: { type: 'string' },
            fuente_genero_hallazgo: { type: 'string' },
            marco_legal_normativo: { type: 'string' },
            fecha_identificacion_hallazgo: { type: 'string', format: 'date' },
            descripcion_hallazgo: { type: 'string' },
            tipo_hallazgo_detectado: {
              type: 'string',
              description:
                'NC Mayor | NC Menor | Observación | Oportunidad de Mejora (acepta valores históricos importados)',
            },
            variable_categoria_analisis: { type: 'string' },
            aplica_correccion_inmediata: { type: 'boolean' },
            justificacion_no_correccion: { type: 'string' },
            responsable_correccion: { type: 'string' },
            correccion_solucion_inmediata: { type: 'string' },
            fecha_implementacion: { type: 'string', format: 'date' },
            valoracion_riesgo: { type: 'string', enum: ['ALTO', 'MEDIO', 'BAJO'] },
            requiere_actualizar_matriz: { type: ['string', 'boolean'] },
            matriz_a_actualizar: { type: 'string' },
            tipo_accion_ejecutar: { type: 'string', enum: ['CORRECTIVA', 'PREVENTIVA', 'MEJORA'] },
            causas: { type: 'array' },
            seguimientos_correccion: { type: 'array' },
            ciclos_eficacia: { type: 'array' },
            evaluaciones_eficacia: { type: 'array' },
            evidencias_eficacia: { type: 'array' },
            fecha_limite_evaluacion_eficacia: { type: 'string', format: 'date' },
            criterio_evaluacion_eficacia: { type: 'string' },
            evaluacion_cierre_eficaz: { type: 'string', enum: ['EFICAZ', 'NO EFICAZ', 'PARCIAL'] },
            fecha_cierre_definitivo: { type: 'string', format: 'date' },
            responsable_cierre: { type: 'string' },
            cargo_responsable_cierre: { type: 'string' },
            observaciones_cierre: { type: 'string' },
            aplica_reapertura: { type: 'boolean' },
            fecha_reapertura: { type: 'string', format: 'date' },
            razon_reapertura: { type: 'string' }
          }
        }
      }
    },
    AccionesCorrectivasController.crear
  )

  // POST /api/acciones-correctivas/:id/duplicar
  fastify.post(
    '/acciones-correctivas/:id/duplicar',
    {
      schema: {
        tags: ['Acciones Correctivas'],
        description: 'Duplicar una acción correctiva/preventiva',
        params: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' }
          },
          required: ['id']
        }
      }
    },
    AccionesCorrectivasController.duplicar
  )

  // POST /api/acciones-correctivas/upload - Subir adjunto
  fastify.post(
    '/acciones-correctivas/upload',
    {
      schema: {
        tags: ['Acciones Correctivas'],
        description: 'Subir un archivo adjunto para acciones correctivas'
      }
    },
    AccionesCorrectivasController.uploadAdjunto
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
            estado_global: { type: 'string', enum: ['EN_PROCESO', 'VENCIDA', 'CUMPLIDA', 'REPLANTEADA'] },
            valoracion_riesgo: { type: 'string' },
            fecha_desde: { type: 'string', format: 'date' },
            fecha_hasta: { type: 'string', format: 'date' },
            busqueda: { type: 'string' },
            page: { type: 'integer', minimum: 1, default: 1 },
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
            sortBy: { type: 'string' },
            sortOrder: { type: 'string', enum: ['asc', 'desc'] },
            ultimos_90_dias: { type: 'boolean' },
            incluir_eliminados: { type: 'boolean' }
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

  // DELETE /api/acciones-correctivas/:id - Eliminar (soft delete)
  fastify.delete(
    '/acciones-correctivas/:id',
    {
      schema: {
        tags: ['Acciones Correctivas'],
        description: 'Mover acción a la papelera (eliminación suave)',
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

  // POST /api/acciones-correctivas/:id/restaurar - Restaurar desde papelera
  fastify.post(
    '/acciones-correctivas/:id/restaurar',
    {
      schema: {
        tags: ['Acciones Correctivas'],
        description: 'Restaurar una acción eliminada desde la papelera',
        params: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' }
          },
          required: ['id']
        }
      }
    },
    AccionesCorrectivasController.restaurar
  )

  // DELETE /api/acciones-correctivas/:id/permanente - Eliminar permanentemente
  fastify.delete(
    '/acciones-correctivas/:id/permanente',
    {
      schema: {
        tags: ['Acciones Correctivas'],
        description: 'Eliminar permanentemente una acción de la papelera',
        params: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' }
          },
          required: ['id']
        }
      }
    },
    AccionesCorrectivasController.eliminarPermanente
  )

  // POST /api/acciones-correctivas/:id/causas - Crear nueva causa
  fastify.post(
    '/acciones-correctivas/:id/causas',
    {
      schema: {
        tags: ['Acciones Correctivas'],
        description: 'Crear nueva causa para una acción correctiva',
        params: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' }
          },
          required: ['id']
        },
        body: {
          type: 'object',
          required: ['orden', 'analisis_causa'],
          properties: {
            orden: { type: 'integer', minimum: 1 },
            analisis_causa: { type: 'string', minLength: 1 },
            descripcion_plan_accion: { type: 'string' },
            responsable_ejecucion: { type: 'string' },
            fecha_limite_implementacion: { type: 'string', format: 'date' },
            estado_seguimiento: { 
              type: 'string', 
              enum: ['En Proceso', 'Cumplida', 'Vencida'],
              default: 'En Proceso'
            }
          }
        }
      }
    },
    AccionesCorrectivasController.crearCausa
  )

  // PUT /api/acciones-correctivas/:id/causas/:causaId - Actualizar causa
  fastify.put(
    '/acciones-correctivas/:id/causas/:causaId',
    {
      schema: {
        tags: ['Acciones Correctivas'],
        description: 'Actualizar una causa específica de una acción correctiva',
        params: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            causaId: { type: 'string', format: 'uuid' }
          },
          required: ['id', 'causaId']
        },
        body: {
          type: 'object',
          properties: {
            descripcion_plan_accion: { type: 'string' },
            responsable_ejecucion: { type: 'string' },
            fecha_limite_implementacion: { type: 'string', format: 'date' },
            estado_seguimiento: { 
              type: 'string', 
              enum: ['En Proceso', 'Cumplida', 'Vencida']
            },
            descripcion_observaciones: { type: 'string' },
            sugerencia_ia: { type: 'object' }
          }
        }
      }
    },
    AccionesCorrectivasController.actualizarCausa
  )

  // GET /api/acciones-correctivas/:id/causas/:causaId/seguimientos - Listar seguimientos de causa
  fastify.get(
    '/acciones-correctivas/:id/causas/:causaId/seguimientos',
    {
      schema: {
        tags: ['Acciones Correctivas'],
        description: 'Listar seguimientos (trazabilidad) de una causa específica',
        params: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            causaId: { type: 'string', format: 'uuid' }
          },
          required: ['id', 'causaId']
        }
      }
    },
    AccionesCorrectivasController.listarSeguimientosCausa
  )

  // POST /api/acciones-correctivas/:id/causas/:causaId/seguimientos - Crear seguimiento de causa
  fastify.post(
    '/acciones-correctivas/:id/causas/:causaId/seguimientos',
    {
      schema: {
        tags: ['Acciones Correctivas'],
        description: 'Crear un seguimiento (trazabilidad) para una causa específica',
        params: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            causaId: { type: 'string', format: 'uuid' }
          },
          required: ['id', 'causaId']
        },
        body: {
          type: 'object',
          required: ['fecha_seguimiento', 'estado_accion'],
          properties: {
            fecha_seguimiento: { type: 'string', format: 'date' },
            estado_accion: { type: 'string', enum: ['Cumplidas', 'En Proceso', 'Vencidas', 'Replanteada'] },
            descripcion_observaciones: { type: 'string' },
            evaluacion_eficaz: { type: 'string', enum: ['EFICAZ', 'NO EFICAZ'] },
            replanteo: { type: 'object' },
            responsable_seguimiento: { type: 'string' },
            cargo_responsable_seguimiento: { type: 'string' }
          }
        }
      }
    },
    AccionesCorrectivasController.crearSeguimientoCausa
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

  // POST /api/acciones-correctivas/sugerencias-ia - Obtener sugerencias de IA
  fastify.post(
    '/acciones-correctivas/sugerencias-ia',
    {
      schema: {
        tags: ['Acciones Correctivas', 'IA'],
        description: 'Obtener sugerencias de IA para plan de acción basado en análisis de causa',
        body: {
          type: 'object',
          required: ['analisis_causa', 'orden_causa', 'descripcion_hallazgo', 'tipo_accion', 'valoracion_riesgo'],
          properties: {
            analisis_causa: { type: 'string', description: 'El "Por qué" que necesita solución' },
            orden_causa: { type: 'integer', description: '1er, 2do, 3er por qué, etc.' },
            descripcion_hallazgo: { type: 'string', description: 'Contexto del hallazgo' },
            tipo_accion: { type: 'string', enum: ['CORRECTIVA', 'PREVENTIVA', 'MEJORA'] },
            valoracion_riesgo: { type: 'string', enum: ['ALTO', 'MEDIO', 'BAJO'] },
            lugar_sede: { type: 'string' },
            proceso_origen: { type: 'string' }
          }
        }
      }
    },
    AccionesCorrectivasController.obtenerSugerenciasIA
  )

  // POST /api/acciones-correctivas/causas/:causa_id/cierre - Cerrar una causa
  fastify.post(
    '/acciones-correctivas/causas/:causa_id/cierre',
    {
      schema: {
        tags: ['Acciones Correctivas'],
        description: 'Cerrar una causa específica después de evaluar su eficacia',
        params: {
          type: 'object',
          properties: {
            causa_id: { type: 'string', format: 'uuid' }
          },
          required: ['causa_id']
        },
        body: {
          type: 'object',
          required: [
            'fecha_evaluacion_eficacia',
            'criterio_evaluacion_eficacia',
            'analisis_evidencias_cierre',
            'evaluacion_cierre_eficaz',
            'responsable_cierre'
          ],
          properties: {
            fecha_evaluacion_eficacia: { type: 'string', format: 'date' },
            criterio_evaluacion_eficacia: { type: 'string' },
            analisis_evidencias_cierre: { type: 'string' },
            evaluacion_cierre_eficaz: { type: 'string', enum: ['EFICAZ', 'NO EFICAZ'] },
            soporte_cierre_eficaz: { type: 'string' },
            responsable_cierre: { type: 'string' }
          }
        }
      }
    },
    AccionesCorrectivasController.cerrarCausa
  )

  // GET /api/acciones-correctivas/:id/validar-cierre - Validar cierre completo
  fastify.get(
    '/acciones-correctivas/:id/validar-cierre',
    {
      schema: {
        tags: ['Acciones Correctivas'],
        description: 'Validar si todas las causas de una acción están cerradas',
        params: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' }
          },
          required: ['id']
        }
      }
    },
    AccionesCorrectivasController.validarCierreCompleto
  )

  // POST /api/acciones-correctivas/causas/:causa_id/sugerencias-seguimiento - Sugerencias de seguimiento
  fastify.post(
    '/acciones-correctivas/causas/:causa_id/sugerencias-seguimiento',
    {
      schema: {
        tags: ['Acciones Correctivas', 'IA'],
        description: 'Obtener sugerencias de IA para el seguimiento de una causa',
        params: {
          type: 'object',
          properties: {
            causa_id: { type: 'string', format: 'uuid' }
          },
          required: ['causa_id']
        },
        body: {
          type: 'object',
          required: ['plan_accion', 'estado_actual'],
          properties: {
            plan_accion: { type: 'string' },
            estado_actual: { type: 'string' },
            observaciones: { type: 'string' }
          }
        }
      }
    },
    AccionesCorrectivasController.obtenerSugerenciasSeguimiento
  )

  // ============================================
  // STEP 4 - APROBACIÓN DEL PLAN DE ACCIÓN
  // ============================================
  //
  // No hay endpoint de "inicializar". El usuario identificado por el
  // JWT aprueba/rechaza directamente; el backend valida el cargo.
  //

  // GET /api/acciones-correctivas/:id/aprobaciones
  fastify.get(
    '/acciones-correctivas/:id/aprobaciones',
    {
      schema: {
        tags: ['Acciones Correctivas'],
        description: 'Obtener la aprobación (única) de una acción y el rol esperado',
        params: {
          type: 'object',
          properties: { id: { type: 'string', format: 'uuid' } },
          required: ['id']
        }
      }
    },
    AccionesCorrectivasController.obtenerAprobaciones
  )

  // POST /api/acciones-correctivas/:id/aprobaciones/aprobar
  fastify.post(
    '/acciones-correctivas/:id/aprobaciones/aprobar',
    {
      schema: {
        tags: ['Acciones Correctivas'],
        description: 'Aprueba la acción. Valida que el cargo del usuario coincida con el rol esperado.',
        params: {
          type: 'object',
          properties: { id: { type: 'string', format: 'uuid' } },
          required: ['id']
        },
        body: {
          type: 'object',
          properties: { comentario: { type: 'string' } }
        }
      }
    },
    AccionesCorrectivasController.aprobar
  )

  // POST /api/acciones-correctivas/:id/aprobaciones/rechazar
  fastify.post(
    '/acciones-correctivas/:id/aprobaciones/rechazar',
    {
      schema: {
        tags: ['Acciones Correctivas'],
        description: 'Rechaza la acción. Valida que el cargo del usuario coincida con el rol esperado.',
        params: {
          type: 'object',
          properties: { id: { type: 'string', format: 'uuid' } },
          required: ['id']
        },
        body: {
          type: 'object',
          required: ['comentario'],
          properties: { comentario: { type: 'string' } }
        }
      }
    },
    AccionesCorrectivasController.rechazar
  )

  // POST /api/acciones-correctivas/:id/aprobaciones/reset
  fastify.post(
    '/acciones-correctivas/:id/aprobaciones/reset',
    {
      schema: {
        tags: ['Acciones Correctivas'],
        description: 'Elimina la aprobación existente (uso admin / cambio de tipo de hallazgo)',
        params: {
          type: 'object',
          properties: { id: { type: 'string', format: 'uuid' } },
          required: ['id']
        }
      }
    },
    AccionesCorrectivasController.resetAprobacion
  )

  // ============================================
  // STEP 5 - ESTADO DE LA ACCIÓN
  // ============================================

  // POST /api/acciones-correctivas/:id/calcular-estado
  fastify.post(
    '/acciones-correctivas/:id/calcular-estado',
    {
      schema: {
        tags: ['Acciones Correctivas'],
        description: 'Calcular automáticamente el estado global según reglas de negocio',
        params: {
          type: 'object',
          properties: { id: { type: 'string', format: 'uuid' } },
          required: ['id']
        }
      }
    },
    AccionesCorrectivasController.calcularEstadoGlobal
  )

  // POST /api/acciones-correctivas/:id/estado-global
  fastify.post(
    '/acciones-correctivas/:id/estado-global',
    {
      schema: {
        tags: ['Acciones Correctivas'],
        description: 'Actualizar manualmente el estado global de la acción',
        params: {
          type: 'object',
          properties: { id: { type: 'string', format: 'uuid' } },
          required: ['id']
        },
        body: {
          type: 'object',
          required: ['estado_global'],
          properties: {
            estado_global: { type: 'string', enum: ['EN_PROCESO', 'VENCIDA', 'CUMPLIDA', 'REPLANTEADA'] },
            registrado_por_id: { type: 'string', format: 'uuid' },
            observaciones: { type: 'string' }
          }
        }
      }
    },
    AccionesCorrectivasController.actualizarEstadoGlobal
  )
}
