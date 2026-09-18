import { prisma } from "../../config/prisma";
import { getIo } from "../../sockets";
import { LiquidacionesTercerosDescuentosService } from "./liquidaciones-terceros-descuentos.service";
import { LiquidacionesTercerosOcasionalService } from "../liquidaciones-terceros-ocasional/liquidaciones-terceros-ocasional.service";
import { LiquidacionesTercerosIngresosService } from "../liquidaciones-terceros-ingresos/liquidaciones-terceros-ingresos.service";
import { LiquidacionesSnapshotsService } from "../liquidaciones-terceros-snapshots/liquidaciones-terceros-snapshots.service";

/**
 * Traslado de un item del pivote de un cierre de placa a OTRO documento del
 * mismo tercero, y su vuelta.
 *
 * Un item puede estar asociado a la placa y aun así no pagarse por el cierre:
 * porque se liquida como OCASIONAL —item de la liquidación ocasional del
 * periodo del cierre— o porque se cobra por INGRESOS —INCLUIR en la hoja de
 * ingresos, con lo que baja a la hoja de ADICIONALES—. Hasta ahora había que
 * quitarlo del cierre y después ir al otro canvas a buscarlo, y el ocasional
 * ni siquiera lo ofrecía: `itemsDisponibles` descarta las placas con cierre.
 *
 * Aquí se hacen las dos mitades en una sola operación, y la marca
 * `trasladado_a` del pivote es lo que permite deshacerla desde el mismo
 * sitio. Cada módulo escribe en sus propias tablas —este solo toca el
 * pivote— y el orden es DESTINO PRIMERO: si el destino rechaza el item (no
 * facturado, ocasional aprobado…), el cierre no se ha tocado todavía.
 *
 * Los DOS destinos usan el PERIODO DEL CIERRE: quien traslada lo hace desde
 * la hoja de julio y es en julio donde espera encontrar el item, aunque su
 * liquidación de servicio sea de mayo. La hoja de ingresos lo lista en ese
 * mes leyendo la marca del pivote, así que sus totales se recalculan
 * DESPUÉS de marcarlo.
 */

export type DestinoTraslado = "OCASIONAL" | "INGRESOS";
export const DESTINOS_TRASLADO: readonly DestinoTraslado[] = ["OCASIONAL", "INGRESOS"];

export const ETIQUETA_DESTINO: Record<DestinoTraslado, string> = {
  OCASIONAL: "la liquidación ocasional",
  INGRESOS: "la hoja de ingresos",
};

/// Error con estado HTTP: el controlador lo pasa tal cual. 404 si no existe
/// lo que se pidió, 409 si es el ESTADO del cierre o del item lo que impide
/// la operación y quien llama puede resolverlo.
export class ErrorTraslado extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404 | 409,
  ) {
    super(message);
    this.name = "ErrorTraslado";
  }
}

async function cargarPivote(pivoteId: string) {
  const pivote = await prisma.liquidacion_tercero_final_item.findUnique({
    where: { id: pivoteId },
    select: {
      id: true,
      deleted_at: true,
      trasladado_a: true,
      liquidacion_tercero_id: true,
      liquidacion_tercero: { select: { id: true, recorrido: true, deleted_at: true } },
      liquidacion_tercero_final: {
        select: {
          id: true,
          consecutivo: true,
          placa: true,
          mes: true,
          anio: true,
          estado: true,
          deleted_at: true,
        },
      },
    },
  });
  if (!pivote) throw new ErrorTraslado("Item de pivote no encontrado", 404);
  const cierre = pivote.liquidacion_tercero_final;
  if (!cierre || cierre.deleted_at) {
    throw new ErrorTraslado("Liquidación final de tercero no encontrada", 404);
  }
  if (cierre.estado && cierre.estado !== "BORRADOR") {
    throw new ErrorTraslado(
      `El cierre ${cierre.consecutivo} está ${cierre.estado}: solo se trasladan items de un borrador.`,
      409,
    );
  }
  if (!cierre.mes || !cierre.anio) {
    throw new ErrorTraslado("El cierre no tiene mes/año definidos", 409);
  }
  if (!pivote.liquidacion_tercero || pivote.liquidacion_tercero.deleted_at) {
    throw new ErrorTraslado("El item ya no existe en la base", 409);
  }
  return { ...pivote, cierre };
}

/**
 * Lo que le pasa al cierre después de cualquiera de las dos operaciones:
 * misma secuencia que `refreshItems` —impuestos, totales, snapshot y aviso
 * por socket a los demás clientes de la hoja—.
 */
