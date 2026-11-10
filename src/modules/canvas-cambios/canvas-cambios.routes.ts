import type { FastifyInstance } from "fastify";
import { authMiddleware } from "../../middlewares/auth.middleware";
import { checkAccess, normalizarRutasOverride } from "../../config/permissions";
import { prisma } from "../../config/prisma";
import { listarCambiosCelda } from "./canvas-cambios.service";

const MODULO: Record<string, string> = {
  "cierres-finales": "liquidaciones-terceros",
  adicionales: "liquidaciones-terceros-adicionales",
  ocasional: "liquidaciones-terceros",
  ingresos: "liquidaciones-terceros",
  nomina: "nomina",
  recorridos: "recorridos",
};

export async function canvasCambiosRoutes(app: FastifyInstance) {
  app.addHook("onRequest", authMiddleware);
  app.get("/canvas-cambios", async (request: any, reply) => {
    const { scope, anio, mes, sheet_key, limit } = request.query ?? {};
    if (
      !MODULO[scope] ||
      !Number.isInteger(Number(anio)) ||
      !Number.isInteger(Number(mes))
    ) {
      return reply
        .status(400)
        .send({ error: "scope, anio y mes válidos son obligatorios" });
    }
    const actorId = request.user?.id;
    const usuario = actorId
      ? await prisma.usuarios.findUnique({
          where: { id: actorId },
          select: { id: true, area: true, permisos_rutas: true, activo: true },
        })
      : null;
    if (
      !usuario?.activo ||
      !checkAccess(
        usuario.area as any,
        MODULO[scope],
        normalizarRutasOverride(usuario.permisos_rutas),
        usuario.id,
      ).allowed
    ) {
      return reply
        .status(403)
        .send({ error: "Sin permiso para consultar este canvas" });
    }
    try {
      const cambios = await listarCambiosCelda({
        scope,
        anio: Number(anio),
        mes: Number(mes),
        sheetKey: sheet_key === undefined ? null : String(sheet_key),
        limit: Number(limit) || 100,
      });
      return reply.send({ cambios });
    } catch (error: any) {
      return reply
        .status(500)
        .send({ error: error?.message ?? "Error consultando cambios" });
    }
  });
}
