import { FastifyRequest, FastifyReply } from 'fastify';
import { LiquidacionesTercerosService } from './liquidaciones-terceros.service';

export class LiquidacionesTercerosController {

  static async guardar(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { liquidacion_id } = request.params as any;
      const { items } = request.body as any;
      if (!Array.isArray(items)) return reply.status(400).send({ error: 'items debe ser un array' });
      const result = await LiquidacionesTercerosService.guardar(liquidacion_id, items);
      return reply.send(result);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  }

  static async obtenerPorLiquidacion(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { liquidacion_id } = request.params as any;
      const result = await LiquidacionesTercerosService.obtenerPorLiquidacion(liquidacion_id);
      return reply.send(result);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  }

  static async listarHistorial(request: FastifyRequest, reply: FastifyReply) {
    try {
      const result = await LiquidacionesTercerosService.listarHistorial(request.query as any);
      return reply.send(result);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  }

  static async migrar(request: FastifyRequest, reply: FastifyReply) {
    try {
      const result = await LiquidacionesTercerosService.migrarDesdeJSON();
      return reply.send(result);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  }
}
