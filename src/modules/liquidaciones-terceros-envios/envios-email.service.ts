/**
 * Transporte y plantilla de los correos de liquidación a terceros.
 *
 * Este servicio NO reutiliza `EmailService.sendEmail` porque el requisito de
 * este flujo es distinto al de las notificaciones internas: el tercero debe
 * ver el correo como enviado por CONTABILIDAD y su respuesta debe llegar a
 * ese buzón. Eso condiciona el From, el Reply-To y el BCC de constancia.
 *
 * Selección de proveedor, en orden:
 *
 *  1. **SMTP del Gmail de contabilidad** (`CONTABILIDAD_SMTP_USER` +
 *     `CONTABILIDAD_SMTP_PASSWORD`, un app password de Google). El From ES
 *     `contabilidadtransmeraldasas@gmail.com`: ninguna ambigüedad para el
 *     tercero, y la copia queda en Enviados de esa cuenta. Gmail admite
 *     ~500 envíos/día por cuenta.
 *
 *  2. **Resend** (`RESEND_API_KEY`). Resend solo permite From de un dominio
 *     verificado — un `@gmail.com` devuelve 403 — así que el From es
 *     `RESEND_FROM` con el NOMBRE visible de contabilidad, y el Reply-To
 *     apunta al Gmail de contabilidad: al pulsar "Responder", la respuesta
 *     va a ese buzón. El BCC de constancia sí llega al Gmail.
 *
 *  3. **SMTP global** (`SMTP_*`), como respaldo final.
 */

import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'
import { Resend } from 'resend'
import { env } from '../../config/env'
import { MARCA, bloqueCita, bloqueLista, bloqueParrafo, renderCorreo, textoAHtml } from '../../services/email-plantilla'

export type ProveedorEnvio = 'smtp-contabilidad' | 'resend' | 'smtp'

export interface AdjuntoEnvio {
  filename: string
  content: Buffer
  contentType?: string
}

export interface EnvioLiquidacionEmail {
  to: string
  /** Copias visibles (CC). El BCC de constancia va aparte. */
  cc?: string[]
  asunto: string
  /** Mensaje personalizado (texto plano; los saltos de línea se respetan). */
  mensaje: string
  placa: string
  /** Nombre del tercero; vacío cuando el destinatario se escribió a mano. */
  terceroNombre: string
  periodo: string
  /** Título del correo; sin él, «Liquidación de su vehículo {placa}». */
  titulo?: string
  /** Etiqueta de la primera fila del resumen (Vehículo, Hoja…). */
  etiqueta?: string
  /** Líneas extra del resumen, ya formateadas por el canvas. */
  resumen?: Array<{ etiqueta: string; valor: string }>
  adjuntos: AdjuntoEnvio[]
  /** Prueba: sin BCC de constancia y asunto con prefijo. */
  esPrueba: boolean
}

let _resend: Resend | null = null
let _contabilidad: Transporter | null = null
let _smtp: Transporter | null = null

export function proveedorActivo(): ProveedorEnvio {
  if (env.CONTABILIDAD_SMTP_USER && env.CONTABILIDAD_SMTP_PASSWORD) return 'smtp-contabilidad'
  if (env.RESEND_API_KEY) return 'resend'
  if (env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASSWORD) return 'smtp'
  throw new Error(
    'Sin proveedor de email: configure CONTABILIDAD_SMTP_USER/PASSWORD, RESEND_API_KEY o SMTP_*.'
  )
}

function transporterContabilidad(): Transporter {
  if (!_contabilidad) {
    _contabilidad = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      auth: { user: env.CONTABILIDAD_SMTP_USER, pass: env.CONTABILIDAD_SMTP_PASSWORD },
    })
  }
  return _contabilidad
}

function transporterGlobal(): Transporter {
  if (!_smtp) {
    _smtp = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT || 587,
      secure: env.SMTP_SECURE || false,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
    })
  }
  return _smtp
}

function resend(): Resend {
  if (!_resend) _resend = new Resend(env.RESEND_API_KEY)
  return _resend
}

