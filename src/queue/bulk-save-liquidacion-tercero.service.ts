import { randomUUID } from "crypto";
import { LiquidacionesTercerosDescuentosService } from "../modules/liquidaciones-terceros-descuentos/liquidaciones-terceros-descuentos.service";

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type BulkSaveStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed";

export interface BulkSavePlacaPayload {
  placa: string;
  tercero_id: string | null;
  liquidacion_servicio_id: string;
  item_ids: string[];
  conceptos: any[];
  adicionales?: any[];
  es_propietario_overrides?: Record<string, boolean>;
}

export interface BulkSaveJob {
  id: string;
  userId: string;
  userName: string;
  status: BulkSaveStatus;
  /** Placas que se están guardando (input). */
  placas: string[];
  /** Payload completo por placa (input). */
  payload: BulkSavePlacaPayload[];
  mes: number;
  anio: number;
  /** Progreso. */
  processed: number;
  total: number;
  /** Resultados por placa (en el mismo orden que `placas`). */
  results: Array<{
    placa: string;
    ok: boolean;
    id?: string;
    error?: string;
    value?: number;
  }>;
  currentPlaca: string;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
  forceNew: boolean;
  createdAt: number;
}

// ═══════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════

const JOB_TTL_MS = 60 * 60 * 1000; // 1 hora
const CLEANUP_INTERVAL_MS = 60_000;

type EmitFn = (userId: string, event: string, data: any) => void;

// ═══════════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════════

class BulkSaveLiquidacionTerceroService {
  private jobs = new Map<string, BulkSaveJob>();
  private emitFn: EmitFn | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;

  setEmitter(fn: EmitFn) {
    this.emitFn = fn;
    console.log("[bulk-save-queue] emitter configurado");
    this.startCleanup();
  }

  // ── PUBLIC API ──

  enqueue(
    userId: string,
    userName: string,
    payload: {
      placas: BulkSavePlacaPayload[];
      mes: number;
      anio: number;
      force_new?: boolean;
    }
  ): { jobId: string; total: number; status: "queued" } {
    const job: BulkSaveJob = {
      id: randomUUID(),
      userId,
      userName,
      status: "queued",
      placas: payload.placas.map((p) => p.placa),
      payload: payload.placas,
      mes: payload.mes,
      anio: payload.anio,
      processed: 0,
      total: payload.placas.length,
      results: [],
      currentPlaca: "",
      forceNew: payload.force_new === true,
      createdAt: Date.now(),
    };
    this.jobs.set(job.id, job);
    console.log(
      `[bulk-save-queue] enqueue job=${job.id} user=${userId} placas=${job.placas.length}`
    );

    // Process in background (fire-and-forget) — retornamos inmediatamente
    // con el batchId para que el cliente pueda suscribirse y persistir en LS.
    this.runJob(job).catch((err) => {
      console.error(`[bulk-save-queue] job ${job.id} falló:`, err);
    });

    return { jobId: job.id, total: job.total, status: "queued" };
  }

  getStatus(jobId: string, userId: string): BulkSaveJob | null {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    if (job.userId !== userId) return null;
    return job;
  }

  cancel(jobId: string, userId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    if (job.userId !== userId) return false;
    if (job.status === "running" || job.status === "queued") {
      job.status = "failed";
      job.error = "Cancelado por el usuario";
      job.finishedAt = Date.now();
      this.emitToUser(userId, "liquidaciones-terceros-save-bulk:done", {
        batchId: job.id,
        status: "failed",
        error: job.error,
        processed: job.processed,
        total: job.total,
        results: job.results,
      });
      return true;
    }
    return false;
  }

  // ── INTERNAL ──

  private async runJob(job: BulkSaveJob) {
    job.status = "running";
    job.startedAt = Date.now();
    this.emitToUser(job.userId, "liquidaciones-terceros-save-bulk:start", {
      batchId: job.id,
      startedAt: job.startedAt,
      total: job.total,
    });

    try {
      for (let i = 0; i < job.payload.length; i++) {
        const p = job.payload[i];
        job.currentPlaca = p.placa;

        // Emitir progress ANTES de procesar la placa actual
        this.emitToUser(job.userId, "liquidaciones-terceros-save-bulk:progress", {
          batchId: job.id,
          processed: i,
          total: job.total,
          currentPlaca: p.placa,
        });

        try {
          const sub = await LiquidacionesTercerosDescuentosService.guardarBorrador({
            liquidacion_servicio_id: p.liquidacion_servicio_id,
            placa: p.placa,
            tercero_id: p.tercero_id,
            mes: job.mes,
            anio: job.anio,
            item_ids: p.item_ids,
            conceptos: p.conceptos,
            adicionales: p.adicionales || [],
            es_propietario_overrides: p.es_propietario_overrides || {},
            user_id: job.userId,
            force_new: job.forceNew,
          });

          const value = (sub && sub.cierre) ? (Number(sub.cierre.total_pagar) || 0) : 0;
          job.results.push({
            placa: p.placa,
            ok: true,
            id: sub?.id,
            value,
          });
        } catch (e: any) {
          job.results.push({
            placa: p.placa,
            ok: false,
            error: e?.message || "Error desconocido",
          });
        }

        job.processed = i + 1;
        // Emitir progress DESPUÉS de procesar la placa actual
        this.emitToUser(job.userId, "liquidaciones-terceros-save-bulk:progress", {
          batchId: job.id,
          processed: job.processed,
          total: job.total,
          currentPlaca: p.placa,
          ok: job.results[job.results.length - 1].ok,
        });
      }

      const okCount = job.results.filter((r) => r.ok).length;
      const errCount = job.results.length - okCount;
      job.status = errCount === job.results.length && job.results.length > 0 ? "failed" : "completed";
      job.finishedAt = Date.now();

      this.emitToUser(job.userId, "liquidaciones-terceros-save-bulk:done", {
        batchId: job.id,
        status: job.status,
        processed: job.processed,
        total: job.total,
        okCount,
        errCount,
        results: job.results,
        finishedAt: job.finishedAt,
      });
    } catch (e: any) {
      job.status = "failed";
      job.error = e?.message || "Error desconocido";
      job.finishedAt = Date.now();
      this.emitToUser(job.userId, "liquidaciones-terceros-save-bulk:done", {
        batchId: job.id,
        status: "failed",
        error: job.error,
        processed: job.processed,
        total: job.total,
        results: job.results,
        finishedAt: job.finishedAt,
      });
    }
  }

  private emitToUser(userId: string, event: string, data: any) {
    if (this.emitFn) {
      this.emitFn(userId, event, data);
    } else {
      console.warn(`[bulk-save-queue] emit ${event} FAILED: no emitter configured`);
    }
  }

  private purgeOldJobs() {
    const now = Date.now();
    for (const [id, job] of this.jobs.entries()) {
      if (job.finishedAt && now - job.finishedAt > JOB_TTL_MS) {
        this.jobs.delete(id);
      }
    }
  }

  private startCleanup() {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => this.purgeOldJobs(), CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref();
  }
}

export const bulkSaveLiquidacionTerceroService = new BulkSaveLiquidacionTerceroService();
