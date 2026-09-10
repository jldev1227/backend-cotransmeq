/**
 * Siembra de las filas de GASTOS DE VEHÍCULO de un cierre final.
 *
 * POR QUÉ EXISTE
 * La sección de gastos existe siempre, aunque esté a cero: son gastos fijos
 * del vehículo y el equipo necesita las filas para teclear encima. Pero la
 * siembra vivía SOLO dentro de `sincronizarConductores`, es decir detrás del
 * botón «Sincronizar con nómina». Quien generaba un borrador y no sincronizaba
 * se quedaba sin papelería ni gastos diversos: en julio de 2026, 40 de 41
 * cierres no los tenían.
 *
 * Ahora se siembra también al persistir el borrador, y este módulo es el único
 * sitio que decide QUÉ filas faltan y con qué importe nacen, para que los dos
 * caminos no puedan divergir.
 *
 * La aritmética no está aquí: vive en `reglas-conceptos.ts`, que es puro. Esto
 * lee las bases de la base de datos y ordena las filas a crear.
 */

import { randomUUID } from 'crypto';
import { prisma } from '../../config/prisma';
import {
  GASTOS_POR_DEFECTO,
  ORDEN_BASE_GASTO,
  ORDEN_GASTOS_CANONICO,
  gastosPorDefectoDelPeriodo,
  type ConfigGastosPeriodo,
} from './reglas-conceptos';
import { ConfigGastosPeriodoService } from './config-gastos-periodo.service';
import { sumarAdicionalesCierre, sumarItemsCierre } from './totales-cierre';

/** Cliente Prisma o transacción. */
type Db = typeof prisma | any;

export interface BasesGastos {
  /** Σ TOTAL de los items + Σ bruto de adicionales. Base de gastos diversos. */
  baseFacturada: number;
  /** `valor_liquidar` del cierre. Decide el tramo de papelería. */
  valorLiquidar: number;
}

/**
 * Las filas de gasto que FALTAN, listas para `createMany`.
 *
 * Solo las que faltan: una fila existente puede llevar un importe tecleado a
 * mano y volver a crearla lo perdería. Por eso también es idempotente —
 * regenerar un borrador no pisa nada.
 */
export function filasGastosFaltantes(
  cierreId: string,
  conceptosExistentes: Array<{ tipo: string; concepto: string }>,
  config: ConfigGastosPeriodo,
  bases: BasesGastos,
): any[] {
  const presentes = new Set(
    conceptosExistentes
      .filter((c) => c.tipo === 'GASTO_OPERATIVO')
      .map((c) => c.concepto),
  );

  return gastosPorDefectoDelPeriodo(config, bases)
    .filter((g) => !presentes.has(g.concepto))
    .map((g) => ({
      id: randomUUID(),
      liquidacion_tercero_final_id: cierreId,
      tipo: 'GASTO_OPERATIVO',
      concepto: g.concepto,
      conductor_id: null,
      dias: String(g.dias),
      valor_unitario: String(g.valor_unitario),
      valor_total: String(g.dias * g.valor_unitario),
      calculado: g.calculado,
      // Con la base compartida con el frontend, para que el builder los pinte
      // en el orden canónico y no por fecha de creación.
      orden: ORDEN_BASE_GASTO + (ORDEN_GASTOS_CANONICO[g.concepto] ?? 0) - 1,
    }));
}

/**
 * Lee las bases del cierre y siembra los gastos que falten.
 *
 * Devuelve cuántas filas creó, que es lo que el llamador necesita para decidir
 * si hace falta recalcular totales.
 *
 * DOTACION y EXAMEN_MEDICO nacen en CERO aunque se siembren aquí: dependen de
 * los días de los conductores no propietarios y al generar el borrador todavía
 * no hay conductores sincronizados. Las rellena `recalcularGastosAutomaticos`
 * en cuanto los haya, que es exactamente lo que hace el sync.
 */
export async function sembrarGastosDelCierre(
  cierreId: string,
  periodo: { anio: number; mes: number },
  db: Db = prisma,
): Promise<number> {
  const cierre = await db.liquidacion_tercero_final.findUnique({
    where: { id: cierreId },
    select: { valor_liquidar: true },
  });
  if (!cierre) return 0;

  const conceptos = await db.liquidacion_tercero_final_concepto.findMany({
    where: { liquidacion_tercero_final_id: cierreId, deleted_at: null },
    select: { tipo: true, concepto: true },
  });

  const config = await ConfigGastosPeriodoService.obtener(periodo.anio, periodo.mes, db);
  const items = await sumarItemsCierre(db, cierreId);
  const { total: adicionales } = await sumarAdicionalesCierre(db, cierreId);

  const filas = filasGastosFaltantes(cierreId, conceptos, config, {
    baseFacturada: items + adicionales,
    // `valor_liquidar` ya está calculado en el cierre cuando se llama a esto:
    // se persiste en el mismo `create` que los items.
    valorLiquidar: Number(cierre.valor_liquidar) || 0,
  });
  if (filas.length === 0) return 0;

  await db.liquidacion_tercero_final_concepto.createMany({ data: filas });
  return filas.length;
}

/** Los conceptos de gasto que este módulo sabe sembrar. */
export const CONCEPTOS_GASTO_SEMBRADOS = GASTOS_POR_DEFECTO.map((g) => g.concepto);
