import { FastifyRequest, FastifyReply } from "fastify";
import { LiquidacionesTercerosOcasionalSnapshotsService } from "./liquidaciones-terceros-ocasional-snapshots.service";

export class LiquidacionesTercerosOcasionalSnapshotsController {
  static async listar(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as any;
      const { rama } = request.query as any;
      const result = await LiquidacionesTercerosOcasionalSnapshotsService.listar(id, {
        rama,
      });
      return reply.send(result);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  }

  static async obtener(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id, snapshotId } = request.params as any;
      const result = await LiquidacionesTercerosOcasionalSnapshotsService.obtener(
        id,
        snapshotId
      );
      return reply.send(result);
    } catch (error: any) {
      const status = /no encontrad/i.test(error.message) ? 404 : 500;
      return reply.status(status).send({ error: error.message });
    }
  }

  static async comparar(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { snapshotId } = request.params as any;
      const { con } = request.query as any;
      if (!con) {
        return reply.status(400).send({ error: "Falta el parámetro 'con'" });
      }
      const result = await LiquidacionesTercerosOcasionalSnapshotsService.diff(
        snapshotId,
        String(con)
      );
      return reply.send(result);
    } catch (error: any) {
      const status = /no encontrad/i.test(error.message) ? 404 : 500;
      return reply.status(status).send({ error: error.message });
    }
  }

  static async revertir(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id, snapshotId } = request.params as any;
      const userId = (request as any).user?.id;
      if (!userId) return reply.status(401).send({ error: "No autenticado" });
      const result = await LiquidacionesTercerosOcasionalSnapshotsService.revertir(
        id,
        snapshotId,
        userId
      );
      return reply.send(result);
    } catch (error: any) {
      const status = /no encontrad/i.test(error.message)
        ? 404
        : /APROBADA|FACTURADA/i.test(error.message)
          ? 409
          : 500;
      return reply.status(status).send({ error: error.message });
    }
  }

  static async capturarManual(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as any;
      const userId = (request as any).user?.id;
      const result = await LiquidacionesTercerosOcasionalSnapshotsService.capturar(id, {
        origen: "manual",
        usuarioId: userId,
      });
      return reply.send(result);
    } catch (error: any) {
      const status = /no encontrad/i.test(error.message) ? 404 : 500;
      return reply.status(status).send({ error: error.message });
    }
  }

  /**
   * Cron job: protegido con x-cron-secret (igual que el de cierres finales).
   */
  static async capturarHorario(request: FastifyRequest, reply: FastifyReply) {
    try {
      const expected = process.env.CRON_SECRET;
      if (expected && request.headers["x-cron-secret"] !== expected) {
        return reply.status(401).send({ error: "Unauthorized" });
      }
      const result = await LiquidacionesTercerosOcasionalSnapshotsService.capturarHorario();
      return reply.send(result);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  }
}
