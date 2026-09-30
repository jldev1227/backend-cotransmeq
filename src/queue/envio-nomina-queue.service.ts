/**
 * Cola de envío de desprendibles de nómina.
 *
 * POR QUÉ UNA COLA. El envío que había (`liquidaciones.routes.ts`) recorría
 * los conductores en un bucle dentro de la petición HTTP: con treinta
 * conductores la petición tardaba lo que tardaran treinta correos, el
 * navegador se quedaba esperando, y si se cortaba a mitad nadie sabía por
 * cuál iba. Además no persistía nada.
 *
 * Copia el planteamiento de `envio-liquidaciones-queue.service.ts`:
 *
 *  · Cola en memoria con lock por periodo (`anio:mes`), para que dos personas
 *    no manden la nómina del mismo mes a la vez y el conductor reciba dos
 *    correos.
 *  · Cancelación cooperativa con `AbortController`.
 *  · Ritmo entre envíos: Resend limita a 2 peticiones por segundo, así que
 *    sin pausa el lote se cae a mitad por 429.
 *  · Progreso por socket al usuario que lanzó, y el estado de cada
 *    desprendible al room del libro, para que los canvas abiertos lo pinten
 *    sin recargar.
 *  · Cada intento deja fila en `nomina_envio` ANTES de intentarlo.
 *
 * El correo es el de siempre de la empresa (`sendDesprendibleNotification`):
 * su marca, el botón al portal y copia oculta a talento humano. Esta cola traía
 * un cuerpo propio con la marca de transmeralda —cotransmeq lo mandaba así— y
 * adjuntaba el PDF del backend, que no es el desprendible que emite la
 * empresa (ese lo arma pdfmake en el portal). Ahora el conductor lo abre, lo
 * descarga y lo firma desde el portal, como con el envío de liquidaciones.
 */
import { randomUUID } from 'crypto';
import { env } from '../config/env';
import { prisma } from '../config/prisma';
import { EmailService, getEmailFrontendUrl } from '../services/email.service';
import { tokenPortalVigente } from '../modules/conductor-portal/portal-token.service';
import { NominaEnviosService } from '../modules/nomina-canvas/nomina-envios.service';
import { sheetRoomKey } from '../sockets/sheet-rooms';

const DELAY_MS = Number(env.ENVIO_LIQ_DELAY_MS) || 800;
const MAX_QUEUE = Number(env.ENVIO_LIQ_MAX_QUEUE) || 5;
const JOB_TTL_MS = Number(env.ENVIO_LIQ_JOB_TTL_MS) || 10 * 60 * 1000;

/** Tope por lote. Con más, la cola en memoria deja de ser razonable. */
export const MAX_ITEMS = 150;

const MESES = [
  'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO',
  'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE',
];

const periodoDe = (anio: number, mes: number) => `${MESES[mes - 1] ?? mes} ${anio}`;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
  });
}

export interface EnvioNominaItem {
  liquidacion_id: string;
  /** Copia opcional. El destinatario real sale del conductor. */
  cc?: string[];
}

export interface EnvioNominaPayload {
  anio: number;
  mes: number;
  items: EnvioNominaItem[];
  /** Plantilla con `{NOMBRE}` y `{PERIODO}`. */
  asunto: string;
  mensaje?: string | null;
  /** En modo prueba todo va a `destino_prueba` y el asunto lleva `[PRUEBA]`. */
  es_prueba: boolean;
  destino_prueba?: string | null;
}

export type EstadoJob = 'queued' | 'running' | 'complete' | 'error' | 'cancelled';

export interface ResultadoItem {
  liquidacion_id: string;
  conductor: string;
  email: string;
  estado: 'ENVIADO' | 'ERROR' | 'OMITIDO';
  error?: string;
}

export interface EnvioNominaJob {
  id: string;
  userId: string;
  userName: string;
  anio: number;
  mes: number;
  status: EstadoJob;
  total: number;
  hechos: number;
  progress: number;
  currentStep: string;
  resultados: ResultadoItem[];
  error?: string;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  /** Se libera al terminar: el payload lleva los adjuntos y pesa. */
  payload: EnvioNominaPayload | null;
}

export interface EmitTarget {
  userId?: string;
  room?: string;
}
type EmitFn = (target: EmitTarget, event: string, data: any) => void;

class EnvioNominaQueueService {
  private queue: EnvioNominaJob[] = [];
  private jobs = new Map<string, EnvioNominaJob>();
  private running = false;
  private emitFn: EmitFn | null = null;
  private aborts = new Map<string, AbortController>();
  private cleanupTimer: NodeJS.Timeout | null = null;
  /** `anio:mes` → jobId. Impide dos lotes del mismo periodo a la vez. */
  private locks = new Map<string, string>();

  setEmitter(fn: EmitFn) {
    this.emitFn = fn;
  }

