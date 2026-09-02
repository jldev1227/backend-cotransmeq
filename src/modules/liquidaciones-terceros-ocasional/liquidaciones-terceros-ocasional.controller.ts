import { FastifyRequest, FastifyReply } from "fastify";
import { LiquidacionesTercerosOcasionalService } from "./liquidaciones-terceros-ocasional.service";

export class LiquidacionesTercerosOcasionalController {
  // ── LIST / DETAIL ──

  static async listar(request: FastifyRequest, reply: FastifyReply) {
    try {
      const result = await LiquidacionesTercerosOcasionalService.listar(request.query as any);
      return reply.send(result);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  }

  static async obtenerPorId(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as any;
      const result = await LiquidacionesTercerosOcasionalService.obtenerPorId(id);
      if (!result) return reply.status(404).send({ error: "Liquidación mensual no encontrada" });
      return reply.send(result);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  }

  /// GET /api/liquidaciones-terceros-ocasional/anual?anio=
  /// Los 12 meses en una sola petición (canvas anual). Devuelve siempre 12
  /// entradas; los meses sin borrador llegan con `cabecera: null`.
  static async obtenerAnual(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { anio } = request.query as any;
      const anioNum = Number(anio);
      if (!anioNum || anioNum < 2000 || anioNum > 2100) {
        return reply.status(400).send({ error: "Se requiere un `anio` válido" });
      }
      const result = await LiquidacionesTercerosOcasionalService.obtenerAnual(anioNum);
      return reply.send(result);
    } catch (error: any) {
      console.error("[ocasional] obtenerAnual error:", error);
      return reply.status(500).send({ error: error.message });
    }
  }

  static async obtenerPorPeriodo(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { mes, anio } = request.query as any;
      if (!mes || !anio) {
        return reply.status(400).send({ error: "Se requiere mes y anio" });
      }
      const result = await LiquidacionesTercerosOcasionalService.obtenerPorPeriodo(
        Number(mes),
        Number(anio)
      );
      return reply.send(result || null);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  }

  // ── PREVISUALIZAR (modal selector) ──

