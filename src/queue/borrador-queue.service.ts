/**
 * Cola de generación de borradores de cierres finales.
 *
 * Sin Redis: vive en memoria, en un solo proceso. Eso es una restricción
 * asumida, no un descuido — pero obliga a que todo lo que aquí se hace sea
 * correcto dentro de ese proceso.
 *
 * Cuatro cosas cambiaron respecto a la versión anterior:
 *
 * 1. **El lock es por PERIODO, no global.** Antes bastaba con que alguien
 *    estuviera generando cualquier cosa para que todo el sistema devolviera
 *    "locked". Dos usuarios trabajando en meses distintos se bloqueaban sin
 *    motivo. Ahora la exclusión es sobre `${anio}:${mes}`, que es el ámbito
 *    donde de verdad pueden pisarse, y `CONCURRENCY` sigue siendo el techo
 *    global aparte.
 *
 * 2. **`cancel` cancela.** Antes marcaba el job como `cancelled` y el bucle
 *    seguía generando hasta el final. Ahora hay un `AbortController` que se
 *    comprueba entre placas. No se puede abortar una transacción en vuelo,
 *    así que la promesa al usuario es "se detiene al terminar la placa en
 *    curso" y eso es lo que la UI debe decir.
 *
 * 3. **Se puede emitir al ROOM del libro, no solo al usuario.** El progreso
 *    es del usuario que lanzó el job; las altas de hoja son de todos los que
 *    tienen el periodo abierto.
 *
 * 4. **Persistencia encadenada opcional.** Con `persistir: true` el job no se
 *    queda en la previsualización: guarda cada cierre y anuncia su hoja. Es
 *    lo que necesita el canvas, donde no hay un formulario intermedio donde
 *    revisar el borrador antes de guardarlo.
 */

import { randomUUID } from "crypto";
import { LiquidacionesTercerosDescuentosService } from "../modules/liquidaciones-terceros-descuentos/liquidaciones-terceros-descuentos.service";
import { PeriodoCierresService } from "../modules/liquidaciones-terceros-descuentos/periodo-cierres.service";
import { env } from "../config/env";

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type BorradorJobStatus =
  | "queued"
  | "running"
  | "complete"
  | "error"
  | "cancelled";

export interface BorradorJobPayload {
  liquidacion_servicio_id?: string;
  liquidacion_servicio_ids?: string[];
  placa?: string;
  /**
   * Filtro opcional por `tercero_id` para discriminar items cuando una
   * placa cambió de propietario a mitad de mes. Ver `generarBorrador` en el
   * service de liquidaciones-terceros-descuentos.
   */
  tercero_id?: string | null;

  // ── Modo encadenado (canvas) ──
  /** Además de generar, persistir cada cierre y anunciar su hoja. */
  persistir?: boolean;
  /** Periodo del libro. Obligatorio si `persistir`. */
  anio?: number;
  mes?: number;
  /**
   * Subconjunto de placas a persistir. Vacío = todas las generadas.
   * El usuario las elige en el modal.
   */
  placas?: string[];
  /**
   * Crear un cierre nuevo aunque ya exista uno para la placa/tercero del
   * periodo, marcando el anterior como REEMPLAZADA.
   */
  force_new?: boolean;
}

export interface BorradorJob {
  id: string;
  status: BorradorJobStatus;
  userId: string;
  userName: string;
  payload: BorradorJobPayload;
  progress: number;
  currentStep: string;
  processed: number;
  total: number;
  result?: any;
  error?: string;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  /** Cierres persistidos, cuando el job corre en modo encadenado. */
  guardados?: Array<{ id: string; placa: string; tercero_id: string | null }>;
  /** Placas que fallaron al persistir. El resto sí se guardó. */
  fallidos?: Array<{ placa: string; error: string }>;
}

export interface LockedByInfo {
  userId: string;
  userName: string;
  startedAt: number;
  currentStep: string;
  progress: number;
  jobId: string;
  /** Periodo bloqueado, para que la UI diga *qué* está ocupado. */
  anio: number | null;
  mes: number | null;
}

