import { readFile } from 'fs/promises'
import path from 'path'
import { prisma } from '../../config/prisma'
import { env } from '../../config/env'
import { EmailService, type EmailAttachment } from '../../services/email.service'
import { emitirTokenPortal } from '../conductor-portal/portal-token.service'

const GUIA_DIR = path.resolve(process.cwd(), 'src/assets/email/formularios')
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const PASOS = [
  {
    archivo: 'guia-01-formularios.jpeg',
    cid: 'guia-portal-paso-1',
    titulo: '1. Consulte sus formularios',
    texto: 'Al abrir su enlace personal llegará a Formularios. Allí verá únicamente los formatos asignados y el estado de cada borrador. “Todo sincronizado” confirma que la información guardada ya está al día.'
  },
  {
    archivo: 'guia-02-preoperacional.jpeg',
    cid: 'guia-portal-paso-2',
    titulo: '2. Abra el preoperacional y confirme el vehículo',
    texto: 'Seleccione el formulario correspondiente y verifique la placa antes de responder. Lea completamente las instrucciones. Los botones Guardar y Enviar permanecen disponibles en la parte inferior.'
  },
  {
    archivo: 'guia-03-diligenciamiento.jpeg',
    cid: 'guia-portal-paso-3',
    titulo: '3. Revise físicamente y marque cada estado',
    texto: 'Use Bueno, Malo o No aplica según lo que realmente encuentre. Cuando marque Malo aparecerá una observación obligatoria: describa el hallazgo concreto y agregue la evidencia solicitada.'
  },
  {
    archivo: 'guia-04-desprendibles.jpeg',
    cid: 'guia-portal-paso-4',
    titulo: '4. Consulte sus desprendibles y primas',
    texto: 'En Desprendibles puede consultar, firmar y descargar los comprobantes de nómina o liquidaciones de prima que estén disponibles para usted.'
  },
  {
    archivo: 'guia-05-servicios.jpeg',
    cid: 'guia-portal-paso-5',
    titulo: '5. Consulte sus servicios',
    texto: 'En Servicios encontrará los recorridos asignados, con fecha, vehículo, cliente y estado. Use la búsqueda cuando necesite localizar uno rápidamente.'
  },
  {
    archivo: 'guia-06-dias-laborados.jpeg',
    cid: 'guia-portal-paso-6',
    titulo: '6. Registre sus días laborados',
    texto: 'En Días puede registrar su actividad diaria. Toque el día correspondiente y seleccione con cuidado si fue laborado, disponible, descanso o mantenimiento.'
  }
] as const

export interface AudienciaCampana {
  conductorId: string
  nombre: string
  apellido: string
  numeroIdentificacion: string
  email: string
}

export interface PeriodoCampana {
  periodo: string
  inicio: string
  fin: string
}

function escapar(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function frontendUrl(): string {
  const configured = env.EMAIL_FRONTEND_URL || env.FRONTEND_URL || 'http://localhost:5173'
  return configured.split(',')[0].trim().replace(/\/+$/, '')
}

/** Periodo calendario anterior en America/Bogota, expresado como YYYY-MM. */
export function periodoAnterior(now = new Date()): PeriodoCampana {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota', year: 'numeric', month: '2-digit'
  }).formatToParts(now)
  let year = Number(parts.find((part) => part.type === 'year')?.value)
  let month = Number(parts.find((part) => part.type === 'month')?.value) - 1
  if (month === 0) { year -= 1; month = 12 }
  return resolverPeriodo(`${year}-${String(month).padStart(2, '0')}`)
}

export function resolverPeriodo(periodo?: string): PeriodoCampana {
  const value = periodo || periodoAnterior().periodo
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value)
  if (!match) throw new Error('El periodo debe tener formato YYYY-MM.')
  const year = Number(match[1])
  const month = Number(match[2])
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return {
    periodo: value,
    inicio: `${value}-01`,
    fin: `${value}-${String(lastDay).padStart(2, '0')}`
  }
}

/**
 * Conductores únicos con una liquidación cuyo periodo cruza el mes solicitado.
 * Se excluyen eliminados, ocultos y registros sin un correo utilizable.
 */
