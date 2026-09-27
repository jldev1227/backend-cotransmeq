import fs from 'node:fs';
import path from 'node:path';

/**
 * Documento del desprendible de nómina, en HTML, para renderizar con
 * Puppeteer.
 *
 * POR QUÉ EXISTE. `LiquidacionesService.generatePayslipPdfBuffer()` devolvía
 * un PDF de prueba que decía literalmente «Test PDF - Empty Content», con un
 * comentario de «bypassing full content generation for testing». O sea que
 * `GET /liquidaciones/:id/pdf-desprendible` y, peor,
 * `POST /liquidaciones/generate-payslips-zip` llevaban tiempo entregando
 * documentos vacíos: una descarga masiva de treinta desprendibles producía
 * treinta copias del marcador de posición.
 *
 * El desprendible de verdad solo existía en el navegador
 * (`ingreso-svelte/src/lib/utils/pdfDesprendible.ts`, pdfmake), así que el
 * servidor no tenía con qué responder. Esto le da uno.
 *
 * Sigue el patrón de `liquidaciones-terceros-pdf`: HTML + tokens
 * (`pdf-tokens.ts`) + fuentes embebidas (`fonts.ts`) + `pdfFromHtml`. Se
 * eligió por encima de portar las 1.500 líneas de pdfmake porque es el
 * camino que ya usa el resto del módulo de canvas, comparte los tokens y no
 * duplica un generador entero.
 *
 * ⚠️ SIN IMPORTS DEL MÓDULO DE TERCEROS. Las fuentes embebidas y las
 * variables de color llegan por el parámetro `prelude` en vez de importarse:
 * `backend-cotransmeq` no tiene `liquidaciones-terceros-pdf/`, y así este
 * archivo puede ser byte a byte el mismo en los dos repos, que es la regla de
 * la casa para lo que tiene que existir por duplicado. Sin `prelude` el
 * documento sale igual con las fuentes del sistema: todas las `var(--tpdf-*)`
 * llevan valor por defecto.
 *
 * ⚠️ CONVIVENCIA. El portal del conductor y el modal del dashboard siguen
 * generando su PDF en el navegador con pdfmake. Hasta que esos dos flujos
 * apunten aquí, el mismo desprendible tiene dos aspectos según por dónde se
 * imprima. Los datos son los mismos —salen de la misma liquidación—, pero la
 * maquetación no. Migrarlos es el paso siguiente y está anotado en el README
 * del módulo.
 */

export interface LineaDesprendible {
  concepto: string;
  cantidad?: number | string | null;
  valor: number;
  grupo?: 'basico' | 'adicional' | 'novedad';
}

export interface DatosDesprendible {
  empresa: { nombre: string; nit: string };
  empleado: {
    nombre: string;
    cedula: string;
    cargo: string;
    /** `AGOSTO 2026 (21 JUL — 20 AGO)`. */
    periodo: string;
    /** Mes contable derivado de la fecha final, por ejemplo `septiembre de 2026`. */
    mesNomina: string;
    estado?: string;
  };
  devengos: LineaDesprendible[];
  deducciones: LineaDesprendible[];
  /** Desglose por empresa/mes. Vacío si no hay planillas. */
  bloques?: {
    titulo: string;
    subtitulo?: string;
    lineas: LineaDesprendible[];
    total: number;
  }[];
  basePrestacional: number;
  /** Firma del conductor ya subida, como data-URL o URL firmada. */
  firmaUrl?: string | null;
  fechaFirma?: string | null;
}

const assetDataUrl = (fileName: string, mimeType: string): string => {
  try {
    const assetPath = path.join(__dirname, '..', '..', 'assets', fileName);
    return `data:${mimeType};base64,${fs.readFileSync(assetPath).toString('base64')}`;
  } catch {
    return '';
  }
};

const LOGO_DATA_URL = assetDataUrl('desprendible/logo.png', 'image/png');
const MASCOT_DATA_URL = assetDataUrl('desprendible/mascota-trabajando.png', 'image/png');
const STAMP_DATA_URL = assetDataUrl('sello-firma-terceros.png', 'image/png');

const COP = (v: number): string =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.round(v || 0));

const num = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '';
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 }).format(n);
};

/**
 * Escapa el texto que va al HTML.
 *
 * No es paranoia: los nombres de empresa del sistema traen `&` con
 * frecuencia (`M&M MONTAJES`, `TRUCKING SERVICES & LOGISTIC`), y sin escapar
 * rompen el marcado.
 */
