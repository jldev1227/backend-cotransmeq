/**
 * Cola de generación de borradores de nómina.
 *
 * Es el gemelo de `borrador-queue.service.ts`, que hace lo mismo para los
 * cierres finales de terceros, y comparte sus decisiones: sin Redis, en
 * memoria y en un solo proceso; lock por PERIODO y no global, para que dos
 * personas trabajando en meses distintos no se bloqueen; y `cancel` que
 * cancela de verdad, comprobando un `AbortController` entre conductores.
 *
 * QUÉ RESUELVE. Hasta ahora una liquidación se creaba de una en una desde el
 * formulario, que además calculaba en el navegador y mandaba el resultado ya
 * hecho. Para un periodo con quince conductores eso son quince viajes
 * manuales. Aquí se elige el periodo, se marcan los conductores y el servidor
 * genera, persiste y anuncia cada borrador según lo va creando.
 *
 * DE DÓNDE SALEN LAS CIFRAS. No se recalcula nada nuevo: se reutiliza
 * `NominaCanvasService.construirPeriodo`, que es lo que ya alimenta al canvas,
 * y de cada hoja se toman sus `totales` — el resultado de `liquidarNomina`,
 * el cálculo puro que ya vive en el servidor. Así el borrador generado y lo
 * que el canvas pinta salen de la misma aritmética por construcción, y no por
 * disciplina de mantener dos copias.
 *
 * QUÉ NO HACE. No toca a un conductor que ya tenga liquidación en el periodo.
 * Regenerar encima es una decisión con consecuencias —lo guardado puede estar
 * revisado o firmado— y no se toma por omisión: hay que pedirla conductor a
 * conductor con `sobrescribir`.
 */

import { randomUUID } from 'crypto'
import { prisma } from '../config/prisma'
import { NominaCanvasService } from '../modules/nomina-canvas/nomina-canvas.service'
import { sheetRoomKey } from '../sockets/sheet-rooms'
import { env } from '../config/env'

// ═══════════════════════════════════════════════════════════════
// TIPOS
// ═══════════════════════════════════════════════════════════════

export type BorradorNominaStatus =
  | 'queued'
  | 'running'
  | 'complete'
  | 'error'
  | 'cancelled'
  | 'locked'

export interface BorradorNominaPayload {
  anio: number
  mes: number
  /** Corte del periodo (día de inicio). Lo mismo que lee el canvas. */
  corte?: number | null
  /** Conductores a generar. Vacío = todos los que tengan planilla. */
  conductorIds: string[]
  /**
   * Conductores cuya liquidación existente se reemplaza. Va aparte de
   * `conductorIds` a propósito: sobrescribir es opt-in explícito y por
   * persona, no una casilla global que se marca sin mirar a quién afecta.
   */
  sobrescribir?: string[]
}

export interface BorradorNominaItem {
  conductorId: string
  nombre: string
  estado: 'creado' | 'reemplazado' | 'omitido' | 'error'
  motivo?: string
  liquidacionId?: string
  sueldoTotal?: number
}

export interface BorradorNominaJob {
  jobId: string
  userId: string
  userName: string
  status: BorradorNominaStatus
  progress: number
  currentStep: string
  processed: number
  total: number
  anio: number
  mes: number
  payload?: BorradorNominaPayload
  items: BorradorNominaItem[]
  error?: string
  startedAt?: number
  finishedAt?: number
  lockedBy?: {
    userId: string
    userName: string
    startedAt: number
    currentStep: string
    progress: number
    jobId: string
    anio: number | null
    mes: number | null
  }
}

// ═══════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════

const MAX_QUEUE_SIZE = Number(env.BORRADOR_QUEUE_MAX_SIZE) || 10
const JOB_TTL_MS = Number(env.BORRADOR_QUEUE_JOB_TTL_MS) || 5 * 60 * 1000
const CLEANUP_INTERVAL_MS = 60_000

export interface EmitTarget {
  userId?: string
  room?: string
}
type EmitFn = (target: EmitTarget, event: string, data: any) => void

const dec = (v: unknown): number => (v == null ? 0 : Number(v))

// ═══════════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════════

class BorradorNominaQueueService {
  private queue: BorradorNominaJob[] = []
  private jobs = new Map<string, BorradorNominaJob>()
  private running = false
  private emitFn: EmitFn | null = null
  private cleanupTimer: NodeJS.Timeout | null = null
  /** Periodos con un job corriendo → jobId. Mismo criterio que terceros. */
  private locks = new Map<string, string>()
  private aborts = new Map<string, AbortController>()

  setEmitter(fn: EmitFn) {
    this.emitFn = fn
    console.log('[borrador-nomina] emitter configurado')
    this.startCleanup()
  }

  private emit(target: EmitTarget, event: string, data: any) {
    this.emitFn?.(target, event, data)
  }

