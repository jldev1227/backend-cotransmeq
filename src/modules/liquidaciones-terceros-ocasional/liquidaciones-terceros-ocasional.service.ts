import { prisma } from "../../config/prisma";
import { randomUUID } from "crypto";
import { getIo } from "../../sockets";

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

export interface AdicionalOcasionalInput {
  id?: string;
  cliente?: string;
  placa: string;
  tercero_id?: string | null;
  tercero_nombre?: string | null;
  vehiculo_id?: string | null;
  recorrido?: string | null;
  fechas?: string | null;
  valor_unitario: number;
  cantidad: number;
  porcentaje_admin?: number;
  valor_admin?: number;
  valor_liquidar?: number;
  aplica_impuestos?: boolean;
  orden?: number;
}

export interface ConceptoOcasionalInput {
  id?: string;
  tipo: "GASTO_OPERATIVO" | "IMPUESTO" | "ANTICIPO";
  concepto: string;
  conductor_id?: string | null;
  placa_aplicada?: string | null;
  dias?: number | null;
  valor_unitario?: number;
  porcentaje?: number | null;
  valor_total?: number;
  base_calculo?: number | null;
  calculado?: boolean;
  observaciones?: string | null;
  orden?: number;
}

export interface ItemOcasionalInput {
  id?: string;
  /**
   * FK al item pivote `liquidacion_tercero`. La columna es NOT NULL en
   * `liquidacion_tercero_ocasional_item`, así que los items que lleguen sin
   * este id se descartan en `guardarBorrador` (no se envía `null`, que hacía
   * fallar el upsert entero).
   */
  liquidacion_tercero_id?: string | null;
  liquidacion_servicio_id?: string | null;
  cliente_nombre: string;
  consecutivo: string;
  placa: string;
  tercero_id?: string | null;
  tercero_nombre: string;
  tercero_documento?: string | null;
  recorrido: string;
  fechas: string;
  valor_unitario: number;
  cantidad: number;
  porcentaje_admin?: number;
  valor_admin?: number;
  total_facturado?: number;
  valor_liquidar?: number;
  numero_planilla?: string | null;
  ingreso_extra_global?: number;
  ingresos_extra_aval?: number;
  ingreso_empresa?: number;
  numero_factura?: string | null;
  aplica_impuestos?: boolean;
  excluido?: boolean;
  orden?: number;
}

export interface GenerarBorradorOcasionalInput {
  mes: number;
  anio: number;
  /// Placas o tercero_id a incluir. Si vacío o null → todos los del mes.
  terceros_filtro?: string[];
  user_id?: string;
}

export interface GuardarBorradorOcasionalParams {
  id?: string;
  mes: number;
  anio: number;
  observaciones?: string | null;
  adicionales: AdicionalOcasionalInput[];
  conceptos: ConceptoOcasionalInput[];
  items: ItemOcasionalInput[];
  user_id?: string;
  force_new?: boolean;
}

export interface AutosaveDraftParams {
  liquidacion_ocasional_id: string;
  user_id: string;
  payload: any;
}

export interface CerrarYDistribuirParams {
  id: string;
  user_id: string;
}

export interface PrevisualizarParams {
  mes: number;
  anio: number;
  terceros_filtro?: string[];
}

const MESES = [
  "ENERO",
  "FEBRERO",
  "MARZO",
  "ABRIL",
  "MAYO",
  "JUNIO",
  "JULIO",
  "AGOSTO",
  "SEPTIEMBRE",
  "OCTUBRE",
  "NOVIEMBRE",
  "DICIEMBRE",
];

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

/**
 * Completa los items ocasionales con los datos que NO viven en su propia
 * tabla y hay que ir a buscar a la liquidación de servicio de origen.
 *
 * POR QUÉ EXISTE: `liquidacion_tercero_ocasional_item` no tiene columna
 * `valor_recargos` ni relación Prisma hacia `liquidacion_servicio` — solo
 * guarda el FK `liquidacion_servicio_id`. Los recargos son del servicio
 * (cabecera), no del item, así que la columna RECARGOS del canvas tiene que
 * resolverse aquí. El número de factura sí se persiste en el item, pero puede
 * emitirse DESPUÉS de generado el borrador, así que se expone también el
 * vigente del servicio para que el canvas caiga a él cuando el propio está
 * vacío.
 *
 * Una sola query para todo el lote: los llamadores pueden pasarle los items de
 * las 12 hojas del año de golpe.
 */
/**
 * Placas del periodo que YA tienen cierre final.
 *
 * El ocasional es, por definición, lo que NO entró en un cierre: si una placa
 * ya tiene su `liquidacion_tercero_final` del mes, sus items no deben volver a
 * aparecer aquí o se liquidarían dos veces.
 *
 * Se compara por placa y no por item porque el cierre final es POR PLACA: en
 * cuanto existe, toda esa placa queda fuera del ocasional de ese periodo.
 */
async function placasConCierreFinal(mes: number, anio: number): Promise<Set<string>> {
  const finales = await prisma.liquidacion_tercero_final.findMany({
    where: { mes: Number(mes), anio: Number(anio), deleted_at: null },
    select: { placa: true },
  });
  return new Set(
    finales.map((f) => String(f.placa || "").toUpperCase().trim()).filter(Boolean),
  );
}

/**
 * Items de `liquidacion_tercero` del periodo que son CANDIDATOS al ocasional.
 *
 * Excluye los de placas que ya tienen cierre final. `excluirLiquidacionTerceroIds`
 * permite además descartar los que ya están en el borrador, que es lo que
 * necesita el refresco para añadir solo lo nuevo.
 */
async function itemsCandidatosOcasional(params: {
  mes: number;
  anio: number;
  filtroPlacas?: string[];
  filtroTercerosIds?: string[];
  excluirLiquidacionTerceroIds?: Set<string>;
}) {
  const { mes, anio, filtroPlacas = [], filtroTercerosIds = [] } = params;

  const where: any = { liquidacion: { mes, anio } };
  if (filtroPlacas.length > 0 || filtroTercerosIds.length > 0) {
    where.OR = [
      ...(filtroPlacas.length > 0 ? [{ placa: { in: filtroPlacas } }] : []),
      ...(filtroTercerosIds.length > 0
        ? [{ tercero_id: { in: filtroTercerosIds } }]
        : []),
    ];
  }

  const [items, conFinal] = await Promise.all([
    prisma.liquidacion_tercero.findMany({
      where,
      include: {
        tercero: {
          select: { id: true, nombre_completo: true, identificacion: true },
        },
        item: { select: { id: true, numero_planilla: true } },
        liquidacion: {
          select: {
            id: true,
            consecutivo: true,
            cliente: { select: { id: true, nombre: true, nit: true } },
            factura_items: {
              where: { factura: { deleted_at: null, estado: "ACTIVA" } },
              select: { factura: { select: { numero_factura: true } } },
              take: 1,
            },
          },
        },
      },
    }),
    placasConCierreFinal(mes, anio),
  ]);

  const yaEnBorrador = params.excluirLiquidacionTerceroIds ?? new Set<string>();
  return items.filter((lt) => {
    if (yaEnBorrador.has(lt.id)) return false;
    const placa = String(lt.placa || "").toUpperCase().trim();
    // Sin placa no hay forma de saber si tiene cierre: se descarta, porque
    // arrastrarlo produciría una fila sin identidad en el ocasional.
    if (!placa) return false;
    return !conFinal.has(placa);
  });
}

async function conDatosDelServicio(items: any[]): Promise<any[]> {
  const lista = items || [];
  const servicioIds = Array.from(
    new Set(
      lista
        .map((it: any) => it.liquidacion_servicio_id)
        .filter((sid: string | null | undefined): sid is string => !!sid)
    )
  );
  if (servicioIds.length === 0) {
    return lista.map((it: any) => ({ ...it, liquidacion_servicio: null }));
  }

  const servicios = await prisma.liquidacion_servicio.findMany({
    where: { id: { in: servicioIds } },
    select: {
      id: true,
      valor_recargos: true,
      // `take: 1` + filtro de activas: una liquidación puede tener facturas
      // anuladas históricas, y la que interesa es la vigente.
      factura_items: {
        where: { factura: { deleted_at: null, estado: "ACTIVA" } },
        select: { factura: { select: { numero_factura: true } } },
        take: 1,
      },
    },
  });

  const porServicio = new Map<string, { recargos: number; factura: string }>();
  for (const sv of servicios) {
    porServicio.set(sv.id, {
      recargos: Number((sv as any).valor_recargos) || 0,
      factura: (sv as any).factura_items?.[0]?.factura?.numero_factura || "",
    });
  }

  return lista.map((it: any) => {
    const sid = it.liquidacion_servicio_id || null;
    const datos = sid ? porServicio.get(sid) : undefined;
    return {
      ...it,
      // El número propio del item manda; el del servicio es el respaldo para
      // borradores generados antes de que se emitiera la factura.
      numero_factura: it.numero_factura || datos?.factura || "",
      liquidacion_servicio: sid
        ? {
            id: sid,
            valor_recargos: datos?.recargos ?? 0,
            numero_factura: datos?.factura ?? "",
          }
        : null,
    };
  });
}

function toNumber(v: any): number {
  if (v == null) return 0;
  const n = typeof v === "object" && v !== null ? Number(v) : Number(v);
  return isNaN(n) ? 0 : n;
}

function calcAdicional(a: AdicionalOcasionalInput) {
  const vUnit = toNumber(a.valor_unitario);
  const cant = toNumber(a.cantidad) || 1;
  const pctAdmin = toNumber(a.porcentaje_admin);
  const vAdmin = Math.round((vUnit * cant * pctAdmin) / 100);
  const vLiqBruto = vUnit * cant;
  const vLiqNeto = vLiqBruto - vAdmin;
  return {
    valor_unitario: vUnit,
    cantidad: cant,
    porcentaje_admin: pctAdmin,
    valor_admin: vAdmin,
    valor_liquidar: vLiqNeto,
  };
}

