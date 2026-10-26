/**
 * Plantilla HTML del «Reporte de servicios por conductor y placa» de recargos.
 *
 * Sustituye al dibujo a mano con PDFKit que vivía en `recargos.service.ts`:
 * banda azul marino, sin logo ni razón social, una tabla de 373pt que no
 * llenaba la hoja. Era el único PDF del sistema que no seguía la línea de la
 * casa. Ahora se renderiza con `pdfFromHtml` (Chromium) a partir de los mismos
 * tokens `--tpdf-*` que la liquidación de terceros y el preview del portal,
 * así que sale del mismo color que el resto de documentos.
 *
 * ── Qué cuenta el reporte ──
 * Un «servicio» es un día laboral registrado en una planilla de recargos del
 * mes. Se agrupa por conductor y, dentro de cada conductor, por placa; una
 * misma placa con varias planillas (p. ej. dos clientes) se funde en una fila
 * y sus clientes se listan juntos. Los días se imprimen comprimidos en rangos
 * («1-5, 8, 12-14») para que el operador pueda cotejar contra la planilla
 * física sin abrir el sistema.
 *
 * ── Qué NO hace ──
 * No lee la base ni sabe de Prisma: recibe `ReporteServiciosDatos` ya
 * agrupado. Así la agrupación se prueba sin Chromium y la plantilla sin base.
 */
import fs from 'fs';
import path from 'path';
import { buildFontsCss } from '../liquidaciones-terceros-pdf/fonts';
import { pdfCssVars } from '../liquidaciones-terceros-pdf/pdf-tokens';

// ─── Tipos ──────────────────────────────────────────────────────────────────

/** Una planilla tal como la devuelve `reporteServiciosporPlaca` del servicio. */
export interface PlanillaParaReporte {
  conductores: {
    nombre: string | null;
    apellido: string | null;
    numero_identificacion: string | null;
  } | null;
  vehiculos: { placa: string | null } | null;
  clientes: { nombre: string | null } | null;
  dias_laborales_planillas: Array<{ dia: number | string }>;
}

export interface FilaPlacaReporte {
  placa: string;
  clientes: string[];
  dias: number[];
  servicios: number;
}

export interface GrupoConductorReporte {
  nombre: string;
  cedula: string;
  placas: FilaPlacaReporte[];
  servicios: number;
}

export interface ReporteServiciosDatos {
  mes: number;
  anio: number;
  conductores: GrupoConductorReporte[];
  /** Vista transversal: cuántos servicios acumuló cada placa en el mes. */
  placas: Array<{ placa: string; conductores: number; servicios: number }>;
  totales: { conductores: number; placas: number; servicios: number };
  generadoEl: Date;
  generadoPor?: string | null;
}

// ─── Agrupación ─────────────────────────────────────────────────────────────

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

export function nombreMes(mes: number): string {
  return MESES[mes - 1] ?? `Mes ${mes}`;
}

function nombreCompleto(c: PlanillaParaReporte['conductores']): string {
  const partes = [c?.nombre, c?.apellido].map((p) => (p ?? '').trim()).filter(Boolean);
  return partes.length ? partes.join(' ').toUpperCase() : 'SIN CONDUCTOR';
}

/**
 * Agrupa las planillas crudas en la estructura que pinta la plantilla.
 *
 * Orden: conductores por apellido+nombre; placas por placa; días ascendentes.
 * Los días repetidos dentro de una misma placa (dos planillas del mismo día
 * para clientes distintos) se cuentan una vez cada uno como servicio y NO se
 * deduplican: son dos servicios reales. Sí se deduplican en la lista de días
 * impresa, que es un apoyo visual, no un conteo.
 */
