import { buildFontsCss, loadFontAsDataUrl } from './fonts';
import { fmt } from './formatters';
import { pdfCssVars } from './pdf-tokens';
import path from 'path';
import fs from 'fs';

/**
 * Plantilla HTML + CSS del PDF nativo de una liquidación de tercero.
 *
 * Estructura:
 *  1. Header editorial (logo + título + meta del documento)
 *  2. Period bar (mes/año/placa/consecutivo/tercero)
 *  3. Tabla de items de la liquidación
 *  4. Bloque de descuentos: conductores + gastos + anticipos + impuestos
 *  5. Resumen por copropietario (cards) cuando es_multi_propietario
 *  6. Totales finales (TOTAL DESCUENTOS / TOTAL A PAGAR)
 *  7. Firmas (LIQUIDADO POR / ACEPTADO POR)
 *
 * Renderizado por `pdfFromHtml()` de `services/pdf.service.ts`
 * (Puppeteer + Chromium). Usa `@page Letter landscape` para aprovechar
 * al máximo la hoja.
 *
 * @see /Users/julianlopez/Desktop/transmeralda/ingreso-svelte/src/lib/components/PreviewTerceroPDF.svelte
 *      (mismo modelo de cálculo para que preview y PDF sean coherentes)
 */

const SELLO_PATH = path.join(__dirname, '..', '..', 'assets', 'sello-firma-terceros.png');
// `logo_transmeralda-264.webp` no existe en este repo: el encabezado caía
// siempre a la caja de respaldo. El arte de Cotransmeq sí está, y aquí el
// webp vale porque quien renderiza es Chromium, no pdfkit.
const LOGO_PATH = path.join(__dirname, '..', '..', 'assets', 'logo_cotransmeq-264.webp');

let selloDataUrl: string | null = null;
function getSelloDataUrl(): string {
  if (selloDataUrl !== null) return selloDataUrl;
  try {
    const buf = fs.readFileSync(SELLO_PATH);
    selloDataUrl = `data:image/png;base64,${buf.toString('base64')}`;
  } catch {
    selloDataUrl = '';
  }
  return selloDataUrl;
}

let logoDataUrl: string | null = null;
function getLogoDataUrl(): string {
  if (logoDataUrl !== null) return logoDataUrl;
  try {
    const buf = fs.readFileSync(LOGO_PATH);
    logoDataUrl = `data:image/webp;base64,${buf.toString('base64')}`;
  } catch {
    logoDataUrl = '';
  }
  return logoDataUrl;
}

const ORDEN_IMPUESTOS = [
  'RETENCION_ICA',
  'AVISOS_TABLEROS',
  'SOBRETASA_BOMBERIL',
  'RETENCION_FUENTE',
];

// Espejo de `SALARIOS` en `conductor-grupos.service.ts` del canvas. Lo que no
// esté aquí NO SE IMPRIME en el documento que se le manda al tercero, aunque
// esté guardado y se vea en la hoja.
const TIPOS_CONCEPTO_LABORAL = new Set([
  'SALARIO',
  'AUXILIO_TRANSPORTE',
  'BONIFICACION',
  'BONIFICACION_TURNO_DOBLE',
  'OTROS_AUXILIOS',
  'RECARGOS',
]);
const TIPOS_PRESTACIONES = new Set([
  'CESANTIAS',
  'INTERESES_CESANTIAS',
  'PRIMA',
  'VACACIONES',
]);
const TIPOS_SEGURIDAD = new Set(['SALUD', 'PENSION', 'ARP', 'PARAFISCALES']);

// ════════════════════════════════════════════════════════════════════════
// CSS
// ════════════════════════════════════════════════════════════════════════

/**
 * Familias de tabla del documento.
 *
 * Todas comparten la MISMA rejilla. Antes cada bloque tenía su propio
 * estilo —la de items con cabecera verde y rejilla completa, las de
 * descuentos con cabecera gris claro y solo línea inferior, las cards con
 * bordes redondeados y degradados— y el resultado era un documento con
 * cuatro lenguajes visuales.
 *
 * Se declaran como lista para que la regla base se escriba UNA vez. Añadir
 * una tabla nueva es añadirla aquí, no copiar treinta declaraciones.
 */
const TABLAS = [
  '.items-tbl',
  '.conductor-tbl',
  '.desc-tbl',
  '.card-tbl',
  '.liq-servicio-tbl',
  '.resumen-tbl',
];

/** `.a, .b` → `.a th, .b th` */
const cada = (sufijo: string) => TABLAS.map((t) => `${t} ${sufijo}`).join(',\n');

