import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pdfFromHtml } from '../../services/pdf.service'

/**
 * Generador de PDF para formularios SARLAFT + PTEE basado en HTML+CSS.
 *
 * En lugar de posicionar a bajo nivel con pdfkit, generamos un HTML con
 * la misma estética editorial de los PDF de liquidaciones de ingreso
 * (PreviewTerceroPDF / LiquidacionEditor) y lo renderizamos con
 * Puppeteer. Esto permite:
 *   - Mantener el branding (logo, tipografía Fraunces/Inter Tight, paleta
 *     esmeralda) consistente con el resto de la suite.
 *   - Renderizar la firma manuscrita como <img src="data:..."> sin que se
 *     filtre como texto plano (que era el bug de la versión con pdfkit).
 *   - Iterar más rápido en el layout: cualquier cambio de estilo se hace
 *     en el HTML, sin tocar coordenadas en pixeles.
 *
 * Importante: en este PDF NO se incrusta el `data:image/...` raw de la
 * firma. Si la firma viene como base64, se renderiza como <img> con
 * dimensiones controladas y se mantiene dentro del bloque de firma.
 * El dataURL crudo se omite del cuerpo de respuestas: el reporte solo
 * muestra "Firma adjunta" o la imagen renderizada.
 */

type PreguntaLite = {
  id: string
  pregunta: string
  tipo_respuesta?: string
  opciones?: string[] | null
  obligatorio?: boolean
  nota?: string
}

type SeccionLite = {
  seccion: string
  key_tabla?: string
  preguntas: PreguntaLite[]
}

type FormularioLite = {
  codigo: string
  version: string
  fecha_documento?: string
  secciones: SeccionLite[]
}

type DocumentoAdjunto = {
  id: string
  tipo_documento: string
  nombre_archivo: string
  mime_type: string
  tamano_bytes: string
}

export interface SarlaftPDFData {
  radicado: string
  tipo_formulario: 'cliente_proveedor' | 'accionistas' | 'personal'
  version: string
  fecha_envio: string
  fecha_diligenciamiento: string | null
  nombre_completo: string | null
  tipo_documento: string | null
  numero_documento: string | null
  correo: string | null
  telefono: string | null
  ip_origen: string | null
  user_agent: string | null
  referer: string | null
  estado: string
  respuestas: Record<string, any>
  documentos: DocumentoAdjunto[]
  formulario: FormularioLite
}

const TIPO_LABELS: Record<SarlaftPDFData['tipo_formulario'], string> = {
  cliente_proveedor: 'Cliente / Proveedor',
  accionistas: 'Accionistas',
  personal: 'Vinculación de Personal'
}

// ─── HELPERS ────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function fmtFecha(s: string | null | undefined): string {
  if (!s) return '—'
  const d = new Date(s)
  if (isNaN(d.getTime())) return String(s)
  return d.toLocaleDateString('es-CO', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'America/Bogota'
  })
}

