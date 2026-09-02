import { FastifyRequest, FastifyReply } from 'fastify'
import { envioLiquidacionesQueueService } from '../../queue/envio-liquidaciones-queue.service'
import { LiquidacionesTercerosEnviosService } from './liquidaciones-terceros-envios.service'
import { proveedorActivo } from './envios-email.service'
import { prisma } from '../../config/prisma'

/** Topes del lote. Los mismos criterios que el export ZIP de canvas. */
const MAX_ITEMS = 120
const MAX_CSS = 400_000
const MAX_HTML_ITEM = 6_000_000
/** Adjuntos extra por lote (suma, ya decodificados). Resend corta en 40MB/correo. */
const MAX_ADJUNTOS_EXTRA = 15_000_000
/** Copias por correo. `email_destino` de la constancia es VarChar(255). */
const MAX_CC = 5
/// Filas extra de la tarjeta de resumen del correo. Es una tarjeta, no un
/// informe: más de cuatro líneas la vuelven ilegible en el móvil.
const MAX_RESUMEN = 4

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export class LiquidacionesTercerosEnviosController {
  /**
   * POST /liquidaciones-terceros/envios/lote
   *
   * Encola el envío. El cliente manda por cada cierre el HTML de su hoja
   * (el mismo del preview) y los datos de destino; los adjuntos extra van
   * en base64 porque comparten petición con un JSON grande y son pocos MB.
   */
  static async encolar(request: FastifyRequest, reply: FastifyReply) {
    try {
      const user = (request as any).user
      const b = (request.body ?? {}) as any

      const anio = Number(b.anio)
      const mes = Number(b.mes)
      if (!anio || !mes || mes < 1 || mes > 12) {
        return reply.status(400).send({ error: 'Periodo inválido (anio/mes).' })
      }
      const tipo = ['CIERRE', 'INGRESO', 'OCASIONAL'].includes(b.tipo) ? b.tipo : 'CIERRE'
      if (typeof b.css !== 'string' || !b.css.trim() || b.css.length > MAX_CSS) {
        return reply.status(400).send({ error: 'Falta la hoja de estilos del documento o es demasiado grande.' })
      }
      if (!Array.isArray(b.items) || b.items.length === 0) {
        return reply.status(400).send({ error: 'No hay destinatarios en el lote.' })
      }
      if (b.items.length > MAX_ITEMS) {
        return reply.status(413).send({ error: `Máximo ${MAX_ITEMS} envíos por lote.` })
      }

      const esPrueba = b.es_prueba === true
      const destinoPrueba = typeof b.destino_prueba === 'string' ? b.destino_prueba.trim() : ''
      if (esPrueba && !EMAIL_RE.test(destinoPrueba)) {
        return reply.status(400).send({ error: 'El modo prueba requiere un correo de destino válido.' })
      }

      const items = []
      for (const [i, it] of (b.items as any[]).entries()) {
        if (tipo === 'CIERRE' && (!it?.cierre_id || typeof it.cierre_id !== 'string')) {
          return reply.status(400).send({ error: `El item ${i + 1} llegó sin cierre_id.` })
        }
        if (typeof it.html !== 'string' || !it.html.trim()) {
          return reply.status(400).send({ error: `El item ${i + 1} (${it.placa ?? '?'}) llegó sin el HTML de su hoja.` })
        }
        if (it.html.length > MAX_HTML_ITEM) {
          return reply.status(413).send({ error: `La hoja de ${it.placa ?? i + 1} es demasiado grande.` })
        }
        const to = String(it.to || '').trim()
        if (!esPrueba && !EMAIL_RE.test(to)) {
          return reply.status(400).send({ error: `Correo inválido para ${it.placa ?? `item ${i + 1}`}: "${to}".` })
        }
        // Copias (CC): el cliente ya las separa, pero se admite también una
        // cadena con comas por si el envío llega desde otro consumidor.
        const cc = (Array.isArray(it.cc) ? it.cc : String(it.cc ?? '').split(','))
          .map((c: unknown) => String(c ?? '').trim())
          .filter(Boolean)
        if (cc.length > MAX_CC) {
          return reply.status(400).send({
            error: `Máximo ${MAX_CC} copias por correo (${it.placa ?? `item ${i + 1}`}).`,
          })
        }
        const ccInvalido = cc.find((c: string) => !EMAIL_RE.test(c))
        if (!esPrueba && ccInvalido) {
          return reply.status(400).send({
            error: `Copia inválida para ${it.placa ?? `item ${i + 1}`}: "${ccInvalido}".`,
          })
        }
        items.push({
          cierre_id: tipo === 'CIERRE' ? it.cierre_id : null,
          origen_id: typeof it.origen_id === 'string' && it.origen_id ? it.origen_id : null,
          tercero_id: it.tercero_id ?? null,
          placa: String(it.placa || '').toUpperCase() || 'SIN_PLACA',
          // En ingresos/ocasional no hay tercero: el saludo del correo se
          // omite si va vacío, así que no se inventa un «SIN TERCERO».
          tercero_nombre: String(it.tercero_nombre || (tipo === 'CIERRE' ? 'SIN TERCERO' : '')),
          titulo: typeof it.titulo === 'string' && it.titulo.trim() ? it.titulo.trim().slice(0, 200) : undefined,
          to,
          // Sin el propio destinatario: recibirlo dos veces se ve como error.
          cc: cc.filter((c: string) => c.toLowerCase() !== to.toLowerCase()),
          filename: String(it.filename || `LIQUIDACION_${it.placa ?? i + 1}`).replace(/[^a-z0-9_\- ]/gi, '_'),
          html: it.html,
          // Resumen del correo: pares etiqueta/valor ya formateados por el
          // canvas. Se recortan en tamaño y en número porque acaban en una
          // tarjeta de cuatro filas del correo, no en un informe; el escape a
          // HTML lo hace la plantilla.
          resumen: (Array.isArray(it.resumen) ? it.resumen : [])
            .filter((r: any) => r && typeof r.etiqueta === 'string' && typeof r.valor === 'string')
            .slice(0, MAX_RESUMEN)
            .map((r: any) => ({
              etiqueta: r.etiqueta.trim().slice(0, 60),
              valor: r.valor.trim().slice(0, 40),
            }))
            .filter((r: any) => r.etiqueta && r.valor),
        })
      }

      // El origen del lote debe existir y ser del periodo: sin esta
      // comprobación un cliente podría dejar constancia de "enviado" sobre
      // un mes que no es.
      if (tipo === 'CIERRE') {
        const delPeriodo = await prisma.liquidacion_tercero_final.findMany({
          where: { id: { in: items.map((i) => i.cierre_id!) }, anio, mes, deleted_at: null },
          select: { id: true },
        })
        const validos = new Set(delPeriodo.map((c) => c.id))
        const invalidos = items.filter((i) => !validos.has(i.cierre_id!))
        if (invalidos.length > 0) {
          return reply.status(400).send({
            error: `${invalidos.length} cierre(s) no pertenecen a ${mes}/${anio}: ${invalidos.map((i) => i.placa).join(', ')}`,
          })
        }
      } else {
        // La cabecera puede no existir todavía (mes sin guardar): un
        // origen_id ausente se admite; uno presente debe cuadrar.
        const ids = [...new Set(items.map((i) => i.origen_id).filter(Boolean))] as string[]
        if (ids.length > 0) {
          const delPeriodo =
            tipo === 'INGRESO'
              ? await prisma.liquidacion_ingreso_transmeralda.findMany({
                  where: { id: { in: ids }, anio, mes },
                  select: { id: true },
                })
              : await prisma.liquidacion_tercero_ocasional.findMany({
                  where: { id: { in: ids }, anio, mes },
                  select: { id: true },
                })
          const validos = new Set(delPeriodo.map((c) => c.id))
          if (ids.some((id) => !validos.has(id))) {
            return reply.status(400).send({ error: `El origen del envío no pertenece a ${mes}/${anio}.` })
          }
        }
      }

      // Adjuntos extra, comunes a todo el lote.
      const adjuntosExtra: Array<{ filename: string; contentType: string; content: Buffer }> = []
      let totalExtra = 0
      for (const a of Array.isArray(b.adjuntos_extra) ? b.adjuntos_extra : []) {
        if (!a?.filename || typeof a.base64 !== 'string') continue
        const content = Buffer.from(a.base64, 'base64')
        totalExtra += content.length
        if (totalExtra > MAX_ADJUNTOS_EXTRA) {
          return reply.status(413).send({ error: 'Los adjuntos adicionales superan los 15 MB.' })
        }
        adjuntosExtra.push({
          filename: String(a.filename).slice(0, 200),
          contentType: String(a.contentType || 'application/octet-stream'),
          content,
        })
      }

      const asunto =
        typeof b.asunto === 'string' && b.asunto.trim()
          ? b.asunto.trim().slice(0, 300)
          : 'Liquidación {PLACA} — {PERIODO} · Transmeralda'
      const mensaje = typeof b.mensaje === 'string' ? b.mensaje.slice(0, 5000) : ''

      const r = envioLiquidacionesQueueService.enqueue(
        user?.id ?? '',
        user?.nombre || user?.correo || 'Usuario',
        {
          tipo,
          anio,
          mes,
          css: b.css,
          asunto,
          mensaje,
          es_prueba: esPrueba,
          destino_prueba: esPrueba ? destinoPrueba : undefined,
          items,
          adjuntos_extra: adjuntosExtra,
        },
      )

      if (r.status === 'locked') {
        return reply.status(409).send({ status: 'locked', locked_by: r.lockedBy })
      }
      return reply.send({ status: 'queued', job_id: r.jobId, total: items.length })
    } catch (error: any) {
      return reply.status(500).send({ error: error.message })
    }
  }

  /** GET /liquidaciones-terceros/envios/periodo?anio&mes → estado por cierre. */
  static async estadoPeriodo(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { anio, mes } = request.query as any
      const a = Number(anio)
      const m = Number(mes)
      if (!a || !m) return reply.status(400).send({ error: 'anio y mes son obligatorios' })
      const estados = await LiquidacionesTercerosEnviosService.estadoPorPeriodo(a, m)
      let proveedor: string | null = null
      try {
        proveedor = proveedorActivo()
      } catch {
        proveedor = null
      }
      return reply.send({ estados, proveedor })
    } catch (error: any) {
      return reply.status(500).send({ error: error.message })
    }
  }

  /** GET /liquidaciones-terceros/envios/historial?tipo&anio&mes → constancias. */
  static async historialPeriodo(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { tipo, anio, mes } = request.query as any
      const a = Number(anio)
      const m = Number(mes)
      if (!a || !m) return reply.status(400).send({ error: 'anio y mes son obligatorios' })
      if (!['CIERRE', 'INGRESO', 'OCASIONAL'].includes(tipo)) {
        return reply.status(400).send({ error: 'tipo inválido' })
      }
      const historial = await LiquidacionesTercerosEnviosService.historialPorPeriodo(tipo, a, m)
      let proveedor: string | null = null
      try {
        proveedor = proveedorActivo()
      } catch {
        proveedor = null
      }
      return reply.send({ historial, proveedor })
    } catch (error: any) {
      return reply.status(500).send({ error: error.message })
    }
  }

  /** GET /liquidaciones-terceros/envios/cierre/:cierreId → historial. */
  static async historialCierre(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { cierreId } = request.params as any
      const historial = await LiquidacionesTercerosEnviosService.historialDeCierre(cierreId)
      return reply.send(historial)
    } catch (error: any) {
      return reply.status(500).send({ error: error.message })
    }
  }

  /** GET /liquidaciones-terceros/envios/status/:jobId */
  static async status(request: FastifyRequest, reply: FastifyReply) {
    const { jobId } = request.params as any
    const job = envioLiquidacionesQueueService.getStatus(jobId)
    if (!job) return reply.status(404).send({ error: 'Job no encontrado (pudo expirar).' })
    return reply.send(job)
  }

  /** DELETE /liquidaciones-terceros/envios/job/:jobId */
  static async cancelar(request: FastifyRequest, reply: FastifyReply) {
    const { jobId } = request.params as any
    const user = (request as any).user
    const ok = envioLiquidacionesQueueService.cancel(jobId, user?.id ?? '')
    if (!ok) return reply.status(404).send({ error: 'No se pudo cancelar (no existe o no es tuyo).' })
    return reply.send({ cancelled: true })
  }
}