function serializeAdicional(a: any) {
  return {
    ...a,
    valor_unitario: toNumber(a.valor_unitario),
    cantidad: toNumber(a.cantidad),
    porcentaje_admin: toNumber(a.porcentaje_admin),
    valor_admin: toNumber(a.valor_admin),
    valor_liquidar: toNumber(a.valor_liquidar),
  };
}

function serializeConcepto(c: any) {
  return {
    ...c,
    dias: c.dias != null ? toNumber(c.dias) : null,
    valor_unitario: toNumber(c.valor_unitario),
    porcentaje: c.porcentaje != null ? toNumber(c.porcentaje) : null,
    valor_total: toNumber(c.valor_total),
    base_calculo: c.base_calculo != null ? toNumber(c.base_calculo) : null,
  };
}

function serializeItem(it: any) {
  return {
    ...it,
    valor_unitario: toNumber(it.valor_unitario),
    cantidad: toNumber(it.cantidad),
    porcentaje_admin: toNumber(it.porcentaje_admin),
    valor_admin: toNumber(it.valor_admin),
    total_facturado: toNumber(it.total_facturado),
    valor_liquidar: toNumber(it.valor_liquidar),
    ingreso_extra_global: toNumber(it.ingreso_extra_global),
    ingresos_extra_aval: toNumber(it.ingresos_extra_aval),
    ingreso_empresa: toNumber(it.ingreso_empresa),
  };
}

/**
 * Consecutivo `LOC-{MM}-{YYYY}-{seq}` del PERIODO de la liquidación.
 *
 * Antes tomaba el año y el mes de `new Date()`, es decir de la fecha en que
 * se pulsaba el botón, no del periodo que se estaba liquidando: un borrador
 * de ENERO creado en agosto salía como `LOC-08-...`. Ahora recibe el periodo
 * explícitamente.
 */
async function generarConsecutivo(mes: number, anio: number): Promise<string> {
  const count = await prisma.liquidacion_tercero_ocasional.count({
    where: { anio, deleted_at: null },
  });
  const mm = String(mes).padStart(2, "0");
  const seq = String(count + 1).padStart(4, "0");
  return `LOC-${mm}-${anio}-${seq}`;
}

function recalcularTotales(
  adicionales: any[],
  conceptos: any[],
  items: any[] = [],
) {
  const itemsActivos = items.filter((i) => !i.excluido);
  const totalFacturadoItems = itemsActivos.reduce(
    (s, i) => s + toNumber(i.total_facturado),
    0,
  );
  const totalAdminItems = itemsActivos.reduce(
    (s, i) => s + toNumber(i.valor_admin),
    0,
  );
  const totalLiquidarItems = itemsActivos.reduce(
    (s, i) => s + toNumber(i.valor_liquidar),
    0,
  );
  const totalAdicionales = adicionales.reduce(
    (s, a) => s + toNumber(a.valor_liquidar),
    0,
  );
  const totalGastos = conceptos
    .filter((c) => c.tipo === "GASTO_OPERATIVO")
    .reduce((s, c) => s + toNumber(c.valor_total), 0);
  const totalImpuestos = conceptos
    .filter((c) => c.tipo === "IMPUESTO")
    .reduce((s, c) => s + toNumber(c.valor_total), 0);
  const totalAnticipos = conceptos
    .filter((c) => c.tipo === "ANTICIPO")
    .reduce((s, c) => s + toNumber(c.valor_total), 0);
  const totalDescuentos = totalGastos + totalImpuestos + totalAnticipos;
  const totalPagar = totalLiquidarItems + totalAdicionales - totalDescuentos;
  return {
    total_facturado_items: totalFacturadoItems,
    total_admin_items: totalAdminItems,
    total_liquidar_items: totalLiquidarItems,
    total_adicionales: totalAdicionales,
    total_gastos_operativos: totalGastos,
    total_impuestos: totalImpuestos,
    total_anticipos: totalAnticipos,
    total_descuentos: totalDescuentos,
    total_pagar: totalPagar,
  };
}

