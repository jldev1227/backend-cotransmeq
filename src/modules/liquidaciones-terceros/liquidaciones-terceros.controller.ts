import { FastifyRequest, FastifyReply } from 'fastify';
import { LiquidacionesTercerosService } from './liquidaciones-terceros.service';
import { emitLiquidacionTercero, eventoMeta } from '../../sockets';
import { prisma } from '../../config/prisma';

export class LiquidacionesTercerosController {

  static async guardar(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { liquidacion_id } = request.params as any;
      const { items } = request.body as any;
      if (!Array.isArray(items)) return reply.status(400).send({ error: 'items debe ser un array' });
      const result = await LiquidacionesTercerosService.guardar(liquidacion_id, items);

      // Este módulo no emitía NADA: guardar los terceros de una liquidación
      // no llegaba a los demás usuarios y el tab de Terceros del dashboard
      // solo se enteraba recargando a mano. Se emite DESPUÉS de guardar y
      // fuera de la transacción, para no avisar de algo que luego revierte.
      //
      // El fallo al emitir no debe tumbar la escritura: el guardado ya
      // ocurrió y devolver 500 haría que el cliente reintentara un `guardar`
      // que borra y recrea las filas.
      try {
        const liq = await prisma.liquidacion_servicio.findUnique({
          where: { id: liquidacion_id },
          select: { consecutivo: true, mes: true, anio: true },
        });
        emitLiquidacionTercero(
          'liquidacion-tercero-updated',
          {
            liquidacion_id,
            consecutivo: liq?.consecutivo ?? null,
            mes: liq?.mes ?? null,
            anio: liq?.anio ?? null,
            total_items: Array.isArray(result) ? result.length : 0,
          },
          eventoMeta({
            tipo: 'updated',
            scope: 'terceros',
            actor: {
              id: (request as any).user?.id ?? null,
              nombre: (request as any).user?.nombre || 'Usuario',
            },
            etiqueta: liq?.consecutivo ?? liquidacion_id.slice(0, 8),
          }),
        );
      } catch (e) {
        console.error('[liquidaciones-terceros] emit socket falló:', e);
      }

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