  private emit(target: EmitTarget, event: string, data: any) {
    if (!this.emitFn) return;
    this.emitFn(target, event, data);
  }

  private clave(job: EnvioNominaJob) {
    return `${job.anio}:${job.mes}`;
  }

  encolar(params: {
    payload: EnvioNominaPayload;
    userId: string;
    userName: string;
  }): { jobId: string } {
    const { payload, userId, userName } = params;

    if (this.queue.length >= MAX_QUEUE) {
      throw new Error(`Hay ${this.queue.length} lotes esperando. Inténtalo en un momento.`);
    }
    const clave = `${payload.anio}:${payload.mes}`;
    if (this.locks.has(clave)) {
      throw new Error(
        `Ya se está enviando la nómina de ${periodoDe(payload.anio, payload.mes)}. Espera a que termine.`,
      );
    }

    const job: EnvioNominaJob = {
      id: randomUUID(),
      userId,
      userName,
      anio: payload.anio,
      mes: payload.mes,
      status: 'queued',
      total: payload.items.length,
      hechos: 0,
      progress: 0,
      currentStep: 'En cola',
      resultados: [],
      createdAt: Date.now(),
      payload,
    };

    this.jobs.set(job.id, job);
    this.queue.push(job);
    this.emit({ userId }, 'envio-nomina:queued', { job_id: job.id, total: job.total });
    this.programarLimpieza();
    void this.procesar();
    return { jobId: job.id };
  }

  estado(jobId: string): EnvioNominaJob | null {
    return this.jobs.get(jobId) ?? null;
  }

  cancelar(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    if (job.status === 'queued') {
      job.status = 'cancelled';
      this.queue = this.queue.filter((j) => j.id !== jobId);
      return true;
    }
    const abort = this.aborts.get(jobId);
    if (abort) {
      abort.abort();
      return true;
    }
    return false;
  }

