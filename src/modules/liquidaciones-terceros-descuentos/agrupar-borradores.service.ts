import { randomUUID } from 'crypto';
import { prisma } from '../../config/prisma';
import { LiquidacionesSnapshotsService } from '../liquidaciones-terceros-snapshots/liquidaciones-terceros-snapshots.service';
import { LiquidacionesTercerosDescuentosService } from './liquidaciones-terceros-descuentos.service';
import { ConfigGastosPeriodoService } from './config-gastos-periodo.service';
import { ConfigValoresTerceroService } from './config-valores-tercero.service';
import { recalcularGastosAutomaticos, normalizarOverridesPropietario } from './reglas-conceptos';
import { sembrarGastosDelCierre } from './sembrar-gastos.service';
import { calcularTotalesCierre, recalcularTotalesCierre } from './totales-cierre';

const CONCEPTOS_GASTO_COMPARTIDO = [
  'DOTACION',
  'EXAMEN_MEDICO',
  'COMBUSTIBLE',
  'PAPELERIA',
  'GASTOS_DIVERSOS',
];

function toNumber(value: unknown): number {
  if (value == null) return 0;
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function clavePlaca(value: string): string {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function clavePropietario(cierre: any): string {
  const documento = String(
    cierre.tercero?.identificacion || cierre.vehiculo?.propietario_identificacion || '',
  ).replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  if (documento) return `doc:${documento}`;
  const terceroId = cierre.tercero_id || cierre.vehiculo?.tercero_propietario_id;
  return terceroId ? `tercero:${terceroId}` : '';
}

function combinarOverridesPropietario(cierres: any[]): Record<string, boolean> {
  const resultado: Record<string, boolean> = {};
  for (const cierre of cierres) {
    for (const [conductor, esPropietario] of Object.entries(
      (cierre.es_propietario_overrides as Record<string, unknown>) || {},
    )) {
      /// Si un conductor fue reconocido como propietario en cualquiera de las
      /// placas del grupo, no le cargamos dotación ni examen médico al consolidar.
      resultado[conductor] = resultado[conductor] === true || esPropietario === true;
    }
  }
  return resultado;
}

/**
 * Deja los gastos vehiculares compartidos en una sola fila y los recalcula
 * contra toda la liquidación agrupada. Los borradores fuente ya traen estas
 * cinco filas, así que sumarlas al mover conceptos las multiplicaba por placa.
 */
export async function recalcularGastosVehiculoCompartidos(
  db: any,
  cierreId: string,
  conceptosPreferidos: ReadonlySet<string> = new Set(),
): Promise<void> {
  await recalcularTotalesCierre(db, cierreId);
  const cierre = await db.liquidacion_tercero_final.findUnique({
    where: { id: cierreId },
    select: { anio: true, mes: true, es_propietario_overrides: true },
  });
  if (!cierre) throw new Error('Liquidación final de tercero no encontrada');

  await sembrarGastosDelCierre(cierreId, { anio: cierre.anio, mes: cierre.mes }, db);

  const filasGasto = await db.liquidacion_tercero_final_concepto.findMany({
    where: {
      liquidacion_tercero_final_id: cierreId,
      tipo: 'GASTO_OPERATIVO',
      concepto: { in: CONCEPTOS_GASTO_COMPARTIDO },
      deleted_at: null,
    },
    orderBy: [{ orden: 'asc' }, { created_at: 'asc' }],
  });

  const porConcepto = new Map<string, any[]>();
  for (const fila of filasGasto) {
    const grupo = porConcepto.get(fila.concepto) || [];
    grupo.push(fila);
    porConcepto.set(fila.concepto, grupo);
  }

  const duplicados: string[] = [];
  for (const [concepto, filas] of porConcepto) {
    const preferida = filas.find((fila) => conceptosPreferidos.has(fila.id));
    const conservar = preferida || filas[0];
    duplicados.push(...filas.filter((fila) => fila.id !== conservar.id).map((fila) => fila.id));
  }
  if (duplicados.length) {
    await db.liquidacion_tercero_final_concepto.updateMany({
      where: { id: { in: duplicados } },
      data: { deleted_at: new Date(), version: { increment: 1 }, updated_at: new Date() },
    });
  }

  const [conceptos, items, adicionales, config, valores, totales] = await Promise.all([
    db.liquidacion_tercero_final_concepto.findMany({
      where: { liquidacion_tercero_final_id: cierreId, deleted_at: null },
    }),
    db.liquidacion_tercero_final_item.findMany({
      where: { liquidacion_tercero_final_id: cierreId, deleted_at: null },
      select: { liquidacion_tercero: { select: { total_facturado: true } } },
    }),
    db.liquidacion_tercero_final_adicional.findMany({
      where: { liquidacion_tercero_final_id: cierreId, deleted_at: null },
      select: { valor_unitario: true, cantidad: true },
    }),
    ConfigGastosPeriodoService.obtener(cierre.anio, cierre.mes, db),
    ConfigValoresTerceroService.obtener(db),
    calcularTotalesCierre(db, cierreId),
  ]);

  const recalculados = recalcularGastosAutomaticos(
    conceptos as any,
    items.reduce((s: number, item: any) => s + toNumber(item.liquidacion_tercero?.total_facturado), 0),
    adicionales.reduce(
      (s: number, adicional: any) =>
        s + toNumber(adicional.valor_unitario) * (toNumber(adicional.cantidad) || 1),
      0,
    ),
    normalizarOverridesPropietario(cierre.es_propietario_overrides as any),
    config,
    totales.valor_liquidar,
    valores,
  );

  const anterioresPorId = new Map(conceptos.map((fila: any) => [fila.id, fila]));
  for (const fila of recalculados as any[]) {
    if (!CONCEPTOS_GASTO_COMPARTIDO.includes(fila.concepto)) continue;
    const anterior: any = anterioresPorId.get(fila.id);
    if (!anterior) continue;
    if (
      toNumber(anterior.dias) === toNumber(fila.dias) &&
      toNumber(anterior.valor_unitario) === toNumber(fila.valor_unitario) &&
      toNumber(anterior.valor_total) === toNumber(fila.valor_total) &&
      anterior.calculado === (fila.calculado === true)
    ) continue;

    await db.liquidacion_tercero_final_concepto.update({
      where: { id: fila.id },
      data: {
        dias: fila.dias == null ? null : String(fila.dias),
        valor_unitario: String(toNumber(fila.valor_unitario)),
        valor_total: String(toNumber(fila.valor_total)),
        calculado: fila.calculado === true,
        version: { increment: 1 },
        updated_at: new Date(),
      },
    });
  }
  await recalcularTotalesCierre(db, cierreId);
}

/** Consolida varios borradores en una única hoja del tercero. */
export async function agruparBorradores(cierreIdsInput: string[], userId?: string) {
  const cierreIds = [...new Set((cierreIdsInput || []).map((id) => String(id).trim()).filter(Boolean))];
  if (cierreIds.length < 2) throw new Error('Selecciona al menos dos borradores para agrupar');

  const resultado = await prisma.$transaction(async (tx) => {
    const cierres = await tx.liquidacion_tercero_final.findMany({
      where: { id: { in: cierreIds }, deleted_at: null },
      include: {
        tercero: { select: { identificacion: true } },
        vehiculo: {
          select: { propietario_identificacion: true, tercero_propietario_id: true },
        },
        propietarios: { where: { deleted_at: null }, select: { id: true } },
      },
    });
    if (cierres.length !== cierreIds.length) {
      throw new Error('Uno o más cierres no existen o ya fueron archivados');
    }

    const porId = new Map(cierres.map((cierre: any) => [cierre.id, cierre]));
    const ordenados = cierreIds.map((id) => porId.get(id)!);
    const principal: any = ordenados[0];
    if (ordenados.some((cierre: any) => cierre.estado !== 'BORRADOR')) {
      throw new Error('Solo se pueden agrupar cierres en estado BORRADOR');
    }
    if (ordenados.some((cierre: any) => cierre.mes !== principal.mes || cierre.anio !== principal.anio)) {
      throw new Error('Los borradores deben pertenecer al mismo mes y año');
    }
    if (ordenados.some((cierre: any) => cierre.es_multi_propietario || cierre.propietarios?.length > 0)) {
      throw new Error('Los cierres con copropietarios todavía no se pueden agrupar');
    }
    const propietario = clavePropietario(principal);
    if (!propietario || ordenados.some((cierre: any) => clavePropietario(cierre) !== propietario)) {
      throw new Error('Los cierres deben pertenecer al mismo propietario identificado');
    }

    const membresias = await tx.liquidacion_tercero_final_vehiculo.findMany({
      where: { liquidacion_tercero_final_id: { in: cierreIds } },
    });
    const gruposPrevios = await tx.liquidacion_tercero_final_vehiculo.findMany({
      where: { cierre_origen_id: { in: cierreIds } },
      select: { cierre_origen_id: true, liquidacion_tercero_final_id: true },
    });
    if (gruposPrevios.some((miembro: any) => !cierreIds.includes(miembro.liquidacion_tercero_final_id))) {
      throw new Error('Uno de los cierres ya pertenece a otro grupo');
    }

    const placasPorClave = new Map<string, string>();
    for (const placa of [
      ...membresias.map((miembro: any) => miembro.placa),
      ...ordenados.filter((cierre: any) => cierre.placa !== 'VARIAS PLACAS').map((cierre: any) => cierre.placa),
    ]) {
      const clave = clavePlaca(placa);
      if (clave && !placasPorClave.has(clave)) placasPorClave.set(clave, String(placa).toUpperCase());
    }
    const placas = [...placasPorClave.values()].sort((a, b) => a.localeCompare(b, 'es'));
    if (placas.length < 2) throw new Error('El agrupamiento requiere al menos dos placas distintas');

    const gastosPreferidos = await tx.liquidacion_tercero_final_concepto.findMany({
      where: {
        liquidacion_tercero_final_id: principal.id,
        tipo: 'GASTO_OPERATIVO',
        concepto: { in: CONCEPTOS_GASTO_COMPARTIDO },
        deleted_at: null,
      },
      select: { id: true },
    });
    const idsGastosPreferidos = new Set(gastosPreferidos.map((fila: any) => fila.id));
    const overridesPropietario = combinarOverridesPropietario(ordenados);

    const origenesConMembresia = new Set(membresias.map((miembro: any) => miembro.cierre_origen_id));
    for (const cierre of ordenados) {
      if (origenesConMembresia.has(cierre.id)) continue;
      await tx.liquidacion_tercero_final_vehiculo.create({
        data: {
          liquidacion_tercero_final_id: principal.id,
          cierre_origen_id: cierre.id,
          liquidacion_servicio_id: cierre.liquidacion_servicio_id,
          vehiculo_id: cierre.vehiculo_id,
          placa: cierre.placa,
        },
      });
    }
    await tx.liquidacion_tercero_final_vehiculo.updateMany({
      where: { liquidacion_tercero_final_id: { in: cierreIds.slice(1) } },
      data: { liquidacion_tercero_final_id: principal.id },
    });

    /// El pivote es la única relación entre el ingreso y la hoja. Si una fila
    /// se repitió en un borrador restaurado, el destino conserva una sola.
    const pivotes = await tx.liquidacion_tercero_final_item.findMany({
      where: { liquidacion_tercero_final_id: { in: cierreIds }, deleted_at: null },
      select: {
        id: true,
        liquidacion_tercero_final_id: true,
        liquidacion_tercero_id: true,
        aplica_impuestos: true,
      },
    });
    const pivotesDestino = await tx.liquidacion_tercero_final_item.findMany({
      where: { liquidacion_tercero_final_id: principal.id },
      select: { id: true, liquidacion_tercero_id: true, deleted_at: true },
    });
    const porItem = new Map(pivotesDestino.map((pivote: any) => [pivote.liquidacion_tercero_id, pivote]));
    const mover: string[] = [];
    const archivar: string[] = [];
    for (const pivote of pivotes as any[]) {
      if (pivote.liquidacion_tercero_final_id === principal.id) continue;
      const existente: any = porItem.get(pivote.liquidacion_tercero_id);
      if (existente) {
        if (existente.deleted_at) {
          await tx.liquidacion_tercero_final_item.update({
            where: { id: existente.id },
            data: { deleted_at: null, aplica_impuestos: pivote.aplica_impuestos },
          });
        }
        archivar.push(pivote.id);
        continue;
      }
      mover.push(pivote.id);
      porItem.set(pivote.liquidacion_tercero_id, { id: pivote.id, deleted_at: null });
    }
    if (mover.length) {
      await tx.liquidacion_tercero_final_item.updateMany({
        where: { id: { in: mover } },
        data: { liquidacion_tercero_final_id: principal.id },
      });
    }
    if (archivar.length) {
      await tx.liquidacion_tercero_final_item.updateMany({
        where: { id: { in: archivar } },
        data: { deleted_at: new Date() },
      });
    }

    /// Los impuestos calculados por separado no se trasladan: se regeneran
    /// contra el valor combinado. Nómina, gastos y anticipos sí se acumulan.
    const conceptosFuente = await tx.liquidacion_tercero_final_concepto.findMany({
      where: { liquidacion_tercero_final_id: { in: cierreIds.slice(1) }, deleted_at: null },
      select: { id: true, tipo: true, calculado: true },
    });
    const conceptosMover = conceptosFuente
      .filter((concepto: any) => concepto.tipo !== 'IMPUESTO' || concepto.calculado !== true)
      .map((concepto: any) => concepto.id);
    if (conceptosMover.length) {
      await tx.liquidacion_tercero_final_concepto.updateMany({
        where: { id: { in: conceptosMover } },
        data: { liquidacion_tercero_final_id: principal.id },
      });
    }

    const adicionalesTabulares = await tx.liquidacion_tercero_final_adicional.findMany({
      where: { liquidacion_tercero_final_id: { in: cierreIds }, deleted_at: null },
      select: { liquidacion_tercero_final_id: true },
    });
    const cantidadTablaPorCierre = new Map<string, number>();
    for (const adicional of adicionalesTabulares) {
      cantidadTablaPorCierre.set(
        adicional.liquidacion_tercero_final_id,
        (cantidadTablaPorCierre.get(adicional.liquidacion_tercero_final_id) || 0) + 1,
      );
    }
    const adicionalesLegacy = ordenados.flatMap((cierre: any) => {
      if ((cantidadTablaPorCierre.get(cierre.id) || 0) > 0 || !Array.isArray(cierre.adicionales)) return [];
      return (cierre.adicionales as any[]).map((adicional) => ({ cierre, adicional }));
    });
    if (adicionalesLegacy.length) {
      await tx.liquidacion_tercero_final_adicional.createMany({
        data: adicionalesLegacy.map(({ cierre, adicional }: any, index: number) => ({
          id: randomUUID(),
          liquidacion_tercero_final_id: principal.id,
          orden: index,
          cliente: adicional.cliente || 'COTRANSMEQ',
          placa: adicional.placa || cierre.placa,
          tercero_id: adicional.tercero_id || cierre.tercero_id,
          tercero_nombre: adicional.tercero_nombre || null,
          vehiculo_id: adicional.vehiculo_id || cierre.vehiculo_id,
          recorrido: adicional.recorrido || null,
          fechas: adicional.fechas || null,
          valor_unitario: toNumber(adicional.valor_unitario),
          cantidad: toNumber(adicional.cantidad) || 1,
          porcentaje_admin: toNumber(adicional.porcentaje_admin),
          valor_admin: toNumber(adicional.valor_admin),
          valor_liquidar: adicional.valor_liquidar == null
            ? toNumber(adicional.valor_unitario) * (toNumber(adicional.cantidad) || 1)
            : toNumber(adicional.valor_liquidar),
          aplica_impuestos: adicional.aplica_impuestos !== false,
          version: Number(adicional.version) || 1,
          creado_por_id: adicional.creado_por_id || null,
          actualizado_por_id: adicional.actualizado_por_id || null,
        })),
      });
    }
    await tx.liquidacion_tercero_final_adicional.updateMany({
      where: { liquidacion_tercero_final_id: { in: cierreIds.slice(1) }, deleted_at: null },
      data: { liquidacion_tercero_final_id: principal.id },
    });

    const adicionalesJson = ordenados.flatMap((cierre: any) =>
      Array.isArray(cierre.adicionales) ? cierre.adicionales : [],
    );
    await tx.liquidacion_tercero_final.update({
      where: { id: principal.id },
      data: {
        placa: 'VARIAS PLACAS',
        vehiculo_id: null,
        es_propietario_overrides: overridesPropietario,
        adicionales: adicionalesJson as any,
        actualizado_por_id: userId || null,
        version: { increment: 1 },
        updated_at: new Date(),
      },
    });
    await tx.liquidacion_tercero_final.updateMany({
      where: { id: { in: cierreIds.slice(1) } },
      data: {
        deleted_at: new Date(),
        motivo_anulacion: `Agrupada en el cierre ${principal.consecutivo}`,
        actualizado_por_id: userId || null,
        updated_at: new Date(),
      },
    });

    await recalcularGastosVehiculoCompartidos(tx, principal.id, idsGastosPreferidos);
    await LiquidacionesTercerosDescuentosService.calcularImpuestos(principal.id, tx);
    await recalcularTotalesCierre(tx, principal.id, { userId });
    return { id: principal.id, placas };
  }, { timeout: 30_000, maxWait: 10_000 });

  try {
    await LiquidacionesSnapshotsService.capturar(resultado.id, {
      origen: 'manual',
      usuarioId: userId || null,
    });
  } catch (error) {
    console.error('[agruparBorradores] Snapshot failed:', error);
  }

  const cierre = await prisma.liquidacion_tercero_final.findUnique({
    where: { id: resultado.id },
    include: {
      items: {
        where: { deleted_at: null },
        include: { liquidacion_tercero: { select: { placa: true } } },
        orderBy: { orden: 'asc' },
      },
      conceptos: { where: { deleted_at: null }, orderBy: [{ orden: 'asc' }, { concepto: 'asc' }] },
      adicionales_filas: { where: { deleted_at: null }, orderBy: [{ orden: 'asc' }, { created_at: 'asc' }] },
    },
  });

  return { ok: true, id: resultado.id, cierre: { ...cierre, placas: resultado.placas } };
}
