import { FastifyRequest, FastifyReply } from 'fastify';
import {
  borradorNominaQueueService,
  type BorradorNominaPayload,
} from '../../queue/borrador-nomina-queue.service';
import { NominaCanvasService } from './nomina-canvas.service';

/** Techo por lote. Un periodo real ronda los quince conductores. */
const MAX_CONDUCTORES = 200;

function actorDe(request: FastifyRequest) {
  const u = (request as any).user ?? {};
  return {
    id: String(u.id ?? u.sub ?? ''),
    name: String(u.nombre ?? u.name ?? 'Usuario'),
  };
}

function periodoDe(b: Record<string, any>) {
  const anio = Number(b.anio);
  const mes = Number(b.mes);
  if (!Number.isInteger(anio) || !Number.isInteger(mes) || mes < 1 || mes > 12) {
    return null;
  }
  const corte = b.corte == null ? null : Number(b.corte);
  return { anio, mes, corte: Number.isFinite(corte as number) ? corte : null };
}

export class NominaBorradoresController {
  /**
   * Lo que hay que ver ANTES de lanzar.
   *
   * Sin esto, generar sobre un mes ya trabajado parece inocuo y no lo es: la
   * lista dice quién tiene ya liquidación y en qué estado, y quién no tiene
   * planillas y por tanto saldría en cero. Es el mismo aviso previo que da el
   * modal de cierres de terceros, y por el mismo motivo.
   */
  static async previo(request: FastifyRequest, reply: FastifyReply) {
    const p = periodoDe((request.query ?? {}) as Record<string, any>);
    if (!p) return reply.status(400).send({ error: 'Periodo inválido (anio/mes).' });

    try {
      const periodo = await NominaCanvasService.construirPeriodo({
        anio: p.anio,
        mes: p.mes,
        corte: p.corte ?? undefined,
      });

      const dias = periodo.periodo.dias;
      return reply.send({
        anio: p.anio,
        mes: p.mes,
        etiqueta: periodo.etiqueta,
        desde: dias[0]?.fecha ?? null,
        hasta: dias[dias.length - 1]?.fecha ?? null,
        conductores: (periodo.hojas as any[]).map((h) => ({
          conductor_id: h.conductorId,
          nombre: h.nombre,
          cedula: h.cedula,
          dias: h.dias?.length ?? 0,
          placas: h.placas ?? [],
          /// Null cuando no hay nada guardado todavía: es la señal de que
          /// generar aquí crea, no reemplaza.
          liquidacion_id: h.liquidacionId,
          estado: h.liquidacionId ? h.estado : null,
          sueldo_estimado: Number(h.totales?.sueldoTotal ?? 0),
          avisos: h.avisos ?? [],
        })),
      });
    } catch (e: any) {
      return reply
        .status(500)
        .send({ error: e?.message || 'No se pudo leer el periodo.' });
    }
  }

  static async generar(request: FastifyRequest, reply: FastifyReply) {
    const b = (request.body ?? {}) as Record<string, any>;
    const p = periodoDe(b);
    if (!p) return reply.status(400).send({ error: 'Periodo inválido (anio/mes).' });

    const conductorIds = Array.isArray(b.conductor_ids)
      ? b.conductor_ids.map(String).filter(Boolean)
      : [];
    if (conductorIds.length > MAX_CONDUCTORES) {
      return reply
        .status(400)
        .send({ error: `Máximo ${MAX_CONDUCTORES} conductores por lote.` });
    }

    /// Solo se sobrescribe a quien viene también en la selección: si no, un
    /// id colado aquí reemplazaría una liquidación que nadie marcó.
    const pedidos = new Set(conductorIds);
    const sobrescribir = (
      Array.isArray(b.sobrescribir) ? b.sobrescribir.map(String) : []
    ).filter((id: string) => pedidos.has(id));

    const actor = actorDe(request);
    if (!actor.id) return reply.status(401).send({ error: 'Sesión no válida.' });

    try {
      const payload: BorradorNominaPayload = {
        anio: p.anio,
        mes: p.mes,
        corte: p.corte,
        conductorIds,
        sobrescribir,
      };
      const r = borradorNominaQueueService.enqueue(actor.id, actor.name, payload);

      if (r.status === 'locked') {
        return reply.status(409).send({
          error: 'Ya hay una generación en curso para este periodo.',
          job_id: r.jobId,
          locked_by: r.lockedBy,
        });
      }
      return reply.send({ job_id: r.jobId, status: r.status, total: conductorIds.length });
    } catch (e: any) {
      return reply.status(400).send({ error: e?.message || 'No se pudo encolar.' });
    }
  }

  static async estado(request: FastifyRequest, reply: FastifyReply) {
    const { jobId } = request.params as { jobId: string };
    const job = borradorNominaQueueService.getStatus(jobId);
    if (!job) return reply.status(404).send({ error: 'Job no encontrado o expirado.' });
    return reply.send(job);
  }

  static async cancelar(request: FastifyRequest, reply: FastifyReply) {
    const { jobId } = request.params as { jobId: string };
    const actor = actorDe(request);
    const ok = borradorNominaQueueService.cancel(jobId, actor.id);
    /// La promesa honesta: no aborta el conductor en curso ni deshace lo ya
    /// guardado. Esos borradores son válidos y se quedan.
    return reply.send({
      cancelado: ok,
      nota: ok ? 'Se detiene al terminar el conductor en curso.' : undefined,
    });
  }
}