const CSS = `
@page {
  size: letter landscape;
  margin: 8mm 8mm 6mm;
}

/* ── Tokens ──────────────────────────────────────────────────────────
   Espejo de ingreso-svelte/src/lib/styles/pdf-tokens.ts, verificado por
   pdf-tokens.spec.ts. Escala 1: este ES el documento impreso. */
:root { ${pdfCssVars(1)} }

/* ── Reset y base ───────────────────────────────────────────────── */
* { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 0;
  background: #fff;
  color: var(--tpdf-tinta);
  font-family: var(--tpdf-fuente-sans);
  font-size: var(--tpdf-fs-body);
  line-height: 1.3;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

/* ── HEADER EDITORIAL ────────────────────────────────────────────── */
.header {
  display: grid;
  grid-template-columns: 100px 1fr 200px;
  border: var(--tpdf-borde-marco) solid var(--tpdf-marco);
  margin-bottom: 3px;
}
.header-logo {
  border-right: var(--tpdf-borde-marco) solid var(--tpdf-marco);
  padding: 6px 10px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.header-logo img {
  height: 38px;
  width: auto;
  object-fit: contain;
}
.header-title {
  padding: 4px 12px;
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.header-title .co {
  font-size: var(--tpdf-fs-seccion);
  font-weight: 800;
  color: var(--tpdf-verde);
  text-transform: uppercase;
  letter-spacing: -0.01em;
  line-height: 1.2;
}
.header-title .doc {
  font-size: var(--tpdf-fs-foot);
  font-weight: 700;
  color: var(--tpdf-tinta-suave);
  margin-top: 1px;
  line-height: 1.2;
}
.header-meta {
  border-left: var(--tpdf-borde-marco) solid var(--tpdf-marco);
  display: flex;
}
.header-meta table {
  width: 100%;
  border-collapse: collapse;
  height: 100%;
}
.header-meta td {
  padding: 2px 6px;
  font-size: var(--tpdf-fs-head);
  border-bottom: var(--tpdf-borde-rejilla) solid var(--tpdf-rejilla);
  border-left: var(--tpdf-borde-rejilla) solid var(--tpdf-rejilla);
}
.header-meta tr:last-child td { border-bottom: none; }
.header-meta td.ml {
  font-weight: 700;
  background: var(--tpdf-interno-bg);
  color: var(--tpdf-tinta-suave);
  white-space: nowrap;
  text-align: right;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  width: 64px;
  border-right: var(--tpdf-borde-rejilla) solid var(--tpdf-marco);
}
.header-meta td.mv {
  font-weight: 800;
  color: var(--tpdf-verde);
  text-align: left;
  font-family: var(--tpdf-fuente-mono);
}

/* ── BANDA DE PERIODO ────────────────────────────────────────────── */
.period {
  border: var(--tpdf-borde-rejilla) solid var(--tpdf-marco);
  margin-bottom: 3px;
  display: flex;
  flex-wrap: wrap;
  background: var(--tpdf-verde-suave);
}
.period .pc {
  padding: 3px 9px;
  border-right: var(--tpdf-borde-rejilla) solid var(--tpdf-rejilla);
  display: flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}
.period .pc:last-child { border-right: none; flex: 1; }
.period .pc .lbl {
  color: var(--tpdf-tinta-tenue);
  font-weight: 600;
  font-size: var(--tpdf-fs-head);
}
.period .pc .val {
  color: var(--tpdf-verde);
  font-weight: 800;
  font-size: var(--tpdf-fs-foot);
  font-family: var(--tpdf-fuente-mono);
}

/* ════════════════════════════════════════════════════════════════════
   REJILLA ÚNICA
   Todas las tablas del documento, con el mismo borde, la misma cabecera
   verde y el mismo pie. Lo que cambia entre bloques es el CONTENIDO, no
   el lenguaje visual.
   ════════════════════════════════════════════════════════════════════ */
${TABLAS.join(',\n')} {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--tpdf-fs-body);
  table-layout: fixed;
}

/* Cabecera repetida en cada página cuando la tabla se parte. */
${cada('thead')} { display: table-header-group; }

${cada('th')} {
  background: var(--tpdf-verde);
  color: #fff;
  padding: var(--tpdf-pad-y) var(--tpdf-pad-x);
  font-weight: 700;
  text-align: center;
  border: var(--tpdf-borde-rejilla) solid var(--tpdf-verde-borde);
  font-size: var(--tpdf-fs-head);
  letter-spacing: 0.02em;
  overflow-wrap: break-word;
  line-height: 1.15;
  text-transform: uppercase;
}

${cada('td')} {
  padding: var(--tpdf-pad-y) var(--tpdf-pad-x);
  border: var(--tpdf-borde-rejilla) solid var(--tpdf-rejilla);
  vertical-align: middle;
  overflow-wrap: break-word;
  line-height: 1.15;
}

${cada('tfoot td')} {
  font-weight: 800;
  background: var(--tpdf-foot-bg);
  border-top: var(--tpdf-borde-marco) solid var(--tpdf-verde-borde);
}

/* Modificadores de celda, comunes a todas las tablas. */
${cada('td.num')},
${cada('td.tc')} { text-align: center; }
${cada('td.num')} {
  font-family: var(--tpdf-fuente-mono);
  font-weight: 700;
}
${cada('td.mc')},
${cada('td.val')},
${cada('td.tot')},
${cada('td.v')} {
  text-align: right;
  font-family: var(--tpdf-fuente-mono);
  font-weight: 700;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
${cada('td.tot')} { font-weight: 800; color: var(--tpdf-tinta); }
${cada('td.val')} { color: var(--tpdf-tinta-suave); font-weight: 600; }
${cada('td.pct')} {
  text-align: center;
  font-family: var(--tpdf-fuente-mono);
  color: var(--tpdf-tinta-tenue);
}
${cada('td.lbl')} {
  text-align: right;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  font-weight: 700;
}

/* Columnas de uso interno: gris, para que se lean como "no es del cliente".
   Hoy este template no emite ninguna; la regla se conserva porque el preview
   sí las tiene y las dos vistas deben poder mostrar las mismas columnas. */
${cada('th.col-internal')} {
  background: var(--tpdf-interno-head);
  border-color: var(--tpdf-interno-borde);
}
${cada('td.col-internal')} { background: var(--tpdf-interno-bg); }

/* ── TABLA DE ITEMS ─────────────────────────────────────────────── */
.items-wrap {
  break-inside: auto;
  page-break-inside: auto;
}
/* Celdas largas (cliente / recorrido): dejan respirar horizontalmente
   antes de saltar de línea. */
.items-tbl td.long {
  overflow-wrap: normal;
  word-break: keep-all;
}
.items-tbl tbody tr.t-adicional td {
  background: var(--tpdf-verde-suave);
  color: var(--tpdf-verde);
  font-weight: 800;
}
.items-tbl tfoot td.lbl-tot {
  text-align: right;
  padding-right: 6px;
  text-transform: uppercase;
}

/* ── TÍTULOS DE SECCIÓN ─────────────────────────────────────────── */
.desc-section-title,
.cards-title {
  font-size: var(--tpdf-fs-titulo);
  font-weight: 800;
  color: var(--tpdf-verde);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  margin: 8px 0 5px;
  padding-bottom: 3px;
  border-bottom: var(--tpdf-borde-marco) solid var(--tpdf-verde);
}
.cards-title { margin-top: 12px; }

/* Empuja el bloque que sigue a "DESCUENTOS POR LA PRESTACIÓN DEL
   SERVICIO" (gastos, anticipos, impuestos, cards de copropietario,
   totales, firmas) a una nueva página cuando ya no entra en la primera. */
.page-break-before {
  page-break-before: always;
  break-before: page;
}

/* ── DESCUENTOS POR CONDUCTOR ───────────────────────────────────── */
.conductores-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  break-inside: auto;
}
.conductor-card {
  border: var(--tpdf-borde-rejilla) solid var(--tpdf-rejilla);
  break-inside: avoid;
}
.conductor-head {
  padding: var(--tpdf-pad-y) var(--tpdf-pad-x);
  background: var(--tpdf-interno-bg);
  border-bottom: var(--tpdf-borde-rejilla) solid var(--tpdf-rejilla);
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
  font-size: var(--tpdf-fs-head);
}
.conductor-head .lbl {
  color: var(--tpdf-tinta-tenue);
  font-weight: 700;
  text-transform: uppercase;
}
.conductor-head .name {
  font-size: var(--tpdf-fs-foot);
  font-weight: 800;
  color: var(--tpdf-tinta);
}
.conductor-head .id {
  font-family: var(--tpdf-fuente-mono);
  font-weight: 700;
  color: var(--tpdf-tinta-suave);
}
/* Fila de categoría dentro de la tabla del conductor. */
.conductor-tbl td.cat {
  background: var(--tpdf-verde-suave);
  color: var(--tpdf-verde-texto);
  font-weight: 700;
  text-transform: uppercase;
}
.conductor-tbl td.sub {
  color: var(--tpdf-tinta-tenue);
  padding-left: 14px;
}
.conductor-total {
  padding: var(--tpdf-pad-y) var(--tpdf-pad-x);
  background: var(--tpdf-verde-suave);
  border: var(--tpdf-borde-rejilla) solid var(--tpdf-rejilla);
  border-top: var(--tpdf-borde-marco) solid var(--tpdf-verde);
  font-weight: 800;
  display: flex;
  justify-content: space-between;
  font-size: var(--tpdf-fs-foot);
  color: var(--tpdf-verde-texto);
}
.conductor-total .v {
  font-family: var(--tpdf-fuente-mono);
  font-variant-numeric: tabular-nums;
}

/* ── GASTOS / ANTICIPOS / IMPUESTOS ─────────────────────────────── */
.desc-grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 6px;
}
.desc-grid-3 {
  display: grid;
  grid-template-columns: 1.1fr 0.9fr 1fr;
  gap: 8px;
  margin-top: 6px;
}
.desc-block { break-inside: avoid; }

/* Los tres bloques comparten el título; solo cambia el color de la línea
   izquierda, que es lo único que hace falta para distinguirlos. */
.desc-block-title {
  font-size: var(--tpdf-fs-seccion);
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  margin: 0 0 4px;
  padding: 3px 8px;
  background: var(--tpdf-interno-bg);
  border: var(--tpdf-borde-rejilla) solid var(--tpdf-rejilla);
  border-left: 4px solid var(--tpdf-verde);
  color: var(--tpdf-verde-texto);
}
.desc-block-gastos .desc-block-title {
  border-left-color: var(--tpdf-ambar);
  color: var(--tpdf-ambar);
}
.desc-block-anticipos .desc-block-title {
  border-left-color: var(--tpdf-azul);
  color: var(--tpdf-azul);
}
.desc-block-impuestos .desc-block-title {
  border-left-color: var(--tpdf-rojo);
  color: var(--tpdf-rojo);
}
.desc-block-gastos tfoot td.v { color: var(--tpdf-ambar); }
.desc-block-anticipos tfoot td.v { color: var(--tpdf-azul); }
.desc-block-impuestos tfoot td.v { color: var(--tpdf-rojo); }

/* ── TOTALES DEL SERVICIO ───────────────────────────────────────── */
.liq-servicio-tbl { margin-bottom: 6px; }
.liq-servicio-row td { font-size: var(--tpdf-fs-foot); }
.liq-servicio-label {
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.liq-servicio-val {
  text-align: right;
  font-family: var(--tpdf-fuente-mono);
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.liq-servicio-row-disc td {
  background: var(--tpdf-interno-bg);
  color: var(--tpdf-rojo);
}
.liq-servicio-row-disc .liq-servicio-val { color: var(--tpdf-rojo); }
.liq-servicio-row-final td {
  background: var(--tpdf-verde-suave);
  color: var(--tpdf-verde-texto);
  border-top: var(--tpdf-borde-marco) solid var(--tpdf-verde);
}
.liq-servicio-row-final .liq-servicio-label { font-weight: 800; }
.liq-servicio-row-final .liq-servicio-val {
  color: var(--tpdf-verde);
  font-weight: 900;
}

/* ── COPROPIETARIOS ─────────────────────────────────────────────── */
.cards-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  margin-top: 6px;
}
/* Antes eran tarjetas con border-radius, sombra y degradado. Puppeteer
   rasteriza mal los degradados —salen bandeados— y el redondeo rompía la
   continuidad con el resto del documento, que es todo rejilla. */
.card {
  background: #fff;
  border: var(--tpdf-borde-rejilla) solid var(--tpdf-rejilla);
  break-inside: avoid;
  page-break-inside: avoid;
}
.card-header {
  background: var(--tpdf-verde);
  color: #fff;
  padding: var(--tpdf-pad-y) var(--tpdf-pad-x);
  font-weight: 800;
  font-size: var(--tpdf-fs-head);
  display: flex;
  justify-content: space-between;
  align-items: center;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  border-bottom: var(--tpdf-borde-rejilla) solid var(--tpdf-verde-borde);
}
.card-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.card-pct {
  font-family: var(--tpdf-fuente-mono);
  font-weight: 700;
  flex-shrink: 0;
  margin-left: 6px;
}
.card-tbl td { border-left: none; border-right: none; }
.card-lbl {
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--tpdf-tinta-suave);
}
.card-val {
  text-align: right;
  font-family: var(--tpdf-fuente-mono);
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.card-conc {
  color: var(--tpdf-rojo);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}
.card-rate {
  text-align: center;
  font-family: var(--tpdf-fuente-mono);
  color: var(--tpdf-tinta-tenue);
}
.card-tr-gross td {
  background: var(--tpdf-verde-suave);
  color: var(--tpdf-verde-texto);
  font-weight: 800;
}
.card-tr-discount-detail .card-val { color: var(--tpdf-rojo); }
.card-tr-discount-total td {
  background: var(--tpdf-foot-bg);
  color: var(--tpdf-rojo);
  font-weight: 800;
  border-top: var(--tpdf-borde-marco) solid var(--tpdf-rojo);
}
.card-tr-pagar td {
  background: var(--tpdf-verde);
  color: #fff;
  font-weight: 900;
  border-top: var(--tpdf-borde-marco) solid var(--tpdf-verde-borde);
}
.card-tr-pagar .card-lbl { color: #fff; }
.card-tr-pagar .card-val { color: #fff; font-size: var(--tpdf-fs-seccion); }

/* NOTA: aquí vivía un bloque .card-credito* (aviso de abono a crédito) de
   unas 40 líneas cuyas clases NO las emite ningún render de este fichero.
   Se elimina: era CSS muerto que se arrastraba en cada refactor y hacía
   creer que el documento tiene una variante que en realidad no existe.
   El aviso vivo es .card-transmer-full, aquí debajo.
   (Ojo: dentro de este literal no se pueden usar acentos graves.) */

/* Fila ancho-completo del tercero asociado a la liquidación. */
.card-transmer-full {
  grid-column: 1 / -1;
  border: var(--tpdf-borde-marco) solid var(--tpdf-verde);
  padding: 8px 12px;
  break-inside: avoid;
}
.card-transmer-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  border-bottom: var(--tpdf-borde-rejilla) solid var(--tpdf-verde);
  padding-bottom: 5px;
  margin-bottom: 5px;
}
.card-transmer-title {
  font-weight: 900;
  font-size: var(--tpdf-fs-seccion);
  color: var(--tpdf-verde);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.card-transmer-pct {
  background: var(--tpdf-verde);
  color: #fff;
  padding: 2px 10px;
  font-size: var(--tpdf-fs-head);
  font-family: var(--tpdf-fuente-mono);
  font-weight: 800;
}
.card-transmer-body {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 3px 0;
}
.card-transmer-label {
  font-weight: 700;
  font-size: var(--tpdf-fs-foot);
  color: var(--tpdf-verde-texto);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.card-transmer-val {
  font-family: var(--tpdf-fuente-mono);
  font-weight: 900;
  font-size: var(--tpdf-fs-titulo);
  color: var(--tpdf-verde);
  font-variant-numeric: tabular-nums;
}
.card-transmer-foot {
  margin-top: 4px;
  font-size: var(--tpdf-fs-head);
  color: var(--tpdf-verde-texto);
  font-style: italic;
  text-align: right;
}

/* ── RESUMEN FINAL ──────────────────────────────────────────────── */
/* Era un flex de divs con radios y fondos propios. Ahora es una tabla más:
   mismo pie, mismos bordes, misma alineación de cifras. */
.resumen {
  margin-top: 8px;
  display: flex;
  justify-content: flex-end;
  break-inside: avoid;
}
.resumen-tbl {
  width: auto;
  min-width: 320px;
  table-layout: auto;
}
.resumen-tbl td.lbl {
  text-align: left;
  font-weight: 800;
  font-size: var(--tpdf-fs-foot);
}
.resumen-tbl tr.desc td {
  background: var(--tpdf-interno-bg);
  color: var(--tpdf-rojo);
}
.resumen-tbl tr.pagar td {
  background: var(--tpdf-verde);
  color: #fff;
  font-weight: 900;
  font-size: var(--tpdf-fs-seccion);
  border-color: var(--tpdf-verde-borde);
}

/* ── FIRMAS ─────────────────────────────────────────────────────── */
.sigs {
  margin-top: 10px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  break-inside: avoid;
}
.sig {
  padding: 4px 10px 8px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  height: 110px;
  min-height: 110px;
  position: relative;
}
.sig-lbl {
  font-weight: 800;
  color: var(--tpdf-verde);
  font-size: var(--tpdf-fs-seccion);
  letter-spacing: 0.03em;
  text-align: left;
}
.sig-img {
  position: absolute;
  top: 65%;
  left: 50%;
  transform: translate(-50%, -50%);
  max-height: 120px;
  max-width: 480px;
  width: auto;
  height: auto;
  object-fit: contain;
}
.sig-line {
  border-top: var(--tpdf-borde-rejilla) solid var(--tpdf-marco);
  padding-top: 6px;
  font-size: var(--tpdf-fs-head);
  font-style: italic;
  color: var(--tpdf-tinta-tenue);
}
`;

