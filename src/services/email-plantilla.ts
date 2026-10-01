/**
 * Plantilla base de TODOS los correos que envía el sistema.
 *
 * Replica el lenguaje visual de la app móvil (PortalHero + Card): tarjeta
 * blanca de esquinas redondeadas sobre el fondo crema, un «hero» en el verde
 * bosque de marca con eyebrow en mayúsculas, título grande y texto de apoyo,
 * y la mascota a la derecha. El naranja queda para la acción (botón, enlaces).
 *
 * Reglas de compatibilidad (Gmail, Outlook, Apple Mail):
 *   - Solo tablas y CSS inline. Nada de flex/grid ni fuentes externas.
 *   - Ancho fijo de 600 px, `bgcolor` en las celdas de color (Outlook ignora
 *     los degradados, así que el color sólido va siempre como respaldo).
 *   - Las imágenes van por URL pública absoluta. Ni `cid:` ni base64: Gmail
 *     bloquea las segundas y las primeras obligan a adjuntar.
 *
 * La mascota se sirve desde la web pública como PNG
 * (`${FRONTEND_URL}/mascot/png/<reaccion>.png`): el webp que usa la web no se
 * ve en Outlook ni en varios clientes de escritorio.
 */
import { env } from '../config/env'
import { LOGO_EMAIL_URL_POR_DEFECTO } from '../lib/branding'

export type MascotaReaccion =
  | 'saludando'
  | 'correo-enviado'
  | 'todo-bien'
  | 'celebrando'
  | 'trabajando'
  | 'alerta'
  | 'esperando'
  | 'pensando'
  | 'sin-resultados'

/** Identidad de la marca. Es el único bloque que cambia entre proyectos. */
export const MARCA = {
  nombre: 'Cotransmeq',
  razonSocial: 'Cotransmeq S.A.S.',
  /** Alto del logotipo en el correo; el PNG de cada marca trae márgenes distintos. */
  logoAlto: 56,
  logoPorDefecto: LOGO_EMAIL_URL_POR_DEFECTO,
  /** Verde bosque del hero (primaryDark de la app). */
  oscuro: '#14532d',
  /** Segundo tono del degradado del hero. */
  oscuro2: '#166534',
  /** Botón de acción y enlaces. */
  primario: '#ea580c',
  /** Fondo de los bloques de datos clave (primaryTint de la app). */
  tinte: '#ffedd5',
  /** Eyebrow sobre el hero. */
  eyebrow: '#fdba74',
  /** Texto de apoyo sobre el hero. */
  heroTexto: '#ffedd5',
  /** Fondo exterior del correo. */
  fondo: '#fff7ed',
  texto: '#0f172a',
  muted: '#64748b',
  borde: '#e2e8f0',
  /** Fondo del pie y de las notas neutras. */
  suave: '#f8fafc',
  /** Línea entre filas del bloque de datos. */
  separador: 'rgba(20,83,45,0.12)',
  peligro: '#b42318',
  peligroSuave: '#fff0ed',
  aviso: '#7a5c00',
  avisoSuave: '#fdf6d8'
} as const

const FUENTE =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
const MONO = "ui-monospace,Menlo,Consolas,'Courier New',monospace"

const ALT_MASCOTA: Record<MascotaReaccion, string> = {
  saludando: 'saludando',
  'correo-enviado': 'con un correo enviado',
  'todo-bien': 'confirmando que todo está bien',
  celebrando: 'celebrando',
  trabajando: 'trabajando',
  alerta: 'en alerta',
  esperando: 'esperando',
  pensando: 'pensando',
  'sin-resultados': 'sin resultados'
}

