import { randomUUID } from "crypto";
import { LiquidacionesTercerosDescuentosService } from "../modules/liquidaciones-terceros-descuentos/liquidaciones-terceros-descuentos.service";
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

export interface BorradorJob {
  id: string;
  status: BorradorJobStatus;
  userId: string;
  userName: string;
  payload: {
    liquidacion_servicio_id?: string;
    liquidacion_servicio_ids?: string[];
    placa?: string;
  };
  progress: number;
  currentStep: string;
  processed: number;
  total: number;
  result?: any;
  error?: string;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
}

export interface LockedByInfo {
  userId: string;
  userName: string;
  startedAt: number;
  currentStep: string;
  progress: number;
  jobId: string;
}

// ═══════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════

const CONCURRENCY = Number(env.BORRADOR_QUEUE_CONCURRENCY) || 1;
const MAX_QUEUE_SIZE = Number(env.BORRADOR_QUEUE_MAX_SIZE) || 10;
const JOB_TTL_MS = Number(env.BORRADOR_QUEUE_JOB_TTL_MS) || 5 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60_000;

// ═══════════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════════

type EmitFn = (userId: string, event: string, data: any) => void;

class BorradorQueueService {
  private queue: BorradorJob[] = [];
  private jobs = new Map<string, BorradorJob>();
  private runningCount = 0;
  private emitFn: EmitFn | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;

  setEmitter(fn: EmitFn) {
    this.emitFn = fn;
    console.log("[borrador-queue] emitter configurado");
    this.startCleanup();
  }

  // ── PUBLIC API ──

  enqueue(
    userId: string,
    userName: string,
    payload: { liquidacion_servicio_id?: string; liquidacion_servicio_ids?: string[]; placa?: string }
  ): { jobId: string; status: "queued" | "locked"; lockedBy?: LockedByInfo } {
    this.purgeOldJobs();

    // Check if any job is currently running (mutex)
    const runningJob = this.findRunningJob();
    if (runningJob) {
      const lockedBy: LockedByInfo = {
        userId: runningJob.userId,
        userName: runningJob.userName,
        startedAt: runningJob.startedAt!,
        currentStep: runningJob.currentStep,
        progress: runningJob.progress,
        jobId: runningJob.id,
      };
      this.emitToUser(userId, "borrador:locked", { locked_by: lockedBy });
      return { jobId: "", status: "locked", lockedBy };
    }

    // Check queue size
    const userQueued = this.queue.filter((j) => j.userId === userId).length;
    if (userQueued >= 1) {
      const existing = this.queue.find((j) => j.userId === userId);
      return { jobId: existing!.id, status: "queued" };
    }

    if (this.queue.length >= MAX_QUEUE_SIZE) {
      this.emitToUser(userId, "borrador:error", {
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

    this.emitToUser(userId, "borrador:queued", {
      job_id: job.id,
      position: this.queue.length,
    });

    this.processNext();

    return { jobId: job.id, status: "queued" };
  }

  getStatus(jobId: string): BorradorJob | null {
    return this.jobs.get(jobId) || null;
  }

  cancel(jobId: string, userId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    if (job.userId !== userId) return false;

    if (job.status === "running") {
      job.status = "cancelled";
      job.currentStep = "Cancelado por el usuario";
      this.emitToUser(userId, "borrador:cancelled", { job_id: jobId });
      return true;
    }

    if (job.status === "queued") {
      this.queue = this.queue.filter((j) => j.id !== jobId);
      job.status = "cancelled";
      job.finishedAt = Date.now();
      this.emitToUser(userId, "borrador:cancelled", { job_id: jobId });
      return true;
    }

    return false;
  }

  // ── INTERNAL ──

  private findRunningJob(): BorradorJob | null {
    for (const job of this.jobs.values()) {
      if (job.status === "running" && !job.finishedAt) return job;
    }
    return null;
  }

  private async processNext() {
    if (this.runningCount >= CONCURRENCY) return;
    if (this.queue.length === 0) return;

    const job = this.queue.shift()!;
    if (!job || job.status === "cancelled") {
      this.processNext();
      return;
    }

    this.runningCount++;
    job.status = "running";
    job.startedAt = Date.now();
    job.currentStep = "Iniciando generacion...";

    this.emitToUser(job.userId, "borrador:start", {
      job_id: job.id,
      started_at: job.startedAt,
    });

    try {
      const result = await this.runJob(job);
      job.status = "complete";
      job.progress = 100;
      job.currentStep = "Completado";
      job.finishedAt = Date.now();
      job.result = result;

      this.emitToUser(job.userId, "borrador:complete", {
        job_id: job.id,
        result,
        finished_at: job.finishedAt,
        duration_ms: job.finishedAt - job.startedAt!,
      });
    } catch (err: any) {
      if ((job as BorradorJob).status === "cancelled") {
        job.finishedAt = Date.now();
        this.emitToUser(job.userId, "borrador:cancelled", { job_id: job.id });
      } else {
        job.status = "error";
        job.error = err.message || "Error desconocido";
        job.finishedAt = Date.now();

        this.emitToUser(job.userId, "borrador:error", {
          job_id: job.id,
          error: job.error,
          finished_at: job.finishedAt,
        });
      }
    } finally {
      this.runningCount--;
      this.processNext();
    }
  }

  private async runJob(job: BorradorJob): Promise<any> {
    const { liquidacion_servicio_id, liquidacion_servicio_ids, placa } = job.payload;

    const onProgress = (data: {
      processed: number;
      total: number;
      currentStep: string;
    }) => {
      if (job.status === "cancelled") return;
      job.processed = data.processed;
      job.total = data.total;
      job.currentStep = data.currentStep;
      job.progress =
        data.total > 0 ? Math.round((data.processed / data.total) * 100) : 0;

      this.emitToUser(job.userId, "borrador:progress", {
        job_id: job.id,
        progress: job.progress,
        current_step: job.currentStep,
        processed: job.processed,
        total: job.total,
      });
    };

    const result = await LiquidacionesTercerosDescuentosService.generarBorrador(
      {
        liquidacion_servicio_id,
        liquidacion_servicio_ids,
        placa,
        user_id: job.userId,
        onProgress,
      }
    );

    return result;
  }

  private emitToUser(userId: string, event: string, data: any) {
    if (this.emitFn) {
      this.emitFn(userId, event, data);
      console.log(`[borrador-queue] emit ${event} → user-${userId}`);
    } else {
      console.warn(`[borrador-queue] emit ${event} FAILED: no emitter configured`);
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

export const borradorQueueService = new BorradorQueueService();