// ════════════════════════════════════════════════════════════════════════
// HELPERS DE RENDERIZADO
// ════════════════════════════════════════════════════════════════════════

function renderItemsTable(item: any): string {
  const rows = (item.items || []).filter((it: any) => {
    const lt = it.liquidacion_tercero || {};
    const vAdmin = lt.valor_admin || 0;
    const total = lt.total_facturado || 0;
    const vLiq = lt.valor_liquidar || 0;
    return !(vAdmin === 0 && total === 0 && vLiq === 0);
  });
  const adicionales = Array.isArray(item.items_adicionales) ? item.items_adicionales : [];

  let html = `<div class="items-wrap"><table class="items-tbl">
    <colgroup>
      <col style="width:2.7%"><col style="width:13%"><col style="width:5.4%"><col style="width:5.4%">
      <col style="width:8.7%"><col style="width:12%"><col style="width:8.7%"><col style="width:8.2%">
      <col style="width:3.3%"><col style="width:3.8%"><col style="width:8.2%"><col style="width:8.2%">
      <col style="width:12.4%">
      <!-- Suma exacta = 100% -->
    </colgroup>
    <thead>
      <tr>
        <th>#</th><th>CLIENTE</th><th># LIQ</th><th>PLACA</th><th>NOMBRE 3°</th>
        <th>RECORRIDO</th><th>FECHAS</th><th>V/UNIDAD</th><th>CANT</th>
        <th>ADMON%</th><th>ADMON $</th><th>TOTAL</th>
        <th>V/LIQUIDAR</th>
      </tr>
    </thead><tbody>`;

  rows.forEach((it: any, idx: number) => {
    const lt = it.liquidacion_tercero || {};
    const liq = lt.liquidacion || {};
    const terc = lt.tercero || {};
    html += `<tr>
      <td class="num">${idx + 1}</td>
      <td class="long">${fmt.esc(liq.cliente?.nombre || '')}</td>
      <td class="tc">${fmt.esc(liq.consecutivo || '')}</td>
      <td class="tc" style="font-weight:700">${fmt.esc(fmt.fmtPlaca(lt.placa || item.placa))}</td>
      <td>${fmt.esc(terc.nombre_completo || item.tercero?.nombre_completo || '—')}</td>
      <td class="long">${fmt.esc(lt.recorrido || lt.placa || item.placa)}</td>
      <td class="tc">${fmt.esc(lt.fechas || '')}</td>
      <td class="mc">${fmt.COP(lt.valor_unitario || 0)}</td>
      <td class="num">${lt.cantidad || 1}</td>
      <td class="num">${lt.porcentaje_admin || 0}%</td>
      <td class="mc" style="color:#b91c1c">${fmt.COP(lt.valor_admin || 0)}</td>
      <td class="mc">${fmt.COP(lt.total_facturado || 0)}</td>
      <td class="mc" style="font-weight:800;color:#0f4025">${fmt.COP(lt.valor_liquidar || 0)}</td>
    </tr>`;
  });

  // Filas virtuales adicionales (TRANSMERALDA)
  adicionales.forEach((adc: any) => {
    const vLiqGross = (adc.valor_unitario || 0) * (adc.cantidad || 1);
    const pctAdc = Number(adc.porcentaje_admin) || 0;
    const vAdminAdc =
      adc.valor_admin != null
        ? adc.valor_admin
        : Math.round((vLiqGross * pctAdc) / 100);
    const vLiqNeto = vLiqGross - vAdminAdc;
    html += `<tr class="t-adicional">
      <td class="num">T</td>
      <td>${fmt.esc(adc.cliente || 'TRANSMERALDA')}</td>
      <td class="tc" style="color:#94a3b8">—</td>
      <td class="tc" style="font-weight:700">${fmt.esc(fmt.fmtPlaca(adc.placa || item.placa))}</td>
      <td>${fmt.esc(adc.tercero_nombre || item.tercero?.nombre_completo || '—')}</td>
      <td>${fmt.esc(adc.recorrido || '—')}</td>
      <td class="tc">${fmt.esc(adc.fechas || '')}</td>
      <td class="mc">${fmt.COP(adc.valor_unitario || 0)}</td>
      <td class="num">${adc.cantidad || 1}</td>
      <td class="num">${pctAdc ? pctAdc.toFixed(2) + '%' : '0%'}</td>
      <td class="mc" style="color:#b91c1c">${fmt.COP(vAdminAdc)}</td>
      <td class="mc">${fmt.COP(vLiqGross)}</td>
      <td class="mc" style="font-weight:800;color:#0f4025">${fmt.COP(vLiqNeto)}</td>
    </tr>`;
  });

  // Totales
  const totAdmin = rows.reduce(
    (s: number, it: any) => s + (it.liquidacion_tercero?.valor_admin || 0),
    0
  ) + adicionales.reduce((s: number, a: any) => {
    const v = (a.valor_unitario || 0) * (a.cantidad || 1);
    const pct = Number(a.porcentaje_admin) || 0;
    return s + (a.valor_admin != null ? a.valor_admin : Math.round((v * pct) / 100));
  }, 0);

  const totFact = rows.reduce(
    (s: number, it: any) => s + (it.liquidacion_tercero?.total_facturado || 0),
    0
  ) + adicionales.reduce(
    (s: number, a: any) => s + (a.valor_unitario || 0) * (a.cantidad || 1),
    0
  );

  const totLiq = rows.reduce(
    (s: number, it: any) => s + (it.liquidacion_tercero?.valor_liquidar || 0),
    0
  ) + adicionales.reduce((s: number, a: any) => {
    const v = (a.valor_unitario || 0) * (a.cantidad || 1);
    const pct = Number(a.porcentaje_admin) || 0;
    const adm = a.valor_admin != null ? a.valor_admin : Math.round((v * pct) / 100);
    return s + (v - adm);
  }, 0);

  html += `</tbody><tfoot><tr>
    <td colspan="10" class="lbl-tot">TOTALES</td>
    <td class="mc" style="color:#b91c1c">${fmt.COP(totAdmin)}</td>
    <td class="mc">${fmt.COP(totFact)}</td>
    <td class="mc" style="color:#0f4025">${fmt.COP(totLiq)}</td>
  </tr></tfoot></table></div>`;

  return html;
}