/** Email pelado de un `Nombre <email>` o el valor tal cual. */
function soloEmail(v: string): string {
  return (v.match(/<([^>]+)>/)?.[1] ?? v).trim()
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Cuerpo HTML del correo, con la plantilla común del sistema (hero verde con
 * la mascota trabajando, tarjeta blanca, bloque de datos clave).
 *
 * El mensaje personalizado va escapado y con los saltos de línea convertidos:
 * lo escribe un usuario interno, pero tratarlo como HTML crudo permitiría
 * inyectar marcado en un correo que sale con la firma de contabilidad.
 */
export function htmlEnvioLiquidacion(p: {
  terceroNombre: string
  placa: string
  periodo: string
  mensaje: string
  adjuntos: string[]
  titulo?: string
  etiqueta?: string
  resumen?: Array<{ etiqueta: string; valor: string }>
}): string {
  const mensaje = (p.mensaje || '').trim()
  // Líneas extra del resumen (la cifra de cierre de la hoja). Van DESPUÉS de
  // Periodo y destacadas: es el dato que el destinatario busca antes de abrir
  // el PDF.
  const resumen = (p.resumen ?? [])
    .filter((r) => r && r.etiqueta && r.valor)
    .map((r) => ({ etiqueta: escapeHtml(r.etiqueta), valor: escapeHtml(r.valor), destacado: true }))

  return renderCorreo({
    preheader: `${p.titulo || `Liquidación de su vehículo ${p.placa}`} · ${p.periodo}`,
    eyebrow: 'Liquidación',
    titulo: escapeHtml(p.titulo || `Liquidación de su vehículo ${p.placa}`),
    subtitulo: escapeHtml(p.periodo),
    mascota: 'trabajando',
    saludo: p.terceroNombre ? `Señor(a) <strong>${escapeHtml(p.terceroNombre)}</strong>,` : undefined,
    htmlTrasParrafos: mensaje ? bloqueCita(textoAHtml(mensaje)) : '',
    datos: {
      filas: [
        { etiqueta: escapeHtml(p.etiqueta || 'Vehículo'), valor: escapeHtml(p.placa) },
        { etiqueta: 'Periodo', valor: escapeHtml(p.periodo) },
        ...resumen
      ]
    },
    html:
      bloqueLista('Documentos adjuntos', p.adjuntos.map((a) => escapeHtml(a))) +
      bloqueParrafo(
        'Si tiene alguna inquietud sobre esta liquidación, puede <strong>responder directamente a este correo</strong> y el área de contabilidad le atenderá.',
        { muted: true }
      ),
    pie: [
      `${MARCA.razonSocial} — Área de Contabilidad`,
      'Este correo contiene información confidencial dirigida únicamente a su destinatario.'
    ]
  })
}

export const EnviosEmailService = {
  proveedorActivo,

  /**
   * Envía UN correo de liquidación. Devuelve proveedor y message id.
   * El llamador (la cola) decide el ritmo y registra el resultado.
   */
  async enviar(p: EnvioLiquidacionEmail): Promise<{ proveedor: ProveedorEnvio; messageId: string | null }> {
    const proveedor = proveedorActivo()
    const asunto = p.esPrueba ? `[PRUEBA] ${p.asunto}` : p.asunto
    const bcc = !p.esPrueba && env.LIQ_EMAIL_BCC ? [env.LIQ_EMAIL_BCC] : undefined
    const cc = p.cc && p.cc.length > 0 ? p.cc : undefined
    const replyTo = env.LIQ_EMAIL_REPLY_TO || undefined

    const html = htmlEnvioLiquidacion({
      terceroNombre: p.terceroNombre,
      placa: p.placa,
      periodo: p.periodo,
      titulo: p.titulo,
      etiqueta: p.etiqueta,
      resumen: p.resumen,
      mensaje: p.mensaje,
      adjuntos: p.adjuntos.map((a) => a.filename),
    })

    if (proveedor === 'smtp-contabilidad') {
      const from = `"${env.LIQ_EMAIL_FROM_NAME}" <${env.CONTABILIDAD_SMTP_USER}>`
      const info = await transporterContabilidad().sendMail({
        from,
        to: p.to,
        cc: cc?.join(', '),
        subject: asunto,
        html,
        // El From ya es el buzón de contabilidad; el Reply-To explícito no
        // estorba y cubre el caso de reenvíos.
        replyTo: env.CONTABILIDAD_SMTP_USER,
        bcc: bcc?.join(', '),
        attachments: p.adjuntos.map((a) => ({
          filename: a.filename,
          content: a.content,
          contentType: a.contentType,
        })),
      })
      return { proveedor, messageId: info.messageId ?? null }
    }

    if (proveedor === 'resend') {
      // From de dominio verificado con el NOMBRE de contabilidad. El email
      // del From no puede ser el Gmail (Resend lo rechaza), pero el nombre
      // visible y el Reply-To son los que evitan la confusión del tercero.
      const fromEmail = soloEmail(env.RESEND_FROM || env.SMTP_FROM || 'noreply@transmeralda.com')
      const payload: any = {
        from: `${env.LIQ_EMAIL_FROM_NAME} <${fromEmail}>`,
        to: [p.to],
        subject: asunto,
        html,
        attachments: p.adjuntos.map((a) => ({ filename: a.filename, content: a.content })),
      }
      if (replyTo) payload.replyTo = replyTo
      if (cc) payload.cc = cc
      if (bcc) payload.bcc = bcc
      const { data, error } = await resend().emails.send(payload)
      if (error) throw new Error(error.message || 'Resend rechazó el envío')
      return { proveedor, messageId: data?.id ?? null }
    }

    // SMTP global (respaldo). El From autenticado es el del SMTP_USER; se
    // conserva el nombre de contabilidad y el Reply-To para las respuestas.
    const info = await transporterGlobal().sendMail({
      from: `"${env.LIQ_EMAIL_FROM_NAME}" <${soloEmail(env.SMTP_FROM || env.SMTP_USER || '')}>`,
      to: p.to,
      cc: cc?.join(', '),
      subject: asunto,
      html,
      replyTo,
      bcc: bcc?.join(', '),
      attachments: p.adjuntos.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
      })),
    })
    return { proveedor, messageId: info.messageId ?? null }
  },
}
