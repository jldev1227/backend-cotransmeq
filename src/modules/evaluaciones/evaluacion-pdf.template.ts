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
 * Ahora es HTML paginado por Chromium, como el desprendible
 * (`nomina-canvas/desprendible.template.ts`) y como salidas-NC: la misma
 * cabecera oscura con logotipo y NIT, las mismas tarjetas, la misma
 * tipografía embebida. Este archivo es igual en los dos repos salvo el
 * bloque `MARCA`, que es lo único que cambia entre Transmeralda y
 * Cotransmeq.
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
  | "VERDADERO_FALSO";

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

function cabecera(kicker: string, titulo: string, sub: string): string {
  const logo = LOGO_DATA_URL
    ? `<img class="brand-logo" src="${LOGO_DATA_URL}" alt="${esc(MARCA.nombreCorto)}">`
    : `<strong class="brand-fallback">${esc(MARCA.empresa)}</strong>`;
  return `<header class="cabecera">
    <div class="brand">
      ${logo}
      <p class="brand-meta">${esc(MARCA.empresa)}<br>NIT ${esc(MARCA.nit)}</p>
    </div>
    <div class="doc">
      <p class="kicker">${esc(kicker)}</p>
      <h1>${esc(titulo)}</h1>
      ${sub ? `<p class="sub">${esc(sub)}</p>` : ""}
    </div>
    <div class="meta-doc">
      <span><b>CÓDIGO</b>${esc(MARCA.codigo)}</span>
      <span><b>VERSIÓN</b>${esc(MARCA.version)}</span>
    </div>
  </header>`;
}

function pie(): string {
  return `<p class="document-footer">Documento generado electrónicamente por ${esc(MARCA.nombreCorto)} · ${esc(fechaHora(new Date().toISOString()))}</p>`;
}

