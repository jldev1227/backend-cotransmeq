import { FastifyRequest, FastifyReply } from 'fastify';
import { LiquidacionesTercerosDescuentosService } from './liquidaciones-terceros-descuentos.service';
import { PeriodoCierresService } from './periodo-cierres.service';
import { CierreEstadoService, ErrorEstado } from './cierre-estado.service';
import { emitSheetColorChanged, emitSheetInvalidate } from '../../sockets/sheet.gateway';
import { CierreFinalCeldasService } from './cierre-final-celdas.service';
import { borradorQueueService } from '../../queue/borrador-queue.service';
import { bulkSaveLiquidacionTerceroService } from '../../queue/bulk-save-liquidacion-tercero.service';

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

  // ── COPROPIETARIOS (reparto porcentual del valor a pagar) ──

  static async obtenerPropietarios(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as any;
      const result = await LiquidacionesTercerosDescuentosService.obtenerPropietarios(id);
      return reply.send(result);
    } catch (error: any) {
      const msg = error.message || 'Error al obtener copropietarios';
      const status = /no encontrada/i.test(msg) ? 404 : 500;
      return reply.status(status).send({ error: msg });
    }
  }

  static async guardarPropietarios(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as any;
      const { propietarios } = request.body as any;
      if (!Array.isArray(propietarios)) {
        return reply.status(400).send({ error: 'propietarios debe ser un array' });
      }
      const result = await LiquidacionesTercerosDescuentosService.guardarPropietarios(
        id,
        propietarios
      );
      return reply.send(result);
    } catch (error: any) {
      const msg = error.message || 'Error al guardar copropietarios';
      const status = /no encontrada/i.test(msg)
        ? 404
        : /estado|se permiten borradores/i.test(msg)
          ? 409
          : 500;
      return reply.status(status).send({ error: msg });
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
      const { liquidacion_servicio_id, liquidacion_servicio_ids, placa, tercero_id } = request.body as any;
      if (!liquidacion_servicio_id && (!Array.isArray(liquidacion_servicio_ids) || liquidacion_servicio_ids.length === 0)) {
        return reply.status(400).send({ error: 'Se requiere liquidacion_servicio_id(s)' });
      }
      const userId = (request as any).user?.id;
      const result = await LiquidacionesTercerosDescuentosService.generarBorrador({
        liquidacion_servicio_id,
        liquidacion_servicio_ids,
        placa: placa || undefined,
        tercero_id: tercero_id || null,
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
			const {
				liquidacion_servicio_id,
				liquidacion_servicio_ids,
				placa,
				tercero_id,
				// ── Modo encadenado (canvas de cierres finales) ──
				// El flujo antiguo genera y devuelve la previsualización para
				// que el formulario la revise. El canvas no tiene ese paso
				// intermedio, así que pide que el job persista y anuncie cada
				// hoja según la va guardando.
				persistir,
				anio,
				mes,
				placas,
				force_new,
			} = request.body as any;

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
			const persistiendo = persistir === true;
			if (persistiendo && (!anio || !mes)) {
				return reply
					.status(400)
					.send({ error: 'persistir requiere anio y mes' });
			}

			const result = borradorQueueService.enqueue(userId, userName, {
				liquidacion_servicio_ids: liqIds,
				placa: placa || undefined,
				tercero_id: tercero_id || null,
				persistir: persistiendo,
				anio: anio ? Number(anio) : undefined,
				mes: mes ? Number(mes) : undefined,
				placas: Array.isArray(placas) && placas.length ? placas.map(String) : undefined,
				force_new: force_new === true,
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
        // ── Bulk mode: crear varias liquidaciones independientes en una sola llamada ──
        bulk_mode: body.bulk_mode === true,
        placas: Array.isArray(body.placas) ? body.placas : undefined,
        placas_payload: Array.isArray(body.placas_payload) ? body.placas_payload : undefined,
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

  // ── CONDUCTORES DEL CIERRE (altas, bajas y marca de propietario) ──

  /**
   * Reemplaza la lista de conductores de un cierre.
   *
   * El payload es la lista COMPLETA que debe quedar, no un delta: el modal
   * conoce el estado final y mandar altas y bajas por separado abriría la
   * puerta a que una petición perdida dejara el cierre a medias.
   */
  static async sincronizarConductores(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as any;
      const { conductores } = request.body as any;
      if (!Array.isArray(conductores)) {
        return reply.status(400).send({ error: 'conductores debe ser un array' });
      }
      for (const c of conductores) {
        if (!c?.conductor_id || typeof c.conductor_id !== 'string') {
          return reply.status(400).send({ error: 'cada conductor requiere conductor_id' });
        }
        if (!Number.isFinite(Number(c.dias)) || Number(c.dias) < 0) {
          return reply.status(400).send({ error: `dias inválidos para ${c.conductor_id}` });
        }
      }

      const result = await CierreFinalCeldasService.sincronizarConductores({
        cierreId: id,
        conductores: conductores.map((c: any) => ({
          conductor_id: c.conductor_id,
          dias: Number(c.dias),
          es_propietario: c.es_propietario === true,
        })),
        user_id: (request as any).user?.id,
      });

      // Cambia la GEOMETRÍA de la hoja (aparecen o desaparecen bloques de
      // conductor), así que no se puede difundir como patch de celda: el
      // resto del room tiene que releer.
      emitSheetInvalidate({
        scope: 'cierres-finales',
        anio: result.anio,
        mes: result.mes,
        cierreId: id,
        accion: 'conductores',
      });

      return reply.send(result);
    } catch (error: any) {
      const msg = String(error?.message || '');
      // Un cierre ya liquidado no es un fallo del servidor: es el usuario
      // pidiendo algo que las reglas del módulo no permiten.
      const status = /estado|no encontrado/i.test(msg) ? 409 : 500;
      return reply.status(status).send({ error: msg });
    }
  }

  // ── FILAS DE GASTOS Y ANTICIPOS ──

  static async agregarConcepto(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as any;
      const { tipo, concepto, dias, valor_unitario, observaciones } = request.body as any;

      if (tipo !== 'GASTO_OPERATIVO' && tipo !== 'ANTICIPO') {
        return reply.status(400).send({
          error: 'tipo debe ser GASTO_OPERATIVO o ANTICIPO. Los impuestos salen de la configuración.'
        });
      }
      if (!concepto || typeof concepto !== 'string' || !concepto.trim()) {
        return reply.status(400).send({ error: 'concepto es obligatorio' });
      }
      if (!Number.isFinite(Number(dias)) || !Number.isFinite(Number(valor_unitario))) {
        return reply.status(400).send({ error: 'dias y valor_unitario deben ser números' });
      }

      const result = await CierreFinalCeldasService.agregarConcepto({
        cierreId: id,
        tipo,
        concepto,
        dias: Number(dias),
        valor_unitario: Number(valor_unitario),
        observaciones: observaciones ?? null,
        user_id: (request as any).user?.id
      });

      // Fila nueva = geometría nueva: el resto del room tiene que releer.
      emitSheetInvalidate({
        scope: 'cierres-finales',
        anio: result.anio,
        mes: result.mes,
        cierreId: id,
        accion: 'concepto-agregado'
      });

      return reply.send(result);
    } catch (error: any) {
      const msg = String(error?.message || '');
      const status = /estado|no encontrado|ya está|vacío/i.test(msg) ? 409 : 500;
      return reply.status(status).send({ error: msg });
    }
  }

  static async eliminarConcepto(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { conceptoId } = request.params as any;
      const result = await CierreFinalCeldasService.eliminarConcepto({
        conceptoId,
        user_id: (request as any).user?.id
      });

      emitSheetInvalidate({
        scope: 'cierres-finales',
        anio: result.anio,
        mes: result.mes,
        cierreId: result.cierreId,
        accion: 'concepto-eliminado'
      });

      return reply.send(result);
    } catch (error: any) {
      const msg = String(error?.message || '');
      const status = /estado|no encontrado|no se puede/i.test(msg) ? 409 : 500;
      return reply.status(status).send({ error: msg });
    }
  }

  // ── TOGGLE EXCLUIR (SOFT DELETE) EN ITEM DEL PIVOTE ──

  static async toggleExcluirItem(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { pivoteId } = request.params as any;
      const { excluir } = request.body as any;
      if (typeof excluir !== 'boolean') {
        return reply.status(400).send({ error: 'excluir debe ser boolean' });
      }
      const result = await LiquidacionesTercerosDescuentosService.toggleExcluirItem(pivoteId, excluir);
      return reply.send(result);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  }

  // ── REFRESH ITEMS DEL CIERRE ──
  // Trae items de `liquidacion_tercero` recién creados que aún no están
  // vinculados al pivote del cierre. Usado para no tener que regenerar el
  // borrador cuando se crean liq_servicios nuevas después del cierre.

  static async refreshItems(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as any;
      const result = await LiquidacionesTercerosDescuentosService.refreshItems(id);
      return reply.send(result);
    } catch (error: any) {
      const msg = error.message || 'Error al refrescar items';
      const status = /no encontrada/i.test(msg)
        ? 404
        : /estado|se permiten borradores/i.test(msg)
          ? 409
          : 500;
      return reply.status(status).send({ error: msg });
    }
  }

  // ── ITEMS DISPONIBLES PARA AÑADIR A MANO ──
  // Items de la MISMA PLACA que no están en ningún cierre vivo, de cualquier
  // mes. Es la lista que alimenta el modal «Traer items».

  static async itemsDisponibles(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as any;
      const result = await LiquidacionesTercerosDescuentosService.itemsDisponibles(id);
      return reply.send(result);
    } catch (error: any) {
      const msg = error.message || 'Error al leer los items disponibles';
      return reply.status(/no encontrada|no tiene placa/i.test(msg) ? 404 : 500).send({ error: msg });
    }
  }

  // ── AÑADIR ITEMS ELEGIDOS A MANO ──

  static async agregarItems(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as any;
      const { liquidacion_tercero_ids } = request.body as any;
      if (!Array.isArray(liquidacion_tercero_ids)) {
        return reply.status(400).send({ error: 'liquidacion_tercero_ids debe ser un array' });
      }
      const result = await LiquidacionesTercerosDescuentosService.agregarItems(
        id,
        liquidacion_tercero_ids
      );
      return reply.send(result);
    } catch (error: any) {
      const msg = error.message || 'Error al agregar items';
      // 409 y no 400: el cuerpo era válido: es el ESTADO del cierre o del
      // item lo que impide la operación, y quien llama puede resolverlo
      // (quitar el item del otro cierre, volver el cierre a borrador).
      const status = /no encontrada/i.test(msg)
        ? 404
        : /ya está en el cierre|se permiten borradores|es de la placa|ya no existen/i.test(msg)
          ? 409
          : 500;
      return reply.status(status).send({ error: msg });
    }
  }

  // ── HISTORIAL DE CIERRES FINALES ──

  /// GET /api/liquidaciones-terceros/periodo?anio=&mes=[&ids=a,b,c]
  ///
  /// Sin `ids` → índice de hojas del periodo (modo `lite`), ordenado.
  /// Con `ids` → detalle completo de esos cierres (modo `full`, por lotes).
  ///
  /// El canvas pide primero el índice para construir las pestañas, y luego
  /// el detalle por lotes empezando por la hoja activa. Cargar el periodo
  /// entero de golpe dejaría el canvas en blanco mientras llega.
  static async listarPeriodo(request: FastifyRequest, reply: FastifyReply) {
    try {
      const q = (request.query as any) || {};
      const anio = Number(q.anio);
      const mes = Number(q.mes);

      if (!Number.isInteger(anio) || anio < 2000 || anio > 2100) {
        return reply.status(400).send({ error: 'Se requiere un `anio` válido' });
      }
      if (!Number.isInteger(mes) || mes < 1 || mes > 12) {
        return reply.status(400).send({ error: 'Se requiere un `mes` válido (1-12)' });
      }

      const idsRaw = typeof q.ids === 'string' ? q.ids.trim() : '';
      if (idsRaw) {
        const ids = idsRaw.split(',').map((x: string) => x.trim()).filter(Boolean);
        // Techo defensivo: el punto de pedir por lotes es no traerlo todo.
        if (ids.length > 40) {
          return reply.status(400).send({
            error: 'Máximo 40 ids por lote. Divide la petición.',
          });
        }
        const cierres = await PeriodoCierresService.detallePeriodo(anio, mes, ids);
        return reply.send({ anio, mes, modo: 'full', cierres });
      }

      const hojas = await PeriodoCierresService.listarPeriodo(anio, mes);
      return reply.send({ anio, mes, modo: 'lite', total: hojas.length, hojas });
    } catch (error: any) {
      console.error('[periodo] listarPeriodo error:', error);
      return reply.status(500).send({ error: error.message });
    }
  }

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
      const { includeDeleted } = (request.query as any) || {};
      const result = await LiquidacionesTercerosDescuentosService.obtenerPorId(id, {
        includeDeleted: includeDeleted === true || includeDeleted === 'true',
      });
      return reply.send(result);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  }

  static async cambiarEstado(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as any;
      const { estado, motivo_anulacion, base_version } = request.body as any;
      const user = (request as any).user;

      if (!estado) {
        return reply.status(400).send({ error: 'Se requiere estado' });
      }

      // Los guards (entrada a APROBADA/FACTURADA, salida de APROBADA), la
      // matriz de transiciones y el CAS sobre `version` viven ahora en
      // `CierreEstadoService`; aquí solo se traduce el error a HTTP.
      const result = await LiquidacionesTercerosDescuentosService.cambiarEstado(
        id,
        estado,
        user?.id,
        motivo_anulacion,
        {
          areas: user?.area ?? null,
          userName: user?.nombre ?? user?.correo ?? null,
          base_version: base_version == null ? null : Number(base_version),
        },
      );
      return reply.send(result);
    } catch (error: any) {
      if (error instanceof ErrorEstado) {
        return reply
          .status(error.status)
          .send({ error: error.message, code: error.code, ...(error.detalle || {}) });
      }
      return reply.status(500).send({ error: error.message });
    }
  }

  /**
   * Cambio de estado en LOTE para un periodo.
   *
   * Es la acción "Liquidar todas las hojas en BORRADOR" del header del
   * canvas: con 80 placas, hacerlo una a una no es viable. Devuelve 207
   * cuando alguna falla, para que la UI pueda listar cuáles.
   */
  static async cambiarEstadoLote(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { anio, mes, desde, hacia, motivo } = (request.body as any) || {};
      const user = (request as any).user;

      if (!anio || !mes || !desde || !hacia) {
        return reply
          .status(400)
          .send({ error: 'Se requieren anio, mes, desde y hacia' });
      }

      const result = await CierreEstadoService.cambiarLote({
        anio: Number(anio),
        mes: Number(mes),
        desde: String(desde),
        hacia: String(hacia),
        motivo: motivo ?? null,
        actor: {
          id: user?.id ?? null,
          name: user?.nombre ?? user?.correo ?? null,
          areas: user?.area ?? null,
        },
      });

      return reply.status(result.fallidos.length ? 207 : 200).send(result);
    } catch (error: any) {
      if (error instanceof ErrorEstado) {
        return reply
          .status(error.status)
          .send({ error: error.message, code: error.code, ...(error.detalle || {}) });
      }
      return reply.status(500).send({ error: error.message });
    }
  }

  /**
   * Fija el color de la pestaña de un cierre en el canvas.
   *
   * `color: null` la devuelve al color automático del estado. El formato se
   * valida aquí y no en el service porque es una restricción del cliente
   * (Univer acepta #RRGGBB o #RRGGBBAA), no del dominio.
   */
  static async fijarColorHoja(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as any;
      const { color } = (request.body ?? {}) as { color?: string | null };
      const user = (request as any).user;

      const limpio = color == null || color === '' ? null : String(color).trim();
      if (limpio !== null && !/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(limpio)) {
        return reply
          .status(400)
          .send({ error: 'color debe ser #RRGGBB, #RRGGBBAA o null' });
      }

      const resultado = await PeriodoCierresService.fijarColorHoja(id, limpio);

      emitSheetColorChanged({
        anio: resultado.anio,
        mes: resultado.mes,
        cierreId: id,
        color: limpio,
        by: { id: user?.id ?? 'sistema', name: user?.nombre ?? user?.correo ?? 'Usuario' },
      });

      return reply.send(resultado);
    } catch (error: any) {
      const msg = error?.message || 'Error al fijar el color';
      return reply.status(/no encontrada/i.test(msg) ? 404 : 500).send({ error: msg });
    }
  }

  /** Historial de estados de un cierre — quién aprobó y cuándo. */
  static async historialEstados(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as any;
      return reply.send(await CierreEstadoService.historial(id));
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

  // ── BULK SAVE (async, con cola + socket) ──
  // Lanza el guardado de N liquidaciones en background. Emite
  // `liquidaciones-terceros-save-bulk:progress` y
  // `liquidaciones-terceros-save-bulk:done` al room `user-${userId}`.
  // El cliente persiste el batchId en localStorage para reanudar la
  // UI tras recarga (vía `GET /liquidaciones-terceros/save-bulk/:batchId`).

  static async guardarBorradorBulkAsync(request: FastifyRequest, reply: FastifyReply) {
    try {
      const body = (request.body as any) || {};
      const userId = (request as any).user?.id;
      const userName = (request as any).user?.nombre || 'Usuario';
      if (!userId) {
        return reply.status(401).send({ error: 'No autenticado' });
      }
      const placas = Array.isArray(body.placas) ? body.placas : [];
      if (placas.length === 0) {
        return reply.status(400).send({ error: 'Se requiere array `placas` con al menos un item' });
      }
      const mes = Number(body.mes);
      const anio = Number(body.anio);
      if (!Number.isFinite(mes) || !Number.isFinite(anio)) {
        return reply.status(400).send({ error: 'Se requiere `mes` y `anio` numéricos' });
      }

      const result = bulkSaveLiquidacionTerceroService.enqueue(userId, userName, {
        placas,
        mes,
        anio,
        force_new: body.force_new === true,
      });

      return reply.status(202).send({
        success: true,
        batchId: result.jobId,
        total: result.total,
        status: result.status,
      });
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  }

  static async getSaveBulkStatus(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { batchId } = request.params as any;
      const userId = (request as any).user?.id;
      if (!userId) {
        return reply.status(401).send({ error: 'No autenticado' });
      }
      const job = bulkSaveLiquidacionTerceroService.getStatus(batchId, userId);
      if (!job) {
        return reply.status(404).send({ error: 'batch_not_found' });
      }
      return reply.send({ success: true, data: job });
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  }

  static async cancelSaveBulk(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { batchId } = request.params as any;
      const userId = (request as any).user?.id;
      if (!userId) {
        return reply.status(401).send({ error: 'No autenticado' });
      }
      const ok = bulkSaveLiquidacionTerceroService.cancel(batchId, userId);
      return reply.send({ cancelled: ok });
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  }
}