  private programarLimpieza() {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => {
      const limite = Date.now() - JOB_TTL_MS;
      for (const [id, job] of this.jobs) {
        const fin = job.finishedAt ?? job.createdAt;
        if (fin < limite) this.jobs.delete(id);
      }
      if (this.jobs.size === 0 && this.cleanupTimer) {
        clearInterval(this.cleanupTimer);
        this.cleanupTimer = null;
      }
    }, 60_000);
    // El timer no debe impedir que el proceso termine.
    this.cleanupTimer.unref?.();
  }

  private async procesar() {
    if (this.running) return;
    const idx = this.queue.findIndex(
      (j) => j.status !== 'cancelled' && !this.locks.has(this.clave(j)),
    );
    if (idx === -1) return;

    const job = this.queue.splice(idx, 1)[0];
    const clave = this.clave(job);
    this.running = true;
    this.locks.set(clave, job.id);
    const abort = new AbortController();
    this.aborts.set(job.id, abort);

    job.status = 'running';
    job.startedAt = Date.now();
    this.emit({ userId: job.userId }, 'envio-nomina:start', {
      job_id: job.id,
      total: job.total,
    });

    try {
      await this.ejecutar(job, abort.signal);
      job.finishedAt = Date.now();
      if (abort.signal.aborted) {
        job.status = 'cancelled';
        this.emit({ userId: job.userId }, 'envio-nomina:cancelled', {
          job_id: job.id,
          resultados: job.resultados,
        });
      } else {
        job.status = 'complete';
        job.progress = 100;
        job.currentStep = 'Completado';
        this.emit({ userId: job.userId }, 'envio-nomina:complete', {
          job_id: job.id,
          resultados: job.resultados,
          enviados: job.resultados.filter((r) => r.estado === 'ENVIADO').length,
        });
      }
    } catch (e: any) {
      job.status = 'error';
      job.error = e?.message ?? 'Error desconocido';
      job.finishedAt = Date.now();
      this.emit({ userId: job.userId }, 'envio-nomina:error', {
        job_id: job.id,
        error: job.error,
      });
    } finally {
      // El payload lleva textos y referencias del lote: se suelta al acabar
      // para que un job terminado no siga ocupando memoria durante su TTL.
      job.payload = null;
      this.aborts.delete(job.id);
      this.locks.delete(clave);
      this.running = false;
      void this.procesar();
    }
  }

  private async ejecutar(job: EnvioNominaJob, signal: AbortSignal) {
    const payload = job.payload;
    if (!payload) throw new Error('El lote perdió su contenido.');

    const room = sheetRoomKey('nomina', job.anio, job.mes);
    const periodo = periodoDe(job.anio, job.mes);

    for (let i = 0; i < payload.items.length; i++) {
      if (signal.aborted) return;
      const item = payload.items[i];

      const liq = await prisma.liquidaciones.findFirst({
        where: { deleted_at: null, id: item.liquidacion_id },
        include: {
          conductores: {
            select: { id: true, nombre: true, apellido: true, email: true, numero_identificacion: true },
          },
        },
      });

      const conductor = liq?.conductores;
      const nombre = conductor ? `${conductor.nombre} ${conductor.apellido}`.trim() : '—';

      job.currentStep = `Enviando a ${nombre}`;
      this.emit({ userId: job.userId }, 'envio-nomina:progress', {
        job_id: job.id,
        current: i + 1,
        total: job.total,
        nombre,
      });

      // Sin correo no hay a dónde enviar. Se anota como OMITIDO y NO se crea
      // constancia: no hubo intento, y una fila en ERROR haría pensar que
      // el correo rebotó.
      const destinoReal = payload.es_prueba
        ? (payload.destino_prueba ?? '').trim()
        : (conductor?.email ?? '').trim();

      if (!liq || !conductor || !destinoReal) {
        job.resultados.push({
          liquidacion_id: item.liquidacion_id,
          conductor: nombre,
          email: destinoReal || '—',
          estado: 'OMITIDO',
          error: !liq
            ? 'La liquidación no existe.'
            : !conductor
              ? 'La liquidación no tiene conductor.'
              : 'El conductor no tiene correo registrado.',
        });
        job.hechos++;
        job.progress = Math.round((job.hechos / job.total) * 100);
        continue;
      }

      const cc = payload.es_prueba ? [] : (item.cc ?? []).filter(Boolean);
      const asunto =
        (payload.es_prueba ? '[PRUEBA] ' : '') +
        payload.asunto.replace(/\{NOMBRE\}/g, nombre).replace(/\{PERIODO\}/g, periodo);

      let registroId: string | null = null;
      try {
        // La constancia nace ANTES de intentar: si el proceso se muere aquí,
        // queda la evidencia de que se estaba enviando.
        const registro = await NominaEnviosService.crearRegistro({
          liquidacion_id: liq.id,
          conductor_id: conductor.id,
          anio: job.anio,
          mes: job.mes,
          email_destino: [destinoReal, ...cc].join(', '),
          asunto,
          mensaje: payload.mensaje ?? null,
          adjuntos: [],
          es_prueba: payload.es_prueba,
          enviado_por_id: job.userId,
          enviado_por: job.userName,
        });
        registroId = registro.id;

        const token = await tokenPortalVigente({
          id: conductor.id,
          numero_identificacion: conductor.numero_identificacion,
          nombre: conductor.nombre,
          apellido: conductor.apellido ?? '',
        });
        const resultado = await EmailService.sendDesprendibleNotification({
          to: destinoReal,
          cc,
          conductorNombre: nombre,
          periodo: `mes de ${MESES[job.mes - 1]?.toLowerCase() ?? job.mes}`,
          monto: '',
          portalLink: `${getEmailFrontendUrl()}/public/portal?token=${encodeURIComponent(token)}&desprendible=${liq.id}&tab=desprendibles`,
          asunto,
          mensaje: payload.mensaje ?? null,
          /// La prueba va a quien la lanza; a talento humano solo lo real.
          conCopiaOculta: !payload.es_prueba,
        });

        await NominaEnviosService.marcarEnviado(
          registroId,
          (resultado as any)?.proveedor ?? 'email',
          (resultado as any)?.id ?? null,
        );

        job.resultados.push({
          liquidacion_id: liq.id,
          conductor: nombre,
          email: destinoReal,
          estado: 'ENVIADO',
        });

        // Al room del libro, para que los canvas abiertos lo pinten en vivo.
        this.emit({ room }, 'envio-nomina:item', {
          liquidacion_id: liq.id,
          estado: 'ENVIADO',
          es_prueba: payload.es_prueba,
          by: { id: job.userId, name: job.userName },
        });
      } catch (e: any) {
        const mensaje = e?.message ?? 'Error desconocido';
        if (registroId) {
          await NominaEnviosService.marcarError(registroId, mensaje).catch(() => {
            /* si ni siquiera se puede anotar el error, no hay más que hacer */
          });
        }
        job.resultados.push({
          liquidacion_id: item.liquidacion_id,
          conductor: nombre,
          email: destinoReal,
          estado: 'ERROR',
          error: mensaje,
        });
        this.emit({ room }, 'envio-nomina:item', {
          liquidacion_id: item.liquidacion_id,
          estado: 'ERROR',
          error: mensaje,
          by: { id: job.userId, name: job.userName },
        });
      }

      job.hechos++;
      job.progress = Math.round((job.hechos / job.total) * 100);

      // Ritmo entre envíos. Resend corta en 2 peticiones por segundo; sin
      // esto el lote se cae a mitad por 429.
      if (i < payload.items.length - 1) await sleep(DELAY_MS, signal);
    }
  }
}

export const envioNominaQueueService = new EnvioNominaQueueService();