// ═══════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════

const CONCURRENCY = Number(env.BORRADOR_QUEUE_CONCURRENCY) || 1;
const MAX_QUEUE_SIZE = Number(env.BORRADOR_QUEUE_MAX_SIZE) || 10;
const JOB_TTL_MS = Number(env.BORRADOR_QUEUE_JOB_TTL_MS) || 5 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60_000;

/**
 * Clave de exclusión mutua.
 *
 * Un job sin periodo (el flujo antiguo, que no lo manda) cae en una clave
 * propia `sin-periodo`, así que sigue siendo exclusivo consigo mismo pero no
 * bloquea a los canvas.
 */
function claveLock(p: BorradorJobPayload): string {
  return p.anio && p.mes ? `${p.anio}:${p.mes}` : "sin-periodo";
}

// ═══════════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════════

/**
 * Destino de un evento. `userId` para el progreso privado, `room` para lo
 * que todos los que miran el periodo deben ver.
 */
export interface EmitTarget {
  userId?: string;
  room?: string;
}

type EmitFn = (target: EmitTarget, event: string, data: any) => void;

class BorradorQueueService {
  private queue: BorradorJob[] = [];
  private jobs = new Map<string, BorradorJob>();
  private runningCount = 0;
  private emitFn: EmitFn | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;
  /** Periodos con un job corriendo → jobId. */
  private locks = new Map<string, string>();
  /** Señales de cancelación por jobId. */
  private aborts = new Map<string, AbortController>();

  setEmitter(fn: EmitFn) {
    this.emitFn = fn;
    console.log("[borrador-queue] emitter configurado");
    this.startCleanup();
  }

  // ── PUBLIC API ──

  enqueue(
    userId: string,
    userName: string,
    payload: BorradorJobPayload,
  ): { jobId: string; status: "queued" | "locked"; lockedBy?: LockedByInfo } {
    this.purgeOldJobs();

    // Exclusión por PERIODO. Dos usuarios en meses distintos no se estorban.
    const clave = claveLock(payload);
    const bloqueante = this.jobDelLock(clave);
    if (bloqueante) {
      const lockedBy: LockedByInfo = {
        userId: bloqueante.userId,
        userName: bloqueante.userName,
        startedAt: bloqueante.startedAt!,
        currentStep: bloqueante.currentStep,
        progress: bloqueante.progress,
        jobId: bloqueante.id,
        anio: bloqueante.payload.anio ?? null,
        mes: bloqueante.payload.mes ?? null,
      };
      this.emit({ userId }, "borrador:locked", { locked_by: lockedBy });
      return { jobId: "", status: "locked", lockedBy };
    }

    // Un job en cola por usuario: reencolar el mismo periodo dos veces solo
    // duplicaría los cierres.
    const existente = this.queue.find((j) => j.userId === userId);
    if (existente) {
      return { jobId: existente.id, status: "queued" };
    }

    if (this.queue.length >= MAX_QUEUE_SIZE) {
      this.emit({ userId }, "borrador:error", {
        error: "La cola de borradores esta llena. Intenta en unos minutos.",
      });
      throw new Error("La cola de borradores esta llena");
    }

    const job: BorradorJob = {
      id: randomUUID(),
      status: "queued",
      userId,
      userName,
      payload,
      progress: 0,
      currentStep: "En cola...",
      processed: 0,
      total: 0,
      createdAt: Date.now(),
    };

    this.queue.push(job);
    this.jobs.set(job.id, job);

    this.emit({ userId }, "borrador:queued", {
      job_id: job.id,
      position: this.queue.length,
    });

    this.processNext();

    return { jobId: job.id, status: "queued" };
  }

  getStatus(jobId: string): BorradorJob | null {
    return this.jobs.get(jobId) || null;
  }

