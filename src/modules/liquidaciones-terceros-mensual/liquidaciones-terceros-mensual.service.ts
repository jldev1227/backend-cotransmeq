// @ts-nocheck
import { prisma } from "../../config/prisma";
import { randomUUID } from "crypto";
import { getIo } from "../../sockets";

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface AdicionalMensualInput {
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
  cierre_final_origen_id?: string | null;
  cierre_final_destino_id?: string | null;
}

export interface ConceptoMensualInput {
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

export interface GenerarBorradorMensualInput {
  mes: number;
  anio: number;
  user_id?: string;
}

export interface GuardarBorradorMensualParams {
  id?: string;
  mes: number;
  anio: number;
  observaciones?: string | null;
  adicionales: AdicionalMensualInput[];
  conceptos: ConceptoMensualInput[];
  user_id?: string;
  force_new?: boolean;
}

const MESES = [
  "ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO",
  "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE",
];

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function toNumber(v: any): number {
  if (v == null) return 0;
  const n = typeof v === "object" && v !== null ? Number(v) : Number(v);
  return isNaN(n) ? 0 : n;
}

function calcAdicional(a: AdicionalMensualInput) {
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

async function generarConsecutivo(): Promise<string> {
  // MEN-{mes}-{anio}-{seq} — seq es el conteo actual + 1 (por seguridad ante colisiones)
  const year = new Date().getFullYear();
  const count = await prisma.liquidacion_tercero_mensual.count({
    where: { anio: year, deleted_at: null },
  });
  const now = new Date();
  const mes = String(now.getMonth() + 1).padStart(2, "0");
  const seq = String(count + 1).padStart(4, "0");
  return `MEN-${mes}-${year}-${seq}`;
}

function recalcularTotales(adicionales: any[], conceptos: any[]) {
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
  const totalPagar = totalAdicionales - totalDescuentos;
  return {
    total_adicionales: totalAdicionales,
    total_gastos_operativos: totalGastos,
    total_impuestos: totalImpuestos,
    total_anticipos: totalAnticipos,
    total_descuentos: totalDescuentos,
    total_pagar: totalPagar,
  };
}

function emitRowUpdated(payload: { id: string; changes: Record<string, any>; userId?: string }) {
  try {
    const io = getIo();
    const roomKey = `row:liquidacion-tercero-mensual:${payload.id}`;
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
    // Si getIo() falla (sockets no inicializados aún), ignorar silenciosamente.
    console.warn("[mensual] emitRowUpdated fallo:", (e as Error).message);
  }
}

// ═══════════════════════════════════════════════════════════════
// SERVICIO
// ═══════════════════════════════════════════════════════════════

export const LiquidacionesTercerosMensualService = {
  /**
   * Listar TODAS las cabeceras mensuales (historial).
   * Soporta filtros opcionales: mes, anio.
   */
  async listar(filtros: { mes?: number; anio?: number }) {
    const where: any = { deleted_at: null };
    if (filtros.mes) where.mes = Number(filtros.mes);
    if (filtros.anio) where.anio = Number(filtros.anio);

    const items = await prisma.liquidacion_tercero_mensual.findMany({
      where,
      include: {
        creado_por: { select: { id: true, nombre: true, correo: true } },
        actualizado_por: { select: { id: true, nombre: true, correo: true } },
        _count: {
          select: {
            adicionales: { where: { deleted_at: null } },
            conceptos: { where: { deleted_at: null } },
            snapshots: true,
          },
        },
      },
      orderBy: [{ anio: "desc" }, { mes: "desc" }, { created_at: "desc" }],
    });

    return { items, total: items.length };
  },

  /**
   * Buscar cabecera por periodo. Devuelve la única cabecera (si existe)
   * para (mes, anio), o null.
   */
  async obtenerPorPeriodo(mes: number, anio: number) {
    return prisma.liquidacion_tercero_mensual.findFirst({
      where: { mes: Number(mes), anio: Number(anio), deleted_at: null },
      include: {
        creado_por: { select: { id: true, nombre: true, correo: true } },
        actualizado_por: { select: { id: true, nombre: true, correo: true } },
        adicionales: {
          where: { deleted_at: null },
          orderBy: [{ placa: "asc" }, { orden: "asc" }],
        },
        conceptos: {
          where: { deleted_at: null },
          orderBy: [{ tipo: "asc" }, { orden: "asc" }],
        },
        cierres_origen: {
          select: { id: true, consecutivo: true, placa: true, estado: true, total_pagar: true },
        },
      },
    });
  },

  /**
   * Obtener cabecera por ID con todos sus detalles.
   */
  async obtenerPorId(id: string) {
    return prisma.liquidacion_tercero_mensual.findFirst({
      where: { id, deleted_at: null },
      include: {
        creado_por: { select: { id: true, nombre: true, correo: true } },
        actualizado_por: { select: { id: true, nombre: true, correo: true } },
        adicionales: {
          where: { deleted_at: null },
          orderBy: [{ placa: "asc" }, { orden: "asc" }],
        },
        conceptos: {
          where: { deleted_at: null },
          orderBy: [{ tipo: "asc" }, { orden: "asc" }],
        },
        cierres_origen: {
          select: { id: true, consecutivo: true, placa: true, estado: true, total_pagar: true },
        },
      },
    });
  },

  /**
   * GENERAR BORRADOR MENSUAL.
   *
   * Recopila TODOS los `adicionales` (JSON array) presentes en TODOS los
   * `liquidacion_tercero_final` del mes/año, y los persiste como
   * `liquidacion_tercero_mensual_adicional` de una nueva cabecera en
   * estado BORRADOR. Idempotente: si ya existe un borrador para el
   * periodo, lo devuelve tal cual (no duplica).
   */
  async generarBorrador(input: GenerarBorradorMensualInput) {
    const { mes, anio, user_id } = input;

    // 1) Verificar idempotencia: si ya hay cabecera para (mes, anio), devolverla
    const existing = await prisma.liquidacion_tercero_mensual.findFirst({
      where: { mes, anio, deleted_at: null },
    });
    if (existing) {
      return {
        ok: true,
        accion: "existente",
        id: existing.id,
        message: `Ya existe un borrador para ${MESES[mes - 1]} ${anio}. Abriendo existente.`,
      };
    }

    // 2) Recopilar TODOS los cierres finales del mes/año que tengan adicionales
    const cierres = await prisma.liquidacion_tercero_final.findMany({
      where: { mes, anio, deleted_at: null },
      select: {
        id: true,
        consecutivo: true,
        placa: true,
        adicionales: true,
      },
    });

    // 3) Aplanar todos los adicionales (cada cierre trae un JSON array)
    const adicionalesFlat: any[] = [];
    const cierresOrigenIds: string[] = [];
    for (const c of cierres) {
      const adcs = Array.isArray(c.adicionales) ? c.adicionales : [];
      if (adcs.length === 0) continue;
      cierresOrigenIds.push(c.id);
      for (let i = 0; i < adcs.length; i++) {
        const a = adcs[i];
        adicionalesFlat.push({
          id: a.id || randomUUID(),
          cliente: a.cliente || "TRANSMERALDA",
          placa: a.placa || c.placa,
          tercero_id: a.tercero_id || null,
          tercero_nombre: a.tercero_nombre || null,
          vehiculo_id: a.vehiculo_id || null,
          recorrido: a.recorrido || null,
          fechas: a.fechas || null,
          valor_unitario: toNumber(a.valor_unitario),
          cantidad: toNumber(a.cantidad) || 1,
          porcentaje_admin: toNumber(a.porcentaje_admin),
          valor_admin: toNumber(a.valor_admin),
          valor_liquidar: toNumber(a.valor_liquidar),
          aplica_impuestos: a.aplica_impuestos !== false,
          orden: adicionalesFlat.length,
          cierre_final_origen_id: c.id,
          cierre_final_destino_id: null,
        });
      }
    }

    // 4) Generar consecutivo + crear cabecera + items en una transacción
    const consecutivo = await generarConsecutivo();

    const cabecera = await prisma.liquidacion_tercero_mensual.create({
      data: {
        id: randomUUID(),
        consecutivo,
        mes,
        anio,
        estado: "BORRADOR",
        creado_por_id: user_id || null,
        actualizado_por_id: user_id || null,
        adicionales: {
          create: adicionalesFlat.map((a) => ({
            id: a.id,
            cliente: a.cliente,
            placa: a.placa,
            tercero_id: a.tercero_id,
            tercero_nombre: a.tercero_nombre,
            vehiculo_id: a.vehiculo_id,
            recorrido: a.recorrido,
            fechas: a.fechas,
            valor_unitario: a.valor_unitario,
            cantidad: a.cantidad,
            porcentaje_admin: a.porcentaje_admin,
            valor_admin: a.valor_admin,
            valor_liquidar: a.valor_liquidar,
            aplica_impuestos: a.aplica_impuestos,
            orden: a.orden,
            cierre_final_origen_id: a.cierre_final_origen_id,
            cierre_final_destino_id: a.cierre_final_destino_id,
          })),
        },
        cierres_origen: {
          connect: cierresOrigenIds.map((id) => ({ id })),
        },
      },
      include: {
        adicionales: true,
        cierres_origen: true,
      },
    });

    return {
      ok: true,
      accion: "created",
      id: cabecera.id,
      consecutivo: cabecera.consecutivo,
      message: `Borrador mensual creado con ${adicionalesFlat.length} adicionales extraídos de ${cierresOrigenIds.length} cierre(s) final(es).`,
      adicionales_extraidos: adicionalesFlat.length,
      cierres_origen_count: cierresOrigenIds.length,
    };
  },

  /**
   * GUARDAR BORRADOR: persiste cambios en cabecera, adicionales y conceptos.
   * Si la cabecera ya tiene cierres asociados (APROBADA/FACTURADA), aplica
   * la restricción `force_new`.
   */
  async guardarBorrador(params: GuardarBorradorMensualParams) {
    const { id, mes, anio, observaciones, adicionales, conceptos, user_id, force_new } = params;

    // 1) Buscar o crear cabecera
    let cabecera = id
      ? await prisma.liquidacion_tercero_mensual.findFirst({
          where: { id, deleted_at: null },
        })
      : await prisma.liquidacion_tercero_mensual.findFirst({
          where: { mes, anio, deleted_at: null },
        });

    if (!cabecera) {
      // Auto-crear si no existe
      const consecutivo = await generarConsecutivo();
      cabecera = await prisma.liquidacion_tercero_mensual.create({
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

    // 2) Bloquear si cabecera en estado terminal (APROBADA/FACTURADA) y no hay force_new
    if (["APROBADA", "FACTURADA"].includes(cabecera.estado) && !force_new) {
      throw new Error(
        `La liquidación mensual está en estado ${cabecera.estado}. Usa force_new=true para crear una nueva versión.`,
      );
    }
    if (["APROBADA", "FACTURADA"].includes(cabecera.estado) && force_new) {
      await prisma.liquidacion_tercero_mensual.update({
        where: { id: cabecera.id },
        data: { estado: "REEMPLAZADA" },
      });
      // Crear nueva cabecera para el reemplazo
      const consecutivo = await generarConsecutivo();
      cabecera = await prisma.liquidacion_tercero_mensual.create({
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

    // 3) Verificar cierres finales APROBADA/FACTURADA en el mismo mes — si los
    //    hay, marcar como advertencia en la respuesta (no se bloquea la
    //    edición del workspace mensual porque es independiente).
    const cierresBloqueados = await prisma.liquidacion_tercero_final.findMany({
      where: {
        mes,
        anio,
        estado: { in: ["APROBADA", "FACTURADA"] },
        deleted_at: null,
      },
      select: { id: true, placa: true, estado: true },
    });

    // 4) Sanitizar y preparar adicionales
    const adicionalesSanitizados = (Array.isArray(adicionales) ? adicionales : [])
      .filter((a) => a && (toNumber(a.valor_unitario) > 0 || toNumber(a.cantidad) > 0))
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
          cierre_final_origen_id: a.cierre_final_origen_id || null,
          cierre_final_destino_id: a.cierre_final_destino_id || null,
        };
      });

    // 5) Sanitizar conceptos
    const conceptosSanitizados = (Array.isArray(conceptos) ? conceptos : [])
      .filter((c) => c && c.tipo && c.concepto)
      .map((c) => {
        let valorTotal = toNumber(c.valor_total);
        if (valorTotal === 0 && c.dias && c.valor_unitario) {
          valorTotal = toNumber(c.dias) * toNumber(c.valor_unitario);
        } else if (valorTotal === 0 && c.porcentaje && c.base_calculo) {
          valorTotal = toNumber(c.base_calculo) * (toNumber(c.porcentaje) / 100);
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
          base_calculo: c.base_calculo != null ? toNumber(c.base_calculo) : null,
          calculado: c.calculado || false,
          observaciones: c.observaciones || null,
          orden: c.orden ?? 0,
        };
      });

    // 6) Calcular totales
    const totales = recalcularTotales(adicionalesSanitizados, conceptosSanitizados);

    // 7) Persistir en transacción
    await prisma.$transaction([
      prisma.liquidacion_tercero_mensual_adicional.deleteMany({
        where: { liquidacion_mensual_id: cabecera.id, deleted_at: null },
      }),
      prisma.liquidacion_tercero_mensual_concepto.deleteMany({
        where: { liquidacion_mensual_id: cabecera.id, deleted_at: null },
      }),
      prisma.liquidacion_tercero_mensual_adicional.createMany({
        data: adicionalesSanitizados,
      }),
      prisma.liquidacion_tercero_mensual_concepto.createMany({
        data: conceptosSanitizados,
      }),
      prisma.liquidacion_tercero_mensual.update({
        where: { id: cabecera.id },
        data: {
          observaciones: observaciones ?? cabecera.observaciones,
          actualizado_por_id: user_id || cabecera.actualizado_por_id,
          updated_at: new Date(),
          ...totales,
        },
      }),
    ]);

    emitRowUpdated({
      id: cabecera.id,
      changes: {
        adicionales_count: adicionalesSanitizados.length,
        conceptos_count: conceptosSanitizados.length,
        ...totales,
      },
      userId: user_id,
    });

    return {
      ok: true,
      id: cabecera.id,
      accion: cabecera.created_at.getTime() === cabecera.updated_at.getTime() ? "created" : "updated",
      cierres_bloqueados: cierresBloqueados,
      message:
        cierresBloqueados.length > 0
          ? `Guardado. Hay ${cierresBloqueados.length} cierre(s) en estado APROBADA/FACTURADA en este mes — no se verán afectados automáticamente.`
          : "Guardado correctamente.",
    };
  },

  /**
   * Recalcular totales (útil para corregir desincronizaciones sin reenviar todo).
   */
  async recalcularTotales(id: string) {
    const adicionales = await prisma.liquidacion_tercero_mensual_adicional.findMany({
      where: { liquidacion_mensual_id: id, deleted_at: null },
      select: { valor_liquidar: true },
    });
    const conceptos = await prisma.liquidacion_tercero_mensual_concepto.findMany({
      where: { liquidacion_mensual_id: id, deleted_at: null },
      select: { tipo: true, valor_total: true },
    });

    const totales = recalcularTotales(adicionales, conceptos);

    const updated = await prisma.liquidacion_tercero_mensual.update({
      where: { id },
      data: { ...totales, updated_at: new Date() },
    });

    emitRowUpdated({ id, changes: totales });
    return updated;
  },

  /**
   * Cambiar estado de la cabecera (BORRADOR → LIQUIDADA → APROBADA → FACTURADA).
   */
  async cambiarEstado(id: string, estado: string, userId: string, motivo?: string) {
    const cabecera = await prisma.liquidacion_tercero_mensual.findUnique({ where: { id } });
    if (!cabecera) throw new Error("Liquidación mensual no encontrada");

    const updated = await prisma.liquidacion_tercero_mensual.update({
      where: { id },
      data: {
        estado,
        motivo_anulacion: estado === "ANULADA" ? motivo || null : cabecera.motivo_anulacion,
        actualizado_por_id: userId,
        updated_at: new Date(),
      },
    });
    emitRowUpdated({ id, changes: { estado }, userId });
    return updated;
  },

  /**
   * Soft delete de la cabecera y todos sus hijos (cascade).
   */
  async softDelete(id: string, userId?: string) {
    const cabecera = await prisma.liquidacion_tercero_mensual.findUnique({ where: { id } });
    if (!cabecera) throw new Error("Liquidación mensual no encontrada");
    if (cabecera.deleted_at) throw new Error("La liquidación ya está eliminada");
    if (["APROBADA", "FACTURADA"].includes(cabecera.estado)) {
      throw new Error(`No se puede eliminar una liquidación en estado ${cabecera.estado}`);
    }
    const ts = new Date();
    await prisma.$transaction([
      prisma.liquidacion_tercero_mensual.update({
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
      io.emit("liquidacion-tercero-mensual:deleted", { id });
    } catch (e) {
      /* sockets no inicializados */
    }
    return { ok: true, id, deleted_at: ts };
  },

  /**
   * Listar snapshots de la cabecera.
   */
  async listarSnapshots(id: string) {
    return prisma.liquidacion_tercero_mensual_snapshot.findMany({
      where: { liquidacion_mensual_id: id },
      include: {
        usuario: { select: { id: true, nombre: true, correo: true } },
      },
      orderBy: { version: "desc" },
    });
  },

  /**
   * Datos para el preview del PDF mensual. Devuelve cabecera + adicionales
   * + conceptos + resumen por placa + totales.
   */
  async obtenerPreviewData(id: string) {
    const cabecera = await this.obtenerPorId(id);
    if (!cabecera) return null;

    // Resumen por placa
    const porPlacaMap = new Map<
      string,
      {
        placa: string;
        adicionales_count: number;
        valor_liquidar: number;
        tercero_nombre?: string | null;
      }
    >();
    for (const a of cabecera.adicionales) {
      const k = a.placa;
      if (!porPlacaMap.has(k)) {
        porPlacaMap.set(k, {
          placa: k,
          adicionales_count: 0,
          valor_liquidar: 0,
          tercero_nombre: a.tercero_nombre,
        });
      }
      const entry = porPlacaMap.get(k)!;
      entry.adicionales_count += 1;
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
        cierres_origen: cabecera.cierres_origen,
      },
      adicionales: cabecera.adicionales.map(serializeAdicional),
      conceptos: cabecera.conceptos.map(serializeConcepto),
      por_placa: porPlaca,
      totales: {
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