function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function filas(lineas: LineaDesprendible[], claseValor = ''): string {
  if (!lineas.length) return `<tr><td colspan="3" class="vacio">Sin conceptos.</td></tr>`;
  return lineas
    .map(
      (l) => `<tr>
        <td>${esc(l.concepto)}</td>
        <td class="c">${esc(num(l.cantidad))}</td>
        <td class="d ${claseValor}">${COP(l.valor)}</td>
      </tr>`,
    )
    .join('');
}

function grupoDeLinea(linea: LineaDesprendible): 'basico' | 'adicional' | 'novedad' {
  if (linea.grupo) return linea.grupo;
  const concepto = linea.concepto.toUpperCase();
  if (concepto === 'SALARIO' || concepto.includes('AUXILIO DE TRANSPORTE') || concepto.includes('NIVELACION')) {
    return 'basico';
  }
  if (concepto.includes('VACACION') || concepto.includes('LICENCIA') || concepto.includes('INCAPACIDAD') || concepto.includes('CESANT')) {
    return 'novedad';
  }
  return 'adicional';
}

export interface OpcionesRender {
  /**
   * CSS que se inyecta antes de la hoja del documento: los `@font-face` de
   * las fuentes embebidas y las variables `--tpdf-*`. Opcional — sin él se
   * usan las fuentes del sistema y los valores por defecto de cada `var()`.
   */
  prelude?: string;
}