  /**
   * Cancela un job.
   *
   * Si ya está corriendo, dispara el `AbortController`: el bucle lo mira
   * entre placas y se detiene. La placa en curso termina — no se puede
   * abortar una transacción a medias sin dejar el cierre inconsistente.
   */
  cancel(jobId: string, userId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    if (job.userId !== userId) return false;

    if (job.status === "running") {
      job.status = "cancelled";
      job.currentStep = "Cancelando… se detendrá al terminar la placa en curso";
      this.aborts.get(jobId)?.abort();
      this.emit({ userId }, "borrador:cancelled", { job_id: jobId });
      return true;
    }

    if (job.status === "queued") {
      this.queue = this.queue.filter((j) => j.id !== jobId);
      job.status = "cancelled";
      job.finishedAt = Date.now();
      this.emit({ userId }, "borrador:cancelled", { job_id: jobId });
      return true;
    }

    return false;
  }

  // ── INTERNAL ──

  /** Job que tiene tomado este lock, si sigue vivo. */
  private jobDelLock(clave: string): BorradorJob | null {
    const jobId = this.locks.get(clave);
    if (!jobId) return null;
    const job = this.jobs.get(jobId);
    if (!job || job.status !== "running" || job.finishedAt) {
      // Lock huérfano: el job murió sin soltarlo. No debería pasar (hay
      // `finally`), pero si pasa, un periodo quedaría bloqueado para siempre.
      this.locks.delete(clave);
      return null;
    }
    return job;
  }

  private async processNext() {
    if (this.runningCount >= CONCURRENCY) return;
    if (this.queue.length === 0) return;

    // Buscar el primer job cuyo periodo esté libre, en vez de mirar solo la
    // cabeza: si no, un job cuyo periodo está ocupado bloquea a los de
    // detrás, que es justo lo que el lock por periodo venía a evitar.
    const idx = this.queue.findIndex(
      (j) => j.status !== "cancelled" && !this.jobDelLock(claveLock(j.payload)),
    );
    if (idx === -1) {
      // Todo lo encolado está esperando a un periodo ocupado; se reintenta
      // cuando el job en curso libere su lock (en el `finally`).
      const cancelados = this.queue.filter((j) => j.status === "cancelled");
      if (cancelados.length) {
        this.queue = this.queue.filter((j) => j.status !== "cancelled");
        this.processNext();
      }
      return;
    }

    const job = this.queue.splice(idx, 1)[0];
    const clave = claveLock(job.payload);

    this.runningCount++;
    this.locks.set(clave, job.id);
    const abort = new AbortController();
    this.aborts.set(job.id, abort);

    job.status = "running";
    job.startedAt = Date.now();
    job.currentStep = "Iniciando generacion...";

    this.emit({ userId: job.userId }, "borrador:start", {
      job_id: job.id,
      started_at: job.startedAt,
    });

    try {
      const result = await this.runJob(job, abort.signal);

      if (abort.signal.aborted) {
        job.status = "cancelled";
        job.finishedAt = Date.now();
        job.result = result;
        this.emit({ userId: job.userId }, "borrador:cancelled", {
          job_id: job.id,
          // Lo ya persistido NO se deshace: son cierres válidos.
          guardados: job.guardados ?? [],
        });
      } else {
        job.status = "complete";
        job.progress = 100;
        job.currentStep = "Completado";
        job.finishedAt = Date.now();
        job.result = result;

        this.emit({ userId: job.userId }, "borrador:complete", {
          job_id: job.id,
          result,
          guardados: job.guardados ?? [],
          fallidos: job.fallidos ?? [],
          finished_at: job.finishedAt,
          duration_ms: job.finishedAt - job.startedAt!,
        });
      }
    } catch (err: any) {
      if (job.status === "cancelled") {
        job.finishedAt = Date.now();
        this.emit({ userId: job.userId }, "borrador:cancelled", { job_id: job.id });
      } else {
        job.status = "error";
        job.error = err?.message || "Error desconocido";
        job.finishedAt = Date.now();

        this.emit({ userId: job.userId }, "borrador:error", {
          job_id: job.id,
          error: job.error,
          guardados: job.guardados ?? [],
          finished_at: job.finishedAt,
        });
      }
    } finally {
      this.runningCount--;
      this.locks.delete(clave);
      this.aborts.delete(job.id);
      this.processNext();
    }
  }

