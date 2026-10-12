// @ts-nocheck
import { prisma } from "../../config/prisma";
import {
  reservarVersionSnapshot,
  hashSnapshotPayload,
  inicioVentanaAntirrebote,
} from "../../utils/snapshot-version";
import { randomUUID } from "crypto";
import { ESTADOS_BLOQUEADOS } from "../liquidaciones-terceros-descuentos/cierre-estado.service";

/**
 * Error de `revertir` con su código HTTP. El controlador respondía 400 a todo,
 * también a «no encontrado» y a los conflictos de estado.
 */
export class ErrorRevertirSnapshot extends Error {
  constructor(message: string, readonly statusCode: 404 | 409) {
    super(message);
  }
}

// ═══════════════════════════════════════════════════════════════
// TIPOS
// ═══════════════════════════════════════════════════════════════

export interface SnapshotPayload {
  cabecera: Record<string, any>;
  totales: Record<string, any>;
  estado: string;
  motivo_anulacion: string | null;
  adicionales: any[];
  items_pivote: Array<{
    liquidacion_tercero_id: string;
    orden: number;
  }>;
  conceptos: Array<{
    tipo: string;
    concepto: string;
    conductor_id: string | null;
    dias: number | null;
    valor_unitario: number;
    porcentaje: number | null;
    valor_total: number;
    base_calculo: number | null;
    calculado: boolean;
    observaciones: string | null;
    orden: number;
  }>;
  meta: {
    capturado_en: string;
    capturado_por: string;
    version_origen: number;
    items_pivote_count: number;
    conceptos_count: number;
  };
  /**
   * Preferencias visuales del cierre. No son datos de negocio: viajan aquí
   * para que un revert devuelva la hoja tal y como estaba, color incluido.
   *
   * ⚠️ Al añadir esta clave, el PRIMER snapshot que se capture tras el
   * despliegue mostrará `ui` como campo nuevo en su diff contra el anterior.
   * Es ruido de una sola vez, no un cambio real de la liquidación.
   */
  ui?: {
    /** `null` = la pestaña usa el color automático del estado. */
    color_hoja: string | null;
  };
}

