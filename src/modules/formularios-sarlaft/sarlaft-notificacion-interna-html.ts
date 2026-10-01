/**
 * Cuerpo del correo interno que avisa al Oficial de Cumplimiento de un nuevo
 * formulario SARLAFT/PTEE. Es una función pura (sin Prisma ni S3) para poder
 * previsualizarla y probarla sin levantar el servicio completo.
 */
import {
  bloqueParrafo,
  escaparHtml,
  renderCorreo,
  type FilaDato
} from '../../services/email-plantilla'
import { avisoSandboxHtml, type DestinoCorreo } from './sarlaft-email-mode'

const EMPRESA = 'COTRANSMEQ S.A.S.'

export interface NotificacionInternaSarlaft {
  destino: DestinoCorreo
  serie: 'SARLAFT' | 'PTEE'
  codigoFormulario: string
  tipoLabel: string
  areaResponsable: string
  radicado: string
  /** Ya formateada para mostrar. */
  fechaEnvio: string
  titular: string
  documento: string
  correo: string
  telefono: string
  ipOrigen: string
  adjuntos: number
  documentoGenerado?: {
    codigo_template: string
    version_template: string | number
    version_documento: string | number
    estado_documental: string
    pdf_sha256: string
  } | null
  dashboardLink: string
}

export function htmlNotificacionInternaSarlaft(p: NotificacionInternaSarlaft): string {
  const filas: FilaDato[] = [
    { etiqueta: 'Radicado', valor: escaparHtml(p.radicado) },
    { etiqueta: 'Fecha de envío', valor: escaparHtml(p.fechaEnvio) },
    { etiqueta: 'Titular', valor: escaparHtml(p.titular) },
    { etiqueta: 'Documento', valor: escaparHtml(p.documento) },
    { etiqueta: 'Correo de contacto', valor: escaparHtml(p.correo) },
    { etiqueta: 'Teléfono', valor: escaparHtml(p.telefono) },
    { etiqueta: 'IP de origen', valor: escaparHtml(p.ipOrigen) },
    { etiqueta: 'Adjuntos', valor: `${p.adjuntos} archivo${p.adjuntos === 1 ? '' : 's'}` }
  ]
  if (p.documentoGenerado) {
    const d = p.documentoGenerado
    filas.push(
      {
        etiqueta: 'Documento generado',
        valor: escaparHtml(
          `${d.codigo_template} v${d.version_template} · versión documental ${d.version_documento} (${d.estado_documental})`
        )
      },
      { etiqueta: 'SHA-256 del PDF', valor: escaparHtml(d.pdf_sha256), mono: true }
    )
  }

  return renderCorreo({
    preheader: `Nuevo formulario ${p.serie} ${p.codigoFormulario} · Radicado ${p.radicado}`,
    eyebrow: `${escaparHtml(p.serie)} · ${escaparHtml(p.codigoFormulario)}`,
    titulo: 'Nuevo formulario recibido',
    subtitulo: `Tipo: ${escaparHtml(p.tipoLabel)} · Área responsable: ${escaparHtml(p.areaResponsable)}`,
    mascota: 'esperando',
    encabezadoHtml: avisoSandboxHtml(p.destino),
    parrafos: ['Un titular acaba de radicar un formulario SARLAFT + PTEE y queda pendiente de revisión.'],
    datos: { titulo: 'Datos del radicado', filas },
    boton: { texto: 'Ver en el dashboard', url: p.dashboardLink },
    html: bloqueParrafo(
      'Se adjuntan el PDF con las respuestas diligenciadas y los archivos originales proporcionados por el titular. Asimismo, la información suministrada en el formulario ha sido almacenada de forma segura y se encuentra disponible en el sistema interno de cumplimiento para su consulta, revisión y seguimiento cuando sea necesario.',
      { muted: true }
    ),
    pie: [
      `${EMPRESA} — Sistema de cumplimiento SARLAFT + PTEE`,
      'Resolución 2328 de 2025 · Resolución 14673 de 2025 · Ley 1581 de 2012'
    ]
  })
}