  private clave(anio: number, mes: number) {
    return `${anio}:${mes}`
  }

  enqueue(
    userId: string,
    userName: string,
    payload: BorradorNominaPayload,
  ): { jobId: string; status: BorradorNominaStatus; lockedBy?: any } {
    const clave = this.clave(payload.anio, payload.mes)

    // El lock es por periodo: generar agosto no puede bloquear a quien está
    // generando septiembre.
    const ocupado = this.locks.get(clave)
    if (ocupado) {
      const dueño = this.jobs.get(ocupado)
      return {
        jobId: ocupado,
        status: 'locked',
        lockedBy: dueño
          ? {
              userId: dueño.userId,
              userName: dueño.userName,
              startedAt: dueño.startedAt ?? Date.now(),
              currentStep: dueño.currentStep,
              progress: dueño.progress,
              jobId: dueño.jobId,
              anio: dueño.anio,
              mes: dueño.mes,
            }
          : undefined,
      }
    }

    if (this.queue.length >= MAX_QUEUE_SIZE) {
      throw new Error('La cola de borradores está llena. Intenta en un minuto.')
    }

    const job: BorradorNominaJob = {
      jobId: randomUUID(),
      userId,
      userName,
      status: 'queued',
      progress: 0,
      currentStep: 'En cola',
      processed: 0,
      total: payload.conductorIds.length,
      anio: payload.anio,
      mes: payload.mes,
      payload,
      items: [],
    }

    this.jobs.set(job.jobId, job)
    this.queue.push(job)
    this.emit({ userId }, 'borrador-nomina:queued', this.publico(job))
    void this.procesar()
    return { jobId: job.jobId, status: 'queued' }
  }

  getStatus(jobId: string): BorradorNominaJob | null {
    const j = this.jobs.get(jobId)
    return j ? this.publico(j) : null
  }

  cancel(jobId: string, userId: string): boolean {
    const job = this.jobs.get(jobId)
    if (!job) return false
    // Solo quien lanzó puede cancelar: el jobId circula por sockets y sin
    // esta comprobación bastaría conocerlo para tumbar el job de otro.
    if (job.userId !== userId) return false
    if (job.status === 'complete' || job.status === 'error') return false

    this.aborts.get(jobId)?.abort()
    job.status = 'cancelled'
    job.finishedAt = Date.now()
    this.queue = this.queue.filter((j) => j.jobId !== jobId)
    this.emit({ userId: job.userId }, 'borrador-nomina:cancelled', this.publico(job))
    return true
  }

  /** Copia sin el payload, que no aporta nada a la UI y puede ser grande. */
  private publico(job: BorradorNominaJob): BorradorNominaJob {
    const { payload, ...resto } = job
    return { ...resto } as BorradorNominaJob
  }

  private async procesar() {
    if (this.running) return
    const job = this.queue.shift()
    if (!job) return
    if (job.status === 'cancelled') return void this.procesar()

    const clave = this.clave(job.anio, job.mes)
    this.running = true
    this.locks.set(clave, job.jobId)

    const abort = new AbortController()
    this.aborts.set(job.jobId, abort)

    job.status = 'running'
    job.startedAt = Date.now()
    job.currentStep = 'Cargando el periodo'
    this.emit({ userId: job.userId }, 'borrador-nomina:start', this.publico(job))

    try {
      await this.ejecutar(job, abort.signal)
      // El cast no es cosmético: TS estrecha `status` a 'running' tras la
      // asignación de arriba y no ve que `cancel()` lo cambia desde fuera
      // mientras esto corre.
      if ((job.status as BorradorNominaStatus) !== 'cancelled') {
        job.status = 'complete'
        job.progress = 100
        job.currentStep = 'Terminado'
        job.finishedAt = Date.now()
        this.emit({ userId: job.userId }, 'borrador-nomina:complete', this.publico(job))
      }
    } catch (e: any) {
      job.status = 'error'
      job.error = e?.message || 'Error generando los borradores'
      job.finishedAt = Date.now()
      this.emit({ userId: job.userId }, 'borrador-nomina:error', this.publico(job))
    } finally {
      this.aborts.delete(job.jobId)
      this.locks.delete(clave)
      this.running = false
      void this.procesar()
    }
  }

