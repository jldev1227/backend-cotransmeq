import { FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import {
  LiquidacionesTercerosIngresosService,
  type GuardarIngresoParams,
} from "./liquidaciones-terceros-ingresos.service";
import {
  anualQuerySchema,
  periodoQuerySchema,
  guardarIngresoSchema,
  formatZodError,
} from "./liquidaciones-terceros-ingresos.schema";

function responderError(reply: FastifyReply, contexto: string, error: any) {
  if (error instanceof z.ZodError) {
    return reply.status(400).send(formatZodError(error));
  }
  console.error(`[ingresos-terceros] ${contexto} error:`, error);
  return reply.status(500).send({ error: error?.message ?? "Error interno" });
}

export class LiquidacionesTercerosIngresosController {
  /// GET /api/liquidaciones-terceros-ingresos/anual?anio=
  /// Los 12 meses en una sola petición (el canvas es un libro anual).
  static async listarAnual(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { anio } = anualQuerySchema.parse(request.query);
      // Las dos consultas son independientes —la primera lee los items en
      // vivo, la segunda lo que el equipo decidió encima— y el canvas necesita
      // ambas para pintar. En paralelo para no encadenar dos viajes.
      const [meses, estados] = await Promise.all([
        LiquidacionesTercerosIngresosService.listarAnual(anio),
        LiquidacionesTercerosIngresosService.estadoAnual(anio),
      ]);
      const total = Object.values(meses).reduce((s, arr) => s + arr.length, 0);
      return reply.send({ anio, meses, estados, total });
    } catch (error: any) {
      return responderError(reply, "listarAnual", error);
    }
  }

  /// GET /api/liquidaciones-terceros-ingresos/estado?mes=&anio=
  /// Solo el estado editable de un mes: lo que el canvas relee tras guardar.
  static async estadoPorPeriodo(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { mes, anio } = periodoQuerySchema.parse(request.query);
      const estado = await LiquidacionesTercerosIngresosService.estadoPorPeriodo(
        mes,
        anio,
      );
      return reply.send({ mes, anio, ...estado });
    } catch (error: any) {
      return responderError(reply, "estadoPorPeriodo", error);
    }
  }

  /// POST /api/liquidaciones-terceros-ingresos/guardar
  /// Idempotente: crea la cabecera del mes si es el primer guardado.
  static async guardarBorrador(request: FastifyRequest, reply: FastifyReply) {
    try {
      // El proyecto compila sin `strictNullChecks`, y con eso zod infiere TODOS
      // los campos como opcionales aunque el schema los exija. `parse` ya
      // garantizó la forma en tiempo de ejecución —si faltara algo habría
      // lanzado—, así que el cast solo le devuelve al tipo lo que la validación
      // ya sabe.
      const body = guardarIngresoSchema.parse(
        request.body,
      ) as unknown as GuardarIngresoParams;
      const user_id = (request as any).user?.id as string | undefined;
      const r = await LiquidacionesTercerosIngresosService.guardarBorrador({
        ...body,
        user_id,
      });
      return reply.send(r);
    } catch (error: any) {
      return responderError(reply, "guardarBorrador", error);
    }
  }

  /// GET /api/liquidaciones-terceros-ingresos?mes=&anio=
  static async listarPorPeriodo(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { mes, anio } = periodoQuerySchema.parse(request.query);
      const items = await LiquidacionesTercerosIngresosService.listarPorPeriodo(
        mes,
        anio,
      );
      return reply.send({ mes, anio, items, total: items.length });
    } catch (error: any) {
      return responderError(reply, "listarPorPeriodo", error);
    }
  }
}
