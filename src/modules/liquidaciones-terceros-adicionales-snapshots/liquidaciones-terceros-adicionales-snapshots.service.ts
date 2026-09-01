/**
 * Snapshots por PERIODO de los adicionales de cierres finales.
 *
 * Espejo del módulo de snapshots del ocasional, con una diferencia de diseño
 * que condiciona todo: aquí no hay cabecera. Los adicionales de un mes
 * pertenecen a N cierres finales distintos, así que la identidad del snapshot
 * es `(anio, mes, version)` y el payload guarda cada fila con su `cierre_id`.
 *
 * Revertir = soft-delete de las filas vivas del periodo + re-insert desde el
 * payload, en una transacción. Los cierres en estado bloqueado se saltan: no
 * se puede tocar un cierre APROBADA/FACTURADA/ANULADA ni revirtiendo.
 */

import { prisma } from "../../config/prisma";
import {
  reservarVersionSnapshot,
  hashSnapshotPayload,
  inicioVentanaAntirrebote,
  type SnapshotTx,
} from "../../utils/snapshot-version";
import { randomUUID } from "crypto";
import { emitSheetReverted } from "../../sockets/sheet.gateway";

const ESTADOS_BLOQUEADOS = ["APROBADA", "FACTURADA", "ANULADA"];

export interface AdicionalPeriodoSnapshotPayload {
  periodo: { anio: number; mes: number };
  filas: Array<Record<string, any>>;
  totales: { filas: number; cierres: number; suma_valor_liquidar: number };
  meta: {
    capturado_en: string;
    capturado_por: string;
    version_origen: number;
  };
}

export interface DiffResult {
  fields: Array<{ path: string; anterior: any; nuevo: any }>;
}