  static async previsualizar(request: FastifyRequest, reply: FastifyReply) {
    try {
      const body = request.body as any;
      if (!body?.mes || !body?.anio) {
        return reply.status(400).send({ error: "Se requiere mes y anio" });
      }
      const result = await LiquidacionesTercerosOcasionalService.previsualizar({
        mes: Number(body.mes),
        anio: Number(body.anio),
        terceros_filtro: Array.isArray(body.terceros_filtro) ? body.terceros_filtro : [],
      });
      return reply.send(result);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  }

  static async buscarTercerosCandidatos(request: FastifyRequest, reply: FastifyReply) {
    try {
      const q = request.query as any;
      if (!q?.mes || !q?.anio) {
        return reply.status(400).send({ error: "Se requiere mes y anio" });
      }
      const result = await LiquidacionesTercerosOcasionalService.buscarTercerosCandidatos({
        mes: Number(q.mes),
        anio: Number(q.anio),
        busqueda: q.busqueda || "",
        filtro_tipo: (q.filtro_tipo as "documento" | "placa" | "nombre") || "nombre",
      });
      return reply.send({ items: result });
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  }

  // ── GENERAR BORRADOR ──

  static async generarBorrador(request: FastifyRequest, reply: FastifyReply) {
    try {
      const body = request.body as any;
      if (!body?.mes || !body?.anio) {
        return reply.status(400).send({ error: "Se requiere mes y anio" });
      }
      const userId = (request as any).user?.id;
      const result = await LiquidacionesTercerosOcasionalService.generarBorrador({
        mes: Number(body.mes),
        anio: Number(body.anio),
        user_id: userId,
        terceros_filtro: Array.isArray(body.terceros_filtro) ? body.terceros_filtro : [],
      });
      return reply.send(result);
    } catch (error: any) {
      console.error("[generarBorrador] stack:", error?.stack);
      return reply.status(500).send({ error: error.message });
    }
  }

  // ── REFRESCAR ──
  //
  // Incorpora al borrador los items que se volvieron elegibles después de
  // generarlo. Es aditivo: no toca lo ya guardado.

  // ── ITEMS DISPONIBLES DE OTROS PERIODOS ──
  // Items sueltos de cualquier mes que podrían entrar en este ocasional. Es lo
  // que `refrescar` no ve, porque aquel solo mira el mes del borrador.

  static async itemsDisponibles(request: FastifyRequest, reply: FastifyReply) {
    try {
      const q = request.query as any;
      if (!q?.mes || !q?.anio) {
        return reply.status(400).send({ error: "Se requiere mes y anio" });
      }
      const result = await LiquidacionesTercerosOcasionalService.itemsDisponibles({
        mes: Number(q.mes),
        anio: Number(q.anio),
      });
      return reply.send(result);
    } catch (error: any) {
      console.error("[ocasional itemsDisponibles]", error?.stack);
      return reply.status(500).send({ error: error.message });
    }
  }

  // ── AÑADIR AL OCASIONAL LOS ITEMS ELEGIDOS ──

  static async agregarItems(request: FastifyRequest, reply: FastifyReply) {
    try {
      const body = request.body as any;
      if (!body?.mes || !body?.anio) {
        return reply.status(400).send({ error: "Se requiere mes y anio" });
      }
      if (!Array.isArray(body.liquidacion_tercero_ids)) {
        return reply
          .status(400)
          .send({ error: "liquidacion_tercero_ids debe ser un array" });
      }
      const result = await LiquidacionesTercerosOcasionalService.agregarItems({
        mes: Number(body.mes),
        anio: Number(body.anio),
        liquidacion_tercero_ids: body.liquidacion_tercero_ids,
        user_id: (request as any).user?.id,
      });
      return reply.send(result);
    } catch (error: any) {
      const msg = error.message || "Error al agregar items";
      // 409 y no 400: el cuerpo era válido; lo que impide la operación es el
      // ESTADO de la liquidación o del item, y quien llama puede resolverlo.
      const status = /No hay borrador/i.test(msg)
        ? 404
        : /ya está|ya están|no admite|ya no existen/i.test(msg)
          ? 409
          : 500;
      return reply.status(status).send({ error: msg });
    }
  }

  static async refrescar(request: FastifyRequest, reply: FastifyReply) {
    try {
      const body = request.body as any;
      if (!body?.mes || !body?.anio) {
        return reply.status(400).send({ error: "Se requiere mes y anio" });
      }
      const userId = (request as any).user?.id;
      const result = await LiquidacionesTercerosOcasionalService.refrescar({
        mes: Number(body.mes),
        anio: Number(body.anio),
        user_id: userId,
      });
      return reply.send(result);
    } catch (error: any) {
      console.error("[refrescar] stack:", error?.stack);
      return reply.status(500).send({ error: error.message });
    }
  }

  // ── GUARDAR BORRADOR ──

  static async guardarBorrador(request: FastifyRequest, reply: FastifyReply) {
    try {
      const body = request.body as any;
      const userId = (request as any).user?.id;
      const result = await LiquidacionesTercerosOcasionalService.guardarBorrador({
        id: body.id || undefined,
        mes: Number(body.mes),
        anio: Number(body.anio),
        observaciones: body.observaciones ?? null,
        adicionales: Array.isArray(body.adicionales) ? body.adicionales : [],
        conceptos: Array.isArray(body.conceptos) ? body.conceptos : [],
        items: Array.isArray(body.items) ? body.items : [],
        user_id: userId,
        force_new: body.force_new === true,
      });
      return reply.send(result);
    } catch (error: any) {
      const status = /APROBADA|FACTURADA/.test(error.message) ? 409 : 500;
      return reply.status(status).send({ error: error.message });
    }
  }

  // ── AUTOSAVE DRAFT ──

  static async guardarDraft(request: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = (request as any).user?.id;
      const body = request.body as any;
      if (!body?.liquidacion_ocasional_id || !userId) {
        return reply.status(400).send({ error: "Faltan parámetros" });
      }
      const result = await LiquidacionesTercerosOcasionalService.guardarDraft({
        liquidacion_ocasional_id: body.liquidacion_ocasional_id,
        user_id: userId,
        payload: body.payload ?? {},
      });
      return reply.send(result);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  }

  static async obtenerDraft(request: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = (request as any).user?.id;
      const { id } = request.params as any;
      if (!userId) return reply.status(401).send({ error: "No autenticado" });
      const result = await LiquidacionesTercerosOcasionalService.obtenerDraft({
        liquidacion_ocasional_id: id,
        user_id: userId,
      });
      return reply.send(result);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  }

  static async eliminarDraft(request: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = (request as any).user?.id;
      const { id } = request.params as any;
      if (!userId) return reply.status(401).send({ error: "No autenticado" });
      const result = await LiquidacionesTercerosOcasionalService.eliminarDraft({
        liquidacion_ocasional_id: id,
        user_id: userId,
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
      const result = await LiquidacionesTercerosOcasionalService.recalcularTotales(id);
      return reply.send(result);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  }

  // ── CERRAR Y DISTRIBUIR ──

  static async cerrarYDistribuir(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as any;
      const userId = (request as any).user?.id;
      if (!userId) return reply.status(401).send({ error: "No autenticado" });
      const result = await LiquidacionesTercerosOcasionalService.cerrarYDistribuir({
        id,
        user_id: userId,
      });
      return reply.send(result);
    } catch (error: any) {
      if (error.statusCode === 409) {
        return reply.status(409).send({
          error: error.message,
          code: error.code,
          placas_faltantes: error.placas_faltantes,
        });
      }
      return reply.status(500).send({ error: error.message });
    }
  }

  // ── CAMBIAR ESTADO ──

  static async cambiarEstado(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as any;
      const { estado, motivo_anulacion } = request.body as any;
      const userId = (request as any).user?.id;
      if (!estado) return reply.status(400).send({ error: "Se requiere estado" });
      const result = await LiquidacionesTercerosOcasionalService.cambiarEstado(
        id,
        estado,
        userId,
        motivo_anulacion
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
      const result = await LiquidacionesTercerosOcasionalService.softDelete(id, userId);
      return reply.send(result);
    } catch (error: any) {
      const msg = error.message || "Error al eliminar";
      const status = /no encontrada|ya eliminada/i.test(msg)
        ? 404
        : /no se puede eliminar/i.test(msg)
          ? 409
          : 500;
      return reply.status(status).send({ error: msg });
    }
  }

  // ── SNAPSHOTS ──

  static async listarSnapshots(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as any;
      const result = await LiquidacionesTercerosOcasionalService.listarSnapshots(id);
      return reply.send(result);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  }

  // ── PREVIEW DATA ──

  static async obtenerPreviewData(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as any;
      const result = await LiquidacionesTercerosOcasionalService.obtenerPreviewData(id);
      if (!result) return reply.status(404).send({ error: "Liquidación mensual no encontrada" });
      return reply.send(result);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  }
}
