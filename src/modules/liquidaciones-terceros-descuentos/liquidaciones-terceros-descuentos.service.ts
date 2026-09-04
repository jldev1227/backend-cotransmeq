import { prisma } from "../../config/prisma";
import { randomUUID } from "crypto";
import { LiquidacionesSnapshotsService } from "../liquidaciones-terceros-snapshots/liquidaciones-terceros-snapshots.service";
import { getIo } from "../../sockets";
import { recalcularTotalesCierre, sumarAdicionalesGravados } from "./totales-cierre";
import { CierreEstadoService } from "./cierre-estado.service";
// La tarifa del bono para las filas que nacen vacías. Se importa en vez de
// repetirla aquí: es la misma con la que el canvas da de alta un conductor a
// mano, y dos copias acabarían divergiendo.
import { BLOQUE_CONDUCTOR_MANUAL } from "./reglas-conceptos";
import { calcularPorcentajesEfectivos, repartirValor } from "./reparto-propietarios";

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
/// queda como ingreso negativo para Transmeralda (ingreso_empresa).
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
  /**
   * Copropietario al que pertenece la fila. Solo lo llevan las de tipo
   * IMPUESTO en cierres `es_multi_propietario`, donde los impuestos se
   * prorratean por porcentaje de participación.
   */
  propietario_id?: string | null;
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
  /// Filtra los items de liquidación de tercero por `tercero_id`. Útil cuando
  /// una placa cambió de propietario a mitad de mes y se quiere liquidar al
  /// tercero correcto, evitando que el borrador traiga items de OTROS terceros
  /// que también usaron esa placa en el mismo periodo.
  tercero_id?: string | null;
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

/**
 * Consolida en `cd` los bonos de ALIMENTACIÓN que una liquidación de nómina
 * atribuye al mes `mesKey` (formato `YYYY-MM`).
 *
 * Un bono no pertenece al ciclo de nómina que lo paga sino al MES NATURAL en
 * el que se consumió, y esa atribución vive en el JSON `values`
 * (`[{ mes: "2026-06", quantity: 10 }, …]`). Por eso los bonos de un mes
 * están repartidos entre los dos ciclos que lo parten y hay que acumularlos
 * de todas las liquidaciones que declaren ese mes, no solo de la del ciclo.
 *
 * - `name`: `includes('aliment')` en minúsculas, que cubre "Alimentación",
 *   "Alimenticio" y las variantes sin tilde que hay en los datos.
 * - `puedeFijarTarifa`: si esta liquidación puede aportar el
 *   `valor_unitario`. Entre las que sí pueden gana la de `periodo_end` más
 *   reciente; las que no, solo lo rellenan si sigue vacío.
 */
function acumularBonosAlimentacion(
  cd: any,
  liq: any,
  mesKey: string,
  opts: { puedeFijarTarifa: boolean },
): void {
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

    if (opts.puedeFijarTarifa) {
      if (liq.periodo_end > (cd.bonos_alimentacion_periodo_end || '')) {
        cd.bonos_alimentacion_valor_unitario = valorUnitario;
        cd.bonos_alimentacion_liq_id = liq.id;
        cd.bonos_alimentacion_periodo_end = liq.periodo_end;
      }
    } else if (!cd.bonos_alimentacion_valor_unitario && valorUnitario > 0) {
      // Respaldo, y sin mover `bonos_alimentacion_periodo_end`: si un ciclo de
      // fuera del mes empujara esa marca, ninguna liquidación del mes podría
      // ya ganarle el desempate.
      cd.bonos_alimentacion_valor_unitario = valorUnitario;
      cd.bonos_alimentacion_liq_id = liq.id;
    }
  }
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

/**
 * Porcentaje efectivo (cascada por orden) de una fila de copropietario, con
 * FALLBACK en memoria: las filas guardadas antes de la migración de
 * `porcentaje_efectivo` vienen con NULL y se resuelven aquí sin escribir en
 * BD; el valor se persiste en el siguiente guardado/recálculo del cierre.
 */
