import { FastifyRequest, FastifyReply } from 'fastify';
import {
  envioNominaQueueService,
  MAX_ITEMS,
  type EnvioNominaPayload,
} from '../../queue/envio-nomina-queue.service';
import { NominaEnviosService } from './nomina-envios.service';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Copias por correo. `email_destino` de la constancia es VarChar(255). */
const MAX_CC = 5;
const MAX_ASUNTO = 200;
const MAX_MENSAJE = 4000;

function actorDe(request: FastifyRequest) {
  const u = (request as any).user ?? {};
  return {
    id: String(u.id ?? u.sub ?? ''),
    name: String(u.nombre ?? u.name ?? 'Usuario'),
  };
}

export class NominaEnviosController {
  /**
   * POST /nomina/envios/lote
   *
   * Encola el envío. El PDF lo genera el servidor, así que el cliente solo
   * manda a QUIÉN enviar y con qué texto — a diferencia de terceros, donde
   * el HTML de cada hoja viaja en la petición.
   */
  static async encolar(request: FastifyRequest, reply: FastifyReply) {
    const b = (request.body ?? {}) as Record<string, any>;
    const anio = Number(b.anio);
    const mes = Number(b.mes);

    if (!Number.isInteger(anio) || !Number.isInteger(mes) || mes < 1 || mes > 12) {
      return reply.status(400).send({ error: 'Periodo inválido (anio/mes).' });
    }
    if (!Array.isArray(b.items) || b.items.length === 0) {
      return reply.status(400).send({ error: 'No hay destinatarios en el lote.' });
    }
    if (b.items.length > MAX_ITEMS) {
      return reply.status(413).send({ error: `Máximo ${MAX_ITEMS} envíos por lote.` });
    }

    const asunto = typeof b.asunto === 'string' ? b.asunto.trim() : '';
    if (!asunto) return reply.status(400).send({ error: 'Falta el asunto.' });
    if (asunto.length > MAX_ASUNTO) {
      return reply.status(400).send({ error: `El asunto no puede pasar de ${MAX_ASUNTO} caracteres.` });
    }
    const mensaje = typeof b.mensaje === 'string' ? b.mensaje.slice(0, MAX_MENSAJE) : null;

    const esPrueba = b.es_prueba === true;
    const destinoPrueba = typeof b.destino_prueba === 'string' ? b.destino_prueba.trim() : '';
    if (esPrueba && !EMAIL_RE.test(destinoPrueba)) {
      // Sin esto, un «modo prueba» mal configurado mandaría la nómina real a
      // los conductores, que es justo lo que la prueba viene a evitar.
      return reply.status(400).send({ error: 'El modo prueba necesita un correo de destino válido.' });
    }

    const items: EnvioNominaPayload['items'] = [];
    for (const it of b.items) {
      const id = typeof it?.liquidacion_id === 'string' ? it.liquidacion_id.trim() : '';
      if (!id) return reply.status(400).send({ error: 'Hay un destinatario sin liquidación.' });
      const cc = Array.isArray(it?.cc)
        ? it.cc.map(String).map((x: string) => x.trim()).filter((x: string) => EMAIL_RE.test(x))
        : [];
      if (cc.length > MAX_CC) {
        return reply.status(400).send({ error: `Máximo ${MAX_CC} copias por correo.` });
      }
      items.push({ liquidacion_id: id, cc });
    }

    const actor = actorDe(request);
    if (!actor.id) return reply.status(401).send({ error: 'Sesión no válida.' });

    try {
      const { jobId } = envioNominaQueueService.encolar({
        payload: { anio, mes, items, asunto, mensaje, es_prueba: esPrueba, destino_prueba: destinoPrueba },
        userId: actor.id,
        userName: actor.name,
      });
      return reply.send({ job_id: jobId, total: items.length });
    } catch (e: any) {
      // Cola llena o periodo bloqueado: es una situación esperable y el
      // mensaje ya está redactado para leerlo tal cual.
      return reply.status(409).send({ error: e?.message ?? 'No se pudo encolar el lote.' });
    }
  }

  /** GET /nomina/envios/status/:jobId */
  static async status(request: FastifyRequest, reply: FastifyReply) {
    const { jobId } = request.params as { jobId: string };
    const job = envioNominaQueueService.estado(jobId);
    if (!job) return reply.status(404).send({ error: 'El lote ya no está disponible.' });
    return reply.send({
      job_id: job.id,
      status: job.status,
      total: job.total,
      hechos: job.hechos,
      progress: job.progress,
      currentStep: job.currentStep,
      resultados: job.resultados,
      error: job.error ?? null,
    });
  }

  /** DELETE /nomina/envios/job/:jobId */
  static async cancelar(request: FastifyRequest, reply: FastifyReply) {
    const { jobId } = request.params as { jobId: string };
    const ok = envioNominaQueueService.cancelar(jobId);
    return reply.send({ cancelado: ok });
  }

  /** GET /nomina/envios/periodo?anio=&mes= */
  static async estadoPeriodo(request: FastifyRequest, reply: FastifyReply) {
    const q = (request.query ?? {}) as Record<string, string>;
    const anio = Number(q.anio);
    const mes = Number(q.mes);
    if (!Number.isInteger(anio) || !Number.isInteger(mes) || mes < 1 || mes > 12) {
      return reply.status(400).send({ error: 'Periodo inválido (anio/mes).' });
    }
    return reply.send(await NominaEnviosService.estadoPorPeriodo(anio, mes));
  }

  /** GET /nomina/envios/liquidacion/:id */
  static async historial(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as { id: string };
    return reply.send(await NominaEnviosService.historial(id));
  }
}