function renderConductoresGrid(item: any): string {
  const conceptos = item.conceptos || [];
  const laborales = conceptos.filter((c: any) => c.tipo === 'COSTO_LABORAL');
  if (laborales.length === 0) return '';

  let conductoresHtml = '';
  const porConductor = new Map<string, any[]>();
  for (const c of laborales) {
    const k = c.conductor_id || 'sin-conductor';
    if (!porConductor.has(k)) porConductor.set(k, []);
    porConductor.get(k)!.push(c);
  }
  for (const [, grupo] of porConductor) {
    const c0 = grupo[0];
    const nombre = c0.conductor
      ? `${c0.conductor.nombre} ${c0.conductor.apellido}`
      : 'General / Consolidado';
    const id = c0.conductor?.numero_identificacion || '';
    const total = grupo.reduce((s, c) => s + (c.valor_total || 0), 0);
    const salarios = grupo.filter((c) => TIPOS_CONCEPTO_LABORAL.has(c.concepto));
    const prestaciones = grupo.filter((c) => TIPOS_PRESTACIONES.has(c.concepto));
    const seguridad = grupo.filter((c) => TIPOS_SEGURIDAD.has(c.concepto));

    let rows = '';
    salarios.forEach((c) => {
      rows += `<tr>
        <td>${fmt.esc(c.concepto.replace(/_/g, ' '))}</td>
        <td class="pct">${c.dias ?? ''}</td>
        <td></td>
        <td class="val">${fmt.COP(c.valor_unitario || 0)}</td>
        <td class="tot">${fmt.COP(c.valor_total || 0)}</td>
      </tr>`;
    });
    if (prestaciones.length > 0) {
      const pct = prestaciones.reduce((s, c) => s + (c.porcentaje || 0), 0);
      const t = prestaciones.reduce((s, c) => s + (c.valor_total || 0), 0);
      rows += `<tr><td class="cat">PRESTACIONES SOCIALES</td><td class="pct">${fmt.fmtPct(pct)}</td><td></td><td></td><td class="tot">${fmt.COP(t)}</td></tr>`;
      prestaciones.forEach((c) => {
        rows += `<tr><td class="sub">${fmt.esc(c.concepto.replace(/_/g, ' '))}</td><td class="pct">${fmt.fmtPct(c.porcentaje)}</td><td></td><td></td><td class="tot">${fmt.COP(c.valor_total || 0)}</td></tr>`;
      });
    }
    if (seguridad.length > 0) {
      const pct = seguridad.reduce((s, c) => s + (c.porcentaje || 0), 0);
      const t = seguridad.reduce((s, c) => s + (c.valor_total || 0), 0);
      rows += `<tr><td class="cat">SEGURIDAD SOCIAL</td><td class="pct">${fmt.fmtPct(pct)}</td><td></td><td></td><td class="tot">${fmt.COP(t)}</td></tr>`;
      seguridad.forEach((c) => {
        rows += `<tr><td class="sub">${fmt.esc(c.concepto.replace(/_/g, ' '))}</td><td class="pct">${fmt.fmtPct(c.porcentaje)}</td><td></td><td></td><td class="tot">${fmt.COP(c.valor_total || 0)}</td></tr>`;
      });
    }

    conductoresHtml += `<div class="conductor-card">
      <div class="conductor-head">
        <span class="lbl">NOMBRE:</span>
        <span class="name">${fmt.esc(nombre)}</span>
        ${id ? `<span class="id">· CC ${fmt.esc(id)}</span>` : ''}
      </div>
      <table class="conductor-tbl">
        <thead><tr><th>CONCEPTO</th><th>DIAS / %</th><th></th><th>VALOR</th><th>TOTAL</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="conductor-total">
        <span>VALOR TOTAL CONDUCTOR</span>
        <span class="v">${fmt.COP(total)}</span>
      </div>
    </div>`;
  }

  return `
    <div class="desc-section-title">DESCUENTOS POR LA PRESTACIÓN DEL SERVICIO</div>
    <div class="conductores-grid">${conductoresHtml}</div>
  `;
}

