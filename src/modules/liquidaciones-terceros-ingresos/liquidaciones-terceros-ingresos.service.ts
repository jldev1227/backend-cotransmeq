import { prisma } from "../../config/prisma";
import { randomUUID } from "crypto";

// ═══════════════════════════════════════════════════════════════
// TIPOS
// ═══════════════════════════════════════════════════════════════

/**
 * Fila plana de un item de tercero que dejó ingreso a Transmeralda,
 * enriquecida con el cliente y el periodo de su liquidación padre.
 *
 * El cliente NO vive en `liquidacion_tercero`: hay que subir a
 * `liquidacion_servicio` (`liquidacion_id`) y de ahí a `empresas`
 * (`cliente_id`, expuesto por Prisma como la relación `cliente`). Ese
 * mismo padre es el que tiene el `mes`/`anio` reales — ver el aviso sobre
 * las columnas muertas más abajo.
 */
export interface IngresoTerceroRow {
  /// UUID real de la fila en `liquidacion_tercero`.
  id: string;
  liquidacion_id: string;
  consecutivo: string | null;
  cliente_id: string;
  /// Columna EMPRESA del canvas (`empresas.nombre`).
  cliente_nombre: string;
  cliente_nit: string | null;
  mes: number;
  anio: number;
  tercero_id: string | null;
  tercero_nombre: string | null;
  placa: string;
  recorrido: string;
  fechas: string;
  numero_planilla: string | null;
  valor_unitario: number;
  cantidad: number;
  porcentaje_admin: number;
  valor_admin: number;
  total_facturado: number;
  valor_liquidar: number;
  /// El ingreso de Transmeralda: `ingreso_extra_global - ingresos_extra_aval`.
  ingreso_empresa: number;
  ingreso_extra_global: number;
  ingresos_extra_aval: number;
  orden: number;
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

/// Los `Decimal` de Prisma llegan como objeto; el canvas espera números.
/// Mismo helper que `liquidaciones-terceros.service.ts` — es local a cada
/// módulo por convención del repo.
function toNumber(v: any): number {
  return typeof v === "object" && v !== null ? Number(v) : Number(v) || 0;
}

/**
 * `include` compartido por las dos consultas.
 *
 * Solo se piden los campos que el canvas pinta o usa para agrupar. En
 * particular NO se trae `factura_items`: la factura decide QUÉ filas entran
 * (ver `whereIngresos`) pero el número no se pinta en ninguna columna de
 * esta hoja, y cada `take: 1` extra es un join más por fila.
 */
const INCLUDE_INGRESO = {
  tercero: { select: { id: true, nombre_completo: true } },
  item: { select: { numero_planilla: true } },
  liquidacion: {
    select: {
      id: true,
      consecutivo: true,
      mes: true,
      anio: true,
      cliente: { select: { id: true, nombre: true, nit: true } },
    },
  },
} as const;

function serializeRow(row: any): IngresoTerceroRow {
  const liq = row.liquidacion;
  return {
    id: row.id,
    liquidacion_id: row.liquidacion_id,
    consecutivo: liq?.consecutivo ?? null,
    cliente_id: liq?.cliente?.id ?? "",
    cliente_nombre: liq?.cliente?.nombre ?? "SIN CLIENTE",
    cliente_nit: liq?.cliente?.nit ?? null,
    mes: liq?.mes ?? 0,
    anio: liq?.anio ?? 0,
    tercero_id: row.tercero_id ?? null,
    tercero_nombre: row.tercero?.nombre_completo ?? null,
    placa: row.placa ?? "",
    recorrido: row.recorrido ?? "",
    fechas: row.fechas ?? "",
    numero_planilla: row.item?.numero_planilla ?? null,
    valor_unitario: toNumber(row.valor_unitario),
    cantidad: toNumber(row.cantidad),
    porcentaje_admin: toNumber(row.porcentaje_admin),
    valor_admin: toNumber(row.valor_admin),
    total_facturado: toNumber(row.total_facturado),
    valor_liquidar: toNumber(row.valor_liquidar),
    ingreso_empresa: toNumber(row.ingreso_empresa),
    ingreso_extra_global: toNumber(row.ingreso_extra_global),
    ingresos_extra_aval: toNumber(row.ingresos_extra_aval),
    orden: row.orden ?? 0,
  };
}

/**
 * Filtro base: items de terceros FACTURADOS que dejaron ingreso a
 * Transmeralda.
 *
 * ⚠️ El periodo se filtra por el PADRE (`liquidacion.mes` / `.anio`), no
 * por `liquidacion_tercero.mes` / `.anio`. Esas dos columnas existen en el
 * schema pero ningún code path las escribe (los dos `createMany` de
 * `liquidaciones-terceros.service.ts` no las setean), así que filtrar por
 * ellas devolvería siempre vacío. `liquidacion_servicio` tiene además el
 * índice `@@index([mes, anio])`.
 *
 * `NOT: { ingreso_empresa: 0 }` es la definición de "tuvo ingreso de
 * Transmeralda": conserva también los negativos, que son reales (un
 * adicional puede dejar a la empresa en rojo sobre ese item).
 *
 * ── Por qué se exige FACTURA ──
 * Esta hoja son los ingresos que la empresa ya tiene derecho a cobrar. Un
 * item sin factura todavía no lo es: entraba en el canvas, sumaba en el
 * TOTAL INGRESO del mes y luego desaparecía o cambiaba de importe cuando
 * por fin se facturaba.
 *
 * La factura cuelga del PADRE (`liquidacion_servicio.factura_items`), no
 * del item: `factura_liquidacion_item` referencia `liquidacion_id`, y el
 * repo ya trata "facturado" como una factura ACTIVA y no borrada (mismo
 * criterio que `liquidaciones-terceros` y `liquidaciones-terceros-ocasional`;
 * una anulada histórica no cuenta). `@@index([liquidacion_id])` cubre el
 * `some`.
 *
 * ── Por qué además se excluyen los OCASIONALES ──
 * Son las dos mitades de la misma regla, pero NO se solapan, y conviene
 * saberlo antes de tocar una de ellas: medido sobre 2026, de los 776 items
 * con ingreso, 138 no tienen factura y 33 están en una liquidación
 * ocasional — y los dos conjuntos son disjuntos. Es decir, TODOS los
 * ocasionales estaban facturados, así que el filtro de factura por sí solo
 * no sacaba ni uno. Quedan 605.
 *
 * Un item que ya se liquidó al tercero por la vía ocasional no es un
 * ingreso de esta hoja: se paga por otro documento y contarlo aquí lo
 * duplica.
 *
 * ── Lo que NO se pierde ──
 * Las decisiones guardadas de un item que deje de cumplir el filtro (su
 * INCLUIR, su cantidad) siguen en `liquidacion_ingreso_transmeralda_fila` y
 * vuelven a aplicar solas si el servicio se factura más tarde: la fila
 * desaparece de la vista, no del estado.
 */
function whereIngresos(filtro: { anio: number; mes?: number }) {
  return {
    NOT: { ingreso_empresa: 0 },
    // Ya liquidado al tercero por la vía ocasional: no es ingreso de aquí.
    ocasionales_items: { none: {} },
    liquidacion: {
      anio: filtro.anio,
      ...(filtro.mes ? { mes: filtro.mes } : {}),
      deleted_at: null,
      estado: { not: "ANULADA" as any },
      factura_items: {
        some: { factura: { deleted_at: null, estado: "ACTIVA" as const } },
      },
    },
  };
}

/**
 * Orden de salida.
 *
 * La hoja lista UNA FILA POR SERVICIO, igual que el Excel de referencia. La
 * PLACA va primero: la tabla se revisa vehículo a vehículo, que es la unidad
 * con la que se contrasta contra los cierres finales, y ordenar por empresa
 * dejaba los servicios de una misma placa repartidos por toda la hoja. El
 * cliente queda de primer desempate para que dentro de una placa se sigan
 * leyendo juntos.
 *
 * ⚠️ Quien ORDENA de verdad la tabla es `ordenarFilasIngresos` del cliente:
 * la página siempre pasa por él, tanto en la carga anual como en «Recargar
 * mes», así que la hoja es determinista venga de donde venga. Este `orderBy`
 * está para que el payload llegue ya agrupado por placa y no dependa del
 * orden físico de la tabla.
 *
 * Los dos NO son idénticos y no pueden serlo: Postgres compara con su
 * collation y el cliente con `localeCompare('es', { numeric: true })`.
 * Comprobado sobre 2026: la secuencia de PLACAS coincide en todos los
 * meses; lo que difiere son los desempates dentro de una misma placa y
 * cliente (aquí consecutivo + orden, allí recorrido + fechas + id). Como el
 * cliente reordena siempre, esa diferencia no llega a verse.
 *
 * La prioridad de FEPCO no entra ni aquí ni allí — solo preselecciona el
 * INCLUIR (ver `PRIORIDAD_CLIENTE`).
 */
const ORDER_BY = [
  { liquidacion: { mes: "asc" as const } },
  { placa: "asc" as const },
  { liquidacion: { cliente: { nombre: "asc" as const } } },
  { liquidacion: { consecutivo: "asc" as const } },
  { orden: "asc" as const },
];

// ═══════════════════════════════════════════════════════════════
// ESTADO EDITABLE (cabecera + overrides + conceptos del pie)
// ═══════════════════════════════════════════════════════════════

export interface FilaIngresoInput {
  liquidacion_tercero_id: string;
  incluir_adicional?: boolean;
  cantidad?: number;
  pct_admon_ingresos?: number | null;
  pct_ganancia?: number | null;
  pct_admon_adicional?: number | null;
  valor_unitario_adicional?: number | null;
  orden?: number;
}

export interface ConceptoIngresoInput {
  id?: string;
  hoja: "INGRESOS" | "ADICIONALES";
  /// Sin `PRESTAMO`: este documento no liquida préstamos ni horas extras.
  /// El Excel de referencia abre un bloque para ellos y las hojas lo
  /// replicaban con cuatro filas vacías por hoja que siempre sumaban cero.
  tipo: "COSTO_LABORAL" | "GASTO_OPERATIVO" | "ANTICIPO" | "IMPUESTO";
  concepto: string;
  persona?: string | null;
  dias?: number | null;
  valor_unitario?: number;
  porcentaje?: number | null;
  valor_total?: number;
  base_calculo?: number | null;
  observaciones?: string | null;
  orden?: number;
}

export interface GuardarIngresoParams {
  mes: number;
  anio: number;
  observaciones?: string | null;
  pct_admon_ingresos?: number;
  pct_ganancia_adicionales?: number;
  pct_admon_adicionales?: number;
  filas: FilaIngresoInput[];
  conceptos: ConceptoIngresoInput[];
  user_id?: string;
}

/// Estado editable de UN mes, tal cual lo consume el canvas.
export interface EstadoIngresoMes {
  cabecera: any | null;
  filas: any[];
  conceptos: any[];
}

/// Porcentajes por defecto. Espejo de los `@default` del schema: se usan
/// cuando el mes todavía no tiene cabecera, para que la hoja calcule lo mismo
/// antes y después del primer guardado.
const PCT_ADMON_INGRESOS = 10;
const PCT_GANANCIA_ADICIONALES = 70;
const PCT_ADMON_ADICIONALES = 10;

/**
 * GASTOS DIVERSOS = 0,4 % del total facturado + una parte fija. Es idéntico
 * en las dos hojas.
 *
 * La parte fija son 20.000 y no los 15.000 del Excel de referencia: es la
 * misma tarifa que aplica el módulo de cierres
 * (`TARIFA_FIJA_GASTOS_DIVERSOS` en `reglas-conceptos.ts`), y este canvas era
 * el único sitio donde el mismo concepto valía otra cosa. Espejo de
 * `GASTOS_DIVERSOS_FIJO` en `ingresos-transmeralda.ts`: los dos números
 * tienen que decir lo mismo o la cabecera contradiría a la hoja.
 */
const GASTOS_DIVERSOS_PCT = 0.4;
const GASTOS_DIVERSOS_FIJO = 20000;

/**
 * Redondeo con las reglas de `ROUND` de Excel: la mitad se ALEJA del cero.
 *
 * `Math.round` de JS manda la mitad hacia +∞, así que discrepa en negativos
 * (`Math.round(-0.5)` es `-0`, `ROUND(-0.5)` es `-1`). Aquí los negativos son
 * reales —un cliente puede dejar ingreso negativo en el mes— y estos números
 * tienen que coincidir con lo que calcule el motor de fórmulas del canvas.
 */
function roundExcel(n: number): number {
  return n < 0 ? -Math.round(-n) : Math.round(n);
}

function sumaConceptos(
  conceptos: any[],
  hoja: string,
  tipo: string,
): number {
  return conceptos
    .filter((c) => c.hoja === hoja && c.tipo === tipo)
    .reduce((s, c) => s + toNumber(c.valor_total), 0);
}

/**
 * Recalcula las DOS hojas de un mes, en el mismo orden en que las lee el
 * documento.
 *
 * Es la contrapartida en servidor de las fórmulas del canvas: el canvas las
 * evalúa en vivo para que el usuario vea los números al escribir, y esto es
 * lo que queda guardado. Las dos expresiones tienen que decir lo mismo, o la
 * cabecera contradiría a la hoja que el usuario tiene delante.
 *
 * EL CIRCUITO ENTRE HOJAS: la de ADICIONALES se calcula PRIMERO, porque su
 * TRANSPORTE POR PAGAR es lo que la de INGRESOS resta como «TOTAL DESCUENTOS
 * LIQUIDACIÓN ADICIONALES». Al revés no se puede.
 */
export function recalcularIngresos(o: {
  items: IngresoTerceroRow[];
  filas: FilaIngresoInput[];
  conceptos: ConceptoIngresoInput[];
  pctAdmonIngresos: number;
  pctGananciaAdicionales: number;
  pctAdmonAdicionales: number;
}) {
  const porItem = new Map<string, FilaIngresoInput>();
  for (const f of o.filas) porItem.set(f.liquidacion_tercero_id, f);

  const cantidadDe = (f?: FilaIngresoInput) => {
    const c = f?.cantidad;
    return c == null ? 1 : toNumber(c);
  };

  // ── Hoja de INGRESOS: una fila por servicio ──
  let totalFacturadoIngresos = 0;
  let totalAdmonIngresos = 0;
  for (const it of o.items) {
    const f = porItem.get(it.id);
    const total = it.ingreso_empresa * cantidadDe(f);
    const pct = f?.pct_admon_ingresos ?? o.pctAdmonIngresos;
    totalFacturadoIngresos += total;
    totalAdmonIngresos += roundExcel((total * toNumber(pct)) / 100);
  }
  const totalLiquidarIngresos = totalFacturadoIngresos - totalAdmonIngresos;

  // ── Hoja de ADICIONALES: solo las filas marcadas ──
  let totalFacturadoAdicionales = 0;
  let totalAdmonAdicionales = 0;
  for (const it of o.items) {
    const f = porItem.get(it.id);
    if (!f?.incluir_adicional) continue;
    // El valor escrito a mano manda sobre el porcentaje: en el Excel de
    // referencia hay una fila así y el % no la explica.
    const vUnidad =
      f.valor_unitario_adicional != null
        ? toNumber(f.valor_unitario_adicional)
        : (it.ingreso_empresa * toNumber(f.pct_ganancia ?? o.pctGananciaAdicionales)) /
          100;
    const total = vUnidad * cantidadDe(f);
    const pct = f.pct_admon_adicional ?? o.pctAdmonAdicionales;
    totalFacturadoAdicionales += total;
    totalAdmonAdicionales += roundExcel((total * toNumber(pct)) / 100);
  }
  const totalLiquidarAdicionales =
    totalFacturadoAdicionales - totalAdmonAdicionales;

  // Pie de ADICIONALES, en orden de lectura. Sin préstamos de por medio, la
  // base imponible cuelga directamente del valor a liquidar: antes había una
  // línea TOTAL GENERAL que le sumaba el bloque de préstamos y horas extras,
  // que en este documento no se liquida.
  const personalAdic = sumaConceptos(o.conceptos, "ADICIONALES", "COSTO_LABORAL");
  const gastosAdic = sumaConceptos(o.conceptos, "ADICIONALES", "GASTO_OPERATIVO");
  const diversosAdic =
    (totalFacturadoAdicionales * GASTOS_DIVERSOS_PCT) / 100 + GASTOS_DIVERSOS_FIJO;
  const descuentosAdic = personalAdic + gastosAdic + diversosAdic;
  const baseImponibleAdic = totalLiquidarAdicionales - descuentosAdic;

  // Impuestos: los porcentajes son editables, así que se leen de los
  // conceptos y solo se cae al valor del Excel cuando no hay concepto.
  const pctDe = (nombre: string, porDefecto: number) => {
    const c = o.conceptos.find(
      (x) => x.hoja === "ADICIONALES" && x.tipo === "IMPUESTO" && x.concepto === nombre,
    );
    return c?.porcentaje == null ? porDefecto : toNumber(c.porcentaje);
  };
  const reteica = (baseImponibleAdic * pctDe("RETENCION_ICA", 1)) / 100;
  const impuestosAdic =
    (baseImponibleAdic * pctDe("RETENCION_FUENTE", 3.5)) / 100 +
    reteica +
    (reteica * pctDe("AVISOS_TABLEROS", 15)) / 100 +
    (reteica * pctDe("SOBRETASA_BOMBERIL", 21)) / 100 +
    sumaConceptos(o.conceptos, "ADICIONALES", "ANTICIPO");

  /// TRANSPORTE POR PAGAR de la hoja de ADICIONALES = lo que la de INGRESOS
  /// resta. Es el número que cierra el circuito entre las dos hojas.
  const totalPagarAdicionales = baseImponibleAdic - impuestosAdic;

  // Pie de INGRESOS. Igual que arriba: sin préstamos, lo que se factura sale
  // del valor a liquidar menos lo que se paga por los adicionales.
  const valorAFacturarIng = totalLiquidarIngresos - totalPagarAdicionales;
  // El Excel solo resta aquí anticipos y papelería; el bloque de personal y
  // gastos de vehículo está en la plantilla pero no llega a la línea final —en
  // el mes de referencia va todo a cero, así que la omisión no se nota. Se
  // incluye porque es lo que promete la etiqueta «DESCUENTOS»: con el bloque
  // en cero el número es idéntico, y con el bloque relleno deja de mentir.
  const descuentosIng =
    sumaConceptos(o.conceptos, "INGRESOS", "ANTICIPO") +
    sumaConceptos(o.conceptos, "INGRESOS", "GASTO_OPERATIVO") +
    sumaConceptos(o.conceptos, "INGRESOS", "COSTO_LABORAL");
  const transportePorPagarIng = valorAFacturarIng - descuentosIng;
  const diversosIng =
    (totalFacturadoIngresos * GASTOS_DIVERSOS_PCT) / 100 + GASTOS_DIVERSOS_FIJO;

  return {
    total_facturado_ingresos: totalFacturadoIngresos,
    total_admon_ingresos: totalAdmonIngresos,
    total_liquidar_ingresos: totalLiquidarIngresos,
    total_facturado_adicionales: totalFacturadoAdicionales,
    total_admon_adicionales: totalAdmonAdicionales,
    total_liquidar_adicionales: totalLiquidarAdicionales,
    total_pagar_adicionales: totalPagarAdicionales,
    total_ingreso_transmeralda: transportePorPagarIng - diversosIng,
  };
}

// ═══════════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════════

export const LiquidacionesTercerosIngresosService = {
  /**
   * Los 12 meses de un año en UNA sola consulta.
   *
   * El canvas es un libro anual, así que pedir mes a mes serían 12
   * round-trips para pintar el mismo workbook. Se trae el año entero y se
   * reparte por mes en memoria; el volumen es el de los items de terceros
   * con ingreso de un año, no el de toda la tabla.
   *
   * Devuelve SIEMPRE las 12 claves (el canvas asume que existen).
   */
  async listarAnual(anio: number): Promise<Record<number, IngresoTerceroRow[]>> {
    const rows = await prisma.liquidacion_tercero.findMany({
      where: whereIngresos({ anio }),
      include: INCLUDE_INGRESO,
      orderBy: ORDER_BY,
    });

    const meses: Record<number, IngresoTerceroRow[]> = {};
    for (let m = 1; m <= 12; m++) meses[m] = [];
    for (const row of rows) {
      const serial = serializeRow(row);
      if (serial.mes >= 1 && serial.mes <= 12) meses[serial.mes].push(serial);
    }
    return meses;
  },

  /// Un solo mes. Lo usa el botón "Recargar mes" del canvas, para no
  /// rehacer el año entero por refrescar una hoja.
  async listarPorPeriodo(mes: number, anio: number): Promise<IngresoTerceroRow[]> {
    const rows = await prisma.liquidacion_tercero.findMany({
      where: whereIngresos({ anio, mes }),
      include: INCLUDE_INGRESO,
      orderBy: ORDER_BY,
    });
    return rows.map(serializeRow);
  },

  /**
   * Estado EDITABLE de los 12 meses de un año.
   *
   * Va aparte de `listarAnual` y no dentro: las filas de la hoja son datos
   * derivados que se leen en vivo, y esto son las decisiones del equipo
   * encima de ellas. Mezclarlos en una sola consulta obligaría a recorrer
   * `liquidacion_tercero` para responder «qué marcó el usuario».
   *
   * Devuelve SIEMPRE las 12 claves; un mes sin cabecera llega con `null` y el
   * canvas lo pinta con los porcentajes por defecto.
   */
  async estadoAnual(anio: number): Promise<Record<number, EstadoIngresoMes>> {
    const cabeceras = await prisma.liquidacion_ingreso_transmeralda.findMany({
      where: { anio, deleted_at: null },
      include: {
        filas: { where: { deleted_at: null } },
        conceptos: { where: { deleted_at: null }, orderBy: { orden: "asc" } },
      },
    });

    const out: Record<number, EstadoIngresoMes> = {};
    for (let m = 1; m <= 12; m++) {
      out[m] = { cabecera: null, filas: [], conceptos: [] };
    }
    for (const cab of cabeceras) {
      if (cab.mes < 1 || cab.mes > 12) continue;
      const { filas, conceptos, ...cabecera } = cab as any;
      out[cab.mes] = {
        cabecera: serializeCabecera(cabecera),
        filas: filas.map(serializeFila),
        conceptos: conceptos.map(serializeConcepto),
      };
    }
    return out;
  },

  /// El estado editable de UN mes. Lo usa el canvas tras guardar, para releer
  /// exactamente lo que quedó en la base en vez de fiarse de lo que envió.
  async estadoPorPeriodo(mes: number, anio: number): Promise<EstadoIngresoMes> {
    const cab = await prisma.liquidacion_ingreso_transmeralda.findFirst({
      where: { mes, anio, deleted_at: null },
      include: {
        filas: { where: { deleted_at: null } },
        conceptos: { where: { deleted_at: null }, orderBy: { orden: "asc" } },
      },
    });
    if (!cab) return { cabecera: null, filas: [], conceptos: [] };
    const { filas, conceptos, ...cabecera } = cab as any;
    return {
      cabecera: serializeCabecera(cabecera),
      filas: filas.map(serializeFila),
      conceptos: conceptos.map(serializeConcepto),
    };
  },

  /**
   * Guarda el estado editable de un mes. Idempotente y sin paso previo de
   * «generar borrador»: la cabecera se crea en el primer guardado.
   *
   * Las filas de override se guardan de forma DISPERSA: solo las que dicen
   * algo distinto del valor por defecto. Una fila que vuelve a lo de siempre
   * —sin marcar, cantidad 1, sin porcentajes propios— se elimina en lugar de
   * persistir un registro que no aporta nada. Con cientos de servicios al mes,
   * guardarlas todas sería llenar la tabla de ruido.
   */
  async guardarBorrador(params: GuardarIngresoParams) {
    const { mes, anio, user_id } = params;

    // 1) Cabecera (crear si es el primer guardado del mes).
    const existente = await prisma.liquidacion_ingreso_transmeralda.findFirst({
      where: { mes, anio, deleted_at: null },
      select: { id: true },
    });
    const cabecera = existente
      ? existente
      : await prisma.liquidacion_ingreso_transmeralda.create({
          data: {
            mes,
            anio,
            creado_por_id: user_id || null,
            actualizado_por_id: user_id || null,
          },
          select: { id: true },
        });

    const pctAdmonIngresos = params.pct_admon_ingresos ?? PCT_ADMON_INGRESOS;
    const pctGanancia = params.pct_ganancia_adicionales ?? PCT_GANANCIA_ADICIONALES;
    const pctAdmonAdic = params.pct_admon_adicionales ?? PCT_ADMON_ADICIONALES;

    // 2) Filas: solo las que dicen algo. Ver la nota de arriba.
    const filasEntrantes = (Array.isArray(params.filas) ? params.filas : []).filter(
      (f) => f?.liquidacion_tercero_id,
    );
    const esRelevante = (f: FilaIngresoInput) =>
      f.incluir_adicional === true ||
      (f.cantidad != null && toNumber(f.cantidad) !== 1) ||
      f.pct_admon_ingresos != null ||
      f.pct_ganancia != null ||
      f.pct_admon_adicional != null ||
      f.valor_unitario_adicional != null;

    // Dedupe por item: el `@@unique([cabecera, item])` lo rechazaría, y el
    // último gana igual que en el resto de canvas.
    const porItem = new Map<string, FilaIngresoInput>();
    for (const f of filasEntrantes) {
      if (esRelevante(f)) porItem.set(f.liquidacion_tercero_id, f);
    }
    const filasSanitizadas = [...porItem.values()].map((f) => ({
      liquidacion_tercero_id: f.liquidacion_tercero_id,
      incluir_adicional: f.incluir_adicional === true,
      cantidad: f.cantidad == null ? 1 : toNumber(f.cantidad),
      pct_admon_ingresos:
        f.pct_admon_ingresos == null ? null : toNumber(f.pct_admon_ingresos),
      pct_ganancia: f.pct_ganancia == null ? null : toNumber(f.pct_ganancia),
      pct_admon_adicional:
        f.pct_admon_adicional == null ? null : toNumber(f.pct_admon_adicional),
      valor_unitario_adicional:
        f.valor_unitario_adicional == null
          ? null
          : toNumber(f.valor_unitario_adicional),
      orden: f.orden ?? 0,
      actualizado_por_id: user_id || null,
    }));

    // 3) Conceptos del pie de las dos hojas.
    const conceptosSanitizados = dedupePorId(
      (Array.isArray(params.conceptos) ? params.conceptos : [])
        .filter((c) => c && c.hoja && c.tipo && c.concepto)
        .map((c) => {
          // Igual que en ocasional: si el total viene en cero pero hay con qué
          // calcularlo, se calcula. Ahorra que el cliente tenga que replicar
          // la multiplicación en cada edición.
          let valorTotal = toNumber(c.valor_total);
          if (valorTotal === 0 && c.dias && c.valor_unitario) {
            valorTotal = toNumber(c.dias) * toNumber(c.valor_unitario);
          } else if (valorTotal === 0 && c.porcentaje && c.base_calculo) {
            valorTotal = (toNumber(c.base_calculo) * toNumber(c.porcentaje)) / 100;
          }
          return {
            id: c.id || randomUUID(),
            hoja: c.hoja,
            tipo: c.tipo,
            concepto: c.concepto,
            persona: c.persona || null,
            dias: c.dias == null ? null : toNumber(c.dias),
            valor_unitario: toNumber(c.valor_unitario),
            porcentaje: c.porcentaje == null ? null : toNumber(c.porcentaje),
            valor_total: valorTotal,
            base_calculo: c.base_calculo == null ? null : toNumber(c.base_calculo),
            observaciones: c.observaciones || null,
            orden: c.orden ?? 0,
            actualizado_por_id: user_id || null,
          };
        }),
    );

    // 4) Totales, con los items del mes leídos en vivo.
    const items = await this.listarPorPeriodo(mes, anio);
    const totales = recalcularIngresos({
      items,
      filas: filasSanitizadas,
      conceptos: conceptosSanitizados as any,
      pctAdmonIngresos,
      pctGananciaAdicionales: pctGanancia,
      pctAdmonAdicionales: pctAdmonAdic,
    });

    // 5) Escrituras: REEMPLAZO COMPLETO, no upsert fila a fila.
    //
    // POR QUÉ: un mes de abril tiene 200 servicios y más de 60 decisiones
    // guardadas. Con un `upsert` por fila la transacción llevaba 70+ sentencias
    // y, contra una base remota, el guardado se pasaba de los 30 s de timeout
    // del cliente: la edición se veía en pantalla y no llegaba nunca a la base.
    // Así son SIEMPRE cuatro sentencias, independientemente del tamaño del mes.
    //
    // El borrado es FÍSICO y no lógico, a diferencia del resto de tablas del
    // módulo. Dos razones: estas filas no son documentos —son la decisión que
    // el equipo tomó sobre un servicio, y se reescriben enteras en cada
    // guardado, así que no hay historial que preservar—, y el índice único
    // `(cabecera, item)` no incluye `deleted_at`, con lo que una fila marcada
    // como borrada seguiría chocando con la que la sustituye.
    const ahora = new Date();
    const operaciones: any[] = [
      prisma.liquidacion_ingreso_transmeralda_fila.deleteMany({
        where: { liquidacion_ingreso_id: cabecera.id },
      }),
      prisma.liquidacion_ingreso_transmeralda_concepto.deleteMany({
        where: { liquidacion_ingreso_id: cabecera.id },
      }),
    ];

    if (filasSanitizadas.length > 0) {
      operaciones.push(
        prisma.liquidacion_ingreso_transmeralda_fila.createMany({
          data: filasSanitizadas.map((f) => ({
            ...f,
            liquidacion_ingreso_id: cabecera.id,
          })),
        }),
      );
    }
    if (conceptosSanitizados.length > 0) {
      operaciones.push(
        prisma.liquidacion_ingreso_transmeralda_concepto.createMany({
          data: conceptosSanitizados.map((c) => ({
            ...c,
            liquidacion_ingreso_id: cabecera.id,
          })),
        }),
      );
    }

    operaciones.push(
      prisma.liquidacion_ingreso_transmeralda.update({
        where: { id: cabecera.id },
        data: {
          observaciones: params.observaciones ?? undefined,
          pct_admon_ingresos: pctAdmonIngresos,
          pct_ganancia_adicionales: pctGanancia,
          pct_admon_adicionales: pctAdmonAdic,
          actualizado_por_id: user_id || undefined,
          updated_at: ahora,
          ...totales,
        },
      }),
    );

    await prisma.$transaction(operaciones);

    return {
      ok: true,
      id: cabecera.id,
      accion: existente ? ("updated" as const) : ("created" as const),
      totales,
      filas_count: filasSanitizadas.length,
      conceptos_count: conceptosSanitizados.length,
    };
  },
};

// ═══════════════════════════════════════════════════════════════
// SERIALIZADORES
// ═══════════════════════════════════════════════════════════════

/// Última ocurrencia de cada id. Los canvas pueden mandar la misma fila dos
/// veces cuando dos ediciones caen en el mismo ciclo de autoguardado.
function dedupePorId<T extends { id: string }>(filas: T[]): T[] {
  const m = new Map<string, T>();
  for (const f of filas) m.set(f.id, f);
  return [...m.values()];
}

function serializeCabecera(c: any) {
  return {
    id: c.id,
    mes: c.mes,
    anio: c.anio,
    observaciones: c.observaciones ?? null,
    pct_admon_ingresos: toNumber(c.pct_admon_ingresos),
    pct_ganancia_adicionales: toNumber(c.pct_ganancia_adicionales),
    pct_admon_adicionales: toNumber(c.pct_admon_adicionales),
    total_facturado_ingresos: toNumber(c.total_facturado_ingresos),
    total_admon_ingresos: toNumber(c.total_admon_ingresos),
    total_liquidar_ingresos: toNumber(c.total_liquidar_ingresos),
    total_facturado_adicionales: toNumber(c.total_facturado_adicionales),
    total_admon_adicionales: toNumber(c.total_admon_adicionales),
    total_liquidar_adicionales: toNumber(c.total_liquidar_adicionales),
    total_pagar_adicionales: toNumber(c.total_pagar_adicionales),
    total_ingreso_transmeralda: toNumber(c.total_ingreso_transmeralda),
    version: c.version,
    updated_at: c.updated_at,
  };
}

function serializeFila(f: any) {
  return {
    id: f.id,
    liquidacion_tercero_id: f.liquidacion_tercero_id,
    incluir_adicional: f.incluir_adicional,
    cantidad: toNumber(f.cantidad),
    pct_admon_ingresos:
      f.pct_admon_ingresos == null ? null : toNumber(f.pct_admon_ingresos),
    pct_ganancia: f.pct_ganancia == null ? null : toNumber(f.pct_ganancia),
    pct_admon_adicional:
      f.pct_admon_adicional == null ? null : toNumber(f.pct_admon_adicional),
    valor_unitario_adicional:
      f.valor_unitario_adicional == null
        ? null
        : toNumber(f.valor_unitario_adicional),
    orden: f.orden ?? 0,
    version: f.version,
  };
}

function serializeConcepto(c: any) {
  return {
    id: c.id,
    hoja: c.hoja,
    tipo: c.tipo,
    concepto: c.concepto,
    persona: c.persona ?? null,
    dias: c.dias == null ? null : toNumber(c.dias),
    valor_unitario: toNumber(c.valor_unitario),
    porcentaje: c.porcentaje == null ? null : toNumber(c.porcentaje),
    valor_total: toNumber(c.valor_total),
    base_calculo: c.base_calculo == null ? null : toNumber(c.base_calculo),
    observaciones: c.observaciones ?? null,
    orden: c.orden ?? 0,
    version: c.version,
  };
}
