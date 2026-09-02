/**
 * Cola de envíos por correo de liquidaciones finales de terceros.
 *
 * Mismo diseño que `borrador-queue.service`: en memoria, un solo proceso,
 * lock por periodo y cancelación cooperativa entre items. La razón de que
 * sea una cola y no un bucle en el controller es doble:
 *
 *  1. **Ritmo.** Resend limita a 2 req/s y Gmail penaliza ráfagas; entre
 *     item e item se espera `ENVIO_LIQ_DELAY_MS`. Un lote de 40 placas son
 *     varios minutos: demasiado para mantener una petición HTTP abierta y
 *     justo lo que un timeout de proxy cortaría a mitad.
 *
 *  2. **Reporte.** El progreso viaja por socket al usuario que lanzó, y el
 *     cambio de estado de cada cierre (ENVIADO/ERROR) se difunde al room
 *     del libro para que todos los canvas del periodo lo pinten sin
 *     recargar.
 *
 * El PDF de cada hoja se renderiza AQUÍ (Puppeteer, igual que el export
 * ZIP): el cliente manda el HTML que ya tiene en pantalla y el servidor
 * pone fuentes y Chromium. Renderizar dentro del job evita subir 40 PDFs
 * por HTTP y garantiza que el adjunto es exactamente el preview.
 */

import { randomUUID } from 'crypto'
import { env } from '../config/env'
import { pdfFromHtml } from '../services/pdf.service'
import { buildFontsCss } from '../modules/liquidaciones-terceros-pdf/fonts'
import {
  EnviosEmailService,
  type AdjuntoEnvio,
} from '../modules/liquidaciones-terceros-envios/envios-email.service'
import { LiquidacionesTercerosEnviosService } from '../modules/liquidaciones-terceros-envios/liquidaciones-terceros-envios.service'

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type EnvioJobStatus = 'queued' | 'running' | 'complete' | 'error' | 'cancelled'

/** De qué canvas sale el envío. Decide validación, constancia y room. */
export type EnvioTipo = 'CIERRE' | 'INGRESO' | 'OCASIONAL'

export interface EnvioItemPayload {
  /** Cierre final del que sale la hoja. Solo para tipo CIERRE. */
  cierre_id: string | null
  /** Cabecera del periodo (ingresos u ocasional). Solo para los otros tipos. */
  origen_id?: string | null
  tercero_id: string | null
  /** Placa del cierre, o el nombre de la hoja (INGRESOS/ADICIONALES/OCASIONALES). */
  placa: string
  tercero_nombre: string
  /** Título del correo; sin él, el de cierres («Liquidación de su vehículo…»). */
  titulo?: string
  /** Destino real del correo (puede ser el corregido a mano en el modal). */
  to: string
  /** Copias (CC). En modo prueba se ignoran: la prueba va a un solo buzón. */
  cc?: string[]
  /** Nombre del PDF adjunto, sin extensión. */
  filename: string
  /** Cuerpo HTML de la hoja, compuesto por el cliente (mismo del preview). */
  html: string
  /**
   * Líneas extra de la tarjeta de resumen del correo (ej. «Valor servicio de
   * transporte $7.475.410»). Llegan ya formateadas desde el canvas, que las
   * saca de `calcularTotales`: la cifra del correo y la del PDF adjunto tienen
   * que ser la misma, y calcularla aquí de nuevo sería una segunda aritmética.
   */
  resumen?: Array<{ etiqueta: string; valor: string }>
}

export interface EnvioJobPayload {
  tipo: EnvioTipo
  anio: number
  mes: number
  /** Hoja de estilos del documento (una para todas las hojas). */
  css: string
  /** Plantilla del asunto; admite {PLACA} {TERCERO} {PERIODO}. */
  asunto: string
  /** Mensaje personalizado (texto plano). */
  mensaje: string
  /** Prueba: todos los correos van a `destino_prueba`, sin BCC. */
  es_prueba: boolean
  destino_prueba?: string
  items: EnvioItemPayload[]
  /** Adjuntos extra comunes a todos los destinatarios. */
  adjuntos_extra: Array<{ filename: string; contentType: string; content: Buffer }>
}

export interface EnvioItemResultado {
  cierre_id: string | null
  origen_id?: string | null
  placa: string
  to: string
  estado: 'ENVIADO' | 'ERROR'
  error?: string
  enviado_at?: string
}

export interface EnvioJob {
  id: string
  status: EnvioJobStatus
  userId: string
  userName: string
  anio: number
  mes: number
  es_prueba: boolean
  progress: number
  currentStep: string
  processed: number
  total: number
  resultados: EnvioItemResultado[]
  error?: string
  createdAt: number
  startedAt?: number
  finishedAt?: number
  /** El payload pesado se suelta al terminar para no retener MBs en el TTL. */
  payload: EnvioJobPayload | null
}