function renderDescuentosResto(item: any): string {
  const conceptos = item.conceptos || [];
  const gastos = conceptos.filter((c: any) => c.tipo === 'GASTO_OPERATIVO');
  const anticipos = conceptos.filter((c: any) => c.tipo === 'ANTICIPO');
  const impuestos = conceptos.filter((c: any) => c.tipo === 'IMPUESTO');

  // ── Gastos ──
  const gastosRows = gastos
    .map(
      (c: any) => `<tr>
        <td>${fmt.esc(c.concepto.replace(/_/g, ' '))}</td>
        <td class="pct">${c.dias ?? ''}</td>
        <td></td>
        <td class="val">${fmt.COP(c.valor_unitario || 0)}</td>
        <td class="tot">${fmt.COP(c.valor_total || 0)}</td>
      </tr>`
    )
    .join('');
  const gastosTotal = gastos.reduce((s: number, c: any) => s + (c.valor_total || 0), 0);

  // ── Anticipos ──
  const anticiposRows = anticipos
    .map(
      (c: any) => `<tr>
        <td>${fmt.esc((c.concepto || '').replace(/_/g, ' '))}</td>
        <td></td>
        <td class="val">${fmt.COP(c.valor_unitario || 0)}</td>
      </tr>`
    )
    .join('');
  const anticiposTotal = anticipos.reduce((s: number, c: any) => s + (c.valor_total || 0), 0);

  // ── Impuestos (solo single-prop: en multi-prop el detalle vive en las cards
  //    de "LIQUIDACIÓN POR COPROPIETARIO" y duplicarlo aquí sería redundante). ──
  let impuestosHtml = '';
  const esMulti = !!item.es_multi_propietario && (item.propietarios || []).length > 0;

  if (!esMulti) {
    const ordered = ORDEN_IMPUESTOS.flatMap((k) =>
      impuestos.filter((c: any) => c.concepto === k)
    ).concat(impuestos.filter((c: any) => !ORDEN_IMPUESTOS.includes(c.concepto)));
    const rows = ordered
      .map(
        (c: any) => `<tr>
          <td>${fmt.esc(c.concepto.replace(/_/g, ' '))}</td>
          <td class="pct">${fmt.fmtPct(c.porcentaje)}</td>
          <td></td>
          <td></td>
          <td class="tot">${fmt.COP(c.valor_total || 0)}</td>
        </tr>`
      )
      .join('');
    const tot = impuestos.reduce((s: number, c: any) => s + (c.valor_total || 0), 0);
    impuestosHtml = `<table class="desc-tbl">
      <thead><tr><th>CONCEPTO</th><th>%</th><th></th><th></th><th>VALOR</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5" style="text-align:center;color:#94a3b8;font-style:italic;padding:8px">Sin impuestos registrados.</td></tr>'}</tbody>
      ${
        impuestos.length > 0
          ? `<tfoot><tr>
              <td colspan="4" class="lbl">TOTAL IMPUESTOS Y RETENCIONES</td>
              <td class="v">${fmt.COP(tot)}</td>
            </tr></tfoot>`
          : ''
      }
    </table>`;
  }

  // ── GASTOS HTML ──
  const gastosHtml = `<div class="desc-block desc-block-gastos">
    <div class="desc-block-title">GASTOS DE VEHÍCULO</div>
    <table class="desc-tbl">
      <thead><tr><th>CONCEPTO</th><th>CANT</th><th></th><th>VALOR</th><th>TOTAL</th></tr></thead>
      <tbody>${gastosRows || '<tr><td colspan="5" style="text-align:center;color:#94a3b8;font-style:italic;padding:8px">Sin gastos registrados.</td></tr>'}</tbody>
      ${
        gastos.length > 0
          ? `<tfoot><tr>
              <td colspan="4" class="lbl">TOTAL GASTOS DE VEHÍCULO</td>
              <td class="v">${fmt.COP(gastosTotal)}</td>
            </tr></tfoot>`
          : ''
      }
    </table>
  </div>`;

  // ── ANTICIPOS HTML ──
  const anticiposHtml = `<div class="desc-block desc-block-anticipos">
    <div class="desc-block-title">ANTICIPOS DEL VEHÍCULO</div>
    <table class="desc-tbl">
      <thead><tr><th>CONCEPTO</th><th></th><th>VALOR</th></tr></thead>
      <tbody>${anticiposRows || '<tr><td colspan="3" style="text-align:center;color:#94a3b8;font-style:italic;padding:8px">Sin anticipos registrados.</td></tr>'}</tbody>
      ${
        anticipos.length > 0
          ? `<tfoot><tr>
              <td colspan="2" class="lbl">TOTAL ANTICIPOS</td>
              <td class="v">${fmt.COP(anticiposTotal)}</td>
            </tr></tfoot>`
          : ''
      }
    </table>
  </div>`;

  // ── IMPUESTOS HTML (solo single-prop) ──
  const impuestosBlock = esMulti
    ? ''
    : `<div class="desc-block desc-block-impuestos">
        <div class="desc-block-title">IMPUESTOS Y RETENCIONES</div>
        ${impuestosHtml}
      </div>`;

  // Multi-prop → grid de 2 columnas (gastos | anticipos), impuestos ya van en cards.
  // Single-prop → grid de 3 columnas (gastos | anticipos+impuestos stacked | nada).
  if (esMulti) {
    return `<div class="desc-grid-2">
      ${gastosHtml}
      ${anticiposHtml}
    </div>`;
  }

  return `<div class="desc-grid-3">
    ${gastosHtml}
    <div style="display:flex;flex-direction:column;gap:8px">
      ${anticiposHtml}
      ${impuestosBlock}
    </div>
    <div></div>
  </div>`;
}

