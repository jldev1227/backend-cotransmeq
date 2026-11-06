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
  const valorLiquidar = valorTotalLiquidable(item);
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

/** Valor liquidable por propietario después de los descuentos globales. */
function valorLiquidarPorPropietario(item: any) {
  const vl = valorTotalLiquidable(item);
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
 * Descuentos globales (sin impuestos) — suma de laborales, gastos de vehículo
 * y anticipos repartidos proporcionalmente entre los copropietarios. Se usa
 * para calcular el neto de cada propietario; el resumen global solo muestra
 * anticipos en TOTAL DESCUENTOS.
 */
function totalDescuentosGlobales(item: any) {
  const det = descuentosGlobalesPorPropietarioDetallado(item);
  return Object.values(det).reduce((s: number, d: any) => s + (d?.total || 0), 0);
}

/**
 * Total facturado de la liquidación, antes de descontar administración,
 * gastos del vehículo, nómina o anticipos. Los adicionales no tienen
 * `total_facturado`: su bruto es valor unitario × cantidad.
 */
function valorTotalFacturado(item: any) {
  const items = Array.isArray(item?.items) ? item.items : [];
  const adicionales = Array.isArray(item?.items_adicionales) ? item.items_adicionales : [];
  const totalItems = items.reduce(
    (s: number, it: any) =>
      s + Number(it?.liquidacion_tercero?.total_facturado ?? it?.total_facturado ?? 0),
    0
  );
  const totalAdicionales = adicionales.reduce(
    (s: number, a: any) =>
      s + (Number(a?.valor_unitario) || 0) * (Number(a?.cantidad) || 1),
    0
  );
  return totalItems + totalAdicionales;
}

/**
 * Suma la columna V/LIQUIDAR de los items vivos y el neto de adicionales.
 * El TOTAL facturado incluye administración y no es la base del pago al tercero.
 */
function valorTotalLiquidable(item: any) {
  const items = Array.isArray(item?.items) ? item.items : [];
  const adicionales = Array.isArray(item?.items_adicionales) ? item.items_adicionales : [];
  const totalItems = items.reduce(
    (s: number, it: any) =>
      s + (Number(it?.liquidacion_tercero?.valor_liquidar ?? it?.valor_liquidar) || 0),
    0
  );
  const totalAdicionales = adicionales.reduce((s: number, a: any) => {
    if (a?.valor_liquidar != null) return s + (Number(a.valor_liquidar) || 0);
    const bruto = (Number(a?.valor_unitario) || 0) * (Number(a?.cantidad) || 1);
    const admin = Number(a?.valor_admin) || 0;
    return s + bruto - admin;
  }, 0);

  // Cierres legacy sin detalle: conservar el total liquidable cacheado.
  if (items.length === 0 && adicionales.length === 0) {
    return Number(item?.valor_liquidar) || 0;
  }
  return totalItems + totalAdicionales;
}

/** Suma los conceptos de un tipo, para los totales del resumen del PDF. */
function totalConceptos(item: any, tipo: string) {
  const conceptos = Array.isArray(item?.conceptos) ? item.conceptos : [];
  return conceptos
    .filter((c: any) => c?.tipo === tipo && !c?.deleted_at)
    .reduce((s: number, c: any) => s + (Number(c?.valor_total) || 0), 0);
}

/** Gastos del vehículo que se restan del valor facturable. */
function totalGastosVehiculo(item: any) {
  return totalConceptos(item, 'GASTO_OPERATIVO');
}

/** Costos de nómina del conductor que se restan del valor facturable. */
function totalCostosLaborales(item: any) {
  return totalConceptos(item, 'COSTO_LABORAL');
}

/** Anticipos que componen TOTAL DESCUENTOS en el resumen. */
function totalAnticipos(item: any) {
  return totalConceptos(item, 'ANTICIPO');
}

/** Total descuentos del resumen: anticipos únicamente. */
function totalDescuentos(item: any) {
  return totalAnticipos(item);
}

/** Valor a facturar por propietario: (V/LIQUIDAR − nómina − gastos de vehículo) × %. */
function valorFacturarPorPropietario(item: any) {
  const totalFacturable =
    valorTotalLiquidable(item) - totalGastosVehiculo(item) - totalCostosLaborales(item);
  const props = (item?.propietarios || []).filter((p: any) => !p.deleted_at);
  const out: Record<string, number> = {};
  for (const p of props) {
    const pct = Number(p.porcentaje) || 0;
    out[p.id] = Math.round(totalFacturable * (pct / 100));
  }
  return out;
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
  valorLiquidarPorPropietario,
  totalDescuentosGlobales,
  valorTotalFacturado,
  valorTotalLiquidable,
  totalGastosVehiculo,
  totalCostosLaborales,
  totalAnticipos,
  totalDescuentos,
};
