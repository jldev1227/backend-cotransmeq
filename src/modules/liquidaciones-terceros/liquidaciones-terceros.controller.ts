import { FastifyRequest, FastifyReply } from 'fastify';
import { LiquidacionesTercerosService } from './liquidaciones-terceros.service';

export const LiquidacionesTercerosController = {

  async guardar(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { liquidacion_id } = req.params as any;
      const { items } = req.body as any;
      if (!Array.isArray(items)) return reply.status(400).send({ error: 'items debe ser un array' });
      const result = await LiquidacionesTercerosService.guardar(liquidacion_id, items);
      return reply.send(result);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  },

  async obtenerPorLiquidacion(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { liquidacion_id } = req.params as any;
      const result = await LiquidacionesTercerosService.obtenerPorLiquidacion(liquidacion_id);
      return reply.send(result);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  },

  async listarHistorial(req: FastifyRequest, reply: FastifyReply) {
    try {
      const result = await LiquidacionesTercerosService.listarHistorial(req.query as any);
      return reply.send(result);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  },

  async migrar(req: FastifyRequest, reply: FastifyReply) {
    try {
      const result = await LiquidacionesTercerosService.migrarDesdeJSON();
      return reply.send(result);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  },
};