function renderResumenPorCopropietario(item: any): string {
  const propietarios = (item.propietarios || []).filter((p: any) => !p.deleted_at);
  if (!item.es_multi_propietario || propietarios.length === 0) return '';

  const totImp = fmt.totalImpuestosPorPropietario(item);
  const impList = fmt.impuestosPorPropietarioList(item);
  const vFacturarMap = fmt.valorFacturarPorPropietario(item);

  // Identifica al copropietario que es el mismo "tercero" asociado a la
  // liquidación (`item.tercero`). En el flujo real esto es TRANSMERALDA —
  // la empresa dueña del sistema — y se liquida vía "abono a crédito"
  // (no genera un VALOR A PAGAR real, es un movimiento interno).
  const terceroAsocId = item.tercero_id || item.tercero?.id || null;

  const cards = propietarios
    .map((p: any) => {
      const vFacturar = vFacturarMap[p.id] || 0;
      const impuestosRaw = impList[p.id] || [];
      // Orden canónico de impuestos en cada card: ICA → AVISOS → BOMBERIL → FUENTE.
      const rankOrden = (c: string): number => {
        const i = ORDEN_IMPUESTOS.indexOf(c);
        return i === -1 ? 999 : i;
      };
      const impuestos = impuestosRaw
        .slice()
        .sort((a: any, b: any) => rankOrden(a.concepto) - rankOrden(b.concepto));
      const pTotalImp = totImp[p.id] || 0;
      const pPagar = Math.max(0, vFacturar - pTotalImp);
      const esTerceroAsociado = terceroAsocId && p.tercero_id === terceroAsocId;

      const impRows = impuestos
        .map(
          (c: any) => `<tr class="card-tr-discount-detail">
            <td class="card-conc">${fmt.esc(c.concepto.replace(/_/g, ' '))}</td>
            <td class="card-rate">${fmt.fmtPct(c.porcentaje)}</td>
            <td class="card-val">(${fmt.COP(c.valor_total || 0)})</td>
          </tr>`
        )
        .join('');

      // Card/row especial para el tercero asociado a la liquidación
      // (TRANSMERALDA en el flujo real): el pago es interno y se liquida
      // como "abono a crédito" sin aplicar retenciones. Se muestra el
      // VALOR A FACTURAR directo (sin restar impuestos), porque el
      // movimiento a crédito es por el valor proporcional bruto.
      if (esTerceroAsociado) {
        const liqPct = fmt.fmtPct(p.porcentaje);
        const liqTexto =
          `LIQUIDACIÓN ${liqPct} ${fmt.esc(p.nombre || '—')} — ABONAR A CRÉDITO BANCÓMOMEVA`;
        return `<div class="card-transmer-full">
          <div class="card-transmer-head">
            <span class="card-transmer-title">${liqTexto}</span>
            <span class="card-transmer-pct">${liqPct}</span>
          </div>
          <div class="card-transmer-body">
            <span class="card-transmer-label">VALOR PROPORCIONAL A ABONAR A CRÉDITO</span>
            <span class="card-transmer-val">${fmt.COP(vFacturar)}</span>
          </div>
          <div class="card-transmer-foot">Pago interno — no genera egreso real</div>
        </div>`;
      }

      return `<div class="card">
        <div class="card-header">
          <span class="card-name">${fmt.esc(p.nombre || '—')}</span>
          <span class="card-pct">${fmt.fmtPct(p.porcentaje)}</span>
        </div>
        <table class="card-tbl">
          <tbody>
            <tr class="card-tr-gross">
              <td colspan="2" class="card-lbl">VALOR A FACTURAR</td>
              <td class="card-val">${fmt.COP(vFacturar)}</td>
            </tr>
            ${impRows}
            ${
              pTotalImp > 0
                ? `<tr class="card-tr-discount-total">
                    <td colspan="2" class="card-lbl">(−) TOTAL RETENCIONES</td>
                    <td class="card-val">(${fmt.COP(pTotalImp)})</td>
                  </tr>`
                : ''
            }
            <tr class="card-tr-pagar">
              <td colspan="2" class="card-lbl">(=) VALOR A PAGAR</td>
              <td class="card-val">${fmt.COP(pPagar)}</td>
            </tr>
          </tbody>
        </table>
      </div>`;
    })
    .join('');

  // Tabla 2-rows: TOTAL DESCUENTOS (LAB + GAST + ANT proporcional por prop)
  // y VALOR SERVICIO (= V.LIQUIDAR − total descuentos globales).
  const tdg = fmt.totalDescuentosGlobales(item);
  const vs = fmt.valorServicio(item);
  const servicioTable = `<table class="desc-tbl liq-servicio-tbl">
    <colgroup>
      <col style="width:60%" />
      <col style="width:40%" />
    </colgroup>
    <tbody>
      <tr class="liq-servicio-row liq-servicio-row-disc">
        <td class="liq-servicio-label">TOTAL DESCUENTOS</td>
        <td class="liq-servicio-val">${fmt.COP(tdg)}</td>
      </tr>
      <tr class="liq-servicio-row liq-servicio-row-final">
        <td class="liq-servicio-label">VALOR SERVICIO</td>
        <td class="liq-servicio-val">${fmt.COP(vs)}</td>
      </tr>
    </tbody>
  </table>`;

  return `<div class="cards-title">RETENCIONES Y NETO A PAGAR POR COPROPIETARIO</div>
    ${servicioTable}
    <div class="cards-grid">${cards}</div>`;
}