function estilos(prelude: string, orientacion: "portrait" | "landscape"): string {
  return `<style>${prelude}</style>
<style>
  @page { size: letter ${orientacion}; margin: 9mm 10mm 11mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: 'Inter Tight', system-ui, sans-serif;
    font-size: var(--tpdf-fs-body, 7.8pt);
    color: ${MARCA.texto};
    background: #fff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  h1, h2, h3, p, ul { margin: 0; }
  ul { padding: 0; list-style: none; }
  main { display: flex; flex-direction: column; gap: 8pt; }

  /* Cabecera oscura */
  .cabecera {
    position: relative; overflow: hidden;
    display: grid; grid-template-columns: 1fr auto; gap: 6pt 14pt;
    border-radius: 18pt; padding: 13pt 18pt 14pt;
    background: linear-gradient(160deg, ${MARCA.oscuro2} 0%, ${MARCA.oscuro} 70%);
    color: #fff;
  }
  .cabecera::before, .cabecera::after {
    content: ''; position: absolute; border-radius: 999pt;
    background: rgba(255,255,255,.055);
  }
  .cabecera::before { width: 170pt; height: 170pt; right: -60pt; top: -90pt; }
  .cabecera::after { width: 60pt; height: 60pt; left: 38%; bottom: -34pt; }
  .brand { position: relative; z-index: 2; display: flex; align-items: center; gap: 8pt; grid-column: 1; }
  .brand-logo { width: 92pt; max-height: 28pt; object-fit: contain; object-position: left center; filter: brightness(0) invert(1); }
  .brand-fallback { color: #fff; font-size: 10pt; letter-spacing: .08em; }
  .brand-meta { color: #f0fdf4; font-size: 7.4pt; line-height: 1.35; font-weight: 700; letter-spacing: .015em; }
  .meta-doc {
    position: relative; z-index: 2; grid-column: 2; grid-row: 1;
    display: flex; gap: 5pt; align-self: start;
  }
  .meta-doc span {
    display: inline-flex; flex-direction: column; gap: 1pt;
    padding: 4pt 7pt; border-radius: 8pt;
    background: rgba(255,255,255,.12); color: #fff;
    font-size: 6.6pt; font-weight: 700;
  }
  .meta-doc b { font-size: 5pt; letter-spacing: .12em; color: ${MARCA.eyebrow}; }
  .doc { position: relative; z-index: 2; grid-column: 1 / -1; margin-top: 4pt; max-width: 88%; }
  .doc .kicker { color: ${MARCA.eyebrow}; font-size: 6.3pt; font-weight: 800; letter-spacing: .15em; }
  .doc h1 { margin-top: 3pt; color: #fff; font-size: 16pt; line-height: 1.12; letter-spacing: -.02em; font-weight: 800; }
  .doc .sub { margin-top: 4pt; color: ${MARCA.heroTexto}; font-size: 7.6pt; line-height: 1.4; font-weight: 500; }

  /* Tarjetas */
  .card { overflow: hidden; background: #fff; border: .6pt solid ${MARCA.borde}; border-radius: 13pt; break-inside: avoid; }
  /* La tabla puede ocupar varias páginas: si la tarjeta entera evitara el
     corte, saltaría completa a la página siguiente y dejaría la primera
     medio vacía. Se parte por filas y la cabecera se repite sola. */
  .card--tabla { break-inside: auto; overflow: visible; }
  .card--tabla table { border-radius: 0 0 13pt 13pt; overflow: hidden; }
  .card-title { padding: 8pt 10pt 6pt; color: ${MARCA.texto}; font-size: 9pt; font-weight: 800; letter-spacing: -.01em; }
  .card-subtitle { display: block; margin-top: 1pt; color: ${MARCA.muted}; font-size: 6pt; font-weight: 500; letter-spacing: 0; }

  /* Franja de identidad */
  .identity-strip { display: grid; gap: 7pt 10pt; padding: 9pt 10pt; background: ${MARCA.fondo}; }
  .identity-label { display: block; font-size: 5.5pt; color: ${MARCA.muted}; font-weight: 800; letter-spacing: .09em; }
  .identity-value { display: block; margin-top: 2pt; font-size: 7.4pt; line-height: 1.25; font-weight: 800; overflow-wrap: anywhere; }

  /* Puntaje */
  .puntaje-grid { display: grid; grid-template-columns: 1.1fr 1fr; gap: 8pt; }
  .puntaje { display: flex; flex-direction: column; gap: 4pt; padding: 10pt 12pt; }
  .puntaje .label { font-size: 5.8pt; font-weight: 800; letter-spacing: .12em; color: ${MARCA.muted}; }
  .puntaje .grande { display: flex; align-items: baseline; gap: 3pt; font-variant-numeric: tabular-nums; }
  .puntaje .grande strong { font-size: 26pt; line-height: 1; font-weight: 800; letter-spacing: -.03em; color: ${MARCA.oscuro}; }
  .puntaje .grande span { font-size: 9pt; font-weight: 700; color: ${MARCA.muted}; }
  .barra { position: relative; height: 6pt; border-radius: 999pt; background: ${MARCA.tinte}; overflow: hidden; margin-top: 2pt; }
  .barra i { position: absolute; inset: 0 auto 0 0; border-radius: 999pt; background: ${MARCA.primario}; }
  .barra--bajo i { background: #b42318; }
  .barra--medio i { background: #d97706; }
  .puntaje .pct { font-size: 7pt; font-weight: 700; color: ${MARCA.texto}; }
  .resumen-acierto { display: flex; flex-direction: column; justify-content: center; gap: 5pt; padding: 10pt 12pt; }
  .estado {
    align-self: flex-start; padding: 4pt 10pt; border-radius: 999pt;
    font-size: 7.2pt; font-weight: 800; letter-spacing: .08em; white-space: nowrap;
  }
  .estado--aprobado { background: ${MARCA.tinte}; color: ${MARCA.oscuro}; }
  .estado--reprobado { background: #fff0ed; color: #b42318; }
  .conteos { display: flex; flex-wrap: wrap; gap: 4pt 10pt; font-size: 7pt; font-weight: 600; color: ${MARCA.texto}; }
  .conteos span { display: inline-flex; align-items: center; gap: 3pt; }
  .conteos .marca { width: 9pt; height: 9pt; }
  .minimo { font-size: 6.2pt; color: ${MARCA.muted}; }

  /* Tabla */
  table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  thead { display: table-header-group; }
  thead th {
    background: ${MARCA.tinte}; color: ${MARCA.oscuro}; text-align: left;
    padding: 5pt 7pt; font-size: 5.8pt; letter-spacing: .08em; font-weight: 800;
  }
  tbody td { padding: 6pt 7pt; border-bottom: .5pt solid #f1f5f9; vertical-align: top; }
  tbody tr { break-inside: avoid; }
  tbody tr:last-child td { border-bottom: 0; }
  .c { text-align: center; }
  .d { text-align: right; }
  .num { font-family: 'JetBrains Mono', monospace; font-weight: 700; color: ${MARCA.muted}; }
  .pregunta { font-weight: 700; line-height: 1.35; white-space: pre-line; }
  .tipo { display: inline-block; margin-top: 3pt; padding: 1.5pt 5pt; border-radius: 999pt; background: ${MARCA.fondo}; color: ${MARCA.muted}; font-size: 5.4pt; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; }
  .pts { display: inline-block; margin-top: 3pt; padding: 1.5pt 6pt; border-radius: 999pt; font-size: 6pt; font-weight: 800; white-space: nowrap; }
  .pts--correcta { background: ${MARCA.tinte}; color: ${MARCA.oscuro}; }
  .pts--parcial { background: #fef3c7; color: #92400e; }
  .pts--incorrecta { background: #fff0ed; color: #b42318; }
  .acierto { display: flex; flex-direction: column; align-items: center; gap: 2pt; font-size: 6pt; font-weight: 700; }
  .acierto .marca { width: 12pt; height: 12pt; }
  .acierto--correcta { color: ${MARCA.oscuro}; }
  .acierto--parcial { color: #92400e; }
  .acierto--incorrecta { color: #b42318; }

  /* Respuestas */
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
  .nota, .nota-inline { font-size: 6.2pt; color: ${MARCA.muted}; font-weight: 500; }
  .nota { margin-top: 3pt; }
  .nota strong { color: ${MARCA.oscuro}; }
  .nota-inline { margin-left: 3pt; }
  .sin-respuesta { color: ${MARCA.muted}; font-style: italic; }
  .texto-libre { white-space: pre-line; line-height: 1.4; }
  .valor-num { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 8pt; }

  /* Firma */
  .firmas { display: grid; grid-template-columns: 1fr 1fr; gap: 22pt; padding: 10pt 14pt 9pt; break-inside: avoid; }
  .firma { min-width: 0; text-align: center; display: flex; flex-direction: column; }
  .firma-media { height: 47pt; display: flex; align-items: flex-end; justify-content: center; }
  .firma .linea { width: 100%; border-top: .75pt solid #94a3b8; margin-top: 1pt; padding-top: 4pt; color: ${MARCA.oscuro}; font-weight: 800; }
  .firma-image { display: block; max-height: 45pt; max-width: 190pt; object-fit: contain; }
  .firma small { color: ${MARCA.muted}; font-size: 5.8pt; }
  .firma-pendiente { height: 47pt; }

  /* Resumen (apaisado) */
  .stats { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8pt; padding: 10pt 12pt; }
  .stat { display: flex; flex-direction: column; gap: 2pt; }
  .stat b { font-size: 5.5pt; color: ${MARCA.muted}; font-weight: 800; letter-spacing: .09em; }
  .stat span { font-size: 11pt; font-weight: 800; letter-spacing: -.02em; color: ${MARCA.oscuro}; font-variant-numeric: tabular-nums; }
  .stat small { font-size: 6pt; color: ${MARCA.muted}; }
  .firma-celda img { display: block; max-height: 22pt; max-width: 70pt; object-fit: contain; }
  .vacio { color: ${MARCA.muted}; font-style: italic; text-align: center; padding: 10pt; }

  .document-footer { text-align: center; color: ${MARCA.muted}; font-size: 5.7pt; letter-spacing: .025em; margin-top: 2pt; }
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
  const tonoBarra = pctTotal >= 70 ? "" : pctTotal >= 50 ? "barra--medio" : "barra--bajo";

  const respuestas = resultado.respuestas.filter((r) => r.pregunta);
  const conteos = { correcta: 0, parcial: 0, incorrecta: 0 };
  for (const r of respuestas) conteos[acierto(r.puntaje, r.pregunta!.puntaje)]++;

  const filas = respuestas
    .map((r, i) => {
      const p = r.pregunta!;
      const estado = acierto(r.puntaje, p.puntaje);
      return `<tr>
        <td class="c num">${i + 1}</td>
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

  const firma = evaluacion.requiere_firma
    ? `<section class="card firmas">
        <div class="firma">
          <div class="firma-media">${resultado.firma ? `<img class="firma-image" src="${esc(resultado.firma)}" alt="Firma del evaluado">` : ""}</div>
          <div class="linea">${esc(resultado.nombre_completo)}</div>
          <small>C.C. ${esc(resultado.numero_documento)} · Firmado el ${esc(fechaHora(resultado.created_at))}</small>
        </div>
        <div class="firma">
          <div class="firma-media firma-pendiente"></div>
          <div class="linea">${esc(MARCA.empresa)}</div>
          <small>Responsable de la evaluación</small>
        </div>
      </section>`
    : "";

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
${estilos(opciones.prelude ?? "", "portrait")}
<style>
  .identity-strip { grid-template-columns: 1.6fr .9fr 1.1fr; }
</style>
</head>
<body>
<main>
  ${cabecera("RESULTADO DE EVALUACIÓN", evaluacion.titulo, evaluacion.descripcion ?? "")}

  <section class="card">
    <div class="identity-strip">
      <div><span class="identity-label">NOMBRE</span><span class="identity-value">${esc(resultado.nombre_completo)}</span></div>
      <div><span class="identity-label">DOCUMENTO</span><span class="identity-value">${esc(resultado.numero_documento)}</span></div>
      <div><span class="identity-label">CARGO</span><span class="identity-value">${esc(resultado.cargo || "—")}</span></div>
      <div><span class="identity-label">CORREO</span><span class="identity-value">${esc(resultado.correo || "—")}</span></div>
      <div><span class="identity-label">TELÉFONO</span><span class="identity-value">${esc(resultado.telefono || "—")}</span></div>
      <div><span class="identity-label">RESPONDIDA EL</span><span class="identity-value">${esc(fechaHora(resultado.created_at))}</span></div>
    </div>
  </section>

  <div class="puntaje-grid">
    <section class="card puntaje">
      <span class="label">PUNTAJE OBTENIDO</span>
      <div class="grande"><strong>${resultado.puntaje_total}</strong><span>/ ${maximo} puntos</span></div>
      <div class="barra ${tonoBarra}"><i style="width:${Math.min(100, pctTotal)}%"></i></div>
      <span class="pct">${pct(pctTotal)} de acierto</span>
    </section>
    <section class="card resumen-acierto">
      <span class="estado estado--${aprobado ? "aprobado" : "reprobado"}">${aprobado ? "APROBADO" : "NO APROBADO"}</span>
      <div class="conteos">
        <span>${marcador("correcta")}${conteos.correcta} correctas</span>
        <span>${marcador("parcial")}${conteos.parcial} parciales</span>
        <span>${marcador("incorrecta")}${conteos.incorrecta} incorrectas</span>
      </div>
      <span class="minimo">Mínimo para aprobar: ${MINIMO_APROBACION} % · ${evaluacion.preguntas.length} preguntas · evaluación creada el ${esc(fechaLarga(evaluacion.created_at))}</span>
    </section>
  </div>

  <section class="card card--tabla">
    <h2 class="card-title">Preguntas y respuestas<span class="card-subtitle">Lo que respondió el evaluado frente a la clave de corrección</span></h2>
    <table>
      <thead><tr><th class="c" style="width:22pt">#</th><th style="width:40%">PREGUNTA</th><th>RESPUESTA</th><th class="c" style="width:52pt">ACIERTO</th></tr></thead>
      <tbody>${filas || `<tr><td colspan="4" class="vacio">Sin respuestas registradas.</td></tr>`}</tbody>
    </table>
  </section>

  ${firma}
  ${pie()}
</main>
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
        ? `<td class="c firma-celda">${r.firma && r.firma.startsWith("data:image") ? `<img src="${esc(r.firma)}" alt="Firma">` : `<span class="sin-respuesta">—</span>`}</td>`
        : "";
      return `<tr>
        <td class="c num">${i + 1}</td>
        <td><p class="pregunta">${esc(r.nombre_completo)}</p></td>
        <td>${esc(r.numero_documento)}</td>
        <td>${esc(r.cargo || "—")}</td>
        <td>${esc((r.correo || "—").toLowerCase())}</td>
        <td>${esc(r.telefono || "—")}</td>
        <td class="d"><strong>${r.puntaje_total}</strong> / ${maximo}</td>
        <td class="d">${pct(p)}</td>
        <td class="c"><span class="estado estado--${aprobado ? "aprobado" : "reprobado"}" style="font-size:6pt;padding:2.5pt 7pt">${aprobado ? "APROBADO" : "NO APROBADO"}</span></td>
        ${firma}
      </tr>`;
    })
    .join("");

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
${estilos(opciones.prelude ?? "", "landscape")}
<style>
  .doc { max-width: 70%; }
  tbody td { padding: 5pt 7pt; }