function emitRowUpdated(payload: {
  id: string;
  changes: Record<string, any>;
  userId?: string;
}) {
  try {
    const io = getIo();
    const roomKey = `row:liquidacion-tercero-ocasional:${payload.id}`;
    io.to(roomKey).emit("row:updated", {
      id: payload.id,
      changes: payload.changes,
      updatedBy: payload.userId || "system",
      updatedAt: new Date().toISOString(),
    });
    io.emit("row:updated:global", {
      id: payload.id,
      changes: payload.changes,
      updatedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.warn("[ocasional] emitRowUpdated fallo:", (e as Error).message);
  }
}

/// Estas tablas tienen `id` de tipo UUID: un id con cualquier otra forma hace
/// que Prisma aborte el guardado ENTERO con «Error creating UUID».
const UUID_RX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function dedupeById<T extends { id?: string }>(
  rows: T[],
  idFallback: () => string,
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of rows) {
    // Red de seguridad: antes solo se rellenaba el id AUSENTE, así que un id
    // no-UUID enviado por el cliente llegaba tal cual a Postgres y tumbaba el
    // autoguardado completo — items incluidos, aunque el problema fuera de un
    // solo concepto. Ahora se sustituye por uno válido.
    const id = r.id && UUID_RX.test(r.id) ? r.id : idFallback();
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ ...r, id });
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════
// SERVICIO
// ═══════════════════════════════════════════════════════════════════

export const LiquidacionesTercerosOcasionalService = {
  // ─────────── LIST / DETAIL ───────────

  async listar(filtros: { mes?: number; anio?: number }) {
    const where: any = { deleted_at: null };
    if (filtros.mes) where.mes = Number(filtros.mes);
    if (filtros.anio) where.anio = Number(filtros.anio);

    const items = await prisma.liquidacion_tercero_ocasional.findMany({
      where,
      include: {
        creado_por: { select: { id: true, nombre: true, correo: true } },
        actualizado_por: { select: { id: true, nombre: true, correo: true } },
        _count: {
          select: {
            adicionales: { where: { deleted_at: null } },
            conceptos: { where: { deleted_at: null } },
            items: { where: { deleted_at: null } },
            snapshots: true,
          },
        },
      },
      orderBy: [{ anio: "desc" }, { mes: "desc" }, { created_at: "desc" }],
    });

    return { items, total: items.length };
  },

  /**
   * Los 12 meses de un año, para el canvas anual.
   *
   * Devuelve SIEMPRE 12 entradas, aunque el mes no tenga cabecera: el libro
   * anual necesita las 12 hojas para que el deep-link `?mes=` y la barra de
   * hojas sean estables. Un mes sin cabecera llega con `cabecera: null` y el
   * builder renderiza una hoja placeholder.
   *
   * Sustituye el fan-out de 12 peticiones que hacía el cliente. Una sola
   * consulta con `where: { anio }` aprovecha el índice `@@index([mes, anio])`.
   */
  async obtenerAnual(anio: number) {
    const cabeceras = await prisma.liquidacion_tercero_ocasional.findMany({
      where: { anio: Number(anio), deleted_at: null },
      orderBy: { mes: "asc" },
      include: {
        creado_por: { select: { id: true, nombre: true, correo: true } },
        actualizado_por: { select: { id: true, nombre: true, correo: true } },
        items: {
          where: { deleted_at: null },
          orderBy: [{ placa: "asc" }, { orden: "asc" }],
        },
        adicionales: {
          where: { deleted_at: null },
          orderBy: [{ placa: "asc" }, { orden: "asc" }],
        },
        conceptos: {
          where: { deleted_at: null },
          orderBy: [{ tipo: "asc" }, { orden: "asc" }],
        },
      },
    });

    // Una sola pasada para las 12 hojas: `conDatosDelServicio` hace UNA query
    // por lote, así que aplanamos los items del año, resolvemos, y repartimos.
    // Antes esto no se hacía y la columna RECARGOS del canvas salía siempre en
    // $0 — el lookup solo existía en `obtenerPorId`, que el canvas no usa.
    const itemsPorCabecera = new Map<string, any[]>();
    const todosLosItems = cabeceras.flatMap((c) => c.items || []);
    const resueltos = await conDatosDelServicio(todosLosItems);
    for (const it of resueltos) {
      const lista = itemsPorCabecera.get(it.liquidacion_ocasional_id) || [];
      lista.push(it);
      itemsPorCabecera.set(it.liquidacion_ocasional_id, lista);
    }

    const porMes = new Map<number, any>();
    for (const c of cabeceras) porMes.set(c.mes, c);

    const meses = [];
    for (let mes = 1; mes <= 12; mes++) {
      const cab = porMes.get(mes) ?? null;
      const items = cab ? (itemsPorCabecera.get(cab.id) ?? []) : [];
      meses.push({
        mes,
        cabecera: cab ? { ...cab, items } : null,
        items,
        adicionales: cab?.adicionales ?? [],
        conceptos: cab?.conceptos ?? [],
      });
    }
    return { anio: Number(anio), meses };
  },

  async obtenerPorPeriodo(mes: number, anio: number) {
    const cabecera = await prisma.liquidacion_tercero_ocasional.findFirst({
      where: { mes: Number(mes), anio: Number(anio), deleted_at: null },
      include: {
        creado_por: { select: { id: true, nombre: true, correo: true } },
        actualizado_por: { select: { id: true, nombre: true, correo: true } },
        items: {
          where: { deleted_at: null },
          orderBy: [{ placa: "asc" }, { orden: "asc" }],
        },
        adicionales: {
          where: { deleted_at: null },
          orderBy: [{ placa: "asc" }, { orden: "asc" }],
        },
        conceptos: {
          where: { deleted_at: null },
          orderBy: [{ tipo: "asc" }, { orden: "asc" }],
        },
      },
    });

    if (!cabecera) return cabecera;
    return { ...cabecera, items: await conDatosDelServicio(cabecera.items) };
  },

  async obtenerPorId(id: string) {
    const cabecera = await prisma.liquidacion_tercero_ocasional.findFirst({
      where: { id, deleted_at: null },
      include: {
        creado_por: { select: { id: true, nombre: true, correo: true } },
        actualizado_por: { select: { id: true, nombre: true, correo: true } },
        items: {
          // Nota: el modelo `liquidacion_tercero_ocasional_item` NO tiene una
          // relación Prisma explícita hacia `liquidacion_servicio` (solo guarda
          // el FK `liquidacion_servicio_id`). Hacemos el lookup en una query
          // separada más abajo para inyectar `valor_recargos` por item.
          where: { deleted_at: null },
          orderBy: [{ placa: "asc" }, { orden: "asc" }],
        },
        adicionales: {
          where: { deleted_at: null },
          orderBy: [{ placa: "asc" }, { orden: "asc" }],
        },
        conceptos: {
          where: { deleted_at: null },
          orderBy: [{ tipo: "asc" }, { orden: "asc" }],
        },
      },
    });

    if (!cabecera) return cabecera;

    return { ...cabecera, items: await conDatosDelServicio(cabecera.items) };
  },

  // ─────────── PREVISUALIZAR (selector modal) ───────────

  /**
   * Dado un (mes, anio) y un filtro de terceros (placas o tercero_id),
   * devuelve los cierres finales candidatos y el conteo de items que
   * se incluirían. NO crea la cabecera.
   *
   * El filtro acepta:
   *  - tercero_id (UUID del tercero)
   *  - placa (texto)
   * Si `terceros_filtro` está vacío, devuelve TODOS los cierres del mes.
   */
  async previsualizar(input: PrevisualizarParams) {
    const { mes, anio, terceros_filtro = [] } = input;

    // Fuente: items sueltos de `liquidacion_tercero` del periodo. El
    // previsualizador muestra qué items se incluirían al generar el
    // ocasional, agrupados por cierre (tercero + placa + servicio).
    const UUID_RX =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const filtroTercerosIds = terceros_filtro.filter((t) => UUID_RX.test(t));
    const filtroPlacas = terceros_filtro.filter((t) => !UUID_RX.test(t));

    const items = await prisma.liquidacion_tercero.findMany({
      where: {
        liquidacion: { mes, anio },
        ...(terceros_filtro.length > 0
          ? {
              OR: [
                ...(filtroPlacas.length > 0
                  ? [{ placa: { in: filtroPlacas } }]
                  : []),
                ...(filtroTercerosIds.length > 0
                  ? [{ tercero_id: { in: filtroTercerosIds } }]
                  : []),
              ],
            }
          : {}),
      },
      select: {
        id: true,
        placa: true,
        estado: true,
        tercero_id: true,
        liquidacion_id: true,
      },
      orderBy: { placa: "asc" },
      take: 500,
    });

    // Agrupar items por (tercero_id, placa, liquidacion_id) para mostrar
    // cuántos "cierres" se crearían. (En el nuevo flujo no se crean
    // cierres_final, pero esto preserva la shape que el frontend espera.)
    const map = new Map<
      string,
      {
        placa: string;
        tercero_id: string | null;
        liquidacion_id: string;
        items_count: number;
      }
    >();
    for (const it of items) {
      const k = `${it.tercero_id || ""}|${it.placa}|${it.liquidacion_id}`;
      if (!map.has(k)) {
        map.set(k, {
          placa: it.placa,
          tercero_id: it.tercero_id,
          liquidacion_id: it.liquidacion_id,
          items_count: 0,
        });
      }
      map.get(k)!.items_count++;
    }

    const cierres_candidatos = Array.from(map.values()).map((e, idx) => ({
      id: `preview-${idx}`,
      consecutivo: `${e.placa}`,
      placa: e.placa,
      estado: "BORRADOR",
      tercero_id: e.tercero_id,
      _count: { items: e.items_count },
    }));

    return {
      cierres_candidatos,
      cierres_bloqueados: [],
      total_items_estimados: items.length,
      total_cierres: cierres_candidatos.length,
    };
  },

  /**
   * Buscar terceros que tengan cierres finales en el mes/año.
   * Usado por el modal selector para mostrar candidatos por
   * documento/NIT, placa o nombre del tercero.
   */
  /**
   * Listar terceros con items de `liquidacion_tercero` en el mes/año.
   * Usado por el modal selector para mostrar candidatos por
   * documento/NIT, placa o nombre del tercero.
   *
   * El ocasional agrupa items directamente desde `liquidacion_tercero`,
   * sin pasar por cierres_final. Por eso el modal muestra **todos** los
   * items del periodo — sin filtrar por cierres_final (incluso los que
   * quedaron vinculados a cierres_final de corridas anteriores del flujo
   * viejo, siguen siendo items del mes y el usuario puede incluirlos en
   * un nuevo ocasional).
   */
  async buscarTercerosCandidatos(input: {
    mes: number;
    anio: number;
    busqueda?: string;
    filtro_tipo?: "documento" | "placa" | "nombre";
  }) {
    const { mes, anio, busqueda = "", filtro_tipo = "nombre" } = input;
    const q = busqueda.trim();

    // Para el filtro por placa normalizamos la entrada (mayúsculas +
    // quitar separadores como `-`, ` `) y comparamos contra la columna
    // cruda con dos variantes: contains literal case-insensitive +
    // contains sobre la versión sin separadores. Así "WDU-151" / "WDU 151"
    // / "WDU151" matchean aunque la columna tenga separadores.

    // El campo `mes`/`anio` del item suele ser NULL — el periodo real
    // vive en `liquidacion_servicio.mes/anio`. Filtramos por la relación.
    const items = await prisma.liquidacion_tercero.findMany({
      where: {
        liquidacion: { mes, anio },
        ...(q
          ? filtro_tipo === "documento"
            ? {
                tercero: {
                  identificacion: { contains: q, mode: "insensitive" as any },
                },
              }
            : filtro_tipo === "nombre"
              ? {
                  tercero: {
                    nombre_completo: {
                      contains: q,
                      mode: "insensitive" as any,
                    },
                  },
                }
              : filtro_tipo === "placa"
                ? {
                    OR: [
                      { placa: { contains: q, mode: "insensitive" as any } },
                      {
                        placa: {
                          contains: q.replace(/[^a-zA-Z0-9]/g, ""),
                          mode: "insensitive" as any,
                        },
                      },
                    ],
                  }
                : {}
          : {}),
      },
      select: {
        id: true,
        placa: true,
        estado: true,
        tercero_id: true,
        tercero: {
          select: { id: true, nombre_completo: true, identificacion: true },
        },
      },
      orderBy: { placa: "asc" },
      take: 500,
    });

    // Agrupar por tercero (un tercero puede tener N items / N placas).
    const map = new Map<
      string,
      {
        tercero_id: string;
        tercero_nombre: string;
        tercero_documento: string | null;
        placas: string[];
        items_count: number;
        cierres_bloqueados: number;
      }
    >();
    for (const it of items) {
      const k = it.tercero_id || `placa:${it.placa}`;
      if (!map.has(k)) {
        map.set(k, {
          tercero_id: it.tercero_id || "",
          tercero_nombre: it.tercero?.nombre_completo || "(sin tercero)",
          tercero_documento: it.tercero?.identificacion || null,
          placas: [],
          items_count: 0,
          cierres_bloqueados: 0,
        });
      }
      const entry = map.get(k)!;
      if (!entry.placas.includes(it.placa)) entry.placas.push(it.placa);
      entry.items_count++;
    }

    // Mapeo al shape que espera el frontend (TerceroCandidato).
    // `cierres_count` se renombra conceptualmente a `items_count` (cantidad
    // de items del periodo). `cierres_bloqueados` queda en 0 — el
    // ocasional no puede bloquearse, es solo un agregado de items.
    return Array.from(map.values()).map((e) => ({
      tercero_id: e.tercero_id,
      tercero_nombre: e.tercero_nombre,
      tercero_documento: e.tercero_documento,
      placas: e.placas,
      cierres_count: e.items_count,
      cierres_bloqueados: e.cierres_bloqueados,
    }));
  },

  // ─────────── GENERAR BORRADOR ───────────

  /**
   * Incorpora al borrador los items que se hayan vuelto elegibles DESPUÉS de
   * generarlo.
   *
   * El caso real: se liquidan servicios nuevos a lo largo del mes, o una placa
   * que estaba en un cierre final deja de estarlo. Sin esto había que borrar el
   * borrador y regenerarlo, perdiendo adicionales, conceptos y anotaciones.
   *
   * Es ADITIVO: nunca toca ni borra lo que ya está: solo añade lo que falta.
   * Los ya presentes se detectan por `liquidacion_tercero_id`, que es el
   * vínculo con el item de origen, no por placa ni por importes.
   */
  async refrescar(params: { mes: number; anio: number; user_id?: string }) {
    const { mes, anio, user_id } = params;

    const cabecera = await prisma.liquidacion_tercero_ocasional.findFirst({
      where: { mes: Number(mes), anio: Number(anio), deleted_at: null },
      include: {
        items: {
          where: { deleted_at: null },
          select: { liquidacion_tercero_id: true, orden: true },
        },
      },
    });
    if (!cabecera) {
      return {
        ok: false,
        accion: "sin_borrador",
        message: `No hay borrador para ${MESES[mes - 1]} ${anio}. Genéralo primero.`,
      };
    }
    if (["APROBADA", "FACTURADA", "ANULADA"].includes(cabecera.estado || "")) {
      return {
        ok: false,
        accion: "estado_bloqueado",
        message: `La liquidación está ${cabecera.estado}: no admite items nuevos.`,
      };
    }

    const yaPresentes = new Set(
      cabecera.items
        .map((i) => i.liquidacion_tercero_id)
        .filter((x): x is string => !!x),
    );

    const nuevos = await itemsCandidatosOcasional({
      mes: Number(mes),
      anio: Number(anio),
      excluirLiquidacionTerceroIds: yaPresentes,
    });

    if (nuevos.length === 0) {
      return {
        ok: true,
        accion: "sin_cambios",
        agregados: 0,
        message: `${MESES[mes - 1]} ${anio} ya está al día: no hay items nuevos.`,
      };
    }

    // Los nuevos van al final, después del mayor `orden` existente.
    let orden = cabecera.items.reduce((m, i) => Math.max(m, i.orden ?? 0), -1) + 1;

    const filas = nuevos.map((lt: any) => {
      const liq = lt.liquidacion;
      return {
        id: randomUUID(),
        liquidacion_ocasional_id: cabecera.id,
        liquidacion_tercero_id: lt.id,
        liquidacion_servicio_id: lt.liquidacion_id,
        cliente_nombre: liq?.cliente?.nombre || "",
        consecutivo: liq?.consecutivo || "",
        placa: (lt.placa || "").toUpperCase().trim(),
        tercero_id: lt.tercero_id || null,
        tercero_nombre: lt.tercero?.nombre_completo || "",
        tercero_documento: lt.tercero?.identificacion || null,
        recorrido: lt.recorrido || "",
        fechas: lt.fechas || "",
        valor_unitario: toNumber(lt.valor_unitario),
        cantidad: toNumber(lt.cantidad) || 1,
        porcentaje_admin: toNumber(lt.porcentaje_admin),
        valor_admin: toNumber(lt.valor_admin),
        total_facturado: toNumber(lt.total_facturado),
        valor_liquidar: toNumber(lt.valor_liquidar),
        numero_planilla: lt.item?.numero_planilla || null,
        ingreso_extra_global: toNumber(lt.ingreso_extra_global),
        ingresos_extra_aval: toNumber(lt.ingresos_extra_aval),
        ingreso_empresa: toNumber(lt.ingreso_empresa),
        numero_factura:
          liq?.factura_items?.[0]?.factura?.numero_factura || "",
        aplica_impuestos: true,
        excluido: false,
        orden: orden++,
      };
    });

    await prisma.liquidacion_tercero_ocasional_item.createMany({ data: filas });

    await prisma.liquidacion_tercero_ocasional.update({
      where: { id: cabecera.id },
      data: { actualizado_por_id: user_id || cabecera.actualizado_por_id },
    });

    const placas = [...new Set(filas.map((f) => f.placa))];
    return {
      ok: true,
      accion: "actualizado",
      id: cabecera.id,
      agregados: filas.length,
      placas,
      message:
        `Se añadieron ${filas.length} item(s) de ${placas.length} placa(s): ` +
        placas.join(", "),
    };
  },

  // ── ITEMS DISPONIBLES DE OTROS PERIODOS ──
  //
  // `refrescar` solo mira EL MISMO mes del borrador, que es lo correcto cuando
  // el mes se quedó corto porque entraron liquidaciones de servicio nuevas. No
  // sirve para el otro caso: un servicio de mayo que nadie liquidó y que se
  // quiere cobrar en el ocasional de junio. Ese item nunca cae en el filtro de
  // periodo, y regenerar el borrador se lleva por delante lo tecleado.
  //
  // Aquí el periodo NO filtra: se listan los items de cualquier mes que sigan
  // sueltos. Lo que sí sigue mandando son las dos reglas del ocasional:
  //
  //   · la placa no puede tener CIERRE FINAL en el mes DEL ITEM. Si lo tiene,
  //     ese servicio ya se liquidó por la vía de la placa y traerlo aquí lo
  //     pagaría dos veces. Se evalúa contra su propio mes y no contra el mes
  //     destino: lo que decide es dónde se liquidó, no dónde se va a cobrar.
  //   · no puede estar ya en OTRO ocasional vivo, por lo mismo.
  async itemsDisponibles(params: { mes: number; anio: number }) {
    const mes = Number(params.mes);
    const anio = Number(params.anio);

    const cabecera = await prisma.liquidacion_tercero_ocasional.findFirst({
      where: { mes, anio, deleted_at: null },
      select: { id: true, consecutivo: true, estado: true },
    });

    const [candidatos, enOcasionales, finales] = await Promise.all([
      prisma.liquidacion_tercero.findMany({
        where: {
          // Sin factura el ingreso no es cobrable todavía, igual que en la hoja
          // de ingresos. Un ocasional sin factura se quedaría esperando.
          liquidacion: {
            deleted_at: null,
            estado: { not: "ANULADA" as any },
            factura_items: {
              some: { factura: { deleted_at: null, estado: "ACTIVA" as const } },
            },
          },
        },
        include: {
          tercero: {
            select: { id: true, nombre_completo: true, identificacion: true },
          },
          item: { select: { id: true, numero_planilla: true } },
          liquidacion: {
            select: {
              id: true,
              consecutivo: true,
              mes: true,
              anio: true,
              cliente: { select: { id: true, nombre: true, nit: true } },
              factura_items: {
                where: { factura: { deleted_at: null, estado: "ACTIVA" } },
                select: { factura: { select: { numero_factura: true } } },
                take: 1,
              },
            },
          },
          // Cierres finales que ya se lo llevaron. Se piden todos y se filtra
          // en memoria por la misma razón que en el módulo de placas: el
          // `deleted_at` está en la cabecera y un `where` anidado dejaría fuera
          // los items que no están en ninguno, que son los que se buscan.
          finales: {
            select: {
              liquidacion_tercero_final: {
                select: { id: true, consecutivo: true, deleted_at: true },
              },
            },
          },
        },
        orderBy: [
          { liquidacion: { anio: "desc" as const } },
          { liquidacion: { mes: "desc" as const } },
          { placa: "asc" as const },
        ],
      }),
      prisma.liquidacion_tercero_ocasional_item.findMany({
        where: {
          deleted_at: null,
          liquidacion_ocasional: { deleted_at: null },
        },
        select: {
          liquidacion_tercero_id: true,
          liquidacion_ocasional: { select: { id: true, consecutivo: true } },
        },
      }),
      // Todas las placas con cierre final vivo, por periodo. Una sola consulta
      // en vez de una por item.
      prisma.liquidacion_tercero_final.findMany({
        where: { deleted_at: null },
        select: { placa: true, mes: true, anio: true },
      }),
    ]);

    const clavePlacaPeriodo = (placa: string, m: any, a: any) =>
      `${String(placa || "").toUpperCase().trim()}::${m}::${a}`;
    const placasCerradas = new Set(
      finales.map((f) => clavePlacaPeriodo(f.placa, f.mes, f.anio)),
    );
    const enOtroOcasional = new Map(
      enOcasionales
        .filter((i) => i.liquidacion_tercero_id)
        .map((i) => [
          i.liquidacion_tercero_id as string,
          i.liquidacion_ocasional?.consecutivo || i.liquidacion_ocasional?.id || "",
        ]),
    );

    let descartadosPorCierre = 0;
    let descartadosPorOcasional = 0;

    const disponibles = candidatos
      .filter((lt: any) => {
        const placa = String(lt.placa || "").toUpperCase().trim();
        if (!placa) return false;

        const enFinal = (lt.finales || []).find(
          (f: any) => f.liquidacion_tercero_final && !f.liquidacion_tercero_final.deleted_at,
        );
        if (enFinal) {
          descartadosPorCierre++;
          return false;
        }
        // La placa entera cerrada ese mes, aunque este item concreto no esté
        // en el pivote: el cierre pudo quitarlo a mano y volver a traerlo aquí
        // sería colarlo por la puerta de atrás.
        const m = lt.mes ?? lt.liquidacion?.mes;
        const a = lt.anio ?? lt.liquidacion?.anio;
        if (placasCerradas.has(clavePlacaPeriodo(placa, m, a))) {
          descartadosPorCierre++;
          return false;
        }
        if (enOtroOcasional.has(lt.id)) {
          descartadosPorOcasional++;
          return false;
        }
        return true;
      })
      .map((lt: any) => {
        const liq = lt.liquidacion;
        return {
          id: lt.id,
          placa: String(lt.placa || "").toUpperCase().trim(),
          recorrido: lt.recorrido || "",
          fechas: lt.fechas || "",
          mes: lt.mes ?? liq?.mes ?? null,
          anio: lt.anio ?? liq?.anio ?? null,
          tercero_id: lt.tercero_id ?? null,
          tercero_nombre: lt.tercero?.nombre_completo ?? null,
          tercero_documento: lt.tercero?.identificacion ?? null,
          cliente_nombre: liq?.cliente?.nombre ?? "",
          liquidacion_consecutivo: liq?.consecutivo ?? "",
          numero_planilla: lt.item?.numero_planilla ?? "",
          numero_factura: liq?.factura_items?.[0]?.factura?.numero_factura ?? "",
          valor_unitario: toNumber(lt.valor_unitario),
          cantidad: toNumber(lt.cantidad),
          porcentaje_admin: toNumber(lt.porcentaje_admin),
          valor_admin: toNumber(lt.valor_admin),
          total_facturado: toNumber(lt.total_facturado),
          valor_liquidar: toNumber(lt.valor_liquidar),
        };
      });

    return {
      cabecera: {
        id: cabecera?.id ?? null,
        consecutivo: cabecera?.consecutivo ?? null,
        estado: cabecera?.estado ?? null,
        mes,
        anio,
        editable: !cabecera?.estado || !["APROBADA", "FACTURADA", "ANULADA"].includes(cabecera.estado),
      },
      disponibles,
      descartados_por_cierre: descartadosPorCierre,
      descartados_por_ocasional: descartadosPorOcasional,
      total: candidatos.length,
    };
  },

  // ── AÑADIR AL OCASIONAL LOS ITEMS ELEGIDOS ──
  //
  // Misma mecánica de inserción que `refrescar` —fila denormalizada al final
  // del pivote— pero con los ids que ELIGE el usuario. Las validaciones son
  // propias: aquí los ids vienen de fuera.
  async agregarItems(params: {
    mes: number;
    anio: number;
    liquidacion_tercero_ids: string[];
    user_id?: string;
  }) {
    const mes = Number(params.mes);
    const anio = Number(params.anio);
    const ids = [...new Set((params.liquidacion_tercero_ids || []).filter(Boolean))];
    if (ids.length === 0) throw new Error("No se recibió ningún item para agregar");

    const cabecera = await prisma.liquidacion_tercero_ocasional.findFirst({
      where: { mes, anio, deleted_at: null },
      include: {
        items: {
          where: { deleted_at: null },
          select: { liquidacion_tercero_id: true, orden: true },
        },
      },
    });
    if (!cabecera) {
      throw new Error(
        `No hay borrador para ${MESES[mes - 1]} ${anio}. Genéralo antes de traer items.`,
      );
    }
    if (["APROBADA", "FACTURADA", "ANULADA"].includes(cabecera.estado || "")) {
      throw new Error(`La liquidación está ${cabecera.estado}: no admite items nuevos.`);
    }

    const yaPresentes = new Set(
      cabecera.items.map((i) => i.liquidacion_tercero_id).filter(Boolean),
    );
    const repetidos = ids.filter((id) => yaPresentes.has(id));
    if (repetidos.length > 0) {
      throw new Error(`${repetidos.length} item(s) ya están en esta liquidación`);
    }

    const candidatos = await prisma.liquidacion_tercero.findMany({
      where: { id: { in: ids } },
      include: {
        tercero: { select: { id: true, nombre_completo: true, identificacion: true } },
        item: { select: { numero_planilla: true } },
        liquidacion: {
          select: {
            id: true,
            consecutivo: true,
            cliente: { select: { nombre: true } },
            factura_items: {
              where: { factura: { deleted_at: null, estado: "ACTIVA" } },
              select: { factura: { select: { numero_factura: true } } },
              take: 1,
            },
          },
        },
        finales: {
          select: {
            liquidacion_tercero_final: {
              select: { consecutivo: true, deleted_at: true },
            },
          },
        },
      },
    });
    if (candidatos.length !== ids.length) {
      throw new Error(`${ids.length - candidatos.length} item(s) ya no existen en la base`);
    }
    for (const lt of candidatos as any[]) {
      const enFinal = (lt.finales || []).find(
        (f: any) => f.liquidacion_tercero_final && !f.liquidacion_tercero_final.deleted_at,
      );
      if (enFinal) {
        throw new Error(
          `El item "${lt.recorrido || lt.id}" ya está en el cierre ${enFinal.liquidacion_tercero_final.consecutivo || ""}. Quítalo de allí antes de traerlo aquí.`,
        );
      }
    }

    let orden = cabecera.items.reduce((m, i) => Math.max(m, i.orden ?? 0), -1) + 1;
    const filas = (candidatos as any[]).map((lt) => {
      const liq = lt.liquidacion;
      return {
        id: randomUUID(),
        liquidacion_ocasional_id: cabecera.id,
        liquidacion_tercero_id: lt.id,
        liquidacion_servicio_id: lt.liquidacion_id,
        cliente_nombre: liq?.cliente?.nombre || "",
        consecutivo: liq?.consecutivo || "",
        placa: String(lt.placa || "").toUpperCase().trim(),
        tercero_id: lt.tercero_id || null,
        tercero_nombre: lt.tercero?.nombre_completo || "",
        tercero_documento: lt.tercero?.identificacion || null,
        recorrido: lt.recorrido || "",
        fechas: lt.fechas || "",
        valor_unitario: toNumber(lt.valor_unitario),
        cantidad: toNumber(lt.cantidad) || 1,
        porcentaje_admin: toNumber(lt.porcentaje_admin),
        valor_admin: toNumber(lt.valor_admin),
        total_facturado: toNumber(lt.total_facturado),
        valor_liquidar: toNumber(lt.valor_liquidar),
        numero_planilla: lt.item?.numero_planilla || null,
        ingreso_extra_global: toNumber(lt.ingreso_extra_global),
        ingresos_extra_aval: toNumber(lt.ingresos_extra_aval),
        ingreso_empresa: toNumber(lt.ingreso_empresa),
        numero_factura: liq?.factura_items?.[0]?.factura?.numero_factura || "",
        aplica_impuestos: true,
        excluido: false,
        orden: orden++,
      };
    });

    await prisma.liquidacion_tercero_ocasional_item.createMany({ data: filas });
    await prisma.liquidacion_tercero_ocasional.update({
      where: { id: cabecera.id },
      data: { actualizado_por_id: params.user_id || cabecera.actualizado_por_id },
    });

    const placas = [...new Set(filas.map((f) => f.placa))];
    return {
      ok: true,
      id: cabecera.id,
      agregados: filas.length,
      placas,
      message: `Se añadieron ${filas.length} item(s) de ${placas.length} placa(s)`,
    };
  },

  async generarBorrador(input: GenerarBorradorOcasionalInput) {
    const { mes, anio, user_id, terceros_filtro = [] } = input;

    // El filtro viene como array mixto de UUIDs (tercero_id) y strings
    // (placas). Lo parseamos para NO pasar placas al campo UUID
    // `tercero_id` (Postgres rechazaría el cast).
    const UUID_RX =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const filtroTercerosIds = terceros_filtro.filter((t) => UUID_RX.test(t));
    const filtroPlacas = terceros_filtro.filter((t) => !UUID_RX.test(t));

    // 1) Items CANDIDATOS: los del periodo cuya placa NO tiene todavía un
    //    cierre final. El ocasional es justo lo que no entró en un cierre, así
    //    que arrastrar una placa ya cerrada la liquidaría dos veces.
    //
    //    Antes esto no se filtraba: el comentario decía «que NO estén ya
    //    vinculados» pero el `where` solo miraba mes/año. En MAYO 2026 eso
    //    metía 28 placas que ya tenían su cierre.
    const itemsPendientes = await itemsCandidatosOcasional({
      mes,
      anio,
      filtroPlacas,
      filtroTercerosIds,
    });

    if (itemsPendientes.length === 0) {
      return {
        ok: false,
        accion: "no_data",
        message: `No hay items pendientes de cierre para ${MESES[mes - 1]} ${anio} con el filtro aplicado.`,
      };
    }

    // 2) Construir itemsFlat a partir de los items sueltos. Cada item
    //    referencia directamente al `liquidacion_tercero` (sin pasar
    //    por cierres_final).
    const itemsFlat: any[] = [];
    let orden = 0;
    for (const lt of itemsPendientes) {
      const liq = lt.liquidacion;
      itemsFlat.push({
        id: randomUUID(),
        liquidacion_tercero_id: lt.id,
        liquidacion_servicio_id: lt.liquidacion_id,
        cliente_nombre: liq?.cliente?.nombre || "",
        consecutivo: liq?.consecutivo || "",
        placa: (lt.placa || "").toUpperCase().trim(),
        tercero_id: lt.tercero_id || null,
        tercero_nombre: lt.tercero?.nombre_completo || "",
        tercero_documento: lt.tercero?.identificacion || null,
        recorrido: lt.recorrido || "",
        fechas: lt.fechas || "",
        valor_unitario: toNumber(lt.valor_unitario),
        cantidad: toNumber(lt.cantidad) || 1,
        porcentaje_admin: toNumber(lt.porcentaje_admin),
        valor_admin: toNumber(lt.valor_admin),
        total_facturado: toNumber(lt.total_facturado),
        valor_liquidar: toNumber(lt.valor_liquidar),
        numero_planilla: lt.item?.numero_planilla || null,
        ingreso_extra_global: toNumber(lt.ingreso_extra_global),
        ingresos_extra_aval: toNumber(lt.ingresos_extra_aval),
        ingreso_empresa: toNumber(lt.ingreso_empresa),
        numero_factura:
          (liq as any)?.factura_items?.[0]?.factura?.numero_factura || "",
        aplica_impuestos: true,
        excluido: false,
        orden: orden++,
      });
    }

    // 3) Construir adicionalesEmpty: el ocasional empieza con
    //    `adicionales = []` y `conceptos = []`. El usuario los agrega
    //    luego en el canvas ocasional.
    const adicionalesFlat: any[] = [];

    // 4) Verificar si ya existe cabecera para este mes/año
    const existing = await prisma.liquidacion_tercero_ocasional.findFirst({
      where: { mes, anio, deleted_at: null },
    });

    // 5) Si NO existe cabecera → crearla con todos los items.
    if (!existing) {
      const totales = recalcularTotales(adicionalesFlat, [], itemsFlat);
      const consecutivo = await generarConsecutivo(mes, anio);
      const cabecera = await prisma.liquidacion_tercero_ocasional.create({
        data: {
          id: randomUUID(),
          consecutivo,
          mes,
          anio,
          estado: "BORRADOR",
          creado_por_id: user_id || null,
          actualizado_por_id: user_id || null,
          items: {
            create: itemsFlat.map((it) => ({
              id: it.id,
              liquidacion_tercero_id: it.liquidacion_tercero_id,
              liquidacion_servicio_id: it.liquidacion_servicio_id,
              cliente_nombre: it.cliente_nombre,
              consecutivo: it.consecutivo,
              placa: it.placa,
              tercero_id: it.tercero_id,
              tercero_nombre: it.tercero_nombre,
              tercero_documento: it.tercero_documento,
              recorrido: it.recorrido,
              fechas: it.fechas,
              valor_unitario: it.valor_unitario,
              cantidad: it.cantidad,
              porcentaje_admin: it.porcentaje_admin,
              valor_admin: it.valor_admin,
              total_facturado: it.total_facturado,
              valor_liquidar: it.valor_liquidar,
              numero_planilla: it.numero_planilla,
              ingreso_extra_global: it.ingreso_extra_global,
              ingresos_extra_aval: it.ingresos_extra_aval,
              ingreso_empresa: it.ingreso_empresa,
              numero_factura: it.numero_factura,
              aplica_impuestos: it.aplica_impuestos,
              excluido: it.excluido,
              orden: it.orden,
            })),
          },
          adicionales: {
            create: adicionalesFlat,
          },
          ...totales,
        },
        include: {
          items: true,
          adicionales: true,
        },
      });

      return {
        ok: true,
        accion: "created",
        id: cabecera.id,
        consecutivo: cabecera.consecutivo,
        message: `Borrador ocasional creado con ${itemsFlat.length} items de ${MESES[mes - 1]} ${anio}.`,
        items_extraidos: itemsFlat.length,
        adicionales_extraidos: adicionalesFlat.length,
      };
    }

    // 6) Si existe cabecera + SIN filtro → devolver existente (UX "abrir existente")
    if (terceros_filtro.length === 0) {
      return {
        ok: true,
        accion: "existente",
        id: existing.id,
        message: `Ya existe un borrador para ${MESES[mes - 1]} ${anio}. Abriendo existente.`,
      };
    }

    // 7) Si existe cabecera + CON filtro → agregar items nuevos (sin duplicar).
    //
    // SIN el filtro `deleted_at: null` a propósito. Dos motivos, y ambos
    // importan: (1) `@@unique([liquidacion_ocasional_id, liquidacion_tercero_id])`
    // no distingue borrados, así que reinsertar uno eliminado revienta con
    // P2002 y se lleva por delante el refresco entero; (2) si alguien borró
    // ese item en el canvas fue una decisión, y «Refrescar» no debe
    // resucitarlo a la primera pulsación.
    const itemsExistentesEnCabecera =
      await prisma.liquidacion_tercero_ocasional_item.findMany({
        where: { liquidacion_ocasional_id: existing.id },
        select: { liquidacion_tercero_id: true },
      });
    const idsExistentes = new Set(
      itemsExistentesEnCabecera
        .map((i) => i.liquidacion_tercero_id)
        .filter((id): id is string => Boolean(id)),
    );
    const itemsNuevos = itemsFlat.filter(
      (it) =>
        it.liquidacion_tercero_id &&
        !idsExistentes.has(it.liquidacion_tercero_id),
    );

    if (itemsNuevos.length === 0) {
      return {
        ok: true,
        accion: "existente",
        id: existing.id,
        message: `El borrador de ${MESES[mes - 1]} ${anio} ya contiene todos los items seleccionados.`,
      };
    }

    await prisma.$transaction(async (tx) => {
      await tx.liquidacion_tercero_ocasional_item.createMany({
        data: itemsNuevos.map((it) => ({
          id: it.id,
          liquidacion_ocasional_id: existing.id,
          liquidacion_tercero_id: it.liquidacion_tercero_id,
          liquidacion_servicio_id: it.liquidacion_servicio_id,
          cliente_nombre: it.cliente_nombre,
          consecutivo: it.consecutivo,
          placa: it.placa,
          tercero_id: it.tercero_id,
          tercero_nombre: it.tercero_nombre,
          tercero_documento: it.tercero_documento,
          recorrido: it.recorrido,
          fechas: it.fechas,
          valor_unitario: it.valor_unitario,
          cantidad: it.cantidad,
          porcentaje_admin: it.porcentaje_admin,
          valor_admin: it.valor_admin,
          total_facturado: it.total_facturado,
          valor_liquidar: it.valor_liquidar,
          numero_planilla: it.numero_planilla,
          ingreso_extra_global: it.ingreso_extra_global,
          ingresos_extra_aval: it.ingresos_extra_aval,
          ingreso_empresa: it.ingreso_empresa,
          numero_factura: it.numero_factura,
          aplica_impuestos: it.aplica_impuestos,
          excluido: it.excluido,
          orden: it.orden,
        })),
      });
      // Recalcular totales con todos los items actuales (existentes + nuevos)
      const allItems = await tx.liquidacion_tercero_ocasional_item.findMany({
        where: { liquidacion_ocasional_id: existing.id, deleted_at: null },
      });
      const allAdicionales =
        await tx.liquidacion_tercero_ocasional_adicional.findMany({
          where: { liquidacion_ocasional_id: existing.id, deleted_at: null },
        });
      const totales = recalcularTotales(allAdicionales, [], allItems);
      await tx.liquidacion_tercero_ocasional.update({
        where: { id: existing.id },
        data: {
          actualizado_por_id: user_id || existing.actualizado_por_id,
          updated_at: new Date(),
          ...totales,
        },
      });
    });

    return {
      ok: true,
      accion: "updated",
      id: existing.id,
      message: `Se agregaron ${itemsNuevos.length} items al borrador existente de ${MESES[mes - 1]} ${anio}.`,
      items_extraidos: itemsNuevos.length,
    };
  },

  async guardarBorrador(params: GuardarBorradorOcasionalParams) {
    const {
      id,
      mes,
      anio,
      observaciones,
      adicionales,
      conceptos,
      items,
      user_id,
      force_new,
    } = params;

    // 1) Buscar o crear cabecera
    let cabecera = id
      ? await prisma.liquidacion_tercero_ocasional.findFirst({
          where: { id, deleted_at: null },
        })
      : await prisma.liquidacion_tercero_ocasional.findFirst({
          where: { mes, anio, deleted_at: null },
        });

    if (!cabecera) {
      const consecutivo = await generarConsecutivo(mes, anio);
      cabecera = await prisma.liquidacion_tercero_ocasional.create({
        data: {
          id: randomUUID(),
          consecutivo,
          mes,
          anio,
          estado: "BORRADOR",
          creado_por_id: user_id || null,
          actualizado_por_id: user_id || null,
        },
      });
    }

    if (["APROBADA", "FACTURADA"].includes(cabecera.estado) && !force_new) {
      throw new Error(
        `La liquidación ocasional está en estado ${cabecera.estado}. Usa force_new=true para crear una nueva versión.`,
      );
    }
    if (["APROBADA", "FACTURADA"].includes(cabecera.estado) && force_new) {
      // La tabla tiene `@@unique([mes, anio], name: "uniq_ocasional_periodo")`.
      // Antes se marcaba la vieja como REEMPLAZADA pero NO se soft-deleteaba,
      // así que el `create` siguiente chocaba con el unique y reventaba con
      // P2002 — `force_new` nunca llegó a funcionar. Hay que liberar el
      // periodo (deleted_at) ANTES de crear la nueva, y en la MISMA
      // transacción para que no quede una ventana sin cabecera.
      const anterior = cabecera;
      cabecera = await prisma.$transaction(async (tx) => {
        await tx.liquidacion_tercero_ocasional.update({
          where: { id: anterior.id },
          data: { estado: "REEMPLAZADA", deleted_at: new Date() },
        });
        const consecutivo = await generarConsecutivo(mes, anio);
        return tx.liquidacion_tercero_ocasional.create({
          data: {
            id: randomUUID(),
            consecutivo,
            mes,
            anio,
            estado: "BORRADOR",
            creado_por_id: user_id || null,
            actualizado_por_id: user_id || null,
          },
        });
      });
    }

    // 2) Sanitizar y asignar ids estables a cada fila
    const adicionalesSanitizados = dedupeById(
      (Array.isArray(adicionales) ? adicionales : [])
        .filter(
          (a) =>
            a && (toNumber(a.valor_unitario) > 0 || toNumber(a.cantidad) > 0),
        )
        .map((a) => {
          const calc = calcAdicional(a);
          return {
            id: a.id || randomUUID(),
            cliente: a.cliente || "TRANSMERALDA",
            placa: (a.placa || "").toUpperCase().trim(),
            tercero_id: a.tercero_id || null,
            tercero_nombre: a.tercero_nombre || null,
            vehiculo_id: a.vehiculo_id || null,
            recorrido: a.recorrido || null,
            fechas: a.fechas || null,
            ...calc,
            aplica_impuestos: a.aplica_impuestos !== false,
            orden: a.orden ?? 0,
          };
        }),
      randomUUID,
    );

    const conceptosSanitizados = dedupeById(
      (Array.isArray(conceptos) ? conceptos : [])
        .filter((c) => c && c.tipo && c.concepto)
        .map((c) => {
          let valorTotal = toNumber(c.valor_total);
          if (valorTotal === 0 && c.dias && c.valor_unitario) {
            valorTotal = toNumber(c.dias) * toNumber(c.valor_unitario);
          } else if (valorTotal === 0 && c.porcentaje && c.base_calculo) {
            valorTotal =
              toNumber(c.base_calculo) * (toNumber(c.porcentaje) / 100);
          }
          return {
            id: c.id || randomUUID(),
            tipo: c.tipo,
            concepto: c.concepto,
            conductor_id: c.conductor_id || null,
            placa_aplicada: c.placa_aplicada || null,
            dias: c.dias != null ? toNumber(c.dias) : null,
            valor_unitario: toNumber(c.valor_unitario),
            porcentaje: c.porcentaje != null ? toNumber(c.porcentaje) : null,
            valor_total: valorTotal,
            base_calculo:
              c.base_calculo != null ? toNumber(c.base_calculo) : null,
            calculado: c.calculado || false,
            observaciones: c.observaciones || null,
            orden: c.orden ?? 0,
            actualizado_por_id: user_id || null,
          };
        }),
      randomUUID,
    );

    // `liquidacion_tercero_id` es NOT NULL y forma parte del unique
    // `uniq_ocasional_item_pivote`, así que un item sin pivote no puede
    // existir. Antes se mandaba `null` y Prisma reventaba el upsert entero,
    // tirando abajo el guardado completo del canvas. Ahora se descartan con
    // aviso: perder una fila huérfana es mejor que perder toda la hoja.
    const itemsEntrantes = Array.isArray(items) ? items : [];
    const itemsConPivote = itemsEntrantes.filter(
      (i) => i && i.placa && i.liquidacion_tercero_id,
    );
    const descartados = itemsEntrantes.filter(
      (i) => i && i.placa && !i.liquidacion_tercero_id,
    );
    if (descartados.length > 0) {
      console.warn(
        `[ocasional] ${descartados.length} item(s) descartados por venir sin liquidacion_tercero_id`,
        descartados.map((i) => ({ id: i.id, placa: i.placa, consecutivo: i.consecutivo })),
      );
    }

    const itemsSanitizados = dedupeById(
      itemsConPivote
        .map((i) => ({
          id: i.id || randomUUID(),
          liquidacion_tercero_id: i.liquidacion_tercero_id,
          liquidacion_servicio_id: i.liquidacion_servicio_id || null,
          cliente_nombre: i.cliente_nombre || "",
          consecutivo: i.consecutivo || "",
          placa: (i.placa || "").toUpperCase().trim(),
          tercero_id: i.tercero_id || null,
          tercero_nombre: i.tercero_nombre || "",
          tercero_documento: i.tercero_documento || null,
          recorrido: i.recorrido || "",
          fechas: i.fechas || "",
          valor_unitario: toNumber(i.valor_unitario),
          cantidad: toNumber(i.cantidad) || 1,
          porcentaje_admin: toNumber(i.porcentaje_admin),
          valor_admin: toNumber(i.valor_admin),
          total_facturado: toNumber(i.total_facturado),
          valor_liquidar: toNumber(i.valor_liquidar),
          numero_planilla: i.numero_planilla || null,
          ingreso_extra_global: toNumber(i.ingreso_extra_global),
          ingresos_extra_aval: toNumber(i.ingresos_extra_aval),
          ingreso_empresa: toNumber(i.ingreso_empresa),
          numero_factura: i.numero_factura || null,
          aplica_impuestos: i.aplica_impuestos !== false,
          excluido: i.excluido === true,
          orden: i.orden ?? 0,
        })),
      randomUUID,
    );

    // 3) Calcular totales con TODO (incluyendo excluidos=false)
    const totales = recalcularTotales(
      adicionalesSanitizados,
      conceptosSanitizados,
      itemsSanitizados,
    );

    // 4) Upsert idempotente de cada tabla hija, EN UN SOLO VIAJE
    //
    // Antes esto era un `$transaction` interactivo con un upsert POR FILA en
    // secuencia. Contra una base remota cada ida y vuelta ronda los 300 ms, así
    // que una liquidación de 26 items tardaba ~13 s y, con el timeout de 5 s
    // por defecto de Prisma, la transacción se cerraba a mitad del bucle: el
    // guardado moría con `Transaction not found ... refers to an old closed
    // transaction` y ROLLBACK.
    //
    // Ahora las LECTURAS van antes (no necesitan la transacción: solo sirven
    // para saber qué filas sobran) y las ESCRITURAS se mandan como un array a
    // `$transaction([...])`, que Prisma envía en UN solo lote atómico. El coste
    // deja de crecer con el número de filas.
    const [itemsActuales, adcsActuales, concActuales] = await Promise.all([
      prisma.liquidacion_tercero_ocasional_item.findMany({
        where: { liquidacion_ocasional_id: cabecera.id, deleted_at: null },
        select: { id: true },
      }),
      prisma.liquidacion_tercero_ocasional_adicional.findMany({
        where: { liquidacion_ocasional_id: cabecera.id, deleted_at: null },
        select: { id: true },
      }),
      prisma.liquidacion_tercero_ocasional_concepto.findMany({
        where: { liquidacion_ocasional_id: cabecera.id, deleted_at: null },
        select: { id: true },
      }),
    ]);

    /// Ids presentes en la base que ya no vienen en el payload: el usuario
    /// borró esas filas en el canvas, así que se marcan como eliminadas.
    const sobrantes = (actuales: Array<{ id: string }>, nuevos: Array<{ id: string }>) => {
      const vivos = new Set(nuevos.map((n) => n.id));
      return actuales.map((a) => a.id).filter((id) => !vivos.has(id));
    };

    const itemsAEliminar = sobrantes(itemsActuales, itemsSanitizados);
    const adcsAEliminar = sobrantes(adcsActuales, adicionalesSanitizados);
    const concAEliminar = sobrantes(concActuales, conceptosSanitizados);
    const ahora = new Date();

    const operaciones: any[] = [];

    if (itemsAEliminar.length > 0) {
      operaciones.push(
        prisma.liquidacion_tercero_ocasional_item.updateMany({
          where: { id: { in: itemsAEliminar } },
          data: { deleted_at: ahora },
        }),
      );
    }
    for (const it of itemsSanitizados) {
      operaciones.push(
        prisma.liquidacion_tercero_ocasional_item.upsert({
          where: { id: it.id },
          create: { ...it, liquidacion_ocasional_id: cabecera.id },
          // `liquidacion_ocasional_id` y `deleted_at` TAMBIÉN en el update: el
          // id puede venir de una fila sintética del cliente, y sin reasignar
          // el dueño el upsert de un mes se llevaba la fila de otro —el mes
          // perdedor se quedaba sin nada y volvía a los valores por defecto al
          // recargar. Reactivar la fila borrada es lo coherente: si el payload
          // la vuelve a traer, es que existe.
          update: { ...it, liquidacion_ocasional_id: cabecera.id, deleted_at: null },
        }),
      );
    }

    if (adcsAEliminar.length > 0) {
      operaciones.push(
        prisma.liquidacion_tercero_ocasional_adicional.updateMany({
          where: { id: { in: adcsAEliminar } },
          data: { deleted_at: ahora },
        }),
      );
    }
    for (const a of adicionalesSanitizados) {
      operaciones.push(
        prisma.liquidacion_tercero_ocasional_adicional.upsert({
          where: { id: a.id },
          create: { ...a, liquidacion_ocasional_id: cabecera.id },
          // `liquidacion_ocasional_id` y `deleted_at` TAMBIÉN en el update: el
          // id puede venir de una fila sintética del cliente, y sin reasignar
          // el dueño el upsert de un mes se llevaba la fila de otro —el mes
          // perdedor se quedaba sin nada y volvía a los valores por defecto al
          // recargar. Reactivar la fila borrada es lo coherente: si el payload
          // la vuelve a traer, es que existe.
          update: { ...a, liquidacion_ocasional_id: cabecera.id, deleted_at: null },
        }),
      );
    }

    if (concAEliminar.length > 0) {
      operaciones.push(
        prisma.liquidacion_tercero_ocasional_concepto.updateMany({
          where: { id: { in: concAEliminar } },
          data: { deleted_at: ahora },
        }),
      );
    }
    for (const c of conceptosSanitizados) {
      operaciones.push(
        prisma.liquidacion_tercero_ocasional_concepto.upsert({
          where: { id: c.id },
          create: { ...c, liquidacion_ocasional_id: cabecera.id },
          // `liquidacion_ocasional_id` y `deleted_at` TAMBIÉN en el update: el
          // id puede venir de una fila sintética del cliente, y sin reasignar
          // el dueño el upsert de un mes se llevaba la fila de otro —el mes
          // perdedor se quedaba sin nada y volvía a los valores por defecto al
          // recargar. Reactivar la fila borrada es lo coherente: si el payload
          // la vuelve a traer, es que existe.
          update: { ...c, liquidacion_ocasional_id: cabecera.id, deleted_at: null },
        }),
      );
    }

    // CABECERA (totales + auditoría). Va la última del lote a propósito: si
    // algo falla, los totales no quedan reflejando un guardado que no ocurrió.
    operaciones.push(
      prisma.liquidacion_tercero_ocasional.update({
        where: { id: cabecera.id },
        data: {
          observaciones: observaciones ?? cabecera.observaciones,
          actualizado_por_id: user_id || cabecera.actualizado_por_id,
          updated_at: ahora,
          ...totales,
        },
      }),
    );

    await prisma.$transaction(operaciones);

    emitRowUpdated({
      id: cabecera.id,
      changes: {
        items_count: itemsSanitizados.length,
        adicionales_count: adicionalesSanitizados.length,
        conceptos_count: conceptosSanitizados.length,
        ...totales,
      },
      userId: user_id,
    });

    // Limpiar drafts del usuario tras guardado oficial exitoso
    if (user_id) {
      await prisma.liquidacion_tercero_ocasional_draft.deleteMany({
        where: { liquidacion_ocasional_id: cabecera.id, usuario_id: user_id },
      });
    }

    return {
      ok: true,
      id: cabecera.id,
      accion:
        cabecera.created_at.getTime() === cabecera.updated_at.getTime()
          ? "created"
          : "updated",
      message: "Guardado correctamente.",
    };
  },

  // ─────────── AUTOSAVE DRAFT ───────────

  async guardarDraft(params: AutosaveDraftParams) {
    const { liquidacion_ocasional_id, user_id, payload } = params;

    const existing =
      await prisma.liquidacion_tercero_ocasional_draft.findUnique({
        where: {
          uniq_ocasional_draft_user: {
            liquidacion_ocasional_id,
            usuario_id: user_id,
          },
        },
      });

    if (existing) {
      const updated = await prisma.liquidacion_tercero_ocasional_draft.update({
        where: { id: existing.id },
        data: {
          payload,
          version: existing.version + 1,
          updated_at: new Date(),
        },
      });
      return { ok: true, id: updated.id, version: updated.version };
    }

    const created = await prisma.liquidacion_tercero_ocasional_draft.create({
      data: {
        liquidacion_ocasional_id,
        usuario_id: user_id,
        payload,
        version: 1,
      },
    });
    return { ok: true, id: created.id, version: created.version };
  },

  async obtenerDraft(input: {
    liquidacion_ocasional_id: string;
    user_id: string;
  }) {
    const draft = await prisma.liquidacion_tercero_ocasional_draft.findUnique({
      where: {
        uniq_ocasional_draft_user: {
          liquidacion_ocasional_id: input.liquidacion_ocasional_id,
          usuario_id: input.user_id,
        },
      },
    });
    if (!draft) return null;
    return {
      id: draft.id,
      payload: draft.payload,
      version: draft.version,
      updated_at: draft.updated_at,
    };
  },

  async eliminarDraft(input: {
    liquidacion_ocasional_id: string;
    user_id: string;
  }) {
    await prisma.liquidacion_tercero_ocasional_draft.deleteMany({
      where: {
        liquidacion_ocasional_id: input.liquidacion_ocasional_id,
        usuario_id: input.user_id,
      },
    });
    return { ok: true };
  },

  // ─────────── RECALCULAR ───────────

  async recalcularTotales(id: string) {
    const cabecera = await prisma.liquidacion_tercero_ocasional.findFirst({
      where: { id, deleted_at: null },
      include: {
        items: { where: { deleted_at: null } },
        adicionales: { where: { deleted_at: null } },
        conceptos: { where: { deleted_at: null } },
      },
    });
    if (!cabecera) throw new Error("Liquidación ocasional no encontrada");

    const totales = recalcularTotales(
      cabecera.adicionales as any,
      cabecera.conceptos as any,
      cabecera.items as any,
    );

    const updated = await prisma.liquidacion_tercero_ocasional.update({
      where: { id },
      data: { ...totales, updated_at: new Date() },
    });

    emitRowUpdated({ id, changes: totales });
    return updated;
  },

  // ─────────── ESTADO ───────────

  async cambiarEstado(
    id: string,
    estado: string,
    userId: string,
    motivo?: string,
  ) {
    const cabecera = await prisma.liquidacion_tercero_ocasional.findUnique({
      where: { id },
    });
    if (!cabecera) throw new Error("Liquidación ocasional no encontrada");

    const updated = await prisma.liquidacion_tercero_ocasional.update({
      where: { id },
      data: {
        estado,
        motivo_anulacion:
          estado === "ANULADA" ? motivo || null : cabecera.motivo_anulacion,
        actualizado_por_id: userId,
        updated_at: new Date(),
      },
    });
    emitRowUpdated({ id, changes: { estado }, userId });
    return updated;
  },

  // ─────────── CERRAR Y DISTRIBUIR ───────────

  /**
   * Cambia la cabecera a estado LIQUIDADA. Valida que TODAS las placas
   * de los items/adicionales tengan un cierre final existente en el mes.
   *
   * Si falta alguna placa, devuelve 409 con la lista detallada para
   * que el usuario las cree manualmente (no auto-creamos cierres).
   */
  async cerrarYDistribuir(params: CerrarYDistribuirParams) {
    const { id, user_id } = params;

    const cabecera = await prisma.liquidacion_tercero_ocasional.findFirst({
      where: { id, deleted_at: null },
      include: {
        items: { where: { deleted_at: null } },
        adicionales: { where: { deleted_at: null } },
        conceptos: { where: { deleted_at: null } },
      },
    });
    if (!cabecera) throw new Error("Liquidación ocasional no encontrada");
    if (!["BORRADOR", "LIQUIDADA"].includes(cabecera.estado)) {
      throw new Error(
        `No se puede cerrar una liquidación en estado ${cabecera.estado}.`,
      );
    }

    // 1) Recopilar TODAS las placas distintas (items + adicionales)
    const placasSet = new Set<string>();
    for (const it of cabecera.items) {
      if (!it.excluido && it.placa)
        placasSet.add(it.placa.toUpperCase().trim());
    }
    for (const a of cabecera.adicionales) {
      if (a.placa) placasSet.add(a.placa.toUpperCase().trim());
    }
    for (const c of cabecera.conceptos) {
      if (c.placa_aplicada)
        placasSet.add(c.placa_aplicada.toUpperCase().trim());
    }
    const placas = Array.from(placasSet);

    if (placas.length === 0) {
      throw new Error("No hay placas en la cabecera para cerrar y distribuir.");
    }

    // 2) Validar que cada placa tenga un cierre final existente
    const cierresExistentes = await prisma.liquidacion_tercero_final.findMany({
      where: {
        mes: cabecera.mes,
        anio: cabecera.anio,
        placa: { in: placas },
        deleted_at: null,
      },
      select: { id: true, placa: true, consecutivo: true, estado: true },
    });
    const placasCubiertas = new Set(
      cierresExistentes.map((c) => c.placa.toUpperCase().trim()),
    );
    const placasFaltantes = placas.filter(
      (p) => !placasCubiertas.has(p.toUpperCase().trim()),
    );

    if (placasFaltantes.length > 0) {
      // 409 con la lista detallada (decisión del usuario)
      const error: any = new Error(
        `Faltan ${placasFaltantes.length} cierre(s) final(es) para estas placas. Crea los cierres primero desde "Liquidaciones de Terceros".`,
      );
      error.statusCode = 409;
      error.code = "PLACAS_FALTANTES";
      error.placas_faltantes = placasFaltantes.map((p) => ({
        placa: p,
        motivo:
          "No existe cierre final en liquidacion_tercero_final para esta placa en el mes/año",
      }));
      throw error;
    }

    // 3) Marcar cabecera como LIQUIDADA
    const updated = await prisma.liquidacion_tercero_ocasional.update({
      where: { id },
      data: {
        estado: "LIQUIDADA",
        actualizado_por_id: user_id,
        updated_at: new Date(),
      },
    });

    // 4) Emitir evento para que el historial refresque
    try {
      const io = getIo();
      io.emit("liquidacion-tercero-ocasional:cerrada", {
        id,
        mes: cabecera.mes,
        anio: cabecera.anio,
        cierres_asociados: cierresExistentes.length,
      });
    } catch (e) {
      /* sockets no inicializados */
    }

    emitRowUpdated({ id, changes: { estado: "LIQUIDADA" }, userId: user_id });

    return {
      ok: true,
      id,
      estado: "LIQUIDADA",
      cierres_asociados: cierresExistentes.length,
      message: `Cerrada y asociada a ${cierresExistentes.length} cierres finales.`,
    };
  },

  // ─────────── SOFT DELETE ───────────

  async softDelete(id: string, userId?: string) {
    const cabecera = await prisma.liquidacion_tercero_ocasional.findUnique({
      where: { id },
    });
    if (!cabecera) throw new Error("Liquidación ocasional no encontrada");
    if (cabecera.deleted_at)
      throw new Error("La liquidación ya está eliminada");
    if (["APROBADA", "FACTURADA"].includes(cabecera.estado)) {
      throw new Error(
        `No se puede eliminar una liquidación en estado ${cabecera.estado}`,
      );
    }
    const ts = new Date();
    await prisma.$transaction([
      prisma.liquidacion_tercero_ocasional.update({
        where: { id },
        data: {
          deleted_at: ts,
          actualizado_por_id: userId || cabecera.actualizado_por_id,
          updated_at: ts,
        },
      }),
    ]);
    try {
      const io = getIo();
      io.emit("liquidacion-tercero-ocasional:deleted", { id });
    } catch (e) {
      /* sockets no inicializados */
    }
    return { ok: true, id, deleted_at: ts };
  },

  // ─────────── SNAPSHOTS (read-only; capture/revert en módulo aparte) ───────────

  async listarSnapshots(id: string) {
    return prisma.liquidacion_tercero_ocasional_snapshot.findMany({
      where: { liquidacion_ocasional_id: id },
      include: {
        usuario: { select: { id: true, nombre: true, correo: true } },
      },
      orderBy: { version: "desc" },
    });
  },

  // ─────────── PREVIEW DATA ───────────

  async obtenerPreviewData(id: string) {
    const cabecera = await this.obtenerPorId(id);
    if (!cabecera) return null;

    const porPlacaMap = new Map<
      string,
      {
        placa: string;
        adicionales_count: number;
        items_count: number;
        valor_liquidar: number;
        tercero_nombre?: string | null;
      }
    >();
    for (const it of cabecera.items) {
      const k = (it.placa || "—").toUpperCase();
      if (!porPlacaMap.has(k)) {
        porPlacaMap.set(k, {
          placa: k,
          adicionales_count: 0,
          items_count: 0,
          valor_liquidar: 0,
          tercero_nombre: it.tercero_nombre,
        });
      }
      const entry = porPlacaMap.get(k)!;
      entry.items_count++;
      if (!it.excluido) entry.valor_liquidar += toNumber(it.valor_liquidar);
    }
    for (const a of cabecera.adicionales) {
      const k = (a.placa || "—").toUpperCase();
      if (!porPlacaMap.has(k)) {
        porPlacaMap.set(k, {
          placa: k,
          adicionales_count: 0,
          items_count: 0,
          valor_liquidar: 0,
          tercero_nombre: a.tercero_nombre,
        });
      }
      const entry = porPlacaMap.get(k)!;
      entry.adicionales_count++;
      entry.valor_liquidar += toNumber(a.valor_liquidar);
    }
    const porPlaca = Array.from(porPlacaMap.values()).sort((a, b) =>
      a.placa.localeCompare(b.placa),
    );

    return {
      cabecera: {
        id: cabecera.id,
        consecutivo: cabecera.consecutivo,
        mes: cabecera.mes,
        anio: cabecera.anio,
        estado: cabecera.estado,
        observaciones: cabecera.observaciones,
        creado_por: cabecera.creado_por,
        actualizado_por: cabecera.actualizado_por,
        created_at: cabecera.created_at,
        updated_at: cabecera.updated_at,
      },
      items: cabecera.items.map(serializeItem),
      adicionales: cabecera.adicionales.map(serializeAdicional),
      conceptos: cabecera.conceptos.map(serializeConcepto),
      por_placa: porPlaca,
      totales: {
        total_facturado_items: toNumber(cabecera.total_facturado_items),
        total_admin_items: toNumber(cabecera.total_admin_items),
        total_liquidar_items: toNumber(cabecera.total_liquidar_items),
        total_adicionales: toNumber(cabecera.total_adicionales),
        total_gastos_operativos: toNumber(cabecera.total_gastos_operativos),
        total_impuestos: toNumber(cabecera.total_impuestos),
        total_anticipos: toNumber(cabecera.total_anticipos),
        total_descuentos: toNumber(cabecera.total_descuentos),
        total_pagar: toNumber(cabecera.total_pagar),
      },
    };
  },
};
