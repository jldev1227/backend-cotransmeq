/**
 * Snapshots de las liquidaciones ocasionales de terceros.
 *
 * ESTE ARCHIVO ESTABA MUERTO EN RUNTIME. Apuntaba a `liquidacion_tercero_mensual*`,
 * modelos que la migración `12-08-2026-rename-mensual-to-ocasional` eliminó.
 * El `// @ts-nocheck` de la primera línea impedía que el compilador lo
 * detectara, así que compilaba y reventaba al ejecutarse con
 * `Cannot read properties of undefined (reading 'findUnique')`. El cron
 * horario (`snapshot-liquidaciones-mensual.job.ts`, `"15 * * * *"`) llevaba
 * fallando en cada ejecución.
 *
 * Se reescribió contra `liquidacion_tercero_ocasional*` y se retiró el
 * `@ts-nocheck`: es lo único que dejó llegar el archivo roto a producción.
 *
 * Cambios de fondo respecto a la versión anterior:
 *   · `cierres_origen` usaba la relación `mensual_origen`, INEXISTENTE en el
 *     schema actual. Ahora se deriva de los items, atravesando el pivote
 *     `liquidacion_tercero` hasta el cierre final.
 *   · El revert reinsertaba `cierre_final_id` /
 *     `cierre_final_origen_id` / `cierre_final_destino_id`, tres columnas que
 *     tampoco existen (mismo fallo que rompía `guardarBorrador`).
 *   · Los items sin `liquidacion_tercero_id` se descartan: la columna es NOT
 *     NULL y forma parte de `uniq_ocasional_item_pivote`.
 */

import { prisma } from "../../config/prisma";
import {
  reservarVersionSnapshot,
  hashSnapshotPayload,
  inicioVentanaAntirrebote,
  type SnapshotTx,
} from "../../utils/snapshot-version";
import { CanvasAnotacionesService } from "../canvas-anotaciones/canvas-anotaciones.service";
import { randomUUID } from "crypto";
import { emitSheetReverted } from "../../sockets/sheet.gateway";

export interface OcasionalSnapshotPayload {
  cabecera: Record<string, any>;
  totales: Record<string, any>;
  estado: string;
  motivo_anulacion: string | null;
  observaciones: string | null;
  items: Array<Record<string, any>>;
  adicionales: Array<Record<string, any>>;
  conceptos: Array<Record<string, any>>;
  cierres_origen: Array<{ id: string; consecutivo: string; placa: string }>;
  /// Anotaciones libres del canvas de este periodo. Van en el snapshot para
  /// que revertir devuelva la hoja COMPLETA: las notas que el equipo dejó
  /// forman parte del estado de trabajo tanto como los importes.
  anotaciones?: Array<Record<string, any>>;
  meta: {
    capturado_en: string;
    capturado_por: string;
    version_origen: number;
    items_count: number;
    adicionales_count: number;
    conceptos_count: number;
  };
}

export interface OcasionalDiffResult {
  fields: Array<{ path: string; anterior: any; nuevo: any }>;
}