export function renderDesprendibleHtml(
  d: DatosDesprendible,
  opciones: OpcionesRender = {},
): string {
  const totalDevengado = d.devengos.reduce((s, l) => s + (l.valor || 0), 0);
  const totalDeducido = d.deducciones.reduce((s, l) => s + (l.valor || 0), 0);
  const neto = totalDevengado - totalDeducido;
  const basicos = d.devengos.filter((linea) => grupoDeLinea(linea) === 'basico');
  const adicionales = d.devengos.filter((linea) => grupoDeLinea(linea) === 'adicional');
  const novedades = d.devengos.filter((linea) => grupoDeLinea(linea) === 'novedad');
  const diasLaborados = basicos.find((linea) => linea.concepto.toUpperCase().startsWith('SALARIO'))?.cantidad ?? '';

  const tablaConceptos = (
    titulo: string,
    subtitulo: string,
    lineas: LineaDesprendible[],
    claseValor = '',
  ): string => `<section class="card concept-card">
    <h2 class="card-title">${esc(titulo)}<span class="card-subtitle">${esc(subtitulo)}</span></h2>
    <table>
      <thead><tr><th>CONCEPTO</th><th class="c">CANT.</th><th class="d">VALOR</th></tr></thead>
      <tbody>${filas(lineas, claseValor)}</tbody>
    </table>
  </section>`;

  const bloques = (d.bloques ?? [])
    .filter((b) => b.lineas.some((l) => Number(l.cantidad) > 0 || l.valor > 0))
    .map(
      (b) => `<section class="bloque">
        <header>
          <h3>${esc(b.titulo)}</h3>
          ${b.subtitulo ? `<p>${esc(b.subtitulo)}</p>` : ''}
        </header>
        <table>
          <thead><tr><th>RECARGO</th><th class="c">HORAS</th><th class="d">VALOR</th></tr></thead>
          <tbody>${filas(b.lineas.filter((l) => Number(l.cantidad) > 0))}</tbody>
          <tfoot><tr><td colspan="2">TOTAL</td><td class="d">${COP(b.total)}</td></tr></tfoot>
        </table>
      </section>`,
    )
    .join('');

  const logo = LOGO_DATA_URL
    ? `<img class="brand-logo" src="${LOGO_DATA_URL}" alt="Cotransmeq">`
    : `<strong class="brand-fallback">COTRANSMEQ</strong>`;
  const mascot = MASCOT_DATA_URL
    ? `<img class="mascot" src="${MASCOT_DATA_URL}" alt="">`
    : '';
  const stamp = STAMP_DATA_URL
    ? `<img class="stamp-image" src="${STAMP_DATA_URL}" alt="Sello autorizado de Cotransmeq">`
    : '';

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<style>${opciones.prelude ?? ''}</style>
<style>
  @page { size: letter portrait; margin: 9mm 10mm 9mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: 'Inter Tight', system-ui, sans-serif;
    font-size: var(--tpdf-fs-body, 7.8pt);
    color: #17201d;
    background: #fff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  h1, h2, h3, p { margin: 0; }
  h1, h2, h3 { font-family: 'Inter Tight', system-ui, sans-serif; }
  main { display: flex; flex-direction: column; gap: 8pt; }
  .cabecera {
    position: relative; min-height: 116pt; overflow: hidden;
    border-radius: 18pt; padding: 14pt 18pt;
    background: #14532d; color: #fff;
  }
  .cabecera::before, .cabecera::after {
    content: ''; position: absolute; border-radius: 999pt;
    background: rgba(255,255,255,.055);
  }
  .cabecera::before { width: 160pt; height: 160pt; right: -52pt; top: -78pt; }
  .cabecera::after { width: 58pt; height: 58pt; left: -20pt; bottom: -28pt; }
  .brand { position: relative; z-index: 2; display: flex; align-items: center; gap: 8pt; }
  .brand-logo { width: 96pt; max-height: 30pt; object-fit: contain; object-position: left center; filter: brightness(0) invert(1); }
  .brand-fallback { color: #fff; font-size: 10pt; letter-spacing: .08em; }
  .brand-meta { color: #f0fdf4; font-size: 7.8pt; line-height: 1.35; font-weight: 750; letter-spacing: .015em; }
  .doc { position: relative; z-index: 2; width: 65%; margin-top: 12pt; }
  .doc .kicker { color: #fdba74; font-size: 6.3pt; font-weight: 800; letter-spacing: .15em; }
  .doc h1 { margin-top: 3pt; color: #fff; font-size: 18.5pt; line-height: 1.05; letter-spacing: -.025em; }
  .doc .periodo { margin-top: 5pt; color: #ffedd5; font-size: 8pt; font-weight: 600; }
  .mascot { position: absolute; z-index: 2; width: 114pt; height: 114pt; object-fit: contain; right: 5pt; bottom: -8pt; }
  .estado {
    display: inline-block; margin-top: 6pt; padding: 3pt 7pt; border-radius: 999pt;
    background: rgba(255,255,255,.14); color: #fff;
    font-size: 6pt; font-weight: 800; letter-spacing: .06em;
  }
  .identity-strip { display: grid; grid-template-columns: 1.7fr .9fr .7fr 1fr; gap: 8pt; padding: 9pt 10pt; background: #f7faf8; border-bottom: .6pt solid #dee7e3; }
  .identity-label { display: block; font-size: 5.5pt; color: #66756f; font-weight: 800; letter-spacing: .09em; }
  .identity-value { display: block; margin-top: 2pt; font-size: 7.3pt; line-height: 1.2; font-weight: 800; }
  table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  thead th {
    background: #ffedd5; color: #14532d; text-align: left;
    padding: 5pt 6pt; font-size: 5.8pt; letter-spacing: .08em;
  }
  tbody td { padding: 4pt 6pt; border-bottom: .5pt solid #edf3f0; }
  tbody tr:last-child td { border-bottom: 0; }
  tfoot td { padding: 5pt 6pt; background: #fff7ed; color: #14532d; font-weight: 800; border-top: .7pt solid #fed7aa; }
  .c { text-align: center; }
  .d { text-align: right; font-family: 'JetBrains Mono', monospace; }
  .rojo { color: #b42318; }
  .vacio { color: #94a3b8; font-style: italic; text-align: center; padding: 6pt; }
  .columnas { display: grid; grid-template-columns: 1fr 1fr; gap: 8pt; }
  .card { overflow: hidden; background: #fff; border: .6pt solid #dee7e3; border-radius: 13pt; break-inside: avoid; }
  .card-title { padding: 7pt 8pt 5pt; color: #17201d; font-size: 9pt; font-weight: 850; }
  .card-subtitle { display: block; margin-top: 1pt; color: #66756f; font-size: 5.8pt; font-weight: 550; }
  .basic-card .card-title { padding-top: 8pt; }
  .concept-card { min-height: 72pt; }
  .closing-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8pt; align-items: stretch; }
  .closing-grid > .card, .closing-grid > .resumen-card { height: 100%; }
  .resumen-card { padding: 7pt; background: #fff; border: .6pt solid #dee7e3; border-radius: 13pt; break-inside: avoid; display: flex; flex-direction: column; }
  .resumen-card .card-title { padding: 0 1pt 6pt; }
  .resumen { width: 100%; }
  .resumen tr td { padding: 4pt 6pt; border-bottom: .5pt solid #edf3f0; }
  .resumen tr.neto td {
    background: #f97316; color: #fff;
    font-size: 9pt; font-weight: 850; border: 0;
  }
  .resumen tr.neto td:first-child { border-radius: 8pt 0 0 8pt; }
  .resumen tr.neto td:last-child { border-radius: 0 8pt 8pt 0; }
  .bloques { display: grid; grid-template-columns: 1fr 1fr; gap: 8pt; margin-top: 10pt; }
  .bloque { overflow: hidden; padding: 7pt; background: #fff; border: .6pt solid #dee7e3; border-radius: 13pt; break-inside: avoid; }
  .bloque header h3 { color: #14532d; font-size: 8pt; }
  .bloque header p { margin: 1pt 0 4pt; font-size: 5.8pt; color: #66756f; }
  .firmas { display: grid; grid-template-columns: 1fr 1fr; gap: 22pt; padding: 10pt 14pt 9pt; background: #fff; border: .6pt solid #dee7e3; border-radius: 13pt; break-inside: avoid; }
  .firma { min-width: 0; text-align: center; display: flex; flex-direction: column; }
  .firma-media { height: 47pt; display: flex; align-items: flex-end; justify-content: center; overflow: visible; }
  .firma .linea { width: 100%; border-top: .75pt solid #94a3b8; margin-top: 1pt; padding-top: 4pt; color: #14532d; font-weight: 800; }
  .firma-image { display: block; max-height: 45pt; max-width: 190pt; object-fit: contain; }
  .stamp-image { display: block; width: 180pt; max-height: 61pt; object-fit: contain; mix-blend-mode: multiply; }
  .firma small { color: #66756f; font-size: 5.8pt; }
  .document-footer { text-align: center; color: #66756f; font-size: 5.7pt; letter-spacing: .025em; }
</style></head>
<body>
<main>
  <header class="cabecera">
    <div class="brand">
      ${logo}
      <p class="brand-meta">${esc(d.empresa.nombre)}<br>NIT ${esc(d.empresa.nit)}</p>
    </div>
    <div class="doc">
      <p class="kicker">COMPROBANTE DIGITAL</p>
      <h1>Desprendible de nómina<br>del mes de ${esc(d.empleado.mesNomina)}</h1>
      <p class="periodo">${esc(d.empleado.periodo)}</p>
      ${d.empleado.estado ? `<span class="estado">${esc(d.empleado.estado)}</span>` : ''}
    </div>
    ${mascot}
  </header>

  <section class="card basic-card">
    <div class="identity-strip">
      <div><span class="identity-label">NOMBRE</span><span class="identity-value">${esc(d.empleado.nombre)}</span></div>
      <div><span class="identity-label">C.C.</span><span class="identity-value">${esc(d.empleado.cedula)}</span></div>
      <div><span class="identity-label">DÍAS LABORADOS</span><span class="identity-value">${esc(num(diasLaborados))}</span></div>
      <div><span class="identity-label">CARGO</span><span class="identity-value">${esc(d.empleado.cargo)}</span></div>
    </div>
    <h2 class="card-title">Información básica<span class="card-subtitle">Salario y conceptos ordinarios</span></h2>
    <table>
      <thead><tr><th>CONCEPTO</th><th class="c">CANT.</th><th class="d">VALOR</th></tr></thead>
      <tbody>${filas(basicos)}</tbody>
    </table>
  </section>

  <div class="columnas">
    ${tablaConceptos(`Adicionales del ${d.empleado.periodo}`, 'Bonos y recargos OTROS, PAREX y GEOPARK', adicionales)}
    ${tablaConceptos('Novedades y otros conceptos', 'Vacaciones, licencias y conceptos adicionales', novedades)}
  </div>

  <div class="closing-grid">
    ${tablaConceptos('Deducciones', 'Descuentos aplicados al periodo', d.deducciones, 'rojo')}
    <section class="resumen-card">
      <h2 class="card-title">Resumen de pago<span class="card-subtitle">Valor final del periodo</span></h2>
      <table class="resumen">
        <tr><td>Total ingresos</td><td class="d">${COP(totalDevengado)}</td></tr>
        <tr><td>Total deducciones</td><td class="d rojo">${COP(totalDeducido)}</td></tr>
        <tr class="neto"><td>NETO A PAGAR</td><td class="d">${COP(neto)}</td></tr>
      </table>
    </section>
  </div>

  ${bloques ? `<div class="bloques">${bloques}</div>` : ''}

  <div class="firmas">
    <div class="firma">
      <div class="firma-media">${d.firmaUrl ? `<img class="firma-image" src="${esc(d.firmaUrl)}" alt="Firma del conductor">` : ''}</div>
      <div class="linea">${esc(d.empleado.nombre)}</div>
      <small>C.C. ${esc(d.empleado.cedula)}${d.fechaFirma ? ` · Firmado el ${esc(d.fechaFirma)}` : ''}</small>
    </div>
    <div class="firma">
      <div class="firma-media">${stamp}</div>
      <div class="linea">${esc(d.empresa.nombre)}</div>
      <small>Empleador</small>
    </div>
  </div>
  <p class="document-footer">Documento generado electrónicamente por Cotransmeq · Conserva este comprobante para tu archivo.</p>
</main>
</body></html>`;
}
