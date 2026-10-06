import fs from "node:fs";
import path from "node:path";

/**
 * Documentos PDF de evaluaciones, en HTML, para renderizar con Puppeteer.
 *
 * POR QUÉ EXISTE. `pdf-generator.service.ts` dibujaba los dos documentos
 * —el resumen de participantes y el detalle de una respuesta— con pdfkit a
 * mano: 1.300 líneas de `yPos += 12`, celdas medidas con `heightOfString`
 * y una columna doble colocada «por la que tuviera menor Y». El resultado
 * era un formulario gris de rejilla negra, Roboto a 6,5 puntos, sin nada en
 * común con el desprendible de nómina ni con el resto de documentos que
 * emite el panel.
 *
 * Ahora es HTML paginado por Chromium con el mismo lenguaje que el
 * rutograma (`servicios/rutograma.template.ts`) y el desprendible: membrete
 * oscuro con logotipo, NIT y bloque de formato, tarjetas con esquinas
 * redondeadas, fila de indicadores, cabeceras de tabla en el tinte de marca,
 * bloque de firmas y pie fijo. Como en el rutograma, el cuerpo va dentro de
 * una tabla de una celda: Chromium repite el `<thead>` en cada hoja, así el
 * membrete sale arriba de todas, y el pie es `position: fixed`. Este archivo
 * es igual en los dos repos salvo el bloque `MARCA`.
 *
 * ⚠️ SIN IMPORTS DE OTROS MÓDULOS. Las fuentes embebidas y las variables
 * `--tpdf-*` llegan por `prelude`, igual que en el desprendible, para que el
 * documento también salga —con fuentes del sistema— si ese módulo no está.
 */

// ── Marca ───────────────────────────────────────────────────────
// Lo único que difiere entre los dos repos.
const MARCA = {
  empresa: "COTRANSMEQ S.A.S",
  nombreCorto: "Cotransmeq",
  nit: "892099216-1",
  codigo: "HSEG-FR-17",
  version: "1",
  oscuro: "#14532d",
  oscuro2: "#166534",
  primario: "#ea580c",
  tinte: "#ffedd5",
  eyebrow: "#fdba74",
  heroTexto: "#ffedd5",
  texto: "#0f172a",
  muted: "#64748b",
  borde: "#e2e8f0",
  fondo: "#fff7ed",
} as const;

// ── Datos ───────────────────────────────────────────────────────

export type TipoPreguntaPdf =
  | "OPCION_UNICA"
  | "OPCION_MULTIPLE"
  | "NUMERICA"
  | "TEXTO"
  | "RELACION"
  | "VERDADERO_FALSO"
  | "SOPA_LETRAS";

export interface OpcionPdf {
  id: string;
  texto: string;
  esCorrecta: boolean;
}

export interface PreguntaPdf {
  id: string;
  texto: string;
  tipo: TipoPreguntaPdf;
  puntaje: number;
  opciones: OpcionPdf[];
  relacionIzq: string[];
  relacionDer: string[];
  respuestaCorrecta?: number | null;
  /** Sopa de letras: cuadrícula y ubicación de cada palabra. */
  configuracion?: {
    tamano: number;
    cuadricula: string[];
    palabras: { texto: string; fila: number; columna: number; dFila: number; dColumna: number }[];
  } | null;
}

export interface EvaluacionPdf {
  titulo: string;
  descripcion?: string | null;
  requiere_firma: boolean;
  created_at: string;
  preguntas: PreguntaPdf[];
}

export interface RespuestaPdf {
  id: string;
  preguntaId: string;
  valor_texto?: string | null;
  valor_numero?: number | null;
  opcionesIds: string[];
  relacion?: any;
  puntaje: number;
  pregunta?: PreguntaPdf;
}

export interface ResultadoPdf {
  id: string;
  nombre_completo: string;
  numero_documento: string;
  cargo: string;
  correo: string;
  telefono: string;
  puntaje_total: number;
  firma?: string | null;
  created_at: string;
  respuestas: RespuestaPdf[];
}

export interface OpcionesRenderPdf {
  /** `@font-face` embebidos y variables `--tpdf-*`. Opcional. */
  prelude?: string;
}

// ── Utilidades ──────────────────────────────────────────────────

const assetDataUrl = (fileName: string, mimeType: string): string => {
  try {
    const assetPath = path.join(__dirname, "..", "..", "assets", fileName);
    return `data:${mimeType};base64,${fs.readFileSync(assetPath).toString("base64")}`;
  } catch {
    return "";
  }
};

const LOGO_DATA_URL = assetDataUrl("desprendible/logo.png", "image/png");

/** Umbral de aprobación: el mismo que usaba el documento anterior. */
const MINIMO_APROBACION = 70;

