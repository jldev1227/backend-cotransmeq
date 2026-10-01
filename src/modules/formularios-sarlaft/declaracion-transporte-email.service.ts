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
import { bloqueParrafo, renderCorreo } from '../../services/email-plantilla'
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
    const fecha = new Date().toLocaleString('es-CO', {
      timeZone: 'America/Bogota',
      dateStyle: 'long',
      timeStyle: 'short'
    })

    return renderCorreo({
      preheader: `Copia de tu declaración · Radicado ${args.radicado}`,
      eyebrow: `${esc(args.codigoFormulario)} · v${esc(args.versionFormato)}`,
      titulo: 'Recibimos tu declaración',
      subtitulo: 'Adjuntamos la copia del documento que diligenciaste y firmaste.',
      mascota: 'todo-bien',
      encabezadoHtml: avisoSandboxHtml(destino),
      datos: {
        filas: [
          { etiqueta: 'Radicado', valor: esc(args.radicado) },
          { etiqueta: 'Empresa declarante', valor: esc(args.razonSocial ?? '—') },
          { etiqueta: 'Estado', valor: 'Recibido' },
          { etiqueta: 'Fecha', valor: esc(fecha) },
          { etiqueta: 'Huella SHA-256 del PDF', valor: esc(args.pdfSha256), mono: true }
        ]
      },
      boton: args.descarga ? { texto: 'Descargar copia', url: args.descarga.url } : undefined,
      notas: args.descarga
        ? [{ tono: 'neutro', html: `El enlace vence el ${esc(vence)}${vence?.endsWith('.') ? '' : '.'} Después de esa fecha conserva el PDF adjunto.` }]
        : [],
      html:
        bloqueParrafo(
          'Conserva el número de radicado: es el dato con el que puedes consultar el estado de tu declaración. La huella SHA-256 te permite verificar que el PDF que recibiste es exactamente el que quedó archivado.',
          { muted: true }
        ) +
        bloqueParrafo(
          'Esta declaración queda en revisión del Oficial de Cumplimiento. Si se requiere alguna aclaración te contactaremos por este mismo correo.',
          { muted: true }
        ),
      pie: [
        `${EMPRESA} — Sistema de cumplimiento SARLAFT + PTEE`,
        'Resolución 2328 de 2025 · Resolución 14673 de 2025 · Ley 1581 de 2012'
      ]
    })
  }
}