export function agruparReporteServicios(
  planillas: PlanillaParaReporte[],
  mes: number,
  anio: number,
  extras: { generadoEl?: Date; generadoPor?: string | null } = {}
): ReporteServiciosDatos {
  const porConductor = new Map<string, GrupoConductorReporte & { _placas: Map<string, FilaPlacaReporte> }>();
  const porPlaca = new Map<string, { placa: string; conductores: Set<string>; servicios: number }>();

  for (const p of planillas) {
    const cedula = (p.conductores?.numero_identificacion ?? '').trim() || '—';
    const claveConductor = `${cedula}|${nombreCompleto(p.conductores)}`;
    const placa = (p.vehiculos?.placa ?? '').trim().toUpperCase() || 'SIN PLACA';
    const cliente = (p.clientes?.nombre ?? '').trim();
    const dias = (p.dias_laborales_planillas ?? [])
      .map((d) => Number(d.dia))
      .filter((d) => Number.isFinite(d));

    let grupo = porConductor.get(claveConductor);
    if (!grupo) {
      grupo = {
        nombre: nombreCompleto(p.conductores),
        cedula,
        placas: [],
        servicios: 0,
        _placas: new Map()
      };
      porConductor.set(claveConductor, grupo);
    }

    let fila = grupo._placas.get(placa);
    if (!fila) {
      fila = { placa, clientes: [], dias: [], servicios: 0 };
      grupo._placas.set(placa, fila);
    }
    if (cliente && !fila.clientes.includes(cliente)) fila.clientes.push(cliente);
    fila.dias.push(...dias);
    fila.servicios += dias.length;
    grupo.servicios += dias.length;

    let agg = porPlaca.get(placa);
    if (!agg) {
      agg = { placa, conductores: new Set(), servicios: 0 };
      porPlaca.set(placa, agg);
    }
    agg.conductores.add(claveConductor);
    agg.servicios += dias.length;
  }

  const conductores = [...porConductor.values()]
    .map(({ _placas, ...g }) => ({
      ...g,
      placas: [..._placas.values()]
        .map((f) => ({
          ...f,
          dias: [...new Set(f.dias)].sort((a, b) => a - b),
          clientes: [...f.clientes].sort((a, b) => a.localeCompare(b, 'es'))
        }))
        .sort((a, b) => a.placa.localeCompare(b.placa, 'es'))
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

  const placas = [...porPlaca.values()]
    .map((a) => ({ placa: a.placa, conductores: a.conductores.size, servicios: a.servicios }))
    .sort((a, b) => b.servicios - a.servicios || a.placa.localeCompare(b.placa, 'es'));

  return {
    mes,
    anio,
    conductores,
    placas,
    totales: {
      conductores: conductores.length,
      placas: placas.length,
      servicios: conductores.reduce((s, c) => s + c.servicios, 0)
    },
    generadoEl: extras.generadoEl ?? new Date(),
    generadoPor: extras.generadoPor ?? null
  };
}

/**
 * «1, 2, 3, 5, 8, 9, 10» → «1-3, 5, 8-10».
 * Dos días seguidos no forman rango («1, 2»): «1-2» ahorra nada y se lee peor.
 */
export function comprimirDias(dias: number[]): string {
  const orden = [...new Set(dias)].sort((a, b) => a - b);
  const partes: string[] = [];
  let i = 0;
  while (i < orden.length) {
    let j = i;
    while (j + 1 < orden.length && orden[j + 1] === orden[j] + 1) j++;
    const largo = j - i + 1;
    if (largo >= 3) partes.push(`${orden[i]}-${orden[j]}`);
    else for (let k = i; k <= j; k++) partes.push(String(orden[k]));
    i = j + 1;
  }
  return partes.join(', ');
}

// ─── Render ─────────────────────────────────────────────────────────────────

const LOGO_PATH = path.join(__dirname, '..', '..', 'assets', 'logo_cotransmeq-264.webp');
let logoDataUrl: string | null = null;
function getLogoDataUrl(): string {
  if (logoDataUrl !== null) return logoDataUrl;
  try {
    logoDataUrl = `data:image/webp;base64,${fs.readFileSync(LOGO_PATH).toString('base64')}`;
  } catch {
    // Sin logo el documento sigue siendo válido: el encabezado cae al rótulo de texto.
    logoDataUrl = '';
  }
  return logoDataUrl;
}

function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const fmtEntero = new Intl.NumberFormat('es-CO');

function fechaCorta(d: Date): string {
  return d.toLocaleString('es-CO', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    timeZone: 'America/Bogota'
  }).replace(',', '');
}

function fechaLarga(d: Date): string {
  return d.toLocaleDateString('es-CO', {
    day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
    timeZone: 'America/Bogota'
  });
}

const CSS = `
@page { size: letter portrait; margin: 9mm 0 13mm; }

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: var(--tpdf-fuente-sans);
  font-size: var(--tpdf-fs-body);
  color: var(--tpdf-tinta);
  line-height: 1.3;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

/* Todo el contenido del reporte queda alineado a la izquierda y limitado a
   tres cuartas partes del área útil de la página. */
.documento { width: 75%; max-width: 75%; margin: 0 0 0 9mm; }

/* ── Encabezado editorial (idéntico al de la liquidación de terceros) ── */
.header {
  display: grid;
  grid-template-columns: 100px 1fr 190px;
  border: var(--tpdf-borde-marco) solid var(--tpdf-marco);
  margin-bottom: 3px;
}
.header-logo {
  border-right: var(--tpdf-borde-marco) solid var(--tpdf-marco);
  padding: 6px 10px;
  display: flex; align-items: center; justify-content: center;
}
.header-logo img { height: 38px; width: auto; object-fit: contain; }
.header-logo .marca {
  width: 80px; height: 46px; background: var(--tpdf-verde); color: #fff;
  font-size: 9pt; font-weight: 900; display: flex; align-items: center;
  justify-content: center; border-radius: 6px; text-align: center;
}
.header-title { padding: 4px 12px; display: flex; flex-direction: column; justify-content: center; }
.header-title .co {
  font-size: var(--tpdf-fs-seccion); font-weight: 800; color: var(--tpdf-verde);
  text-transform: uppercase; letter-spacing: -0.01em; line-height: 1.2;
}
.header-title .doc {
  font-size: var(--tpdf-fs-foot); font-weight: 700; color: var(--tpdf-tinta-suave);
  margin-top: 1px; line-height: 1.2; text-transform: uppercase;
}
.header-meta { border-left: var(--tpdf-borde-marco) solid var(--tpdf-marco); display: flex; }
.header-meta table { width: 100%; border-collapse: collapse; height: 100%; }
.header-meta td {
  padding: 2px 6px; font-size: var(--tpdf-fs-head);
  border-bottom: var(--tpdf-borde-rejilla) solid var(--tpdf-rejilla);
  border-left: var(--tpdf-borde-rejilla) solid var(--tpdf-rejilla);
}
.header-meta tr:last-child td { border-bottom: none; }
.header-meta td.ml {
  font-weight: 700; background: var(--tpdf-interno-bg); color: var(--tpdf-tinta-suave);
  white-space: nowrap; text-align: right; text-transform: uppercase; letter-spacing: 0.03em;
  width: 64px; border-right: var(--tpdf-borde-rejilla) solid var(--tpdf-marco);
}
.header-meta td.mv { font-weight: 800; color: var(--tpdf-verde); text-align: left; font-family: var(--tpdf-fuente-mono); }

/* ── Banda de periodo y totales ── */
.period {
  border: var(--tpdf-borde-rejilla) solid var(--tpdf-marco);
  margin-bottom: 6px; display: flex; flex-wrap: wrap; background: var(--tpdf-verde-suave);
}
.period .pc {
  padding: 3px 9px; border-right: var(--tpdf-borde-rejilla) solid var(--tpdf-rejilla);
  display: flex; align-items: center; gap: 4px; white-space: nowrap;
}
.period .pc:last-child { border-right: none; flex: 1; }
.period .pc .lbl { color: var(--tpdf-tinta-tenue); font-weight: 600; font-size: var(--tpdf-fs-head); }
.period .pc .val { color: var(--tpdf-verde); font-weight: 800; font-size: var(--tpdf-fs-foot); font-family: var(--tpdf-fuente-mono); }

/* ── Secciones ── */
.sec { margin-top: 8px; }
.sec-title {
  font-size: var(--tpdf-fs-seccion); font-weight: 800; color: var(--tpdf-verde);
  text-transform: uppercase; letter-spacing: 0.02em; padding-bottom: 2px; margin-bottom: 3px;
  border-bottom: var(--tpdf-borde-marco) solid var(--tpdf-verde);
  display: flex; justify-content: space-between; align-items: baseline;
}
.sec-title .nota { font-size: var(--tpdf-fs-micro); font-weight: 500; color: var(--tpdf-tinta-tenue); text-transform: none; letter-spacing: 0; }

/* ── Tablas (misma rejilla que el resto de PDFs) ── */
table.tbl { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: var(--tpdf-fs-body); }
table.tbl thead { display: table-header-group; }
table.tbl th {
  background: var(--tpdf-verde); color: #fff; padding: var(--tpdf-pad-y) var(--tpdf-pad-x);
  font-weight: 700; text-align: center; border: var(--tpdf-borde-rejilla) solid var(--tpdf-verde-borde);
  font-size: var(--tpdf-fs-head); letter-spacing: 0.02em; line-height: 1.15; text-transform: uppercase;
}
table.tbl td {
  padding: var(--tpdf-pad-y) var(--tpdf-pad-x); border: var(--tpdf-borde-rejilla) solid var(--tpdf-rejilla);
  vertical-align: middle; overflow-wrap: break-word; line-height: 1.15;
}
table.tbl tr { page-break-inside: avoid; }
/* El pie NO se repite por hoja: un «total del periodo» en cada página se lee
   como subtotal, y aquí no lo es. */
table.tbl tfoot { display: table-row-group; }
table.tbl tfoot td {
  font-weight: 800; background: var(--tpdf-foot-bg);
  border-top: var(--tpdf-borde-marco) solid var(--tpdf-verde-borde);
}
td.tc { text-align: center; }
td.num { text-align: right; font-family: var(--tpdf-fuente-mono); font-weight: 700; white-space: nowrap; font-variant-numeric: tabular-nums; }
td.mono { font-family: var(--tpdf-fuente-mono); font-weight: 700; }
td.dias { font-family: var(--tpdf-fuente-mono); font-size: var(--tpdf-fs-head); color: #000; font-variant-numeric: tabular-nums; }
td.muted { color: var(--tpdf-tinta-tenue); }
td.cliente { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: var(--tpdf-fs-micro); }

/* Fila de conductor: separa el grupo y lleva su subtotal. */
tr.grupo td {
  background: var(--tpdf-verde-suave); font-weight: 800; color: var(--tpdf-verde);
  border-top: var(--tpdf-borde-marco) solid var(--tpdf-verde);
}
tr.grupo td .ced { font-weight: 600; color: var(--tpdf-tinta-suave); font-family: var(--tpdf-fuente-mono); margin-left: 6px; }
tr.grupo td .sub { font-weight: 600; color: var(--tpdf-tinta-suave); margin-left: 6px; }

.vacio {
  margin-top: 12px; padding: 14px; text-align: center; border: var(--tpdf-borde-rejilla) dashed var(--tpdf-rejilla);
  color: var(--tpdf-tinta-tenue); font-size: var(--tpdf-fs-foot);
}

.doc-ft {
  margin-top: 10px; padding-top: 4px; border-top: var(--tpdf-borde-rejilla) solid var(--tpdf-rejilla);
  display: flex; flex-wrap: wrap; gap: 2px 8px; justify-content: space-between;
  font-size: var(--tpdf-fs-micro); color: var(--tpdf-tinta-tenue);
}
`;

/** Pie que Chromium repite en cada hoja (numeración). Lleva su propio CSS: no hereda el del documento. */
export function footerReporteServicios(): string {
  return `<div style="width:75%;margin:0 0 0 9mm;padding:0;display:flex;justify-content:space-between;font-family:Arial,Helvetica,sans-serif;font-size:6.5pt;color:#64748b;">
    <span>SERVICIOS Y TRANSPORTES COTRANSMEQ S.A.S. · Reporte de servicios por conductor y placa</span>
    <span>Página <span class="pageNumber"></span> de <span class="totalPages"></span></span>
  </div>`;
}

function renderTablaConductores(d: ReporteServiciosDatos): string {
  if (!d.conductores.length) {
    return `<div class="vacio">No hay planillas de recargos con días laborales para ${esc(nombreMes(d.mes))} de ${d.anio}.</div>`;
  }

  const filas = d.conductores
    .map((c, idx) => {
      const grupo = `<tr class="grupo">
        <td class="tc">${idx + 1}</td>
        <td colspan="3">${esc(c.nombre)}<span class="ced">C.C. ${esc(c.cedula)}</span><span class="sub">${c.placas.length} ${c.placas.length === 1 ? 'placa' : 'placas'}</span></td>
        <td class="num">${fmtEntero.format(c.servicios)}</td>
      </tr>`;
      const placas = c.placas
        .map(
          (p) => `<tr>
        <td></td>
        <td class="mono tc">${esc(p.placa)}</td>
        <td class="cliente ${p.clientes.length ? '' : 'muted'}">${p.clientes.length ? esc(p.clientes.map((nombre) => nombre.trim().split(/\s+/)[0]).filter(Boolean).join(' · ')) : 'Sin cliente'}</td>
        <td class="dias">${esc(comprimirDias(p.dias))}</td>
        <td class="num">${fmtEntero.format(p.servicios)}</td>
      </tr>`
        )
        .join('');
      return grupo + placas;
    })
    .join('');

  return `<table class="tbl" style="width:84.5%">
    <colgroup>
      <col style="width:5.33%"><col style="width:13.02%"><col style="width:37.87%"><col style="width:23.67%"><col style="width:20.11%">
    </colgroup>
    <thead><tr>
      <th>#</th><th>Placa</th><th>Conductor / Cliente</th><th>Días del mes</th><th>Servicios</th>
    </tr></thead>
    <tbody>${filas}</tbody>
    <tfoot><tr>
      <td colspan="4">TOTAL DEL PERIODO · ${d.totales.conductores} cond. · ${d.totales.placas} placas</td>
      <td class="num">${fmtEntero.format(d.totales.servicios)}</td>
    </tr></tfoot>
  </table>`;
}

export function renderReporteServiciosHtml(d: ReporteServiciosDatos): string {
  const logo = getLogoDataUrl();
  const mes = nombreMes(d.mes);
  const generado = fechaLarga(d.generadoEl);

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Reporte de servicios ${esc(mes)} ${d.anio}</title>
<style>${buildFontsCss()}\n:root{${pdfCssVars(1)}}\n${CSS}</style>
</head>
<body>
<div class="documento">
  <div class="header">
    <div class="header-logo">${logo ? `<img src="${logo}" alt="Logo Cotransmeq">` : '<div class="marca">COTRANSMEQ</div>'}</div>
    <div class="header-title">
      <div class="co">SERVICIOS Y TRANSPORTES COTRANSMEQ S.A.S.</div>
      <div class="doc">Reporte de servicios por conductor y placa</div>
    </div>
    <div class="header-meta">
      <table>
        <tr><td class="ml">Periodo:</td><td class="mv">${esc(mes)} ${d.anio}</td></tr>
        <tr><td class="ml">Generado:</td><td class="mv">${esc(fechaCorta(d.generadoEl))}</td></tr>
        <tr><td class="ml">Fuente:</td><td class="mv">Planillas de recargos</td></tr>
      </table>
    </div>
  </div>

  <div class="period">
    <div class="pc"><span class="lbl">MES:</span><span class="val">${esc(mes.toUpperCase())}</span></div>
    <div class="pc"><span class="lbl">AÑO:</span><span class="val">${d.anio}</span></div>
    <div class="pc"><span class="lbl">CONDUCTORES:</span><span class="val">${d.totales.conductores}</span></div>
    <div class="pc"><span class="lbl">PLACAS:</span><span class="val">${d.totales.placas}</span></div>
    <div class="pc"><span class="lbl">SERVICIOS:</span><span class="val">${fmtEntero.format(d.totales.servicios)}</span></div>
  </div>

  <section class="sec">
    <div class="sec-title"><span>Servicios por conductor</span><span class="nota">Un servicio = un día laboral registrado en planilla. Solo conductores de nómina.</span></div>
    ${renderTablaConductores(d)}
  </section>

  <div class="doc-ft">
    <span>Generado el ${esc(generado)}${d.generadoPor ? ` por ${esc(d.generadoPor)}` : ''}</span>
    <span>Documento generado automáticamente por el sistema</span>
  </div>
</div>
</body>
</html>`;
}
