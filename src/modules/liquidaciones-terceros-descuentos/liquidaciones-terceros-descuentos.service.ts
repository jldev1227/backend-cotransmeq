// @ts-nocheck
import { prisma } from "../../config/prisma";
import { randomUUID } from "crypto";
import { LiquidacionesSnapshotsService } from "../liquidaciones-terceros-snapshots/liquidaciones-terceros-snapshots.service";

const MESES = [
  'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO',
  'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'
];

// ═══════════════════════════════════════════════════════════════
// TIPOS
// ═══════════════════════════════════════════════════════════════

export type TipoConcepto = "COSTO_LABORAL" | "GASTO_OPERATIVO" | "IMPUESTO" | "ANTICIPO";

/// Fila virtual adicional (no proviene de un item de liquidacion_servicio).
/// Se persiste en liquidacion_tercero_final.adicionales (JSONB) y se muestra
/// como última fila de la tabla de items en la UI y en el PDF preview.
/// El valor_unitario * cantidad se SUMA al valor_liquidar del cierre y
/// queda como ingreso negativo para Cotransmeq (ingreso_empresa).
export interface AdicionalInput {
  id?: string;
  cliente?: string;
  placa?: string;
  tercero_nombre?: string;
  recorrido?: string;
  fechas?: string;
  valor_unitario: number;
  cantidad: number;
  valor_liquidar?: number;
  /// Si es false, el adicional NO entra en la base de cálculo de impuestos
  /// (RETENCION_ICA, AVISOS_TABLEROS, SOBRETASA_BOMBERIL, RETENCION_FUENTE).
  /// Default: true (compatibilidad con adicionales ya guardados sin el flag).
  aplica_impuestos?: boolean;
}

export interface ConceptoInput {
  id?: string;
  tipo: TipoConcepto;
  concepto: string;
  conductor_id?: string | null;
  conductor?: {
    id: string;
    nombre: string;
    apellido: string;
    numero_identificacion: string;
  } | null;
  dias?: number | null;
  valor_unitario?: number;
  porcentaje?: number | null;
  valor_total?: number;
  base_calculo?: number | null;
  calculado?: boolean;
  observaciones?: string | null;
  orden?: number;
}

export interface AutocompletarNominaInput {
  placa: string;
  mes: number;
  anio: number;
}

export interface GenerarBorradorInput {
  liquidacion_servicio_id?: string;
  liquidacion_servicio_ids?: string[];
  placa?: string;
  user_id?: string;
  onProgress?: (data: { processed: number; total: number; currentStep: string }) => void;
}

/**
 * NOTA: la generación del consecutivo de liquidacion_tercero_final se
 * hace inline en `guardarBorrador` (rama "crear nuevo") con una
 * transacción interactiva + pg_advisory_xact_lock para garantizar
 * atomicidad. Ya no existe una función `generarConsecutivo` separada
 * porque separar la lectura del consecutivo del INSERT introducía un
 * race window en el que requests concurrentes podían proponer el
 * mismo string, rompiendo el unique constraint.
 */

// ═══════════════════════════════════════════════════════════════
// CACHE (protege autocompletarNomina dentro de un mismo job)
// ═══════════════════════════════════════════════════════════════

const nominaCache = new Map<string, { data: any; ts: number }>();
const NOMINA_CACHE_TTL = 30_000;

async function getNominaCached(input: { placa: string; mes: number; anio: number }) {
  const key = `${input.placa}|${input.mes}|${input.anio}`;
  const cached = nominaCache.get(key);
  if (cached && Date.now() - cached.ts < NOMINA_CACHE_TTL) {
    return cached.data;
  }
  const data = await LiquidacionesTercerosDescuentosService.autocompletarNomina(input);
  nominaCache.set(key, { data, ts: Date.now() });
  return data;
}

function toNumber(v: any): number {
  return typeof v === 'object' && v !== null ? Number(v) : Number(v) || 0;
}

function serializeConcepto(item: any) {
  return {
    ...item,
    dias: item.dias ? toNumber(item.dias) : null,
    valor_unitario: toNumber(item.valor_unitario),
    porcentaje: item.porcentaje ? toNumber(item.porcentaje) : null,
    valor_total: toNumber(item.valor_total),
    base_calculo: item.base_calculo ? toNumber(item.base_calculo) : null,
  };
}

function serializeLiquidacionTerceroFinal(item: any) {
  if (!item) return null;
  return {
    ...item,
    valor_unitario: toNumber(item.valor_unitario),
    cantidad: toNumber(item.cantidad),
    total_facturado: toNumber(item.total_facturado),
    porcentaje_admin: toNumber(item.porcentaje_admin),
    valor_admin: toNumber(item.valor_admin),
    ingreso_extra_global: toNumber(item.ingreso_extra_global),
    ingresos_extra_aval: toNumber(item.ingresos_extra_aval),
    ingreso_empresa: toNumber(item.ingreso_empresa),
    valor_liquidar: toNumber(item.valor_liquidar),
    total_costos_laborales: toNumber(item.total_costos_laborales),
    total_gastos_operativos: toNumber(item.total_gastos_operativos),
    total_impuestos: toNumber(item.total_impuestos),
    total_descuentos: toNumber(item.total_descuentos),
    total_pagar: toNumber(item.total_pagar),
    adicionales: Array.isArray(item.adicionales) ? item.adicionales : [],
  };
}

// ═══════════════════════════════════════════════════════════════
// SERVICIO
// ═══════════════════════════════════════════════════════════════

