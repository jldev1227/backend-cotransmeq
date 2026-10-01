import { Resend } from 'resend'
import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'
import { env } from '../config/env'
import { AREA_LABELS } from '../config/permissions'
import { buildPortalAccessLink, type PortalAccessChannel } from '../lib/portal-access-link'
import { MARCA, bloqueCita, bloqueLista, bloqueNota, escaparHtml, renderCorreo, textoAHtml } from './email-plantilla'

// ═══════════════════════════════════════════════════════
// PROVEEDOR DE EMAIL: Resend (principal) o SMTP (fallback)
// ═══════════════════════════════════════════════════════

let _resend: Resend | null = null
let _smtpTransporter: Transporter | null = null

type EmailProvider = 'resend' | 'smtp'

function getEmailProvider(): EmailProvider {
  if (env.RESEND_API_KEY) return 'resend'
  if (env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASSWORD) return 'smtp'
  throw new Error('No hay proveedor de email configurado. Configure RESEND_API_KEY o las variables SMTP_HOST/SMTP_USER/SMTP_PASSWORD.')
}

function getResend(): Resend {
  if (!_resend) {
    if (!env.RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY no está configurada.')
    }
    _resend = new Resend(env.RESEND_API_KEY)
  }
  return _resend
}

function getSmtpTransporter(): Transporter {
  if (!_smtpTransporter) {
    _smtpTransporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT || 587,
      secure: env.SMTP_SECURE || false,
      auth: {
        user: env.SMTP_USER,
        pass: env.SMTP_PASSWORD,
      },
    })
  }
  return _smtpTransporter
}

/**
 * Attachment genérico aceptado por ambos providers (Resend y SMTP).
 * - `filename`: nombre del archivo
 * - `content`: contenido como Buffer
 * - `contentType` (opcional): mime type
 */
export interface EmailAttachment {
  filename: string
  content: Buffer
  contentType?: string
  /** Content-ID para imágenes embebidas: el HTML las referencia como cid:<id>. */
  contentId?: string
}

/**
 * `from` para Resend, con aviso si es un correo personal.
 *
 * Resend RECHAZA enviar desde @gmail.com y compañía: exige un dominio
 * verificado. El fallo llega como error de API en tiempo de envío, que es
 * tarde; este aviso lo adelanta al primer correo.
 */
function getFromForResend(): string {
  const from = env.RESEND_FROM || env.SMTP_FROM || 'Cotransmeq <noreply@cotransmeq.com>'
  const email = (from.match(/<([^>]+)>/)?.[1] ?? from).toLowerCase()
  if (/@(gmail|yahoo|hotmail|outlook|live)\.com$/i.test(email)) {
    console.warn(
      `[EmailService][Resend] El from "${from}" es un correo personal. ` +
        `Resend requiere un dominio verificado (ej: noreply@cotransmeq.com). ` +
        `Configura RESEND_FROM en .env con un dominio verificado.`
    )
  }
  return from
}

/**
 * URL pública con la que se construyen los enlaces de los correos.
 *
 * NO usar `env.FRONTEND_URL` a pelo: esa variable puede llevar VARIOS orígenes
 * separados por coma para el CORS, y concatenarla produce enlaces rotos del
 * tipo "https://a.com,https://b.com/public/portal?token=...".
 *
 * Prioridad: EMAIL_FRONTEND_URL -> primer origen de FRONTEND_URL -> localhost.
 */
export function getEmailFrontendUrl(): string {
  if (env.EMAIL_FRONTEND_URL && env.EMAIL_FRONTEND_URL.trim()) {
    return env.EMAIL_FRONTEND_URL.trim().replace(/\/+$/, '')
  }
  if (env.FRONTEND_URL && env.FRONTEND_URL.trim()) {
    const primero = env.FRONTEND_URL.split(',').map(o => o.trim()).filter(Boolean)[0]
    if (primero) return primero.replace(/\/+$/, '')
  }
  return 'http://localhost:5173'
}

/**
 * Envía un email usando el proveedor disponible (Resend o SMTP)
 */