function toNumber(v: any): number {
  if (v == null) return 0;
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function deepDiff(objA: any, objB: any, prefix = ""): OcasionalDiffResult["fields"] {
  const changes: OcasionalDiffResult["fields"] = [];
  const allKeys = new Set([...Object.keys(objA || {}), ...Object.keys(objB || {})]);
  for (const key of allKeys) {
    const path = prefix ? `${prefix}.${key}` : key;
    const valA = objA?.[key];
    const valB = objB?.[key];
    if (
      typeof valA === "object" && valA !== null &&
      typeof valB === "object" && valB !== null &&
      !Array.isArray(valA) && !Array.isArray(valB)
    ) {
      changes.push(...deepDiff(valA, valB, path));
    } else if (JSON.stringify(valA) !== JSON.stringify(valB)) {
      changes.push({ path, anterior: valA, nuevo: valB });
    }
  }
  return changes;
}

async function buildOcasionalPayload(cabeceraId: string): Promise<OcasionalSnapshotPayload> {
  const cabecera = await prisma.liquidacion_tercero_ocasional.findUnique({
    where: { id: cabeceraId },
  });
  if (!cabecera) throw new Error("Liquidación ocasional no encontrada");

  // El `id` de desempate no es decorativo: `orden` se repite —hay cuatro
  // items con orden 0, cuatro con orden 1…— y sin criterio de desempate
  // Postgres puede devolverlos en distinto orden en cada consulta. Eso hacía
  // que dos payloads idénticos parecieran distintos, que el diff señalara
  // cambios inexistentes y que la deduplicación del cron nunca acertara.
  const [items, adicionales, conceptos] = await Promise.all([
    prisma.liquidacion_tercero_ocasional_item.findMany({
      where: { liquidacion_ocasional_id: cabeceraId, deleted_at: null },
      orderBy: [{ orden: "asc" }, { id: "asc" }],
    }),
    prisma.liquidacion_tercero_ocasional_adicional.findMany({
      where: { liquidacion_ocasional_id: cabeceraId, deleted_at: null },
      orderBy: [{ orden: "asc" }, { id: "asc" }],
    }),
    prisma.liquidacion_tercero_ocasional_concepto.findMany({
      where: { liquidacion_ocasional_id: cabeceraId, deleted_at: null },
      orderBy: [{ orden: "asc" }, { concepto: "asc" }, { id: "asc" }],
    }),
  ]);

  // `cierres_origen` se deriva de los items. La versión anterior usaba
  // `mensual_origen: { some: ... }`, una relación que no existe en el schema.
  const pivoteIds = items.map((i) => i.liquidacion_tercero_id).filter(Boolean) as string[];
  const cierresOrigen = pivoteIds.length
    ? await prisma.liquidacion_tercero_final.findMany({
        where: {
          deleted_at: null,
          items: { some: { liquidacion_tercero_id: { in: pivoteIds }, deleted_at: null } },
        },
        select: { id: true, consecutivo: true, placa: true },
        orderBy: [{ consecutivo: "asc" }, { id: "asc" }],
      })
    : [];

  // Las anotaciones son del PERIODO (mes/año), no de la cabecera: viven en
  // su propia tabla y por eso se piden aparte.
  const anotaciones = await CanvasAnotacionesService.exportar(
    "ocasional",
    cabecera.anio,
    cabecera.mes
  );

  return {
    anotaciones,
    cabecera: {
      id: cabecera.id,
      consecutivo: cabecera.consecutivo,
      mes: cabecera.mes,
      anio: cabecera.anio,
      created_at: cabecera.created_at,
      updated_at: cabecera.updated_at,
    },
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
    estado: cabecera.estado || "BORRADOR",
    motivo_anulacion: cabecera.motivo_anulacion || null,
    observaciones: cabecera.observaciones || null,
    items: items.map((i) => ({
      id: i.id,
      liquidacion_tercero_id: i.liquidacion_tercero_id,
      liquidacion_servicio_id: i.liquidacion_servicio_id,
      cliente_nombre: i.cliente_nombre,
      consecutivo: i.consecutivo,
      placa: i.placa,
      tercero_id: i.tercero_id,
      tercero_nombre: i.tercero_nombre,
      tercero_documento: i.tercero_documento,
      recorrido: i.recorrido,
      fechas: i.fechas,
      valor_unitario: toNumber(i.valor_unitario),
      cantidad: toNumber(i.cantidad),
      porcentaje_admin: toNumber(i.porcentaje_admin),
      valor_admin: toNumber(i.valor_admin),
      total_facturado: toNumber(i.total_facturado),
      valor_liquidar: toNumber(i.valor_liquidar),
      numero_planilla: i.numero_planilla,
      ingreso_extra_global: toNumber(i.ingreso_extra_global),
      ingresos_extra_aval: toNumber(i.ingresos_extra_aval),
      ingreso_empresa: toNumber(i.ingreso_empresa),
      numero_factura: i.numero_factura,
      aplica_impuestos: i.aplica_impuestos,
      excluido: i.excluido,
      orden: i.orden,
    })),
    adicionales: adicionales.map((a) => ({
      id: a.id,
      cliente: a.cliente,
      placa: a.placa,
      tercero_id: a.tercero_id,
      tercero_nombre: a.tercero_nombre,
      vehiculo_id: a.vehiculo_id,
      recorrido: a.recorrido,
      fechas: a.fechas,
      valor_unitario: toNumber(a.valor_unitario),
      cantidad: toNumber(a.cantidad),
      porcentaje_admin: toNumber(a.porcentaje_admin),
      valor_admin: toNumber(a.valor_admin),
      valor_liquidar: toNumber(a.valor_liquidar),
      aplica_impuestos: a.aplica_impuestos,
      orden: a.orden,
    })),
    conceptos: conceptos.map((c) => ({
      id: c.id,
      tipo: c.tipo,
      concepto: c.concepto,
      conductor_id: c.conductor_id,
      placa_aplicada: c.placa_aplicada,
      dias: c.dias != null ? toNumber(c.dias) : null,
      valor_unitario: toNumber(c.valor_unitario),
      porcentaje: c.porcentaje != null ? toNumber(c.porcentaje) : null,
      valor_total: toNumber(c.valor_total),
      base_calculo: c.base_calculo != null ? toNumber(c.base_calculo) : null,
      calculado: c.calculado,
      observaciones: c.observaciones,
      orden: c.orden,
    })),
    cierres_origen: cierresOrigen,
    meta: {
      capturado_en: new Date().toISOString(),
      capturado_por: "system",
      version_origen: 0,
      items_count: items.length,
      adicionales_count: adicionales.length,
      conceptos_count: conceptos.length,
    },
  };
}

async function ultimaVersion(tx: SnapshotTx, cabeceraId: string): Promise<number | null> {
  const last = await tx.liquidacion_tercero_ocasional_snapshot.findFirst({
    where: { liquidacion_ocasional_id: cabeceraId },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  return last?.version ?? null;
}

export const LiquidacionesTercerosOcasionalSnapshotsService = {
  /** Captura inmutable del estado actual de la cabecera. */
  async capturar(
    cabeceraId: string,
    opts: {
      origen: "manual" | "auto" | "revert";
      usuarioId?: string | null;
      revertidoDeId?: string | null;
    },
  ) {
    const cabecera = await prisma.liquidacion_tercero_ocasional.findUnique({
      where: { id: cabeceraId },
      select: { id: true },
    });
    if (!cabecera) throw new Error("Liquidación ocasional no encontrada");

    // El payload se construye ANTES de tomar el lock: son decenas de queries
    // y mantenerlas dentro bloquearía al resto de capturas de esta cabecera.
    const payload = await buildOcasionalPayload(cabeceraId);
    payload.meta.capturado_por = opts.usuarioId || "cron";

    let diff: OcasionalDiffResult["fields"] | null = null;

    // La versión se lee y se inserta bajo el mismo advisory lock. Calcularla
    // fuera dejaba una ventana de segundos en la que dos capturas simultáneas
    // de la misma cabecera chocaban contra el unique
    // (liquidacion_ocasional_id, version).
    const { snapshot, omitido } = await reservarVersionSnapshot({
      scope: `snapshot:ocasional:${cabeceraId}`,
      ultimaVersion: (tx) => ultimaVersion(tx, cabeceraId),
      insertar: async (tx, version) => {
        const prev = await tx.liquidacion_tercero_ocasional_snapshot.findFirst({
          where: { liquidacion_ocasional_id: cabeceraId },
          orderBy: { version: "desc" },
        });

        // El cron capturaba hubiera cambios o no. Si el contenido es idéntico
        // al último snapshot no se inserta: la versión anterior YA describe
        // este estado. Solo aplica a `auto`; una captura manual o un revert
        // son actos deliberados y se guardan siempre.
        if (
          opts.origen === "auto" &&
          prev &&
          hashSnapshotPayload(prev.payload) === hashSnapshotPayload(payload)
        ) {
          return { snapshot: prev, omitido: true };
        }

        payload.meta.version_origen = version;
        if (opts.origen !== "auto" && prev) diff = deepDiff(prev.payload, payload);

        const creado = await tx.liquidacion_tercero_ocasional_snapshot.create({
          data: {
            liquidacion_ocasional_id: cabeceraId,
            version,
            origen: opts.origen,
            revertido_de_id: opts.revertidoDeId || null,
            usuario_id: opts.usuarioId || null,
            payload: payload as any,
            diff: diff ? (diff as any) : undefined,
          },
        });
        return { snapshot: creado, omitido: false };
      },
    });

    return { ...snapshot, payload, diff, omitido };
  },

  async listar(cabeceraId: string, opts?: { rama?: string }) {
    const where: any = { liquidacion_ocasional_id: cabeceraId };
    if (opts?.rama) where.rama = opts.rama;

    const snapshots = await prisma.liquidacion_tercero_ocasional_snapshot.findMany({
      where,
      orderBy: { version: "desc" },
      include: {
        usuario: { select: { id: true, nombre: true, correo: true } },
      },
    });

    return snapshots.map((s) => ({
      id: s.id,
      version: s.version,
      rama: s.rama,
      origen: s.origen,
      revertido_de_id: s.revertido_de_id,
      usuario: s.usuario,
      created_at: s.created_at,
      diff: s.diff,
      meta: (s.payload as any)?.meta ?? null,
    }));
  },

  async obtener(cabeceraId: string, snapshotId: string) {
    const snapshot = await prisma.liquidacion_tercero_ocasional_snapshot.findFirst({
      where: { id: snapshotId, liquidacion_ocasional_id: cabeceraId },
      include: {
        usuario: { select: { id: true, nombre: true, correo: true } },
      },
    });
    if (!snapshot) throw new Error("Snapshot no encontrado");
    return snapshot;
  },

  async diff(snapshotIdA: string, snapshotIdB: string): Promise<OcasionalDiffResult> {
    const [a, b] = await Promise.all([
      prisma.liquidacion_tercero_ocasional_snapshot.findUnique({ where: { id: snapshotIdA } }),
      prisma.liquidacion_tercero_ocasional_snapshot.findUnique({ where: { id: snapshotIdB } }),
    ]);
    if (!a) throw new Error("Snapshot A no encontrado");
    if (!b) throw new Error("Snapshot B no encontrado");
    return { fields: deepDiff(a.payload, b.payload) };
  },

  /**
   * Revierte la cabecera a un snapshot anterior y difunde el cambio.
   *
   * Una reversión altera la GEOMETRÍA de la hoja (filas creadas o borradas),
   * así que el broadcast va a todo el room, emisor incluido, y sube el
   * `epoch` del periodo para invalidar los patches que estuvieran en vuelo.
   * Sin eso, el `ack` de un patch anterior reintroduciría un valor de antes
   * de revertir.
   */
  async revertir(cabeceraId: string, snapshotId: string, usuarioId: string) {
    const snapshot = await prisma.liquidacion_tercero_ocasional_snapshot.findFirst({
      where: { id: snapshotId, liquidacion_ocasional_id: cabeceraId },
    });
    if (!snapshot) throw new Error("Snapshot no encontrado");

    const cabecera = await prisma.liquidacion_tercero_ocasional.findUnique({
      where: { id: cabeceraId },
    });
    if (!cabecera) throw new Error("Liquidación ocasional no encontrada");
    if (["APROBADA", "FACTURADA"].includes(cabecera.estado || "")) {
      throw new Error(
        "No se puede revertir una liquidación APROBADA o FACTURADA. Anúlala primero.",
      );
    }

    const payload = snapshot.payload as unknown as OcasionalSnapshotPayload;

    await prisma.$transaction(async (tx) => {
      await tx.liquidacion_tercero_ocasional_item.updateMany({
        where: { liquidacion_ocasional_id: cabeceraId, deleted_at: null },
        data: { deleted_at: new Date() },
      });
      await tx.liquidacion_tercero_ocasional_adicional.updateMany({
        where: { liquidacion_ocasional_id: cabeceraId, deleted_at: null },
        data: { deleted_at: new Date() },
      });
      await tx.liquidacion_tercero_ocasional_concepto.updateMany({
        where: { liquidacion_ocasional_id: cabeceraId, deleted_at: null },
        data: { deleted_at: new Date() },
      });

      // `liquidacion_tercero_id` es NOT NULL y parte del unique
      // `uniq_ocasional_item_pivote`: un item sin pivote no puede reinsertarse.
      const itemsValidos = (payload.items || []).filter((i) => i.liquidacion_tercero_id);
      const descartados = (payload.items || []).length - itemsValidos.length;
      if (descartados > 0) {
        console.warn(
          `[ocasional-snapshots] revert ${cabeceraId}: ${descartados} item(s) del snapshot ` +
            `descartados por venir sin liquidacion_tercero_id`,
        );
      }

      if (itemsValidos.length > 0) {
        await tx.liquidacion_tercero_ocasional_item.createMany({
          data: itemsValidos.map((i) => ({
            id: i.id || randomUUID(),
            liquidacion_ocasional_id: cabeceraId,
            liquidacion_tercero_id: i.liquidacion_tercero_id,
            liquidacion_servicio_id: i.liquidacion_servicio_id ?? null,
            cliente_nombre: i.cliente_nombre ?? "",
            consecutivo: i.consecutivo ?? "",
            placa: i.placa ?? "",
            tercero_id: i.tercero_id ?? null,
            tercero_nombre: i.tercero_nombre ?? "",
            tercero_documento: i.tercero_documento ?? null,
            recorrido: i.recorrido ?? "",
            fechas: i.fechas ?? "",
            valor_unitario: i.valor_unitario ?? 0,
            cantidad: i.cantidad ?? 1,
            porcentaje_admin: i.porcentaje_admin ?? 0,
            valor_admin: i.valor_admin ?? 0,
            total_facturado: i.total_facturado ?? 0,
            valor_liquidar: i.valor_liquidar ?? 0,
            numero_planilla: i.numero_planilla ?? null,
            ingreso_extra_global: i.ingreso_extra_global ?? 0,
            ingresos_extra_aval: i.ingresos_extra_aval ?? 0,
            ingreso_empresa: i.ingreso_empresa ?? 0,
            numero_factura: i.numero_factura ?? null,
            aplica_impuestos: i.aplica_impuestos !== false,
            excluido: i.excluido === true,
            orden: i.orden ?? 0,
          })),
          skipDuplicates: true,
        });
      }

      if ((payload.adicionales || []).length > 0) {
        await tx.liquidacion_tercero_ocasional_adicional.createMany({
          data: payload.adicionales.map((a) => ({
            id: a.id || randomUUID(),
            liquidacion_ocasional_id: cabeceraId,
            cliente: a.cliente ?? "TRANSMERALDA",
            placa: a.placa ?? "",
            tercero_id: a.tercero_id ?? null,
            tercero_nombre: a.tercero_nombre ?? null,
            vehiculo_id: a.vehiculo_id ?? null,
            recorrido: a.recorrido ?? null,
            fechas: a.fechas ?? null,
            valor_unitario: a.valor_unitario ?? 0,
            cantidad: a.cantidad ?? 1,
            porcentaje_admin: a.porcentaje_admin ?? 0,
            valor_admin: a.valor_admin ?? 0,
            valor_liquidar: a.valor_liquidar ?? 0,
            aplica_impuestos: a.aplica_impuestos !== false,
            orden: a.orden ?? 0,
          })),
          skipDuplicates: true,
        });
      }

      if ((payload.conceptos || []).length > 0) {
        await tx.liquidacion_tercero_ocasional_concepto.createMany({
          data: payload.conceptos.map((c) => ({
            id: c.id || randomUUID(),
            liquidacion_ocasional_id: cabeceraId,
            tipo: c.tipo,
            concepto: c.concepto,
            conductor_id: c.conductor_id ?? null,
            placa_aplicada: c.placa_aplicada ?? null,
            dias: c.dias ?? null,
            valor_unitario: c.valor_unitario ?? 0,
            porcentaje: c.porcentaje ?? null,
            valor_total: c.valor_total ?? 0,
            base_calculo: c.base_calculo ?? null,
            calculado: c.calculado === true,
            observaciones: c.observaciones ?? null,
            orden: c.orden ?? 0,
            actualizado_por_id: usuarioId,
          })),
          skipDuplicates: true,
        });
      }

      await tx.liquidacion_tercero_ocasional.update({
        where: { id: cabeceraId },
        data: {
          estado: payload.estado,
          motivo_anulacion: payload.motivo_anulacion,
          observaciones: payload.observaciones,
          actualizado_por_id: usuarioId,
          updated_at: new Date(),
          total_facturado_items: payload.totales.total_facturado_items,
          total_admin_items: payload.totales.total_admin_items,
          total_liquidar_items: payload.totales.total_liquidar_items,
          total_adicionales: payload.totales.total_adicionales,
          total_gastos_operativos: payload.totales.total_gastos_operativos,
          total_impuestos: payload.totales.total_impuestos,
          total_anticipos: payload.totales.total_anticipos,
          total_descuentos: payload.totales.total_descuentos,
          total_pagar: payload.totales.total_pagar,
        },
      });
    });

    const revertSnapshot = await this.capturar(cabeceraId, {
      origen: "revert",
      usuarioId,
      revertidoDeId: snapshotId,
    });

    // Avisar a los canvas abiertos. `emitSheetReverted` sube el epoch del
    // periodo, así que los patches en vuelo con el epoch viejo se rechazan.
    const usuario = await prisma.usuarios.findUnique({
      where: { id: usuarioId },
      select: { nombre: true },
    });
    // Las anotaciones se restauran FUERA de la transacción de la liquidación:
    // viven en otra tabla y su fallo no debe tumbar el revert de los importes,
    // que es lo que el usuario realmente pidió deshacer.
    try {
      await CanvasAnotacionesService.restaurar({
        scope: "ocasional",
        anio: cabecera.anio,
        mes: cabecera.mes,
        anotaciones: (payload.anotaciones as any[]) ?? [],
        user_id: usuarioId,
      });
    } catch (e: any) {
      console.warn(
        `[ocasional-snapshots] revert ${cabeceraId}: no se pudieron restaurar las anotaciones`,
        e?.message,
      );
    }

    emitSheetReverted({
      scope: "ocasional",
      anio: cabecera.anio,
      mes: cabecera.mes,
      version: revertSnapshot.version,
      by: { id: usuarioId, name: usuario?.nombre || "Usuario" },
    });

    return revertSnapshot;
  },

  /** Captura horaria de todas las cabeceras activas. Lo llama el cron. */
  async capturarHorario() {
    const cabeceras = await prisma.liquidacion_tercero_ocasional.findMany({
      where: { deleted_at: null, estado: { in: ["BORRADOR", "LIQUIDADA"] } },
      select: { id: true },
    });

    // Antirrebote del doble disparo. El job corre in-process en cada
    // instancia y además está expuesto en `.../cron-hora`, así que a la misma
    // hora puede entrar más de una vez. Las cabeceras con una captura `auto`
    // reciente se saltan ANTES de construir el payload, que es la parte cara.
    // Una sola query para todo el lote, no una por cabecera.
    const recientes = await prisma.liquidacion_tercero_ocasional_snapshot.findMany({
      where: {
        liquidacion_ocasional_id: { in: cabeceras.map((c) => c.id) },
        origen: "auto",
        created_at: { gte: inicioVentanaAntirrebote() },
      },
      select: { liquidacion_ocasional_id: true },
      distinct: ["liquidacion_ocasional_id"],
    });
    const yaCapturadas = new Set(recientes.map((r) => r.liquidacion_ocasional_id));

    const results: Array<{
      id: string;
      ok: boolean;
      version?: number;
      omitido?: string;
      error?: string;
    }> = [];
    for (const c of cabeceras) {
      if (yaCapturadas.has(c.id)) {
        results.push({ id: c.id, ok: true, omitido: "captura auto reciente" });
        continue;
      }
      try {
        const snap = await this.capturar(c.id, { origen: "auto", usuarioId: null });
        results.push({
          id: c.id,
          ok: true,
          version: snap.version,
          omitido: snap.omitido ? "sin cambios" : undefined,
        });
      } catch (e: any) {
        results.push({ id: c.id, ok: false, error: e.message });
      }
    }
    return {
      total: cabeceras.length,
      capturadas: results.filter((r) => r.ok && !r.omitido).length,
      omitidas: results.filter((r) => r.omitido).length,
      results,
    };
  },
};