async function trasCambioDePivote(
  cierreId: string,
  origen: "trasladar-item" | "revertir-traslado",
  userId?: string,
) {
  // Sacar o meter un item cambia la base imponible, y eso solo lo aplica
  // `calcularImpuestos`; `recalcularTotales` a secas dejaría las retenciones
  // sobre una base que ya no existe.
  await LiquidacionesTercerosDescuentosService.calcularImpuestos(cierreId);
  await LiquidacionesTercerosDescuentosService.recalcularTotales(cierreId);

  try {
    await LiquidacionesSnapshotsService.capturar(cierreId, { origen, usuarioId: userId ?? null });
  } catch (snapErr) {
    console.error(`[${origen}] Snapshot failed:`, snapErr);
  }

  try {
    const io = getIo();
    io.to(`row:liquidacion-tercero-final:${cierreId}`).emit("row:updated", {
      id: cierreId,
      changes: { itemsRefreshed: true, origen },
      updatedBy: origen,
      updatedAt: new Date().toISOString(),
    });
  } catch (emitErr) {
    console.error(`[${origen}] socket emit failed:`, emitErr);
  }
}

export const TrasladoItemsService = {
  async trasladar(pivoteId: string, destino: DestinoTraslado, userId?: string) {
    if (!DESTINOS_TRASLADO.includes(destino)) {
      throw new ErrorTraslado(`destino debe ser ${DESTINOS_TRASLADO.join(" | ")}`, 400);
    }
    const p = await cargarPivote(pivoteId);
    if (p.trasladado_a) {
      throw new ErrorTraslado(
        `El item ya está trasladado a ${ETIQUETA_DESTINO[p.trasladado_a as DestinoTraslado]}. Devuélvelo al cierre antes de volver a trasladarlo.`,
        409,
      );
    }

    const destinoInfo =
      destino === "OCASIONAL"
        ? await LiquidacionesTercerosOcasionalService.incorporarItemDesdeCierre({
            mes: p.cierre.mes,
            anio: p.cierre.anio,
            liquidacion_tercero_id: p.liquidacion_tercero_id,
            user_id: userId,
          })
        : await LiquidacionesTercerosIngresosService.marcarIncluirDesdeCierre({
            liquidacion_tercero_id: p.liquidacion_tercero_id,
            mes: p.cierre.mes,
            anio: p.cierre.anio,
            user_id: userId,
          });

    const ahora = new Date();
    await prisma.liquidacion_tercero_final_item.update({
      where: { id: p.id },
      data: {
        // Si ya estaba quitado a mano se conserva CUÁNDO se quitó.
        deleted_at: p.deleted_at ?? ahora,
        trasladado_a: destino,
        trasladado_at: ahora,
        trasladado_por_id: userId ?? null,
      },
    });
    if (destino === "INGRESOS") {
      // Con la marca puesta el item ya cuenta en el mes del cierre.
      await LiquidacionesTercerosIngresosService.recalcularCabeceraPeriodo(
        p.cierre.mes,
        p.cierre.anio,
        userId,
      );
    }
    await trasCambioDePivote(p.cierre.id, "trasladar-item", userId);

    return {
      ok: true,
      destino,
      destino_info: destinoInfo,
      cierre: await LiquidacionesTercerosDescuentosService.obtenerPorId(p.cierre.id, {
        includeDeleted: true,
      }),
    };
  },

  async revertir(pivoteId: string, userId?: string) {
    const p = await cargarPivote(pivoteId);
    const destino = p.trasladado_a as DestinoTraslado | null;
    if (!destino) {
      throw new ErrorTraslado(
        "El item no está trasladado: si solo estaba quitado, devuélvelo con «Devolver».",
        409,
      );
    }

    const destinoInfo =
      destino === "OCASIONAL"
        ? await LiquidacionesTercerosOcasionalService.retirarItemDesdeCierre({
            mes: p.cierre.mes,
            anio: p.cierre.anio,
            liquidacion_tercero_id: p.liquidacion_tercero_id,
            user_id: userId,
          })
        : await LiquidacionesTercerosIngresosService.desmarcarIncluirDesdeCierre({
            liquidacion_tercero_id: p.liquidacion_tercero_id,
            mes: p.cierre.mes,
            anio: p.cierre.anio,
            user_id: userId,
          });

    await prisma.liquidacion_tercero_final_item.update({
      where: { id: p.id },
      data: {
        deleted_at: null,
        trasladado_a: null,
        trasladado_at: null,
        trasladado_por_id: null,
      },
    });
    if (destino === "INGRESOS") {
      // Sin la marca el item deja de contar en el mes del cierre.
      await LiquidacionesTercerosIngresosService.recalcularCabeceraPeriodo(
        p.cierre.mes,
        p.cierre.anio,
        userId,
      );
    }
    await trasCambioDePivote(p.cierre.id, "revertir-traslado", userId);

    return {
      ok: true,
      destino,
      destino_info: destinoInfo,
      cierre: await LiquidacionesTercerosDescuentosService.obtenerPorId(p.cierre.id, {
        includeDeleted: true,
      }),
    };
  },
};