async function sendEmail({ from, to, subject, html, bcc, attachments }: { from: string; to: string[]; subject: string; html: string; bcc?: string[]; attachments?: EmailAttachment[] }) {
  const provider = getEmailProvider()

  if (provider === 'resend') {
    const payload: any = { from: getFromForResend(), to, subject, html }
    if (bcc && bcc.length > 0) payload.bcc = bcc
    if (attachments && attachments.length > 0) {
      payload.attachments = attachments.map((a) => ({
        filename: a.filename,
        content: a.content,
        ...(a.contentId ? { contentId: a.contentId } : {})
      }))
    }
    const { data, error } = await getResend().emails.send(payload)
    if (error) {
      console.error('[EmailService][Resend] Error enviando email:', error)
      throw new Error(`Error enviando email: ${error.message}`)
    }
    console.log('[EmailService][Resend] Email enviado exitosamente:', data?.id)
    return data
  }

  // SMTP fallback
  const smtpFrom = env.SMTP_FROM || from
  const mailOptions: any = {
    from: smtpFrom,
    to: to.join(', '),
    subject,
    html,
  }
  if (bcc && bcc.length > 0) mailOptions.bcc = bcc.join(', ')
  if (attachments && attachments.length > 0) {
    mailOptions.attachments = attachments.map((a) => ({
      filename: a.filename,
      content: a.content,
      contentType: a.contentType,
      cid: a.contentId
    }))
  }
  const info = await getSmtpTransporter().sendMail(mailOptions)
  console.log('[EmailService][SMTP] Email enviado exitosamente:', info.messageId)
  return { id: info.messageId }
}

interface SendMagicLinkParams {
  to: string
  conductorNombre: string
  conductorApellido: string
  token: string
  canal?: PortalAccessChannel
}

const PIE_SISTEMA = `Este correo fue enviado automáticamente por el sistema de ${MARCA.nombre}.`
const PIE_IGNORAR = 'Si no solicitaste este acceso, puedes ignorar este mensaje.'
const PIE_DUDAS = 'Si tienes dudas, contacta al administrador.'

/**
 * Constructores del HTML de cada correo. Son funciones puras (reciben datos
 * ya resueltos y devuelven el documento) para poder previsualizarlas y
 * probarlas sin enviar nada. Los métodos de `EmailService` solo resuelven
 * enlaces y destinatarios y delegan aquí.
 */
