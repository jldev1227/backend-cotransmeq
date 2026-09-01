/**
 * Cálculo de totales de un cierre final. FUENTE ÚNICA DE VERDAD.
 *
 * PROBLEMA QUE RESUELVE
 * Había dos implementaciones que sumaban los adicionales de sitios
 * DISTINTOS:
 *
 *   · `liquidaciones-terceros-adicionales.service.ts` los suma de la TABLA
 *     `liquidacion_tercero_final_adicional` (la que creamos al migrar los
 *     adicionales fuera del JSONB).
 *   · `liquidaciones-terceros-descuentos.service.ts` (`recalcularTotales`)
 *     los sumaba del JSONB `liquidacion_tercero_final.adicionales`.
 *
 * Mientras solo se usara uno de los dos caminos por sesión, la
 * inconsistencia no se veía. El canvas de cierres finales dispara AMBOS
 * (editar un adicional va por el primero, editar un concepto por el
 * segundo), así que `valor_liquidar` oscilaría según cuál corrió de último.
 *
 * REGLA
 * La tabla manda. El JSONB solo se usa como respaldo cuando la tabla está
 * vacía Y el JSONB no — es decir, para cierres que aún no pasaron por el
 * backfill de la migración `12-08-2026-adicionales-tabla-real`. NUNCA se
 * suman los dos: eso duplicaría importes.
 *
 * OJO con los items: `liquidacion_tercero_final_item` es un PIVOTE puro
 * (ids, `orden`, `aplica_impuestos`). El importe vive al otro lado, en
 * `liquidacion_tercero.valor_liquidar`.
 */

import { prisma } from "../../config/prisma";

/** Cliente Prisma o transacción. Todas las funciones aceptan ambos. */
type Db = typeof prisma | any;

export interface TotalesCierre {
  valor_liquidar: number;
  total_costos_laborales: number;
  total_gastos_operativos: number;
  total_impuestos: number;
  total_anticipos: number;
  total_descuentos: number;
  total_pagar: number;
}