/** Escapa texto dinámico antes de meterlo en el HTML del correo. */
export function escaparHtml(valor: unknown): string {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

/** Texto plano de un usuario → HTML escapado con los saltos de línea. */
export function textoAHtml(valor: string): string {
  return escaparHtml(valor.trim()).replace(/\n/g, '<br/>')
}

/**
 * Origen público del frontend, para los recursos estáticos del correo.
 *
 * `FRONTEND_URL` puede traer varios orígenes separados por coma (CORS); se
 * toma el primero. Como respaldo, la URL dedicada a correos y, por último,
 * el localhost de desarrollo.
 */
export function origenFrontend(): string {
  const primero = (env.FRONTEND_URL ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)[0]
  if (primero) return primero.replace(/\/+$/, '')
  if (env.EMAIL_FRONTEND_URL?.trim()) return env.EMAIL_FRONTEND_URL.trim().replace(/\/+$/, '')
  return 'http://localhost:5173'
}

/** URL pública absoluta de la mascota en PNG. */
export function urlMascota(reaccion: MascotaReaccion): string {
  return `${origenFrontend()}/mascot/png/${reaccion}.png`
}

function urlLogo(): string {
  return env.EMAIL_LOGO_URL || MARCA.logoPorDefecto
}

// ───────────────────────────────────────────────────────────────────────────
// Bloques del cuerpo
// ───────────────────────────────────────────────────────────────────────────

export interface FilaDato {
  etiqueta: string
  /** Ya escapado por quien llama si viene de un usuario. */
  valor: string
  /** Cifra o dato principal: va más grande y en el color de marca. */
  destacado?: boolean
  /** Hashes, radicados largos: fuente monoespaciada y corte de palabra. */
  mono?: boolean
}

export interface BloqueDatos {
  titulo?: string
  filas: FilaDato[]
}

export type TonoNota = 'info' | 'alerta' | 'aviso' | 'neutro'

export interface Nota {
  /** HTML. */
  html: string
  tono?: TonoNota
}

/** Párrafo de texto corriente. `html` ya viene escapado. */
export function bloqueParrafo(html: string, opts: { muted?: boolean } = {}): string {
  const color = opts.muted ? MARCA.muted : MARCA.texto
  return `<p style="margin:0 0 16px 0;color:${color};font-family:${FUENTE};font-size:15px;line-height:24px;">${html}</p>`
}

/**
 * Mensaje escrito por una persona (nota del envío, mensaje personalizado).
 * Va como cita con barra lateral para distinguirlo del texto del sistema.
 */
export function bloqueCita(html: string): string {
  return `
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin:0 0 20px 0;">
  <tr>
    <td width="4" bgcolor="${MARCA.primario}" style="width:4px;background-color:${MARCA.primario};border-radius:4px;font-size:0;line-height:0;">&nbsp;</td>
    <td style="padding:2px 0 2px 16px;color:${MARCA.texto};font-family:${FUENTE};font-size:15px;line-height:24px;">${html}</td>
  </tr>
</table>`
}

/** Bloque de datos clave sobre el tinte de marca. */
export function bloqueDatos(datos: BloqueDatos): string {
  const filas = datos.filas.filter((f) => f && f.etiqueta)
  if (filas.length === 0) return ''
  const titulo = datos.titulo
    ? `<tr><td colspan="2" style="padding:0 0 10px 0;color:${MARCA.oscuro2};font-family:${FUENTE};font-size:11px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;">${datos.titulo}</td></tr>`
    : ''
  const cuerpo = filas
    .map((f, i) => {
      const ultimo = i === filas.length - 1
      const borde = ultimo ? '' : `border-bottom:1px solid ${MARCA.separador};`
      const valorEstilo = f.destacado
        ? `color:${MARCA.oscuro};font-size:20px;font-weight:900;letter-spacing:-0.3px;`
        : f.mono
          ? `color:${MARCA.texto};font-family:${MONO};font-size:11px;word-break:break-all;`
          : `color:${MARCA.texto};font-size:14px;font-weight:700;`
      return `
    <tr>
      <td valign="top" style="padding:9px 12px 9px 0;${borde}color:${MARCA.oscuro2};font-family:${FUENTE};font-size:13px;line-height:20px;white-space:nowrap;">${f.etiqueta}</td>
      <td valign="top" align="right" style="padding:9px 0;${borde}font-family:${FUENTE};line-height:20px;${valorEstilo}">${f.valor}</td>
    </tr>`
    })
    .join('')
  return `
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin:4px 0 20px 0;">
  <tr>
    <td bgcolor="${MARCA.tinte}" style="background-color:${MARCA.tinte};border-radius:16px;padding:14px 20px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">${titulo}${cuerpo}
      </table>
    </td>
  </tr>
</table>`
}

/** Botón de acción a todo el ancho, como el de la app. */
export function bloqueBoton(boton: { texto: string; url: string }): string {
  const url = escaparHtml(boton.url)
  return `
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin:4px 0 20px 0;">
  <tr>
    <td align="center" bgcolor="${MARCA.primario}" style="background-color:${MARCA.primario};border-radius:16px;">
      <a href="${url}" target="_blank" style="display:block;padding:16px 24px;color:#ffffff;font-family:${FUENTE};font-size:16px;font-weight:800;line-height:20px;text-decoration:none;border-radius:16px;">${boton.texto}</a>
    </td>
  </tr>
</table>`
}

/** Nota o aviso con tono. */
export function bloqueNota(nota: Nota): string {
  const tono = nota.tono ?? 'info'
  const estilos: Record<TonoNota, { fondo: string; texto: string; borde: string }> = {
    info: { fondo: MARCA.fondo, texto: MARCA.oscuro, borde: MARCA.tinte },
    alerta: { fondo: MARCA.peligroSuave, texto: MARCA.peligro, borde: '#f6d5cf' },
    aviso: { fondo: MARCA.avisoSuave, texto: MARCA.aviso, borde: '#efe2a8' },
    neutro: { fondo: MARCA.suave, texto: MARCA.muted, borde: MARCA.borde }
  }
  const e = estilos[tono]
  return `
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin:0 0 14px 0;">
  <tr>
    <td bgcolor="${e.fondo}" style="background-color:${e.fondo};border:1px solid ${e.borde};border-radius:14px;padding:13px 16px;color:${e.texto};font-family:${FUENTE};font-size:13px;line-height:20px;">${nota.html}</td>
  </tr>
</table>`
}

/** Lista sencilla con título (adjuntos, pasos, qué puedes hacer). */
export function bloqueLista(titulo: string, items: string[]): string {
  if (items.length === 0) return ''
  const filas = items
    .map(
      (it) => `
      <tr>
        <td width="18" valign="top" style="padding:3px 0;color:${MARCA.primario};font-family:${FUENTE};font-size:14px;line-height:20px;">&#8226;</td>
        <td valign="top" style="padding:3px 0;color:${MARCA.texto};font-family:${FUENTE};font-size:14px;line-height:20px;">${it}</td>
      </tr>`
    )
    .join('')
  return `
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin:0 0 20px 0;">
  <tr>
    <td bgcolor="${MARCA.suave}" style="background-color:${MARCA.suave};border:1px solid ${MARCA.borde};border-radius:14px;padding:14px 18px;">
      <p style="margin:0 0 6px 0;color:${MARCA.oscuro2};font-family:${FUENTE};font-size:11px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;">${titulo}</p>
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">${filas}
      </table>
    </td>
  </tr>
</table>`
}

/** Subtítulo de sección dentro del cuerpo. */
export function bloqueSubtitulo(html: string): string {
  return `<p style="margin:8px 0 8px 0;color:${MARCA.texto};font-family:${FUENTE};font-size:17px;font-weight:800;line-height:22px;">${html}</p>`
}

// ───────────────────────────────────────────────────────────────────────────
// Plantilla
// ───────────────────────────────────────────────────────────────────────────

export interface CorreoOpciones {
  /** Texto que muestran las bandejas de entrada junto al asunto (oculto en el cuerpo). */
  preheader?: string
  /** Etiqueta corta en mayúsculas sobre el título. */
  eyebrow: string
  titulo: string
  /** Texto de apoyo del hero. */
  subtitulo?: string
  mascota: MascotaReaccion
  /** HTML que va ANTES del saludo (p. ej. aviso de sandbox). */
  encabezadoHtml?: string
  /** «Hola, Nombre». HTML. */
  saludo?: string
  /** Párrafos del cuerpo. HTML ya escapado. */
  parrafos?: string[]
  /** HTML libre entre los párrafos y los datos (p. ej. una cita con el mensaje del remitente). */
  htmlTrasParrafos?: string
  datos?: BloqueDatos
  boton?: { texto: string; url: string }
  /** Notas que van después del botón. */
  notas?: Nota[]
  /** HTML libre, ya maquetado con los bloques de este módulo, tras las notas. */
  html?: string
  /** URL para «Si el botón no funciona…». */
  enlaceRespaldo?: string
  /** Líneas del pie. HTML. */
  pie?: string[]
}

function saludoHtml(saludo: string): string {
  return `<p style="margin:0 0 14px 0;color:${MARCA.texto};font-family:${FUENTE};font-size:16px;line-height:24px;">${saludo}</p>`
}

function enlaceRespaldoHtml(url: string): string {
  const u = escaparHtml(url)
  return `
<p style="margin:8px 0 0 0;color:${MARCA.muted};font-family:${FUENTE};font-size:12px;line-height:18px;">Si el botón no funciona, copia y pega este enlace en tu navegador:</p>
<p style="margin:4px 0 0 0;font-family:${FUENTE};font-size:12px;line-height:18px;word-break:break-all;"><a href="${u}" style="color:${MARCA.primario};text-decoration:underline;">${u}</a></p>`
}

/**
 * Arma el correo completo. Devuelve el documento HTML listo para enviar.
 */
export function renderCorreo(o: CorreoOpciones): string {
  const cuerpo = [
    o.encabezadoHtml ?? '',
    o.saludo ? saludoHtml(o.saludo) : '',
    ...(o.parrafos ?? []).map((p) => bloqueParrafo(p)),
    o.htmlTrasParrafos ?? '',
    o.datos ? bloqueDatos(o.datos) : '',
    o.boton ? bloqueBoton(o.boton) : '',
    ...(o.notas ?? []).map(bloqueNota),
    o.html ?? '',
    o.enlaceRespaldo ? enlaceRespaldoHtml(o.enlaceRespaldo) : ''
  ].join('')

  const pie = (o.pie && o.pie.length > 0
    ? o.pie
    : [`Este correo fue enviado automáticamente por el sistema de ${MARCA.nombre}.`]
  )
    .map(
      (l) => `<p style="margin:0 0 4px 0;color:${MARCA.muted};font-family:${FUENTE};font-size:12px;line-height:18px;">${l}</p>`
    )
    .join('')

  const preheader = o.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${MARCA.fondo};opacity:0;">${escaparHtml(o.preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>`
    : ''

  const subtitulo = o.subtitulo
    ? `<p style="margin:8px 0 0 0;color:${MARCA.heroTexto};font-family:${FUENTE};font-size:14px;line-height:20px;">${o.subtitulo}</p>`
    : ''

  return `<!DOCTYPE html>
<html lang="es" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="color-scheme" content="light">
  <title>${escaparHtml(o.titulo)}</title>
  <!--[if mso]>
  <noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
  <style>table,td{border-collapse:collapse;}</style>
  <![endif]-->
</head>
<body style="margin:0;padding:0;background-color:${MARCA.fondo};-webkit-text-size-adjust:100%;">
${preheader}
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" bgcolor="${MARCA.fondo}" style="background-color:${MARCA.fondo};">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <!--[if mso]><table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0"><tr><td><![endif]-->
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" bgcolor="#ffffff" style="width:600px;max-width:600px;background-color:#ffffff;border:1px solid ${MARCA.borde};border-radius:24px;">

        <!-- Logo -->
        <tr>
          <td style="padding:22px 28px 6px 28px;">
            <img src="${escaparHtml(urlLogo())}" alt="${MARCA.nombre}" height="${MARCA.logoAlto}" style="display:block;height:${MARCA.logoAlto}px;width:auto;border:0;" />
          </td>
        </tr>

        <!-- Hero -->
        <tr>
          <td style="padding:12px 16px 0 16px;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" bgcolor="${MARCA.oscuro}" style="background-color:${MARCA.oscuro};background-image:linear-gradient(135deg,${MARCA.oscuro2} 0%,${MARCA.oscuro} 100%);border-radius:24px;">
              <tr>
                <td valign="middle" style="padding:30px 8px 30px 28px;">
                  <p style="margin:0 0 10px 0;color:${MARCA.eyebrow};font-family:${FUENTE};font-size:11px;font-weight:800;letter-spacing:1.6px;text-transform:uppercase;line-height:14px;">${o.eyebrow}</p>
                  <p style="margin:0;color:#ffffff;font-family:${FUENTE};font-size:26px;font-weight:900;letter-spacing:-0.4px;line-height:31px;">${o.titulo}</p>
                  ${subtitulo}
                </td>
                <td width="150" valign="bottom" align="right" style="width:150px;padding:14px 10px 0 0;">
                  <img src="${escaparHtml(urlMascota(o.mascota))}" alt="Mascota de ${MARCA.nombre} ${ALT_MASCOTA[o.mascota]}" width="140" height="140" style="display:block;width:140px;height:140px;border:0;" />
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Cuerpo -->
        <tr>
          <td style="padding:26px 28px 10px 28px;">
            ${cuerpo}
          </td>
        </tr>

        <!-- Pie -->
        <tr>
          <td bgcolor="${MARCA.suave}" style="background-color:${MARCA.suave};border-top:1px solid ${MARCA.borde};border-radius:0 0 24px 24px;padding:18px 28px;text-align:center;">
            ${pie}
          </td>
        </tr>

      </table>
      <!--[if mso]></td></tr></table><![endif]-->
      <p style="margin:16px 0 0 0;color:${MARCA.muted};font-family:${FUENTE};font-size:11px;line-height:16px;">${MARCA.razonSocial}</p>
    </td>
  </tr>
</table>
</body>
</html>`
}