export const EmailPlantillas = {
  accesoReporteDiario(p: { nombreCompleto: string; magicLink: string }): string {
    return renderCorreo({
      preheader: 'Tu enlace personal para ingresar al Reporte Diario de Actividad.',
      eyebrow: 'Reporte diario',
      titulo: 'Acceso al Reporte Diario',
      subtitulo: 'Registra tu actividad del día desde cualquier dispositivo.',
      mascota: 'saludando',
      saludo: `Hola, <strong>${escaparHtml(p.nombreCompleto)}</strong>`,
      parrafos: [
        'Has solicitado acceso al sistema de <strong>Reporte Diario de Actividad</strong>. Pulsa el botón para ingresar de forma segura.'
      ],
      boton: { texto: 'Ingresar al sistema', url: p.magicLink },
      notas: [
        { html: 'Este enlace es válido por <strong>30 días</strong>. Después de ese período deberás solicitar un nuevo acceso.' }
      ],
      enlaceRespaldo: p.magicLink,
      pie: [PIE_SISTEMA, PIE_IGNORAR]
    })
  },

  accesoPortal(p: { nombreCompleto: string; portalLink: string }): string {
    return renderCorreo({
      preheader: 'Tu enlace personal para ingresar al Portal del Conductor.',
      eyebrow: 'Acceso personal',
      titulo: 'Portal del Conductor',
      subtitulo: 'Tus desprendibles y tu actividad diaria, en un solo lugar.',
      mascota: 'saludando',
      saludo: `Hola, <strong>${escaparHtml(p.nombreCompleto)}</strong>`,
      parrafos: [
        'Has solicitado acceso al <strong>Portal del Conductor</strong>. Desde aquí podrás consultar tus <strong>desprendibles de nómina</strong> y registrar tu <strong>actividad diaria</strong>.'
      ],
      boton: { texto: 'Ingresar al portal', url: p.portalLink },
      html:
        bloqueLista('Desde tu portal puedes', [
          'Ver y descargar tus desprendibles de nómina',
          'Registrar tu actividad diaria (días laborados)'
        ]) +
        bloqueNota({
          html: 'Este enlace es válido por <strong>30 días</strong>. Después deberás solicitar un nuevo acceso.'
        }),
      enlaceRespaldo: p.portalLink,
      pie: [PIE_SISTEMA, PIE_IGNORAR]
    })
  },

  invitacion(p: { invitadoPorNombre: string; areasText: string; inviteLink: string }): string {
    return renderCorreo({
      preheader: `${p.invitadoPorNombre} te invita al Sistema de Gestión de ${MARCA.nombre}.`,
      eyebrow: 'Invitación',
      titulo: 'Te han invitado al sistema',
      subtitulo: 'Completa tu registro para empezar a usar el Sistema de Gestión.',
      mascota: 'saludando',
      parrafos: [
        `<strong>${escaparHtml(p.invitadoPorNombre)}</strong> te ha invitado a unirte al <strong>Sistema de Gestión de ${MARCA.nombre}</strong>.`,
        'Pulsa el botón para completar tu registro y acceder al sistema. El enlace es válido por <strong>72 horas</strong>.'
      ],
      datos: { filas: [{ etiqueta: 'Área asignada', valor: escaparHtml(p.areasText || 'Por definir') }] },
      boton: { texto: 'Aceptar invitación', url: p.inviteLink },
      notas: [
        { tono: 'aviso', html: 'Si no conoces a quien te envió esta invitación o no la solicitaste, ignora este correo.' }
      ],
      enlaceRespaldo: p.inviteLink,
      pie: [PIE_SISTEMA]
    })
  },

  desprendible(p: { conductorNombre: string; periodo: string; portalLink: string; mensaje?: string | null }): string {
    const periodo = escaparHtml(p.periodo)
    return renderCorreo({
      preheader: `Tu desprendible de nómina del ${p.periodo} ya está disponible.`,
      eyebrow: 'Nómina',
      titulo: 'Tu desprendible está listo',
      subtitulo: 'Ya puedes consultarlo, descargarlo y firmarlo desde tu portal.',
      mascota: 'celebrando',
      saludo: `Hola, <strong>${escaparHtml(p.conductorNombre)}</strong>`,
      parrafos: [
        `Tu desprendible de nómina correspondiente al <strong>${periodo}</strong> ya está disponible para consulta.`
      ],
      htmlTrasParrafos: p.mensaje?.trim() ? bloqueCita(textoAHtml(p.mensaje)) : '',
      datos: { filas: [{ etiqueta: 'Periodo', valor: periodo }] },
      boton: { texto: 'Ver desprendible', url: p.portalLink },
      notas: [
        { html: 'Desde tu portal podrás <strong>ver, descargar y firmar</strong> tu desprendible de nómina.' }
      ],
      pie: [PIE_SISTEMA, PIE_DUDAS]
    })
  },

  prima(p: { conductorNombre: string; periodo: string; portalLink: string }): string {
    const periodo = escaparHtml(p.periodo)
    return renderCorreo({
      preheader: `Tu liquidación de prima de servicio del ${p.periodo} ya está disponible.`,
      eyebrow: 'Prima de servicio',
      titulo: 'Tu liquidación de prima está lista',
      subtitulo: 'Ya puedes consultarla, descargarla y firmarla desde tu portal.',
      mascota: 'celebrando',
      saludo: `Hola, <strong>${escaparHtml(p.conductorNombre)}</strong>`,
      parrafos: [
        `Tu liquidación de <strong>Prima de Servicio</strong> correspondiente al <strong>${periodo}</strong> ya está disponible para consulta.`
      ],
      datos: { filas: [{ etiqueta: 'Periodo', valor: periodo }] },
      boton: { texto: 'Ver liquidación de prima', url: p.portalLink },
      notas: [
        { html: 'Desde tu portal podrás <strong>ver, descargar y firmar</strong> tu liquidación de prima de servicio.' }
      ],
      pie: [PIE_SISTEMA, PIE_DUDAS]
    })
  },

  certificados(p: {
    terceroNombre: string
    certificados: { tipo: string; anio: number; url: string }[]
    accessLink: string
    mensajePersonalizado?: string
  }): string {
    const lista = p.certificados.map(
      (c) =>
        `<strong>${escaparHtml(c.tipo)}</strong> · Año ${escaparHtml(c.anio)} &nbsp;—&nbsp; <a href="${escaparHtml(c.url)}" style="color:${MARCA.primario};font-weight:700;text-decoration:none;">Descargar</a>`
    )
    return renderCorreo({
      preheader: 'Tus certificados tributarios ya están disponibles para descarga.',
      eyebrow: 'Certificados tributarios',
      titulo: 'Tus certificados están disponibles',
      subtitulo: 'Consúltalos y descárgalos cuando los necesites.',
      mascota: 'todo-bien',
      saludo: `Hola, <strong>${escaparHtml(p.terceroNombre)}</strong>`,
      parrafos: ['Tus certificados tributarios están disponibles. Pulsa el botón para acceder:'],
      htmlTrasParrafos: p.mensajePersonalizado?.trim() ? bloqueCita(textoAHtml(p.mensajePersonalizado)) : '',
      boton: { texto: 'Ver certificados', url: p.accessLink },
      html:
        bloqueLista('Certificados disponibles', lista) +
        bloqueNota({
          tono: 'aviso',
          html: 'Este enlace es válido por <strong>90 días</strong>. Después deberás solicitar un nuevo acceso.'
        }),
      enlaceRespaldo: p.accessLink,
      pie: [PIE_SISTEMA, PIE_DUDAS]
    })
  }
}

