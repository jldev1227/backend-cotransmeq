import { FastifyRequest, FastifyReply } from 'fastify';
import { LiquidacionesTercerosDescuentosService } from './liquidaciones-terceros-descuentos.service';
import { borradorQueueService } from '../../queue/borrador-queue.service';

export class LiquidacionesTercerosDescuentosController {

  // ── CONFIGURACIÓN ──

  static async obtenerConfiguracion(request: FastifyRequest, reply: FastifyReply) {
    try {
      const config = await LiquidacionesTercerosDescuentosService.obtenerConfiguracion();
      return reply.send(config);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  }

  static async actualizarConfiguracion(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { items } = request.body as any;
      if (!Array.isArray(items)) {
        return reply.status(400).send({ error: 'items debe ser un array' });
      }
      const result = await LiquidacionesTercerosDescuentosService.actualizarConfiguracion(items);
      return reply.send(result);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  }

  // ── CONCEPTOS DEL CIERRE FINAL ──
  // NOTA: el param :id ahora es el ID del cierre (liquidacion_tercero_final),
  // NO del item de la liquidación de servicio. Esto refleja la nueva arquitectura:
  // cada cierre final tiene su propio juego de conceptos en
  // liquidacion_tercero_final_concepto.

  static async obtenerConceptos(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as any;
      const conceptos = await LiquidacionesTercerosDescuentosService.obtenerConceptos(id);
      return reply.send(conceptos);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  }

  static async guardarConceptos(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as any;
      const { conceptos } = request.body as any;
      if (!Array.isArray(conceptos)) {
        return reply.status(400).send({ error: 'conceptos debe ser un array' });
      }
      const result = await LiquidacionesTercerosDescuentosService.guardarConceptos(id, conceptos);
      return reply.send(result);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  }

  // ── AUTOCOMPLETAR DESDE NÓMINA ──

  static async autocompletarNomina(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { placa, mes, anio } = request.query as any;
      if (!placa || !mes || !anio) {
        return reply.status(400).send({ error: 'Se requiere placa, mes y anio' });
      }
      const result = await LiquidacionesTercerosDescuentosService.autocompletarNomina({
        placa,
        mes: Number(mes),
        anio: Number(anio),
      });
      return reply.send(result);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  }

  // ── GENERAR BORRADOR ──

  static async generarBorrador(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { liquidacion_servicio_id, placa } = request.body as any;
      if (!liquidacion_servicio_id) {
        return reply.status(400).send({ error: 'Se requiere liquidacion_servicio_id' });
      }
      const userId = (request as any).user?.id;
      const result = await LiquidacionesTercerosDescuentosService.generarBorrador({
        liquidacion_servicio_id,
        placa: placa || undefined,
        user_id: userId,
      });
      return reply.send(result);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  }

  // ── GENERAR BORRADOR ASINCRONO (con cola + socket) ──

	static async generarBorradorAsync(request: FastifyRequest, reply: FastifyReply) {
		try {
			const { liquidacion_servicio_id, liquidacion_servicio_ids, placa } = request.body as any;

			// Aceptar array de IDs (preferido) o ID único (backward compat)
			let liqIds: string[] = [];
			if (Array.isArray(liquidacion_servicio_ids) && liquidacion_servicio_ids.length > 0) {
				liqIds = liquidacion_servicio_ids;
			} else if (liquidacion_servicio_id) {
				liqIds = [liquidacion_servicio_id];
			}

			if (liqIds.length === 0) {
				return reply.status(400).send({ error: 'Se requiere liquidacion_servicio_id(s)' });
			}

			const userId = (request as any).user?.id;
			const userName = (request as any).user?.nombre || 'Usuario';

			// Pasar el array completo al queue. El job procesa TODAS las liquidaciones
			// internamente con un progress smooth y acumulativo (no se resetea).
			const result = borradorQueueService.enqueue(userId, userName, {
				liquidacion_servicio_ids: liqIds,
				placa: placa || undefined,
			});

			if (result.status === 'locked') {
				return reply.status(409).send({
					job_id: null,
					status: 'locked',
					locked_by: result.lockedBy,
				});
			}

			return reply.status(202).send({
				job_id: result.jobId,
				status: 'queued',
			});
		} catch (error: any) {
			return reply.status(500).send({ error: error.message });
		}
	}

  static async getBorradorStatus(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { jobId } = request.params as any;
      if (!jobId) return reply.status(400).send({ error: 'Se requiere jobId' });

      const state = borradorQueueService.getStatus(jobId);
      if (!state) return reply.status(404).send({ error: 'job_not_found' });

      return reply.send(state);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  }

  static async cancelBorrador(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { jobId } = request.params as any;
      if (!jobId) return reply.status(400).send({ error: 'Se requiere jobId' });

      const userId = (request as any).user?.id;
      const ok = borradorQueueService.cancel(jobId, userId);
      return reply.send({ cancelled: ok });
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  }

  // ── GUARDAR BORRADOR (persistencia explícita) ──

  static async guardarBorrador(request: FastifyRequest, reply: FastifyReply) {
    try {
      const body = request.body as any;
      const userId = (request as any).user?.id;
      const result = await LiquidacionesTercerosDescuentosService.guardarBorrador({
        liquidacion_servicio_id: body.liquidacion_servicio_id,
        placa: body.placa,
        tercero_id: body.tercero_id || null,
        mes: Number(body.mes),
        anio: Number(body.anio),
        item_ids: Array.isArray(body.item_ids) ? body.item_ids : [],
        conceptos: Array.isArray(body.conceptos) ? body.conceptos : [],
        adicionales: Array.isArray(body.adicionales) ? body.adicionales : [],
        es_propietario_overrides:
          body.es_propietario_overrides && typeof body.es_propietario_overrides === 'object'
            ? body.es_propietario_overrides
            : {},
        user_id: userId,
        force_new: body.force_new === true,
      });
      return reply.send(result);
    } catch (error: any) {
      const status = /Ya existe una liquidación/.test(error.message) ? 409 : 500;
      return reply.status(status).send({ error: error.message });
    }
  }

  // ── CALCULAR IMPUESTOS ──

  static async calcularImpuestos(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as any;
      const result = await LiquidacionesTercerosDescuentosService.calcularImpuestos(id);
      return reply.send(result);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  }

  // ── OBTENER BONIFICACIONES POR PLACA / PERIODO ──

  static async obtenerBonificaciones(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { placa, mes, anio } = request.query as any;
      if (!placa || !mes || !anio) {
        return reply.status(400).send({ error: 'Se requiere placa, mes y anio' });
      }
      const result = await LiquidacionesTercerosDescuentosService.obtenerBonificaciones({
        placa,
        mes: Number(mes),
        anio: Number(anio),
      });
      return reply.send(result);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  }

  // ── OBTENER ANTICIPOS DEL VEHÍCULO POR PERIODO ──

  static async obtenerAnticiposVehiculo(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { placa, mes, anio } = request.query as any;
      if (!placa || !mes || !anio) {
        return reply.status(400).send({ error: 'Se requiere placa, mes y anio' });
      }
      const result = await LiquidacionesTercerosDescuentosService.obtenerAnticiposVehiculo({
        placa,
        mes: Number(mes),
        anio: Number(anio),
      });
      return reply.send(result);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  }

  // ── RECALCULAR TOTALES ──

  static async recalcularTotales(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as any;
      const result = await LiquidacionesTercerosDescuentosService.recalcularTotales(id);
      return reply.send(result);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  }

  // ── REEMPLAZAR ITEMS DEL PIVOTE (descartar items no deseados) ──

  static async reemplazarItems(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as any;
      const { item_ids } = request.body as any;
      if (!Array.isArray(item_ids)) {
        return reply.status(400).send({ error: 'item_ids debe ser un array' });
      }
      const result = await LiquidacionesTercerosDescuentosService.reemplazarItems(id, item_ids);
      return reply.send(result);
    } catch (error: any) {
      request.log.error({ err: error, stack: error.stack }, 'reemplazarItems failed');
      return reply.status(500).send({ error: error.message, stack: error.stack });
    }
  }