  private async ejecutar(job: BorradorNominaJob, signal: AbortSignal) {
    const p = job.payload
    if (!p) throw new Error('El job perdió su contenido.')

    const room = sheetRoomKey('nomina', job.anio, job.mes)
    const sobrescribir = new Set(p.sobrescribir ?? [])

    // Una sola pasada: `construirPeriodo` ya trae, por conductor, sus días,
    // placas, recargos repartidos y los `totales` de `liquidarNomina`. Pedir
    // el periodo una vez por conductor sería multiplicar por N el trabajo
    // más caro del módulo.
    const periodo = await NominaCanvasService.construirPeriodo({
      anio: p.anio,
      mes: p.mes,
      corte: p.corte ?? undefined,
      // `construirPeriodo` ya sabe restringir: filtrar después obligaría a
      // construir hojas que se iban a descartar.
      conductorIds: p.conductorIds.length ? p.conductorIds : undefined,
    })

    // Sin lista explícita, solo los que tienen días: generar un borrador en
    // cero para quien no trabajó ensucia el periodo sin aportar nada.
    const hojas = (periodo.hojas as any[]).filter(
      (h) => p.conductorIds.length || h.dias?.length > 0,
    )
    job.total = hojas.length

    // La ventana real del periodo, que es lo que se guarda como
    // `periodo_start`/`periodo_end`. Sale de los días, no del mes: el corte
    // 21→20 cruza dos meses.
    const dias = periodo.periodo.dias
    const ventana = {
      desde: dias[0]?.fecha ?? '',
      hasta: dias[dias.length - 1]?.fecha ?? '',
    }

    for (let i = 0; i < hojas.length; i++) {
      // No se puede abortar una escritura en vuelo, así que la promesa es
      // «se detiene al terminar el conductor en curso».
      if (signal.aborted) return

      const h = hojas[i]
      job.currentStep = `Generando ${h.nombre}`
      job.processed = i
      job.progress = Math.round((i / Math.max(1, hojas.length)) * 100)
      this.emit({ userId: job.userId }, 'borrador-nomina:progress', this.publico(job))

      const item = await this.generarUno(h, ventana, sobrescribir, job.userId)
      job.items.push(item)

      // El alta va al room del libro: quien tenga el periodo abierto la ve
      // aparecer sin recargar.
      this.emit({ room }, 'borrador-nomina:item', { jobId: job.jobId, ...item })
    }

    job.processed = hojas.length
  }

  private async generarUno(
    hoja: any,
    ventana: { desde: string; hasta: string },
    sobrescribir: Set<string>,
    userId: string,
  ): Promise<BorradorNominaItem> {
    const base: BorradorNominaItem = {
      conductorId: hoja.conductorId,
      nombre: hoja.nombre,
      estado: 'omitido',
    }

    try {
      if (hoja.liquidacionId && !sobrescribir.has(hoja.conductorId)) {
        return {
          ...base,
          motivo: `Ya tiene liquidación en este periodo (${hoja.estado}).`,
          liquidacionId: hoja.liquidacionId,
        }
      }
      if (!hoja.dias?.length) {
        return { ...base, motivo: 'Sin planillas en el periodo.' }
      }

      const t = hoja.totales
      const datos = {
        conductor_id: hoja.conductorId,
        periodo_start: ventana.desde,
        periodo_end: ventana.hasta,
        dias_laborados: hoja.dias.length,
        salario_devengado: t.salarioDevengado,
        auxilio_transporte: t.auxilioTransporte,
        total_bonificaciones: t.totalBonificaciones,
        total_pernotes: t.totalPernotes,
        total_recargos: t.totalRecargos,
        total_anticipos: t.totalAnticipos,
        total_vacaciones: t.totalVacaciones,
        valor_incapacidad: t.valorIncapacidad,
        interes_cesantias: t.interesCesantias,
        ajuste_parex: t.ajusteParex,
        ajuste_geopark: t.ajusteGeopark,
        disponibilidad: t.disponibilidad,
        salud: t.salud,
        pension: t.pension,
        sueldo_total: t.sueldoTotal,
        estado_flujo: 'BORRADOR',
        updated_at: new Date(),
      }

      if (hoja.liquidacionId) {
        await prisma.liquidaciones.update({
          where: { id: hoja.liquidacionId },
          data: { ...datos, actualizado_por_id: userId, version: { increment: 1 } },
        })
        return {
          ...base,
          estado: 'reemplazado',
          liquidacionId: hoja.liquidacionId,
          sueldoTotal: dec(t.sueldoTotal),
        }
      }

      const creada = await prisma.liquidaciones.create({
        data: {
          id: randomUUID(),
          ...datos,
          created_at: new Date(),
          creado_por_id: userId,
        },
      })
      return {
        ...base,
        estado: 'creado',
        liquidacionId: creada.id,
        sueldoTotal: dec(t.sueldoTotal),
      }
    } catch (e: any) {
      return { ...base, estado: 'error', motivo: e?.message || 'Error al guardar' }
    }
  }

  private startCleanup() {
    if (this.cleanupTimer) return
    this.cleanupTimer = setInterval(() => {
      const ahora = Date.now()
      for (const [id, j] of this.jobs) {
        if (j.finishedAt && ahora - j.finishedAt > JOB_TTL_MS) this.jobs.delete(id)
      }
    }, CLEANUP_INTERVAL_MS)
    this.cleanupTimer.unref?.()
  }
}

export const borradorNominaQueueService = new BorradorNominaQueueService()
