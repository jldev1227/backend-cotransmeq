import { FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import {
  LiquidacionesTercerosAdicionalesService,
  ConflictoVersionError,
} from "./liquidaciones-terceros-adicionales.service";
import {
  periodoQuerySchema,
  anualQuerySchema,
  idParamSchema,
  crearAdicionalSchema,
  patchCampoSchema,
  guardarLoteSchema,
  formatZodError,
} from "./liquidaciones-terceros-adicionales.schema";

/** Mapea un error de dominio al status HTTP correspondiente. */
function statusDeError(error: any): number {
  if (error instanceof ConflictoVersionError) return 409;
  const msg = String(error?.message || "");
  if (/no encontrad/i.test(msg)) return 404;
  if (/APROBADA|FACTURADA|ANULADA/i.test(msg)) return 409;
  if (/no editable|pertenece a/i.test(msg)) return 400;
  return 500;
}

function responderError(reply: FastifyReply, contexto: string, error: any) {
  if (error instanceof z.ZodError) {
    return reply.status(400).send(formatZodError(error));
  }
  console.error(`[adicionales] ${contexto} error:`, error);
  if (error instanceof ConflictoVersionError) {
    return reply.status(409).send({
      error: error.message,
      code: error.code,
      entity_id: error.entityId,
      server_row: error.serverRow,
    });
  }
  return reply.status(statusDeError(error)).send({ error: error.message });
}

export class LiquidacionesTercerosAdicionalesController {
  /// GET /api/liquidaciones-terceros-adicionales?mes=&anio=
  static async listarPorPeriodo(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { mes, anio } = periodoQuerySchema.parse(request.query);
      const items =
        await LiquidacionesTercerosAdicionalesService.obtenerAdicionalesPorPeriodo(
          mes,
          anio,
        );
      return reply.send({ items, total: items.length });
    } catch (error: any) {
      return responderError(reply, "listarPorPeriodo", error);
    }
  }

  /// GET /api/liquidaciones-terceros-adicionales/anual?anio=
  /// Los 12 meses en una sola petición. Sustituye el fan-out de 12 llamadas
  /// que hacía el canvas anual.
  static async listarAnual(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { anio } = anualQuerySchema.parse(request.query);
      const meses =
        await LiquidacionesTercerosAdicionalesService.obtenerAdicionalesAnual(anio);
      const total = Object.values(meses).reduce((s, arr) => s + arr.length, 0);
      return reply.send({ anio, meses, total });
    } catch (error: any) {
      return responderError(reply, "listarAnual", error);
    }
  }

  /// POST /api/liquidaciones-terceros-adicionales
  static async crear(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { cierre_id, ...datos } = crearAdicionalSchema.parse(request.body);
      const fila = await LiquidacionesTercerosAdicionalesService.crearAdicional({
        cierre_id,
        datos,
        user_id: (request as any).user?.id,
      });
      return reply.status(201).send(fila);
    } catch (error: any) {
      return responderError(reply, "crear", error);
    }
  }

  /// PATCH /api/liquidaciones-terceros-adicionales/:id
  /// Body: { field, value, base_version }
  /// 409 con `server_row` si otro usuario escribió antes.
  static async actualizarCampo(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = idParamSchema.parse(request.params);
      const { field, value, base_version } = patchCampoSchema.parse(request.body);
      const fila = await LiquidacionesTercerosAdicionalesService.actualizarCampo({
        id,
        field,
        value,
        base_version,
        user_id: (request as any).user?.id,
      });
      return reply.send(fila);
    } catch (error: any) {
      return responderError(reply, "actualizarCampo", error);
    }
  }

  /// DELETE /api/liquidaciones-terceros-adicionales/:id  (soft)
  static async eliminar(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = idParamSchema.parse(request.params);
      const r = await LiquidacionesTercerosAdicionalesService.eliminarAdicional({
        id,
        user_id: (request as any).user?.id,
      });
      return reply.send(r);
    } catch (error: any) {
      return responderError(reply, "eliminar", error);
    }
  }

  /// PUT /api/liquidaciones-terceros-adicionales — DEPRECADO.
  /// Se conserva un ciclo para clientes viejos; el canvas usa POST/PATCH/DELETE.
  static async guardar(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { mes, anio, items } = guardarLoteSchema.parse(request.body);
      const result =
        await LiquidacionesTercerosAdicionalesService.guardarAdicionalesPorPeriodo({
          mes,
          anio,
          items: items as any,
          user_id: (request as any).user?.id,
        });
      return reply.send(result);
    } catch (error: any) {
      return responderError(reply, "guardar", error);
    }
  }
}