function efectivoDePropietario(p: any, filas: any[]): number {
  if (p.porcentaje_efectivo !== null && p.porcentaje_efectivo !== undefined) {
    return toNumber(p.porcentaje_efectivo);
  }
  const mapa = calcularPorcentajesEfectivos(
    filas.map((f: any) => ({ id: f.id, porcentaje: toNumber(f.porcentaje), orden: f.orden ?? 0 }))
  );
  return mapa.get(p.id) ?? toNumber(p.porcentaje);
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

    // Defensive dedupe por la clave compuesta (tipo, concepto, conductor_id,
    // propietario_id). Conserva la ÚLTIMA ocurrencia. Mismo criterio que el
    // gateway del socket para mantener consistencia entre rutas HTTP y socket.
    const seenKey = new Set<string>();
    const conceptosDeduplicados: any[] = [];
    for (let i = conceptosConTotales.length - 1; i >= 0; i--) {
      const c = conceptosConTotales[i];
      const key = [
        c.tipo,
        c.concepto,
        c.conductor_id || '',
        c.propietario_id || ''
      ].join('|');
      if (seenKey.has(key)) continue;
      seenKey.add(key);
      conceptosDeduplicados.unshift(c);
    }

    const conceptosData = conceptosDeduplicados.map((c) => ({
      id: c.id || randomUUID(),
      liquidacion_tercero_final_id: liquidacionTerceroFinalId,
      tipo: c.tipo,
      concepto: c.concepto,
      conductor_id: c.conductor_id || null,
      // `propietario_id` FALTABA. La deduplicación de arriba usa esa clave,
      // pero luego no se persistía: como este método hace deleteMany +
      // createMany, cada guardado por HTTP de un cierre multi-propietario
      // desvinculaba TODAS las filas de impuesto de su copropietario y el
      // reparto porcentual quedaba huérfano.
      propietario_id: c.propietario_id || null,
      // `??` y no `||`: CERO ES UN DATO. Una BONIFICACION de 0 bonos o una
      // DOTACION de 0 días son filas que existen a propósito, para que el
      // vacío del mes se vea y se pueda teclear encima; con `||` se guardaban
      // como NULL, que significa "este concepto no lleva cantidad" y es lo que
      // mandan las filas por porcentaje.
      //
      // El canvas disimulaba la diferencia porque su builder pasa el valor por
      // `n()` y NULL le sale 0 igualmente. El PDF no: su plantilla imprime
      // `${c.dias ?? ''}`, así que la fila salía con la cantidad EN BLANCO en
      // el documento que se le manda al tercero.
      //
      // Prestaciones y seguridad social no mandan `dias` en absoluto, así que
      // siguen llegando como `undefined` → null.
      dias: c.dias ?? null,
      valor_unitario: c.valor_unitario || 0,
      porcentaje: c.porcentaje || null,
      valor_total: c.valor_total,
      base_calculo: c.base_calculo || null,
      calculado: c.calculado || false,
      observaciones: c.observaciones || null,
      orden: c.orden ?? 0,
    }));

    await prisma.$transaction([
      prisma.liquidacion_tercero_final_concepto.updateMany({
        where: { liquidacion_tercero_final_id: liquidacionTerceroFinalId, deleted_at: null },
        data: { deleted_at: new Date() },
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
        propietario: {
          select: { id: true, nombre: true, identificacion: true, porcentaje: true },
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
        where: { deleted_at: null, vehiculo_id: vehiculo.id },
        select: {
          id: true, name: true, value: true, values: true, liquidacion_id: true, vehiculo_id: true,
        },
      },
    };

    let liquidacionesNomina: any[] = await prisma.liquidaciones.findMany({
      where: {
        deleted_at: null,
        liquidacion_vehiculo: { some: { vehiculo_id: vehiculo.id, deleted_at: null } },
        periodo_end: { gte: periodoStart, lte: periodoEnd },
        periodo_start: { lt: `${anio}-${String(mes).padStart(2, '0')}-21` },
      },
      include: nominaInclude,
    });

    if (liquidacionesNomina.length === 0) {
      liquidacionesNomina = await prisma.liquidaciones.findMany({
        where: {
          deleted_at: null,
          liquidacion_vehiculo: { some: { vehiculo_id: vehiculo.id, deleted_at: null } },
          periodo_end: { gte: periodoStart, lte: periodoEnd },
        },
        include: nominaInclude,
      });
    }

    /**
     * Ciclos de nómina que TOCAN el mes pero no cierran dentro de él.
     *
     * El ciclo de nómina va del 21 al 20, así que un mes natural siempre lo
     * parten DOS ciclos. La consulta de arriba se queda con el que cierra
     * dentro del mes (21/05→20/06 para junio) y descarta el que lo abre
     * (21/06→20/07), porque su `periodo_end` cae en julio.
     *
     * Para los días y el salario eso es correcto y hay que mantenerlo: el
     * ciclo que cierra en el mes ES la nómina del mes, y sumar también el
     * otro le daría 60 días de junio a un conductor que trabajó 30.
     *
     * Pero los BONOS DE ALIMENTACIÓN no se pagan por ciclo: cada registro
     * lleva un JSON `values` con la cantidad ATRIBUIDA A CADA MES NATURAL, y
     * los bonos de junio están repartidos entre los dos ciclos. Con una sola
     * consulta se perdían los del ciclo que abre el mes — en FST006/junio
     * 2026 el canvas traía 10 bonos y la nómina tenía 15 (10 del ciclo
     * 21/05→20/06 y 5 del 21/06→20/07).
     *
     * De estos ciclos extra se usa ÚNICAMENTE la cantidad del mes objetivo.
     * Ni días, ni salario, ni auxilio, ni recargos.
     */
    if (liquidacionesNomina.length === 0) {
      return {
        vehiculo,
        conductores: [],
        conceptos: [],
        resumen: { base_salarios: 0, base_auxilio_transporte: 0, base_recargos: 0, base_bonificaciones: 0, total_base: 0 },
      };
    }

    const idsDelMes = new Set(liquidacionesNomina.map((l: any) => l.id));
    const liquidacionesSoloBonos: any[] = (
      await prisma.liquidaciones.findMany({
        where: {
          deleted_at: null,
          liquidacion_vehiculo: { some: { vehiculo_id: vehiculo.id, deleted_at: null } },
          // Solapamiento con el mes natural: empieza antes de que acabe y
          // acaba después de que empiece.
          periodo_start: { lte: periodoEnd },
          periodo_end: { gte: periodoStart },
        },
        include: nominaInclude,
      })
    ).filter((l: any) => !idsDelMes.has(l.id));

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

      acumularBonosAlimentacion(cd, liq, mesKey, { puedeFijarTarifa: true });
    }

    /**
     * A qué entrada del map van los importes que llegan de un ciclo de FUERA
     * del mes.
     *
     * Cada entrada de `conductoresMap` es un PERIODO de nómina, no un
     * conductor. Crear una nueva para el ciclo de julio metería un SALARIO
     * extra de 30 días en la liquidación de junio, así que lo que venga de
     * ahí se acumula sobre la entrada que el conductor ya tiene.
     *
     * Si tuviera dos periodos dentro del mes (poco común, pero pasa cuando se
     * parte la nómina), gana el de `periodo_end` más reciente: es el que
     * linda con el ciclo de fuera.
     */
    const entradaDestinoPorConductor = new Map<string, any>();
    for (const [clave, cd] of conductoresMap) {
      const periodoEndDeLaClave = clave.split('|')[2] || '';
      const previo = entradaDestinoPorConductor.get(cd.conductor_id);
      if (!previo || periodoEndDeLaClave > previo.__periodoEnd) {
        entradaDestinoPorConductor.set(cd.conductor_id, {
          cd,
          __periodoEnd: periodoEndDeLaClave,
        });
      }
    }

    // Segunda pasada de bonos: los del mes que viven en el ciclo que ABRE el mes.
    for (const liq of liquidacionesSoloBonos) {
      const conductorId = liq.conductores?.id;
      if (!conductorId) continue;
      const destino = entradaDestinoPorConductor.get(conductorId);
      // El conductor no trabajó esta placa dentro del mes: sus bonos no
      // pertenecen a esta liquidación aunque el ciclo la solape.
      if (!destino) continue;

      // `puedeFijarTarifa: false` — la tarifa del bono sale de los ciclos
      // DEL MES. Un ciclo de julio tiene el `periodo_end` más alto y ganaría
      // el desempate, así que un cambio de tarifa en julio se aplicaría
      // retroactivamente a los bonos de junio. Solo sirve de respaldo
      // cuando ningún registro del mes traía tarifa.
      acumularBonosAlimentacion(destino.cd, liq, mesKey, { puedeFijarTarifa: false });
    }

    /**
     * RECARGOS del mes.
     *
     * Igual que los bonos, un recargo NO pertenece al ciclo de nómina que lo
     * paga: la tabla `recargos` tiene su propia columna `mes` (`YYYY-MM`) y es
     * esa la que manda. Antes se sumaba el ciclo entero sin mirarla, con dos
     * efectos que se compensaban a medias y dejaban un número que no era ni
     * el de un mes ni el del otro:
     *
     *   - entraban los recargos de MAYO del ciclo 21/05→20/06;
     *   - se perdían los de JUNIO del ciclo 21/06→20/07.
     *
     * En FST006/junio 2026 eso daba 885.406 para Andrés cuando la nómina dice
     * 1.071.307, y 334.070 para Sebastián cuando dice 207.475.
     *
     * El filtro por `vehiculo_id` es igual de necesario y por el mismo motivo
     * que ya lo llevaba el `include` de bonificaciones: un conductor puede
     * conducir varias placas dentro del mismo ciclo, y la liquidación de
     * nómina cuelga de TODAS ellas. Sin filtrar, los 207.475 de Sebastián en
     * FST006 se cobraban también en LLQ895 y en PPK074 — el mismo recargo
     * descontado tres veces, a tres propietarios distintos.
     */
    const idsCiclosDelMes = liquidacionIdsParaRecargos;
    const idsTodosLosCiclos = [
      ...idsCiclosDelMes,
      ...liquidacionesSoloBonos.map((l: any) => l.id),
    ];

    if (idsTodosLosCiclos.length > 0) {
      const recargosDelMes = await prisma.recargos.findMany({
        where: {
          liquidacion_id: { in: idsTodosLosCiclos },
          vehiculo_id: vehiculo.id,
          mes: mesKey,
          pag_cliente: false,
          incluir: true,
        },
        select: { id: true, valor: true, liquidacion_id: true },
      });

      const recargosPorLiquidacion = new Map<string, number>();
      for (const r of recargosDelMes) {
        if (!r.liquidacion_id) continue;
        recargosPorLiquidacion.set(
          r.liquidacion_id,
          (recargosPorLiquidacion.get(r.liquidacion_id) || 0) + toNumber(r.valor),
        );
      }

      /**
       * Liquidaciones SIN una sola fila en `recargos`.
       *
       * Es la única situación en la que se puede caer a la columna
       * consolidada `total_recargos`. El fallback anterior se disparaba
       * siempre que el filtrado diera 0, y con el filtro por mes eso pasa
       * constantemente —un ciclo puede tener recargos y ninguno del mes—:
       * habría inyectado el total del ciclo COMPLETO cada vez que el mes
       * legítimamente sumaba cero.
       */
      const conAlgunaFila = new Set(
        (
          await prisma.recargos.findMany({
            where: { liquidacion_id: { in: idsTodosLosCiclos } },
            select: { liquidacion_id: true },
            distinct: ['liquidacion_id'],
          })
        )
          .map((r: any) => r.liquidacion_id)
          .filter(Boolean),
      );

      const sumarRecargo = (cd: any, valor: number) => {
        if (!cd || valor === 0) return;
        cd.total_recargos += valor;
        totalRecargos += valor;
      };

      // Ciclos del mes: van a SU entrada de periodo, que es la precisa.
      for (const liq of liquidacionesNomina) {
        if (!idsCiclosDelMes.includes(liq.id)) continue;
        const conductor = liq.conductores;
        if (!conductor) continue;
        const cd = conductoresMap.get(
          `${conductor.id}|${liq.periodo_start}|${liq.periodo_end}`,
        );
        if (!cd) continue;

        const recargoLiq = recargosPorLiquidacion.get(liq.id) || 0;
        // El fallback solo aplica a los ciclos que cierran DENTRO del mes:
        // `total_recargos` es del ciclo entero, y para uno que solo lo solapa
        // no hay forma de saber qué parte cae en el mes.
        const recargoFallback =
          recargoLiq === 0 && !conAlgunaFila.has(liq.id) ? toNumber(liq.total_recargos) : 0;

        sumarRecargo(cd, recargoLiq + recargoFallback);
      }

      // Ciclos de fuera: solo su parte del mes, a la entrada del conductor.
      for (const liq of liquidacionesSoloBonos) {
        const conductorId = liq.conductores?.id;
        if (!conductorId) continue;
        const destino = entradaDestinoPorConductor.get(conductorId);
        if (!destino) continue;
        sumarRecargo(destino.cd, recargosPorLiquidacion.get(liq.id) || 0);
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

      /**
       * BONIFICACION y RECARGOS SIEMPRE, aunque el mes venga vacío.
       *
       * Antes solo se creaban con importe > 0, y un conductor sin bonos ni
       * recargos salía con su bloque a cuatro filas mientras el de al lado
       * tenía seis. Esa ausencia es ambigua: no se distingue "este mes no
       * hubo" de "la sincronización no lo trajo" —que es justo el fallo que
       * teníamos con los ciclos de nómina—, y para teclear el dato a mano
       * había que ir al modal a crear la fila primero. Con la fila en cero,
       * el vacío se ve y se puede corregir encima.
       *
       * La FORMA de cada fila en cero sigue a `GASTOS_POR_DEFECTO`, que ya
       * resolvió esto para los gastos de vehículo:
       *
       *   BONIFICACION es cantidad × tarifa, como DOTACION: la cantidad nace
       *   en 0 —cuántos bonos consumió alguien es un dato del mes que nadie
       *   puede suponer— y la tarifa sí se siembra, porque es tarifa y no
       *   medida, y ahorra buscarla.
       *
       *   RECARGOS es un importe suelto, como COMBUSTIBLE: `dias` es un
       *   portador fijo en 1 y el importe va en `valor_unitario`. OJO — el
       *   1 NO se puede poner a 0: `valor_total` se deriva como
       *   `dias × valor_unitario`, así que con la cantidad en cero el importe
       *   que tecleara el usuario seguiría dando cero.
       */
      const cantBonos = cd.bonos_alimentacion_cantidad;
      // Sin ningún registro de alimentación no hay tarifa que leer; se cae a
      // la del alta manual, que es la misma que usa el canvas al crear un
      // conductor a mano.
      const vrUnitBonos =
        cd.bonos_alimentacion_valor_unitario > 0
          ? cd.bonos_alimentacion_valor_unitario
          : BLOQUE_CONDUCTOR_MANUAL.BONIFICACION.valor_unitario;
      conceptosGenerados.push({
        tipo: 'COSTO_LABORAL',
        concepto: 'BONIFICACION',
        conductor_id: cd.conductor_id,
        conductor: conductorInfo,
        dias: cantBonos,
        valor_unitario: vrUnitBonos,
        valor_total: cantBonos * vrUnitBonos,
        calculado: true,
      });

      /**
       * BONIFICACION TURNO DOBLE: siempre, y siempre en CANTIDAD CERO.
       *
       * No sale de nómina —no existe allí como concepto—, así que aquí no hay
       * nada que traer: lo único que se siembra es la TARIFA, para que el
       * equipo solo tenga que teclear cuántos turnos dobles hubo. Misma forma
       * que BONIFICACION: cantidad × tarifa.
       *
       * Va detrás de BONIFICACION a propósito: el `orden` con que se guardan
       * los conceptos es el de este array, y es el que decide en qué fila del
       * recuadro aparece.
       */
      conceptosGenerados.push({
        tipo: 'COSTO_LABORAL',
        concepto: 'BONIFICACION_TURNO_DOBLE',
        conductor_id: cd.conductor_id,
        conductor: conductorInfo,
        dias: BLOQUE_CONDUCTOR_MANUAL.BONIFICACION_TURNO_DOBLE.dias,
        valor_unitario: BLOQUE_CONDUCTOR_MANUAL.BONIFICACION_TURNO_DOBLE.valor_unitario,
        valor_total:
          BLOQUE_CONDUCTOR_MANUAL.BONIFICACION_TURNO_DOBLE.dias *
          BLOQUE_CONDUCTOR_MANUAL.BONIFICACION_TURNO_DOBLE.valor_unitario,
        calculado: true,
      });

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
    const { liquidacion_servicio_id, liquidacion_servicio_ids, placa: placaFiltro, tercero_id: terceroIdFiltro, user_id, onProgress } = input;

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

      const liqResult = await this._procesarLiquidacion(liqId, placaFiltro, terceroIdFiltro, user_id, onProgress, liqProgress, 95 / totalLiqs, liqIdx, totalLiqs);

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
    terceroIdFiltro: string | null | undefined,
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

    // Filtro adicional por tercero_id: cuando una placa cambió de propietario
    // a mitad de mes, el mismo mes/placa tiene items de VARIOS terceros.
    // Sin este filtro el borrador trae items del tercero equivocado.
    if (terceroIdFiltro) {
      tercerosFiltrados = tercerosFiltrados.filter(
        (lt: any) => lt.tercero_id === terceroIdFiltro
      );
    }

    if (placaFiltro && tercerosFiltrados.length === 0) {
      console.log(`[_procesarLiquidacion] liq ${liqServicio.consecutivo}: 0 items para placa ${placaFiltro}`);
      return { liquidacion_servicio: null, terceros: [] };
    }

    // Agrupación por (PLACA, TERCERO), no solo por placa.
    //
    // Una placa puede cambiar de propietario a mitad de mes, o prestar
    // servicio bajo dos terceros distintos. Agrupando solo por placa, todos
    // los items caían en un único cierre al que se le asignaba el
    // `tercero_id` del PRIMER item — es decir, los ingresos de un dueño
    // quedaban atribuidos al otro. Ahora cada par (placa, tercero) produce
    // su propio cierre, que es lo que el negocio realmente representa.
    const placasMap = new Map<string, typeof liqServicio.terceros_items>();
    for (const lt of tercerosFiltrados) {
      const clave = `${lt.placa}::${lt.tercero_id ?? 'SIN_TERCERO'}`;
      if (!placasMap.has(clave)) placasMap.set(clave, []);
      placasMap.get(clave)!.push(lt);
    }

    const resultados: any[] = [];
    const facturasNumeros = liqServicio.factura_items
      .map((fi: any) => fi.factura?.numero_factura)
      .filter(Boolean)
      .join(', ');

    const placaEntries = Array.from(placasMap.entries());

    for (let idx = 0; idx < placaEntries.length; idx++) {
      // La clave del Map es `${placa}::${tercero_id}`; la placa real y el
      // tercero se leen del grupo, no de la clave. `placa` se declara FUERA
      // del try porque el catch la usa para reportar el error.
      const [, terceros] = placaEntries[idx];
      const placa = (terceros[0] as any).placa;
      try {
        const primerTercero = terceros[0] as any;
        // El tercero sale del GRUPO, que ya es homogéneo por construcción.
        // `terceroIdFiltro` sigue teniendo prioridad para el caso en que el
        // caller quiera forzar un dueño concreto.
        const terceroId = terceroIdFiltro || primerTercero.tercero_id || null;

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
            // Los adicionales viven en tabla desde la migración
            // `12-08-2026-adicionales-tabla-real`. El JSONB queda de respaldo.
            adicionales_filas: {
              where: { deleted_at: null },
              orderBy: [{ orden: 'asc' }, { created_at: 'asc' }],
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
          where: { id: { in: terceros.map((t: any) => t.id) }, deleted_at: null },
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
          // Liquidación de servicio de la que salen ESTOS items.
          //
          // Sin este campo el consumidor no tenía de dónde sacarlo: la fila
          // de `liquidacion_tercero` nombra su FK `liquidacion_id`, no
          // `liquidacion_servicio_id`, así que `entry.liquidacion_tercero
          // .liquidacion_servicio_id` era `undefined` y quien persistía caía
          // en el `liquidacion_servicio` de la PRIMERA liquidación del lote
          // para todas las placas. La validación de items de
          // `guardarBorrador` (items ∈ esa liq) fallaba entonces para todo lo
          // que no viniera de la primera, y de 50 placas se guardaba 1.
          liquidacion_servicio_id,
          liquidacion_tercero_final: serializeLiquidacionTerceroFinal(cierreFinal),
          conceptos: conceptosActuales,
          resumen_nomina: nominaData.resumen,
          conductores: nominaData.conductores,
          // Tabla primero, JSONB como respaldo para cierres sin backfill.
          // Leyendo solo el JSONB, la previsualización no mostraba los
          // adicionales creados desde el canvas.
          items_adicionales: (cierrePersistido?.adicionales_filas?.length
            ? cierrePersistido.adicionales_filas
            : Array.isArray(cierrePersistido?.adicionales)
              ? (cierrePersistido.adicionales as any[])
              : []
          ).map((a: any) => ({
            ...a,
            valor_unitario: toNumber(a.valor_unitario),
            cantidad: toNumber(a.cantidad),
            valor_liquidar: toNumber(a.valor_liquidar),
          })),
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
    /**
     * Liquidaciones de servicio a las que se acepta que pertenezcan los
     * `item_ids`. Vacío = solo `liquidacion_servicio_id`, que es el
     * comportamiento histórico.
     *
     * Existe porque una misma placa+tercero puede facturarse en VARIAS
     * liquidaciones de servicio del mismo mes (en junio/2026 son 23 de 51),
     * y su cierre es uno solo: sus items vienen legítimamente de más de una
     * liq. La columna `liquidacion_servicio_id` del cierre sigue siendo una
     * sola FK — la de referencia —, esto solo amplía qué items se admiten.
     */
    liquidacion_servicio_ids?: string[];
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
    /// ── BULK MODE ──
    /// Si `bulk_mode: true`, el endpoint itera la creación/actualización
    /// para CADA placa en el array `placas`, devolviendo un array de
    /// resultados. El campo `placa` y `item_ids` se interpretan como
    /// referencias por defecto (primer elemento) y los overrides
    /// por-placa vienen en `placas_payload`. Ver más abajo.
    bulk_mode?: boolean;
    /// Lista de placas a crear (modo bulk). Cuando bulk_mode=true, el
    /// endpoint itera y crea una liquidación independiente por cada
    /// placa, devolviendo un array de resultados.
    placas?: string[];
    /// Payload por-placa en modo bulk. Cada entry debe incluir
    /// { placa, item_ids, conceptos, adicionales, tercero_id, liquidacion_servicio_id }.
    /// Si una placa no aparece aquí, se usan los valores top-level
    /// (compatibilidad con un sólo item bulk).
    placas_payload?: Array<{
      placa: string;
      item_ids: string[];
      conceptos: ConceptoInput[];
      adicionales?: AdicionalInput[];
      tercero_id?: string | null;
      liquidacion_servicio_id?: string;
    }>;
  }) {
    // ── BULK MODE: iterar por cada placa y consolidar resultados ──
    if (params.bulk_mode === true) {
      const payloadPorPlaca = (Array.isArray(params.placas_payload) && params.placas_payload.length > 0)
        ? params.placas_payload
        : (Array.isArray(params.placas) && params.placas.length > 0
            ? params.placas.map((p) => ({
                placa: p,
                item_ids: params.item_ids,
                conceptos: params.conceptos,
                adicionales: params.adicionales,
                tercero_id: params.tercero_id,
                liquidacion_servicio_id: params.liquidacion_servicio_id,
              }))
            : []);

      if (payloadPorPlaca.length === 0) {
        throw new Error('En modo bulk se requiere al menos una placa en `placas` o `placas_payload`');
      }

      const results: any[] = [];
      const errors: any[] = [];

      for (const entry of payloadPorPlaca) {
        try {
          const sub = await this.guardarBorrador({
            id: params.id,
            liquidacion_servicio_id: entry.liquidacion_servicio_id || params.liquidacion_servicio_id,
            placa: entry.placa,
            tercero_id: entry.tercero_id ?? params.tercero_id ?? null,
            mes: params.mes,
            anio: params.anio,
            item_ids: entry.item_ids,
            conceptos: entry.conceptos,
            adicionales: entry.adicionales,
            es_propietario_overrides: params.es_propietario_overrides,
            user_id: params.user_id,
            force_new: params.force_new,
          });
          results.push(sub);
        } catch (e: any) {
          errors.push({ placa: entry.placa, error: e.message });
        }
      }

      if (results.length === 0 && errors.length > 0) {
        throw new Error(errors.map((e) => `${e.placa}: ${e.error}`).join('; '));
      }

      return {
        ok: true,
        bulk: true,
        count: results.length,
        results,
        errors,
      };
    }

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
    // ── Lookup por id + liquidacion_servicio_id (NO por placa) ──
    // El bug original era hacer `placa: { equals: placa }`, lo cual
    // falla cuando la columna `liquidacion_tercero.placa` está VACÍA o
    // tiene un formato distinto al normalizado que envía el front-end.
    // La validación correcta es: el item debe pertenecer a la
    // liquidacion_servicio correcta (FK `liquidacion_id`), que es lo
    // que el front-end garantiza al construir el payload. Si el item
    // existe y pertenece a la liq_servicio del batch, es válido
    // independientemente de cómo esté escrita su columna `placa`.
    const liqsAdmitidas = Array.from(
      new Set([
        liquidacion_servicio_id,
        ...(Array.isArray(params.liquidacion_servicio_ids)
          ? params.liquidacion_servicio_ids
          : []),
      ].filter(Boolean)),
    );
    const ltItems = await prisma.$queryRaw<{ id: string; valor_liquidar: any; placa: string }[]>`
      SELECT id, valor_liquidar, placa
      FROM liquidacion_tercero
      WHERE id = ANY(${item_ids}::uuid[])
        AND liquidacion_id = ANY(${liqsAdmitidas}::uuid[])
    `;
    if (ltItems.length !== item_ids.length) {
      const encontrados = new Set(ltItems.map((i) => i.id));
      const faltantes = item_ids.filter((id) => !encontrados.has(id));
      throw new Error(
        `Items no encontrados para la placa ${placa} (liquidacion_servicio_id=${liqsAdmitidas.join(', ')}): ${faltantes.join(', ')}`
      );
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
    // ── Lookup tolerante a formato de placa ──
    // Mismo problema que en el lookup de ltItems: la columna
    // `liquidacion_tercero_final.placa` puede tener formatos
    // inconsistentes. Normalizamos ambos lados con REGEXP_REPLACE.
    //
    // El filtro incluye `tercero_id`: una misma placa puede liquidarse a DOS
    // propietarios distintos en el mismo mes, y son cierres independientes.
    // Sin esa condición, el cierre del segundo propietario chocaba con el
    // APROBADA del primero y `force_new` marcaba REEMPLAZADA a un cierre que
    // no tenía nada que ver — perdiendo la liquidación del primer dueño.
    const placaNormalized = placa.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const terceroIdParam = tercero_id ?? null;
    const cierreBloqueadoRows = await prisma.$queryRaw<{ id: string; estado: string }[]>`
      SELECT id, estado
      FROM liquidacion_tercero_final
      WHERE UPPER(REGEXP_REPLACE(placa, '[^A-Za-z0-9]', '', 'g')) = ${placaNormalized}
        AND mes = ${mes}
        AND anio = ${anio}
        AND (
          (${terceroIdParam}::uuid IS NULL AND tercero_id IS NULL)
          OR tercero_id = ${terceroIdParam}::uuid
        )
        AND estado IN ('APROBADA', 'FACTURADA')
        AND deleted_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const cierreBloqueado = cierreBloqueadoRows[0] || null;

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
        prisma.liquidacion_tercero_final_item.updateMany({
          where: { liquidacion_tercero_final_id: cierreId, deleted_at: null },
          data: { deleted_at: new Date() },
        }),
        prisma.liquidacion_tercero_final_concepto.updateMany({
          where: { liquidacion_tercero_final_id: cierreId, deleted_at: null },
          data: { deleted_at: new Date() },
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

    // ── Socket: notificar a TODOS los clientes que se creó una nueva
    //    liquidación de tercero, para que la página de historial refresque
    //    la tabla y resalte la fila entrante con un badge "NUEVO". ──
    try {
      const io = getIo();
      const payload = {
        id: created.id,
        placa: created.placa,
        consecutivo: created.consecutivo,
        mes: created.mes,
        anio: created.anio,
        estado: created.estado,
        total_pagar: toNumber(created.total_pagar),
        creado_por_id: created.creado_por_id || user_id || null,
        created_at: created.created_at instanceof Date
          ? created.created_at.toISOString()
          : created.created_at,
      };
      io.emit('liquidacion-tercero:created', payload);
      console.log(`[guardarBorrador-create] socket emit liquidacion-tercero:created id=${created.id} placa=${created.placa}`);
    } catch (emitErr) {
      console.error('[guardarBorrador-create] No se pudo emitir liquidacion-tercero:created:', emitErr);
    }

    return {
      ok: true,
      id: created.id,
      accion: 'created' as const,
      cierre: created,
    };
  },

  // ── RECALCULAR TOTALES DEL CIERRE FINAL ──

  /**
   * Recalcula y persiste los totales del cierre.
   *
   * Delega en `totales-cierre.ts`, que es la fuente única de verdad. Antes
   * este método sumaba los adicionales del JSONB `cierre.adicionales`
   * mientras el service de adicionales los sumaba de la TABLA
   * `liquidacion_tercero_final_adicional`: dos caminos con resultados
   * distintos sobre el mismo campo, así que `valor_liquidar` acababa
   * dependiendo de cuál se hubiera ejecutado de último.
   */
  async recalcularTotales(liquidacionTerceroFinalId: string) {
    let totales = await recalcularTotalesCierre(prisma, liquidacionTerceroFinalId);

    // Si el cierre es multi-propietario, regenerar las filas de impuestos
    // por copropietario (base imponible = VALOR A FACTURAR prop) y volver a
    // totalizar, porque las filas IMPUESTO acaban de cambiar.
    const cierreForMulti = await prisma.liquidacion_tercero_final.findUnique({
      where: { id: liquidacionTerceroFinalId },
      select: { es_multi_propietario: true },
    });
    if (cierreForMulti?.es_multi_propietario) {
      await this.recalcularImpuestosPorPropietario(liquidacionTerceroFinalId);
      totales = await recalcularTotalesCierre(prisma, liquidacionTerceroFinalId);
    }

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
      valor_liquidar: totales.valor_liquidar,
      total_costos_laborales: totales.total_costos_laborales,
      total_gastos_operativos: totales.total_gastos_operativos,
      total_impuestos: totales.total_impuestos,
      total_descuentos: totales.total_descuentos,
      total_pagar: totales.total_pagar,
    };
  },

  // ── CALCULAR IMPUESTOS DESDE VALOR LIQUIDAR ──

  async calcularImpuestos(liquidacionTerceroFinalId: string) {
    const cierre = await prisma.liquidacion_tercero_final.findUnique({
      where: { id: liquidacionTerceroFinalId },
      select: { valor_liquidar: true, adicionales: true, estado: true, es_multi_propietario: true },
    });
    if (!cierre) throw new Error('Liquidación final de tercero no encontrada');

    // Si el cierre está en modo multi-propietario, el prorrateo de impuestos
    // por copropietario se delega a `recalcularImpuestosPorPropietario`, que
    // genera N filas por cada impuesto (una por copropietario) en lugar de
    // una sola fila global. La suma de las N filas sigue siendo igual al
    // impuesto global × (suma_porcentajes / 100).
    if (cierre.es_multi_propietario) {
      return await this.recalcularImpuestosPorPropietario(liquidacionTerceroFinalId);
    }

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
    // `aplica_impuestos: true` (o `null`/`undefined` por compatibilidad con
    // datos legacy). Se usa para RETENCION_ICA, AVISOS_TABLEROS y
    // SOBRETASA_BOMBERIL.
    //
    // IMPORTANTE: usamos `!== false` (no `=== true`) para alinear con el
    // frontend (`aplicaImpuestosByPivote[pivoteId] !== false`). Si el
    // campo es null/undefined, ambos lo cuentan como true (default). Si el
    // backend usara `=== true`, los items con aplica_impuestos=null
    // (legacy) quedarían fuera de la base aunque el UI los muestra
    // dentro del "Base imponible".
    const baseConImpuestos = allItems
      .filter((it: any) => it.aplica_impuestos !== false)
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

    // Base imponible de los adicionales: sale de `totales-cierre.ts`, que lee
    // de la TABLA `liquidacion_tercero_final_adicional` con respaldo al JSONB.
    // Antes se leía el JSONB directamente, así que los adicionales creados
    // desde el canvas (que van a la tabla) no entraban en la base y los
    // impuestos salían cortos.
    const adicionalesSum = await sumarAdicionalesGravados(prisma, liquidacionTerceroFinalId);

    // Para RETENCION_ICA y similares: base = items con impuestos + adicionales que aplican.
    // Para RETENCION_FUENTE: base = TODOS los items + adicionales que aplican.
    const baseConImpuestosTotal = baseConImpuestos + adicionalesSum;
    const baseTotalConAdicionales = baseTotalItems + adicionalesSum;

    const configDescuentos = await this.obtenerConfiguracion();
    // Orden canónico de los 4 impuestos (override del `orden` de la BD).
    // El usuario pide: RETENCION_ICA → AVISOS_TABLEROS → SOBRETASA_BOMBERIL → RETENCION_FUENTE.
    const ORDEN_IMPUESTOS = [
      'RETENCION_ICA',
      'AVISOS_TABLEROS',
      'SOBRETASA_BOMBERIL',
      'RETENCION_FUENTE',
    ];
    const rankOrden = (concepto: string): number => {
      const i = ORDEN_IMPUESTOS.indexOf(concepto);
      return i === -1 ? 999 : i;
    };
    const impuestosConfig = configDescuentos
      .filter((c: any) => c.categoria === 'IMPUESTO' && c.activo)
      .slice()
      .sort((a: any, b: any) => rankOrden(a.concepto) - rankOrden(b.concepto));

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
      } else if (
        // REGLA DE DOMINIO (NO configurable): AVISOS_TABLEROS y
        // SOBRETASA_BOMBERIL siempre se calculan sobre el VALOR de
        // RETENCION_ICA ya calculado en este mismo bucle, sin importar
        // lo que diga `cfg.base_calculo`. Esto evita que un cambio
        // accidental en la config (o un valor legacy) haga que estos
        // impuestos vuelvan a gravarse sobre la base imponible completa.
        cfg.concepto === 'AVISOS_TABLEROS' ||
        cfg.concepto === 'SOBRETASA_BOMBERIL'
      ) {
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

    // Persistir automáticamente, ACTUALIZANDO EN SITIO la fila de cada
    // impuesto en vez de borrarlas todas y volver a crearlas. Esto garantiza
    // que la sección IMPUESTOS Y RETENCIONES quede poblada apenas se carga el
    // editor, sin requerir que el usuario interactúe con el toggle de items.
    //
    // ⚠️ LA IDENTIDAD DE LA FILA ES PARTE DEL CONTRATO CON EL CANVAS, y por
    // eso ya no se puede recrear:
    //
    //   El builder ata las celdas BASE y VALOR de cada impuesto al `id` de su
    //   fila (`bindDerivada`), y el canvas repinta buscando por ese id
    //   (`getCierreCellFor`). Con `deleteMany` + `createMany` cada
    //   recálculo estrenaba UUIDs, así que las filas que devolvía el patch no
    //   casaban con NINGUNA celda: el servidor recalculaba bien, el toggle de
    //   APLICA IMP. se guardaba bien, y la hoja seguía enseñando los importes
    //   viejos hasta recargar. Se leía como «los impuestos no se aplican».
    //
    //   Además reseteaba `version` a 1 en cada pasada y dejaba huérfana
    //   cualquier anotación anclada a la fila por id.
    //
    // Se emparejan por CONCEPTO, que es la clave natural: hay a lo sumo una
    // fila auto por impuesto en un cierre de un solo propietario.
    if (['BORRADOR', 'LIQUIDADA'].includes(cierre.estado) && conceptosImpuestos.length > 0) {
      const existentes = await prisma.liquidacion_tercero_final_concepto.findMany({
        where: {
          liquidacion_tercero_final_id: liquidacionTerceroFinalId,
          tipo: 'IMPUESTO',
          deleted_at: null,
        },
        select: { id: true, concepto: true },
      });

      const porConcepto = new Map<string, string>();
      // Duplicados de datos viejos: se queda el primero y el resto se borra
      // más abajo, con los conceptos que ya no aplican.
      const sobrantes: string[] = [];
      for (const f of existentes) {
        if (porConcepto.has(f.concepto)) sobrantes.push(f.id);
        else porConcepto.set(f.concepto, f.id);
      }

      const operaciones: any[] = [];
      for (const c of conceptosImpuestos) {
        const id = porConcepto.get(c.concepto);
        if (id) {
          porConcepto.delete(c.concepto);
          operaciones.push(
            prisma.liquidacion_tercero_final_concepto.update({
              where: { id },
              data: {
                valor_unitario: 0,
                porcentaje: c.porcentaje,
                valor_total: c.valor_total,
                base_calculo: c.base_calculo,
                calculado: true,
                // El canvas recibe la fila entera en el patch y adopta la
                // versión que venga, así que subirla aquí lo deja alineado y
                // no rompe el compare-and-swap de nadie.
                version: { increment: 1 },
              },
            })
          );
        } else {
          operaciones.push(
            prisma.liquidacion_tercero_final_concepto.create({
              data: {
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
              },
            })
          );
        }
      }

      // Lo que quedó sin emparejar ya no lo produce la configuración vigente
      // (un impuesto desactivado, o una fila duplicada): se retira.
      const aBorrar = [...porConcepto.values(), ...sobrantes];
      if (aBorrar.length > 0) {
        operaciones.push(
          prisma.liquidacion_tercero_final_concepto.updateMany({
            where: { id: { in: aBorrar } },
            data: { deleted_at: new Date() },
          })
        );
      }

      await prisma.$transaction(operaciones);

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

  // ── REPARTO PORCENTUAL POR COPROPIETARIOS ──
  // Activa el modo multi-propietario del cierre: el valor a pagar y los
  // impuestos se reparten porcentualmente entre N terceros según los
  // porcentajes definidos en `liquidacion_tercero_final_propietario`.

  /// Estructura de entrada para crear/actualizar un copropietario.
  /// El `id` puede omitirse para crear uno nuevo; si viene, se actualiza el
  /// existente (matching por id dentro del mismo cierre).
  async obtenerPropietarios(liquidacionTerceroFinalId: string) {
    const cierre = await prisma.liquidacion_tercero_final.findFirst({
      where: { id: liquidacionTerceroFinalId, deleted_at: null },
      select: { es_multi_propietario: true },
    });
    if (!cierre) throw new Error('Liquidación final de tercero no encontrada');

    const propietarios = await prisma.liquidacion_tercero_final_propietario.findMany({
      where: { liquidacion_tercero_final_id: liquidacionTerceroFinalId, deleted_at: null },
      include: {
        tercero: {
          select: {
            id: true,
            nombre_completo: true,
            identificacion: true,
            tipo_persona: true,
            correo: true,
          },
        },
      },
      orderBy: [{ orden: 'asc' }, { created_at: 'asc' }],
    });

    return {
      es_multi_propietario: !!cierre.es_multi_propietario,
      propietarios: propietarios.map((p: any) => ({
        id: p.id,
        liquidacion_tercero_final_id: p.liquidacion_tercero_final_id,
        tercero_id: p.tercero_id,
        nombre: p.nombre,
        identificacion: p.identificacion,
        porcentaje: toNumber(p.porcentaje),
        porcentaje_efectivo: efectivoDePropietario(p, propietarios),
        nota: p.nota ?? null,
        aplica_retenciones: p.aplica_retenciones !== false,
        orden: p.orden,
        created_at: p.created_at,
        updated_at: p.updated_at,
        tercero: p.tercero || null,
      })),
    };
  },

  async guardarPropietarios(
    liquidacionTerceroFinalId: string,
    propietarios: Array<{
      id?: string | null;
      tercero_id?: string | null;
      nombre: string;
      identificacion?: string | null;
      porcentaje: number;
      nota?: string | null;
      aplica_retenciones?: boolean;
      orden?: number;
    }>
  ) {
    const cierre = await prisma.liquidacion_tercero_final.findFirst({
      where: { id: liquidacionTerceroFinalId, deleted_at: null },
      select: { id: true, estado: true, anio: true, mes: true },
    });
    if (!cierre) throw new Error('Liquidación final de tercero no encontrada');
    if (cierre.estado && cierre.estado !== 'BORRADOR') {
      throw new Error(
        `No se pueden modificar copropietarios en un cierre en estado ${cierre.estado}. Solo se permiten borradores.`
      );
    }

    // Validaciones básicas (NO validamos que la suma de porcentajes sea 100%).
    const listaLimpia = (Array.isArray(propietarios) ? propietarios : [])
      .map((p, idx) => ({
        id: p.id && typeof p.id === 'string' && p.id.length > 0 ? p.id : null,
        tercero_id:
          p.tercero_id && typeof p.tercero_id === 'string' && p.tercero_id.length > 0
            ? p.tercero_id
            : null,
        nombre: (p.nombre || '').toString().trim(),
        identificacion: p.identificacion ? String(p.identificacion).trim() : null,
        porcentaje: Number(p.porcentaje) || 0,
        nota: p.nota ? String(p.nota).trim().slice(0, 255) || null : null,
        aplica_retenciones: p.aplica_retenciones !== false,
        orden: Number.isFinite(Number(p.orden)) ? Number(p.orden) : idx,
      }))
      .filter((p) => p.nombre.length > 0);

    const idsEntrantes = new Set(listaLimpia.map((p) => p.id).filter(Boolean));

    await prisma.$transaction(async (tx) => {
      // 1) Soft-delete los copropietarios que ya no están en la lista.
      await tx.liquidacion_tercero_final_propietario.updateMany({
        where: {
          liquidacion_tercero_final_id: liquidacionTerceroFinalId,
          deleted_at: null,
          ...(idsEntrantes.size > 0 ? { id: { notIn: Array.from(idsEntrantes) as string[] } } : {}),
        },
        data: { deleted_at: new Date() },
      });

      // 2) Upsert de los copropietarios vigentes.
      for (const p of listaLimpia) {
        if (p.id) {
          await tx.liquidacion_tercero_final_propietario.update({
            where: { id: p.id },
            data: {
              tercero_id: p.tercero_id,
              nombre: p.nombre,
              identificacion: p.identificacion,
              porcentaje: p.porcentaje,
              nota: p.nota,
              aplica_retenciones: p.aplica_retenciones,
              orden: p.orden,
              deleted_at: null,
            },
          });
        } else {
          await tx.liquidacion_tercero_final_propietario.create({
            data: {
              id: randomUUID(),
              liquidacion_tercero_final_id: liquidacionTerceroFinalId,
              tercero_id: p.tercero_id,
              nombre: p.nombre,
              identificacion: p.identificacion,
              porcentaje: p.porcentaje,
              nota: p.nota,
              aplica_retenciones: p.aplica_retenciones,
              orden: p.orden,
            },
          });
        }
      }

      // 3) Cascada por orden: persistir el porcentaje efectivo de cada fila
      //    viva. Se relee de la BD (y no de `listaLimpia`) porque las filas
      //    nuevas acaban de recibir su id ahí dentro.
      const vivos = await tx.liquidacion_tercero_final_propietario.findMany({
        where: { liquidacion_tercero_final_id: liquidacionTerceroFinalId, deleted_at: null },
        select: { id: true, porcentaje: true, orden: true },
      });
      const efectivos = calcularPorcentajesEfectivos(
        vivos.map((v) => ({ id: v.id, porcentaje: toNumber(v.porcentaje), orden: v.orden }))
      );
      for (const v of vivos) {
        await tx.liquidacion_tercero_final_propietario.update({
          where: { id: v.id },
          data: { porcentaje_efectivo: efectivos.get(v.id) ?? 0 },
        });
      }

      // 4) Sincronizar la marca de multi-propietario del cierre.
      const hayPropietarios = listaLimpia.length > 0;
      await tx.liquidacion_tercero_final.update({
        where: { id: liquidacionTerceroFinalId },
        data: {
          es_multi_propietario: hayPropietarios,
          updated_at: new Date(),
        },
      });
    });

    // 5) Recalcular impuestos prorrateados por copropietario (si aplica).
    //    Si el usuario desactivó el modo multi-propietario (lista vacía),
    //    también recalculamos para volver al estado de 4 filas globales.
    await this.recalcularImpuestosPorPropietario(liquidacionTerceroFinalId);

    // 6) Recalcular totales del cierre (puede haber cambiado total_impuestos).
    await this.recalcularTotales(liquidacionTerceroFinalId);

    // Snapshot post-guardar propietarios
    try {
      await LiquidacionesSnapshotsService.capturar(liquidacionTerceroFinalId, {
        origen: 'manual',
        usuarioId: null,
      });
    } catch (snapErr) {
      console.error('[guardarPropietarios] Snapshot failed:', snapErr);
    }

    // `anio`/`mes` viajan para que el controller pueda emitir el
    // `sheet:invalidate` del periodo (cambia la geometría de la hoja).
    return {
      ...(await this.obtenerPropietarios(liquidacionTerceroFinalId)),
      anio: cierre.anio,
      mes: cierre.mes,
    };
  },

  /// Recalcula los conceptos de IMPUESTO del cierre aplicando el reparto
  /// porcentual por copropietario.
  ///
  /// - Si hay copropietarios activos, se generan N filas por cada impuesto
  ///   (una por copropietario) repartiendo el VALOR GLOBAL del impuesto por
  ///   el porcentaje EFECTIVO de la cascada (`reparto-propietarios.ts`), con
  ///   CUADRE EXACTO: la suma de las N filas de un concepto es siempre el
  ///   valor del impuesto global (residuo de redondeo al último propietario).
  ///   Con esto `total_impuestos` y `total_pagar` del cierre NO cambian al
  ///   pasar de 1 a N propietarios.
  /// - Si NO hay copropietarios activos, se revierte al comportamiento
  ///   normal (4 filas globales sin `propietario_id`).
  async recalcularImpuestosPorPropietario(liquidacionTerceroFinalId: string) {
    const cierre = await prisma.liquidacion_tercero_final.findUnique({
      where: { id: liquidacionTerceroFinalId },
      select: {
        id: true,
        estado: true,
        es_multi_propietario: true,
        adicionales: true,
        valor_liquidar: true,
      },
    });
    if (!cierre) throw new Error('Liquidación final de tercero no encontrada');

    // 1) Calcular las bases y los valores GLOBALES de los 4 impuestos (mismo
    //    algoritmo que `calcularImpuestos` cuando no hay multi-propietario).
    const allItems = await prisma.liquidacion_tercero_final_item.findMany({
      where: { liquidacion_tercero_final_id: liquidacionTerceroFinalId, deleted_at: null },
      include: { liquidacion_tercero: { select: { valor_liquidar: true } } },
    });

    // Mismo criterio que `calcularImpuestos` y el frontend: usar
    // `!== false` para que items con `aplica_impuestos: null/undefined`
    // (legacy) se cuenten como `true` por defecto. Evita la discrepancia
    // histórica entre "Base imponible" del UI ($20M) y la base real que
    // usaba el backend para calcular ICA ($10M = 50%).
    const baseConImpuestos = allItems
      .filter((it: any) => it.aplica_impuestos !== false)
      .reduce(
        (s: number, it: any) => s + toNumber(it.liquidacion_tercero?.valor_liquidar || 0),
        0
      );
    const baseTotalItems = allItems.reduce(
      (s: number, it: any) => s + toNumber(it.liquidacion_tercero?.valor_liquidar || 0),
      0
    );
    // Base imponible de los adicionales: sale de `totales-cierre.ts`, que lee
    // de la TABLA `liquidacion_tercero_final_adicional` con respaldo al JSONB.
    // Antes se leía el JSONB directamente, así que los adicionales creados
    // desde el canvas (que van a la tabla) no entraban en la base y los
    // impuestos salían cortos.
    const adicionalesSum = await sumarAdicionalesGravados(prisma, liquidacionTerceroFinalId);
    const baseConImpuestosTotal = baseConImpuestos + adicionalesSum;
    const baseTotalConAdicionales = baseTotalItems + adicionalesSum;

    const configDescuentos = await this.obtenerConfiguracion();
    // Orden canónico de los 4 impuestos (override del `orden` de la BD).
    const ORDEN_IMPUESTOS = [
      'RETENCION_ICA',
      'AVISOS_TABLEROS',
      'SOBRETASA_BOMBERIL',
      'RETENCION_FUENTE',
    ];
    const rankOrden = (concepto: string): number => {
      const i = ORDEN_IMPUESTOS.indexOf(concepto);
      return i === -1 ? 999 : i;
    };
    const impuestosConfig = configDescuentos
      .filter((c: any) => c.categoria === 'IMPUESTO' && c.activo)
      .slice()
      .sort((a: any, b: any) => rankOrden(a.concepto) - rankOrden(b.concepto));

    type ImpGlobal = {
      tipo: 'IMPUESTO';
      concepto: string;
      porcentaje: number;
      base_calculo: number;
      valor_total: number;
      calculado: boolean;
    };
    const impuestosGlobales: ImpGlobal[] = [];
    for (const cfg of impuestosConfig) {
      const porcentaje = toNumber(cfg.porcentaje);
      let baseCalculo = baseConImpuestosTotal;
      if (cfg.concepto === 'RETENCION_FUENTE' || cfg.base_calculo === 'TOTAL_VALOR_LIQUIDAR') {
        baseCalculo = baseTotalConAdicionales;
      } else if (
        // REGLA DE DOMINIO (NO configurable): AVISOS_TABLEROS y
        // SOBRETASA_BOMBERIL siempre se calculan sobre el VALOR de
        // RETENCION_ICA ya calculado en este mismo bucle.
        cfg.concepto === 'AVISOS_TABLEROS' ||
        cfg.concepto === 'SOBRETASA_BOMBERIL'
      ) {
        const retIca = impuestosGlobales.find((c) => c.concepto === 'RETENCION_ICA');
        if (retIca) baseCalculo = retIca.valor_total;
      }
      impuestosGlobales.push({
        tipo: 'IMPUESTO',
        concepto: cfg.concepto,
        porcentaje,
        base_calculo: baseCalculo,
        valor_total: baseCalculo * (porcentaje / 100),
        calculado: true,
      });
    }

    // 2) Leer copropietarios activos del cierre.
    const propietariosActivos = await prisma.liquidacion_tercero_final_propietario.findMany({
      where: { liquidacion_tercero_final_id: liquidacionTerceroFinalId, deleted_at: null },
      orderBy: [{ orden: 'asc' }, { created_at: 'asc' }],
    });

    const esMulti = !!cierre.es_multi_propietario && propietariosActivos.length > 0;

    // Porcentaje EFECTIVO de la cascada por orden, persistido de paso: cubre
    // filas anteriores a la migración (NULL) y restauraciones de snapshot con
    // el efectivo obsoleto, vengan por donde vengan (editor legado incluido).
    const efectivosMap = calcularPorcentajesEfectivos(
      propietariosActivos.map((p: any) => ({
        id: p.id,
        porcentaje: toNumber(p.porcentaje),
        orden: p.orden,
      }))
    );
    for (const p of propietariosActivos) {
      const efectivo = efectivosMap.get(p.id) ?? 0;
      if (p.porcentaje_efectivo == null || toNumber(p.porcentaje_efectivo) !== efectivo) {
        await prisma.liquidacion_tercero_final_propietario.update({
          where: { id: p.id },
          data: { porcentaje_efectivo: efectivo },
        });
      }
    }

    // 3) Preservar las filas IMPUESTO MANUALES (calculado = false). El
    //    usuario las edita/cambia desde la sección de copropietarios (toggle
    //    on/off, % por copropietario, agregar personalizado) y NO deben
    //    sobrescribirse cuando se recalculan los impuestos. Solo se
    //    reemplazan las filas AUTO (calculado = true).
    const filasManuales = await prisma.liquidacion_tercero_final_concepto.findMany({
      where: {
        liquidacion_tercero_final_id: liquidacionTerceroFinalId,
        tipo: 'IMPUESTO',
        deleted_at: null,
        calculado: false,
      },
    });

    // Borrar solo las filas AUTO. Las manuales quedan intactas.
    await prisma.liquidacion_tercero_final_concepto.updateMany({
      where: {
        liquidacion_tercero_final_id: liquidacionTerceroFinalId,
        tipo: 'IMPUESTO',
        deleted_at: null,
        calculado: true,
      },
      data: { deleted_at: new Date() },
    });

    if (!esMulti) {
      // Sin copropietarios activos: comportamiento legacy (4 filas globales).
      // Preservar filas manuales del mismo `concepto` (sin propietario_id).
      const manualSingleKeys = new Set(
        filasManuales
          .filter((r: any) => !r.propietario_id)
          .map((r: any) => r.concepto)
      );
      const impuestosAuto = impuestosGlobales.filter(
        (c) => !manualSingleKeys.has(c.concepto)
      );
      if (
        ['BORRADOR', 'LIQUIDADA'].includes(cierre.estado) &&
        impuestosAuto.length > 0
      ) {
        await prisma.liquidacion_tercero_final_concepto.createMany({
          data: impuestosAuto.map((c) => ({
            id: randomUUID(),
            liquidacion_tercero_final_id: liquidacionTerceroFinalId,
            tipo: c.tipo,
            concepto: c.concepto,
            valor_unitario: 0,
            porcentaje: c.porcentaje,
            valor_total: c.valor_total,
            base_calculo: c.base_calculo,
            calculado: true,
            propietario_id: null,
            orden: 0,
          })),
        });

        const totalImpuestos = [
          ...filasManuales.filter((r: any) => !r.propietario_id),
          ...impuestosAuto
        ].reduce((s: number, r: any) => s + toNumber(r.valor_total), 0);
        await prisma.liquidacion_tercero_final.update({
          where: { id: liquidacionTerceroFinalId },
          data: { total_impuestos: totalImpuestos },
        });
      }
      return await this.obtenerConceptos(liquidacionTerceroFinalId);
    }

    // 4) Modo multi-propietario. La aritmética es POR PROPIETARIO, no un
    //    prorrateo del impuesto global:
    //
    //      VALOR SERVICIO = valor a liquidar − descuentos generales
    //                       (nómina + gastos + anticipos)
    //      VALOR A FACTURAR de cada prop = su % efectivo del VALOR SERVICIO
    //                       (reparto con cuadre exacto)
    //      Retenciones SOLO para props con `aplica_retenciones`, calculadas
    //      sobre SU valor a facturar: ICA y FUENTE con el % de configuración
    //      sobre el facturar; AVISOS y SOBRETASA sobre su propia RETENCION_ICA
    //      (misma regla de dominio del modo single).
    //
    //    Un prop SIN retenciones (pago interno por concepto, ej. abono a
    //    crédito) no genera filas: su parte no tributa.
    //
    //    Si ya existe una fila MANUAL (calculado = false) para el par
    //    (concepto, propietario_id), NO se regenera: la edición del usuario
    //    gana sobre el cálculo automático.
    const conceptosNoImpuesto = await prisma.liquidacion_tercero_final_concepto.findMany({
      where: {
        liquidacion_tercero_final_id: liquidacionTerceroFinalId,
        deleted_at: null,
        tipo: { in: ['COSTO_LABORAL', 'GASTO_OPERATIVO', 'ANTICIPO'] },
      },
      select: { valor_total: true },
    });
    const descuentosGenerales = conceptosNoImpuesto.reduce(
      (s: number, c: any) => s + toNumber(c.valor_total),
      0
    );
    const valorServicio = toNumber(cierre.valor_liquidar) - descuentosGenerales;

    const facturarMap = repartirValor(
      valorServicio,
      propietariosActivos.map((p: any) => ({
        id: p.id,
        efectivo: efectivosMap.get(p.id) ?? 0,
        orden: p.orden,
      }))
    );

    const manualKeys = new Set(
      filasManuales.map((r: any) => `${r.concepto}|${r.propietario_id}`)
    );
    const filasNuevas: Array<{
      id: string;
      liquidacion_tercero_final_id: string;
      tipo: 'IMPUESTO';
      concepto: string;
      valor_unitario: number;
      porcentaje: number;
      valor_total: number;
      base_calculo: number;
      calculado: boolean;
      propietario_id: string;
      orden: number;
    }> = [];

    for (const prop of propietariosActivos) {
      if (prop.aplica_retenciones === false) continue;
      const facturar = facturarMap.get(prop.id) ?? 0;
      // Si su RETENCION_ICA es manual, AVISOS y SOBRETASA gravan sobre ese
      // valor editado, no sobre cero.
      const manualIca = filasManuales.find(
        (r: any) => r.concepto === 'RETENCION_ICA' && r.propietario_id === prop.id
      );
      let retIcaProp = manualIca ? toNumber(manualIca.valor_total) : 0;
      for (const cfg of impuestosConfig) {
        if (manualKeys.has(`${cfg.concepto}|${prop.id}`)) continue;
        const porcentaje = toNumber(cfg.porcentaje);
        const base =
          cfg.concepto === 'AVISOS_TABLEROS' || cfg.concepto === 'SOBRETASA_BOMBERIL'
            ? retIcaProp
            : facturar;
        const valor = Math.round(base * (porcentaje / 100));
        if (cfg.concepto === 'RETENCION_ICA') retIcaProp = valor;
        filasNuevas.push({
          id: randomUUID(),
          liquidacion_tercero_final_id: liquidacionTerceroFinalId,
          tipo: 'IMPUESTO',
          concepto: cfg.concepto,
          valor_unitario: 0,
          porcentaje,
          valor_total: valor,
          base_calculo: base,
          calculado: true,
          propietario_id: prop.id,
          orden: 0,
        });
      }
    }

    if (['BORRADOR', 'LIQUIDADA'].includes(cierre.estado) && filasNuevas.length > 0) {
      await prisma.liquidacion_tercero_final_concepto.createMany({
        data: filasNuevas,
      });

      // total_impuestos del cierre = Σ de TODAS las filas (manuales + auto).
      // - manuales: filas que el usuario editó en la sección de copropietarios.
      // - auto: las que acabamos de crear.
      const totalImpuestos = [
        ...filasManuales,
        ...filasNuevas
      ].reduce((s: number, c: any) => s + toNumber(c.valor_total), 0);
      await prisma.liquidacion_tercero_final.update({
        where: { id: liquidacionTerceroFinalId },
        data: { total_impuestos: totalImpuestos },
      });
    } else if (filasManuales.length > 0) {
      // Solo tenemos filas manuales (no se generaron auto nuevas). Solo
      // actualizar el total_impuestos del cierre.
      const totalImpuestos = filasManuales.reduce(
        (s: number, r: any) => s + toNumber(r.valor_total),
        0
      );
      await prisma.liquidacion_tercero_final.update({
        where: { id: liquidacionTerceroFinalId },
        data: { total_impuestos: totalImpuestos },
      });
    }

    return await this.obtenerConceptos(liquidacionTerceroFinalId);
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
        // `tercero_id` y `es_multi_propietario` son ADITIVOS: el historial
        // los ignora, pero el canvas los necesita para identificar la hoja
        // (una placa puede tener dos cierres en el mismo mes, uno por
        // propietario) y para saber si pinta la sección de copropietarios.
        tercero_id: true,
        es_multi_propietario: true,
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
            tercero_id: item.tercero_id ?? null,
            es_multi_propietario: item.es_multi_propietario === true,
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

  async obtenerPorId(liquidacionTerceroFinalId: string, opts: { includeDeleted?: boolean } = {}) {
    const includeDeleted = opts.includeDeleted === true;
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
          // La vista de edición necesita ver los items soft-deleted para que
          // el usuario pueda "reactivarlos" sin tener que regenerar el
          // borrador. La vista normal y los listados siguen filtrándolos.
          where: includeDeleted ? {} : { deleted_at: null },
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
            propietario: {
              select: { id: true, nombre: true, identificacion: true, porcentaje: true },
            },
          },
          orderBy: [{ orden: 'asc' }, { concepto: 'asc' }],
        },
        propietarios: {
          where: { deleted_at: null },
          include: {
            tercero: {
              // `correo` es el destinatario por defecto del envío por
              // copropietario: sin él, el modal no tiene de dónde sacar a
              // quién escribirle y obliga a teclear N direcciones a mano.
              select: {
                id: true,
                nombre_completo: true,
                identificacion: true,
                tipo_persona: true,
                correo: true,
              },
            },
          },
          orderBy: [{ orden: 'asc' }, { created_at: 'asc' }],
        },
        // Adicionales en TABLA. El JSONB `adicionales` sigue existiendo como
        // respaldo del backfill, pero es el que estaba leyendo este detalle:
        // un adicional creado desde el canvas (que escribe en la tabla) no
        // aparecía aquí, así que el editor y el PDF mostraban un total y el
        // canvas otro.
        adicionales_filas: {
          where: { deleted_at: null },
          orderBy: [{ orden: 'asc' }, { created_at: 'asc' }],
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
            deleted_at: it.deleted_at ?? null,
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
      // en `ingreso_empresa` del lado Transmeralda.
      // Tabla primero, JSONB solo como respaldo cuando la tabla está vacía.
      // NUNCA los dos: sumarlos duplicaría los adicionales de los cierres
      // que ya pasaron por el backfill. Misma regla que `totales-cierre.ts`.
      items_adicionales: (
        (item.adicionales_filas?.length
          ? item.adicionales_filas
          : Array.isArray(item.adicionales)
            ? (item.adicionales as any[])
            : []) as any[]
      ).map((a: any) => ({
        ...a,
        valor_unitario: toNumber(a.valor_unitario),
        cantidad: toNumber(a.cantidad),
        valor_liquidar: toNumber(a.valor_liquidar),
      })),
      conceptos: (item.conceptos || []).map(serializeConcepto),
      // ── Reparto porcentual por copropietarios ──
      // `es_multi_propietario` se expone como flag del cierre (default false).
      // `propietarios` es la lista de copropietarios activos con su porcentaje
      // (sin normalizar — puede sumar más o menos de 100% según lo que el
      // usuario haya definido).
      es_multi_propietario: !!item.es_multi_propietario,
      propietarios: (item.propietarios || []).map((p: any) => ({
        id: p.id,
        liquidacion_tercero_final_id: p.liquidacion_tercero_final_id,
        tercero_id: p.tercero_id,
        nombre: p.nombre,
        identificacion: p.identificacion,
        porcentaje: toNumber(p.porcentaje),
        porcentaje_efectivo: efectivoDePropietario(p, item.propietarios || []),
        nota: p.nota ?? null,
        aplica_retenciones: p.aplica_retenciones !== false,
        orden: p.orden,
        created_at: p.created_at,
        updated_at: p.updated_at,
        tercero: p.tercero || null,
      })),
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
      where: { id: { in: liquidacionTerceroIds }, deleted_at: null },
      select: { id: true, placa: true, tercero_id: true, liquidacion_id: true, valor_liquidar: true },
    });
    if (itemsValidos.length !== liquidacionTerceroIds.length) {
      const idsEncontrados = new Set(itemsValidos.map((i) => i.id));
      const faltantes = liquidacionTerceroIds.filter((id) => !idsEncontrados.has(id));
      throw new Error(`Items no encontrados: ${faltantes.join(', ')}`);
    }

    /// 1. Reemplazar los items del pivote.
    ///
    /// El comentario anterior decía que las filas soft-deleted se conservaban
    /// «para auditoría», pero la operación era `deleteMany`: las ACTIVAS se
    /// borraban físicamente en cada guardado. Es el mismo fallo que dejó una
    /// liquidación de servicios sin ítems al restaurarla. Ahora se marcan.
    await prisma.$transaction([
      prisma.liquidacion_tercero_final_item.updateMany({
        where: { liquidacion_tercero_final_id: liquidacionTerceroFinalId, deleted_at: null },
        data: { deleted_at: new Date() },
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

    // 2. Recalcular TODO en una sola pasada.
    //
    // Antes había aquí un cálculo propio de `valor_liquidar` (items del
    // payload + adicionales del JSONB) seguido de `recalcularTotales`, que
    // volvía a calcularlo con otro criterio. El primer update era
    // redundante y, peor, podía dejar un valor distinto si alguien leía
    // entre los dos. `recalcularTotales` ya delega en `totales-cierre.ts`,
    // que lee los items de los pivotes vivos y los adicionales de la tabla.
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
    const item = await prisma.liquidacion_tercero_final_item.findUnique({
      where: { id: pivoteId },
      select: { liquidacion_tercero_final_id: true },
    });
    if (!item) throw new Error('Item de pivote no encontrado');

    await prisma.liquidacion_tercero_final_item.update({
      where: { id: pivoteId },
      data: { aplica_impuestos },
    });

    // ⚠️ ESTA LLAMADA FALTABA.
    // El flag decide qué items entran en la base de RETENCION_ICA,
    // AVISOS_TABLEROS y SOBRETASA_BOMBERIL, pero ese filtro solo se aplica
    // dentro de `calcularImpuestos`. Sin invocarlo, el flag quedaba escrito
    // y ninguna retención cambiaba: el toggle no hacía nada visible.
    //
    // `recalcularTotales` tampoco sirve: solo regenera las filas de IMPUESTO
    // cuando el cierre es multi-propietario.
    //
    // RETENCION_FUENTE no se ve afectada por el flag — grava sobre TODOS los
    // items—, y eso es correcto: son dos bases distintas a propósito.
    await this.calcularImpuestos(item.liquidacion_tercero_final_id);
    await this.recalcularTotales(item.liquidacion_tercero_final_id);

    return this.obtenerPorId(item.liquidacion_tercero_final_id);
  },

  // ── TOGGLE EXCLUIR (SOFT DELETE) EN ITEM DEL PIVOTE ──
  // Marca/desmarca `deleted_at` en la fila `liquidacion_tercero_final_item`
  // para que el item deje de contar en los totales pero siga visible (con
  // tachado) en la vista de edición. El parámetro `excluir` es explícito en
  // vez de un toggle para que la UI pueda fijar el estado directamente
  // (true ⇒ soft-delete, false ⇒ restaurar).

  async toggleExcluirItem(pivoteId: string, excluir: boolean) {
    const pivote = await prisma.liquidacion_tercero_final_item.findUnique({
      where: { id: pivoteId },
      select: { id: true, liquidacion_tercero_final_id: true, deleted_at: true },
    });
    if (!pivote) throw new Error('Item de pivote no encontrado');

    // Si ya está en el estado deseado, no hacemos nada (idempotente).
    const isExcluido = !!pivote.deleted_at;
    if (isExcluido === !!excluir) {
      return this.obtenerPorId(pivote.liquidacion_tercero_final_id, { includeDeleted: true });
    }

    await prisma.liquidacion_tercero_final_item.update({
      where: { id: pivoteId },
      data: { deleted_at: excluir ? new Date() : null },
    });

    // Recalcular totales del cierre: el `valor_liquidar` consolidado NO
    // cambia (los items siguen ahí, solo están tachados), pero disparamos el
    // recálculo por seguridad para mantener la base de impuestos y los
    // descuentos alineados con la nueva membresía del pivote.
    // Igual que en `actualizarAplicaImpuestosItem`: excluir un item saca su
    // `valor_liquidar` de la base imponible, y eso solo lo aplica
    // `calcularImpuestos`. `recalcularTotales` por sí solo dejaría las
    // retenciones calculadas sobre una base que ya no existe.
    await this.calcularImpuestos(pivote.liquidacion_tercero_final_id);
    await this.recalcularTotales(pivote.liquidacion_tercero_final_id);

    return this.obtenerPorId(pivote.liquidacion_tercero_final_id, { includeDeleted: true });
  },

  // ── REFRESH ITEMS DEL CIERRE ──
  // Trae `liquidacion_tercero` rows que existen en BD para la placa/mes/año/
  // tercero del cierre pero que AÚN NO están en el pivote (`liquidacion_tercero_final_item`).
  //
  // Caso de uso: el usuario ya liquidó al tercero con 10 items. Luego se crean
  // 5 liquidaciones de servicio nuevas (cada una con 1 item del mismo
  // tercero/placa/mes/año). Sin este botón, esos 5 items no aparecen en el
  // cierre: hay que generar un borrador nuevo (lo que duplicaría el cierre
  // porque ya existe uno BORRADOR). Con `refreshItems`, los nuevos items se
  // agregan al pivote existente sin perder el trabajo del usuario.
  //
  // - Si el cierre está ANULADO / APROBADO / FACTURADO / REEMPLAZADA, no se
  //   permite (rompería la integridad del histórico).
  // - Si un item del pivote fue soft-deleted (✕), se preserva: NO se reactiva
  //   (es decisión del usuario).
  // - El recalculo de totales se hace al final para incluir los nuevos items.

  async refreshItems(liquidacionTerceroFinalId: string) {
    const cierre = await prisma.liquidacion_tercero_final.findFirst({
      where: { id: liquidacionTerceroFinalId, deleted_at: null },
      select: {
        id: true,
        placa: true,
        mes: true,
        anio: true,
        tercero_id: true,
        estado: true,
      },
    });
    if (!cierre) {
      throw new Error('Liquidación final de tercero no encontrada');
    }
    if (cierre.estado && cierre.estado !== 'BORRADOR') {
      throw new Error(
        `No se pueden refrescar items en un cierre en estado ${cierre.estado}. Solo se permiten borradores.`
      );
    }
    if (!cierre.mes || !cierre.anio || !cierre.placa) {
      throw new Error('El cierre no tiene mes/año/placa definidos');
    }

    // 1. IDs de liquidacion_tercero YA vinculados al cierre (incluyendo
    //    soft-deleted, para no revivir un item que el usuario tachó).
    const pivoteExistente = await prisma.liquidacion_tercero_final_item.findMany({
      where: { liquidacion_tercero_final_id: liquidacionTerceroFinalId },
      select: { liquidacion_tercero_id: true },
    });
    const idsYaEnPivote = new Set(pivoteExistente.map((p) => p.liquidacion_tercero_id));

    // 2. Buscar todos los `liquidacion_tercero` que coincidan con el filtro
    //    del cierre: misma placa, mismo mes, mismo año, mismo tercero_id
    //    (si el cierre lo tiene). El modelo no tiene soft delete.
    const ltWhere: any = {
      placa: { equals: cierre.placa, mode: 'insensitive' as any },
      mes: cierre.mes,
      anio: cierre.anio,
    };
    if (cierre.tercero_id) {
      ltWhere.tercero_id = cierre.tercero_id;
    }
    const ltCandidatos = await prisma.liquidacion_tercero.findMany({
      where: ltWhere,
      select: { id: true, valor_liquidar: true },
    });

    // 3. Filtrar los que NO están en el pivote.
    const ltNuevos = ltCandidatos.filter((lt) => !idsYaEnPivote.has(lt.id));
    if (ltNuevos.length === 0) {
      return {
        ok: true,
        agregados: 0,
        ya_existentes: ltCandidatos.length,
        message: 'No hay items nuevos para agregar',
      };
    }

    // 4. Insertar el `orden` máximo actual + 1 para preservar orden estable.
    const maxOrden = await prisma.liquidacion_tercero_final_item.aggregate({
      where: { liquidacion_tercero_final_id: liquidacionTerceroFinalId },
      _max: { orden: true },
    });
    const baseOrden = (maxOrden._max.orden || 0) + 1;

    // 5. Crear las nuevas filas del pivote en una sola transacción.
    await prisma.$transaction(
      ltNuevos.map((lt, idx) =>
        prisma.liquidacion_tercero_final_item.create({
          data: {
            liquidacion_tercero_final_id: liquidacionTerceroFinalId,
            liquidacion_tercero_id: lt.id,
            orden: baseOrden + idx,
            aplica_impuestos: true,
          },
        })
      )
    );

    // 6. Recalcular totales para que `valor_liquidar`/`total_pagar`/base
    //    imponible reflejen los nuevos items.
    await this.recalcularTotales(liquidacionTerceroFinalId);

    // 7. Snapshot post-refresh.
    try {
      await LiquidacionesSnapshotsService.capturar(liquidacionTerceroFinalId, {
        origen: 'refresh-items',
        usuarioId: null,
      });
    } catch (snapErr) {
      console.error('[refreshItems] Snapshot failed:', snapErr);
    }

    // 8. Socket: notificar a todos los clientes en la room del cierre que
    //    se agregaron items al pivote, para que refresquen la tabla de items
    //    en tiempo real. Usamos el mismo `row:updated` que ya emite el
    //    gateway de realtime collab (con `itemsRefreshed: true` en changes)
    //    para que la página de edición pueda detectarlo y re-fetchear el
    //    cierre completo. Si no se agregó nada, no emitimos (no hay nada
    //    que refrescar del lado de los demás).
    if (ltNuevos.length > 0) {
      try {
        const io = getIo();
        const roomKey = `row:liquidacion-tercero-final:${liquidacionTerceroFinalId}`;
        const updatedPayload = {
          id: liquidacionTerceroFinalId,
          changes: {
            itemsRefreshed: true,
            agregados: ltNuevos.length,
          },
          updatedBy: 'refresh-items',
          // Sin `updatedById` a propósito: el handler del cliente usa este
          // campo para detectar self-saves y descartarlos. El refresh de items
          // no es un self-save (puede venir de otro cliente) y debe aplicarse
          // siempre en todos los clientes conectados, incluido el que lo
          // disparó (la operación es idempotente).
          updatedAt: new Date().toISOString(),
        };
        io.to(roomKey).emit('row:updated', updatedPayload);
        console.log(
          `[refreshItems] socket emit row:updated id=${liquidacionTerceroFinalId} agregados=${ltNuevos.length}`
        );
      } catch (emitErr) {
        console.error('[refreshItems] socket emit failed:', emitErr);
      }
    }

    return {
      ok: true,
      agregados: ltNuevos.length,
      ya_existentes: ltCandidatos.length,
      message: `Se agregaron ${ltNuevos.length} item(s) nuevo(s) al cierre`,
    };
  },

  // ── ITEMS DISPONIBLES PARA AÑADIR A MANO ──
  //
  // `refreshItems` solo mira el MISMO periodo y el MISMO tercero del cierre,
  // que es lo correcto cuando el borrador se quedó corto porque entraron
  // liquidaciones de servicio nuevas ese mes. No sirve para el otro caso, que
  // es el que trae aquí: una facturada que se registra HOY pero pertenece —o
  // se quiere cobrar— en el cierre de JUNIO. Ese item nunca cae en el filtro
  // de `refreshItems`, y la única salida era regenerar el borrador, que se
  // lleva por delante el trabajo hecho sobre la hoja.
  //
  // Lo que decide si un item es candidato es LA PLACA, no el tercero: un
  // mismo vehículo puede haber rodado con terceros distintos y el cierre es
  // del vehículo. Por eso `tercero_id` NO filtra —solo se muestra, para que
  // quien elige vea con quién iba— y el mes/año tampoco.
  //
  // Lo que sí es innegociable es que un item no puede estar en DOS cierres:
  // se pagaría dos veces. De ahí el filtro por `finales`, que mira TODOS los
  // cierres vivos y no solo este. Un item soft-deleted de ESTE cierre tampoco
  // aparece: su fila de pivote sigue existiendo, así que se devuelve desde
  // «Filas del cierre → Items → Devolver», no desde aquí.
  async itemsDisponibles(liquidacionTerceroFinalId: string) {
    const cierre = await prisma.liquidacion_tercero_final.findFirst({
      where: { id: liquidacionTerceroFinalId, deleted_at: null },
      select: {
        id: true, placa: true, mes: true, anio: true,
        tercero_id: true, estado: true, consecutivo: true,
      },
    });
    if (!cierre) throw new Error('Liquidación final de tercero no encontrada');
    if (!cierre.placa) throw new Error('El cierre no tiene placa definida');

    const candidatos = await prisma.liquidacion_tercero.findMany({
      where: { placa: { equals: cierre.placa, mode: 'insensitive' as any }, deleted_at: null },
      select: {
        id: true,
        placa: true,
        recorrido: true,
        fechas: true,
        mes: true,
        anio: true,
        valor_unitario: true,
        cantidad: true,
        porcentaje_admin: true,
        valor_admin: true,
        total_facturado: true,
        valor_liquidar: true,
        created_at: true,
        tercero: { select: { id: true, nombre_completo: true, identificacion: true } },
        item: { select: { id: true, numero_planilla: true } },
        liquidacion: {
          select: {
            id: true, consecutivo: true, mes: true, anio: true, estado: true,
            cliente: { select: { id: true, nombre: true } },
            factura_items: {
              where: { factura: { deleted_at: null, estado: 'ACTIVA' } },
              select: { factura: { select: { numero_factura: true } } },
            },
          },
        },
        // Cierres —vivos o no— en los que este item ya está. Se piden todos y
        // se filtra en memoria: `deleted_at` está en la cabecera, no en el
        // pivote, y un `where` anidado sobre la relación dejaría fuera los
        // items que NO están en ningún cierre, que son justo los que se buscan.
        finales: {
          select: {
            deleted_at: true,
            liquidacion_tercero_final: {
              select: { id: true, consecutivo: true, mes: true, anio: true, estado: true, deleted_at: true },
            },
          },
        },
      },
      orderBy: [{ anio: 'desc' }, { mes: 'desc' }, { created_at: 'desc' }],
    });

    const ocupados: Array<{ id: string; cierre: string | null }> = [];
    const disponibles = candidatos
      .filter((lt: any) => {
        const enUso = (lt.finales || []).find(
          (f: any) => f.liquidacion_tercero_final && !f.liquidacion_tercero_final.deleted_at
        );
        if (enUso) {
          ocupados.push({ id: lt.id, cierre: enUso.liquidacion_tercero_final.consecutivo ?? null });
          return false;
        }
        return true;
      })
      .map((lt: any) => ({
        id: lt.id,
        placa: lt.placa,
        recorrido: lt.recorrido || '',
        fechas: lt.fechas || '',
        // El periodo del ITEM, que es por el que se busca. Puede no coincidir
        // con el de su liquidación de servicio, así que se cae a ese antes de
        // darlo por desconocido.
        mes: lt.mes ?? lt.liquidacion?.mes ?? null,
        anio: lt.anio ?? lt.liquidacion?.anio ?? null,
        tercero_id: lt.tercero?.id ?? null,
        tercero_nombre: lt.tercero?.nombre_completo ?? null,
        // Si el tercero del item NO es el del cierre, la UI lo avisa: es
        // legítimo (la placa manda) pero conviene verlo antes de aceptar.
        otro_tercero: !!(cierre.tercero_id && lt.tercero?.id && lt.tercero.id !== cierre.tercero_id),
        cliente_nombre: lt.liquidacion?.cliente?.nombre ?? '',
        liquidacion_consecutivo: lt.liquidacion?.consecutivo ?? '',
        liquidacion_estado: lt.liquidacion?.estado ?? null,
        numero_planilla: lt.item?.numero_planilla ?? '',
        numero_factura: Array.from(
          new Set(
            (lt.liquidacion?.factura_items || [])
              .map((fi: any) => fi.factura?.numero_factura)
              .filter(Boolean)
          )
        ).join(', '),
        valor_unitario: toNumber(lt.valor_unitario),
        cantidad: toNumber(lt.cantidad),
        porcentaje_admin: toNumber(lt.porcentaje_admin),
        valor_admin: toNumber(lt.valor_admin),
        total_facturado: toNumber(lt.total_facturado),
        valor_liquidar: toNumber(lt.valor_liquidar),
        created_at: lt.created_at,
      }));

    return {
      cierre: {
        id: cierre.id,
        placa: cierre.placa,
        mes: cierre.mes,
        anio: cierre.anio,
        estado: cierre.estado,
        consecutivo: cierre.consecutivo,
        editable: !cierre.estado || cierre.estado === 'BORRADOR',
      },
      disponibles,
      // Cuántos items de la placa quedaron fuera por estar ya en un cierre.
      // Se devuelve el número y no la lista: sirve para explicar un listado
      // más corto de lo que el usuario esperaba, no para operar sobre ellos.
      ocupados: ocupados.length,
      total: candidatos.length,
    };
  },

  // ── AÑADIR ITEMS AL CIERRE A MANO ──
  //
  // Misma mecánica que `refreshItems` de la fila 4 en adelante —pivote,
  // recálculo, snapshot y socket—, pero con los ids que ELIGE el usuario en
  // vez de los que salen de un filtro. Las validaciones sí son propias: aquí
  // los ids vienen de fuera y hay que comprobar uno por uno que existen, que
  // son de la placa del cierre y que no están ya comprometidos en otro.
  async agregarItems(liquidacionTerceroFinalId: string, liquidacionTerceroIds: string[]) {
    const ids = Array.from(new Set((liquidacionTerceroIds || []).filter(Boolean)));
    if (ids.length === 0) throw new Error('No se recibió ningún item para agregar');

    const cierre = await prisma.liquidacion_tercero_final.findFirst({
      where: { id: liquidacionTerceroFinalId, deleted_at: null },
      select: { id: true, placa: true, estado: true },
    });
    if (!cierre) throw new Error('Liquidación final de tercero no encontrada');
    if (cierre.estado && cierre.estado !== 'BORRADOR') {
      throw new Error(
        `No se pueden agregar items en un cierre en estado ${cierre.estado}. Solo se permiten borradores.`
      );
    }

    const candidatos = await prisma.liquidacion_tercero.findMany({
      where: { id: { in: ids }, deleted_at: null },
      select: {
        id: true,
        placa: true,
        recorrido: true,
        finales: {
          select: {
            liquidacion_tercero_final: { select: { id: true, consecutivo: true, deleted_at: true } },
          },
        },
      },
    });

    const porId = new Map(candidatos.map((c: any) => [c.id, c]));
    const faltan = ids.filter((id) => !porId.has(id));
    if (faltan.length > 0) {
      throw new Error(`${faltan.length} item(s) ya no existen en la base`);
    }

    const placaCierre = (cierre.placa || '').trim().toUpperCase();
    for (const c of candidatos as any[]) {
      if ((c.placa || '').trim().toUpperCase() !== placaCierre) {
        throw new Error(
          `El item "${c.recorrido || c.id}" es de la placa ${c.placa} y este cierre es de ${cierre.placa}`
        );
      }
      const enUso = (c.finales || []).find(
        (f: any) => f.liquidacion_tercero_final && !f.liquidacion_tercero_final.deleted_at
      );
      if (enUso) {
        const cons = enUso.liquidacion_tercero_final.consecutivo || enUso.liquidacion_tercero_final.id;
        throw new Error(
          `El item "${c.recorrido || c.id}" ya está en el cierre ${cons}. Quítalo de allí antes de traerlo aquí.`
        );
      }
    }

    const maxOrden = await prisma.liquidacion_tercero_final_item.aggregate({
      where: { liquidacion_tercero_final_id: liquidacionTerceroFinalId },
      _max: { orden: true },
    });
    const baseOrden = (maxOrden._max.orden || 0) + 1;

    await prisma.$transaction(
      ids.map((ltId, idx) =>
        prisma.liquidacion_tercero_final_item.create({
          data: {
            liquidacion_tercero_final_id: liquidacionTerceroFinalId,
            liquidacion_tercero_id: ltId,
            orden: baseOrden + idx,
            aplica_impuestos: true,
          },
        })
      )
    );

    await this.recalcularTotales(liquidacionTerceroFinalId);

    try {
      await LiquidacionesSnapshotsService.capturar(liquidacionTerceroFinalId, {
        origen: 'items-manuales',
        usuarioId: null,
      });
    } catch (snapErr) {
      console.error('[agregarItems] Snapshot failed:', snapErr);
    }

    // Mismo evento que `refreshItems`: los demás clientes de la room no
    // necesitan saber CÓMO entraron los items, solo que el pivote cambió.
    try {
      const io = getIo();
      io.to(`row:liquidacion-tercero-final:${liquidacionTerceroFinalId}`).emit('row:updated', {
        id: liquidacionTerceroFinalId,
        changes: { itemsRefreshed: true, agregados: ids.length },
        updatedBy: 'items-manuales',
        updatedAt: new Date().toISOString(),
      });
    } catch (emitErr) {
      console.error('[agregarItems] socket emit failed:', emitErr);
    }

    return {
      ok: true,
      agregados: ids.length,
      message: `Se agregaron ${ids.length} item(s) al cierre`,
    };
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
        deleted_at: null,
        liquidacion_vehiculo: { some: { vehiculo_id: vehiculo.id, deleted_at: null } },
        periodo_start: { lte: periodoEnd },
        periodo_end: { gte: periodoStart },
      },
      include: {
        bonificaciones: {
          where: { deleted_at: null, vehiculo_id: vehiculo.id },
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
        deleted_at: null,
        liquidacion_vehiculo: { some: { vehiculo_id: vehiculo.id, deleted_at: null } },
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

  /**
   * Cambia el estado del cierre y devuelve el detalle serializado.
   *
   * La validación (transiciones, permisos, concurrencia), el historial y
   * el socket viven en `CierreEstadoService`; aquí solo queda releer y
   * serializar la forma que ya consume el editor tabular.
   */
  async cambiarEstado(
    liquidacionTerceroFinalId: string,
    estado: string,
    userId: string,
    motivo_anulacion?: string,
    opts?: { areas?: string[] | string | null; userName?: string | null; base_version?: number | null },
  ) {
    const cambio = await CierreEstadoService.cambiar({
      id: liquidacionTerceroFinalId,
      estado,
      motivo: motivo_anulacion ?? null,
      base_version: opts?.base_version ?? null,
      actor: { id: userId || null, name: opts?.userName ?? null, areas: opts?.areas ?? null },
    });

    const updated = await prisma.liquidacion_tercero_final.findUniqueOrThrow({
      where: { id: liquidacionTerceroFinalId },
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
      // La versión nueva viaja explícita: el header del canvas la necesita
      // como `base_version` del siguiente cambio de estado.
      version: cambio.version,
      estado_anterior: cambio.estado_anterior,
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
