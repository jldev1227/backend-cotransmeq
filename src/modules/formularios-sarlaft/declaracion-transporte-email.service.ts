/**
 * Entrega al declarante de la copia de su declaración — COTRANSMEQ S.A.S.
 *
 * Está separado de `notificarOficialCumplimiento` a propósito: son dos correos
 * con destinatarios, contenido y adjuntos distintos, y mezclarlos es
 * exactamente como se filtran anexos internos hacia afuera.
 *
 * Lo que este correo lleva:  el PDF generado, y nada más.
 * Lo que NO lleva:           cédulas, RUT, anexo de alertas, firma como PNG
 *                            suelto, IP, user agent ni notas internas.
 */
import { EmailService } from '../../services/email.service'
import {
  avisoSandboxHtml,
  copiaDeclaranteHabilitada,
  resolverDestino
} from './sarlaft-email-mode'
import {
  DeclaracionTransporteDocumentosService,
  type EstadoEntrega
} from './declaracion-transporte-documentos.service'

const EMPRESA = 'COTRANSMEQ S.A.S.'
/** Naranja Cotransmeq — los mismos tokens del PDF y del correo interno.
 *  No usar el verde de la otra marca. */
const COLOR_PRIMARIO = '#f97316'
const COLOR_TITULO = '#9a3412'

export interface CopiaDeclaranteArgs {
  documentoGeneradoId: string
  /** Correo confirmado por el declarante. Único destinatario en producción. */
  destinatario: string
  radicado: string
  codigoFormulario: string
  versionFormato: string
  razonSocial: string | null
  pdf: Buffer
  nombreArchivo: string
  pdfSha256: string
  /** Enlace temporal de descarga, si se generó. */
  descarga?: { url: string; expiresAt: Date } | null
}

export interface ResultadoEntrega {
  estado: EstadoEntrega
  destinatario_enmascarado: string
  provider_message_id: string | null
  proveedor: string | null
}