function toNumber(v: any): number {
  if (v == null) return 0;
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

/**
 * Σ de los adicionales vivos del cierre.
 *
 * Devuelve además de dónde salió el dato, para poder detectar en logs los
 * cierres que siguen dependiendo del JSONB.
 */
export async function sumarAdicionalesCierre(
  db: Db,
  cierreId: string,
): Promise<{ total: number; fuente: "tabla" | "jsonb" | "vacio" }> {
  const agg = await db.liquidacion_tercero_final_adicional.aggregate({
    where: { liquidacion_tercero_final_id: cierreId, deleted_at: null },
    _sum: { valor_liquidar: true },
    _count: { _all: true },
  });

  if (agg._count._all > 0) {
    return { total: toNumber(agg._sum.valor_liquidar), fuente: "tabla" };
  }

  // Sin filas en la tabla: puede ser un cierre sin adicionales, o uno que no
  // pasó por el backfill. Se distingue mirando el JSONB.
  const cierre = await db.liquidacion_tercero_final.findUnique({
    where: { id: cierreId },
    select: { adicionales: true },
  });
  const arr = Array.isArray(cierre?.adicionales) ? (cierre!.adicionales as any[]) : [];
  if (arr.length === 0) return { total: 0, fuente: "vacio" };

  console.warn(
    `[totales-cierre] cierre ${cierreId} sin filas en liquidacion_tercero_final_adicional ` +
      `pero con ${arr.length} en el JSONB — usando el respaldo. ¿Falta correr el backfill?`,
  );
  return {
    total: arr.reduce((s, a) => s + toNumber(a?.valor_liquidar), 0),
    fuente: "jsonb",
  };
}

/**
 * Σ del `valor_liquidar` de los adicionales que GRAVAN impuestos
 * (`aplica_impuestos !== false`).
 *
 * Misma regla de fuente que `sumarAdicionalesCierre`: la tabla manda, el
 * JSONB solo como respaldo. Los cálculos de base imponible
 * (`calcularImpuestos`, `recalcularImpuestosPorPropietario`) leían el JSONB
 * directamente, así que ignoraban los adicionales creados desde el canvas —
 * que van a la tabla — y la base salía corta.
 */
export async function sumarAdicionalesGravados(
  db: Db,
  cierreId: string,
): Promise<number> {
  const filas = await db.liquidacion_tercero_final_adicional.findMany({
    where: { liquidacion_tercero_final_id: cierreId, deleted_at: null },
    select: { valor_liquidar: true, aplica_impuestos: true },
  });

  if (filas.length > 0) {
    return filas
      .filter((a: any) => a.aplica_impuestos !== false)
      .reduce((s: number, a: any) => s + toNumber(a.valor_liquidar), 0);
  }

  const cierre = await db.liquidacion_tercero_final.findUnique({
    where: { id: cierreId },
    select: { adicionales: true },
  });
  const arr = Array.isArray(cierre?.adicionales) ? (cierre!.adicionales as any[]) : [];
  return arr
    .filter((a) => a?.aplica_impuestos !== false)
    .reduce((s, a) => s + toNumber(a?.valor_liquidar), 0);
}

/** Σ del `valor_liquidar` de los items pivote vivos, vía la relación. */
export async function sumarItemsCierre(db: Db, cierreId: string): Promise<number> {
  const items = await db.liquidacion_tercero_final_item.findMany({
    where: { liquidacion_tercero_final_id: cierreId, deleted_at: null },
    select: { liquidacion_tercero: { select: { valor_liquidar: true } } },
  });
  return items.reduce(
    (s: number, it: any) => s + toNumber(it.liquidacion_tercero?.valor_liquidar),
    0,
  );
}

/** Totales derivados de los conceptos vivos, agrupados por tipo. */
export async function sumarConceptosCierre(
  db: Db,
  cierreId: string,
): Promise<Pick<
  TotalesCierre,
  | "total_costos_laborales"
  | "total_gastos_operativos"
  | "total_impuestos"
  | "total_anticipos"
  | "total_descuentos"
>> {
  const conceptos = await db.liquidacion_tercero_final_concepto.findMany({
    where: { liquidacion_tercero_final_id: cierreId, deleted_at: null },
    select: { tipo: true, valor_total: true },
  });

  const porTipo = (tipo: string) =>
    conceptos
      .filter((c: any) => c.tipo === tipo)
      .reduce((s: number, c: any) => s + toNumber(c.valor_total), 0);

  const total_costos_laborales = porTipo("COSTO_LABORAL");
  const total_gastos_operativos = porTipo("GASTO_OPERATIVO");
  const total_impuestos = porTipo("IMPUESTO");
  const total_anticipos = porTipo("ANTICIPO");

  return {
    total_costos_laborales,
    total_gastos_operativos,
    total_impuestos,
    total_anticipos,
    total_descuentos:
      total_costos_laborales +
      total_gastos_operativos +
      total_impuestos +
      total_anticipos,
  };
}

/**
 * Calcula los totales SIN persistirlos.
 *
 *   valor_liquidar = Σ items pivote vivos + Σ adicionales vivos
 *   total_pagar    = valor_liquidar − total_descuentos
 */
export async function calcularTotalesCierre(
  db: Db,
  cierreId: string,
): Promise<TotalesCierre> {
  const [items, adicionales, conceptos] = await Promise.all([
    sumarItemsCierre(db, cierreId),
    sumarAdicionalesCierre(db, cierreId),
    sumarConceptosCierre(db, cierreId),
  ]);

  const valor_liquidar = items + adicionales.total;

  return {
    ...conceptos,
    valor_liquidar,
    total_pagar: valor_liquidar - conceptos.total_descuentos,
  };
}

/**
 * Calcula y PERSISTE los totales del cierre.
 *
 * Es el único punto por el que deberían pasar todos los caminos que tocan
 * conceptos, items o adicionales.
 */
export async function recalcularTotalesCierre(
  db: Db,
  cierreId: string,
  opts?: { userId?: string | null },
): Promise<TotalesCierre> {
  const totales = await calcularTotalesCierre(db, cierreId);

  await db.liquidacion_tercero_final.update({
    where: { id: cierreId },
    data: {
      valor_liquidar: totales.valor_liquidar,
      total_costos_laborales: totales.total_costos_laborales,
      total_gastos_operativos: totales.total_gastos_operativos,
      total_impuestos: totales.total_impuestos,
      total_descuentos: totales.total_descuentos,
      total_pagar: totales.total_pagar,
      ...(opts?.userId ? { actualizado_por_id: opts.userId } : {}),
      updated_at: new Date(),
    },
  });

  return totales;
}