</style>
</head>
<body>
<main>
  ${cabecera("RESUMEN DE RESULTADOS", evaluacion.titulo, evaluacion.descripcion ?? "")}

  <section class="card">
    <div class="stats">
      <div class="stat"><b>CREADA EL</b><span style="font-size:8pt">${esc(fechaLarga(evaluacion.created_at))}</span></div>
      <div class="stat"><b>PREGUNTAS</b><span>${evaluacion.preguntas.length}</span></div>
      <div class="stat"><b>PUNTAJE MÁXIMO</b><span>${maximo}</span></div>
      <div class="stat"><b>PARTICIPANTES</b><span>${resultados.length}</span></div>
      <div class="stat"><b>APROBADOS</b><span>${aprobados}</span><small>${resultados.length ? pct(porcentaje(aprobados, resultados.length)) : "—"} · mínimo ${MINIMO_APROBACION} %</small></div>
      <div class="stat"><b>PROMEDIO</b><span>${pct(Math.round(promedio * 10) / 10)}</span><small>${conFirma ? "Con firma digital" : "Sin firma"}</small></div>
    </div>
  </section>

  <section class="card card--tabla">
    <h2 class="card-title">Participantes<span class="card-subtitle">En orden de respuesta · puntaje sobre ${maximo}</span></h2>
    <table>
      <thead><tr>
        <th class="c" style="width:22pt">#</th>
        <th style="width:21%">NOMBRE</th>
        <th style="width:9%">DOCUMENTO</th>
        <th style="width:15%">CARGO</th>
        <th style="width:17%">CORREO</th>
        <th style="width:9%">TELÉFONO</th>
        <th class="d" style="width:8%">PUNTAJE</th>
        <th class="d" style="width:7%">%</th>
        <th class="c" style="width:11%">RESULTADO</th>
        ${conFirma ? `<th class="c" style="width:10%">FIRMA</th>` : ""}
      </tr></thead>
      <tbody>${filas || `<tr><td colspan="${conFirma ? 10 : 9}" class="vacio">Nadie ha respondido esta evaluación todavía.</td></tr>`}</tbody>
    </table>
  </section>

  ${pie()}
</main>
</body></html>`;
}