export const EmailService = {

  /**
   * Envía un email genérico (helper expuesto para uso desde otros módulos)
   */
  async sendEmail(params: { from?: string; to: string[]; subject: string; html: string; bcc?: string[]; attachments?: EmailAttachment[] }) {
    const defaultFrom = env.RESEND_API_KEY
      ? env.RESEND_FROM ?? 'Cotransmeq <noreply@cotransmeq.com>'
      : env.SMTP_FROM ?? 'Cotransmeq <noreply@cotransmeq.com>'
    return sendEmail({ from: params.from ?? defaultFrom, ...params })
  },

  async sendMagicLink({ to, conductorNombre, conductorApellido, token }: SendMagicLinkParams) {
    const frontendUrl = getEmailFrontendUrl()
    const magicLink = `${frontendUrl}/public/dias-laborados?token=${token}`
    const html = EmailPlantillas.accesoReporteDiario({
      nombreCompleto: `${conductorNombre} ${conductorApellido}`,
      magicLink
    })

    try {
      // Sin bcc intencionalmente: es un access link con token personal
      const data = await sendEmail({
        from: 'Cotransmeq <noreply@cotransmeq.com>',
        to: [to],
        subject: '🚛 Acceso al Reporte Diario — Cotransmeq',
        html
      })

      return data
    } catch (err) {
      console.error('[EmailService] Error:', err)
      throw err
    }
  },

  async sendPortalAccessLink({ to, conductorNombre, conductorApellido, token, canal = 'web' }: SendMagicLinkParams) {
    const frontendUrl = getEmailFrontendUrl()
    const portalLink = buildPortalAccessLink({
      canal,
      token,
      webBaseUrl: frontendUrl,
      mobileBaseUrl: env.MOBILE_PORTAL_URL
    })
    const html = EmailPlantillas.accesoPortal({
      nombreCompleto: `${conductorNombre} ${conductorApellido}`,
      portalLink
    })

    try {
      // Sin bcc intencionalmente: es un access link con token personal
      const data = await sendEmail({
        from: 'Cotransmeq <noreply@cotransmeq.com>',
        to: [to],
        subject: '📋 Acceso al Portal del Conductor — Cotransmeq',
        html
      })

      return data
    } catch (err) {
      console.error('[EmailService] Error:', err)
      throw err
    }
  },

  async sendInvitacionEmail({
    to,
    invitadoPorNombre,
    area,
    token
  }: {
    to: string
    invitadoPorNombre: string
    area: string[]
    token: string
  }) {
    const frontendUrl = getEmailFrontendUrl()
    const inviteLink = `${frontendUrl}/invite/${token}`
    // Mapa de `config/permissions.ts` en vez de una copia local: la copia se
    // quedaba sin las áreas nuevas (`mantenimiento`) y las pintaba en crudo.
    const areasText = area.map(a => (AREA_LABELS as Record<string, string>)[a] || a).join(', ')
    const html = EmailPlantillas.invitacion({ invitadoPorNombre, areasText, inviteLink })

    try {
      // Sin bcc intencionalmente: invitación con token de registro personal
      const data = await sendEmail({
        from: 'Cotransmeq <noreply@cotransmeq.com>',
        to: [to],
        subject: `🟢 ${invitadoPorNombre} te invita a Cotransmeq`,
        html
      })
      return data
    } catch (err) {
      console.error('[EmailService] Error enviando invitación:', err)
      throw err
    }
  },

  async sendDesprendibleNotification({
    to,
    conductorNombre,
    periodo,
    monto,
    portalLink,
    asunto,
    mensaje,
    cc = [],
    conCopiaOculta = true
  }: {
    to: string
    conductorNombre: string
    periodo: string
    monto: string
    portalLink: string
    /** Asunto propio (el del modal de envío del canvas). Sin él, el de siempre. */
    asunto?: string
    /** Nota libre que se pinta bajo el saludo. */
    mensaje?: string | null
    cc?: string[]
    /** Copia oculta a talento humano (`NOTIF_BCC_EMAIL`). Los envíos de prueba la apagan. */
    conCopiaOculta?: boolean
  }) {
    const html = EmailPlantillas.desprendible({ conductorNombre, periodo, portalLink, mensaje })

    try {
      const bcc = conCopiaOculta && env.NOTIF_BCC_EMAIL ? [env.NOTIF_BCC_EMAIL] : undefined
      const data = await sendEmail({
        from: 'Cotransmeq <noreply@cotransmeq.com>',
        to: [to, ...cc.filter(Boolean)],
        subject: asunto?.trim() || `📄 Tu Desprendible de Nómina — ${periodo}`,
        html,
        bcc
      })

      return data
    } catch (err) {
      console.error('[EmailService] Error:', err)
      throw err
    }
  },

  async sendPrimaNotification({
    to,
    conductorNombre,
    periodo,
    monto,
    portalLink
  }: {
    to: string
    conductorNombre: string
    periodo: string
    monto: string
    portalLink: string
  }) {
    const html = EmailPlantillas.prima({ conductorNombre, periodo, portalLink })

    try {
      const bcc = env.NOTIF_BCC_EMAIL ? [env.NOTIF_BCC_EMAIL] : undefined
      const data = await sendEmail({
        from: 'Cotransmeq <noreply@cotransmeq.com>',
        to: [to],
        subject: `💰 Tu Liquidación de Prima — ${periodo}`,
        html,
        bcc
      })

      return data
    } catch (err) {
      console.error('[EmailService] Error enviando prima:', err)
      throw err
    }
  },

  async sendCertificacionAccessLink({
    to,
    terceroNombre,
    certificados,
    token,
    mensaje_personalizado
  }: {
    to: string
    terceroNombre: string
    certificados: { tipo: string; anio: number; url: string }[]
    token: string
    mensaje_personalizado?: string
  }) {
    const frontendUrl = getEmailFrontendUrl()
    const accessLink = `${frontendUrl}/public/certificados?token=${token}`
    const html = EmailPlantillas.certificados({
      terceroNombre,
      certificados,
      accessLink,
      mensajePersonalizado: mensaje_personalizado
    })

    try {
      const bcc = env.NOTIF_BCC_EMAIL ? [env.NOTIF_BCC_EMAIL] : undefined
      const data = await sendEmail({
        from: 'Cotransmeq <noreply@cotransmeq.com>',
        to: [to],
        subject: '📋 Tus Certificados Tributarios — Cotransmeq',
        html,
        bcc
      })
      return data
    } catch (err) {
      console.error('[EmailService] Error enviando certificación:', err)
      throw err
    }
  }
}