function renderResumenFinal(item: any): string {
  // En multi-prop el TOTAL DESCUENTOS / TOTAL A PAGAR ya viene implícito
  // en la suma de las cards (cada prop muestra su VALOR A PAGAR). Mostrar
  // el bloque global aquí duplica info y rompe la claridad de la liquidación.
  if (item.es_multi_propietario) return '';

  const totalDesc = Number(item.total_descuentos || 0);
  const totalLiq = Number(item.valor_liquidar || 0);
  const totalPagar = totalLiq - totalDesc;
  // Tabla, no divs con flex: los totales son cifras y tienen que alinearse
  // con las del resto del documento. Antes se salían de la rejilla por la
  // izquierda porque el ancho del `<span>` dependía del texto.
  return `<div class="resumen">
    <table class="resumen-tbl">
      <tbody>
        <tr class="desc">
          <td class="lbl">Total descuentos</td>
          <td class="v">${fmt.COP(totalDesc)}</td>
        </tr>
        <tr class="pagar">
          <td class="lbl">Total a pagar</td>
          <td class="v">${fmt.COP(totalPagar)}</td>
        </tr>
      </tbody>
    </table>
  </div>`;
}

function renderFirmas(item: any): string {
  const sello = getSelloDataUrl();
  const mostrarFirma = item.estado && item.estado !== 'BORRADOR';
  const img = mostrarFirma && sello
    ? `<img class="sig-img" src="${sello}" alt="Sello autorizado" />`
    : '';
  return `<div class="sigs">
    <div class="sig">
      <div class="sig-lbl">LIQUIDADO POR:</div>
      ${img}
      <div class="sig-line">&nbsp;</div>
    </div>
    <div class="sig">
      <div class="sig-lbl">ACEPTADO POR:</div>
      <div class="sig-line">&nbsp;</div>
    </div>
  </div>`;
}