/** Escapa texto antes de meterlo en el HTML del correo. */
function esc(valor: unknown): string {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function enmascarar(correo: string): string {
  const [usuario, dominio] = (correo ?? '').split('@')
  if (!dominio) return '***'
  return `${usuario.slice(0, 2)}${'*'.repeat(Math.max(1, usuario.length - 2))}@${dominio}`
}

/** Proveedor activo, para dejarlo en la trazabilidad de la entrega. */
function proveedorActivo(): string {
  return process.env.RESEND_API_KEY ? 'resend' : 'smtp'
}

export const DeclaracionTransporteEmailService = {
  /**
   * Envía al declarante su copia y registra el intento.
   *
   * Nunca lanza: una falla de correo no puede tumbar un radicado ya creado ni
   * borrar el documento archivado. Devuelve el estado para que la respuesta
   * del POST lo informe y el reintento quede disponible.
   */
  async entregarCopiaDeclarante(args: CopiaDeclaranteArgs): Promise<ResultadoEntrega> {
    const enmascarado = enmascarar(args.destinatario)

    if (!copiaDeclaranteHabilitada()) {
      return {
        estado: 'pendiente',
        destinatario_enmascarado: enmascarado,
        provider_message_id: null,
        proveedor: null
      }
    }

    // En sandbox el destino se sustituye por el buzón de pruebas. El correo del
    // declarante nunca se usa como copia oculta ni se filtra al cuerpo sin
    // enmascarar.
    const destino = resolverDestino([args.destinatario])
    const asunto =
      `${destino.prefijoAsunto}${EMPRESA} · ${args.codigoFormulario} — ` +
      `Copia de tu declaración · Radicado ${args.radicado}`

    const html = this.construirHtml(args, destino)
    const proveedor = proveedorActivo()

    try {
      const res = await EmailService.sendEmail({
        to: destino.to,
        subject: asunto,
        html,
        // Solo el PDF generado. Ningún anexo del declarante ni interno.
        attachments: [
          {
            filename: args.nombreArchivo,
            content: args.pdf,
            contentType: 'application/pdf'
          }
        ],
        bcc: undefined
      })
      const messageId = (res as { id?: string } | null)?.id ?? null

      await DeclaracionTransporteDocumentosService.registrarEntrega({
        documentoGeneradoId: args.documentoGeneradoId,
        canal: 'email_declarante',
        destinatario: args.destinatario,
        estado: 'enviado',
        proveedor,
        providerMessageId: messageId
      })

      return {
        estado: 'enviado',
        destinatario_enmascarado: enmascarado,
        provider_message_id: messageId,
        proveedor
      }
    } catch (err) {
      // Se registra el código, no el mensaje completo: el error del proveedor
      // puede traer la dirección de destino.
      const codigo = (err as { code?: string })?.code ?? 'ENVIO_FALLIDO'
      console.error(
        `[DeclaracionTransporte] Falló la copia al declarante del radicado ${args.radicado} ` +
          `(${enmascarado}): ${codigo}`
      )
      await DeclaracionTransporteDocumentosService.registrarEntrega({
        documentoGeneradoId: args.documentoGeneradoId,
        canal: 'email_declarante',
        destinatario: args.destinatario,
        estado: 'fallido',
        proveedor,
        errorCodigo: String(codigo).slice(0, 80)
      }).catch(() => {})

      return {
        estado: 'fallido',
        destinatario_enmascarado: enmascarado,
        provider_message_id: null,
        proveedor
      }
    }
  },

  /** Cuerpo del correo. Sin datos internos y sin branding de otra empresa. */
  construirHtml(
    args: CopiaDeclaranteArgs,
    destino: ReturnType<typeof resolverDestino>
  ): string {
    const vence = args.descarga
      ? new Date(args.descarga.expiresAt).toLocaleString('es-CO', {
          timeZone: 'America/Bogota',
          dateStyle: 'long',
          timeStyle: 'short'
        })
      : null

    return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8" /></head>
<body style="margin:0;padding:0;background:#FCFCFB;font-family:-apple-system,'Segoe UI',Roboto,sans-serif;color:#0F172A;line-height:1.5;">
  <div style="max-width:640px;margin:0 auto;padding:24px;">
    <div style="background:#ffffff;border-radius:16px;padding:24px;box-shadow:0 4px 24px rgba(0,0,0,0.05);border:1px solid #E4E4E0;">
      ${avisoSandboxHtml(destino)}
      <span style="display:inline-block;background:${COLOR_PRIMARIO};color:#fff;font-size:11px;font-weight:700;padding:4px 10px;border-radius:6px;letter-spacing:.05em;">
        ${esc(args.codigoFormulario)} · v${esc(args.versionFormato)}
      </span>
      <h1 style="font-size:18px;margin:12px 0 4px;color:${COLOR_TITULO};">Recibimos tu declaración</h1>
      <p style="color:#6b7280;font-size:13px;margin:0;">
        Adjuntamos la copia del documento que diligenciaste y firmaste.
      </p>

      <table style="width:100%;border-collapse:collapse;margin-top:16px;">
        <tr>
          <td style="padding:8px 0;font-size:13px;color:#6b7280;width:190px;">Radicado</td>
          <td style="padding:8px 0;font-size:13px;color:#111827;font-weight:600;">${esc(args.radicado)}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;font-size:13px;color:#6b7280;">Empresa declarante</td>
          <td style="padding:8px 0;font-size:13px;color:#111827;font-weight:600;">${esc(args.razonSocial ?? '—')}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;font-size:13px;color:#6b7280;">Estado</td>
          <td style="padding:8px 0;font-size:13px;color:#111827;font-weight:600;">Recibido</td>
        </tr>
        <tr>
          <td style="padding:8px 0;font-size:13px;color:#6b7280;">Fecha</td>
          <td style="padding:8px 0;font-size:13px;color:#111827;font-weight:600;">
            ${new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'long', timeStyle: 'short' })}
          </td>
        </tr>
        <tr>
          <td style="padding:8px 0;font-size:13px;color:#6b7280;vertical-align:top;">Huella SHA-256 del PDF</td>
          <td style="padding:8px 0;font-size:11px;color:#111827;font-family:ui-monospace,Menlo,monospace;word-break:break-all;">${esc(args.pdfSha256)}</td>
        </tr>
      </table>

      ${
        args.descarga
          ? `<p style="margin-top:16px;font-size:13px;">
               <a href="${esc(args.descarga.url)}" style="display:inline-block;padding:10px 20px;background:${COLOR_PRIMARIO};color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">
                 Descargar copia
               </a>
             </p>
             <p style="font-size:12px;color:#9ca3af;margin-top:4px;">
               El enlace vence el ${esc(vence)}. Después de esa fecha conserva el PDF adjunto.
             </p>`
          : ''
      }

      <p style="margin-top:24px;font-size:13px;color:#6b7280;">
        Conserva el número de radicado: es el dato con el que puedes consultar el
        estado de tu declaración. La huella SHA-256 te permite verificar que el PDF
        que recibiste es exactamente el que quedó archivado.
      </p>
      <p style="margin-top:8px;font-size:12px;color:#9ca3af;">
        Esta declaración queda en revisión del Oficial de Cumplimiento. Si se requiere
        alguna aclaración te contactaremos por este mismo correo.
      </p>

      <div style="margin-top:24px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:12px;color:#9ca3af;">
        ${EMPRESA} — Sistema de cumplimiento SARLAFT + PTEE<br />
        Resolución 2328 de 2025 · Resolución 14673 de 2025 · Ley 1581 de 2012
      </div>
    </div>
  </div>
</body>
</html>`
  }
}
