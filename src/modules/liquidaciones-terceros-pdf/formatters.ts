/**
 * Helpers de formato compartidos con el preview Svelte
 * (ingreso-svelte PreviewTerceroPDF.svelte). Mantenerlos sincronizados
 * garantiza que el PDF nativo y el preview muestren los mismos números.
 */

const COP = (v: number | string | null | undefined): string => {
  const n = parseFloat(String(v ?? 0)) || 0;
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
};

function fmtPlaca(p: string | null | undefined): string {
  const s = (p || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const m = s.match(/^([A-Z]+)(\d+)$/);
  return m ? `${m[1]}-${m[2]}` : s;
}

function fmtPct(v: number | null | undefined): string {
  if (v == null) return '';
  return v.toFixed(1) + '%';
}

const MESES = [
  'ENERO',
  'FEBRERO',
  'MARZO',
  'ABRIL',
  'MAYO',
  'JUNIO',
  'JULIO',
  'AGOSTO',
  'SEPTIEMBRE',
  'OCTUBRE',
  'NOVIEMBRE',
  'DICIEMBRE',
];

/** Escape mínimo de HTML para evitar romper el template. */
function esc(v: any): string {
  if (v == null) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Devuelve el total general a pagar (NETO) por copropietario. */
function valorPagarPorPropietario(item: any) {
  const valorLiquidar = Number(item?.valor_liquidar || 0);
  const totalDescuentos = Number(item?.total_descuentos || 0);
  const baseReparto = valorLiquidar - totalDescuentos;
  const propietarios = (item?.propietarios || []).filter((p: any) => !p.deleted_at);
  const out: Record<string, number> = {};
  for (const p of propietarios) {
    const pct = Number(p.porcentaje) || 0;
    out[p.id] = Math.round(baseReparto * (pct / 100));
  }
  return out;
}

/** Total descuentos por prop = total_descuentos × pct/100 (igual que edición). */
function totalDescuentosPorPropietario(item: any) {
  const td = Number(item?.total_descuentos || 0);
  const propietarios = (item?.propietarios || []).filter((p: any) => !p.deleted_at);
  const out: Record<string, number> = {};
  for (const p of propietarios) {
    const pct = Number(p.porcentaje) || 0;
    out[p.id] = Math.round(td * (pct / 100));
  }
  return out;
}

/** Total impuestos por prop (suma de los conceptos IMPUESTO con propietario_id). */
function totalImpuestosPorPropietario(item: any) {
  const out: Record<string, number> = {};
  const propietarios = (item?.propietarios || []).filter((p: any) => !p.deleted_at);
  for (const p of propietarios) out[p.id] = 0;
  const conceptos = item?.conceptos || [];
  for (const c of conceptos) {
    if (c.tipo !== 'IMPUESTO' || !c.propietario_id) continue;
    out[c.propietario_id] = (out[c.propietario_id] || 0) + (Number(c.valor_total) || 0);
  }
  return out;
}

/** Impuestos agrupados por prop para listar en la card. */
function impuestosPorPropietarioList(item: any) {
  const map: Record<string, any[]> = {};
  const propietarios = (item?.propietarios || []).filter((p: any) => !p.deleted_at);
  for (const p of propietarios) map[p.id] = [];
  const conceptos = item?.conceptos || [];
  for (const c of conceptos) {
    if (c.tipo !== 'IMPUESTO' || !c.propietario_id) continue;
    if (!map[c.propietario_id]) map[c.propietario_id] = [];
    map[c.propietario_id].push(c);
  }
  return map;
}

/**
 * Desglose de los descuentos GLOBALES (laborales + gastos + anticipos) por
 * copropietario. Para cada prop devuelve `{ laborales, gastos, anticipos,
 * total }` repartido proporcionalmente al porcentaje declarado.
 *
 * El reparto es proporcional (igual que la edición para estas categorías):
 * cada categoría global (COSTO_LABORAL / GASTO_OPERATIVO / ANTICIPO) se
 * multiplica por pct/100. Los impuestos se reportan aparte, en la card de
 * cada copropietario como "TOTAL RETENCIONES".
 */
function descuentosGlobalesPorPropietarioDetallado(item: any) {
  const conceptos = item?.conceptos || [];
  const props = (item?.propietarios || []).filter((p: any) => !p.deleted_at);

  const sumBy: Record<string, number> = { COSTO_LABORAL: 0, GASTO_OPERATIVO: 0, ANTICIPO: 0 };
  for (const c of conceptos) {
    if (c.tipo === 'IMPUESTO') continue;
    if (sumBy[c.tipo] === undefined) continue;
    sumBy[c.tipo] += Number(c.valor_total) || 0;
  }

  const out: Record<string, { laborales: number; gastos: number; anticipos: number; total: number }> = {};
  for (const p of props) {
    const pct = Number(p.porcentaje) || 0;
    const factor = pct / 100;
    const laborales = Math.round(sumBy.COSTO_LABORAL * factor);
    const gastos = Math.round(sumBy.GASTO_OPERATIVO * factor);
    const anticipos = Math.round(sumBy.ANTICIPO * factor);
    out[p.id] = {
      laborales,
      gastos,
      anticipos,
      total: laborales + gastos + anticipos,
    };
  }
  return out;
}

/**
 * VALOR A FACTURAR por copropietario (después de descontar los descuentos
 * globales proporcionales pero ANTES de aplicar impuestos).
 *
 *   V_FACTURAR_prop = V.LIQUIDAR × pct/100 − desc_globales_prop
 *
 * Es el número que muestra la tabla nueva del PDF y la card de cada
 * propietario. La diferencia con NETO_edicion son los impuestos_prop
 * (que se muestran aparte en la card como TOTAL RETENCIONES).
 */
function valorFacturarPorPropietario(item: any) {
  const vl = Number(item?.valor_liquidar || 0);
  const props = (item?.propietarios || []).filter((p: any) => !p.deleted_at);
  const desc = descuentosGlobalesPorPropietarioDetallado(item);
  const out: Record<string, number> = {};
  for (const p of props) {
    const pct = Number(p.porcentaje) || 0;
    const vlProp = Math.round(vl * (pct / 100));
    out[p.id] = Math.max(0, vlProp - (desc[p.id]?.total || 0));
  }
  return out;
}

/**
 * TOTAL DE DESCUENTOS GLOBALES (sin impuestos) — suma global de LABORALES
 * + GASTOS DE VEHÍCULO + ANTICIPOS repartidos proporcionalmente entre los
 * copropietarios. Es el "TOTAL DESCUENTOS" que muestra el table 2-rows
 * previo a las cards de copropietarios.
 */
function totalDescuentosGlobales(item: any) {
  const det = descuentosGlobalesPorPropietarioDetallado(item);
  return Object.values(det).reduce((s: number, d: any) => s + (d?.total || 0), 0);
}

/**
 * VALOR SERVICIO = V.LIQUIDAR − TOTAL DE DESCUENTOS GLOBALES
 * (es decir, el valor que queda tras restar LABORALES + GASTOS + ANTICIPOS al
 * V.LIQUIDAR, ANTES de aplicar impuestos / retenciones).
 */
function valorServicio(item: any) {
  const vl = Number(item?.valor_liquidar || 0);
  return Math.max(0, vl - totalDescuentosGlobales(item));
}

export const fmt = {
  COP,
  fmtPlaca,
  fmtPct,
  esc,
  MESES,
  valorPagarPorPropietario,
  totalDescuentosPorPropietario,
  totalImpuestosPorPropietario,
  impuestosPorPropietarioList,
  descuentosGlobalesPorPropietarioDetallado,
  valorFacturarPorPropietario,
  totalDescuentosGlobales,
  valorServicio,
};