export interface EnvioLockedBy {
  userId: string
  userName: string
  jobId: string
  anio: number
  mes: number
  progress: number
  currentStep: string
}

// ═══════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════

const DELAY_MS = Number(env.ENVIO_LIQ_DELAY_MS) || 800
const MAX_QUEUE = Number(env.ENVIO_LIQ_MAX_QUEUE) || 5
const JOB_TTL_MS = Number(env.ENVIO_LIQ_JOB_TTL_MS) || 10 * 60 * 1000

const MESES = [
  'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO',
  'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE',
]

function periodoDe(anio: number, mes: number): string {
  return `${MESES[mes - 1] ?? mes} ${anio}`
}

function renderAsunto(plantilla: string, item: EnvioItemPayload, anio: number, mes: number): string {
  return plantilla
    .replace(/\{PLACA\}/g, item.placa)
    .replace(/\{TERCERO\}/g, item.tercero_nombre)
    .replace(/\{PERIODO\}/g, periodoDe(anio, mes))
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const t = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => { clearTimeout(t); resolve() }, { once: true })
  })
}

// ═══════════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════════

export interface EnvioEmitTarget {
  userId?: string
  room?: string
}

type EmitFn = (target: EnvioEmitTarget, event: string, data: any) => void

class EnvioLiquidacionesQueueService {
  private queue: EnvioJob[] = []
  private jobs = new Map<string, EnvioJob>()
  private running = false
  private emitFn: EmitFn | null = null
  private cleanupTimer: NodeJS.Timeout | null = null
  /** Periodo con un job corriendo → jobId. Evita el doble envío del mismo mes. */
  private locks = new Map<string, string>()
  private aborts = new Map<string, AbortController>()

  setEmitter(fn: EmitFn) {
    this.emitFn = fn
    if (!this.cleanupTimer) {
      this.cleanupTimer = setInterval(() => this.purge(), 60_000)
      this.cleanupTimer.unref()
    }
  }

  enqueue(
    userId: string,
    userName: string,
    payload: EnvioJobPayload,
  ): { jobId: string; status: 'queued' | 'locked'; lockedBy?: EnvioLockedBy } {
    this.purge()

    const clave = `${payload.tipo}:${payload.anio}:${payload.mes}`
    const bloqueante = this.jobDelLock(clave)
    if (bloqueante) {
      const lockedBy: EnvioLockedBy = {
        userId: bloqueante.userId,
        userName: bloqueante.userName,
        jobId: bloqueante.id,
        anio: bloqueante.anio,
        mes: bloqueante.mes,
        progress: bloqueante.progress,
        currentStep: bloqueante.currentStep,
      }
      return { jobId: '', status: 'locked', lockedBy }
    }

    if (this.queue.length >= MAX_QUEUE) {
      throw new Error('La cola de envíos está llena. Intenta en unos minutos.')
    }

    const job: EnvioJob = {
      id: randomUUID(),
      status: 'queued',
      userId,
      userName,
      anio: payload.anio,
      mes: payload.mes,
      es_prueba: payload.es_prueba,
      progress: 0,
      currentStep: 'En cola…',
      processed: 0,
      total: payload.items.length,
      resultados: [],
      createdAt: Date.now(),
      payload,
    }

    this.queue.push(job)
    this.jobs.set(job.id, job)
    this.emit({ userId }, 'envio-liq:queued', { job_id: job.id, total: job.total })
    void this.processNext()
    return { jobId: job.id, status: 'queued' }
  }

  getStatus(jobId: string): Omit<EnvioJob, 'payload'> | null {
    const job = this.jobs.get(jobId)
    if (!job) return null
    const { payload: _p, ...rest } = job
    return rest
  }

  /**
   * Cancela un job del dueño. Si corre, se detiene al terminar el item en
   * curso: un correo a medio enviar no se puede des-enviar.
   */
  cancel(jobId: string, userId: string): boolean {
    const job = this.jobs.get(jobId)
    if (!job || job.userId !== userId) return false

    if (job.status === 'running') {
      job.status = 'cancelled'
      job.currentStep = 'Cancelando… se detendrá al terminar el envío en curso'
      this.aborts.get(jobId)?.abort()
      this.emit({ userId }, 'envio-liq:cancelled', { job_id: jobId, resultados: job.resultados })
      return true
    }
    if (job.status === 'queued') {
      this.queue = this.queue.filter((j) => j.id !== jobId)
      job.status = 'cancelled'
      job.finishedAt = Date.now()
      job.payload = null
      this.emit({ userId }, 'envio-liq:cancelled', { job_id: jobId, resultados: [] })
      return true
    }
    return false
  }

  // ── INTERNAL ──

  /** El lock es por tipo+periodo: enviar ingresos no bloquea los cierres. */
  private claveDe(job: EnvioJob): string {
    return `${job.payload?.tipo ?? 'CIERRE'}:${job.anio}:${job.mes}`
  }