function toNumber(v: any): number {
  if (v == null) return 0;
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function deepDiff(objA: any, objB: any, prefix = ""): DiffResult["fields"] {
  const changes: DiffResult["fields"] = [];
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

async function buildPayload(
  anio: number,
  mes: number,
): Promise<AdicionalPeriodoSnapshotPayload> {
  const cierres = await prisma.liquidacion_tercero_final.findMany({
    where: { anio, mes, deleted_at: null },
    orderBy: [{ consecutivo: "asc" }, { id: "asc" }],
    select: {
      id: true,
      consecutivo: true,
      estado: true,
      adicionales_filas: {
        where: { deleted_at: null },
        // `id` de desempate: `orden` se repite y `created_at` es idéntico
        // entre filas insertadas en el mismo `createMany`. Sin él, el orden
        // del array puede cambiar entre consultas y el payload deja de ser
        // comparable (diffs falsos, deduplicación que nunca acierta).
        orderBy: [{ orden: "asc" }, { created_at: "asc" }, { id: "asc" }],
      },
    },
  });

  const filas: Array<Record<string, any>> = [];
  for (const c of cierres) {
    for (const f of c.adicionales_filas) {
      filas.push({
        id: f.id,
        cierre_id: c.id,
        cierre_consecutivo: c.consecutivo,
        orden: f.orden,
        cliente: f.cliente,
        placa: f.placa,
        tercero_id: f.tercero_id,
        tercero_nombre: f.tercero_nombre,
        vehiculo_id: f.vehiculo_id,
        recorrido: f.recorrido,
        fechas: f.fechas,
        valor_unitario: toNumber(f.valor_unitario),
        cantidad: toNumber(f.cantidad),
        porcentaje_admin: toNumber(f.porcentaje_admin),
        valor_admin: toNumber(f.valor_admin),
        valor_liquidar: toNumber(f.valor_liquidar),
        aplica_impuestos: f.aplica_impuestos,
        version: f.version,
      });
    }
  }

  return {
    periodo: { anio, mes },
    filas,
    totales: {
      filas: filas.length,
      cierres: new Set(filas.map((f) => f.cierre_id)).size,
      suma_valor_liquidar: filas.reduce((s, f) => s + toNumber(f.valor_liquidar), 0),
    },
    meta: {
      capturado_en: new Date().toISOString(),
      capturado_por: "system",
      version_origen: 0,
    },
  };
}

/**
 * `true` una vez confirmado que la tabla de snapshots existe.
 *
 * El cron corre cada hora aunque la migración
 * `12-08-2026-adicionales-periodo-snapshots` no se haya ejecutado todavía.
 * Sin esta comprobación, cada ejecución lanza una consulta contra una tabla
 * inexistente por cada periodo con actividad, y el listener de errores de
 * Prisma escribe un `❌ Database Error` por cada una: tres o cuatro trazas de
 * error por hora que parecen un fallo de base de datos y no lo son.
 *
 * Solo se memoriza el `true`. Si la tabla no está, se vuelve a comprobar en
 * la siguiente ejecución, de modo que basta con correr la migración para que
 * el cron empiece a funcionar sin reiniciar el proceso.
 */
let tablaSnapshotsConfirmada = false;

async function existeTablaSnapshots(): Promise<boolean> {
  if (tablaSnapshotsConfirmada) return true;
  // `to_regclass` devuelve NULL si la tabla no existe, sin lanzar. Es la
  // forma de preguntarlo SIN provocar el error que se quiere evitar.
  const filas = await prisma.$queryRaw<Array<{ existe: boolean }>>`
    SELECT to_regclass('public.liquidacion_tercero_adicional_periodo_snapshot') IS NOT NULL AS existe
  `;
  const existe = filas?.[0]?.existe === true;
  if (existe) tablaSnapshotsConfirmada = true;
  return existe;
}

async function ultimaVersion(
  tx: SnapshotTx,
  anio: number,
  mes: number,
): Promise<number | null> {
  const last = await tx.liquidacion_tercero_adicional_periodo_snapshot.findFirst({
    where: { anio, mes },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  return last?.version ?? null;
}

export const LiquidacionesTercerosAdicionalesSnapshotsService = {
  async capturar(
    anio: number,
    mes: number,
    opts: {
      origen: "manual" | "auto" | "revert";
      usuarioId?: string | null;
      revertidoDeId?: string | null;
    },
  ) {
    // Fuera del lock: construir el payload son decenas de queries.
    const payload = await buildPayload(anio, mes);
    payload.meta.capturado_por = opts.usuarioId || "cron";

    let diff: DiffResult["fields"] | null = null;

    // Versión leída e insertada bajo el mismo advisory lock; el MAX() suelto
    // de antes hacía que dos capturas simultáneas del periodo chocaran contra
    // el unique (anio, mes, version).
    const { snapshot, omitido } = await reservarVersionSnapshot({
      scope: `snapshot:adicionales:${anio}-${mes}`,
      ultimaVersion: (tx) => ultimaVersion(tx, anio, mes),
      insertar: async (tx, version) => {
        const prev = await tx.liquidacion_tercero_adicional_periodo_snapshot.findFirst({
          where: { anio, mes },
          orderBy: { version: "desc" },
        });

        // Sin cambios no se inserta. El filtro de "periodos con actividad en
        // 24 h" acota qué periodos se miran, pero dentro de esa ventana el
        // cron seguía escribiendo un snapshot idéntico cada hora.
        if (
          opts.origen === "auto" &&
          prev &&
          hashSnapshotPayload(prev.payload) === hashSnapshotPayload(payload)
        ) {
          return { snapshot: prev, omitido: true };
        }

        payload.meta.version_origen = version;
        if (opts.origen !== "auto" && prev) diff = deepDiff(prev.payload, payload);

        const creado = await tx.liquidacion_tercero_adicional_periodo_snapshot.create({
          data: {
            anio,
            mes,
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

  async listar(anio: number, mes: number) {
    const snapshots = await prisma.liquidacion_tercero_adicional_periodo_snapshot.findMany({
      where: { anio, mes },
      orderBy: { version: "desc" },
      include: { usuario: { select: { id: true, nombre: true, correo: true } } },
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
      totales: (s.payload as any)?.totales ?? null,
    }));
  },

  async obtener(snapshotId: string) {
    const snapshot = await prisma.liquidacion_tercero_adicional_periodo_snapshot.findUnique({
      where: { id: snapshotId },
      include: { usuario: { select: { id: true, nombre: true, correo: true } } },
    });
    if (!snapshot) throw new Error("Snapshot no encontrado");
    return snapshot;
  },

  /** Diff contra otro snapshot, o contra el inmediatamente anterior. */
  async diff(snapshotId: string, contraId?: string): Promise<DiffResult> {
    const base = await prisma.liquidacion_tercero_adicional_periodo_snapshot.findUnique({
      where: { id: snapshotId },
    });
    if (!base) throw new Error("Snapshot no encontrado");

    const otro = contraId
      ? await prisma.liquidacion_tercero_adicional_periodo_snapshot.findUnique({
          where: { id: contraId },
        })
      : await prisma.liquidacion_tercero_adicional_periodo_snapshot.findFirst({
          where: { anio: base.anio, mes: base.mes, version: { lt: base.version } },
          orderBy: { version: "desc" },
        });

    if (!otro) return { fields: [] };
    return { fields: deepDiff(otro.payload, base.payload) };
  },

  /**
   * Restaura el periodo al estado de un snapshot.
   *
   * Se salta los cierres en estado bloqueado: revertir no puede ser una vía
   * indirecta para modificar un cierre APROBADA o FACTURADA.
   */
  async revertir(snapshotId: string, usuarioId: string) {
    const snapshot = await prisma.liquidacion_tercero_adicional_periodo_snapshot.findUnique({
      where: { id: snapshotId },
    });
    if (!snapshot) throw new Error("Snapshot no encontrado");

    const { anio, mes } = snapshot;
    const payload = snapshot.payload as unknown as AdicionalPeriodoSnapshotPayload;

    const cierres = await prisma.liquidacion_tercero_final.findMany({
      where: { anio, mes, deleted_at: null },
      select: { id: true, estado: true, consecutivo: true, placa: true, tercero_id: true },
    });
    const editables = new Map(
      cierres.filter((c) => !ESTADOS_BLOQUEADOS.includes(c.estado)).map((c) => [c.id, c]),
    );
    const bloqueados = cierres.filter((c) => ESTADOS_BLOQUEADOS.includes(c.estado));

    const filasARestaurar = (payload.filas || []).filter((f) => editables.has(f.cierre_id));
    const cierresAfectados = Array.from(new Set(filasARestaurar.map((f) => f.cierre_id)));
    // Los cierres editables SIN filas en el snapshot también hay que vaciarlos:
    // si en el snapshot no tenían adicionales, restaurar significa quitarlos.
    const cierresAVaciar = Array.from(editables.keys());

    await prisma.$transaction(async (tx) => {
      await tx.liquidacion_tercero_final_adicional.updateMany({
        where: {
          liquidacion_tercero_final_id: { in: cierresAVaciar },
          deleted_at: null,
        },
        data: { deleted_at: new Date(), actualizado_por_id: usuarioId },
      });

      if (filasARestaurar.length > 0) {
        await tx.liquidacion_tercero_final_adicional.createMany({
          data: filasARestaurar.map((f) => ({
            id: f.id || randomUUID(),
            liquidacion_tercero_final_id: f.cierre_id,
            orden: f.orden ?? 0,
            cliente: f.cliente ?? "TRANSMERALDA",
            placa: f.placa ?? editables.get(f.cierre_id)?.placa ?? "",
            tercero_id: f.tercero_id ?? null,
            tercero_nombre: f.tercero_nombre ?? null,
            vehiculo_id: f.vehiculo_id ?? null,
            recorrido: f.recorrido ?? null,
            fechas: f.fechas ?? null,
            valor_unitario: f.valor_unitario ?? 0,
            cantidad: f.cantidad ?? 1,
            porcentaje_admin: f.porcentaje_admin ?? 0,
            valor_admin: f.valor_admin ?? 0,
            valor_liquidar: f.valor_liquidar ?? 0,
            aplica_impuestos: f.aplica_impuestos !== false,
            // La versión arranca de nuevo: las filas restauradas son
            // materialmente otras, y arrastrar la versión vieja haría que un
            // patch en vuelo con esa `base_version` acertara por casualidad.
            version: 1,
            creado_por_id: usuarioId,
            actualizado_por_id: usuarioId,
          })),
          skipDuplicates: true,
        });
      }

      // Recalcular totales de cada cierre tocado.
      for (const cierreId of cierresAVaciar) {
        const [agg, itemsPivote, cierre] = await Promise.all([
          tx.liquidacion_tercero_final_adicional.aggregate({
            where: { liquidacion_tercero_final_id: cierreId, deleted_at: null },
            _sum: { valor_liquidar: true },
          }),
          tx.liquidacion_tercero_final_item.findMany({
            where: { liquidacion_tercero_final_id: cierreId, deleted_at: null },
            select: { liquidacion_tercero: { select: { valor_liquidar: true } } },
          }),
          tx.liquidacion_tercero_final.findUnique({
            where: { id: cierreId },
            select: { total_descuentos: true },
          }),
        ]);
        const sumaItems = itemsPivote.reduce(
          (s, it) => s + toNumber(it.liquidacion_tercero?.valor_liquidar),
          0,
        );
        const valorLiquidar = sumaItems + toNumber(agg._sum.valor_liquidar);
        await tx.liquidacion_tercero_final.update({
          where: { id: cierreId },
          data: {
            valor_liquidar: valorLiquidar,
            total_pagar: valorLiquidar - toNumber(cierre?.total_descuentos),
            actualizado_por_id: usuarioId,
            updated_at: new Date(),
          },
        });
      }
    });

    const revertSnapshot = await this.capturar(anio, mes, {
      origen: "revert",
      usuarioId,
      revertidoDeId: snapshotId,
    });

    // Broadcast a TODO el room (emisor incluido): una reversión cambia la
    // geometría de la hoja. Además sube el `epoch`, lo que invalida los
    // patches en vuelo con el epoch anterior.
    const usuario = await prisma.usuarios.findUnique({
      where: { id: usuarioId },
      select: { nombre: true },
    });
    emitSheetReverted({
      scope: "adicionales",
      anio,
      mes,
      version: revertSnapshot.version,
      by: { id: usuarioId, name: usuario?.nombre || "Usuario" },
    });

    return {
      ...revertSnapshot,
      restauradas: filasARestaurar.length,
      cierres_afectados: cierresAfectados.length,
      cierres_omitidos: bloqueados.map((c) => ({
        id: c.id,
        consecutivo: c.consecutivo,
        estado: c.estado,
      })),
    };
  },

  /** Captura horaria de los periodos con actividad reciente. Lo llama el cron. */
  async capturarHorario() {
    // La captura automática se salta entera si la tabla no está: es un cron,
    // nadie está esperando su resultado, y fallar en silencio con un aviso
    // claro es mejor que ensuciar el log cada hora.
    if (!(await existeTablaSnapshots())) {
      return {
        total: 0,
        capturados: 0,
        omitidos: 0,
        results: [] as Array<{
          periodo: string;
          ok: boolean;
          version?: number;
          omitido?: string;
          error?: string;
        }>,
        omitido:
          'Falta ejecutar la migración 12-08-2026-adicionales-periodo-snapshots',
      };
    }

    const desde = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recientes = await prisma.liquidacion_tercero_final_adicional.findMany({
      where: { deleted_at: null, updated_at: { gte: desde } },
      select: { cierre: { select: { anio: true, mes: true } } },
      distinct: ["liquidacion_tercero_final_id"],
    });

    const periodos = new Set<string>();
    for (const r of recientes) {
      if (r.cierre) periodos.add(`${r.cierre.anio}-${r.cierre.mes}`);
    }

    // Antirrebote del doble disparo: el job corre in-process en cada
    // instancia y además está expuesto como endpoint de cron, así que a la
    // misma hora puede entrar más de una vez.
    const capturasRecientes =
      await prisma.liquidacion_tercero_adicional_periodo_snapshot.findMany({
        where: { origen: "auto", created_at: { gte: inicioVentanaAntirrebote() } },
        select: { anio: true, mes: true },
      });
    const yaCapturados = new Set(capturasRecientes.map((s) => `${s.anio}-${s.mes}`));

    const results: Array<{
      periodo: string;
      ok: boolean;
      version?: number;
      omitido?: string;
      error?: string;
    }> = [];
    for (const p of periodos) {
      if (yaCapturados.has(p)) {
        results.push({ periodo: p, ok: true, omitido: "captura auto reciente" });
        continue;
      }
      const [anio, mes] = p.split("-").map(Number);
      try {
        const snap = await this.capturar(anio, mes, { origen: "auto", usuarioId: null });
        results.push({
          periodo: p,
          ok: true,
          version: snap.version,
          omitido: snap.omitido ? "sin cambios" : undefined,
        });
      } catch (e: any) {
        results.push({ periodo: p, ok: false, error: e.message });
      }
    }
    return {
      total: periodos.size,
      capturados: results.filter((r) => r.ok && !r.omitido).length,
      omitidos: results.filter((r) => r.omitido).length,
      results,
      // Misma forma que el retorno temprano de arriba, para que el job pueda
      // preguntar por `omitido` sin pelearse con la unión de tipos.
      omitido: undefined as string | undefined,
    };
  },
};