// ════════════════════════════════════════════════════════════════════════
// TEMPLATE PRINCIPAL
// ════════════════════════════════════════════════════════════════════════

export function renderTerceroLiquidacionPdf(item: any): string {
  const mes = item.mes ? fmt.MESES[item.mes - 1] : '';
  const logo = getLogoDataUrl();
  const t0 = item.tercero || {};
  const tDocLabel = t0.tipo_persona === 'EMPRESA' ? 'NIT' : 'CC';
  const tIdTxt = t0.identificacion ? `· ${tDocLabel} ${fmt.esc(t0.identificacion)}` : '';
  const consecutivo =
    item.liquidacion?.consecutivo || item.consecutivo || `LIQ-TERC-${item.id?.slice(0, 8) || ''}`;

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Liquidación ${fmt.esc(consecutivo)} — ${fmt.esc(fmt.fmtPlaca(item.placa))}</title>
<style>${buildFontsCss()}\n${CSS}</style>
</head>
<body>
  <div class="header">
    <div class="header-logo">${
      logo ? `<img src="${logo}" alt="Logo" />` : `<div style="width:80px;height:46px;background:#0f4025;color:#fff;font-size:9pt;font-weight:900;display:flex;align-items:center;justify-content:center;border-radius:6px">COTRANS<br/>MEQ</div>`
    }</div>
    <div class="header-title">
      <div class="co">TRANSPORTES Y SERVICIOS ESMERALDA S.A.S.</div>
      <div class="doc">LIQUIDACIÓN DE INGRESOS RECIBIDOS PARA TERCEROS</div>
    </div>
    <div class="header-meta">
      <table>
        <tr><td class="ml">Código:</td><td class="mv">GAF-FR-11</td></tr>
        <tr><td class="ml">Versión:</td><td class="mv">2</td></tr>
        <tr><td class="ml">Fecha:</td><td class="mv">10/07/2026</td></tr>
      </table>
    </div>
  </div>

  <div class="period">
    <div class="pc"><span class="lbl">MES:</span><span class="val">${fmt.esc(mes)}</span></div>
    <div class="pc"><span class="lbl">AÑO:</span><span class="val">${item.anio || ''}</span></div>
    <div class="pc"><span class="lbl">PLACA:</span><span class="val">${fmt.esc(fmt.fmtPlaca(item.placa))}</span></div>
    <div class="pc"><span class="lbl">CONSECUTIVO:</span><span class="val">${fmt.esc(consecutivo)}</span></div>
    <div class="pc" style="flex:1">
      <span class="lbl">TERCERO:</span>
      <span class="val">${fmt.esc(t0.nombre_completo || '—')}${tIdTxt}</span>
    </div>
  </div>

  ${renderItemsTable(item)}

  ${renderConductoresGrid(item)}

  <div class="page-break-before">
    ${renderDescuentosResto(item)}

    ${renderResumenPorCopropietario(item)}

    ${renderResumenFinal(item)}

    ${renderFirmas(item)}
  </div>
</body>
</html>`;
}