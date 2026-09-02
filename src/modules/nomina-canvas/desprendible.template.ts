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
}

export interface DatosDesprendible {
  empresa: { nombre: string; nit: string };
  empleado: {
    nombre: string;
    cedula: string;
    cargo: string;
    /** `AGOSTO 2026 (21 JUL — 20 AGO)`. */
    periodo: string;
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

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<style>${opciones.prelude ?? ''}</style>
<style>
  @page { size: letter portrait; margin: 12mm 12mm 10mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: 'Inter Tight', system-ui, sans-serif;
    font-size: var(--tpdf-fs-body, 8pt);
    color: var(--tpdf-tinta, #0f172a);
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  h1, h2, h3 { margin: 0; font-family: 'Fraunces', Georgia, serif; }
  .cabecera {
    display: flex; justify-content: space-between; align-items: flex-start;
    border-bottom: 2pt solid var(--tpdf-verde, #0f4025); padding-bottom: 6pt;
  }
  .cabecera h1 { font-size: var(--tpdf-fs-titulo, 13pt); color: var(--tpdf-verde, #0f4025); }
  .cabecera .nit { font-size: var(--tpdf-fs-micro, 6.5pt); color: #475569; }
  .doc { text-align: right; }
  .doc h2 { font-size: var(--tpdf-fs-seccion, 10pt); }
  .estado {
    display: inline-block; margin-top: 3pt; padding: 1pt 6pt; border-radius: 9pt;
    background: var(--tpdf-verde-suave, #edf7f1); color: var(--tpdf-verde, #0f4025);
    font-size: var(--tpdf-fs-micro, 6.5pt); font-weight: 600; letter-spacing: .04em;
  }
  .empleado {
    display: grid; grid-template-columns: repeat(4, 1fr); gap: 4pt 10pt;
    margin: 8pt 0; padding: 6pt 8pt;
    background: var(--tpdf-verde-suave, #edf7f1); border-radius: 3pt;
  }
  .empleado dt { font-size: var(--tpdf-fs-micro, 6.5pt); color: #475569; letter-spacing: .04em; }
  .empleado dd { margin: 0; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  thead th {
    background: var(--tpdf-verde, #0f4025); color: #fff; text-align: left;
    padding: 3pt 5pt; font-size: var(--tpdf-fs-micro, 6.5pt); letter-spacing: .04em;
  }
  tbody td { padding: 2.5pt 5pt; border-bottom: .5pt solid #e2e8f0; }
  tfoot td { padding: 3pt 5pt; background: #e2e8f0; font-weight: 700; }
  .c { text-align: center; }
  .d { text-align: right; font-family: 'JetBrains Mono', monospace; }
  .rojo { color: #b91c1c; }
  .vacio { color: #94a3b8; font-style: italic; text-align: center; padding: 6pt; }
  /* Devengos y deducciones en paralelo, como en la hoja de cálculo: leerlos
     uno debajo del otro obliga a pasar página para comparar. */
  .columnas { display: grid; grid-template-columns: 1fr 1fr; gap: 8pt; margin-top: 6pt; }
  .resumen { margin-top: 8pt; margin-left: auto; width: 55%; }
  .resumen tr td { padding: 3pt 5pt; border-bottom: .5pt solid #e2e8f0; }
  .resumen tr.neto td {
    background: var(--tpdf-verde, #0f4025); color: #fff;
    font-size: var(--tpdf-fs-seccion, 10pt); font-weight: 700; border: 0;
  }
  .bloques { display: grid; grid-template-columns: 1fr 1fr; gap: 8pt; margin-top: 10pt; }
  .bloque header h3 { font-size: var(--tpdf-fs-head, 7.5pt); }
  .bloque header p { margin: 1pt 0 3pt; font-size: var(--tpdf-fs-micro, 6.5pt); color: #475569; }
  /* Un bloque no se parte entre páginas: media tabla de recargos arriba y
     media abajo no se entiende. */
  .bloque { break-inside: avoid; }
  .firmas { margin-top: 18pt; display: grid; grid-template-columns: 1fr 1fr; gap: 24pt; }
  .firma { text-align: center; }
  .firma .linea { border-top: .75pt solid #0f172a; margin-top: 26pt; padding-top: 3pt; }
  .firma img { max-height: 26pt; }
  .firma small { color: #475569; font-size: var(--tpdf-fs-micro, 6.5pt); }
</style></head>
<body>
  <div class="cabecera">
    <div>
      <h1>${esc(d.empresa.nombre)}</h1>
      <p class="nit">NIT ${esc(d.empresa.nit)}</p>
    </div>
    <div class="doc">
      <h2>DESPRENDIBLE DE NÓMINA</h2>
      <p class="nit">${esc(d.empleado.periodo)}</p>
      ${d.empleado.estado ? `<span class="estado">${esc(d.empleado.estado)}</span>` : ''}
    </div>
  </div>

  <dl class="empleado">
    <div><dt>EMPLEADO</dt><dd>${esc(d.empleado.nombre)}</dd></div>
    <div><dt>CÉDULA</dt><dd>${esc(d.empleado.cedula)}</dd></div>
    <div><dt>CARGO</dt><dd>${esc(d.empleado.cargo)}</dd></div>
    <div><dt>PERIODO</dt><dd>${esc(d.empleado.periodo)}</dd></div>
  </dl>

  <div class="columnas">
    <table>
      <thead><tr><th>DEVENGOS</th><th class="c">CANT.</th><th class="d">VALOR</th></tr></thead>
      <tbody>${filas(d.devengos)}</tbody>
      <tfoot><tr><td colspan="2">TOTAL DEVENGADO</td><td class="d">${COP(totalDevengado)}</td></tr></tfoot>
    </table>
    <table>
      <thead><tr><th>DEDUCCIONES</th><th class="c">CANT.</th><th class="d">VALOR</th></tr></thead>
      <tbody>${filas(d.deducciones, 'rojo')}</tbody>
      <tfoot><tr><td colspan="2">TOTAL DEDUCCIONES</td><td class="d rojo">${COP(totalDeducido)}</td></tr></tfoot>
    </table>
  </div>

  <table class="resumen">
    <tr><td>Base prestacional</td><td class="d">${COP(d.basePrestacional)}</td></tr>
    <tr><td>Total devengado</td><td class="d">${COP(totalDevengado)}</td></tr>
    <tr><td>Total deducciones</td><td class="d rojo">${COP(totalDeducido)}</td></tr>
    <tr class="neto"><td>NETO A PAGAR</td><td class="d">${COP(neto)}</td></tr>
  </table>

  ${bloques ? `<div class="bloques">${bloques}</div>` : ''}

  <div class="firmas">
    <div class="firma">
      ${d.firmaUrl ? `<img src="${esc(d.firmaUrl)}" alt="">` : ''}
      <div class="linea">${esc(d.empleado.nombre)}</div>
      <small>C.C. ${esc(d.empleado.cedula)}${d.fechaFirma ? ` · Firmado el ${esc(d.fechaFirma)}` : ''}</small>
    </div>
    <div class="firma">
      <div class="linea">${esc(d.empresa.nombre)}</div>
      <small>Empleador</small>
    </div>
  </div>
</body></html>`;
}
