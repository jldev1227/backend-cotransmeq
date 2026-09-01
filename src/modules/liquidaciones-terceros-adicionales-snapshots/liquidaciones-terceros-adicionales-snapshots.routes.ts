import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { authMiddleware } from "../../middlewares/auth.middleware";
import { requirePermission } from "../../middlewares/permissions.middleware";
import { LiquidacionesTercerosAdicionalesSnapshotsService as Snaps } from "./liquidaciones-terceros-adicionales-snapshots.service";

const MODULO = "liquidaciones-terceros-adicionales";

function periodo(request: FastifyRequest): { anio: number; mes: number } | null {
  const q = request.query as any;
  const anio = Number(q?.anio);
  const mes = Number(q?.mes);
  if (!Number.isInteger(anio) || anio < 2000 || anio > 2100) return null;
  if (!Number.isInteger(mes) || mes < 1 || mes > 12) return null;
  return { anio, mes };
}

function fallo(reply: FastifyReply, ctx: string, error: any) {
  console.error(`[adicionales-snapshots] ${ctx}:`, error);
  const status = /no encontrad/i.test(String(error?.message)) ? 404 : 500;
  return reply.status(status).send({ error: error?.message });
}

export async function liquidacionesTercerosAdicionalesSnapshotsRoutes(app: FastifyInstance) {
  app.addHook("onRequest", authMiddleware);

  const puedeLeer = { preHandler: requirePermission(MODULO, "limited") };
  const puedeEscribir = { preHandler: requirePermission(MODULO, "full") };

  /// Historial de versiones de un periodo.
  app.get(
    "/liquidaciones-terceros-adicionales/snapshots",
    puedeLeer,
    async (request, reply) => {
      const p = periodo(request);
      if (!p) return reply.status(400).send({ error: "Se requiere anio y mes válidos" });
      try {
        return reply.send({ ...p, snapshots: await Snaps.listar(p.anio, p.mes) });
      } catch (e) {
        return fallo(reply, "listar", e);
      }
    },
  );

  /// Captura manual.
  app.post(
    "/liquidaciones-terceros-adicionales/snapshots",
    puedeEscribir,
    async (request, reply) => {
      const body = request.body as any;
      const anio = Number(body?.anio);
      const mes = Number(body?.mes);
      if (!Number.isInteger(anio) || !Number.isInteger(mes) || mes < 1 || mes > 12) {
        return reply.status(400).send({ error: "Se requiere anio y mes válidos" });
      }
      try {
        const snap = await Snaps.capturar(anio, mes, {
          origen: "manual",
          usuarioId: (request as any).user?.id ?? null,
        });
        return reply.status(201).send(snap);
      } catch (e) {
        return fallo(reply, "capturar", e);
      }
    },
  );

  app.get(
    "/liquidaciones-terceros-adicionales/snapshots/:id",
    puedeLeer,
    async (request, reply) => {
      try {
        return reply.send(await Snaps.obtener((request.params as any).id));
      } catch (e) {
        return fallo(reply, "obtener", e);
      }
    },
  );

  /// Diff contra otro snapshot (`?vs=<id>`) o contra el anterior.
  app.get(
    "/liquidaciones-terceros-adicionales/snapshots/:id/diff",
    puedeLeer,
    async (request, reply) => {
      try {
        const { id } = request.params as any;
        const vs = (request.query as any)?.vs;
        return reply.send(await Snaps.diff(id, vs || undefined));
      } catch (e) {
        return fallo(reply, "diff", e);
      }
    },
  );

  /// Restaura el periodo. Los cierres bloqueados se omiten y se reportan.
  app.post(
    "/liquidaciones-terceros-adicionales/snapshots/:id/revertir",
    puedeEscribir,
    async (request, reply) => {
      const userId = (request as any).user?.id;
      if (!userId) return reply.status(401).send({ error: "No autenticado" });
      try {
        return reply.send(await Snaps.revertir((request.params as any).id, userId));
      } catch (e) {
        return fallo(reply, "revertir", e);
      }
    },
  );
}
