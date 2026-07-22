// @ts-nocheck
import { prisma } from "../../config/prisma";
import { randomUUID } from "crypto";

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
    orderBy: { orden: 'asc' },
  });

  const conceptos = await prisma.liquidacion_tercero_final_concepto.findMany({
    where: { liquidacion_tercero_final_id: cierre.id, deleted_at: null },
    select: {
      tipo: true, concepto: true, conductor_id: true, dias: true,
      valor_unitario: true, porcentaje: true, valor_total: true,
      base_calculo: true, calculado: true, observaciones: true, orden: true,
    },
    orderBy: [{ orden: 'asc' }, { concepto: 'asc' }],
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
    meta: {
      capturado_en: new Date().toISOString(),
      capturado_por: 'system',
      version_origen: 0,
      items_pivote_count: items.length,
      conceptos_count: conceptos.length,
    },
  };
}

async function getNextVersion(liquidacionId: string): Promise<number> {
  const last = await prisma.liquidacion_tercero_final_snapshot.findFirst({
    where: { liquidacion_tercero_final_id: liquidacionId },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  return last ? last.version + 1 : 1;
}

// ═══════════════════════════════════════════════════════════════
// SERVICIO
// ═══════════════════════════════════════════════════════════════

export const LiquidacionesSnapshotsService = {

  /**
   * Captura un snapshot inmutable del estado actual del cierre.
   */
  async capturar(liquidacionId: string, opts: {
    origen: 'manual' | 'auto' | 'revert';
    usuarioId?: string | null;
    revertidoDeId?: string | null;
  }) {
    const cierre = await prisma.liquidacion_tercero_final.findUnique({
      where: { id: liquidacionId },
    });
    if (!cierre) throw new Error('Cierre no encontrado');

    const version = await getNextVersion(liquidacionId);
    const payload = await buildPayload(cierre);
    payload.meta.capturado_por = opts.usuarioId || 'cron';
    payload.meta.version_origen = version;

    // Calcular diff contra el snapshot anterior (si existe)
    let diff: DiffResult['fields'] | null = null;
    if (opts.origen !== 'auto') {
      const prev = await prisma.liquidacion_tercero_final_snapshot.findFirst({
        where: { liquidacion_tercero_final_id: liquidacionId },
        orderBy: { version: 'desc' },
        select: { payload: true },
      });
      if (prev) {
        diff = deepDiff(prev.payload, payload);
      }
    }

    const snapshot = await prisma.liquidacion_tercero_final_snapshot.create({
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

    return { ...snapshot, payload, diff };
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
   * Revierte el cierre a un snapshot anterior.
   * Crea un nuevo snapshot con origen="revert" que contiene el estado restaurado.
   */
  async revertir(liquidacionId: string, snapshotId: string, usuarioId: string) {
    const snapshot = await prisma.liquidacion_tercero_final_snapshot.findFirst({
      where: { id: snapshotId, liquidacion_tercero_final_id: liquidacionId },
    });
    if (!snapshot) throw new Error('Snapshot no encontrado');

    const cierre = await prisma.liquidacion_tercero_final.findUnique({
      where: { id: liquidacionId },
    });
    if (!cierre) throw new Error('Cierre no encontrado');

    const payload = snapshot.payload as SnapshotPayload;

    // Verificar que no se revierta un cierre APROBADA o FACTURADA
    if (['APROBADA', 'FACTURADA'].includes(cierre.estado || '')) {
      throw new Error('No se puede revertir una liquidación APROBADA o FACTURADA. Anúlala primero.');
    }

    // Restaurar el cierre al estado del snapshot
    await prisma.$transaction([
      // 1. Limpiar items pivote actuales
      prisma.liquidacion_tercero_final_item.updateMany({
        where: { liquidacion_tercero_final_id: liquidacionId, deleted_at: null },
        data: { deleted_at: new Date() },
      }),
      // 2. Limpiar conceptos actuales
      prisma.liquidacion_tercero_final_concepto.updateMany({
        where: { liquidacion_tercero_final_id: liquidacionId, deleted_at: null },
        data: { deleted_at: new Date() },
      }),
      // 3. Restaurar cabecera
      prisma.liquidacion_tercero_final.update({
        where: { id: liquidacionId },
        data: {
          valor_liquidar: payload.totales.valor_liquidar,
          total_costos_laborales: payload.totales.total_costos_laborales,
          total_gastos_operativos: payload.totales.total_gastos_operativos,
          total_impuestos: payload.totales.total_impuestos,
          total_descuentos: payload.totales.total_descuentos,
          total_pagar: payload.totales.total_pagar,
          estado: payload.estado,
          motivo_anulacion: payload.motivo_anulacion,
          adicionales: payload.adicionales as any,
          actualizado_por_id: usuarioId,
        },
      }),
      // 4. Restaurar items pivote
      prisma.liquidacion_tercero_final_item.createMany({
        data: payload.items_pivote.map((item: any, idx: number) => ({
          liquidacion_tercero_final_id: liquidacionId,
          liquidacion_tercero_id: item.liquidacion_tercero_id,
          orden: item.orden ?? idx,
        })),
      }),
      // 5. Restaurar conceptos
      prisma.liquidacion_tercero_final_concepto.createMany({
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
      }),
    ]);

    // 6. Crear snapshot de la reversión
    return this.capturar(liquidacionId, {
      origen: 'revert',
      usuarioId: usuarioId,
      revertidoDeId: snapshotId,
    });
  },

  /**
   * Snapshots horarios de TODAS las liquidaciones activas.
   */
  async capturarHorario(): Promise<{ ok: number; errors: number }> {
    const cierres = await prisma.liquidacion_tercero_final.findMany({
      where: {
        deleted_at: null,
        estado: { not: 'ANULADA' },
      },
      select: { id: true },
    });

    let ok = 0;
    let errors = 0;

    for (const cierre of cierres) {
      try {
        await this.capturar(cierre.id, { origen: 'auto' });
        ok++;
      } catch (e) {
        errors++;
        console.error(`[snapshot-job] Error capturando ${cierre.id}:`, e);
      }
    }

    return { ok, errors };
  },
};