  private async runJob(job: BorradorJob, signal: AbortSignal): Promise<any> {
    const {
      liquidacion_servicio_id,
      liquidacion_servicio_ids,
      placa,
      tercero_id,
    } = job.payload;

    const onProgress = (data: {
      processed: number;
      total: number;
      currentStep: string;
    }) => {
      if (signal.aborted) return;
      job.processed = data.processed;
      job.total = data.total;
      job.currentStep = data.currentStep;
      // La generación ocupa el primer 60% cuando además hay que persistir;
      // el 100% cuando el job es solo previsualización.
      const bruto =
        data.total > 0 ? Math.round((data.processed / data.total) * 100) : 0;
      job.progress = job.payload.persistir ? Math.round(bruto * 0.6) : bruto;

      this.emit({ userId: job.userId }, "borrador:progress", {
        job_id: job.id,
        progress: job.progress,
        current_step: job.currentStep,
        processed: job.processed,
        total: job.total,
      });
    };

    const result = await LiquidacionesTercerosDescuentosService.generarBorrador({
      liquidacion_servicio_id,
      liquidacion_servicio_ids,
      placa,
      tercero_id: tercero_id || null,
      user_id: job.userId,
      onProgress,
    });

    if (!job.payload.persistir) return result;
    if (signal.aborted) return result;

    await this.persistirGenerados(job, result, signal);
    return result;
  }

