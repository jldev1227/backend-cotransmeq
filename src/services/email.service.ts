import { Resend } from 'resend'
import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'
import { env } from '../config/env'

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
 * Envía un email usando el proveedor disponible (Resend o SMTP)
 */
async function sendEmail({ from, to, subject, html, bcc }: { from: string; to: string[]; subject: string; html: string; bcc?: string[] }) {
  const provider = getEmailProvider()

  if (provider === 'resend') {
    const payload: any = { from, to, subject, html }
    if (bcc && bcc.length > 0) payload.bcc = bcc
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
  const info = await getSmtpTransporter().sendMail(mailOptions)
  console.log('[EmailService][SMTP] Email enviado exitosamente:', info.messageId)
  return { id: info.messageId }
}

interface SendMagicLinkParams {
  to: string
  conductorNombre: string
  conductorApellido: string
  token: string
}

export const EmailService = {

  /**
   * Envía un email genérico (helper expuesto para uso desde otros módulos)
   */
  async sendEmail(params: { from?: string; to: string[]; subject: string; html: string; bcc?: string[] }) {
    return sendEmail({ from: params.from ?? env.SMTP_FROM ?? 'noreply@transmeralda.com', ...params })
  },

  async sendMagicLink({ to, conductorNombre, conductorApellido, token }: SendMagicLinkParams) {
    const frontendUrl = env.FRONTEND_URL || 'http://localhost:5173'
    const magicLink = `${frontendUrl}/public/dias-laborados?token=${token}`
    const nombreCompleto = `${conductorNombre} ${conductorApellido}`
    const logoUrl = env.EMAIL_LOGO_URL || 'https://transmeralda.s3.us-east-2.amazonaws.com/assets/logo.png'

    const html = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#f1f5f9;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="520" style="max-width:520px;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

          <!-- Header con gradiente -->
          <tr>
            <td style="background: linear-gradient(135deg, #059669 0%, #047857 100%); padding:32px 32px 24px 32px; text-align:center;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                <tr>
                  <td align="center" style="padding-bottom:16px;">
                    <img src="${logoUrl}" alt="Cotransmeq" width="160" style="display:block;max-width:160px;height:auto;" />
                  </td>
                </tr>
                <tr>
                  <td align="center">
                    <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;line-height:1.3;">
                      Acceso al Reporte Diario
                    </h1>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 8px 0;color:#475569;font-size:15px;line-height:1.5;">
                Hola,
              </p>
              <p style="margin:0 0 24px 0;color:#0f172a;font-size:18px;font-weight:700;line-height:1.3;">
                ${nombreCompleto}
              </p>
              <p style="margin:0 0 28px 0;color:#475569;font-size:15px;line-height:1.6;">
                Has solicitado acceso al sistema de <strong>Reporte Diario de Actividad</strong>. Haz clic en el botón para ingresar de forma segura.
              </p>

              <!-- Botón CTA -->
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                <tr>
                  <td align="center">
                    <!--[if mso]>
                    <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${magicLink}" style="height:52px;v-text-anchor:middle;width:280px;" arcsize="12%" strokecolor="#059669" fillcolor="#059669">
                      <w:anchorlock/>
                      <center style="color:#ffffff;font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">Ingresar al sistema →</center>
                    </v:roundrect>
                    <![endif]-->
                    <!--[if !mso]><!-->
                    <a href="${magicLink}" target="_blank" style="display:inline-block;background-color:#059669;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;padding:14px 40px;border-radius:10px;line-height:1.4;mso-hide:all;">
                      Ingresar al sistema →
                    </a>
                    <!--<![endif]-->
                  </td>
                </tr>
              </table>

              <!-- Info de expiración -->
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-top:28px;">
                <tr>
                  <td style="background-color:#f0fdf4;border-radius:10px;padding:16px 20px;">
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                      <tr>
                        <td width="28" valign="top" style="font-size:18px;">🔒</td>
                        <td style="color:#065f46;font-size:13px;line-height:1.5;">
                          Este enlace es válido por <strong>30 días</strong>. Después de ese período deberás solicitar un nuevo acceso.
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Enlace fallback -->
              <p style="margin:24px 0 0 0;color:#94a3b8;font-size:12px;line-height:1.5;">
                Si el botón no funciona, copia y pega este enlace en tu navegador:
              </p>
              <p style="margin:4px 0 0 0;word-break:break-all;">
                <a href="${magicLink}" style="color:#059669;font-size:12px;text-decoration:underline;">${magicLink}</a>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:#f8fafc;padding:20px 32px;border-top:1px solid #e2e8f0;">
              <p style="margin:0;color:#94a3b8;font-size:12px;line-height:1.5;text-align:center;">
                Este correo fue enviado automáticamente por el sistema de Cotransmeq.<br/>
                Si no solicitaste este acceso, puedes ignorar este mensaje.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

    try {
      const data = await sendEmail({
        from: 'Cotransmeq <noreply@transmeralda.com>',
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

  async sendPortalAccessLink({ to, conductorNombre, conductorApellido, token }: SendMagicLinkParams) {
    const frontendUrl = env.FRONTEND_URL || 'http://localhost:5173'
    const portalLink = `${frontendUrl}/public/portal?token=${token}`
    const nombreCompleto = `${conductorNombre} ${conductorApellido}`
    const logoUrl = env.EMAIL_LOGO_URL || 'https://transmeralda.s3.us-east-2.amazonaws.com/assets/logo.png'

    const html = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#f1f5f9;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="520" style="max-width:520px;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

          <!-- Header con gradiente -->
          <tr>
            <td style="background: linear-gradient(135deg, #059669 0%, #047857 100%); padding:32px 32px 24px 32px; text-align:center;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                <tr>
                  <td align="center" style="padding-bottom:16px;">
                    <img src="${logoUrl}" alt="Cotransmeq" width="160" style="display:block;max-width:160px;height:auto;" />
                  </td>
                </tr>
                <tr>
                  <td align="center">
                    <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;line-height:1.3;">
                      Portal del Conductor
                    </h1>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 8px 0;color:#475569;font-size:15px;line-height:1.5;">
                Hola,
              </p>
              <p style="margin:0 0 24px 0;color:#0f172a;font-size:18px;font-weight:700;line-height:1.3;">
                ${nombreCompleto}
              </p>
              <p style="margin:0 0 28px 0;color:#475569;font-size:15px;line-height:1.6;">
                Has solicitado acceso al <strong>Portal del Conductor</strong>. Desde aquí podrás consultar tus <strong>desprendibles de nómina</strong> y registrar tu <strong>actividad diaria</strong>.
              </p>

              <!-- Botón CTA -->
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                <tr>
                  <td align="center">
                    <a href="${portalLink}" target="_blank" style="display:inline-block;background-color:#059669;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;padding:14px 40px;border-radius:10px;line-height:1.4;">
                      Ingresar al Portal →
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Qué puedes hacer -->
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-top:28px;">
                <tr>
                  <td style="background-color:#f0fdf4;border-radius:10px;padding:16px 20px;">
                    <p style="margin:0 0 8px 0;color:#065f46;font-size:14px;font-weight:700;">📋 Desde tu portal puedes:</p>
                    <p style="margin:0 0 4px 0;color:#065f46;font-size:13px;">📄 Ver y descargar tus desprendibles de nómina</p>
                    <p style="margin:0;color:#065f46;font-size:13px;">📅 Registrar tu actividad diaria (días laborados)</p>
                  </td>
                </tr>
              </table>

              <!-- Info de expiración -->
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-top:16px;">
                <tr>
                  <td style="background-color:#f0fdf4;border-radius:10px;padding:12px 20px;">
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                      <tr>
                        <td width="28" valign="top" style="font-size:18px;">🔒</td>
                        <td style="color:#065f46;font-size:13px;line-height:1.5;">
                          Este enlace es válido por <strong>30 días</strong>. Después deberás solicitar un nuevo acceso.
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Enlace fallback -->
              <p style="margin:24px 0 0 0;color:#94a3b8;font-size:12px;line-height:1.5;">
                Si el botón no funciona, copia y pega este enlace:
              </p>
              <p style="margin:4px 0 0 0;word-break:break-all;">
                <a href="${portalLink}" style="color:#059669;font-size:12px;text-decoration:underline;">${portalLink}</a>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:#f8fafc;padding:20px 32px;border-top:1px solid #e2e8f0;">
              <p style="margin:0;color:#94a3b8;font-size:12px;line-height:1.5;text-align:center;">
                Este correo fue enviado automáticamente por el sistema de Cotransmeq.<br/>
                Si no solicitaste este acceso, puedes ignorar este mensaje.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

    try {
      const data = await sendEmail({
        from: 'Cotransmeq <noreply@transmeralda.com>',
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
    const frontendUrl = env.FRONTEND_URL || 'http://localhost:5173'
    const inviteLink = `${frontendUrl}/invite/${token}`
    const logoUrl = env.EMAIL_LOGO_URL || 'https://transmeralda.s3.us-east-2.amazonaws.com/assets/logo.png'
    const areaLabels: Record<string, string> = {
      administracion: 'Administración',
      operaciones: 'Operaciones',
      contabilidad: 'Contabilidad',
      facturacion: 'Facturación',
      talento_humano: 'Talento Humano',
      hseq: 'HSEQ'
    }
    const areasText = area.map(a => areaLabels[a] || a).join(', ')

    const html = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#f1f5f9;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="520" style="max-width:520px;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#059669 0%,#047857 100%);padding:32px 32px 24px 32px;text-align:center;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                <tr>
                  <td align="center" style="padding-bottom:16px;">
                    <img src="${logoUrl}" alt="Cotransmeq" width="160" style="display:block;max-width:160px;height:auto;" />
                  </td>
                </tr>
                <tr>
                  <td align="center">
                    <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;line-height:1.3;">
                      Has sido invitado al sistema
                    </h1>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 16px 0;color:#475569;font-size:15px;line-height:1.6;">
                <strong style="color:#0f172a">${invitadoPorNombre}</strong> te ha invitado a unirte al <strong>Sistema de Gestión de Cotransmeq</strong>.
              </p>

              <!-- Info área -->
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom:28px;">
                <tr>
                  <td style="background-color:#f0fdf4;border-radius:10px;padding:16px 20px;">
                    <p style="margin:0 0 6px 0;color:#065f46;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;">Área asignada</p>
                    <p style="margin:0;color:#065f46;font-size:15px;font-weight:600;">${areasText || 'Por definir'}</p>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 28px 0;color:#475569;font-size:14px;line-height:1.6;">
                Haz clic en el botón para completar tu registro y acceder al sistema. El enlace es válido por <strong>72 horas</strong>.
              </p>

              <!-- CTA -->
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                <tr>
                  <td align="center">
                    <a href="${inviteLink}" target="_blank" style="display:inline-block;background-color:#059669;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;padding:14px 40px;border-radius:10px;line-height:1.4;">
                      Aceptar invitación →
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Aviso seguridad -->
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-top:28px;">
                <tr>
                  <td style="background-color:#fefce8;border-radius:10px;padding:14px 18px;">
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                      <tr>
                        <td width="28" valign="top" style="font-size:16px;">⚠️</td>
                        <td style="color:#713f12;font-size:12px;line-height:1.5;">
                          Si no conoces a quien te envió esta invitación o no la solicitaste, ignora este correo.
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Enlace fallback -->
              <p style="margin:20px 0 0 0;color:#94a3b8;font-size:12px;line-height:1.5;">
                Si el botón no funciona, copia este enlace en tu navegador:
              </p>
              <p style="margin:4px 0 0 0;word-break:break-all;">
                <a href="${inviteLink}" style="color:#059669;font-size:12px;text-decoration:underline;">${inviteLink}</a>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:#f8fafc;padding:20px 32px;border-top:1px solid #e2e8f0;">
              <p style="margin:0;color:#94a3b8;font-size:12px;line-height:1.5;text-align:center;">
                Este correo fue enviado automáticamente por el sistema de Cotransmeq.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

    try {
      const data = await sendEmail({
        from: 'Cotransmeq <noreply@transmeralda.com>',
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
    portalLink
  }: {
    to: string
    conductorNombre: string
    periodo: string
    monto: string
    portalLink: string
  }) {
    const frontendUrl = env.FRONTEND_URL || 'http://localhost:5173'
    const logoUrl = env.EMAIL_LOGO_URL || 'https://transmeralda.s3.us-east-2.amazonaws.com/assets/logo.png'

    const html = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#f1f5f9;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="520" style="max-width:520px;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #059669 0%, #047857 100%); padding:32px 32px 24px 32px; text-align:center;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                <tr>
                  <td align="center" style="padding-bottom:16px;">
                    <img src="${logoUrl}" alt="Cotransmeq" width="160" style="display:block;max-width:160px;height:auto;" />
                  </td>
                </tr>
                <tr>
                  <td align="center">
                    <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;line-height:1.3;">
                      📄 Tu Desprendible está Listo
                    </h1>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 8px 0;color:#475569;font-size:15px;line-height:1.5;">
                Hola,
              </p>
              <p style="margin:0 0 24px 0;color:#0f172a;font-size:18px;font-weight:700;line-height:1.3;">
                ${conductorNombre}
              </p>
              <p style="margin:0 0 28px 0;color:#475569;font-size:15px;line-height:1.6;">
                Tu desprendible de nómina correspondiente al <strong>${periodo}</strong> ya está disponible para consulta.
              </p>

              <!-- Botón CTA -->
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                <tr>
                  <td align="center">
                    <a href="${portalLink}" target="_blank" style="display:inline-block;background-color:#059669;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;padding:14px 40px;border-radius:10px;line-height:1.4;">
                      📄 Ver Desprendible →
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Info -->
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-top:28px;">
                <tr>
                  <td style="background-color:#f0fdf4;border-radius:10px;padding:16px 20px;">
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                      <tr>
                        <td width="28" valign="top" style="font-size:18px;">📋</td>
                        <td style="color:#065f46;font-size:13px;line-height:1.5;">
                          Desde tu portal podrás <strong>ver, descargar y firmar</strong> tu desprendible de nómina.
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:#f8fafc;padding:20px 32px;border-top:1px solid #e2e8f0;">
              <p style="margin:0;color:#94a3b8;font-size:12px;line-height:1.5;text-align:center;">
                Este correo fue enviado automáticamente por el sistema de Cotransmeq.<br/>
                Si tienes dudas, contacta al administrador.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

    try {
      const bcc = env.NOTIF_BCC_EMAIL ? [env.NOTIF_BCC_EMAIL] : undefined
      const data = await sendEmail({
        from: 'Cotransmeq <noreply@transmeralda.com>',
        to: [to],
        subject: `📄 Tu Desprendible de Nómina — ${periodo}`,
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
    const logoUrl = env.EMAIL_LOGO_URL || 'https://transmeralda.s3.us-east-2.amazonaws.com/assets/logo.png'
    const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Tu Liquidación de Prima</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f1f5f9;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f1f5f9; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 16px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #059669 0%, #047857 100%); padding: 32px; text-align: center;">
              <img src="${logoUrl}" alt="Cotransmeq" width="160" style="display: block; margin: 0 auto 16px; max-width: 160px; height: auto;">
              <h1 style="color: #ffffff; font-size: 22px; font-weight: 700; margin: 0;">💰 Tu Liquidación de Prima</h1>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding: 32px;">
              <p style="color: #1e293b; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">
                Hola, <strong>${conductorNombre}</strong>
              </p>
              <p style="color: #475569; font-size: 15px; line-height: 1.6; margin: 0 0 28px;">
                Tu liquidación de <strong>Prima de Servicio</strong> correspondiente al <strong>${periodo}</strong> ya está disponible para consulta.
              </p>

              <!-- CTA -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <a href="${portalLink}" style="display: inline-block; background: linear-gradient(135deg, #059669 0%, #047857 100%); color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-size: 15px; font-weight: 600; box-shadow: 0 2px 8px rgba(5,150,105,0.3);">
                      💰 Ver Liquidación de Prima →
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Info box -->
              <div style="margin-top: 28px; padding: 16px; background-color: #f0fdf4; border-left: 4px solid #059669; border-radius: 6px;">
                <p style="color: #166534; font-size: 13px; line-height: 1.5; margin: 0;">
                  Desde tu portal podrás <strong>ver, descargar y firmar</strong> tu liquidación de prima de servicio.
                </p>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f8fafc; padding: 20px 32px; text-align: center; border-top: 1px solid #e2e8f0;">
              <p style="color: #94a3b8; font-size: 12px; line-height: 1.5; margin: 0;">
                Este correo fue enviado automáticamente por el sistema de Cotransmeq.<br>
                Si tienes dudas, contacta al administrador.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

    try {
      const bcc = env.NOTIF_BCC_EMAIL ? [env.NOTIF_BCC_EMAIL] : undefined
      const data = await sendEmail({
        from: 'Cotransmeq <noreply@transmeralda.com>',
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
    const frontendUrl = env.FRONTEND_URL || 'http://localhost:5173'
    const accessLink = `${frontendUrl}/public/certificados?token=${token}`
    const logoUrl = env.EMAIL_LOGO_URL || 'https://transmeralda.s3.us-east-2.amazonaws.com/assets/logo.png'

    const certificadosHtml = certificados.length > 0
      ? certificados.map(c => `
    <tr>
      <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0;">
        <span style="font-weight: 600; color: #059669;">${c.tipo}</span>
        <span style="color: #64748b; margin-left: 8px;">Año ${c.anio}</span>
      </td>
      <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; text-align: right;">
        <a href="${c.url}" style="color: #059669; text-decoration: none; font-size: 13px; font-weight: 600;">Descargar →</a>
      </td>
    </tr>
  `).join('')
      : `<tr><td style="padding: 12px; text-align: center; color: #64748b;">Accede a tu portal para ver todos tus certificados</td></tr>`

    const html = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f1f5f9; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #059669 0%, #047857 100%); padding: 32px 32px 24px 32px; text-align: center;">
              <img src="${logoUrl}" alt="Cotransmeq" width="160" style="display: block; margin: 0 auto 16px; max-width: 160px; height: auto;">
              <h1 style="color: #ffffff; font-size: 22px; font-weight: 700; margin: 0;">Tus Certificados Tributarios</h1>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding: 32px;">
              <p style="color: #475569; font-size: 15px; line-height: 1.6; margin: 0 0 8px;">Hola,</p>
              <p style="color: #0f172a; font-size: 18px; font-weight: 700; line-height: 1.3; margin: 0 0 24px;">${terceroNombre}</p>

              ${mensaje_personalizado ? `<p style="color: #475569; font-size: 14px; line-height: 1.6; margin: 0 0 24px; padding: 12px; background: #f8fafc; border-radius: 8px; border-left: 3px solid #059669;">${mensaje_personalizado}</p>` : ''}

              <p style="color: #475569; font-size: 15px; line-height: 1.6; margin: 0 0 20px;">Tus certificados tributarios están disponibles. Haz clic en el botón para acceder:</p>

              <!-- CTA -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <a href="${accessLink}" style="display: inline-block; background: linear-gradient(135deg, #059669 0%, #047857 100%); color: #ffffff; text-decoration: none; padding: 14px 40px; border-radius: 10px; font-size: 16px; font-weight: 700; box-shadow: 0 2px 12px rgba(5,150,105,0.25);">
                      Ver Certificados →
                    </a>
                  </td>
                </tr>
              </table>

              ${certificados.length > 0 ? `
              <!-- Certificados list -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top: 28px;">
                <tr>
                  <td style="background-color: #f0fdf4; border-radius: 10px; padding: 16px 20px;">
                    <p style="margin: 0 0 12px 0; color: #065f46; font-size: 14px; font-weight: 700;">Certificados disponibles:</p>
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      ${certificadosHtml}
                    </table>
                  </td>
                </tr>
              </table>
              ` : ''}

              <!-- Expiración -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top: 20px;">
                <tr>
                  <td style="background-color: #fefce8; border-radius: 10px; padding: 12px 20px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td width="28" valign="top" style="font-size: 18px;">🔒</td>
                        <td style="color: #713f12; font-size: 13px; line-height: 1.5;">
                          Este enlace es válido por <strong>90 días</strong>. Después deberás solicitar un nuevo acceso.
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Fallback link -->
              <p style="margin: 24px 0 0 0; color: #94a3b8; font-size: 12px; line-height: 1.5;">
                Si el botón no funciona, copia y pega este enlace:
              </p>
              <p style="margin: 4px 0 0 0; word-break: break-all;">
                <a href="${accessLink}" style="color: #059669; font-size: 12px; text-decoration: underline;">${accessLink}</a>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f8fafc; padding: 20px 32px; border-top: 1px solid #e2e8f0;">
              <p style="margin: 0; color: #94a3b8; font-size: 12px; line-height: 1.5; text-align: center;">
                Este correo fue enviado automáticamente por el sistema de Cotransmeq.<br/>
                Si tienes dudas, contacta al administrador.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

    try {
      const bcc = env.NOTIF_BCC_EMAIL ? [env.NOTIF_BCC_EMAIL] : undefined
      const data = await sendEmail({
        from: 'Cotransmeq <noreply@transmeralda.com>',
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