export const LiquidacionesTercerosDescuentosService = {

  // ── CONFIGURACIÓN DE DESCUENTOS ──

  async obtenerConfiguracion() {
    return await prisma.configuracion_descuento_tercero.findMany({
      where: { activo: true },
      orderBy: [{ categoria: 'asc' }, { orden: 'asc' }],
    });
  },

  async actualizarConfiguracion(items: Array<{ concepto: string; porcentaje: number; base_calculo?: string; valor_dia_conductor?: number }>) {
    const results = [];
    for (const item of items) {
      const updated = await prisma.configuracion_descuento_tercero.update({
        where: { concepto: item.concepto },
        data: {
          ...(item.porcentaje !== undefined && { porcentaje: item.porcentaje }),
          ...(item.base_calculo !== undefined && { base_calculo: item.base_calculo }),
          ...(item.valor_dia_conductor !== undefined && { valor_dia_conductor: item.valor_dia_conductor }),
        },
      });
      results.push(updated);
    }
    return results;
  },

  // ── CONCEPTOS DEL CIERRE FINAL (liquidacion_tercero_final_concepto) ──

  async obtenerConceptos(liquidacionTerceroFinalId: string) {
    const conceptos = await prisma.liquidacion_tercero_final_concepto.findMany({
      where: { liquidacion_tercero_final_id: liquidacionTerceroFinalId, deleted_at: null },
      include: {
        conductor: {
          select: {
            id: true,
            nombre: true,
            apellido: true,
            numero_identificacion: true,
          },
        },
      },
      orderBy: [{ orden: 'asc' }, { concepto: 'asc' }],
    });
    return conceptos.map(serializeConcepto);
  },

  async guardarConceptos(liquidacionTerceroFinalId: string, conceptos: ConceptoInput[]) {
    // Verificar que el cierre existe
    const cierre = await prisma.liquidacion_tercero_final.findUnique({
      where: { id: liquidacionTerceroFinalId },
    });
    if (!cierre) throw new Error('Liquidación final de tercero no encontrada');

    // Calcular valor_total si no viene
    const conceptosConTotales = conceptos.map((c, idx) => {
      let valorTotal = c.valor_total ?? 0;
      if (valorTotal === 0 && c.dias && c.valor_unitario) {
        valorTotal = c.dias * c.valor_unitario;
      } else if (valorTotal === 0 && c.porcentaje && c.base_calculo) {
        valorTotal = c.base_calculo * (c.porcentaje / 100);
      }
      return { ...c, valor_total: valorTotal, orden: c.orden ?? idx };
    });

    const conceptosData = conceptosConTotales.map((c) => ({
      id: c.id || randomUUID(),
      liquidacion_tercero_final_id: liquidacionTerceroFinalId,
      tipo: c.tipo,
      concepto: c.concepto,
      conductor_id: c.conductor_id || null,
      dias: c.dias || null,
      valor_unitario: c.valor_unitario || 0,
      porcentaje: c.porcentaje || null,
      valor_total: c.valor_total,
      base_calculo: c.base_calculo || null,
      calculado: c.calculado || false,
      observaciones: c.observaciones || null,
      orden: c.orden ?? 0,
    }));

    await prisma.$transaction([
      prisma.liquidacion_tercero_final_concepto.deleteMany({
        where: { liquidacion_tercero_final_id: liquidacionTerceroFinalId, deleted_at: null },
      }),
      prisma.liquidacion_tercero_final_concepto.createMany({
        data: conceptosData,
      }),
    ]);

    // Recalcular totales en liquidacion_tercero_final
    await this.recalcularTotales(liquidacionTerceroFinalId);

    const created = await prisma.liquidacion_tercero_final_concepto.findMany({
      where: { liquidacion_tercero_final_id: liquidacionTerceroFinalId },
      include: {
        conductor: {
          select: {
            id: true,
            nombre: true,
            apellido: true,
            numero_identificacion: true,
          },
        },
      },
      orderBy: [{ orden: 'asc' }, { concepto: 'asc' }],
    });

    return created.map(serializeConcepto);
  },

  // ── AUTOCOMPLETAR DESDE NÓMINA ──

  async autocompletarNomina(input: AutocompletarNominaInput) {
    const { placa, mes, anio } = input;

    console.log(`[autocompletarNomina] placa=${placa}, mes=${mes}, anio=${anio}`);

    // 1. Buscar vehículo por placa
    const vehiculo = await prisma.vehiculos.findFirst({
      where: { placa: { contains: placa, mode: 'insensitive' } },
      select: { id: true, placa: true, propietario_nombre: true },
    });

    if (!vehiculo) {
      throw new Error(`Vehículo con placa "${placa}" no encontrado`);
    }

    // 2. Calcular rango del periodo
    const lastDay = new Date(anio, mes, 0).getDate();
    const periodoStart = `${anio}-${String(mes).padStart(2, '0')}-01`;
    const periodoEnd = `${anio}-${String(mes).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    const mesKey = `${anio}-${String(mes).padStart(2, '0')}`;

    const nominaInclude = {
      conductores: {
        select: {
          id: true, nombre: true, apellido: true, numero_identificacion: true, salario_base: true,
        },
      },
      bonificaciones: {
        where: { vehiculo_id: vehiculo.id },
        select: {
          id: true, name: true, value: true, values: true, liquidacion_id: true, vehiculo_id: true,
        },
      },
    };

    let liquidacionesNomina: any[] = await prisma.liquidaciones.findMany({
      where: {
        liquidacion_vehiculo: { some: { vehiculo_id: vehiculo.id } },
        periodo_end: { gte: periodoStart, lte: periodoEnd },
        periodo_start: { lt: `${anio}-${String(mes).padStart(2, '0')}-21` },
      },
      include: nominaInclude,
    });

    if (liquidacionesNomina.length === 0) {
      liquidacionesNomina = await prisma.liquidaciones.findMany({
        where: {
          liquidacion_vehiculo: { some: { vehiculo_id: vehiculo.id } },
          periodo_end: { gte: periodoStart, lte: periodoEnd },
        },
        include: nominaInclude,
      });
    }

    if (liquidacionesNomina.length === 0) {
      return {
        vehiculo,
        conductores: [],
        conceptos: [],
        resumen: { base_salarios: 0, base_auxilio_transporte: 0, base_recargos: 0, base_bonificaciones: 0, total_base: 0 },
      };
    }

    // 3. Agregar datos de conductores
    const conductoresMap = new Map<string, any>();
    let totalBaseSalarios = 0;
    let totalAuxilioTransporte = 0;
    let totalRecargos = 0;
    let totalBonificaciones = 0;
    const liquidacionIdsParaRecargos: string[] = [];

    for (const liq of liquidacionesNomina) {
      const conductor = liq.conductores;
      if (!conductor) continue;
      const periodoKey = `${conductor.id}|${liq.periodo_start}|${liq.periodo_end}`;
      if (!conductoresMap.has(periodoKey)) {
        conductoresMap.set(periodoKey, {
          conductor_id: conductor.id,
          nombre: `${conductor.nombre} ${conductor.apellido}`,
          identificacion: conductor.numero_identificacion || '',
          dias_laborados: 0,
          salario_devengado: 0,
          auxilio_transporte: 0,
          total_recargos: 0,
          total_bonificaciones: 0,
          // Bonificaciones de alimentación (consolidadas del JSON `values` por mes)
          bonos_alimentacion_cantidad: 0,
          bonos_alimentacion_valor_unitario: 0,
          bonos_alimentacion_liq_id: null as string | null,
          bonos_alimentacion_periodo_end: '' as string,
          _periodos: new Set(),
        });
      }
      const cd = conductoresMap.get(periodoKey)!;
      const periodoId = `${liq.periodo_start}|${liq.periodo_end}`;
      if (cd._periodos.has(periodoId)) continue;
      cd._periodos.add(periodoId);
      liquidacionIdsParaRecargos.push(liq.id);

      const salarioDevengado = toNumber(liq.salario_devengado);
      const auxilioTransporte = toNumber(liq.auxilio_transporte);
      const totalBonificacionesLiq = toNumber(liq.total_bonificaciones);
      const diasLaborados = liq.dias_laborados || 0;

      totalBaseSalarios += salarioDevengado;
      totalAuxilioTransporte += auxilioTransporte;
      totalBonificaciones += totalBonificacionesLiq;

      cd.dias_laborados += diasLaborados;
      cd.salario_devengado += salarioDevengado;
      cd.auxilio_transporte += auxilioTransporte;
      cd.total_bonificaciones += totalBonificacionesLiq;

      // Recorrer bonificaciones de tipo Alimentación y consolidar cantidad del mes.
      // - nombre: case-insensitive "aliment" cubre "Alimentación", "Alimenticio", etc.
      // - cantidad: se toma del JSON `values` filtrando por el mes objetivo.
      // - valor_unitario: se toma del registro con `periodo_end` más reciente.
      for (const b of (liq.bonificaciones as any[]) || []) {
        const nombre = String(b.name || '').toLowerCase();
        if (!nombre.includes('aliment')) continue;

        let cantidadDelMes = 0;
        try {
          const arr = typeof b.values === 'string' ? JSON.parse(b.values) : b.values;
          if (Array.isArray(arr)) {
            const itemDelMes = arr.find((it: any) => it?.mes === mesKey);
            if (itemDelMes && typeof itemDelMes.quantity === 'number') {
              cantidadDelMes = itemDelMes.quantity;
            }
          }
        } catch (_) { /* ignore */ }

        const valorUnitario = toNumber(b.value);
        cd.bonos_alimentacion_cantidad += cantidadDelMes;

        if (liq.periodo_end > (cd.bonos_alimentacion_periodo_end || '')) {
          cd.bonos_alimentacion_valor_unitario = valorUnitario;
          cd.bonos_alimentacion_liq_id = liq.id;
          cd.bonos_alimentacion_periodo_end = liq.periodo_end;
        }
      }
    }

    if (liquidacionIdsParaRecargos.length > 0) {
      // 1) Recargos desde la tabla `recargos` (fuente primaria, ya filtrados)
      const recargosReales = await prisma.recargos.findMany({
        where: {
          liquidacion_id: { in: liquidacionIdsParaRecargos },
          pag_cliente: false,
          incluir: true,
        },
        select: { id: true, valor: true, liquidacion_id: true },
      });

      // 2) Diagnóstico: total de recargos por liquidación SIN los filtros
      // (pag_cliente, incluir) para detectar si los recargos existen pero
      // están guardados con flags diferentes.
      const recargosAll = await prisma.recargos.findMany({
        where: { liquidacion_id: { in: liquidacionIdsParaRecargos } },
        select: { id: true, valor: true, liquidacion_id: true, pag_cliente: true, incluir: true },
      });
      console.log('[autocompletarNomina][recargos] total con filtros (pag_cliente=false, incluir=true):', recargosReales.length);
      console.log('[autocompletarNomina][recargos] total SIN filtros:', recargosAll.length);
      for (const r of recargosAll) {
        console.log(`[autocompletarNomina][recargos]   liq=${r.liquidacion_id} valor=${r.valor} pag_cliente=${r.pag_cliente} incluir=${r.incluir}`);
      }

      const recargosPorLiquidacion = new Map<string, number>();
      for (const r of recargosReales) {
        if (!r.liquidacion_id) continue;
        const valor = toNumber(r.valor);
        recargosPorLiquidacion.set(r.liquidacion_id, (recargosPorLiquidacion.get(r.liquidacion_id) || 0) + valor);
      }

      for (const liq of liquidacionesNomina) {
        if (!liquidacionIdsParaRecargos.includes(liq.id)) continue;
        const recargoLiq = recargosPorLiquidacion.get(liq.id) || 0;
        // Fallback: si la tabla `recargos` no devuelve nada (filtros restrictivos)
        // pero la liquidación tiene un `total_recargos` en su columna consolidada,
        // usar ese valor como fuente alternativa.
        const recargoFallback = recargoLiq === 0 ? toNumber(liq.total_recargos) : 0;
        const conductor = liq.conductores;
        if (!conductor) continue;
        const periodoKey = `${conductor.id}|${liq.periodo_start}|${liq.periodo_end}`;
        const cd = conductoresMap.get(periodoKey);
        if (cd) {
          cd.total_recargos += recargoLiq + recargoFallback;
          totalRecargos += recargoLiq + recargoFallback;
        }
      }
    }

    const conductoresData = Array.from(conductoresMap.values()).map((cd) => {
      const { _periodos, ...rest } = cd;
      return rest;
    });

    const configDescuentos = await this.obtenerConfiguracion();
    const conceptosGenerados: ConceptoInput[] = [];
    const prestacionesConfig = configDescuentos.filter((c: any) => c.categoria === 'PRESTACION_SOCIAL' && c.activo);
    const ssConfig = configDescuentos.filter((c: any) => c.categoria === 'SEGURIDAD_SOCIAL' && c.activo);

    const configConValorDia = configDescuentos.find((c: any) => c.valor_dia_conductor != null);
    const VALOR_DIA_CONDUCTOR = configConValorDia ? toNumber(configConValorDia.valor_dia_conductor) : 78629.9;

    for (const cd of conductoresData) {
      const conductorInfo = {
        id: cd.conductor_id,
        nombre: cd.nombre,
        apellido: '',
        numero_identificacion: cd.identificacion || '',
      };

      console.log('[autocompletarNomina][conductor]', {
        placa,
        conductor_id: cd.conductor_id,
        conductor_nombre: cd.nombre,
        conductor_apellido: conductorInfo.apellido,
        numero_identificacion: conductorInfo.numero_identificacion,
        from_nomina: true,
        dias_laborados: cd.dias_laborados,
        salario_devengado: cd.salario_devengado,
        auxilio_transporte: cd.auxilio_transporte,
        total_recargos: cd.total_recargos,
        total_bonificaciones: cd.total_bonificaciones,
      });

      const salarioTotal = cd.dias_laborados * VALOR_DIA_CONDUCTOR;
      conceptosGenerados.push({
        tipo: 'COSTO_LABORAL',
        concepto: 'SALARIO',
        conductor_id: cd.conductor_id,
        conductor: conductorInfo,
        dias: cd.dias_laborados,
        valor_unitario: VALOR_DIA_CONDUCTOR,
        valor_total: salarioTotal,
        calculado: true,
      });

      if (cd.auxilio_transporte > 0) {
        conceptosGenerados.push({
          tipo: 'COSTO_LABORAL',
          concepto: 'AUXILIO_TRANSPORTE',
          conductor_id: cd.conductor_id,
          conductor: conductorInfo,
          dias: cd.dias_laborados,
          valor_unitario: cd.dias_laborados > 0 ? cd.auxilio_transporte / cd.dias_laborados : 0,
          valor_total: cd.auxilio_transporte,
          calculado: true,
        });
      }

      // BONIFICACION: usar SOLO los bonos de Alimentación del mes objetivo.
      // - dias: suma de cantidades del mes (quantity) en todos los registros.
      // - valor_unitario: valor del registro con periodo_end más reciente.
      // - valor_total: dias * valor_unitario.
      // Solo se crea el concepto si hay bonos de alimentación con cantidad > 0.
      if (cd.bonos_alimentacion_cantidad > 0 && cd.bonos_alimentacion_valor_unitario > 0) {
        const cantBonos = cd.bonos_alimentacion_cantidad;
        const vrUnitBonos = cd.bonos_alimentacion_valor_unitario;
        const totalBonos = cantBonos * vrUnitBonos;
        conceptosGenerados.push({
          tipo: 'COSTO_LABORAL',
          concepto: 'BONIFICACION',
          conductor_id: cd.conductor_id,
          conductor: conductorInfo,
          dias: cantBonos,
          valor_unitario: vrUnitBonos,
          valor_total: totalBonos,
          calculado: true,
        });
      }

      // RECARGOS: si hay recargos para el periodo, crear el concepto con
      // dias=1 y valor_unitario=total_recargos (mostrando el total en el campo
      // editable, ya que no hay días asociados). No se crea si el total es 0.
      if (cd.total_recargos > 0) {
        conceptosGenerados.push({
          tipo: 'COSTO_LABORAL',
          concepto: 'RECARGOS',
          conductor_id: cd.conductor_id,
          conductor: conductorInfo,
          dias: 1,
          valor_unitario: cd.total_recargos,
          valor_total: cd.total_recargos,
          calculado: true,
        });
      }

      const salarioCalculado = cd.dias_laborados * VALOR_DIA_CONDUCTOR;
      const basePrestaciones = salarioCalculado + cd.auxilio_transporte + cd.total_recargos;
      const baseVacacionesSS = salarioCalculado + cd.total_recargos;

      for (const cfg of prestacionesConfig) {
        const porcentaje = toNumber(cfg.porcentaje);
        const base = cfg.concepto === 'VACACIONES' ? baseVacacionesSS : basePrestaciones;
        const valorTotal = base * (porcentaje / 100);
        conceptosGenerados.push({
          tipo: 'COSTO_LABORAL',
          concepto: cfg.concepto,
          conductor_id: cd.conductor_id,
          conductor: conductorInfo,
          porcentaje,
          base_calculo: base,
          valor_total: valorTotal,
          calculado: true,
        });
      }

      for (const cfg of ssConfig) {
        const porcentaje = toNumber(cfg.porcentaje);
        const valorTotal = baseVacacionesSS * (porcentaje / 100);
        conceptosGenerados.push({
          tipo: 'COSTO_LABORAL',
          concepto: cfg.concepto,
          conductor_id: cd.conductor_id,
          conductor: conductorInfo,
          porcentaje,
          base_calculo: baseVacacionesSS,
          valor_total: valorTotal,
          calculado: true,
        });
      }
    }

    const impuestosConfig = configDescuentos.filter((c: any) => c.categoria === 'IMPUESTO' && c.activo);
    const conceptosImpuestos: ConceptoInput[] = [];
    for (const cfg of impuestosConfig) {
      const porcentaje = toNumber(cfg.porcentaje);
      conceptosImpuestos.push({
        tipo: 'IMPUESTO',
        concepto: cfg.concepto,
        porcentaje,
        valor_total: 0,
        calculado: true,
      });
    }

    console.log('[autocompletarNomina][response] conceptosGenerados count:', conceptosGenerados.length);
    console.log('[autocompletarNomina][response] sample[0..1]:', JSON.stringify(conceptosGenerados.slice(0, 2), null, 2));

    return {
      vehiculo,
      conductores: conductoresData,
      conceptos: conceptosGenerados,
      conceptos_impuestos: conceptosImpuestos,
      resumen: {
        base_salarios: conductoresData.reduce((s, c) => s + c.dias_laborados * VALOR_DIA_CONDUCTOR, 0),
        base_auxilio_transporte: totalAuxilioTransporte,
        base_recargos: totalRecargos,
        base_bonificaciones: totalBonificaciones,
        total_base: conductoresData.reduce((s, c) => s + c.dias_laborados * VALOR_DIA_CONDUCTOR, 0) + totalAuxilioTransporte + totalRecargos,
      },
    };
  },

  // ── GENERAR BORRADOR: AHORA CREA liquidacion_tercero_final REAL EN BD ──

  async generarBorrador(input: GenerarBorradorInput) {
    const { liquidacion_servicio_id, liquidacion_servicio_ids, placa: placaFiltro, user_id, onProgress } = input;

    // Soportar tanto ID único (backward compat) como array de IDs
    const liqIds: string[] = liquidacion_servicio_ids && liquidacion_servicio_ids.length > 0
      ? liquidacion_servicio_ids
      : liquidacion_servicio_id
        ? [liquidacion_servicio_id]
        : [];

    if (liqIds.length === 0) {
      throw new Error('Se requiere al menos un liquidacion_servicio_id');
    }

    console.log(`[generarBorrador] START ${liqIds.length} liquidacion(es) placa=${placaFiltro || 'TODAS'}`);

    // Progress acumulativo: cada liq contribuye (95/total)%, dejando 5% para
    // operaciones finales. El usuario ve un progress smooth de 0 a 100
    // sin resets ni sub-steps confusos.
    const totalLiqs = liqIds.length;
    const allTerceros: any[] = [];
    let allLiqServicioInfo: any = null;

    onProgress?.({ processed: 0, total: 100, currentStep: `Iniciando procesamiento de ${totalLiqs} liquidación(es) de servicio...` });

    for (let liqIdx = 0; liqIdx < liqIds.length; liqIdx++) {
      const liqId = liqIds[liqIdx];
      const liqProgress = Math.round((liqIdx / totalLiqs) * 95);

      onProgress?.({
        processed: liqProgress,
        total: 100,
        currentStep: `Obteniendo liquidaciones de servicio (${liqIdx + 1}/${totalLiqs})...`
      });

      const liqResult = await this._procesarLiquidacion(liqId, placaFiltro, user_id, onProgress, liqProgress, 95 / totalLiqs, liqIdx, totalLiqs);

      if (liqResult.terceros.length > 0) {
        allTerceros.push(...liqResult.terceros);
      }
      // Usar la info de la primera liq como referencia
      if (!allLiqServicioInfo) {
        allLiqServicioInfo = liqResult.liquidacion_servicio;
      }
    }

    onProgress?.({ processed: 100, total: 100, currentStep: 'Generación completada' });
    console.log(`[generarBorrador] DONE. Total entries: ${allTerceros.length}, liqs: ${totalLiqs}`);

    return {
      liquidacion_servicio: allLiqServicioInfo,
      terceros: allTerceros,
    };
  },

  // ── Procesa UNA liquidación de servicio con progress suave dentro del rango asignado ──
  async _procesarLiquidacion(
    liquidacion_servicio_id: string,
    placaFiltro: string | undefined,
    user_id: string | undefined,
    onProgress: ((data: { processed: number; total: number; currentStep: string }) => void) | undefined,
    progressStart: number,
    progressWeight: number,
    liqIdx: number,
    totalLiqs: number
  ) {
    const liqServicio = await prisma.liquidacion_servicio.findUnique({
      where: { id: liquidacion_servicio_id },
      include: {
        terceros_items: { orderBy: { orden: 'asc' } },
        factura_items: { include: { factura: { select: { numero_factura: true } } } },
        cliente: { select: { id: true, nombre: true, nit: true } },
      },
    });

    if (!liqServicio) {
      console.warn(`[_procesarLiquidacion] liq ${liquidacion_servicio_id} no encontrada`);
      return { liquidacion_servicio: null, terceros: [] };
    }

    const mes = liqServicio.mes;
    const anio = liqServicio.anio;

    // Filtrar terceros_items por placa
    let tercerosFiltrados = placaFiltro
      ? liqServicio.terceros_items.filter((lt: any) =>
          (lt.placa || '').toUpperCase().replace(/[^A-Z0-9]/g, '') ===
          placaFiltro.toUpperCase().replace(/[^A-Z0-9]/g, '')
        )
      : liqServicio.terceros_items;

    if (placaFiltro && tercerosFiltrados.length === 0) {
      console.log(`[_procesarLiquidacion] liq ${liqServicio.consecutivo}: 0 items para placa ${placaFiltro}`);
      return { liquidacion_servicio: null, terceros: [] };
    }

    const placasMap = new Map<string, typeof liqServicio.terceros_items>();
    for (const lt of tercerosFiltrados) {
      if (!placasMap.has(lt.placa)) placasMap.set(lt.placa, []);
      placasMap.get(lt.placa)!.push(lt);
    }

    const resultados: any[] = [];
    const facturasNumeros = liqServicio.factura_items
      .map((fi: any) => fi.factura?.numero_factura)
      .filter(Boolean)
      .join(', ');

    const placaEntries = Array.from(placasMap.entries());

    for (let idx = 0; idx < placaEntries.length; idx++) {
      const [placa, terceros] = placaEntries[idx];
      try {
        const primerTercero = terceros[0] as any;
        const terceroId = primerTercero.tercero_id || null;

        onProgress?.({
          processed: Math.round(progressStart + progressWeight * 0.10),
          total: 100,
          currentStep: `Obteniendo liquidaciones de servicio (${liqIdx + 1}/${totalLiqs})...`
        });
        const cierrePersistido = await prisma.liquidacion_tercero_final.findFirst({
          where: {
            tercero_id: terceroId,
            placa: primerTercero.placa,
            mes,
            anio,
            estado: 'BORRADOR',
            deleted_at: null,
          },
          include: {
            items: { where: { deleted_at: null } },
            conceptos: {
              where: { deleted_at: null },
              include: { conductor: true },
              orderBy: [{ orden: 'asc' }, { concepto: 'asc' }],
            },
          },
        });

        onProgress?.({
          processed: Math.round(progressStart + progressWeight * 0.30),
          total: 100,
          currentStep: `Obteniendo liquidaciones de servicio (${liqIdx + 1}/${totalLiqs})...`
        });
        const nominaData = await getNominaCached({ placa, mes, anio });

        onProgress?.({
          processed: Math.round(progressStart + progressWeight * 0.50),
          total: 100,
          currentStep: `Obteniendo liquidaciones de servicio (${liqIdx + 1}/${totalLiqs})...`
        });
        let anticiposData: { anticipos: any[] } = { anticipos: [] };
        try {
          anticiposData = await this.obtenerAnticiposVehiculo({ placa, mes, anio });
        } catch (e) {
          console.warn(`[_procesarLiquidacion] anticipos ${placa}:`, (e as any).message);
        }

        onProgress?.({
          processed: Math.round(progressStart + progressWeight * 0.70),
          total: 100,
          currentStep: `Obteniendo liquidaciones de servicio (${liqIdx + 1}/${totalLiqs})...`
        });
        const ltItemsRaw = await prisma.liquidacion_tercero.findMany({
          where: { id: { in: terceros.map((t: any) => t.id) } },
          include: {
            tercero: { select: { id: true, nombre_completo: true, identificacion: true, tipo_persona: true } },
            item: { select: { id: true, numero_planilla: true } },
          },
        });

        onProgress?.({
          processed: Math.round(progressStart + progressWeight * 0.90),
          total: 100,
          currentStep: `Obteniendo liquidaciones de servicio (${liqIdx + 1}/${totalLiqs})...`
        });
        let anticiposConceptos: ConceptoInput[] = [];
        try {
          anticiposConceptos = anticiposData.anticipos.map((a: any, aidx: number) => ({
            tipo: 'ANTICIPO' as const,
            concepto: a.concepto || 'ANTICIPO',
            dias: 1,
            valor_unitario: a.valor,
            valor_total: a.valor,
            observaciones: a.fecha ? new Date(a.fecha).toISOString().slice(0, 10) : null,
            calculado: true,
            orden: 9000 + aidx,
          }));
        } catch (_) { /* already handled */ }

        const conceptosActuales = cierrePersistido
          ? (cierrePersistido.conceptos || []).map(serializeConcepto)
          : [...nominaData.conceptos.map(serializeConcepto), ...anticiposConceptos];

        const totalesActuales = {
          total_costos_laborales: conceptosActuales
            .filter((c: any) => c.tipo === 'COSTO_LABORAL')
            .reduce((s: number, c: any) => s + (c.valor_total || 0), 0),
          total_gastos_operativos: conceptosActuales
            .filter((c: any) => c.tipo === 'GASTO_OPERATIVO')
            .reduce((s: number, c: any) => s + (c.valor_total || 0), 0),
          total_impuestos: conceptosActuales
            .filter((c: any) => c.tipo === 'IMPUESTO')
            .reduce((s: number, c: any) => s + (c.valor_total || 0), 0),
          total_anticipos: conceptosActuales
            .filter((c: any) => c.tipo === 'ANTICIPO')
            .reduce((s: number, c: any) => s + (c.valor_total || 0), 0),
        };

        const valorLiquidarConsolidado = terceros.reduce(
          (sum: number, lt: any) => sum + toNumber(lt.valor_liquidar),
          0
        );

        const cierreFinal: any = cierrePersistido
          ? { ...cierrePersistido }
          : {
              id: null,
              consecutivo: null,
              liquidacion_servicio_id,
              tercero_id: terceroId,
              vehiculo_id: null,
              placa: primerTercero.placa,
              mes,
              anio,
              valor_liquidar: valorLiquidarConsolidado,
              total_costos_laborales: totalesActuales.total_costos_laborales,
              total_gastos_operativos: totalesActuales.total_gastos_operativos,
              total_impuestos: totalesActuales.total_impuestos,
              total_descuentos:
                totalesActuales.total_costos_laborales +
                totalesActuales.total_gastos_operativos +
                totalesActuales.total_impuestos +
                totalesActuales.total_anticipos,
              total_pagar: valorLiquidarConsolidado -
                (totalesActuales.total_costos_laborales +
                  totalesActuales.total_gastos_operativos +
                  totalesActuales.total_impuestos +
                  totalesActuales.total_anticipos),
              estado: 'BORRADOR',
              motivo_anulacion: null,
              creado_por_id: user_id || null,
              actualizado_por_id: null,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              deleted_at: null,
              adicionales: [],
              items: [],
              conceptos: [],
            };

        const baseEntry = {
          placa,
          liquidacion_tercero_final: serializeLiquidacionTerceroFinal(cierreFinal),
          conceptos: conceptosActuales,
          resumen_nomina: nominaData.resumen,
          conductores: nominaData.conductores,
          items_adicionales: Array.isArray(cierrePersistido?.adicionales)
            ? (cierrePersistido.adicionales as any[]).map((a: any) => ({
                ...a,
                valor_unitario: toNumber(a.valor_unitario),
                cantidad: toNumber(a.cantidad),
                valor_liquidar: toNumber(a.valor_liquidar),
              }))
            : [],
        };

        const itemIdsOriginales = ltItemsRaw.map((it: any) => it.id);

        const entries = ltItemsRaw.map((ltItem: any) => {
          const ltItemData = serializeLiquidacionTerceroFinal(ltItem);
          return {
            ...baseEntry,
            items: itemIdsOriginales,
            liquidacion_tercero: {
              ...ltItemData,
              id: cierreFinal.id,
              liquidacion_tercero_id_original: ltItem.id,
              total_costos_laborales: totalesActuales.total_costos_laborales,
              total_gastos_operativos: totalesActuales.total_gastos_operativos,
              total_impuestos: totalesActuales.total_impuestos,
              total_descuentos:
                totalesActuales.total_costos_laborales +
                totalesActuales.total_gastos_operativos +
                totalesActuales.total_impuestos +
                totalesActuales.total_anticipos,
              total_pagar: toNumber(ltItem.valor_liquidar) -
                (totalesActuales.total_costos_laborales +
                  totalesActuales.total_gastos_operativos +
                  totalesActuales.total_impuestos +
                  totalesActuales.total_anticipos),
            },
          };
        });

        resultados.push(...entries);
      } catch (error: any) {
        console.error(`[_procesarLiquidacion] Error placa ${placa}:`, error);
        resultados.push({
          placa,
          error: error.message,
          conceptos: [],
        });
      }
    }

    return {
      liquidacion_servicio: {
        id: liqServicio.id,
        consecutivo: liqServicio.consecutivo,
        mes,
        anio,
        cliente: liqServicio.cliente,
        facturas: facturasNumeros,
      },
      terceros: resultados,
    };
  },

  // ── (legacy) generarBorrador: AHORA DELEGADO A _procesarLiquidacion ──
  // Se mantiene el método antiguo como wrapper por compatibilidad con el endpoint
  // síncrono (POST /generar-borrador) que aún se usa en otros lugares.

  // ── GUARDAR BORRADOR (persistencia explícita) ──
  // Crea (o actualiza) el cierre final, su pivote de items y sus conceptos en
  // una sola transacción. Es el ÚNICO endpoint que persiste el resultado de
  // la previsualización generada por `generarBorrador` (que es read-only).

  async guardarBorrador(params: {
    id?: string;
    liquidacion_servicio_id: string;
    placa: string;
    tercero_id: string | null;
    mes: number;
    anio: number;
    item_ids: string[];
    conceptos: ConceptoInput[];
    adicionales?: AdicionalInput[];
    /// Map { conductorId: true | false }. Si el conductor no está, se usa
    /// la auto-detección por número de identificación vs propietario del vehículo.
    es_propietario_overrides?: Record<string, boolean>;
    user_id?: string;
    force_new?: boolean;
  }) {
    const {
      liquidacion_servicio_id,
      placa,
      tercero_id,
      mes,
      anio,
      item_ids,
      conceptos,
      adicionales = [],
      es_propietario_overrides = {},
      user_id,
      force_new = false,
    } = params;

    // Sanitizar overrides: solo permitir booleanos. Descartar entradas inválidas.
    const overridesSanitizados: Record<string, boolean> = {};
    if (es_propietario_overrides && typeof es_propietario_overrides === 'object') {
      for (const [k, v] of Object.entries(es_propietario_overrides)) {
        if (typeof v === 'boolean') overridesSanitizados[k] = v;
      }
    }

    // 0. Sanitizar adicionales: descartar entradas inválidas y completar
    //    campos derivados (id, valor_liquidar). Si el usuario no envía
    //    valor_liquidar, se calcula como valor_unitario * cantidad.
    const adicionalesSanitizados: AdicionalInput[] = (Array.isArray(adicionales) ? adicionales : [])
      .filter((a) => a && (toNumber(a.valor_unitario) > 0 || toNumber(a.cantidad) > 0))
      .map((a) => {
        const vUnit = toNumber(a.valor_unitario);
        const cant = toNumber(a.cantidad);
        const valorLiq = a.valor_liquidar != null ? toNumber(a.valor_liquidar) : vUnit * cant;
        return {
          id: a.id || randomUUID(),
          cliente: a.cliente || 'TRANSMERALDA',
          placa: a.placa || placa,
          tercero_nombre: a.tercero_nombre || '',
          recorrido: a.recorrido || '',
          fechas: a.fechas || '',
          valor_unitario: vUnit,
          cantidad: cant,
          valor_liquidar: valorLiq,
          // Default true si el front no lo envía (compat con datos viejos).
          aplica_impuestos: a.aplica_impuestos !== false
        } as AdicionalInput;
      });

    const adicionalesSum = adicionalesSanitizados.reduce(
      (s, a) => s + toNumber(a.valor_liquidar),
      0,
    );

    // 1. Verificar que todos los items existen y calcular valor_liquidar
    const ltItems = await prisma.liquidacion_tercero.findMany({
      where: { id: { in: item_ids }, placa: { equals: placa, mode: 'insensitive' } },
      select: { id: true, valor_liquidar: true, placa: true },
    });
    if (ltItems.length !== item_ids.length) {
      const encontrados = new Set(ltItems.map((i) => i.id));
      const faltantes = item_ids.filter((id) => !encontrados.has(id));
      throw new Error(`Items no encontrados para la placa ${placa}: ${faltantes.join(', ')}`);
    }
    const valorLiquidarItems = ltItems.reduce((s, it) => s + toNumber(it.valor_liquidar), 0);
    // El valor_liquidar del cierre final incluye los adicionales.
    const valorLiquidarTotal = valorLiquidarItems + adicionalesSum;

    // 2. Calcular totales desde los conceptos recibidos
    const conceptosConTotales = conceptos.map((c, idx) => {
      let valorTotal = c.valor_total ?? 0;
      if (valorTotal === 0 && c.dias && c.valor_unitario) {
        valorTotal = c.dias * c.valor_unitario;
      } else if (valorTotal === 0 && c.porcentaje && c.base_calculo) {
        valorTotal = c.base_calculo * (c.porcentaje / 100);
      }
      return { ...c, valor_total: valorTotal, orden: c.orden ?? idx };
    });

    const totalCostos = conceptosConTotales
      .filter((c: any) => c.tipo === 'COSTO_LABORAL')
      .reduce((s: number, c: any) => s + (c.valor_total || 0), 0);
    const totalGastos = conceptosConTotales
      .filter((c: any) => c.tipo === 'GASTO_OPERATIVO')
      .reduce((s: number, c: any) => s + (c.valor_total || 0), 0);
    const totalImpuestos = conceptosConTotales
      .filter((c: any) => c.tipo === 'IMPUESTO')
      .reduce((s: number, c: any) => s + (c.valor_total || 0), 0);
    const totalAnticipos = conceptosConTotales
      .filter((c: any) => c.tipo === 'ANTICIPO')
      .reduce((s: number, c: any) => s + (c.valor_total || 0), 0);
    const totalDescuentos = totalCostos + totalGastos + totalImpuestos + totalAnticipos;
    const totalPagar = valorLiquidarTotal - totalDescuentos;

    // 2.b. Verificar si ya existe un cierre APROBADA o FACTURADA para la misma
    //      placa+mes+año. Si existe y force_new=false, rechazar con 409.
    //      Si force_new=true, marcar el cierre anterior como REEMPLAZADA.
    const cierreBloqueado = await prisma.liquidacion_tercero_final.findFirst({
      where: {
        placa,
        mes,
        anio,
        estado: { in: ['APROBADA', 'FACTURADA'] },
        deleted_at: null,
      },
      orderBy: { created_at: 'desc' },
    });

    if (cierreBloqueado && !force_new) {
      throw new Error(
        `Ya existe una liquidación ${cierreBloqueado.estado} para la placa ${placa} en ${MESES[mes - 1] || 'mes'} ${anio}. Usa force_new=true para crear una nueva versión.`
      );
    }

    if (cierreBloqueado && force_new) {
      await prisma.liquidacion_tercero_final.update({
        where: { id: cierreBloqueado.id },
        data: { estado: 'REEMPLAZADA' },
      });
    }

    // 3. Si el frontend envía un `id` explícito (porque está editando un
    //    cierre existente), actualizamos ese registro en sitio. Si no, siempre
    //    creamos uno nuevo — el usuario puede tener múltiples liquidaciones
    //    distintas de la misma placa en el mismo mes/año, cada una con su
    //    propio consecutivo único.
    if (params.id) {
      const existing = await prisma.liquidacion_tercero_final.findUnique({
        where: { id: params.id },
      });

      if (!existing) {
        throw new Error('Liquidación final a actualizar no encontrada');
      }

      if (['APROBADA', 'FACTURADA', 'ANULADA'].includes(existing.estado)) {
        throw new Error(
          `No se puede modificar una liquidación en estado ${existing.estado}`,
        );
      }

      const cierreId = existing.id;
      await prisma.$transaction([
        prisma.liquidacion_tercero_final_item.deleteMany({
          where: { liquidacion_tercero_final_id: cierreId, deleted_at: null },
        }),
        prisma.liquidacion_tercero_final_concepto.deleteMany({
          where: { liquidacion_tercero_final_id: cierreId, deleted_at: null },
        }),
      ]);

      const [updated] = await prisma.$transaction([
        prisma.liquidacion_tercero_final.update({
          where: { id: cierreId },
          data: {
            valor_liquidar: valorLiquidarTotal,
            total_costos_laborales: totalCostos,
            total_gastos_operativos: totalGastos,
            total_impuestos: totalImpuestos,
            total_descuentos: totalDescuentos,
            total_pagar: totalPagar,
            actualizado_por_id: user_id || null,
            adicionales: adicionalesSanitizados as any,
            es_propietario_overrides: overridesSanitizados as any,
            items: {
              create: item_ids.map((id, idx) => ({
                id: randomUUID(),
                liquidacion_tercero_id: id,
                orden: idx,
                aplica_impuestos: true,
              })),
            },
            conceptos: {
              create: conceptosConTotales.map((c) => ({
                // SIEMPRE generar id nuevo para evitar colisiones con
                // conceptos de otros cierres que el frontend pueda estar
                // reusando desde el preview.
                id: randomUUID(),
                tipo: c.tipo,
                concepto: c.concepto,
                conductor_id: c.conductor_id || null,
                dias: c.dias ?? null,
                valor_unitario: c.valor_unitario || 0,
                porcentaje: c.porcentaje ?? null,
                valor_total: c.valor_total || 0,
                base_calculo: c.base_calculo || null,
                calculado: c.calculado || false,
                observaciones: c.observaciones || null,
                orden: c.orden ?? 0,
              })),
            },
          },
          include: {
            items: { where: { deleted_at: null } },
            conceptos: { where: { deleted_at: null }, include: { conductor: true } },
          },
        }),
      ]);

      try {
        await LiquidacionesSnapshotsService.capturar(updated.id, {
          origen: 'manual',
          usuarioId: user_id || null,
        });
      } catch (snapErr) {
        console.error('[guardarBorrador-update] Snapshot failed:', snapErr);
      }

      return {
        ok: true,
        id: updated.id,
        accion: 'updated' as const,
        cierre: updated,
      };
    }

    // 4. Crear nuevo BORRADOR (atómico: lock advisory + cálculo de
    //    consecutivo + INSERT en la MISMA transacción).
    //
    //    El bug original era: generarConsecutivo() hacía findFirst → +1,
    //    pero el INSERT se hacía FUERA de esa transacción. Entre el
    //    COMMIT de la tx de lectura y el INSERT, otra request podía leer
    //    el mismo último consecutivo y proponer el mismo string,
    //    causando colisión del unique constraint.
    //
    //    Solución: tomar pg_advisory_xact_lock, leer, calcular, hacer
    //    INSERT — todo dentro de UNA sola transacción. El lock se libera
    //    al COMMIT, pero para entonces el INSERT ya está persistido,
    //    por lo que requests posteriores verán el nuevo último consecutivo.
    //
    //    El retry con P2002 queda como defensa en profundidad por si
    //    otro endpoint futuro (no-transaccional) intenta el mismo cálculo.
    const prefix = `LIQ-TERC-${anio}-`;
    let lockHash = 0n;
    for (const ch of prefix) {
      lockHash = (lockHash * 31n + BigInt(ch.charCodeAt(0))) & 0x7fffffffffffffffn;
    }

    let created: any = null;
    let lastErr: any = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        created = await prisma.$transaction(
          async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockHash})`;

            const last = await tx.liquidacion_tercero_final.findFirst({
              where: { consecutivo: { startsWith: prefix } },
              orderBy: { consecutivo: 'desc' },
              select: { consecutivo: true },
            });

            let nextNum = 1;
            if (last?.consecutivo) {
              const match = last.consecutivo.match(/(\d+)$/);
              if (match) nextNum = parseInt(match[1], 10) + 1;
            }
            const consecutivo = `${prefix}${String(nextNum).padStart(5, '0')}`;

            return await tx.liquidacion_tercero_final.create({
              data: {
                consecutivo,
                liquidacion_servicio_id,
                tercero_id: tercero_id || null,
                vehiculo_id: null,
                placa,
                mes,
                anio,
                valor_liquidar: valorLiquidarTotal,
                total_costos_laborales: totalCostos,
                total_gastos_operativos: totalGastos,
                total_impuestos: totalImpuestos,
                total_descuentos: totalDescuentos,
                total_pagar: totalPagar,
                estado: 'BORRADOR',
                creado_por_id: user_id || null,
                adicionales: adicionalesSanitizados as any,
                es_propietario_overrides: overridesSanitizados as any,
                items: {
                  create: item_ids.map((id, idx) => ({
                    id: randomUUID(),
                    liquidacion_tercero_id: id,
                    orden: idx,
                    aplica_impuestos: true,
                  })),
                },
                conceptos: {
                  create: conceptosConTotales.map((c) => ({
                    // SIEMPRE generar id nuevo: estos conceptos se clonan de un
                    // cierre previo (preview) y no pueden reutilizar ids antiguos
                    // porque violarían el unique constraint de la PK.
                    id: randomUUID(),
                    tipo: c.tipo,
                    concepto: c.concepto,
                    conductor_id: c.conductor_id || null,
                    dias: c.dias ?? null,
                    valor_unitario: c.valor_unitario || 0,
                    porcentaje: c.porcentaje ?? null,
                    valor_total: c.valor_total || 0,
                    base_calculo: c.base_calculo || null,
                    calculado: c.calculado || false,
                    observaciones: c.observaciones || null,
                    orden: c.orden ?? 0,
                  })),
                },
              },
              include: {
                items: { where: { deleted_at: null } },
                conceptos: { where: { deleted_at: null }, include: { conductor: true } },
              },
            });
          },
          { timeout: 30_000, maxWait: 10_000 },
        );
        break;
      } catch (e: any) {
        if (e?.code === 'P2002') {
          lastErr = e;
          console.warn(
            `[guardarBorrador-create] Colisión inesperada de consecutivo, reintentando (intento ${attempt + 1}/5)`,
          );
          continue;
        }
        throw e;
      }
    }
    if (!created) {
      throw new Error(
        `No se pudo generar un consecutivo único tras 5 intentos: ${lastErr?.message}`,
      );
    }

    // Snapshot post-create
    try {
      await LiquidacionesSnapshotsService.capturar(created.id, {
        origen: 'manual',
        usuarioId: user_id || null,
      });
    } catch (snapErr) {
      console.error('[guardarBorrador-create] Snapshot failed:', snapErr);
    }

    return {
      ok: true,
      id: created.id,
      accion: 'created' as const,
      cierre: created,
    };
  },

  // ── RECALCULAR TOTALES DEL CIERRE FINAL ──

  async recalcularTotales(liquidacionTerceroFinalId: string) {
    const conceptos = await prisma.liquidacion_tercero_final_concepto.findMany({
      where: { liquidacion_tercero_final_id: liquidacionTerceroFinalId, deleted_at: null },
    });

    const costosLaborales = conceptos
      .filter((c: any) => c.tipo === 'COSTO_LABORAL')
      .reduce((s: number, c: any) => s + toNumber(c.valor_total), 0);
    const gastosOperativos = conceptos
      .filter((c: any) => c.tipo === 'GASTO_OPERATIVO')
      .reduce((s: number, c: any) => s + toNumber(c.valor_total), 0);
    const impuestos = conceptos
      .filter((c: any) => c.tipo === 'IMPUESTO')
      .reduce((s: number, c: any) => s + toNumber(c.valor_total), 0);
    const anticipos = conceptos
      .filter((c: any) => c.tipo === 'ANTICIPO')
      .reduce((s: number, c: any) => s + toNumber(c.valor_total), 0);
    const totalDescuentos = costosLaborales + gastosOperativos + impuestos + anticipos;

    const cierre = await prisma.liquidacion_tercero_final.findUnique({
      where: { id: liquidacionTerceroFinalId },
      select: { valor_liquidar: true, adicionales: true },
    });
    const valorLiquidar = cierre ? toNumber(cierre.valor_liquidar) : 0;
    const totalPagar = valorLiquidar - totalDescuentos;

    await prisma.liquidacion_tercero_final.update({
      where: { id: liquidacionTerceroFinalId },
      data: {
        total_costos_laborales: costosLaborales,
        total_gastos_operativos: gastosOperativos,
        total_impuestos: impuestos,
        total_descuentos: totalDescuentos,
        total_pagar: totalPagar,
      },
    });

    // Snapshot post-recalcular
    try {
      await LiquidacionesSnapshotsService.capturar(liquidacionTerceroFinalId, {
        origen: 'manual',
        usuarioId: null,
      });
    } catch (snapErr) {
      console.error('[recalcularTotales] Snapshot failed:', snapErr);
    }

    return {
      total_costos_laborales: costosLaborales,
      total_gastos_operativos: gastosOperativos,
      total_impuestos: impuestos,
      total_descuentos: totalDescuentos,
      total_pagar: totalPagar,
    };
  },

  // ── CALCULAR IMPUESTOS DESDE VALOR LIQUIDAR ──

  async calcularImpuestos(liquidacionTerceroFinalId: string) {
    const cierre = await prisma.liquidacion_tercero_final.findUnique({
      where: { id: liquidacionTerceroFinalId },
      select: { valor_liquidar: true, adicionales: true, estado: true },
    });
    if (!cierre) throw new Error('Liquidación final de tercero no encontrada');

    const allItems = await prisma.liquidacion_tercero_final_item.findMany({
      where: {
        liquidacion_tercero_final_id: liquidacionTerceroFinalId,
        deleted_at: null,
      },
      include: {
        liquidacion_tercero: { select: { valor_liquidar: true } },
      },
    });

    // Base A: suma de valor_liquidar de los items marcados con
    // `aplica_impuestos: true`. Se usa para RETENCION_ICA, AVISOS_TABLEROS
    // y SOBRETASA_BOMBERIL.
    const baseConImpuestos = allItems
      .filter((it: any) => it.aplica_impuestos === true)
      .reduce(
        (s: number, it: any) => s + toNumber(it.liquidacion_tercero?.valor_liquidar || 0),
        0
      );

    // Base B: suma de valor_liquidar de TODOS los items del pivote, sin
    // importar el toggle. Se usa para RETENCION_FUENTE (que grava sobre
    // el total facturado al tercero, no solo sobre los items con
    // impuestos adicionales como ICA/avisos/bomberil).
    const baseTotalItems = allItems.reduce(
      (s: number, it: any) => s + toNumber(it.liquidacion_tercero?.valor_liquidar || 0),
      0
    );

    // Filtra los adicionales que el usuario marcó con `aplica_impuestos: false`.
    // Default: true (los adicionales viejos sin el flag siguen gravando).
    const adicionalesParaImpuestos = Array.isArray(cierre.adicionales)
      ? (cierre.adicionales as any[]).filter(
          (a: any) => a?.aplica_impuestos !== false
        )
      : [];
    const adicionalesSum = adicionalesParaImpuestos.reduce(
      (s: number, a: any) => s + toNumber(a.valor_liquidar),
      0
    );

    // Para RETENCION_ICA y similares: base = items con impuestos + adicionales que aplican.
    // Para RETENCION_FUENTE: base = TODOS los items + adicionales que aplican.
    const baseConImpuestosTotal = baseConImpuestos + adicionalesSum;
    const baseTotalConAdicionales = baseTotalItems + adicionalesSum;

    const configDescuentos = await this.obtenerConfiguracion();
    const impuestosConfig = configDescuentos.filter((c: any) => c.categoria === 'IMPUESTO' && c.activo);

    const conceptosImpuestos: ConceptoInput[] = [];
    for (const cfg of impuestosConfig) {
      const porcentaje = toNumber(cfg.porcentaje);
      // Determinar la base según la configuración del impuesto.
      // Por defecto: base imponible (items con aplica_impuestos=true + adicionales).
      // Si la config pide `TOTAL_VALOR_LIQUIDAR`, usar la suma de TODOS los
      // items sin filtrar por el toggle (caso de RETENCION_FUENTE).
      // Como salvaguarda adicional, RETENCION_FUENTE siempre usa la base
      // total sin importar el `base_calculo` de su config, porque grava
      // sobre el total facturado al tercero.
      let baseCalculo = baseConImpuestosTotal;
      if (cfg.concepto === 'RETENCION_FUENTE' || cfg.base_calculo === 'TOTAL_VALOR_LIQUIDAR') {
        baseCalculo = baseTotalConAdicionales;
      } else if (cfg.base_calculo === 'RETENCION_ICA') {
        // AVISOS_TABLEROS y SOBRETASA_BOMBERIL usan como base el cálculo
        // de RETENCION_ICA ya realizado.
        const retIca = conceptosImpuestos.find((c: any) => c.concepto === 'RETENCION_ICA');
        if (retIca) baseCalculo = retIca.valor_total;
      }
      conceptosImpuestos.push({
        tipo: 'IMPUESTO',
        concepto: cfg.concepto,
        porcentaje,
        base_calculo: baseCalculo,
        valor_total: baseCalculo * (porcentaje / 100),
        calculado: true,
      });
    }

    // Persistir automáticamente: borrar conceptos IMPUESTO anteriores del
    // cierre y crear los recién calculados. Esto garantiza que la sección
    // IMPUESTOS Y RETENCIONES quede poblada apenas se carga el editor, sin
    // requerir que el usuario interactúe con el toggle de items.
    if (['BORRADOR', 'LIQUIDADA'].includes(cierre.estado) && conceptosImpuestos.length > 0) {
      await prisma.$transaction([
        prisma.liquidacion_tercero_final_concepto.deleteMany({
          where: {
            liquidacion_tercero_final_id: liquidacionTerceroFinalId,
            tipo: 'IMPUESTO',
            deleted_at: null,
          },
        }),
        prisma.liquidacion_tercero_final_concepto.createMany({
          data: conceptosImpuestos.map((c) => ({
            id: randomUUID(),
            liquidacion_tercero_final_id: liquidacionTerceroFinalId,
            tipo: c.tipo,
            concepto: c.concepto,
            valor_unitario: 0,
            porcentaje: c.porcentaje,
            valor_total: c.valor_total,
            base_calculo: c.base_calculo,
            calculado: true,
            orden: 0,
          })),
        }),
      ]);

      // Actualizar el total_impuestos del cierre para que el resumen se vea
      // consistente con los conceptos recién creados.
      const totalImpuestos = conceptosImpuestos.reduce(
        (s: number, c: any) => s + toNumber(c.valor_total),
        0
      );
      await prisma.liquidacion_tercero_final.update({
        where: { id: liquidacionTerceroFinalId },
        data: { total_impuestos: totalImpuestos },
      });
    }

    return conceptosImpuestos;
  },

  // ── HISTORIAL: AHORA CONSULTA liquidacion_tercero_final ──

  async listarHistorial(filtros: any) {
    const page = Number(filtros.page) || 1;
    const limit = Number(filtros.limit) || 50;
    const skip = (page - 1) * limit;

    const where: any = { deleted_at: null };

    if (filtros.placa) where.placa = { contains: filtros.placa, mode: 'insensitive' };
    if (filtros.mes) where.mes = Number(filtros.mes);
    if (filtros.anio) where.anio = Number(filtros.anio);
    if (filtros.tercero_id) where.tercero_id = filtros.tercero_id;
    if (filtros.busqueda) {
      where.OR = [
        { placa: { contains: filtros.busqueda, mode: 'insensitive' } },
        { consecutivo: { contains: filtros.busqueda, mode: 'insensitive' } },
        { tercero: { nombre_completo: { contains: filtros.busqueda, mode: 'insensitive' } } },
        { liquidacion_servicio: { consecutivo: { contains: filtros.busqueda, mode: 'insensitive' } } },
      ];
    }
    // Nota: ya no filtramos por `conceptos: { some: {} }` para que aparezcan
    // cierres que están en proceso de construcción (tienen adicionales o
    // items del pivote pero todavía no tienen conceptos cargados).

    // Modo lite: SOLO los campos que la tabla del listado necesita.
    // Minimiza el payload: nada de creado_por, actualizado_por, motivo_anulacion, etc.
    const includeBase: any = {
          tercero: {
            select: { nombre_completo: true },
          },
        }
    

    const findArgs: any = {
      where,
      include: includeBase,
      orderBy: [{ anio: 'desc' }, { mes: 'desc' }, { created_at: 'desc' }],
      skip,
      take: limit,
    };

    // En modo lite, además hacemos SELECT explícito para no traer el resto de
    // columnas del modelo (timestamps, ids internos, motivo_anulacion, etc.).
      findArgs.select = {
        id: true,
        consecutivo: true,
        placa: true,
        mes: true,
        anio: true,
        valor_liquidar: true,
        total_costos_laborales: true,
        total_gastos_operativos: true,
        total_impuestos: true,
        total_descuentos: true,
        total_pagar: true,
        estado: true,
        created_at: true,
        // FK selects (Prisma permite select+include con take en relations)
        tercero: includeBase.tercero,
        usuarios_creado_por: {
          select: { id: true, nombre: true, correo: true },
        },
      };
      delete findArgs.include;

    const [items, total] = await Promise.all([
      prisma.liquidacion_tercero_final.findMany(findArgs),
      prisma.liquidacion_tercero_final.count({ where }),
    ]);

    // Obtener conteo de snapshots para cada item
    const itemIds = items.map((i: any) => i.id);
    const snapshotCounts = await prisma.liquidacion_tercero_final_snapshot.groupBy({
      by: ['liquidacion_tercero_final_id'],
      where: { liquidacion_tercero_final_id: { in: itemIds } },
      _count: { id: true },
    });
    const snapshotMap = new Map<string, number>();
    for (const sc of snapshotCounts) {
      snapshotMap.set(sc.liquidacion_tercero_final_id, sc._count.id);
    }

    return {
      items: items.map((item: any) => {
          const factura = item.liquidacion_servicio?.factura_items?.[0]?.factura;
          const creador = item.usuarios_creado_por;
          return {
            id: item.id,
            consecutivo: item.consecutivo,
            placa: item.placa,
            mes: item.mes,
            anio: item.anio,
            estado: item.estado,
            valor_liquidar: toNumber(item.valor_liquidar),
            total_costos_laborales: toNumber(item.total_costos_laborales),
            total_gastos_operativos: toNumber(item.total_gastos_operativos),
            total_impuestos: toNumber(item.total_impuestos),
            total_descuentos: toNumber(item.total_descuentos),
            total_pagar: toNumber(item.total_pagar),
            tercero: item.tercero
              ? { nombre_completo: item.tercero.nombre_completo }
              : null,
            numero_factura: factura?.numero_factura || '',
            created_at: item.created_at,
            creado_por: creador
              ? { id: creador.id, nombre: creador.nombre, correo: creador.correo }
              : null,
            snapshot_count: snapshotMap.get(item.id) || 0,
          };
      }),
      total,
      totalPages: Math.ceil(total / limit),
      page,
    };
  },

  async obtenerPorId(liquidacionTerceroFinalId: string) {
    const item = await prisma.liquidacion_tercero_final.findFirst({
      where: { id: liquidacionTerceroFinalId, deleted_at: null },
      include: {
        tercero: {
          select: { id: true, nombre_completo: true, identificacion: true, tipo_persona: true },
        },
        vehiculo: {
          select: {
            id: true,
            placa: true,
            propietario_nombre: true,
            propietario_identificacion: true,
            propietario_id: true,
          },
        },
        liquidacion_servicio: {
          select: {
            id: true, consecutivo: true, mes: true, anio: true, estado: true,
            cliente: { select: { id: true, nombre: true, nit: true } },
            factura_items: {
              where: { factura: { deleted_at: null, estado: 'ACTIVA' } },
              select: {
                factura: {
                  select: { id: true, numero_factura: true, estado: true },
                },
              },
            },
          },
        },
        items: {
          where: { deleted_at: null },
          include: {
            liquidacion_tercero: {
              include: {
                tercero: {
                  select: { id: true, nombre_completo: true, identificacion: true, tipo_persona: true },
                },
                item: {
                  select: { id: true, numero_planilla: true },
                },
                liquidacion: {
                  select: {
                    id: true,
                    consecutivo: true,
                    cliente: { select: { id: true, nombre: true, nit: true } },
                    factura_items: {
                      where: { factura: { deleted_at: null, estado: 'ACTIVA' } },
                      select: {
                        factura: {
                          select: { id: true, numero_factura: true, estado: true },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          orderBy: { orden: 'asc' },
        },
        conceptos: {
          where: { deleted_at: null },
          include: {
            conductor: {
              select: { id: true, nombre: true, apellido: true, numero_identificacion: true },
            },
          },
          orderBy: [{ orden: 'asc' }, { concepto: 'asc' }],
        },
      },
    });
    if (!item) throw new Error('Liquidación final de tercero no encontrada');

    const primerItem = (item.items || [])[0]?.liquidacion_tercero;
    const fechas = (item.items || []).map((it: any) => it.liquidacion_tercero?.fechas).filter(Boolean).join(', ');

    return {
      ...serializeLiquidacionTerceroFinal(item),
      fechas: fechas || undefined,
      cantidad: primerItem ? toNumber(primerItem.cantidad) : 1,
      porcentaje_admin: primerItem ? toNumber(primerItem.porcentaje_admin) : 0,
      valor_admin: primerItem ? toNumber(primerItem.valor_admin) : 0,
      total_facturado: (item.items || []).reduce(
        (s: number, it: any) => s + (it.liquidacion_tercero ? toNumber(it.liquidacion_tercero.total_facturado) : 0),
        0
      ),
      tercero: item.tercero,
      // Números de factura consolidados del cierre: une los de la liquidación
      // de servicio principal + los de cada item del pivote, deduplicados.
      facturas: (() => {
        const nums = new Set<string>();
        for (const fi of (item.liquidacion_servicio?.factura_items || [])) {
          if (fi.factura?.numero_factura) nums.add(fi.factura.numero_factura);
        }
        for (const it of (item.items || [])) {
          for (const fi of (it.liquidacion_tercero?.liquidacion?.factura_items || [])) {
            if (fi.factura?.numero_factura) nums.add(fi.factura.numero_factura);
          }
        }
        return Array.from(nums).join(', ');
      })(),
      liquidacion: item.liquidacion_servicio
        ? {
            id: item.liquidacion_servicio.id,
            consecutivo: item.liquidacion_servicio.consecutivo,
            mes: item.liquidacion_servicio.mes,
            anio: item.liquidacion_servicio.anio,
            estado: item.liquidacion_servicio.estado,
            cliente: item.liquidacion_servicio.cliente,
            facturas: (item.liquidacion_servicio.factura_items || [])
              .map((fi: any) => fi.factura?.numero_factura)
              .filter(Boolean)
              .join(', '),
            factura_items: (item.liquidacion_servicio.factura_items || []).map((fi: any) => ({
              factura: fi.factura
                ? { id: fi.factura.id, numero_factura: fi.factura.numero_factura, estado: fi.factura.estado }
                : null,
            })),
          }
        : null,
      items: (item.items || [])
        .map((it: any) => {
          const itemFacturaNums = (it.liquidacion_tercero?.liquidacion?.factura_items || [])
            .map((fi: any) => fi.factura?.numero_factura)
            .filter(Boolean);
          return {
            id: it.id,
            orden: it.orden,
            aplica_impuestos: it.aplica_impuestos ?? true,
            liquidacion_tercero: it.liquidacion_tercero
              ? {
                  ...it.liquidacion_tercero,
                  valor_unitario: toNumber(it.liquidacion_tercero.valor_unitario),
                  cantidad: toNumber(it.liquidacion_tercero.cantidad),
                  total_facturado: toNumber(it.liquidacion_tercero.total_facturado),
                  porcentaje_admin: toNumber(it.liquidacion_tercero.porcentaje_admin),
                  valor_admin: toNumber(it.liquidacion_tercero.valor_admin),
                  valor_liquidar: toNumber(it.liquidacion_tercero.valor_liquidar),
                  ingreso_extra_global: toNumber(it.liquidacion_tercero.ingreso_extra_global),
                  ingresos_extra_aval: toNumber(it.liquidacion_tercero.ingresos_extra_aval),
                  ingreso_empresa: toNumber(it.liquidacion_tercero.ingreso_empresa),
                }
              : null,
            facturas: Array.from(new Set(itemFacturaNums)).join(', '),
          };
        })
        // Orden estable por número de factura (sort natural: TM-6826 < TM-6827 < TM-6828).
        // Los items sin factura van al final para no desordenar a los que sí tienen.
        .sort((a, b) => {
          const aNums = (a.facturas || '').split(/[\s,]+/).filter(Boolean);
          const bNums = (b.facturas || '').split(/[\s,]+/).filter(Boolean);
          if (aNums.length === 0 && bNums.length === 0) return 0;
          if (aNums.length === 0) return 1;
          if (bNums.length === 0) return -1;
          return aNums[0].localeCompare(bNums[0], undefined, {
            numeric: true,
            sensitivity: 'base',
          });
        }),
      // Filas virtuales adicionales (ej: pagos manuales al propietario que
      // no provienen de un item de liquidacion_servicio). Se exponen en el
      // mismo shape que `items` para que la UI y el PDF las rendericen como
      // últimas filas de la tabla. El backend ya incluye su valor en
      // `valor_liquidar` y `total_pagar`, y se refleja como ingreso negativo
      // en `ingreso_empresa` del lado Cotransmeq.
      items_adicionales: (Array.isArray(item.adicionales) ? item.adicionales : []).map((a: any) => ({
        ...a,
        valor_unitario: toNumber(a.valor_unitario),
        cantidad: toNumber(a.cantidad),
        valor_liquidar: toNumber(a.valor_liquidar),
      })),
      conceptos: (item.conceptos || []).map(serializeConcepto),
    };
  },

  // ── REEMPLAZAR ITEMS DEL PIVOTE (descartar items no deseados) ──

  async reemplazarItems(liquidacionTerceroFinalId: string, liquidacionTerceroIds: string[]) {
    // Verificar que el cierre existe
    const cierre = await prisma.liquidacion_tercero_final.findUnique({
      where: { id: liquidacionTerceroFinalId },
    });
    if (!cierre) throw new Error('Liquidación final de tercero no encontrada');

    // Verificar que todos los IDs existen
    const itemsValidos = await prisma.liquidacion_tercero.findMany({
      where: { id: { in: liquidacionTerceroIds } },
      select: { id: true, placa: true, tercero_id: true, liquidacion_id: true, valor_liquidar: true },
    });
    if (itemsValidos.length !== liquidacionTerceroIds.length) {
      const idsEncontrados = new Set(itemsValidos.map((i) => i.id));
      const faltantes = liquidacionTerceroIds.filter((id) => !idsEncontrados.has(id));
      throw new Error(`Items no encontrados: ${faltantes.join(', ')}`);
    }

    // 1. Reemplazar items del pivote (solo filas activas; las soft-deleted
    //    quedan en BD pero no se tocan para conservar auditoría).
    await prisma.$transaction([
      prisma.liquidacion_tercero_final_item.deleteMany({
        where: { liquidacion_tercero_final_id: liquidacionTerceroFinalId, deleted_at: null },
      }),
      ...(itemsValidos.length > 0
        ? [
            prisma.liquidacion_tercero_final_item.createMany({
              data: itemsValidos.map((it, idx) => ({
                liquidacion_tercero_final_id: liquidacionTerceroFinalId,
                liquidacion_tercero_id: it.id,
                orden: idx,
                aplica_impuestos: true,
              })),
            }),
          ]
        : []),
    ]);

    // 2. Recalcular valor_liquidar consolidado (items + adicionales)
    const valorLiquidarItems = itemsValidos.reduce(
      (s, it) => s + toNumber(it.valor_liquidar),
      0
    );
    const adicionalesSum = Array.isArray(cierre.adicionales)
      ? (cierre.adicionales as any[]).reduce((s, a) => s + toNumber(a.valor_liquidar), 0)
      : 0;
    const valorLiquidarTotal = valorLiquidarItems + adicionalesSum;
    await prisma.liquidacion_tercero_final.update({
      where: { id: liquidacionTerceroFinalId },
      data: { valor_liquidar: valorLiquidarTotal },
    });

    // 3. Recalcular totales de descuentos (pueden no cambiar, pero los hacemos
    //    por seguridad si quedó algún concepto)
    await this.recalcularTotales(liquidacionTerceroFinalId);

    // Snapshot post-reemplazar items
    try {
      await LiquidacionesSnapshotsService.capturar(liquidacionTerceroFinalId, {
        origen: 'manual',
        usuarioId: null,
      });
    } catch (snapErr) {
      console.error('[reemplazarItems] Snapshot failed:', snapErr);
    }

    return this.obtenerPorId(liquidacionTerceroFinalId);
  },

  // ── TOGGLE APLICA IMPUESTOS EN ITEM DEL PIVOTE ──

  async actualizarAplicaImpuestosItem(pivoteId: string, aplica_impuestos: boolean) {
    await prisma.liquidacion_tercero_final_item.update({
      where: { id: pivoteId },
      data: { aplica_impuestos },
    });
    const item = await prisma.liquidacion_tercero_final_item.findUnique({
      where: { id: pivoteId },
      select: { liquidacion_tercero_final_id: true },
    });
    if (!item) throw new Error('Item de pivote no encontrado');
    return this.obtenerPorId(item.liquidacion_tercero_final_id);
  },

  // ── OBTENER BONIFICACIONES POR PLACA / PERIODO / CONDUCTOR ──
  // Devuelve los bonos (cantidad + valor unitario) asociados al vehículo
  // que caen dentro del mes/año objetivo, AGRUPADOS POR CONDUCTOR.
  // Si hay varios periodos con el mismo nombre de bono del mismo conductor,
  // se consolida la cantidad y se usa el valor unitario de la liquidación
  // con periodo_end más reciente (la más vigente).
  async obtenerBonificaciones(input: { placa: string; mes: number; anio: number }) {
    const { placa, mes, anio } = input;

    const vehiculo = await prisma.vehiculos.findFirst({
      where: { placa: { contains: placa, mode: 'insensitive' } },
      select: { id: true, placa: true },
    });
    if (!vehiculo) throw new Error(`Vehículo con placa "${placa}" no encontrado`);

    const lastDay = new Date(anio, mes, 0).getDate();
    const periodoStart = `${anio}-${String(mes).padStart(2, '0')}-01`;
    const periodoEnd = `${anio}-${String(mes).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    const mesKey = `${anio}-${String(mes).padStart(2, '0')}`;

    const liquidacionesNomina: any[] = await prisma.liquidaciones.findMany({
      where: {
        liquidacion_vehiculo: { some: { vehiculo_id: vehiculo.id } },
        periodo_start: { lte: periodoEnd },
        periodo_end: { gte: periodoStart },
      },
      include: {
        bonificaciones: {
          where: { vehiculo_id: vehiculo.id },
        },
        conductores: {
          select: { id: true, nombre: true, apellido: true, numero_identificacion: true },
        },
      },
      orderBy: { periodo_end: 'desc' },
    });

    if (liquidacionesNomina.length === 0) {
      return {
        vehiculo: { id: vehiculo.id, placa: vehiculo.placa },
        mes: mesKey,
        por_conductor: [],
        total: 0,
      };
    }

    interface BonoConsolidado {
      nombre: string;
      cantidad: number;
      valor_unitario: number;
      valor_total: number;
      liquidacion_id: string;
      periodo_end: string;
    }
    interface ConductorBonos {
      conductor_id: string;
      conductor_nombre: string;
      conductor_numero_identificacion: string | null;
      bonos: BonoConsolidado[];
      total: number;
    }

    const porConductor = new Map<string, ConductorBonos>();

    for (const liq of liquidacionesNomina) {
      const conductor = liq.conductores;
      const conductorId = liq.conductor_id || 'sin-conductor';
      const conductorNombre = conductor
        ? `${conductor.nombre} ${conductor.apellido || ''}`.trim()
        : 'Sin conductor';

      if (!porConductor.has(conductorId)) {
        porConductor.set(conductorId, {
          conductor_id: conductorId,
          conductor_nombre: conductorNombre,
          conductor_numero_identificacion: conductor?.numero_identificacion || null,
          bonos: [],
          total: 0,
        });
      }
      const grupo = porConductor.get(conductorId)!;

      for (const b of (liq.bonificaciones as any[]) || []) {
        let cantidadDelMes = 0;
        try {
          const arr = typeof b.values === 'string' ? JSON.parse(b.values) : b.values;
          if (Array.isArray(arr)) {
            const itemDelMes = arr.find((it: any) => it?.mes === mesKey);
            if (itemDelMes && typeof itemDelMes.quantity === 'number') {
              cantidadDelMes = itemDelMes.quantity;
            }
          }
        } catch (_) { /* ignore */ }

        const valorUnitario = toNumber(b.value);
        const existente = grupo.bonos.find((x) => x.nombre === b.name);

        if (existente) {
          existente.cantidad += cantidadDelMes;
          if (liq.periodo_end > existente.periodo_end) {
            existente.valor_unitario = valorUnitario;
            existente.periodo_end = liq.periodo_end;
            existente.liquidacion_id = liq.id;
          }
        } else {
          grupo.bonos.push({
            nombre: b.name,
            cantidad: cantidadDelMes,
            valor_unitario: valorUnitario,
            valor_total: cantidadDelMes * valorUnitario,
            liquidacion_id: liq.id,
            periodo_end: liq.periodo_end,
          });
        }
      }
    }

    const resultado: ConductorBonos[] = Array.from(porConductor.values()).map((g) => {
      const bonos = g.bonos
        .map((b) => ({ ...b, valor_total: b.cantidad * b.valor_unitario }))
        .sort((a, b) => a.nombre.localeCompare(b.nombre));
      const total = bonos.reduce((s, b) => s + b.valor_total, 0);
      return { ...g, bonos, total };
    });

    const totalGeneral = resultado.reduce((s, g) => s + g.total, 0);

    return {
      vehiculo: { id: vehiculo.id, placa: vehiculo.placa },
      mes: mesKey,
      por_conductor: resultado,
      total: totalGeneral,
    };
  },

  // ── OBTENER ANTICIPOS DEL VEHÍCULO POR PERIODO ──
  // Consulta los anticipos de las liquidaciones de nómina asociadas al vehículo
  // en el mes/año objetivo. Devuelve el array de anticipos con su concepto,
  // fecha y valor para pre-cargar como conceptos tipo ANTICIPO.

  async obtenerAnticiposVehiculo(input: { placa: string; mes: number; anio: number }) {
    const { placa, mes, anio } = input;

    const vehiculo = await prisma.vehiculos.findFirst({
      where: { placa: { contains: placa, mode: 'insensitive' } },
      select: { id: true, placa: true },
    });
    if (!vehiculo) throw new Error(`Vehículo con placa "${placa}" no encontrado`);

    const lastDay = new Date(anio, mes, 0).getDate();
    const periodoStart = `${anio}-${String(mes).padStart(2, '0')}-01`;
    const periodoEnd = `${anio}-${String(mes).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    const liqsVehiculo = await prisma.liquidaciones.findMany({
      where: {
        liquidacion_vehiculo: { some: { vehiculo_id: vehiculo.id } },
        periodo_end: { gte: periodoStart, lte: periodoEnd },
      },
      select: { id: true },
    });

    if (liqsVehiculo.length === 0) {
      return {
        vehiculo: { id: vehiculo.id, placa: vehiculo.placa },
        anticipos: [],
        total: 0,
      };
    }

    const liqIds = liqsVehiculo.map(l => l.id);
    const anticipos = await prisma.anticipos.findMany({
      where: { liquidacion_id: { in: liqIds } },
      orderBy: { fecha: 'asc' },
    });

    const mapped = anticipos.map(a => ({
      id: a.id,
      concepto: a.concepto || 'ANTICIPO',
      fecha: a.fecha,
      valor: Number(a.valor),
    }));

    return {
      vehiculo: { id: vehiculo.id, placa: vehiculo.placa },
      anticipos: mapped,
      total: mapped.reduce((s, a) => s + a.valor, 0),
    };
  },

  async cambiarEstado(
    liquidacionTerceroFinalId: string,
    estado: string,
    userId: string,
    motivo_anulacion?: string,
  ) {
    const validEstados = ['BORRADOR', 'LIQUIDADA', 'APROBADA', 'FACTURADA', 'ANULADA'];
    if (!validEstados.includes(estado)) {
      throw new Error(`Estado invalido: ${estado}. Estados validos: ${validEstados.join(', ')}`);
    }

    const current = await prisma.liquidacion_tercero_final.findUnique({
      where: { id: liquidacionTerceroFinalId },
      include: {
        liquidacion_servicio: { select: { consecutivo: true, cliente: { select: { nombre: true } } } },
        tercero: { select: { nombre_completo: true } },
      },
    });
    if (!current) throw new Error('Liquidación final de tercero no encontrada');

    const estadoActual = current.estado || 'BORRADOR';
    const transicionesValidas: Record<string, string[]> = {
      BORRADOR: ['LIQUIDADA', 'ANULADA'],
      LIQUIDADA: ['APROBADA', 'BORRADOR', 'ANULADA'],
      APROBADA: ['LIQUIDADA', 'ANULADA', 'FACTURADA'],
      FACTURADA: ['ANULADA'],
      ANULADA: [],
      REEMPLAZADA: ['BORRADOR'],
    };

    if (!transicionesValidas[estadoActual]?.includes(estado)) {
      throw new Error(
        `Transicion no valida de ${estadoActual} a ${estado}. Transiciones permitidas: ${transicionesValidas[estadoActual]?.join(', ') || 'ninguna'}`,
      );
    }

    if (estado === 'ANULADA' && !motivo_anulacion) {
      throw new Error('Se requiere motivo para anular');
    }

    const updated = await prisma.liquidacion_tercero_final.update({
      where: { id: liquidacionTerceroFinalId },
      data: {
        estado,
        motivo_anulacion: estado === 'ANULADA' ? motivo_anulacion : null,
        actualizado_por_id: userId || null,
      },
      include: {
        tercero: { select: { id: true, nombre_completo: true, identificacion: true, tipo_persona: true } },
        liquidacion_servicio: {
          select: {
            id: true, consecutivo: true, mes: true, anio: true, estado: true,
            cliente: { select: { id: true, nombre: true, nit: true } },
          },
        },
        conceptos: {
          include: { conductor: { select: { id: true, nombre: true, apellido: true, numero_identificacion: true } } },
          orderBy: [{ orden: 'asc' }, { concepto: 'asc' }],
        },
      },
    });

    // Snapshot post-cambio de estado
    try {
      await LiquidacionesSnapshotsService.capturar(liquidacionTerceroFinalId, {
        origen: 'manual',
        usuarioId: userId || null,
      });
    } catch (snapErr) {
      console.error('[cambiarEstado] Snapshot failed:', snapErr);
    }

    return {
      ...serializeLiquidacionTerceroFinal(updated),
      tercero: updated.tercero,
      liquidacion: updated.liquidacion_servicio
        ? {
            id: updated.liquidacion_servicio.id,
            consecutivo: updated.liquidacion_servicio.consecutivo,
            mes: updated.liquidacion_servicio.mes,
            anio: updated.liquidacion_servicio.anio,
            estado: updated.liquidacion_servicio.estado,
            cliente: updated.liquidacion_servicio.cliente,
          }
        : null,
      conceptos: (updated.conceptos || []).map(serializeConcepto),
    };
  },

  // ── SOFT DELETE ──
  // Marca deleted_at en la cabecera y propaga a sus items y conceptos
  // para que dejen de aparecer en listados y detalle. NO elimina filas.

  async softDelete(liquidacionTerceroFinalId: string, userId?: string) {
    const current = await prisma.liquidacion_tercero_final.findFirst({
      where: { id: liquidacionTerceroFinalId, deleted_at: null },
      select: { id: true, estado: true, placa: true, consecutivo: true },
    });
    if (!current) {
      throw new Error('Liquidación final de tercero no encontrada o ya eliminada');
    }

    const bloqueados = ['APROBADA', 'FACTURADA'];
    if (bloqueados.includes(current.estado || '')) {
      throw new Error(
        `No se puede eliminar una liquidación en estado ${current.estado}. Primero anúlala.`,
      );
    }

    const now = new Date();
    const [, itemsUpdated, conceptosUpdated] = await prisma.$transaction([
      prisma.liquidacion_tercero_final.update({
        where: { id: liquidacionTerceroFinalId },
        data: {
          deleted_at: now,
          actualizado_por_id: userId || null,
        },
      }),
      prisma.liquidacion_tercero_final_item.updateMany({
        where: { liquidacion_tercero_final_id: liquidacionTerceroFinalId, deleted_at: null },
        data: { deleted_at: now },
      }),
      prisma.liquidacion_tercero_final_concepto.updateMany({
        where: { liquidacion_tercero_final_id: liquidacionTerceroFinalId, deleted_at: null },
        data: { deleted_at: now },
      }),
    ]);

    return {
      ok: true,
      id: liquidacionTerceroFinalId,
      deleted_at: now,
      items_eliminados: itemsUpdated.count,
      conceptos_eliminados: conceptosUpdated.count,
    };
  },
};