  private jobDelLock(clave: string): EnvioJob | null {
    const id = this.locks.get(clave)
    if (!id) return null
    const job = this.jobs.get(id)
    if (!job || job.status !== 'running' || job.finishedAt) {
      this.locks.delete(clave)
      return null
    }
    return job
  }

  private async processNext() {
    if (this.running) return
    const idx = this.queue.findIndex(
      (j) => j.status !== 'cancelled' && !this.jobDelLock(this.claveDe(j)),
    )
    if (idx === -1) return

    const job = this.queue.splice(idx, 1)[0]
    const clave = this.claveDe(job)
    this.running = true
    this.locks.set(clave, job.id)
    const abort = new AbortController()
    this.aborts.set(job.id, abort)

    job.status = 'running'
    job.startedAt = Date.now()
    this.emit({ userId: job.userId }, 'envio-liq:start', {
      job_id: job.id,
      total: job.total,
      started_at: job.startedAt,
    })

    try {
      await this.runJob(job, abort.signal)
      job.finishedAt = Date.now()
      if (abort.signal.aborted) {
        job.status = 'cancelled'
        this.emit({ userId: job.userId }, 'envio-liq:cancelled', {
          job_id: job.id,
          resultados: job.resultados,
        })
      } else {
        job.status = 'complete'
        job.progress = 100
        job.currentStep = 'Completado'
        this.emit({ userId: job.userId }, 'envio-liq:complete', {
          job_id: job.id,
          resultados: job.resultados,
          enviados: job.resultados.filter((r) => r.estado === 'ENVIADO').length,
          fallidos: job.resultados.filter((r) => r.estado === 'ERROR').length,
          duration_ms: job.finishedAt - job.startedAt!,
        })
      }
    } catch (err: any) {
      job.status = 'error'
      job.error = err?.message || 'Error desconocido'
      job.finishedAt = Date.now()
      this.emit({ userId: job.userId }, 'envio-liq:error', {
        job_id: job.id,
        error: job.error,
        resultados: job.resultados,
      })
    } finally {
      job.payload = null
      this.running = false
      this.locks.delete(clave)
      this.aborts.delete(job.id)
      void this.processNext()
    }
  }

