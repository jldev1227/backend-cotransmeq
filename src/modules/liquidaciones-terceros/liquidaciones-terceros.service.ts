// @ts-nocheck
import { prisma } from "../../config/prisma";
import { randomUUID } from "crypto";

// ═══════════════════════════════════════════════════════════════
// TIPOS
// ═══════════════════════════════════════════════════════════════

export interface ItemLiquidacionTerceroInput {
  tercero_id?: string | null;
  item_id?: string | null;
  placa: string;
  recorrido: string;
  fechas: string;
  valor_unitario: number;
  cantidad: number;
  porcentaje_admin: number;
  ingreso_extra_global?: number;
  ingresos_extra_aval?: number;
  ingreso_empresa?: number;
  src_index?: number;
}

export interface FiltrosLiquidacionTerceros {
  page?: number;
  limit?: number;
  cliente_id?: string;
  tercero_id?: string;
  placa?: string;
  mes?: number;
  anio?: number;
  busqueda?: string;
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function calcItem(item: ItemLiquidacionTerceroInput) {
  const totalFacturado = item.valor_unitario * item.cantidad;
  const valorAdmin = totalFacturado * (item.porcentaje_admin / 100);
  const valorLiquidar = totalFacturado - valorAdmin;
  const ingresoExtraGlobal = item.ingreso_extra_global || 0;
  const ingresosExtraAval = item.ingresos_extra_aval || 0;
  const ingresoEmpresa = item.ingreso_empresa ?? (ingresoExtraGlobal - ingresosExtraAval);
  return { totalFacturado, valorAdmin, valorLiquidar, ingresoExtraGlobal, ingresosExtraAval, ingresoEmpresa };
}

function toNumber(v: any): number {
  return typeof v === 'object' && v !== null ? Number(v) : Number(v) || 0;
}

function serializeItem(item: any) {
  return {
    ...item,
    valor_unitario: toNumber(item.valor_unitario),
    cantidad: toNumber(item.cantidad),
    total_facturado: toNumber(item.total_facturado),
    porcentaje_admin: toNumber(item.porcentaje_admin),
    valor_admin: toNumber(item.valor_admin),
    valor_liquidar: toNumber(item.valor_liquidar),
    ingreso_extra_global: toNumber(item.ingreso_extra_global),
    ingresos_extra_aval: toNumber(item.ingresos_extra_aval),
    ingreso_empresa: toNumber(item.ingreso_empresa),
  };
}

// ═══════════════════════════════════════════════════════════════
// SERVICIO
// ═══════════════════════════════════════════════════════════════

export const LiquidacionesTercerosService = {

  /**
   * Guardar (crear o reemplazar) los items de terceros de una liquidación.
   * Se eliminan los existentes y se crean los nuevos en una transacción.
   */
  async guardar(liquidacionId: string, items: ItemLiquidacionTerceroInput[]) {
    const itemsData = items.map((item, index) => {
      const c = calcItem(item);
      return {
        id: randomUUID(),
        liquidacion_id: liquidacionId,
        item_id: item.item_id || null,
        tercero_id: item.tercero_id || null,
        placa: item.placa,
        recorrido: item.recorrido || 'N/A',
        fechas: item.fechas || '',
        valor_unitario: item.valor_unitario,
        cantidad: item.cantidad,
        total_facturado: c.totalFacturado,
        porcentaje_admin: item.porcentaje_admin,
        valor_admin: c.valorAdmin,
        valor_liquidar: c.valorLiquidar,
        ingreso_extra_global: c.ingresoExtraGlobal,
        ingresos_extra_aval: c.ingresosExtraAval,
        ingreso_empresa: c.ingresoEmpresa,
        src_index: item.src_index ?? index,
        orden: index,
      };
    });

    /// Se MARCAN los anteriores, no se borran.
    ///
    /// Este `deleteMany` + `createMany` en cada guardado es el mismo patrón que
    /// destruyó los ítems de las liquidaciones de servicios, sobre una tabla
    /// que ya tenía `deleted_at`. No hay unicidad por `(liquidacion_id, …)`,
    /// así que las filas marcadas conviven con las nuevas sin chocar; lo que
    /// hace falta es que TODA lectura filtre, y eso es lo que se arregló aquí.
    await prisma.$transaction([
      prisma.liquidacion_tercero.updateMany({
        where: { liquidacion_id: liquidacionId, deleted_at: null },
        data: { deleted_at: new Date() },
      }),
      prisma.liquidacion_tercero.createMany({ data: itemsData }),
    ]);

    const created = await prisma.liquidacion_tercero.findMany({
      where: { liquidacion_id: liquidacionId, deleted_at: null },
      include: {
        tercero: { select: { id: true, nombre_completo: true, identificacion: true, tipo_persona: true } },
        item: { select: { id: true, numero_planilla: true } },
      },
      orderBy: { orden: 'asc' },
    });

    return created.map(serializeItem);
  },

  /**
   * Obtener items de terceros de una liquidación específica.
   */
  async obtenerPorLiquidacion(liquidacionId: string) {
    const items = await prisma.liquidacion_tercero.findMany({
      where: { liquidacion_id: liquidacionId, deleted_at: null },
      include: {
        tercero: { select: { id: true, nombre_completo: true, identificacion: true, tipo_persona: true } },
        item: { select: { id: true, numero_planilla: true } },
      },
      orderBy: { orden: 'asc' },
    });
    return items.map(serializeItem);
  },

  /**
   * Historial: listar todos los items de terceros con filtros, agrupados o planos.
   * Incluye datos de la liquidación padre (consecutivo, cliente, mes, año, estado, osi).
   */
  async listarHistorial(filtros: FiltrosLiquidacionTerceros) {
    const page = Number(filtros.page) || 1;
    const limit = Number(filtros.limit) || 50;
    const skip = (page - 1) * limit;

    /// `deleted_at: null` en el propio ítem, no solo en su liquidación: desde
    /// que el guardado marca en vez de borrar, las versiones anteriores siguen
    /// en la tabla y sin esto aparecerían duplicadas en el historial.
    const where: any = {
      deleted_at: null,
      liquidacion: { deleted_at: null },
    };

    if (filtros.cliente_id) {
      where.liquidacion = { ...where.liquidacion, cliente_id: filtros.cliente_id };
    }
    if (filtros.mes) {
      where.liquidacion = { ...where.liquidacion, mes: Number(filtros.mes) };
    }
    if (filtros.anio) {
      where.liquidacion = { ...where.liquidacion, anio: Number(filtros.anio) };
    }
    if (filtros.tercero_id) {
      where.tercero_id = filtros.tercero_id;
    }
    if (filtros.placa) {
      where.placa = { contains: filtros.placa, mode: 'insensitive' };
    }
    if (filtros.busqueda) {
      where.OR = [
        { placa: { contains: filtros.busqueda, mode: 'insensitive' } },
        { recorrido: { contains: filtros.busqueda, mode: 'insensitive' } },
        { tercero: { nombre_completo: { contains: filtros.busqueda, mode: 'insensitive' } } },
        { liquidacion: { consecutivo: { contains: filtros.busqueda, mode: 'insensitive' } } },
      ];
    }

    const [items, total, metadata] = await Promise.all([
      prisma.liquidacion_tercero.findMany({
        where,
        include: {
          tercero: { select: { id: true, nombre_completo: true, identificacion: true, tipo_persona: true } },
          item: { select: { id: true, numero_planilla: true } },
          liquidacion: {
            select: {
              id: true,
              consecutivo: true,
              mes: true,
              anio: true,
              estado: true,
              osi: true,
              tercero_liquidado: true,
              cliente: { select: { id: true, nombre: true, nit: true } },
              factura_items: {
                select: {
                  factura: {
                    select: { id: true, numero_factura: true, estado: true },
                  },
                },
                where: { factura: { deleted_at: null, estado: 'ACTIVA' } },
                take: 1,
              },
            },
          },
        },
        orderBy: [{ liquidacion: { anio: 'desc' } }, { liquidacion: { mes: 'desc' } }, { orden: 'asc' }],
        skip,
        take: limit,
      }),
      prisma.liquidacion_tercero.count({ where }),
      metadataHistorial(where),
    ]);

    return {
      items: items.map(serializeItem),
      total,
      totalPages: Math.ceil(total / limit),
      page,
      metadata,
    };
  },

  /**
   * Migrar terceroRows del JSON recargos_data a la nueva tabla.
   * Solo para liquidaciones que tienen terceroRows en recargos_data y no tienen registros en liquidacion_tercero.
   */
  async migrarDesdeJSON() {
    const liquidaciones = await prisma.liquidacion_servicio.findMany({
      where: {
        recargos_data: { not: null },
        deleted_at: null,
      },
      select: { id: true, recargos_data: true },
    });

    let migradas = 0;
    let itemsMigrados = 0;

    for (const liq of liquidaciones) {
      const rd = liq.recargos_data as any;
      if (!rd?.terceroRows || !Array.isArray(rd.terceroRows) || rd.terceroRows.length === 0) continue;

      // Check if already migrated
      const existing = await prisma.liquidacion_tercero.count({
        where: { liquidacion_id: liq.id, deleted_at: null },
      });
      if (existing > 0) continue;

      const itemsData = rd.terceroRows.map((t: any, idx: number) => {
        const vrUnit = parseFloat(String(t.vr_unit)) || 0;
        const cant = parseFloat(String(t.cant)) || 0;
        const totalFacturado = vrUnit * cant;
        const pctAdmin = parseFloat(String(t.pct_admin)) || 0;
        const valorAdmin = totalFacturado * (pctAdmin / 100);
        const valorLiquidar = totalFacturado - valorAdmin;
        const ingresoExtraGlobal = parseFloat(String(t.ingreso_extra_global)) || 0;
        const ingresosExtraAval = parseFloat(String(t.ingresos_extra_aval)) || 0;
        const ingresoEmpresa = ingresoExtraGlobal - ingresosExtraAval;

        return {
          id: randomUUID(),
          liquidacion_id: liq.id,
          tercero_id: t.tercero_id || null,
          placa: t.placa || '',
          recorrido: t.recorrido || 'N/A',
          fechas: t.fechas || '',
          valor_unitario: vrUnit,
          cantidad: cant,
          total_facturado: totalFacturado,
          porcentaje_admin: pctAdmin,
          valor_admin: valorAdmin,
          valor_liquidar: valorLiquidar,
          ingreso_extra_global: ingresoExtraGlobal,
          ingresos_extra_aval: ingresosExtraAval,
          ingreso_empresa: ingresoEmpresa,
          src_index: t.src_index ?? idx,
          orden: idx,
        };
      });

      await prisma.liquidacion_tercero.createMany({ data: itemsData });
      migradas++;
      itemsMigrados += itemsData.length;
    }

    return { migradas, itemsMigrados, totalLiquidacionesRevisadas: liquidaciones.length };
  },
};

/**
 * Agregados del historial sobre TODOS los registros que casan con el
 * filtro, no solo la página actual.
 *
 * POR QUÉ: las stat cards del tab de Terceros se calculaban en el cliente
 * con `tercerosItems.reduce(...)` sobre la página (limit 50), así que
 * "Total Facturado" era el de 50 filas y no el del filtro completo — y
 * cambiaba al pasar de página, que es lo que delataba el problema. El tab
 * de Liquidaciones ya resolvía esto en el servidor vía `metadata`; esto lo
 * empareja.
 *
 * Se usa EXACTAMENTE el mismo `where` que la consulta paginada. Si
 * divergieran, la tarjeta contradiría a la tabla que tiene debajo.
 */
async function metadataHistorial(where: any) {
  const [agg, clientes] = await Promise.all([
    prisma.liquidacion_tercero.aggregate({
      where,
      _count: { _all: true },
      _sum: {
        total_facturado: true,
        valor_admin: true,
        valor_liquidar: true,
        ingreso_empresa: true,
      },
    }),
    // Nº de clientes distintos: se agrupa por la liquidación padre y se
    // cuentan clientes únicos en memoria. Prisma no expone `countDistinct`
    // sobre un campo de una relación, y el volumen de un periodo es
    // pequeño comparado con el de los items.
    prisma.liquidacion_tercero.findMany({
      where,
      select: { liquidacion: { select: { cliente_id: true } } },
      distinct: ["liquidacion_id"],
    }),
  ]);

  const clientesUnicos = new Set(
    clientes.map((c: any) => c.liquidacion?.cliente_id).filter(Boolean),
  );

  return {
    /// Nº de items que casan con el filtro (no los de la página).
    globalCount: agg._count._all,
    globalFacturado: toNumber(agg._sum.total_facturado),
    globalAdmon: toNumber(agg._sum.valor_admin),
    globalLiquidar: toNumber(agg._sum.valor_liquidar),
    globalIngresoEmpresa: toNumber(agg._sum.ingreso_empresa),
    globalClientes: clientesUnicos.size,
  };
}
