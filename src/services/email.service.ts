import { Resend } from 'resend'
import { env } from '../config/env'

let _resend: Resend | null = null

function getResend(): Resend {
  if (!_resend) {
    if (!env.RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY no está configurada. El servicio de email no está disponible.')
    }
    _resend = new Resend(env.RESEND_API_KEY)
  }
  return _resend
}

interface SendMagicLinkParams {
  to: string
  conductorNombre: string
  conductorApellido: string
  token: string
}

// ═══════════════════════════════════════════════════════
// COTRANSMEQ — Colores: Azul #1e40af (primary), #1d4ed8 (secondary)
// Logo: /assets/cotransmeq-logo.png
// NIT: 900.123.456-7
// ═══════════════════════════════════════════════════════

export const EmailService = {

  async sendMagicLink({ to, conductorNombre, conductorApellido, token }: SendMagicLinkParams) {
    const frontendUrl = env.FRONTEND_URL || 'http://localhost:5173'
    const magicLink = `${frontendUrl}/public/dias-laborados?token=${token}`
    const nombreCompleto = `${conductorNombre} ${conductorApellido}`
    const logoUrl = env.EMAIL_LOGO_URL || 'https://transmeralda.s3.us-east-2.amazonaws.com/assets/cotransmeq.png'

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
          <tr>
            <td style="background: linear-gradient(135deg, #1e40af 0%, #1d4ed8 100%); padding:32px 32px 24px 32px; text-align:center;">
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
          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 8px 0;color:#475569;font-size:15px;line-height:1.5;">Hola,</p>
              <p style="margin:0 0 24px 0;color:#0f172a;font-size:18px;font-weight:700;line-height:1.3;">${nombreCompleto}</p>
              <p style="margin:0 0 28px 0;color:#475569;font-size:15px;line-height:1.6;">
                Has solicitado acceso al sistema de <strong>Reporte Diario de Actividad</strong>. Haz clic en el botón para ingresar de forma segura.
              </p>
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                <tr>
                  <td align="center">
                    <a href="${magicLink}" target="_blank" style="display:inline-block;background-color:#1e40af;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;padding:14px 40px;border-radius:10px;line-height:1.4;">
                      Ingresar al sistema →
                    </a>
                  </td>
                </tr>
              </table>
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-top:28px;">
                <tr>
                  <td style="background-color:#eff6ff;border-radius:10px;padding:16px 20px;">
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                      <tr>
                        <td width="28" valign="top" style="font-size:18px;">🔒</td>
                        <td style="color:#1e3a8a;font-size:13px;line-height:1.5;">
                          Este enlace es válido por <strong>30 días</strong>. Después de ese período deberás solicitar un nuevo acceso.
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              <p style="margin:24px 0 0 0;color:#94a3b8;font-size:12px;line-height:1.5;">Si el botón no funciona, copia y pega este enlace en tu navegador:</p>
              <p style="margin:4px 0 0 0;word-break:break-all;">
                <a href="${magicLink}" style="color:#1e40af;font-size:12px;text-decoration:underline;">${magicLink}</a>
              </p>
            </td>
          </tr>
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
      const { data, error } = await getResend().emails.send({
        from: 'Cotransmeq <noreply@transmeralda.com>',
        to: [to],
        subject: '🚛 Acceso al Reporte Diario — Cotransmeq',
        html
      })

      if (error) {
        console.error('[EmailService] Error enviando email:', error)
        throw new Error(`Error enviando email: ${error.message}`)
      }

      console.log('[EmailService] Email enviado exitosamente:', data?.id)
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
    const logoUrl = env.EMAIL_LOGO_URL || 'https://transmeralda.s3.us-east-2.amazonaws.com/assets/cotransmeq.png'

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
          <tr>
            <td style="background: linear-gradient(135deg, #1e40af 0%, #1d4ed8 100%); padding:32px 32px 24px 32px; text-align:center;">
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
          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 8px 0;color:#475569;font-size:15px;line-height:1.5;">Hola,</p>
              <p style="margin:0 0 24px 0;color:#0f172a;font-size:18px;font-weight:700;line-height:1.3;">${nombreCompleto}</p>
              <p style="margin:0 0 28px 0;color:#475569;font-size:15px;line-height:1.6;">
                Has solicitado acceso al <strong>Portal del Conductor</strong>. Desde aquí podrás consultar tus <strong>desprendibles de nómina</strong> y registrar tu <strong>actividad diaria</strong>.
              </p>
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                <tr>
                  <td align="center">
                    <a href="${portalLink}" target="_blank" style="display:inline-block;background-color:#1e40af;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;padding:14px 40px;border-radius:10px;line-height:1.4;">
                      Ingresar al Portal →
                    </a>
                  </td>
                </tr>
              </table>
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-top:28px;">
                <tr>
                  <td style="background-color:#eff6ff;border-radius:10px;padding:16px 20px;">
                    <p style="margin:0 0 8px 0;color:#1e3a8a;font-size:14px;font-weight:700;">📋 Desde tu portal puedes:</p>
                    <p style="margin:0 0 4px 0;color:#1e3a8a;font-size:13px;">📄 Ver y descargar tus desprendibles de nómina</p>
                    <p style="margin:0;color:#1e3a8a;font-size:13px;">📅 Registrar tu actividad diaria (días laborados)</p>
                  </td>
                </tr>
              </table>
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-top:16px;">
                <tr>
                  <td style="background-color:#eff6ff;border-radius:10px;padding:12px 20px;">
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                      <tr>
                        <td width="28" valign="top" style="font-size:18px;">🔒</td>
                        <td style="color:#1e3a8a;font-size:13px;line-height:1.5;">
                          Este enlace es válido por <strong>30 días</strong>. Después deberás solicitar un nuevo acceso.
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              <p style="margin:24px 0 0 0;color:#94a3b8;font-size:12px;line-height:1.5;">Si el botón no funciona, copia y pega este enlace:</p>
              <p style="margin:4px 0 0 0;word-break:break-all;">
                <a href="${portalLink}" style="color:#1e40af;font-size:12px;text-decoration:underline;">${portalLink}</a>
              </p>
            </td>
          </tr>
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
      const { data, error } = await getResend().emails.send({
        from: 'Cotransmeq <noreply@transmeralda.com>',
        to: [to],
        subject: '📋 Acceso al Portal del Conductor — Cotransmeq',
        html
      })

      if (error) {
        console.error('[EmailService] Error enviando email portal:', error)
        throw new Error(`Error enviando email: ${error.message}`)
      }

      console.log('[EmailService] Email portal enviado exitosamente:', data?.id)
      return data
    } catch (err) {
      console.error('[EmailService] Error:', err)
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
    const logoUrl = env.EMAIL_LOGO_URL || 'https://transmeralda.s3.us-east-2.amazonaws.com/assets/cotransmeq.png'

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
          <tr>
            <td style="background: linear-gradient(135deg, #1e40af 0%, #1d4ed8 100%); padding:32px 32px 24px 32px; text-align:center;">
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
          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 8px 0;color:#475569;font-size:15px;line-height:1.5;">Hola,</p>
              <p style="margin:0 0 24px 0;color:#0f172a;font-size:18px;font-weight:700;line-height:1.3;">${conductorNombre}</p>
              <p style="margin:0 0 28px 0;color:#475569;font-size:15px;line-height:1.6;">
                Tu desprendible de nómina correspondiente al periodo <strong>${periodo}</strong> ya está disponible para consulta.
              </p>
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                <tr>
                  <td align="center">
                    <a href="${portalLink}" target="_blank" style="display:inline-block;background-color:#1e40af;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;padding:14px 40px;border-radius:10px;line-height:1.4;">
                      📄 Ver Desprendible →
                    </a>
                  </td>
                </tr>
              </table>
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-top:28px;">
                <tr>
                  <td style="background-color:#eff6ff;border-radius:10px;padding:16px 20px;">
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                      <tr>
                        <td width="28" valign="top" style="font-size:18px;">📋</td>
                        <td style="color:#1e3a8a;font-size:13px;line-height:1.5;">
                          Desde tu portal podrás <strong>ver, descargar y firmar</strong> tu desprendible de nómina.
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
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
      const { data, error } = await getResend().emails.send({
        from: 'Cotransmeq <noreply@transmeralda.com>',
        to: [to],
        subject: `📄 Tu Desprendible de Nómina — ${periodo}`,
        html
      })

      if (error) {
        console.error('[EmailService] Error enviando desprendible email:', error)
        throw new Error(`Error enviando email: ${error.message}`)
      }

      console.log('[EmailService] Desprendible email enviado exitosamente:', data?.id)
      return data
    } catch (err) {
      console.error('[EmailService] Error:', err)
      throw err
    }
  }
}