  private async runJob(job: EnvioJob, signal: AbortSignal) {
    const payload = job.payload
    if (!payload) throw new Error('El job perdió su payload')
    const { anio, mes, items } = payload
    const periodo = periodoDe(anio, mes)
    const fuentes = buildFontsCss()
    // El mismo room al que cada canvas ya está unido por su sesión de hoja
    // (ingresos y ocasional son rooms ANUALES; ver sheet-rooms.ts).
    const room =
      payload.tipo === 'INGRESO'
        ? `sheet:ingresos:${anio}`
        : payload.tipo === 'OCASIONAL'
          ? `sheet:ocasional:${anio}`
          : `sheet:cierres-finales:${anio}:${mes}`

    for (let i = 0; i < items.length; i++) {
      if (signal.aborted) return
      const item = items[i]

      const paso = (txt: string) => {
        job.processed = i
        job.currentStep = txt
        job.progress = Math.round((i / items.length) * 100)
        this.emit({ userId: job.userId }, 'envio-liq:progress', {
          job_id: job.id,
          progress: job.progress,
          current_step: job.currentStep,
          processed: i,
          total: items.length,
        })
      }

      const esPruebaRedirigida = payload.es_prueba && !!payload.destino_prueba
      const destino = esPruebaRedirigida ? payload.destino_prueba! : item.to
      // La prueba va a un único buzón: copiar a los terceros reales sería
      // justo lo que el modo prueba existe para evitar.
      const copias = esPruebaRedirigida ? [] : (item.cc ?? [])
      // La constancia guarda a quiénes salió de verdad, no solo el principal.
      const destinoRegistro = [destino, ...copias].join(', ').slice(0, 255)
      const asunto = renderAsunto(payload.asunto, item, anio, mes)

      // El registro nace ANTES de intentar nada: si el proceso muere a mitad
      // el log dice qué quedó ENVIANDO, en vez de no decir nada.
      const registro = await LiquidacionesTercerosEnviosService.crearRegistro({
        tipo: payload.tipo,
        cierre_id: item.cierre_id,
        origen_id: item.origen_id ?? null,
        tercero_id: item.tercero_id,
        anio,
        mes,
        placa: item.placa,
        email_destino: destinoRegistro,
        asunto,
        mensaje: payload.mensaje || null,
        adjuntos: [
          { filename: `${item.filename}.pdf`, size: 0, tipo: 'liquidacion' },
          ...payload.adjuntos_extra.map((a) => ({
            filename: a.filename,
            size: a.content.length,
            tipo: 'extra',
          })),
        ],
        es_prueba: payload.es_prueba,
        enviado_por_id: job.userId || null,
        enviado_por: job.userName || null,
      })

      try {
        paso(`Generando PDF de ${item.placa} (${i + 1}/${items.length})…`)
        const htmlDoc = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>${item.filename}</title>
<style>${fuentes}</style>
<style>html, body { margin: 0; padding: 0; background: #fff; }</style>
<style>${payload.css}</style>
</head>
<body>${item.html}</body>
</html>`
        const pdf = await pdfFromHtml({
          html: htmlDoc,
          landscape: true,
          format: 'Letter',
          marginMm: 0,
          preferCSSPageSize: true,
        })

        const adjuntos: AdjuntoEnvio[] = [
          { filename: `${item.filename}.pdf`, content: pdf, contentType: 'application/pdf' },
          ...payload.adjuntos_extra.map((a) => ({
            filename: a.filename,
            content: a.content,
            contentType: a.contentType,
          })),
        ]

        paso(`Enviando a ${destinoRegistro} — ${item.placa} (${i + 1}/${items.length})…`)
        const { proveedor, messageId } = await EnviosEmailService.enviar({
          to: destino,
          cc: copias,
          asunto,
          mensaje: payload.mensaje,
          placa: item.placa,
          titulo: item.titulo,
          // En cierres la primera fila del resumen es la placa; en los otros
          // canvas es la hoja que va adjunta.
          etiqueta: payload.tipo === 'CIERRE' ? 'Vehículo' : 'Hoja',
          resumen: item.resumen,
          terceroNombre: item.tercero_nombre,
          periodo,
          adjuntos,
          esPrueba: payload.es_prueba,
        })

        const actualizado = await LiquidacionesTercerosEnviosService.marcarEnviado(
          registro.id,
          proveedor,
          messageId,
        )
        const resultado: EnvioItemResultado = {
          cierre_id: item.cierre_id,
          origen_id: item.origen_id ?? null,
          placa: item.placa,
          to: destinoRegistro,
          estado: 'ENVIADO',
          enviado_at: actualizado.enviado_at?.toISOString(),
        }
        job.resultados.push(resultado)
        this.emit({ userId: job.userId }, 'envio-liq:item', { job_id: job.id, ...resultado })
        // Al room del libro: cualquier canvas abierto del periodo pinta el
        // estado sin recargar. Los envíos de prueba también se difunden
        // (marcados), para que el que prueba vea la reacción en vivo.
        this.emit({ room }, 'envio-liquidacion:actualizado', {
          tipo: payload.tipo,
          anio,
          mes,
          cierre_id: item.cierre_id,
          origen_id: item.origen_id ?? null,
          estado: 'ENVIADO',
          email_destino: destinoRegistro,
          enviado_at: resultado.enviado_at,
          es_prueba: payload.es_prueba,
          by: { id: job.userId, name: job.userName },
        })
      } catch (e: any) {
        const msg = e?.message || 'Error desconocido'
        console.error(`[envio-liq] fallo enviando ${item.placa} a ${destinoRegistro}:`, msg)
        await LiquidacionesTercerosEnviosService.marcarError(registro.id, msg).catch(() => {})
        const resultado: EnvioItemResultado = {
          cierre_id: item.cierre_id,
          origen_id: item.origen_id ?? null,
          placa: item.placa,
          to: destinoRegistro,
          estado: 'ERROR',
          error: msg,
        }
        job.resultados.push(resultado)
        this.emit({ userId: job.userId }, 'envio-liq:item', { job_id: job.id, ...resultado })
        this.emit({ room }, 'envio-liquidacion:actualizado', {
          tipo: payload.tipo,
          anio,
          mes,
          cierre_id: item.cierre_id,
          origen_id: item.origen_id ?? null,
          estado: 'ERROR',
          email_destino: destinoRegistro,
          error: msg,
          es_prueba: payload.es_prueba,
          by: { id: job.userId, name: job.userName },
        })
      }

      job.processed = i + 1
      // Ritmo entre envíos, no tras el último: el delay protege al proveedor,
      // no al usuario que espera el "completado".
      if (i < items.length - 1) await sleep(DELAY_MS, signal)
    }
  }

  private emit(target: EnvioEmitTarget, event: string, data: any) {
    if (!this.emitFn) {
      console.warn(`[envio-liq] emit ${event} sin emitter configurado`)
      return
    }
    this.emitFn(target, event, data)
  }

  private purge() {
    const now = Date.now()
    for (const [id, job] of this.jobs.entries()) {
      if (job.finishedAt && now - job.finishedAt > JOB_TTL_MS) {
        this.jobs.delete(id)
        this.aborts.delete(id)
      }
    }
  }
}

export const envioLiquidacionesQueueService = new EnvioLiquidacionesQueueService()