  /**
   * Persiste los cierres generados y anuncia cada hoja.
   *
   * `generarBorrador` devuelve UNA entrada por item del pivote, todas con la
   * misma lista de items y los mismos conceptos. Guardar entrada a entrada
   * crearía N cierres duplicados de la misma placa, así que primero se
   * agrupa por `(placa, tercero_id)` — la misma clave con la que se agrupan
   * los cierres en el resto del sistema.
   */
  private async persistirGenerados(
    job: BorradorJob,
    result: any,
    signal: AbortSignal,
  ): Promise<void> {
    const { anio, mes, placas, force_new } = job.payload;
    if (!anio || !mes) {
      throw new Error("persistir requiere anio y mes en el payload");
    }

    const filtro = new Set((placas ?? []).map((p) => p.toUpperCase()));

    /**
     * Grupos por `(placa, tercero)`.
     *
     * `entry` es la primera entrada vista del grupo — de ella salen conceptos
     * y adicionales, que son los mismos en todas. `itemIds` y `liqIds` sí se
     * FUSIONAN entre entradas: una placa puede facturarse en varias
     * liquidaciones de servicio del mismo mes, y su cierre es uno solo. Antes
     * se quedaba solo con la primera entrada, así que los items de las demás
     * liquidaciones no entraban en el cierre y su `valor_liquidar` salía
     * corto sin avisar.
     */
    const porClave = new Map<
      string,
      { entry: any; itemIds: Set<string>; liqIds: Set<string> }
    >();
    for (const entry of (result?.terceros ?? []) as any[]) {
      if (entry?.error) continue;
      const placaEntry = String(entry.placa || "").toUpperCase();
      if (!placaEntry) continue;
      if (filtro.size > 0 && !filtro.has(placaEntry)) continue;

      const terceroId = entry.liquidacion_tercero?.tercero_id ?? null;
      const clave = `${placaEntry}::${terceroId ?? "SIN_TERCERO"}`;
      let grupo = porClave.get(clave);
      if (!grupo) {
        grupo = { entry, itemIds: new Set(), liqIds: new Set() };
        porClave.set(clave, grupo);
      }
      for (const id of Array.isArray(entry.items) ? entry.items : []) {
        grupo.itemIds.add(String(id));
      }
      // `liquidacion_servicio_id` lo pone `_procesarLiquidacion` en cada
      // entrada. El fallback cubre resultados de una versión anterior.
      const liqId =
        entry.liquidacion_servicio_id ??
        entry.liquidacion_tercero?.liquidacion_id ??
        result?.liquidacion_servicio?.id;
      if (liqId) grupo.liqIds.add(String(liqId));
    }

    const pendientes = [...porClave.values()];
    job.guardados = [];
    job.fallidos = [];

    const room = this.roomDelPeriodo(anio, mes);

    for (let i = 0; i < pendientes.length; i++) {
      if (signal.aborted) {
        console.log(
          `[borrador-queue] job ${job.id} cancelado tras ${i}/${pendientes.length} placas`,
        );
        return;
      }

      const grupo = pendientes[i];
      const entry = grupo.entry;
      const placaEntry = String(entry.placa);
      const liqIds = [...grupo.liqIds];

      job.currentStep = `Guardando ${placaEntry} (${i + 1}/${pendientes.length})`;
      job.progress = 60 + Math.round(((i + 1) / pendientes.length) * 40);
      this.emit({ userId: job.userId }, "borrador:progress", {
        job_id: job.id,
        progress: job.progress,
        current_step: job.currentStep,
        processed: i + 1,
        total: pendientes.length,
      });

      try {
        const guardado = await LiquidacionesTercerosDescuentosService.guardarBorrador({
          liquidacion_servicio_id: liqIds[0],
          liquidacion_servicio_ids: liqIds,
          placa: placaEntry,
          tercero_id: entry.liquidacion_tercero?.tercero_id ?? null,
          mes,
          anio,
          item_ids: [...grupo.itemIds],
          conceptos: entry.conceptos ?? [],
          adicionales: entry.items_adicionales ?? [],
          user_id: job.userId,
          force_new: force_new === true,
        });

        const cierreId = (guardado as any)?.id ?? (guardado as any)?.[0]?.id;
        if (!cierreId) {
          throw new Error("guardarBorrador no devolvió el id del cierre");
        }

        job.guardados.push({
          id: cierreId,
          placa: placaEntry,
          tercero_id: entry.liquidacion_tercero?.tercero_id ?? null,
        });

        // Anunciar la hoja al room del libro. Se lee del servidor en vez de
        // construirla aquí: el cliente la inserta en su orden alfabético y
        // debe tener exactamente los mismos campos que sus vecinas.
        const hoja = await PeriodoCierresService.hojaDeCierre(cierreId);
        if (hoja) {
          this.emit({ room }, "sheet:sheet-added", {
            scope: "cierres-finales",
            anio,
            mes,
            cierre: hoja,
            by: { id: job.userId, name: job.userName },
          });
        }
      } catch (e: any) {
        // Una placa que falla no tumba el lote: se registra y se sigue.
        console.error(
          `[borrador-queue] fallo al guardar ${placaEntry}:`,
          e?.message,
        );
        job.fallidos.push({ placa: placaEntry, error: e?.message || "Error" });
      }
    }
  }

  /**
   * Room del libro del periodo.
   *
   * Duplica a propósito la forma de `sheetRoomKey('cierres-finales', …)` en
   * vez de importarla, para no crear un ciclo queue → sockets → queue. Si
   * aquella cambia, esto también.
   */
  private roomDelPeriodo(anio: number, mes: number): string {
    return `sheet:cierres-finales:${anio}:${mes}`;
  }

  private emit(target: EmitTarget, event: string, data: any) {
    if (!this.emitFn) {
      console.warn(`[borrador-queue] emit ${event} FAILED: no emitter configured`);
      return;
    }
    this.emitFn(target, event, data);
  }

  private purgeOldJobs() {
    const now = Date.now();
    for (const [id, job] of this.jobs.entries()) {
      if (job.finishedAt && now - job.finishedAt > JOB_TTL_MS) {
        this.jobs.delete(id);
        this.aborts.delete(id);
      }
    }
  }

  private startCleanup() {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => this.purgeOldJobs(), CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref();
  }
}

export const borradorQueueService = new BorradorQueueService();