export interface DiffResult {
  fields: Array<{
    path: string;
    anterior: any;
    nuevo: any;
  }>;
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function toNumber(v: any): number {
  return typeof v === 'object' && v !== null ? Number(v) : Number(v) || 0;
}

function deepDiff(objA: any, objB: any, prefix = ''): DiffResult['fields'] {
  const changes: DiffResult['fields'] = [];
  const allKeys = new Set([...Object.keys(objA || {}), ...Object.keys(objB || {})]);

  for (const key of allKeys) {
    const path = prefix ? `${prefix}.${key}` : key;
    const valA = objA?.[key];
    const valB = objB?.[key];

    if (typeof valA === 'object' && valA !== null && typeof valB === 'object' && valB !== null && !Array.isArray(valA) && !Array.isArray(valB)) {
      changes.push(...deepDiff(valA, valB, path));
    } else if (JSON.stringify(valA) !== JSON.stringify(valB)) {
      changes.push({ path, anterior: valA, nuevo: valB });
    }
  }

  return changes;
}

async function buildPayload(cierre: any): Promise<SnapshotPayload> {
  const items = await prisma.liquidacion_tercero_final_item.findMany({
    where: { liquidacion_tercero_final_id: cierre.id, deleted_at: null },
    select: { liquidacion_tercero_id: true, orden: true },
    // Desempate explícito: `orden` se repite y sin él Postgres puede devolver
    // las filas en distinto orden entre consultas, con lo que dos payloads
    // idénticos parecen distintos (diffs falsos y deduplicación que no acierta).
    orderBy: [{ orden: 'asc' }, { liquidacion_tercero_id: 'asc' }],
  });

  const conceptos = await prisma.liquidacion_tercero_final_concepto.findMany({
    where: { liquidacion_tercero_final_id: cierre.id, deleted_at: null },
    select: {
      tipo: true, concepto: true, conductor_id: true, dias: true,
      valor_unitario: true, porcentaje: true, valor_total: true,
      base_calculo: true, calculado: true, observaciones: true, orden: true,
    },
    orderBy: [{ orden: 'asc' }, { concepto: 'asc' }, { id: 'asc' }],
  });

  const adicionales = Array.isArray(cierre.adicionales) ? cierre.adicionales : [];

  return {
    cabecera: {
      id: cierre.id,
      consecutivo: cierre.consecutivo,
      placa: cierre.placa,
      mes: cierre.mes,
      anio: cierre.anio,
      tercero_id: cierre.tercero_id,
      vehiculo_id: cierre.vehiculo_id,
      liquidacion_servicio_id: cierre.liquidacion_servicio_id,
      created_at: cierre.created_at,
      updated_at: cierre.updated_at,
    },
    totales: {
      valor_liquidar: toNumber(cierre.valor_liquidar),
      total_costos_laborales: toNumber(cierre.total_costos_laborales),
      total_gastos_operativos: toNumber(cierre.total_gastos_operativos),
      total_impuestos: toNumber(cierre.total_impuestos),
      total_descuentos: toNumber(cierre.total_descuentos),
      total_pagar: toNumber(cierre.total_pagar),
    },
    estado: cierre.estado || 'BORRADOR',
    motivo_anulacion: cierre.motivo_anulacion || null,
    adicionales,
    items_pivote: items.map((i: any) => ({
      liquidacion_tercero_id: i.liquidacion_tercero_id,
      orden: i.orden,
    })),
    conceptos: conceptos.map((c: any) => ({
      tipo: c.tipo,
      concepto: c.concepto,
      conductor_id: c.conductor_id,
      dias: c.dias ? toNumber(c.dias) : null,
      valor_unitario: toNumber(c.valor_unitario),
      porcentaje: c.porcentaje ? toNumber(c.porcentaje) : null,
      valor_total: toNumber(c.valor_total),
      base_calculo: c.base_calculo ? toNumber(c.base_calculo) : null,
      calculado: c.calculado,
      observaciones: c.observaciones,
      orden: c.orden,
    })),
    ui: {
      color_hoja: cierre.color_hoja ?? null,
    },
    meta: {
      capturado_en: new Date().toISOString(),
      capturado_por: 'system',
      version_origen: 0,
      items_pivote_count: items.length,
      conceptos_count: conceptos.length,
    },
  };
}

async function ultimaVersion(tx: any, liquidacionId: string): Promise<number | null> {
  const last = await tx.liquidacion_tercero_final_snapshot.findFirst({
    where: { liquidacion_tercero_final_id: liquidacionId },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  return last?.version ?? null;
}

// ═══════════════════════════════════════════════════════════════
// SERVICIO
// ═══════════════════════════════════════════════════════════════

export const LiquidacionesSnapshotsService = {

  /**
   * Captura un snapshot inmutable del estado actual del cierre.
   */
  async capturar(liquidacionId: string, opts: {
    /**
     * `refresh-items` ya se venía escribiendo desde `refreshItems` del
     * service de descuentos; faltaba en la unión porque aquel archivo tenía
     * `@ts-nocheck`. La columna es VARCHAR(20), así que el dato es válido.
     *
     * `items-manuales` es su hermano: mismo efecto sobre el pivote, pero con
     * los items que ELIGIÓ el usuario en «Traer items» en vez de los que
     * salen del filtro de periodo. Se distinguen para que el historial diga
     * cuál de los dos caminos movió el cierre.
     */
    origen:
      | 'manual'
      | 'auto'
      | 'revert'
      | 'refresh-items'
      | 'items-manuales'
      /// Traslado de un item del pivote a ocasional/ingresos y su vuelta.
      | 'trasladar-item'
      | 'revertir-traslado';
    usuarioId?: string | null;
    revertidoDeId?: string | null;
  }) {
    const cierre = await prisma.liquidacion_tercero_final.findUnique({
      where: { id: liquidacionId },
    });
    if (!cierre) throw new Error('Cierre no encontrado');

    // El payload va FUERA del lock: son decenas de queries y dentro
    // bloquearían al resto de capturas de este cierre.
    const payload = await buildPayload(cierre);
    payload.meta.capturado_por = opts.usuarioId || 'cron';

    let diff: DiffResult['fields'] | null = null;

    // Leer la versión e insertar bajo el mismo advisory lock. Con el MAX()
    // suelto de antes, dos capturas simultáneas del mismo cierre calculaban
    // la misma versión y la segunda moría contra el unique
    // (liquidacion_tercero_final_id, version).
    const { snapshot, omitido } = await reservarVersionSnapshot({
      scope: `snapshot:final:${liquidacionId}`,
      ultimaVersion: (tx) => ultimaVersion(tx, liquidacionId),
      insertar: async (tx, version) => {
        const prev = await tx.liquidacion_tercero_final_snapshot.findFirst({
          where: { liquidacion_tercero_final_id: liquidacionId },
          orderBy: { version: 'desc' },
        });

        // El cron capturaba hubiera cambios o no; de ahí versiones como la
        // 1042 repitiendo el payload entero. Si el contenido es idéntico al
        // último snapshot, la captura `auto` no inserta: la versión anterior
        // YA describe este estado. Manual y revert se guardan siempre.
        if (
          opts.origen === 'auto' &&
          prev &&
          hashSnapshotPayload(prev.payload) === hashSnapshotPayload(payload)
        ) {
          return { snapshot: prev, omitido: true };
        }

        payload.meta.version_origen = version;

        // Calcular diff contra el snapshot anterior (si existe)
        if (opts.origen !== 'auto' && prev) {
          diff = deepDiff(prev.payload, payload);
        }

        const creado = await tx.liquidacion_tercero_final_snapshot.create({
          data: {
            liquidacion_tercero_final_id: liquidacionId,
            version,
            origen: opts.origen,
            revertido_de_id: opts.revertidoDeId || null,
            usuario_id: opts.usuarioId || null,
            payload: payload as any,
            diff: diff ? (diff as any) : null,
          },
        });
        return { snapshot: creado, omitido: false };
      },
    });

    return { ...snapshot, payload, diff, omitido };
  },

  /**
   * Lista snapshots de un cierre.
   */
  async listar(liquidacionId: string, opts?: { rama?: string }) {
    const where: any = { liquidacion_tercero_final_id: liquidacionId };
    if (opts?.rama) where.rama = opts.rama;

    const snapshots = await prisma.liquidacion_tercero_final_snapshot.findMany({
      where,
      orderBy: { version: 'asc' },
      include: {
        usuario: {
          select: { id: true, nombre: true, correo: true },
        },
      },
    });

    return snapshots.map((s: any) => ({
      id: s.id,
      version: s.version,
      rama: s.rama,
      origen: s.origen,
      revertido_de_id: s.revertido_de_id,
      usuario: s.usuario,
      created_at: s.created_at,
      diff: s.diff,
      meta: s.payload?.meta || null,
    }));
  },

  /**
   * Obtiene un snapshot específico con payload completo.
   */
  async obtener(liquidacionId: string, snapshotId: string) {
    const snapshot = await prisma.liquidacion_tercero_final_snapshot.findFirst({
      where: { id: snapshotId, liquidacion_tercero_final_id: liquidacionId },
      include: {
        usuario: {
          select: { id: true, nombre: true, correo: true },
        },
      },
    });
    if (!snapshot) throw new Error('Snapshot no encontrado');
    return snapshot;
  },

  /**
   * Compara dos snapshots campo a campo.
   */
  async diff(snapshotIdA: string, snapshotIdB: string): Promise<DiffResult> {
    const [a, b] = await Promise.all([
      prisma.liquidacion_tercero_final_snapshot.findUnique({ where: { id: snapshotIdA } }),
      prisma.liquidacion_tercero_final_snapshot.findUnique({ where: { id: snapshotIdB } }),
    ]);
    if (!a) throw new Error('Snapshot A no encontrado');
    if (!b) throw new Error('Snapshot B no encontrado');

    const fields = deepDiff(a.payload, b.payload);
    return { fields };
  },

  /**
   * Revierte el cierre a un snapshot anterior: importes, adicionales, items
   * del pivote, conceptos y color. Crea un nuevo snapshot con origen="revert".
   *
   * **El estado NO se restaura.** Hasta oct-2026 se copiaba `payload.estado`
   * tal cual, sin pasar por la máquina de `cierre-estado.service.ts` ni por
   * sus reglas de área: con nivel `limited` un ANULADA volvía a BORRADOR y un
   * LIQUIDADA a APROBADA (el snapshot era de cuando estaba aprobado). El
   * estado se cambia por su ruta, que valida transición, área y motivo.
   *
   * Y solo se revierte un cierre editable: los `ESTADOS_BLOQUEADOS` de esa
   * máquina (APROBADA, PAGADA, FACTURADA, ANULADA, REEMPLAZADA) son los que
   * el canvas deja en solo lectura, y revertir es editar. Antes ANULADA y
   * REEMPLAZADA se colaban.
   */
  async revertir(liquidacionId: string, snapshotId: string, usuarioId: string) {
    const snapshot = await prisma.liquidacion_tercero_final_snapshot.findFirst({
      where: { id: snapshotId, liquidacion_tercero_final_id: liquidacionId },
    });
    if (!snapshot) throw new ErrorRevertirSnapshot('Snapshot no encontrado', 404);

    /// Un cierre en la papelera no se revierte: los datos volverían a una
    /// cabecera que nadie ve.
    const cierre = await prisma.liquidacion_tercero_final.findFirst({
      where: { id: liquidacionId, deleted_at: null },
    });
    if (!cierre) throw new ErrorRevertirSnapshot('Cierre no encontrado', 404);

    const payload = snapshot.payload as SnapshotPayload;

    const estadoActual = cierre.estado || 'BORRADOR';
    if (ESTADOS_BLOQUEADOS.includes(estadoActual)) {
      throw new ErrorRevertirSnapshot(
        `No se puede revertir un cierre ${estadoActual}: solo se revierten cierres en BORRADOR o LIQUIDADA. ` +
          'Cambia primero su estado desde la hoja, si la transición lo permite.',
        409,
      );
    }

    // Items del snapshot que hoy están TRASLADADOS fuera del cierre: no se
    // restauran. Su fila marcada lleva `trasladado_a`, que es lo que permite
    // devolverlos, y reinsertarlos los pagaría aquí y en su destino.
    const trasladados = new Set(
      (
        await prisma.liquidacion_tercero_final_item.findMany({
          where: { liquidacion_tercero_final_id: liquidacionId, trasladado_a: { not: null } },
          select: { liquidacion_tercero_id: true },
        })
      ).map((t) => t.liquidacion_tercero_id),
    );
    const itemsARestaurar = (payload.items_pivote ?? []).filter(
      (item: any) => !trasladados.has(item.liquidacion_tercero_id),
    );
    const omitidos = (payload.items_pivote ?? []).length - itemsARestaurar.length;
    if (omitidos > 0) {
      console.warn(
        `[snapshots] revert ${liquidacionId}: ${omitidos} item(s) del snapshot omitidos por estar trasladados`,
      );
    }

    // Restaurar los datos del cierre (no su estado: ver arriba)
    await prisma.$transaction(async (tx) => {
      // 0. Cabecera primero y con compare-and-swap sobre el estado leído: si
      //    otro usuario lo aprobó o anuló entretanto, no se reescribe un
      //    cierre que ya no es editable (y se deshace todo lo demás).
      const gano = await tx.liquidacion_tercero_final.updateMany({
        where: { id: liquidacionId, deleted_at: null, estado: cierre.estado },
        data: {
          valor_liquidar: payload.totales.valor_liquidar,
          total_costos_laborales: payload.totales.total_costos_laborales,
          total_gastos_operativos: payload.totales.total_gastos_operativos,
          total_impuestos: payload.totales.total_impuestos,
          total_descuentos: payload.totales.total_descuentos,
          total_pagar: payload.totales.total_pagar,
          adicionales: payload.adicionales as any,
          // Los snapshots anteriores a esta versión no llevan `ui`; en esos
          // casos se deja el color actual en vez de borrarlo, que sería
          // perder una preferencia por revertir a una versión antigua.
          ...(payload.ui ? { color_hoja: payload.ui.color_hoja } : {}),
          actualizado_por_id: usuarioId,
        },
      });
      if (gano.count === 0) {
        throw new ErrorRevertirSnapshot(
          'Otro usuario cambió el estado del cierre mientras tanto. Recarga y vuelve a intentarlo.',
          409,
        );
      }
      // 1. Borrar de verdad las filas de los items que vuelven, vivas o
      //    marcadas: el único `(cierre, item)` cuenta también las marcadas, y
      //    marcar + reinsertar la misma clave revienta con P2002.
      await tx.liquidacion_tercero_final_item.deleteMany({
        where: {
          liquidacion_tercero_final_id: liquidacionId,
          liquidacion_tercero_id: {
            in: itemsARestaurar.map((item: any) => item.liquidacion_tercero_id),
          },
        },
      });
      // 2. Limpiar items pivote actuales
      await tx.liquidacion_tercero_final_item.updateMany({
        where: { liquidacion_tercero_final_id: liquidacionId, deleted_at: null },
        data: { deleted_at: new Date() },
      });
      // 3. Limpiar conceptos actuales
      await tx.liquidacion_tercero_final_concepto.updateMany({
        where: { liquidacion_tercero_final_id: liquidacionId, deleted_at: null },
        data: { deleted_at: new Date() },
      });
      // 4. Restaurar items pivote
      await tx.liquidacion_tercero_final_item.createMany({
        data: itemsARestaurar.map((item: any, idx: number) => ({
          liquidacion_tercero_final_id: liquidacionId,
          liquidacion_tercero_id: item.liquidacion_tercero_id,
          orden: item.orden ?? idx,
        })),
      });
      // 5. Restaurar conceptos
      await tx.liquidacion_tercero_final_concepto.createMany({
        data: payload.conceptos.map((c: any) => ({
          id: randomUUID(),
          liquidacion_tercero_final_id: liquidacionId,
          tipo: c.tipo,
          concepto: c.concepto,
          conductor_id: c.conductor_id,
          dias: c.dias,
          valor_unitario: c.valor_unitario,
          porcentaje: c.porcentaje,
          valor_total: c.valor_total,
          base_calculo: c.base_calculo,
          calculado: c.calculado,
          observaciones: c.observaciones,
          orden: c.orden,
        })),
      });
    });

    // 6. Crear snapshot de la reversión
    const revert = await this.capturar(liquidacionId, {
      origen: 'revert',
      usuarioId: usuarioId,
      revertidoDeId: snapshotId,
    });
    /// Para que la pantalla pueda avisar si la versión restaurada era de otro
    /// estado: los datos volvieron, el estado se quedó como estaba.
    return {
      ...revert,
      estado_conservado: estadoActual,
      estado_del_snapshot: payload.estado ?? null,
    };
  },

  /**
   * Snapshots horarios de TODAS las liquidaciones activas.
   */
  async capturarHorario(): Promise<{ ok: number; omitidos: number; errors: number }> {
    const cierres = await prisma.liquidacion_tercero_final.findMany({
      where: {
        deleted_at: null,
        estado: { not: 'ANULADA' },
      },
      select: { id: true },
    });

    // Antirrebote del doble disparo: el job corre in-process en cada
    // instancia y además está expuesto como endpoint de cron, así que a la
    // misma hora puede entrar más de una vez. Los cierres con captura `auto`
    // reciente se saltan ANTES de construir el payload, que es lo caro. Una
    // sola query para los 58 cierres, no una por cierre.
    const recientes = await prisma.liquidacion_tercero_final_snapshot.findMany({
      where: {
        liquidacion_tercero_final_id: { in: cierres.map((c) => c.id) },
        origen: 'auto',
        created_at: { gte: inicioVentanaAntirrebote() },
      },
      select: { liquidacion_tercero_final_id: true },
      distinct: ['liquidacion_tercero_final_id'],
    });
    const yaCapturados = new Set(recientes.map((r) => r.liquidacion_tercero_final_id));

    let ok = 0;
    let omitidos = 0;
    let errors = 0;

    for (const cierre of cierres) {
      if (yaCapturados.has(cierre.id)) {
        omitidos++;
        continue;
      }
      try {
        const snap = await this.capturar(cierre.id, { origen: 'auto' });
        if (snap.omitido) omitidos++;
        else ok++;
      } catch (e) {
        errors++;
        console.error(`[snapshot-job] Error capturando ${cierre.id}:`, e);
      }
    }

    return { ok, omitidos, errors };
  },
};
