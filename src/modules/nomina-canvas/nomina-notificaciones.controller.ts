import { FastifyReply, FastifyRequest } from 'fastify';
import { NominaNotificacionesService } from './nomina-notificaciones.service';

const MAX_LOTE = 200;

export class NominaNotificacionesController {
  /** POST /nomina/notificaciones — push móvil, nunca correo. */
  static async enviar(request: FastifyRequest, reply: FastifyReply) {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const liquidacionIds = Array.isArray(body.liquidacion_ids)
      ? [...new Set(body.liquidacion_ids.map(String).filter(Boolean))]
      : [];
    const anio = Number(body.anio);
    const mes = Number(body.mes);
    if (!liquidacionIds.length) {
      return reply.status(400).send({ error: 'Selecciona al menos un conductor.' });
    }
    if (liquidacionIds.length > MAX_LOTE) {
      return reply.status(413).send({ error: `Máximo ${MAX_LOTE} notificaciones por lote.` });
    }
    if (!Number.isInteger(anio) || !Number.isInteger(mes) || mes < 1 || mes > 12) {
      return reply.status(400).send({ error: 'Periodo inválido (anio/mes).' });
    }
    try {
      return reply.send(
        await NominaNotificacionesService.enviar({ liquidacionIds, anio, mes }),
      );
    } catch (error) {
      request.log.error({ err: error }, 'nomina: fallo al enviar notificaciones móviles');
      return reply.status(500).send({ error: 'No se pudieron enviar las notificaciones.' });
    }
  }
}