export async function listarAudiencia(periodo?: string): Promise<{ periodo: PeriodoCampana; destinatarios: AudienciaCampana[] }> {
  const rango = resolverPeriodo(periodo)
  const liquidaciones = await prisma.liquidaciones.findMany({
    where: {
      conductor_id: { not: null },
      periodo_start: { lte: rango.fin },
      periodo_end: { gte: rango.inicio },
      conductores: {
        is: { deleted_at: null, oculto: false, email: { not: null } }
      }
    },
    distinct: ['conductor_id'],
    select: {
      conductores: {
        select: { id: true, nombre: true, apellido: true, numero_identificacion: true, email: true }
      }
    }
  })

  const destinatarios = liquidaciones
    .map((item) => item.conductores)
    .filter((conductor): conductor is NonNullable<typeof conductor> => Boolean(conductor?.email && EMAIL_RE.test(conductor.email)))
    .map((conductor) => ({
      conductorId: conductor.id,
      nombre: conductor.nombre,
      apellido: conductor.apellido,
      numeroIdentificacion: conductor.numero_identificacion,
      email: conductor.email!
    }))
    .sort((a, b) => `${a.apellido} ${a.nombre}`.localeCompare(`${b.apellido} ${b.nombre}`, 'es'))

  return { periodo: rango, destinatarios }
}