function fmtFechaCorta(s: string | null | undefined): string {
  if (!s) return '—'
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[3]}/${m[2]}/${m[1]}`
  const d = new Date(s)
  if (isNaN(d.getTime())) return String(s)
  return d.toLocaleDateString('es-CO', { timeZone: 'America/Bogota' })
}

function fmtFechaHora(s: string | null | undefined): string {
  if (!s) return '—'
  const d = new Date(s)
  if (isNaN(d.getTime())) return String(s)
  return d.toLocaleString('es-CO', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Bogota'
  })
}

function fmtBytes(s: string | number | null | undefined): string {
  if (s == null) return '—'
  const n = typeof s === 'string' ? parseInt(s, 10) : s
  if (!Number.isFinite(n)) return String(s)
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

/**
 * Formatea un número como moneda colombiana (COP) sin decimales.
 *   8500000  → "$ 8.500.000"
 *   null     → "—"
 *   "texto"  → "texto" (no es número, se devuelve tal cual)
 */
function fmtCOP(v: any): string {
  if (v == null || v === '') return '—'
  const n = typeof v === 'string' ? parseFloat(v.replace(/[^0-9.,-]/g, '').replace(/\./g, '').replace(',', '.')) : Number(v)
  if (!Number.isFinite(n)) return String(v)
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(n)
}

/**
 * Heurística: detecta si una pregunta/celda representa un valor monetario
 * (ingresos, egresos, patrimonio, monto, valor, USD/COP, etc.) para
 * aplicarle formato de moneda automáticamente.
 */
function esCampoMonetario(preguntaTxt: string, preguntaId: string): boolean {
  const t = (preguntaTxt || '').toLowerCase()
  const id = (preguntaId || '').toLowerCase()
  // Excluir explícitamente campos de identificación / número de cuenta.
  // Aunque la pregunta diga "valor" o contenga "cta-", el número de cuenta
  // bancaria NO es dinero y no debe formatearse como COP.
  if (/(n[°ºo]?\s*(de\s*)?(producto|cuenta|c[eé]dula|nit|documento|n[uú]mero))/i.test(t)) {
    return false
  }
  if (id.includes('-cta-') || id.includes('-cta')) return false
  if (id.endsWith('-cta-01') || id.endsWith('-cta-02') || id.endsWith('-cta-03')) return false

  const keywords = [
    'ingreso',
    'egreso',
    'patrimonio',
    'valor',
    'monto',
    'usd',
    'cop',
    'precio',
    'salario',
    'pago',
    'facturad'
  ]
  if (keywords.some((k) => t.includes(k))) return true
  // IDs típicos de bloques financieros
  if (id.includes('-if-')) return true
  return false
}

function fmtValor(v: any, opts?: { monetario?: boolean }): string {
  if (v == null || v === '') return '—'
  if (Array.isArray(v)) return v.length ? v.map(String).join(', ') : '—'
  if (typeof v === 'object') {
    // Filas de tabla repetible → solo el número de filas
    const keys = Object.keys(v)
    if (!keys.length) return '—'
    return `${keys.length} campo${keys.length === 1 ? '' : 's'}`
  }
  if (opts?.monetario) return fmtCOP(v)
  return String(v)
}

function getFirmaDataUrl(respuestas: Record<string, any>): string | null {
  const f =
    respuestas?.['PER-ENC-04'] ??
    respuestas?.['ACC-ENC-04'] ??
    respuestas?.['CLI-ENC-04']
  if (!f || typeof f !== 'string') return null
  if (!/^data:image\/(png|jpe?g|webp);base64,/i.test(f)) return null
  return f
}

function getNombreFirmante(respuestas: Record<string, any>): string | null {
  const n =
    respuestas?.['PER-ENC-03'] ??
    respuestas?.['ACC-ENC-03'] ??
    respuestas?.['CLI-ENC-03']
  return n ? String(n) : null
}

// ─── RENDERERS DE SECCIONES ─────────────────────────────────

/**
 * Carga el logo de Transmeralda desde src/assets/ y lo embebe en el HTML
 * como data URL. Se cachea en memoria para no leer el disco en cada PDF.
 * Si el archivo no existe, cae a un fallback de texto.
 */
let _logoDataUrl: string | null = null
function getLogoDataUrl(): string {
  if (_logoDataUrl !== null) return _logoDataUrl
  try {
    const logoPath = resolve(__dirname, '../../assets/logo_transmeralda-264.webp')
    const buf = readFileSync(logoPath)
    _logoDataUrl = `data:image/webp;base64,${buf.toString('base64')}`
  } catch (err) {
    console.warn('[PDFSarlaft] No se encontró logo.webp, usando fallback')
    _logoDataUrl = ''
  }
  return _logoDataUrl
}

function renderPregunta(pregunta: PreguntaLite, valor: any): string {
  const id = pregunta.id
  const preguntaTxt = escapeHtml(pregunta.pregunta)

  // Si es la firma → la renderizamos aparte, no aquí
  if (pregunta.tipo_respuesta === 'firma' || /data:image\//i.test(String(valor ?? ''))) {
    return ''
  }

  // Si es declaracion_informativa → bloque compacto destacado
  if (pregunta.tipo_respuesta === 'declaracion_informativa') {
    return `
      <div class="field field--declaracion">
        <div class="field-value decl-text">${pregunta.nota ? escapeHtml(pregunta.nota) : preguntaTxt}</div>
      </div>
    `
  }

  // Si tiene opciones (selección única) → renderizar como pills inline
  if (pregunta.opciones && pregunta.opciones.length > 0) {
    const selected = String(valor ?? '')
    return `
      <div class="field field--inline">
        <div class="field-label">${preguntaTxt}</div>
        <div class="field-value opciones-row">
          ${pregunta.opciones
            .map((op) => {
              const isSel = op === selected
              return `<span class="op-pill ${isSel ? 'op-pill--selected' : ''}">${
                isSel ? '●' : '○'
              } ${escapeHtml(op)}</span>`
            })
            .join('')}
        </div>
      </div>
    `
  }

  // Detectar valor monetario → formatear como COP
  const monetario = esCampoMonetario(preguntaTxt, id)
  const valorFmt = fmtValor(valor, { monetario })
  const valorClass = monetario ? 'field-value field-value--money' : 'field-value'

  // Si el valor es un texto largo (>120 chars), expandir a 2 columnas
  // para que se lea cómodo sin truncar el ancho.
  const longText = String(valorFmt).length > 120

  return `
    <div class="field field--inline ${longText ? 'field--wide' : ''}">
      <div class="field-label">${preguntaTxt}</div>
      <div class="${valorClass}">${escapeHtml(valorFmt)}</div>
    </div>
  `
}

function renderSeccion(
  idx: number,
  seccion: SeccionLite,
  respuestas: Record<string, any>
): string {
  const preguntaKeys = new Set(seccion.preguntas.map((p) => p.id))
  // Filas de tablas repetibles (si la sección tiene key_tabla)
  const tablaKey = seccion.key_tabla
  let tablaHtml = ''
  if (tablaKey) {
    const tabla = respuestas[tablaKey]
    if (Array.isArray(tabla) && tabla.length > 0) {
      tablaHtml = renderTablaRepetible(seccion, tabla)
    }
  }

  // Campos normales: los de la sección (excluyendo la firma)
  const camposHtml = seccion.preguntas
    .map((p) => {
      const v = respuestas[p.id]
      return renderPregunta(p, v)
    })
    .filter(Boolean)
    .join('')

  // Recolectar también respuestas que NO son preguntas de la sección
  // pero cuyo ID empieza por la key de la sección (caso tablas no
  // declaradas explícitamente con key_tabla). Esto es defensivo.
  let extraCampos = ''
  const seccionKeyPrefix = (seccion.key_tabla ?? '').split('__')[0]
  if (seccionKeyPrefix) {
    const extras: [string, any][] = []
    for (const [k, v] of Object.entries(respuestas)) {
      if (preguntaKeys.has(k)) continue
      if (k === tablaKey) continue
      if (k.startsWith(seccionKeyPrefix + '-') || k.startsWith(seccionKeyPrefix + '__')) {
        extras.push([k, v])
      }
    }
    if (extras.length) {
      extraCampos = `
        <div class="subsection-label">Detalle de items</div>
        ${extras
          .map(
            ([k, v]) => `
              <div class="field field--small">
                <div class="field-label">${escapeHtml(k)}</div>
                <div class="field-value">${escapeHtml(fmtValor(v))}</div>
              </div>
            `
          )
          .join('')}
      `
    }
  }

  if (!camposHtml && !tablaHtml && !extraCampos) return ''

  return `
    <section class="seccion">
      <header class="seccion-head">
        <span class="seccion-num">${String(idx + 1).padStart(2, '0')}</span>
        <h2 class="seccion-title">${escapeHtml(seccion.seccion)}</h2>
      </header>
      <div class="seccion-body">
        ${camposHtml}
        ${extraCampos}
        ${tablaHtml}
      </div>
    </section>
  `
}

function renderTablaRepetible(seccion: SeccionLite, filas: any[]): string {
  // Encabezados: las preguntas que NO son firma y NO son declaracion
  const headers = seccion.preguntas.filter(
    (p) => p.tipo_respuesta !== 'firma' && p.tipo_respuesta !== 'declaracion_informativa'
  )
  if (headers.length === 0) return ''

  // Asignar anchos de columna según tipo de contenido. Esto evita que
  // cabeceras largas ("N° DE CÉDULA / NIT", "NOMBRE COMPLETO / RAZÓN
  // SOCIAL") rompan la celda de forma rara cuando el contenido es corto.
  // Todos los porcentajes suman 100%; la columna # se maneja con px
  // aparte para que NUNCA se expanda.
  const WIDTH_PRESETS: Record<string, string> = {
    nombre: '24%',
    doc: '14%',
    correo: '19%',
    tel: '13%',
    pct: '9%',
    opc: '9%',
    fecha: '12%',
    text: '17%',
    money: '15%',
    cta: '21%'   // N° de producto (cuenta bancaria) — más ancho
  }
  function pickWidth(h: PreguntaLite): string {
    const t = (h.pregunta || '').toLowerCase()
    const id = h.id.toLowerCase()
    if (esCampoMonetario(t, id)) return WIDTH_PRESETS.money
    if (/(% |porcentaje|participaci)/.test(t)) return WIDTH_PRESETS.pct
    if (/(opci[oó]n|selecci[oó]n|s[ií]\/no|pol[ií]ticamente expuesta|p[xe]p)/.test(t)) return WIDTH_PRESETS.opc
    if (/(fecha|nacimiento|constituci[oó]n)/.test(t)) return WIDTH_PRESETS.fecha
    // N° de cuenta / producto → ancho mayor (ej. "123-456789-00")
    if (/(n[°ºo]?\s*(de\s*)?(producto|cuenta))/i.test(t)) return WIDTH_PRESETS.cta
    if (/(c[eé]dula|nit|n[uú]mero de documento)/.test(t)) return WIDTH_PRESETS.doc
    if (/(correo|email)/.test(t)) return WIDTH_PRESETS.correo
    if (/(tel[eé]fono|celular)/.test(t)) return WIDTH_PRESETS.tel
    if (/(nombre|raz[oó]n social|accionista|empresa|tercero)/.test(t)) return WIDTH_PRESETS.nombre
    return WIDTH_PRESETS.text
  }

  // Abreviaturas de cabeceras largas (los nombres oficiales son
  // descriptivos pero encolumnados a 7pt en una tabla no caben).
  // El par clave es el id de la pregunta.
  const HEADER_SHORT: Record<string, string> = {
    'ACC-CA-01': 'Nombre / Razón social',
    'ACC-CA-02': 'C.C. / NIT',
    'ACC-CA-04': 'Tipo soc.',
    'ACC-CA-07': '% Part.',
    'ACC-CA-08': '¿P.E.P.?',
    'ACC-BF-01': 'Nombre',
    'ACC-BF-02': 'Documento',
    'ACC-BF-03': '% Part.',
    'ACC-BF-04': '¿P.E.P.?',
    'ACC-CTA-01': 'Entidad',
    'ACC-CTA-02': 'Tipo',
    'ACC-CTA-03': 'N° de producto',
    'CLI-CA-01': 'Nombre / Razón social',
    'CLI-CA-02': 'Documento',
    'CLI-CA-03': '% Part.',
    'CLI-CA-04': '¿P.E.P.?',
    'CLI-BF-01': 'Nombre',
    'CLI-BF-02': 'Documento',
    'CLI-BF-03': '% Part.',
    'CLI-BF-04': '¿P.E.P.?',
    'CLI-RF-01': 'Nombre',
    'CLI-RF-02': 'Documento',
    'CLI-RF-03': '¿P.E.P.?',
    'CLI-CTA-01': 'Entidad',
    'CLI-CTA-02': 'Tipo',
    'CLI-CTA-03': 'N° de producto'
  }
  function shortHeader(h: PreguntaLite): string {
    return HEADER_SHORT[h.id] ?? h.pregunta
  }

  return `
    <div class="tabla-wrap">
      <table class="tabla">
        <colgroup>
          <col class="col-num" />
          ${headers.map(() => `<col />`).join('')}
        </colgroup>
        <thead>
          <tr>
            <th class="th-num">#</th>
            ${headers
              .map((h) => `<th>${escapeHtml(shortHeader(h))}</th>`)
              .join('')}
          </tr>
        </thead>
        <tbody>
          ${filas
            .map(
              (fila, i) => `
              <tr>
                <td class="td-num">${i + 1}</td>
                ${headers
                  .map((h) => {
                    const v = fila?.[h.id] ?? fila?.[h.id.split('-').slice(-1)[0]]
                    const monetario = esCampoMonetario(h.pregunta || '', h.id)
                    const txt = fmtValor(v, { monetario })
                    const cls = monetario ? 'td-money' : 'td-text'
                    return `<td class="${cls}">${escapeHtml(txt)}</td>`
                  })
                  .join('')}
              </tr>
            `
            )
            .join('')}
        </tbody>
      </table>
    </div>
  `
}

function renderFirma(firmaDataUrl: string | null, nombreFirmante: string | null): string {
  const nombre = nombreFirmante ? escapeHtml(nombreFirmante) : '—'
  if (firmaDataUrl) {
    return `
      <section class="firma-block">
        <div class="firma-label">FIRMA DE QUIEN AUTORIZA</div>
        <div class="firma-box">
          <img src="${firmaDataUrl}" alt="Firma manuscrita de ${nombre}" class="firma-img" />
        </div>
        <div class="firma-nombre">${nombre}</div>
        <div class="firma-meta">Firma capturada en el formulario · ${fmtFechaHora(new Date().toISOString())}</div>
      </section>
    `
  }
  return `
    <section class="firma-block">
      <div class="firma-label">FIRMA DE QUIEN AUTORIZA</div>
      <div class="firma-box firma-box--empty">
        <span class="firma-empty">No se adjuntó firma</span>
      </div>
      <div class="firma-nombre">${nombre}</div>
    </section>
  `
}

// ─── TEMPLATE HTML ──────────────────────────────────────────

function buildHtml(data: SarlaftPDFData): string {
  const codigo = data.formulario.codigo
  const tipoLabel = TIPO_LABELS[data.tipo_formulario] ?? data.tipo_formulario
  const radicado = escapeHtml(data.radicado)
  const version = escapeHtml(data.formulario.version)
  const fechaDoc = escapeHtml(data.formulario.fecha_documento || '—')

  // Datos del titular en el header
  const titular = data.nombre_completo ?? '—'
  const doc = data.tipo_documento
    ? `${escapeHtml(data.tipo_documento)} ${escapeHtml(data.numero_documento ?? '—')}`
    : '—'
  const correo = data.correo ?? '—'
  const telefono = data.telefono ?? '—'

  // Logo local embebido como data URL (no requiere red, no infla el PDF)
  const logoSrc = getLogoDataUrl()
  const logoTag = logoSrc
    ? `<img src="${logoSrc}" alt="Transmeralda S.A.S." />`
    : `<div class="doc-logo-fallback">TRANS<br/>MERALDA</div>`

  // Render de cada sección
  const seccionesHtml = data.formulario.secciones
    .map((s, i) => renderSeccion(i, s, data.respuestas))
    .filter(Boolean)
    .join('')

  // Firma
  const firmaDataUrl = getFirmaDataUrl(data.respuestas)
  const nombreFirmante = getNombreFirmante(data.respuestas)
  const firmaHtml = renderFirma(firmaDataUrl, nombreFirmante)

  // Documentos adjuntos
  let docsHtml = ''
  if (data.documentos.length > 0) {
    docsHtml = `
      <section class="seccion">
        <header class="seccion-head">
          <span class="seccion-num">${String(data.formulario.secciones.length + 2).padStart(2, '0')}</span>
          <h2 class="seccion-title">Documentos adjuntos</h2>
        </header>
        <div class="seccion-body">
          <p class="docs-intro">${data.documentos.length} archivo${
      data.documentos.length === 1 ? '' : 's'
    } almacenado${data.documentos.length === 1 ? '' : 's'} en S3.</p>
          <div class="docs-grid">
            ${data.documentos
              .map(
                (d, i) => `
              <div class="doc-card">
                <div class="doc-card-num">#${i + 1}</div>
                <div class="doc-card-body">
                  <div class="doc-card-tipo">${escapeHtml(d.tipo_documento)}</div>
                  <div class="doc-card-name">${escapeHtml(d.nombre_archivo)}</div>
                  <div class="doc-card-meta">
                    <span>${escapeHtml(d.mime_type)}</span>
                    <span>·</span>
                    <span>${fmtBytes(d.tamano_bytes)}</span>
                  </div>
                </div>
              </div>
            `
              )
              .join('')}
          </div>
        </div>
      </section>
    `
  }

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <title>SARLAFT ${codigo} · ${radicado}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link
    href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Inter+Tight:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
    rel="stylesheet"
  />
  <style>
    /* ════════════════════════════════════════════════════
       TOKENS (paleta esmeralda / cálida — coherente con la suite)
       Layout compacto estilo "documento bancario":
         - márgenes -25% vs versión inicial
         - font-size base 8pt (era 9pt)
         - campos en grid 2-col cuando la etiqueta es corta
         - tablas con table-layout:fixed + word-wrap para
           que NINGUNA celda se desborde por cabecera larga
       ════════════════════════════════════════════════════ */
    :root {
      --bg: #FAF7F2;
      --surface: #ffffff;
      --ink: #0F1F1A;
      --ink-2: #1A1A1A;
      --muted: #6B6B6B;
      --muted-2: #9A9A9A;
      --line: #E6E2D9;
      --line-2: rgba(0, 0, 0, 0.06);
      --emerald-50: #ecfdf5;
      --emerald-100: #d1fae5;
      --emerald-200: #a7f3d0;
      --emerald-300: #6ee7b7;
      --emerald-500: #10B981;
      --emerald-600: #059669;
      --emerald-700: #047857;
      --emerald-800: #065f46;
      --emerald-900: #064e3b;
      --accent: #10B981;
      --accent-ink: #065f46;
      --amber-bg: #fef3c7;
      --amber-ink: #92400e;
      --red-bg: #fee2e2;
      --red-ink: #991b1b;
      --gray-bg: #f3f4f6;
      --gray-ink: #374151;
    }

    * { box-sizing: border-box; }
    html, body {
      margin: 0; padding: 0; background: var(--bg); color: var(--ink);
      font-family: 'Inter Tight', system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      font-size: 8pt;
      line-height: 1.35;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }

    .sheet {
      width: 100%;
      max-width: 100%;
      margin: 0 auto;
      background: var(--surface);
      padding: 6mm 6mm 8mm;          /* era 16/14/18mm → -62% */
      position: relative;
    }

    /* ═══ HEADER (logo + título + meta) ═══ */
    .doc-header {
      display: grid;
      grid-template-columns: 78px 1fr 130px;
      gap: 8px;
      align-items: center;
      padding: 5px 8px;
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 6px;
      box-shadow: 0 1px 0 rgba(0, 0, 0, 0.02);
    }
    .doc-logo {
      display: flex; align-items: center; justify-content: center;
      width: 78px; height: 44px;
    }
    .doc-logo img {
      max-width: 100%; max-height: 100%; object-fit: contain; display: block;
    }
    .doc-logo-fallback {
      font-family: 'Fraunces', Georgia, serif;
      font-size: 10pt; font-weight: 600;
      color: var(--emerald-800);
      letter-spacing: 0.04em;
      line-height: 1.1;
      text-align: center;
    }
    .doc-title { text-align: center; }
    .doc-company {
      font-family: 'Fraunces', Georgia, serif;
      font-size: 11pt; font-weight: 500;
      letter-spacing: 0.01em;
      color: var(--ink);
      line-height: 1.15;
    }
    .doc-subtitle {
      font-size: 7.5pt;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--emerald-800);
      margin-top: 1px;
    }
    .doc-meta {
      border-left: 1px solid var(--line);
      padding-left: 8px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 6.8pt;
      line-height: 1.3;
    }
    .doc-meta-row { display: flex; justify-content: space-between; gap: 4px; }
    .doc-meta-lbl { color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; }
    .doc-meta-val { color: var(--ink); font-weight: 500; }

    /* ═══ HERO STRIP (radicado + tipo + estado) ═══ */
    .hero {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 8px;
      align-items: center;
      margin-top: 6px;
      padding: 6px 10px;
      background: linear-gradient(180deg, var(--emerald-50) 0%, #ffffff 100%);
      border: 1px solid var(--emerald-200);
      border-radius: 6px;
    }
    .hero-l { display: flex; flex-direction: column; gap: 1px; }
    .hero-eyebrow {
      font-size: 5.8pt; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.12em;
      color: var(--emerald-700);
      font-family: 'JetBrains Mono', monospace;
    }
    .hero-radicado {
      font-family: 'Fraunces', Georgia, serif;
      font-size: 13pt; font-weight: 500; color: var(--ink);
      letter-spacing: 0.01em;
    }
    .hero-meta {
      font-size: 6.8pt; color: var(--muted); margin-top: 1px;
      font-family: 'JetBrains Mono', monospace;
    }
    .hero-r { display: flex; flex-direction: column; align-items: flex-end; gap: 3px; }
    .status-pill {
      display: inline-block; padding: 2px 8px; border-radius: 999px;
      font-size: 6.8pt; font-weight: 700; letter-spacing: 0.04em;
      text-transform: uppercase;
      border: 1px solid var(--emerald-200);
      background: var(--emerald-100); color: var(--emerald-800);
    }

    /* ═══ SUMMARY GRID (titular / documento / contacto) ═══ */
    .summary {
      display: grid;
      grid-template-columns: 2fr 1.4fr 1.4fr;
      gap: 0;
      margin-top: 6px;
      border: 1px solid var(--line);
      border-radius: 6px;
      overflow: hidden;
      background: var(--surface);
    }
    .summary-cell {
      padding: 6px 9px;
      border-right: 1px solid var(--line);
    }
    .summary-cell:last-child { border-right: 0; }
    .summary-lbl {
      font-size: 5.8pt; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.1em; color: var(--muted);
      font-family: 'JetBrains Mono', monospace;
    }
    .summary-val {
      font-size: 8.5pt; font-weight: 600; color: var(--ink);
      margin-top: 1px; line-height: 1.25;
    }
    .summary-sub {
      font-size: 6.8pt; color: var(--muted); margin-top: 1px;
      font-family: 'JetBrains Mono', monospace;
    }

    /* ═══ SECCIONES ═══ */
    .seccion {
      margin-top: 8px;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .seccion-head {
      display: flex; align-items: center; gap: 8px;
      padding: 4px 8px;
      background: var(--emerald-900);
      color: white;
      border-radius: 5px 5px 0 0;
    }
    .seccion-num {
      display: inline-flex; align-items: center; justify-content: center;
      width: 18px; height: 18px;
      border-radius: 4px;
      background: rgba(255, 255, 255, 0.15);
      font-family: 'JetBrains Mono', monospace;
      font-size: 7pt; font-weight: 700;
    }
    .seccion-title {
      font-family: 'Fraunces', Georgia, serif;
      font-size: 10.5pt; font-weight: 500;
      margin: 0; color: white;
      letter-spacing: 0.01em;
    }
    .seccion-body {
      border: 1px solid var(--line);
      border-top: 0;
      border-radius: 0 0 5px 5px;
      padding: 7px 9px;
      background: var(--surface);
    }

    /* ═══ CAMPOS (grid 2-col para aprovechar el ancho) ═══ */
    .seccion-body {
      display: grid;
      grid-template-columns: 1fr 1fr;
      column-gap: 14px;
      row-gap: 0;
    }
    .field {
      margin-bottom: 5px;
      min-width: 0;        /* permite que el wrap funcione dentro del grid */
      page-break-inside: avoid;
      break-inside: avoid;
    }
    /* Campos que NO caben en 2-col (texto largo, declaracion) */
    .field--declaracion {
      grid-column: 1 / -1;
    }
    .field-label {
      font-size: 5.8pt; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--emerald-800);
      font-family: 'JetBrains Mono', monospace;
      margin-bottom: 1px;
    }
    .field-value {
      font-size: 8pt; font-weight: 500; color: var(--ink);
      line-height: 1.3;
      word-wrap: break-word;
      overflow-wrap: anywhere;
    }
    .field-value--money {
      font-family: 'JetBrains Mono', monospace;
      font-weight: 600;
      color: var(--emerald-900);
    }
    .field--inline { display: flex; flex-direction: column; }
    .field--wide { grid-column: 1 / -1; }
    .field--small .field-label { font-size: 5.5pt; }
    .field--small .field-value { font-size: 7.5pt; }
    .decl-text {
      font-size: 7.5pt; color: var(--ink-2);
      font-style: italic;
      line-height: 1.4;
    }
    .subsection-label {
      font-size: 6.5pt; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--muted);
      margin: 6px 0 4px;
      padding-bottom: 2px;
      border-bottom: 1px dashed var(--line);
      font-family: 'JetBrains Mono', monospace;
      grid-column: 1 / -1;
    }

    /* ═══ SELECCIÓN ÚNICA (pills inline) ═══ */
    .opciones-row { display: inline-flex; gap: 4px; flex-wrap: wrap; }
    .op-pill {
      display: inline-flex; align-items: center; gap: 3px;
      padding: 2px 7px; border-radius: 999px;
      font-size: 7.2pt; font-weight: 500;
      border: 1px solid var(--line);
      background: var(--gray-bg); color: var(--muted);
    }
    .op-pill--selected {
      background: var(--emerald-100);
      border-color: var(--emerald-300);
      color: var(--emerald-900);
      font-weight: 700;
    }

    /* ═══ TABLA REPETIBLE — fix word-wrap por celdas largas ═══
       table-layout:fixed + word-wrap:break-word en td evita que
       cabeceras largas ("N° DE CÉDULA / NIT") rompan la celda de
       forma rara cuando el valor cabe en poco espacio. */
    .tabla-wrap {
      grid-column: 1 / -1;
      margin-top: 2px;
    }
    .tabla {
      width: 100%;
      table-layout: fixed;        /* columnas con anchos fijos del <colgroup> */
      border-collapse: collapse;
      font-size: 7pt;
    }
    .tabla th, .tabla td {
      padding: 3px 4px;
      text-align: left;
      vertical-align: top;
      border-bottom: 1px solid var(--line);
      /* Clave: que cualquier palabra/partición se rompa aquí dentro */
      word-wrap: break-word;
      overflow-wrap: anywhere;
      hyphens: auto;
      line-height: 1.25;
    }
    .tabla thead th {
      background: var(--emerald-50);
      color: var(--emerald-900);
      font-weight: 700; font-size: 6.5pt;
      text-transform: uppercase; letter-spacing: 0.04em;
      border-bottom: 1.5px solid var(--emerald-300);
      padding-top: 4px; padding-bottom: 4px;
    }
    .tabla tbody tr:nth-child(even) { background: rgba(0, 0, 0, 0.015); }
    /* Columna # muy estrecha, fija. Las demás se reparten el resto
       automáticamente porque table-layout:fixed con <col/> sin width
       reparte el espacio sobrante proporcionalmente. */
    .tabla .col-num { width: 16px; }
    .tabla .th-num, .tabla .td-num {
      width: 16px !important;
      min-width: 16px;
      max-width: 16px;
      text-align: center;
      color: var(--muted);
      font-family: 'JetBrains Mono', monospace;
      font-size: 6.5pt;
    }
    .tabla .td-num { font-weight: 600; color: var(--emerald-800); }
    .tabla .td-text { font-size: 7.2pt; }
    .tabla .td-money {
      font-family: 'JetBrains Mono', monospace;
      font-size: 7pt; font-weight: 600;
      color: var(--emerald-900);
      text-align: right;
    }

    /* ═══ DOCS ═══ */
    .docs-intro {
      font-size: 7.2pt; color: var(--muted); margin: 0 0 5px;
      font-family: 'JetBrains Mono', monospace;
      grid-column: 1 / -1;
    }
    .docs-grid {
      display: grid; grid-template-columns: 1fr 1fr; gap: 5px;
      grid-column: 1 / -1;
    }
    .doc-card {
      display: flex; gap: 6px; align-items: flex-start;
      padding: 5px 7px;
      background: var(--emerald-50);
      border: 1px solid var(--emerald-200);
      border-radius: 5px;
    }
    .doc-card-num {
      font-family: 'JetBrains Mono', monospace;
      font-size: 7pt; font-weight: 700;
      color: var(--emerald-800);
      background: white;
      padding: 1px 5px;
      border-radius: 3px;
      flex-shrink: 0;
    }
    .doc-card-body { flex: 1; min-width: 0; }
    .doc-card-tipo {
      font-size: 6.2pt; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.08em; color: var(--emerald-700);
    }
    .doc-card-name {
      font-size: 7.5pt; font-weight: 600; color: var(--ink);
      margin-top: 1px;
      word-break: break-all;
    }
    .doc-card-meta {
      display: flex; gap: 3px; font-size: 6.5pt; color: var(--muted);
      font-family: 'JetBrains Mono', monospace;
      margin-top: 1px;
    }

    /* ═══ FIRMA ═══ */
    .firma-block {
      grid-column: 1 / -1;
      margin-top: 8px;
      padding: 8px 12px;
      background: var(--surface);
      border: 1.5px solid var(--emerald-800);
      border-radius: 6px;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .firma-label {
      font-size: 6.5pt; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.12em;
      color: var(--emerald-800);
      font-family: 'JetBrains Mono', monospace;
      margin-bottom: 4px;
    }
    .firma-box {
      background: var(--emerald-50);
      border: 1px dashed var(--emerald-300);
      border-radius: 5px;
      height: 80px;               /* era 110px */
      display: flex; align-items: center; justify-content: center;
      padding: 4px;
    }
    .firma-box--empty { background: var(--gray-bg); border-color: var(--line); }
    .firma-img {
      max-width: 100%; max-height: 100%; object-fit: contain;
    }
    .firma-empty {
      color: var(--muted); font-style: italic; font-size: 7.5pt;
    }
    .firma-nombre {
      font-family: 'Fraunces', Georgia, serif;
      font-size: 11pt; font-weight: 500; color: var(--ink);
      margin-top: 4px;
    }
    .firma-meta {
      font-size: 6.2pt; color: var(--muted);
      font-family: 'JetBrains Mono', monospace;
      margin-top: 1px;
    }

    /* ═══ FOOTER ═══ */
    .doc-footer {
      position: running(footer);
      font-size: 5.8pt; color: var(--muted);
      font-family: 'JetBrains Mono', monospace;
    }

    @page {
      size: Letter;
      /* márgenes reducidos ~25%: 12/10/14/10 → 9/7.5/10.5/7.5 mm */
      margin: 9mm 7.5mm 10.5mm 7.5mm;
      @bottom-center {
        content: 'SARLAFT ${codigo} · Radicado ${radicado} · TRANSMERALDA S.A.S. · Pág. ' counter(page) ' / ' counter(pages);
        font-family: 'JetBrains Mono', monospace;
        font-size: 5.8pt;
        color: #9A9A9A;
      }
    }
  </style>
</head>
<body>
  <div class="sheet">
    <!-- HEADER -->
    <header class="doc-header">
      <div class="doc-logo">${logoTag}</div>
      <div class="doc-title">
        <div class="doc-company">TRANSPORTES Y SERVICIOS ESMERALDA S.A.S.</div>
        <div class="doc-subtitle">Formulario SARLAFT + PTEE · ${escapeHtml(tipoLabel)}</div>
      </div>
      <div class="doc-meta">
        <div class="doc-meta-row"><span class="doc-meta-lbl">Código</span><span class="doc-meta-val">${codigo}</span></div>
        <div class="doc-meta-row"><span class="doc-meta-lbl">Versión</span><span class="doc-meta-val">${version}</span></div>
        <div class="doc-meta-row"><span class="doc-meta-lbl">Fecha doc.</span><span class="doc-meta-val">${fechaDoc}</span></div>
      </div>
    </header>

    <!-- HERO -->
    <div class="hero">
      <div class="hero-l">
        <div class="hero-eyebrow">Radicado</div>
        <div class="hero-radicado">${radicado}</div>
        <div class="hero-meta">Enviado ${fmtFechaHora(data.fecha_envio)}${data.fecha_diligenciamiento ? ' · Diligenciado ' + fmtFechaCorta(data.fecha_diligenciamiento) : ''}</div>
      </div>
      <div class="hero-r">
        <span class="status-pill">${escapeHtml(data.estado || 'RECIBIDO')}</span>
      </div>
    </div>

    <!-- SUMMARY -->
    <div class="summary">
      <div class="summary-cell">
        <div class="summary-lbl">Titular</div>
        <div class="summary-val">${escapeHtml(titular)}</div>
      </div>
      <div class="summary-cell">
        <div class="summary-lbl">Documento</div>
        <div class="summary-val">${doc}</div>
        <div class="summary-sub">${escapeHtml(correo)}</div>
      </div>
      <div class="summary-cell">
        <div class="summary-lbl">Contacto</div>
        <div class="summary-val">${escapeHtml(telefono)}</div>
        <div class="summary-sub">${data.ip_origen ? 'IP ' + escapeHtml(data.ip_origen) : '—'}</div>
      </div>
    </div>

    ${seccionesHtml}
    ${docsHtml}
    ${firmaHtml}
  </div>
</body>
</html>`
}

// ─── API PÚBLICA ────────────────────────────────────────────

export class PDFGeneratorSarlaftService {
  static async generarPDFSarlaft(data: SarlaftPDFData): Promise<Buffer> {
    const html = buildHtml(data)
    return pdfFromHtml({
      html,
      landscape: false,
      marginMm: 0,
      format: 'Letter'
    })
  }
}