  // ── TOGGLE APLICA IMPUESTOS EN ITEM DEL PIVOTE ──

  static async toggleAplicaImpuestosItem(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { pivoteId } = request.params as any;
      const { aplica_impuestos } = request.body as any;
      if (typeof aplica_impuestos !== 'boolean') {
        return reply.status(400).send({ error: 'aplica_impuestos debe ser boolean' });
      }
      const result = await LiquidacionesTercerosDescuentosService.actualizarAplicaImpuestosItem(pivoteId, aplica_impuestos);
      return reply.send(result);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  }

  // ── HISTORIAL DE CIERRES FINALES ──

  static async listarHistorial(request: FastifyRequest, reply: FastifyReply) {
    try {
      const result = await LiquidacionesTercerosDescuentosService.listarHistorial(request.query as any);
      return reply.send(result);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  }

  static async obtenerPorId(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as any;
      const result = await LiquidacionesTercerosDescuentosService.obtenerPorId(id);
      return reply.send(result);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  }

  static async cambiarEstado(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as any;
      const { estado, motivo_anulacion } = request.body as any;
      const userId = (request as any).user?.id;

      if (!estado) {
        return reply.status(400).send({ error: 'Se requiere estado' });
      }

      const userAreas: string[] = ((request as any).user?.area || []).map(
        (a: string) => a.toUpperCase(),
      );
      const isAdmin = userAreas.includes('ADMINISTRACION');

      const current = await LiquidacionesTercerosDescuentosService.obtenerPorId(id);
      const estadoActual = current.estado || 'BORRADOR';

      if (estadoActual === 'APROBADA' && !isAdmin) {
        return reply.status(403).send({
          error: 'La liquidacion esta aprobada. Solo Administracion puede modificar su estado.',
        });
      }

      const result = await LiquidacionesTercerosDescuentosService.cambiarEstado(
        id,
        estado,
        userId,
        motivo_anulacion,
      );
      return reply.send(result);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  }

  // ── SOFT DELETE ──

  static async softDelete(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as any;
      const userId = (request as any).user?.id;
      const result = await LiquidacionesTercerosDescuentosService.softDelete(id, userId);
      return reply.send(result);
    } catch (error: any) {
      const msg = error.message || 'Error al eliminar';
      const status = /no encontrada|ya eliminada/i.test(msg)
        ? 404
        : /no se puede eliminar/i.test(msg)
        ? 409
        : 500;
      return reply.status(status).send({ error: msg });
    }
  }
}