const TIPO_ETIQUETA: Record<string, string> = {
  OPCION_UNICA: "Opción única",
  OPCION_MULTIPLE: "Opción múltiple",
  NUMERICA: "Numérica",
  TEXTO: "Texto",
  RELACION: "Relación",
  VERDADERO_FALSO: "Verdadero o falso",
  SOPA_LETRAS: "Sopa de letras",
};

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fechaLarga(iso: string): string {
  return new Date(iso).toLocaleDateString("es-CO", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function fechaHora(iso: string): string {
  const d = new Date(iso);
  const fecha = d.toLocaleDateString("es-CO", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const hora = d.toLocaleTimeString("es-CO", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${fecha}, ${hora}`;
}

function porcentaje(obtenido: number, maximo: number): number {
  if (!maximo) return 0;
  return Math.round((obtenido / maximo) * 1000) / 10;
}

function pct(n: number): string {
  return `${new Intl.NumberFormat("es-CO", { maximumFractionDigits: 1 }).format(n)} %`;
}

type Acierto = "correcta" | "parcial" | "incorrecta";

function acierto(obtenido: number, maximo: number): Acierto {
  if (maximo > 0 && obtenido >= maximo) return "correcta";
  if (obtenido > 0) return "parcial";
  return "incorrecta";
}

const ACIERTO_TEXTO: Record<Acierto, string> = {
  correcta: "Correcta",
  parcial: "Parcial",
  incorrecta: "Incorrecta",
};

const ICONO_OK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>`;
const ICONO_MAL = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>`;
const ICONO_PARCIAL = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path stroke-linecap="round" d="M6 12h12"/></svg>`;

function marcador(estado: Acierto): string {
  const icono =
    estado === "correcta" ? ICONO_OK : estado === "parcial" ? ICONO_PARCIAL : ICONO_MAL;
  return `<span class="marca marca--${estado}" aria-hidden="true">${icono}</span>`;
}

function puntajeMaximoDe(evaluacion: EvaluacionPdf): number {
  return evaluacion.preguntas.reduce((s, p) => s + (p.puntaje || 0), 0);
}

/**
 * La respuesta de una pregunta, en HTML, con el acierto marcado.
 *
 * Cada tipo tiene su forma: las de opción listan TODAS las opciones y
 * marcan la elegida (✓ si era correcta, ✗ si no) y, en gris, la correcta
 * que no se eligió; relación muestra cada par con su acierto; verdadero o
 * falso, lo elegido y, si falló, la correcta; numérica y texto, el valor.
 */
function renderRespuesta(respuesta: RespuestaPdf, pregunta: PreguntaPdf): string {
  const sinRespuesta = `<p class="sin-respuesta">Sin respuesta</p>`;

  if (pregunta.tipo === "TEXTO") {
    const texto = respuesta.valor_texto?.trim();
    return `${texto ? `<p class="texto-libre">${esc(texto)}</p>` : sinRespuesta}<p class="nota">Respuesta abierta · calificada por IA</p>`;
  }

  if (pregunta.tipo === "NUMERICA") {
    const valor =
      respuesta.valor_numero !== null && respuesta.valor_numero !== undefined
        ? String(respuesta.valor_numero)
        : respuesta.valor_texto?.trim();
    const correcta =
      pregunta.respuestaCorrecta !== null && pregunta.respuestaCorrecta !== undefined
        ? `<p class="nota">Respuesta correcta: <strong>${esc(pregunta.respuestaCorrecta)}</strong></p>`
        : "";
    return `${valor ? `<p class="valor-num">${esc(valor)}</p>` : sinRespuesta}${correcta}`;
  }

  if (pregunta.tipo === "VERDADERO_FALSO") {
    const elegido = respuesta.valor_numero;
    if (typeof elegido !== "number") return sinRespuesta;
    const correcta = pregunta.respuestaCorrecta;
    const ok = correcta !== null && correcta !== undefined && elegido === correcta;
    const nota =
      !ok && correcta !== null && correcta !== undefined
        ? `<p class="nota">Respuesta correcta: <strong>${correcta === 1 ? "Verdadero" : "Falso"}</strong></p>`
        : "";
    return `<ul class="opciones"><li class="${ok ? "ok" : "mal"}">${marcador(ok ? "correcta" : "incorrecta")}${elegido === 1 ? "Verdadero" : "Falso"}</li></ul>${nota}`;
  }

  if (pregunta.tipo === "RELACION") {
    const pares: { izq: string; der: string }[] = Array.isArray(respuesta.relacion)
      ? respuesta.relacion
      : [];
    if (!pares.length) return sinRespuesta;
    const filas = pares
      .map((par) => {
        const idx = pregunta.relacionIzq.indexOf(par.izq);
        const ok = idx !== -1 && pregunta.relacionDer[idx] === par.der;
        return `<li class="${ok ? "ok" : "mal"}">${marcador(ok ? "correcta" : "incorrecta")}<span class="par"><span>${esc(par.izq)}</span><span class="flecha">→</span><span>${esc(par.der)}</span></span></li>`;
      })
      .join("");
    return `<ul class="opciones">${filas}</ul>`;
  }

  if (pregunta.tipo === "SOPA_LETRAS") {
    const config = pregunta.configuracion;
    if (!config?.cuadricula?.length) return sinRespuesta;
    const trazos: { palabra?: string; desde: [number, number]; hasta: [number, number] }[] =
      Array.isArray(respuesta.relacion) ? respuesta.relacion : [];
    const marcadas = new Set<string>();
    for (const tr of trazos) {
      const dF = Math.sign(tr.hasta[0] - tr.desde[0]);
      const dC = Math.sign(tr.hasta[1] - tr.desde[1]);
      const largo = Math.max(Math.abs(tr.hasta[0] - tr.desde[0]), Math.abs(tr.hasta[1] - tr.desde[1])) + 1;
      for (let k = 0; k < largo; k++) marcadas.add(`${tr.desde[0] + dF * k},${tr.desde[1] + dC * k}`);
    }
    const encontradas = new Set(
      Array.isArray(respuesta.opcionesIds) ? respuesta.opcionesIds : [],
    );
    const cuadricula = `<table class="sopa"><tbody>${config.cuadricula
      .map(
        (fila, f) =>
          `<tr>${[...fila]
            .map((letra, c) => `<td class="${marcadas.has(`${f},${c}`) ? "sopa-marcada" : ""}">${esc(letra)}</td>`)
            .join("")}</tr>`,
      )
      .join("")}</tbody></table>`;
    const lista = config.palabras
      .map((p) => {
        const ok = encontradas.has(p.texto);
        return `<li class="${ok ? "ok" : "omitida"}">${ok ? marcador("correcta") : `<span class="marca marca--omitida" aria-hidden="true"></span>`}${esc(p.texto)}</li>`;
      })
      .join("");
    return `<div class="sopa-bloque">${cuadricula}<ul class="opciones sopa-lista">${lista}</ul></div><p class="nota">${encontradas.size} de ${config.palabras.length} palabras encontradas</p>`;
  }

  // OPCION_UNICA / OPCION_MULTIPLE
  const elegidas = new Set(Array.isArray(respuesta.opcionesIds) ? respuesta.opcionesIds : []);
  if (!elegidas.size) return sinRespuesta;
  const filas = pregunta.opciones
    .map((o) => {
      const elegida = elegidas.has(o.id);
      if (elegida) {
        return `<li class="${o.esCorrecta ? "ok" : "mal"}">${marcador(o.esCorrecta ? "correcta" : "incorrecta")}${esc(o.texto)}</li>`;
      }
      if (o.esCorrecta) {
        return `<li class="omitida"><span class="marca marca--omitida" aria-hidden="true"></span>${esc(o.texto)}<span class="nota-inline">· correcta, no marcada</span></li>`;
      }
      return "";
    })
    .filter(Boolean)
    .join("");
  return `<ul class="opciones">${filas}</ul>`;
}

// ── Piezas comunes ──────────────────────────────────────────────

function logoHtml(): string {
  return LOGO_DATA_URL
    ? `<img class="brand-logo" src="${LOGO_DATA_URL}" alt="${esc(MARCA.nombreCorto)}">`
    : `<strong class="brand-fallback">${esc(MARCA.empresa)}</strong>`;
}

interface Membrete {
  kicker: string;
  titulo: string;
  sub?: string;
  /** Pastilla bajo el título, como el estado del servicio en el rutograma. */
  estado?: { texto: string; tono: "ok" | "mal" | "neutro" };
  /** Pares del bloque de formato, además de código y versión. */
  formato: [string, string][];
}

/**
 * Membrete corporativo, calcado del rutograma: marca y NIT, kicker, título,
 * línea secundaria y el bloque de formato a la derecha. Va en el `<thead>`
 * para que se repita en cada hoja.
 */
function cabecera(m: Membrete): string {
  const pares: [string, string][] = [
    ["Código", MARCA.codigo],
    ["Versión", MARCA.version],
    ...m.formato,
  ];
  return `<header class="cabecera">
    <div>
      <div class="brand">
        ${logoHtml()}
        <p class="brand-meta">${esc(MARCA.empresa)}<br>NIT ${esc(MARCA.nit)}</p>
      </div>
      <div class="doc">
        <p class="kicker">${esc(m.kicker)}</p>
        <h1>${esc(m.titulo)}</h1>
        ${m.sub ? `<p class="sub">${esc(m.sub)}</p>` : ""}
        ${m.estado ? `<span class="estado estado--${m.estado.tono}">${esc(m.estado.texto)}</span>` : ""}
      </div>
    </div>
    <dl class="formato">
      ${pares.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}
    </dl>
  </header>
  <div class="cab-espacio"></div>`;
}

function pie(documento: string, derecha: string): string {
  return `<footer class="pie">
    <span>${esc(documento)} · ${esc(MARCA.codigo)} v${esc(MARCA.version)} · Documento generado electrónicamente por ${esc(MARCA.nombreCorto)}</span>
    <span>${esc(derecha)}</span>
  </footer>`;
}

/** Esqueleto de página: membrete repetido, pie fijo y el cuerpo en medio. */
function documento(membrete: string, cuerpo: string, pieHtml: string): string {
  return `<table class="doc-tabla">
<thead><tr><td>${membrete}</td></tr></thead>
<tfoot><tr><td><div class="pie-espacio"></div></td></tr></tfoot>
<tbody><tr><td><main>${cuerpo}</main></td></tr></tbody>
</table>
${pieHtml}`;
}

function dato(label: string, valor: string): string {
  return `<div class="dato">
    <span class="dato-label">${esc(label)}</span>
    <span class="dato-valor">${valor || "—"}</span>
  </div>`;
}

function stat(label: string, valor: string, sub: string, tono = ""): string {
  return `<div class="stat${tono ? ` stat--${tono}` : ""}">
    <span class="stat-label">${esc(label)}</span>
    <span class="stat-valor">${valor}</span>
    <span class="stat-sub">${sub}</span>
  </div>`;
}

function estilos(prelude: string, orientacion: "portrait" | "landscape"): string {
  return `<style>${prelude}</style>
<style>
  @page { size: letter ${orientacion}; margin: 8mm 10mm 8mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: 'Inter Tight', system-ui, sans-serif;
    font-size: 7.6pt;
    line-height: 1.3;
    color: ${MARCA.texto};
    background: #fff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  h1, h2, h3, p, ul, dl { margin: 0; }
  ul { padding: 0; list-style: none; }
  table { width: 100%; border-collapse: collapse; }
  .mono { font-family: 'JetBrains Mono', monospace; font-variant-numeric: tabular-nums; }
  .c { text-align: center; }
  .d { text-align: right; }
  .tenue { color: #94a3b8; }

  /* ── Esqueleto: membrete repetido y pie fijo ─────────────────────── */
  table.doc-tabla > thead { display: table-header-group; }
  table.doc-tabla > tfoot { display: table-footer-group; }
  table.doc-tabla > thead > tr > td, table.doc-tabla > tbody > tr > td, table.doc-tabla > tfoot > tr > td { padding: 0; }
  .cab-espacio { height: 6pt; }
  .pie-espacio { height: 20pt; }
  .pie {
    position: fixed; left: 0; right: 0; bottom: 0;
    display: flex; justify-content: space-between; align-items: center;
    padding: 5pt 2pt 0; border-top: .6pt solid ${MARCA.borde};
    color: ${MARCA.muted}; font-size: 5.7pt; letter-spacing: .025em; background: #fff;
  }

  /* ── Membrete corporativo ─────────────────────────────────────────── */
  .cabecera {
    position: relative; overflow: hidden;
    display: grid; grid-template-columns: 1fr auto; gap: 14pt; align-items: end;
    border-radius: 14pt; padding: 11pt 16pt 12pt;
    background: ${MARCA.oscuro}; color: #fff;
  }
  .cabecera::before, .cabecera::after {
    content: ''; position: absolute; border-radius: 999pt;
    background: rgba(255,255,255,.055);
  }
  .cabecera::before { width: 150pt; height: 150pt; right: 120pt; top: -96pt; }
  .cabecera::after { width: 54pt; height: 54pt; left: -18pt; bottom: -26pt; }
  .cabecera > * { position: relative; z-index: 2; }
  .brand { display: flex; align-items: center; gap: 8pt; }
  .brand-logo { width: 90pt; max-height: 28pt; object-fit: contain; object-position: left center; filter: brightness(0) invert(1); }
  .brand-fallback { color: #fff; font-size: 10pt; letter-spacing: .08em; }
  .brand-meta { color: #ecfff6; font-size: 6.6pt; line-height: 1.3; font-weight: 750; letter-spacing: .015em; }
  .doc { margin-top: 8pt; }
  .doc .kicker { color: ${MARCA.eyebrow}; font-size: 6pt; font-weight: 800; letter-spacing: .15em; }
  .doc h1 { margin-top: 2pt; color: #fff; font-size: 15pt; line-height: 1.1; letter-spacing: -.025em; font-weight: 800; overflow-wrap: anywhere; }
  .doc .sub { margin-top: 3pt; color: ${MARCA.heroTexto}; font-size: 7.4pt; line-height: 1.35; font-weight: 500; max-width: 400pt; }
  .formato { display: grid; grid-template-columns: auto auto; gap: 2pt 8pt; align-self: start; padding: 6pt 9pt; border-radius: 9pt; background: rgba(255,255,255,.1); font-size: 6.2pt; }
  .formato dt { color: ${MARCA.eyebrow}; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
  .formato dd { margin: 0; color: #fff; font-weight: 700; text-align: right; white-space: nowrap; }
  .estado {
    display: inline-block; margin-top: 5pt; padding: 2.5pt 7pt; border-radius: 999pt;
    background: rgba(255,255,255,.14); color: #fff;
    font-size: 5.8pt; font-weight: 800; letter-spacing: .06em; text-transform: uppercase;
  }
  .estado--ok { background: ${MARCA.tinte}; color: ${MARCA.oscuro}; }
  .estado--mal { background: #fff0ed; color: #b42318; }

  /* ── Tarjetas ─────────────────────────────────────────────────────── */
  main { display: flex; flex-direction: column; gap: 7pt; }
  .card { overflow: hidden; background: #fff; border: .6pt solid ${MARCA.borde}; border-radius: 12pt; break-inside: avoid; }
  /* Las tablas largas se dejan partir entre hojas, fila a fila. */
  .card--fluida { break-inside: auto; }
  .card--fluida tr { break-inside: avoid; }
  .card-title { padding: 6pt 9pt 4pt; color: ${MARCA.texto}; font-size: 8.6pt; font-weight: 850; }
  .card-subtitle { display: block; margin-top: 1pt; color: ${MARCA.muted}; font-size: 5.8pt; font-weight: 550; }
  .identity-strip { display: grid; gap: 8pt; padding: 8pt 9pt; background: ${MARCA.fondo}; }
  .dato { min-width: 0; }
  .dato-label { display: block; font-size: 5.4pt; color: ${MARCA.muted}; font-weight: 800; letter-spacing: .09em; text-transform: uppercase; }
  .dato-valor { display: block; margin-top: 1.5pt; font-size: 7.2pt; line-height: 1.25; font-weight: 750; overflow-wrap: anywhere; }
  .dato-valor .sub { display: block; font-size: 6.2pt; font-weight: 500; color: #475569; }

  /* ── Indicadores ──────────────────────────────────────────────────── */
  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 7pt; }
  .stat { padding: 7pt 9pt; border: .6pt solid ${MARCA.borde}; border-radius: 10pt; background: #fff; }
  .stat-label { display: block; font-size: 5.4pt; color: ${MARCA.muted}; font-weight: 800; letter-spacing: .09em; text-transform: uppercase; }
  .stat-valor { display: block; margin-top: 2pt; font-size: 12.5pt; font-weight: 850; letter-spacing: -.02em; color: ${MARCA.oscuro}; font-variant-numeric: tabular-nums; }
  .stat-valor small { font-size: 7pt; font-weight: 700; color: ${MARCA.muted}; letter-spacing: 0; }
  .stat-sub { display: block; font-size: 5.8pt; color: ${MARCA.muted}; }
  .stat--mal .stat-valor { color: #b42318; }
  .stat--medio .stat-valor { color: #b45309; }
  .barra { position: relative; height: 4pt; margin-top: 3pt; border-radius: 999pt; background: ${MARCA.tinte}; overflow: hidden; }
  .barra i { position: absolute; inset: 0 auto 0 0; border-radius: 999pt; background: ${MARCA.primario}; }
  .stat--mal .barra i { background: #b42318; }
  .stat--medio .barra i { background: #d97706; }

  /* ── Tablas ───────────────────────────────────────────────────────── */
  thead { display: table-header-group; }
  thead th { background: ${MARCA.tinte}; color: ${MARCA.oscuro}; text-align: left; padding: 4.5pt 6pt; font-size: 5.8pt; letter-spacing: .08em; text-transform: uppercase; }
  thead th.c { text-align: center; }
  thead th.d { text-align: right; }
  tbody td { padding: 4.5pt 6pt; border-bottom: .5pt solid #edf3f0; vertical-align: top; font-size: 7pt; }
  tbody tr:last-child td { border-bottom: 0; }
  td .sub { display: block; font-size: 5.8pt; color: ${MARCA.muted}; font-weight: 500; }
  td.vacio { color: #94a3b8; font-style: italic; text-align: center; padding: 7pt; }
  .pregunta { font-weight: 700; line-height: 1.35; white-space: pre-line; }
  .tipo { display: inline-block; margin-top: 3pt; padding: 1.5pt 5pt; border-radius: 999pt; background: ${MARCA.fondo}; color: ${MARCA.muted}; font-size: 5.2pt; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; }
  .pts { display: inline-block; margin-top: 3pt; padding: 1.5pt 6pt; border-radius: 999pt; font-size: 5.8pt; font-weight: 800; white-space: nowrap; }
  .pts--correcta { background: ${MARCA.tinte}; color: ${MARCA.oscuro}; }
  .pts--parcial { background: #fef3c7; color: #92400e; }
  .pts--incorrecta { background: #fff0ed; color: #b42318; }
  .acierto { display: flex; flex-direction: column; align-items: center; gap: 2pt; font-size: 5.8pt; font-weight: 700; }
  .acierto .marca { width: 11pt; height: 11pt; }
  .acierto--correcta { color: ${MARCA.oscuro}; }
  .acierto--parcial { color: #92400e; }
  .acierto--incorrecta { color: #b42318; }
  .resultado-pill { display: inline-block; padding: 2.5pt 7pt; border-radius: 999pt; font-size: 5.6pt; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; white-space: nowrap; }
  .resultado-pill--ok { background: ${MARCA.tinte}; color: ${MARCA.oscuro}; }
  .resultado-pill--mal { background: #fff0ed; color: #b42318; }

  /* ── Respuestas ───────────────────────────────────────────────────── */
  .opciones { display: flex; flex-direction: column; gap: 2.5pt; }
  .opciones li { display: flex; align-items: flex-start; gap: 4pt; line-height: 1.35; }
  .opciones li.ok { color: ${MARCA.oscuro}; font-weight: 700; }
  .opciones li.mal { color: #b42318; font-weight: 700; }
  .opciones li.omitida { color: ${MARCA.muted}; }
  .marca {
    display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;
    width: 9pt; height: 9pt; margin-top: .5pt; border-radius: 50%; color: #fff;
  }
  .marca svg { width: 5.5pt; height: 5.5pt; }
  .marca--correcta { background: ${MARCA.primario}; }
  .marca--incorrecta { background: #b42318; }
  .marca--parcial { background: #d97706; }
  .marca--omitida { border: 1pt dashed ${MARCA.primario}; background: transparent; }
  .par { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 3pt; }
  .par .flecha { color: ${MARCA.muted}; font-weight: 400; }
  .nota, .nota-inline { font-size: 6pt; color: ${MARCA.muted}; font-weight: 500; }
  .nota { margin-top: 3pt; }
  .nota strong { color: ${MARCA.oscuro}; }
  .nota-inline { margin-left: 3pt; }
  .sin-respuesta { color: ${MARCA.muted}; font-style: italic; }
  .texto-libre { white-space: pre-line; line-height: 1.4; }
  .valor-num { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 8pt; }
  .sopa-bloque { display: grid; grid-template-columns: auto 1fr; gap: 8pt; align-items: start; }
  table.sopa { width: auto; border-collapse: separate; border-spacing: 1pt; }
  table.sopa td { width: 10pt; height: 10pt; padding: 0; border: 0; border-radius: 2pt; background: ${MARCA.fondo}; color: ${MARCA.texto}; font-family: 'JetBrains Mono', monospace; font-size: 6.2pt; font-weight: 700; text-align: center; vertical-align: middle; line-height: 10pt; }
  table.sopa td.sopa-marcada { background: ${MARCA.primario}; color: #fff; }
  .sopa-lista { gap: 1.5pt; }

  /* ── Firmas ───────────────────────────────────────────────────────── */
  .firmas { display: grid; grid-template-columns: 1fr 1fr; gap: 22pt; padding: 8pt 14pt 8pt; background: #fff; border: .6pt solid ${MARCA.borde}; border-radius: 12pt; break-inside: avoid; }
  .firma { min-width: 0; text-align: center; display: flex; flex-direction: column; }
  .firma-media { height: 36pt; display: flex; align-items: flex-end; justify-content: center; }
  .firma-image { display: block; max-height: 36pt; max-width: 160pt; object-fit: contain; }
  .firma .linea { width: 100%; border-top: .75pt solid #9eb0a8; margin-top: 1pt; padding-top: 3pt; color: ${MARCA.oscuro}; font-weight: 800; }
  .firma small { color: ${MARCA.muted}; font-size: 5.8pt; }

  /* ── Resumen (apaisado) ───────────────────────────────────────────── */
  .stats--6 { grid-template-columns: repeat(6, 1fr); }
  .firma-celda img { display: block; max-height: 22pt; max-width: 70pt; object-fit: contain; }
</style>`;
}

// ── Documento individual ────────────────────────────────────────

export function renderResultadoIndividualHtml(
  evaluacion: EvaluacionPdf,
  resultado: ResultadoPdf,
  opciones: OpcionesRenderPdf = {},
): string {
  const maximo = puntajeMaximoDe(evaluacion);
  const pctTotal = porcentaje(resultado.puntaje_total, maximo);
  const aprobado = pctTotal >= MINIMO_APROBACION;
  const tono = pctTotal >= MINIMO_APROBACION ? "" : pctTotal >= 50 ? "medio" : "mal";

  // En el orden de la evaluación, no en el que las devuelva la base.
  const posicion = new Map(evaluacion.preguntas.map((p, i) => [p.id, i]));
  const respuestas = resultado.respuestas
    .filter((r) => r.pregunta)
    .sort((a, b) => (posicion.get(a.preguntaId) ?? 99) - (posicion.get(b.preguntaId) ?? 99));
  const conteos = { correcta: 0, parcial: 0, incorrecta: 0 };
  for (const r of respuestas) conteos[acierto(r.puntaje, r.pregunta!.puntaje)]++;

  const filas = respuestas
    .map((r, i) => {
      const p = r.pregunta!;
      const estado = acierto(r.puntaje, p.puntaje);
      return `<tr>
        <td class="c mono">${i + 1}</td>
        <td>
          <p class="pregunta">${esc(p.texto)}</p>
          <span class="tipo">${esc(TIPO_ETIQUETA[p.tipo] ?? p.tipo)}</span>
          <span class="pts pts--${estado}">${r.puntaje} / ${p.puntaje} pts</span>
        </td>
        <td>${renderRespuesta(r, p)}</td>
        <td class="c"><div class="acierto acierto--${estado}">${marcador(estado)}${ACIERTO_TEXTO[estado]}</div></td>
      </tr>`;
    })
    .join("");

  const firmas = evaluacion.requiere_firma
    ? `<div class="firmas">
        <div class="firma">
          <div class="firma-media">${resultado.firma ? `<img class="firma-image" src="${esc(resultado.firma)}" alt="Firma del evaluado">` : ""}</div>
          <div class="linea">${esc(resultado.nombre_completo)}</div>
          <small>C.C. ${esc(resultado.numero_documento)} · Firmado el ${esc(fechaHora(resultado.created_at))}</small>
        </div>
        <div class="firma">
          <div class="firma-media"></div>
          <div class="linea">${esc(MARCA.empresa)}</div>
          <small>Responsable de la evaluación</small>
        </div>
      </div>`
    : "";

  const cuerpo = `
  <section class="card">
    <div class="identity-strip" style="grid-template-columns: 1.5fr .9fr 1.1fr">
      ${dato("Evaluado", `${esc(resultado.nombre_completo)}<span class="sub">C.C. ${esc(resultado.numero_documento)}</span>`)}
      ${dato("Cargo", esc(resultado.cargo))}
      ${dato("Respondida el", esc(fechaHora(resultado.created_at)))}
      ${dato("Correo", esc((resultado.correo || "").toLowerCase()))}
      ${dato("Teléfono", `<span class="mono">${esc(resultado.telefono)}</span>`)}
      ${dato("Evaluación creada", esc(fechaLarga(evaluacion.created_at)))}
    </div>
  </section>

  <div class="stats">
    ${stat("Puntaje", `${resultado.puntaje_total}<small> / ${maximo}</small>`, `${evaluacion.preguntas.length} preguntas`, tono)}
    ${stat("Acierto", pct(pctTotal), `<span class="barra"><i style="width:${Math.min(100, pctTotal)}%"></i></span>`, tono)}
    ${stat("Correctas", String(conteos.correcta), `${conteos.parcial} parcial(es) · ${conteos.incorrecta} incorrecta(s)`)}
    ${stat("Resultado", aprobado ? "Aprobado" : "No aprobado", `Mínimo para aprobar: ${MINIMO_APROBACION} %`, aprobado ? "" : "mal")}
  </div>

  <section class="card card--fluida">
    <h2 class="card-title">Preguntas y respuestas<span class="card-subtitle">Lo que respondió el evaluado frente a la clave de corrección</span></h2>
    <table>
      <thead><tr><th class="c" style="width:22pt">#</th><th style="width:38%">Pregunta</th><th>Respuesta</th><th class="c" style="width:52pt">Acierto</th></tr></thead>
      <tbody>${filas || `<tr><td colspan="4" class="vacio">Sin respuestas registradas.</td></tr>`}</tbody>
    </table>
  </section>

  ${firmas}`;

  const membrete = cabecera({
    kicker: "FORMACIÓN · RESULTADO DE EVALUACIÓN",
    titulo: evaluacion.titulo,
    sub: evaluacion.descripcion ?? "",
    estado: { texto: aprobado ? "Aprobado" : "No aprobado", tono: aprobado ? "ok" : "mal" },
    formato: [
      ["Puntaje", `${resultado.puntaje_total} / ${maximo}`],
      ["Emitido", fechaHora(new Date().toISOString())],
    ],
  });

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
${estilos(opciones.prelude ?? "", "portrait")}
</head>
<body>
${documento(membrete, cuerpo, pie("Resultado de evaluación", `${resultado.nombre_completo} · C.C. ${resultado.numero_documento}`))}
</body></html>`;
}

// ── Resumen de participantes ────────────────────────────────────

export function renderResumenEvaluacionHtml(
  evaluacion: EvaluacionPdf,
  resultados: ResultadoPdf[],
  opciones: OpcionesRenderPdf = {},
): string {
  const maximo = puntajeMaximoDe(evaluacion);
  const conFirma = evaluacion.requiere_firma;
  const aprobados = resultados.filter(
    (r) => porcentaje(r.puntaje_total, maximo) >= MINIMO_APROBACION,
  ).length;
  const promedio = resultados.length
    ? resultados.reduce((s, r) => s + porcentaje(r.puntaje_total, maximo), 0) / resultados.length
    : 0;

  const filas = resultados
    .map((r, i) => {
      const p = porcentaje(r.puntaje_total, maximo);
      const aprobado = p >= MINIMO_APROBACION;
      const firma = conFirma
        ? `<td class="c firma-celda">${r.firma && r.firma.startsWith("data:image") ? `<img src="${esc(r.firma)}" alt="Firma">` : `<span class="tenue">—</span>`}</td>`
        : "";
      return `<tr>
        <td class="c mono">${i + 1}</td>
        <td><strong>${esc(r.nombre_completo)}</strong><span class="sub">${esc(fechaHora(r.created_at))}</span></td>
        <td class="mono">${esc(r.numero_documento)}</td>
        <td>${esc(r.cargo || "—")}</td>
        <td>${esc((r.correo || "—").toLowerCase())}</td>
        <td class="mono">${esc(r.telefono || "—")}</td>
        <td class="d mono"><strong>${r.puntaje_total}</strong> / ${maximo}</td>
        <td class="d mono">${pct(p)}</td>
        <td class="c"><span class="resultado-pill resultado-pill--${aprobado ? "ok" : "mal"}">${aprobado ? "Aprobado" : "No aprobado"}</span></td>
        ${firma}
      </tr>`;
    })
    .join("");

  const cuerpo = `
  <div class="stats stats--6">
    ${stat("Creada el", `<span style="font-size:8pt">${esc(fechaLarga(evaluacion.created_at))}</span>`, conFirma ? "Con firma digital" : "Sin firma")}
    ${stat("Preguntas", String(evaluacion.preguntas.length), "En la evaluación")}
    ${stat("Puntaje máximo", String(maximo), "Puntos posibles")}
    ${stat("Participantes", String(resultados.length), "Respuestas recibidas")}
    ${stat("Aprobados", String(aprobados), resultados.length ? `${pct(porcentaje(aprobados, resultados.length))} · mínimo ${MINIMO_APROBACION} %` : "—")}
    ${stat("Promedio", pct(Math.round(promedio * 10) / 10), "De acierto")}
  </div>

  <section class="card card--fluida">
    <h2 class="card-title">Participantes<span class="card-subtitle">En orden de respuesta · puntaje sobre ${maximo}</span></h2>
    <table>
      <thead><tr>
        <th class="c" style="width:22pt">#</th>
        <th style="width:21%">Nombre</th>
        <th style="width:9%">Documento</th>
        <th style="width:15%">Cargo</th>
        <th style="width:17%">Correo</th>
        <th style="width:9%">Teléfono</th>
        <th class="d" style="width:8%">Puntaje</th>
        <th class="d" style="width:7%">%</th>
        <th class="c" style="width:11%">Resultado</th>
        ${conFirma ? `<th class="c" style="width:10%">Firma</th>` : ""}
      </tr></thead>
      <tbody>${filas || `<tr><td colspan="${conFirma ? 10 : 9}" class="vacio">Nadie ha respondido esta evaluación todavía.</td></tr>`}</tbody>
    </table>
  </section>`;

  const membrete = cabecera({
    kicker: "FORMACIÓN · RESUMEN DE RESULTADOS",
    titulo: evaluacion.titulo,
    sub: evaluacion.descripcion ?? "",
    formato: [
      ["Participantes", String(resultados.length)],
      ["Emitido", fechaHora(new Date().toISOString())],
    ],
  });

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
${estilos(opciones.prelude ?? "", "landscape")}
</head>
<body>
${documento(membrete, cuerpo, pie("Resumen de resultados", `${resultados.length} participante(s)`))}
</body></html>`;
}
