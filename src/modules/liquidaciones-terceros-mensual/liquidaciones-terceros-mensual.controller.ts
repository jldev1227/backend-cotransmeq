import { FastifyRequest, FastifyReply } from "fastify";
import { LiquidacionesTercerosMensualService } from "./liquidaciones-terceros-mensual.service";

export class LiquidacionesTercerosMensualController {
  // ── LIST / DETAIL ──

  static async listar(request: FastifyRequest, reply: FastifyReply) {
    try {
      const result = await LiquidacionesTercerosMensualService.listar(request.query as any);
      return reply.send(result);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  }

  static async obtenerPorId(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as any;
      const result = await LiquidacionesTercerosMensualService.obtenerPorId(id);
      if (!result) return reply.status(404).send({ error: "Liquidación mensual no encontrada" });
      return reply.send(result);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  }

  static async obtenerPorPeriodo(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { mes, anio } = request.query as any;
      if (!mes || !anio) {
        return reply.status(400).send({ error: "Se requiere mes y anio" });
      }
      const result = await LiquidacionesTercerosMensualService.obtenerPorPeriodo(
        Number(mes),
        Number(anio),
      );
      return reply.send(result || null);
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
      const result = await LiquidacionesTercerosMensualService.generarBorrador({
        mes: Number(body.mes),
        anio: Number(body.anio),
        user_id: userId,
      });
      return reply.send(result);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  }

  // ── GUARDAR BORRADOR ──

  static async guardarBorrador(request: FastifyRequest, reply: FastifyReply) {
    try {
      const body = request.body as any;
      const userId = (request as any).user?.id;
      const result = await LiquidacionesTercerosMensualService.guardarBorrador({
        id: body.id || undefined,
        mes: Number(body.mes),
        anio: Number(body.anio),
        observaciones: body.observaciones ?? null,
        adicionales: Array.isArray(body.adicionales) ? body.adicionales : [],
        conceptos: Array.isArray(body.conceptos) ? body.conceptos : [],
        user_id: userId,
        force_new: body.force_new === true,
      });
      return reply.send(result);
    } catch (error: any) {
      const status = /APROBADA|FACTURADA/.test(error.message) ? 409 : 500;
      return reply.status(status).send({ error: error.message });
    }
  }

  // ── RECALCULAR TOTALES ──

  static async recalcularTotales(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as any;
      const result = await LiquidacionesTercerosMensualService.recalcularTotales(id);
      return reply.send(result);
    } catch (error: any) {
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
      const result = await LiquidacionesTercerosMensualService.cambiarEstado(
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
      const result = await LiquidacionesTercerosMensualService.softDelete(id, userId);
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
      const result = await LiquidacionesTercerosMensualService.listarSnapshots(id);
      return reply.send(result);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  }

  // ── PREVIEW DATA ──

  static async obtenerPreviewData(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as any;
      const result = await LiquidacionesTercerosMensualService.obtenerPreviewData(id);
      if (!result) return reply.status(404).send({ error: "Liquidación mensual no encontrada" });
      return reply.send(result);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  }
}
