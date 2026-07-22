import { FastifyRequest, FastifyReply } from 'fastify';
import { LiquidacionesSnapshotsService } from './liquidaciones-terceros-snapshots.service';

export class LiquidacionesSnapshotsController {

  static async listar(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as any;
      const { rama } = request.query as any;
      const result = await LiquidacionesSnapshotsService.listar(id, { rama });
      return reply.send(result);
    } catch (error: any) {
      return reply.status(error.message.includes('no encontrado') ? 404 : 500).send({ error: error.message });
    }
  }

  static async obtener(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id, snapshotId } = request.params as any;
      const result = await LiquidacionesSnapshotsService.obtener(id, snapshotId);
      return reply.send(result);
    } catch (error: any) {
      return reply.status(error.message.includes('no encontrado') ? 404 : 500).send({ error: error.message });
    }
  }

  static async diff(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { snapshotId } = request.params as any;
      const { con } = request.query as any;
      if (!con) return reply.status(400).send({ error: 'Se requiere query param ?con=<snapshotId>' });
      const result = await LiquidacionesSnapshotsService.diff(snapshotId, con);
      return reply.send(result);
    } catch (error: any) {
      return reply.status(error.message.includes('no encontrado') ? 404 : 500).send({ error: error.message });
    }
  }

  static async revertir(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id, snapshotId } = request.params as any;
      const userId = (request as any).user?.id;
      if (!userId) return reply.status(401).send({ error: 'Usuario no autenticado' });
      const result = await LiquidacionesSnapshotsService.revertir(id, snapshotId, userId);
      return reply.send(result);
    } catch (error: any) {
      return reply.status(400).send({ error: error.message });
    }
  }

  static async cronHora(request: FastifyRequest, reply: FastifyReply) {
    try {
      const cronSecret = request.headers['x-cron-secret'] as string;
      if (cronSecret !== process.env.CRON_SECRET) {
        return reply.status(403).send({ error: 'No autorizado' });
      }
      const result = await LiquidacionesSnapshotsService.capturarHorario();
      return reply.send(result);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  }
}