export function renderizarGuia(params: { nombre: string; portalLink: string }): string {
  const nombre = escapar(params.nombre.trim() || 'Conductor')
  const portalLink = escapar(params.portalLink)
  const logoUrl = escapar(env.EMAIL_LOGO_URL || 'https://transmeralda.s3.us-east-2.amazonaws.com/assets/cotransmeq.png')
  const pasos = PASOS.map((paso) => `
    <tr><td style="padding:0 24px 24px">
      <p style="margin:0 0 8px;color:#0f172a;font-size:17px;font-weight:700">${paso.titulo}</p>
      <p style="margin:0 0 12px;color:#475569;font-size:14px;line-height:1.55">${paso.texto}</p>
      <img src="cid:${paso.cid}" alt="${paso.titulo}" width="520" style="display:block;width:100%;max-width:520px;height:auto;border:1px solid #dbe4ea;border-radius:12px" />
    </td></tr>`).join('')

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;background:#eef3f1;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef3f1"><tr><td align="center" style="padding:24px 10px">
  <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;background:#fff;border-radius:18px;overflow:hidden">
    <tr><td align="center" style="padding:26px 24px;background:#ea580c"><img src="${logoUrl}" alt="Cotransmeq" width="168" style="max-width:168px;height:auto"><h1 style="margin:18px 0 4px;color:#fff;font-size:24px">Guía del Portal del Conductor</h1><p style="margin:0;color:#ffedd5;font-size:14px">Formularios, nómina, servicios y días laborados</p></td></tr>
    <tr><td style="padding:26px 24px 18px"><p style="margin:0 0 12px;font-size:17px">Señor(a) <strong>${nombre}</strong>:</p><p style="margin:0;color:#475569;font-size:15px;line-height:1.6">Cotransmeq pone a su disposición el Portal del Conductor para diligenciar formularios, consultar sus comprobantes y revisar información de la operación. Esta guía utiliza como ejemplo el preoperacional de vehículos y explica también los demás apartados del portal.</p></td></tr>
    <tr><td style="padding:0 24px 24px">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px">
        <tr>
          <td width="42" valign="top" style="padding:16px 0 16px 16px;color:#a16207;font-size:20px;line-height:1">ℹ</td>
          <td style="padding:14px 16px 14px 8px">
            <p style="margin:0 0 5px;color:#854d0e;font-size:14px;font-weight:700;line-height:1.4">Cambio de aplicación desde el día 21</p>
            <p style="margin:0;color:#713f12;font-size:13px;line-height:1.55">A partir del día 21, la aplicación que se venía utilizando, <strong>Koco Collect</strong>, quedará inhabilitada. Desde esa fecha deberá utilizar esta alternativa propia de Cotransmeq para diligenciar sus formularios y consultar la información disponible en el Portal del Conductor.</p>
          </td>
        </tr>
      </table>
    </td></tr>
    <tr><td align="center" style="padding:4px 24px 28px"><a href="${portalLink}" target="_blank" style="display:inline-block;background:#ea580c;color:#fff;text-decoration:none;font-size:17px;font-weight:700;padding:15px 28px;border-radius:10px">Abrir mi Portal del Conductor</a><p style="margin:12px 0 0;color:#64748b;font-size:12px;line-height:1.45">Este botón es personal. No comparta ni reenvíe este correo.</p></td></tr>
    ${pasos}
    <tr><td style="padding:0 24px 24px"><div style="background:#ecfdf5;border-radius:12px;padding:16px;color:#065f46;font-size:13px;line-height:1.55"><strong>Si pierde la señal:</strong> continúe diligenciando. El portal guarda el borrador en el teléfono y lo sincroniza cuando regresa la conexión. No borre los datos del navegador ni use modo incógnito mientras tenga un formulario pendiente.</div></td></tr>
    <tr><td style="padding:0 24px 28px"><p style="margin:0 0 8px;color:#334155;font-size:13px;line-height:1.5"><strong>Importante:</strong> si marca un elemento como Malo, describa la novedad y siga el procedimiento de Reporte de Falla. Envíe el formulario solo cuando la revisión esté completa.</p><p style="margin:0;color:#64748b;font-size:12px;line-height:1.5">El enlace tiene vigencia de 30 días. Si vence, solicite uno nuevo desde la pantalla de acceso al portal.</p></td></tr>
    <tr><td style="padding:20px 24px;background:#f8fafc;border-top:1px solid #e2e8f0;text-align:center;color:#64748b;font-size:12px">Mensaje institucional de Cotransmeq · Seguridad, trazabilidad y cuidado del vehículo</td></tr>
  </table></td></tr></table></body></html>`
}

async function adjuntosGuia(): Promise<EmailAttachment[]> {
  return Promise.all(PASOS.map(async (paso) => ({
    filename: paso.archivo,
    content: await readFile(path.join(GUIA_DIR, paso.archivo)),
    contentType: 'image/jpeg',
    contentId: paso.cid
  })))
}

export async function enviarGuia(destinatario: AudienciaCampana, overrideTo?: string) {
  const token = await emitirTokenPortal({
    id: destinatario.conductorId,
    numero_identificacion: destinatario.numeroIdentificacion,
    nombre: destinatario.nombre,
    apellido: destinatario.apellido
  })
  const portalLink = `${frontendUrl()}/public/portal?token=${encodeURIComponent(token)}`
  return EmailService.sendEmail({
    to: [overrideTo || destinatario.email],
    subject: 'Guía para usar el Portal del Conductor — Cotransmeq',
    html: renderizarGuia({ nombre: `${destinatario.nombre} ${destinatario.apellido}`, portalLink }),
    attachments: await adjuntosGuia()
  })
}

export async function enviarCampana(periodo: string, confirmacion: string) {
  const audiencia = await listarAudiencia(periodo)
  const esperada = `ENVIAR_GUIA_FORMULARIOS_${audiencia.periodo.periodo}`
  if (confirmacion !== esperada) throw new Error(`Confirmación inválida. Se requiere ${esperada}.`)

  const resultados: Array<{ conductorId: string; email: string; ok: boolean; error?: string }> = []
  for (const destinatario of audiencia.destinatarios) {
    try {
      await enviarGuia(destinatario)
      resultados.push({ conductorId: destinatario.conductorId, email: destinatario.email, ok: true })
    } catch (error) {
      resultados.push({ conductorId: destinatario.conductorId, email: destinatario.email, ok: false, error: error instanceof Error ? error.message : 'Error desconocido' })
    }
    await new Promise((resolve) => setTimeout(resolve, 600))
  }
  return { periodo: audiencia.periodo, total: resultados.length, enviados: resultados.filter((r) => r.ok).length, fallidos: resultados.filter((r) => !r.ok).length, resultados }
}

export async function destinatarioPorId(conductorId: string): Promise<AudienciaCampana> {
  const conductor = await prisma.conductores.findFirst({
    where: { id: conductorId, deleted_at: null },
    select: { id: true, nombre: true, apellido: true, numero_identificacion: true, email: true }
  })
  if (!conductor?.email) throw new Error('El conductor no existe o no tiene correo registrado.')
  return { conductorId: conductor.id, nombre: conductor.nombre, apellido: conductor.apellido, numeroIdentificacion: conductor.numero_identificacion, email: conductor.email }
}
