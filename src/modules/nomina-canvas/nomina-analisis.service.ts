/**
 * Análisis de nómina: todas las liquidaciones del canvas, con sus totales y
 * su detalle por vehículo, listas para filtrar por años, meses, placas,
 * conductores y estados.
 *
 * Sustituye a `GET /liquidaciones/analisis`, que devolvía el listado entero
 * de liquidaciones con su `include` de catálogo y dejaba al cliente deducir el
 * periodo, el estado y las placas. Aquí cada fila ya trae:
 *
 *   · el periodo resuelto —el mes de nómina es el mes en que TERMINA el
 *     corte, que es como lo nombra el canvas—,
 *   · el estado del flujo y si el desprendible está firmado,
 *   · los totales del desprendible para salario, pernoctes y deducciones,
 *   · las marcas de bonificación en Recorridos y los días/tipos/importes de
 *     Recargos Planillas,
 *   · y el detalle por vehículo de pernoctes y mantenimientos.
 *
 * Los filtros de conductor, estado y placa van en el `where`. Año y mes tienen
 * dos significados distintos: el resumen usa el mes en que termina el corte,
 * mientras que las pestañas de conceptos usan el mes guardado en cada dato.
 * Por eso se consultan también cortes que se cruzan con los meses de referencia
 * y el cliente aplica cada filtro sobre la fecha que corresponde.
 */
import { prisma } from '../../config/prisma';
import { CODIGOS_RECARGO } from './nomina-canvas.types';

export interface FiltrosAnalisisNomina {
  anios: number[];
  meses: number[];
  placas: string[];
  conductores: string[];
  estados: string[];
}

export interface VehiculoAnalisis {
  id: string;
  placa: string;
}

export interface BonificacionAnalisis {
  vehiculo_id: string | null;
  placa: string | null;
  nombre: string;
  valor_unitario: number;
  /** `{ mes: '2026-09', cantidad }` por mes de la marca en Recorridos. */
  valores: { mes: string; cantidad: number }[];
}

export interface BonificacionRecorridoAnalisis {
  conductor_id: string;
  conductor: string;
  placa: string | null;
  nombre: string;
  mes: string;
  cantidad: number;
  valor_unitario: number;
  total: number;
  fechas: string[];
}

export interface RecargoJornadaDiaAnalisis {
  fecha: string;
}

export interface RecargoPlanillaDiaAnalisis {
  fecha: string;
}

export interface RecargoPlanillaAnalisis {
  planilla_id: string;
  numero_planilla: string | null;
  estado: string;
  conductor_id: string;
  conductor: string;
  vehiculo_id: string | null;
  placa: string | null;
  empresa_id: string;
  empresa: string;
  mes: string;
  dias: RecargoPlanillaDiaAnalisis[];
  valor_pagar: number;
}

export interface RecargoJornadaAnalisis {
  planilla_id: string;
  numero_planilla: string | null;
  vehiculo_id: string | null;
  placa: string | null;
  cliente_id: string | null;
  cliente: string;
  mes: string;
  dias: RecargoJornadaDiaAnalisis[];
  valor: number;
}

export interface PernocteAnalisis {
  vehiculo_id: string | null;
  placa: string | null;
  cantidad: number;
  valor_unitario: number;
  fechas: string[];
  cliente: string;
}

export interface MantenimientoAnalisis {
  vehiculo_id: string | null;
  placa: string | null;
  valores: { mes: string; cantidad: number }[];
}

export interface LiquidacionAnalisis {
  id: string;
  conductor: { id: string | null; nombre: string; cedula: string | null };
  periodo_start: string;
  periodo_end: string;
  anio: number;
  mes: number;
  corte: number;
  estado_flujo: string;
  firmado: boolean;
  desprendible_visible: boolean;
  dias_laborados: number;
  salario_basico: number;
  salario_devengado: number;
  auxilio_transporte: number;
  total_bonificaciones: number;
  total_recargos: number;
  total_pernotes: number;
  total_vacaciones: number;
  total_licencia: number;
  valor_incapacidad: number;
  total_anticipos: number;
  salud: number;
  pension: number;
  sueldo_total: number;
  vehiculos: VehiculoAnalisis[];
  bonificaciones: BonificacionAnalisis[];
  recargos_jornada: RecargoJornadaAnalisis[];
  pernotes: PernocteAnalisis[];
  mantenimientos: MantenimientoAnalisis[];
}

export interface CatalogosAnalisis {
  anios: number[];
  placas: string[];
  conductores: { id: string; nombre: string }[];
  estados: string[];
}

export interface ResultadoAnalisisNomina {
  liquidaciones: LiquidacionAnalisis[];
  /** Marcas de Recorridos agrupadas por conductor, placa, bono y mes calendario. */
  bonificaciones_recorridos: BonificacionRecorridoAnalisis[];
  /** Días, tipos e importes calculados a partir de Recargos Planillas. */
  recargos_planillas: RecargoPlanillaAnalisis[];
  catalogos: CatalogosAnalisis;
  total: number;
  meta: { recargos_jornada_grupos: number };
}

const ESTADOS = ['BORRADOR', 'LIQUIDADA', 'APROBADA', 'PAGADA', 'FIRMADA', 'ANULADA'];

const num = (v: unknown): number => {
  if (v === null || v === undefined) return 0;
  const n = typeof v === 'number' ? v : Number(String(v));
  return Number.isFinite(n) ? n : 0;
};

/** `values` llega como JSON (array) o como texto JSON según la fila. */
function valoresMensuales(raw: unknown): { mes: string; cantidad: number }[] {
  let lista: any = raw;
  if (typeof raw === 'string') {
    try {
      lista = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(lista)) return [];
  return lista
    .map((x: any) => ({ mes: String(x?.mes ?? ''), cantidad: num(x?.quantity ?? x?.cantidad) }))
    .filter((x: { mes: string; cantidad: number }) => x.mes);
}

function fechasDe(raw: unknown): string[] {
  let lista: any = raw;
  if (typeof raw === 'string') {
    try {
      lista = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  return Array.isArray(lista) ? lista.map((x: unknown) => String(x)) : [];
}

function mesesEntre(desde: string, hasta: string): { a_o: number; mes: number }[] {
  const [anioInicio, mesInicio] = String(desde ?? '').slice(0, 7).split('-').map(Number);
  const [anioFin, mesFin] = String(hasta ?? '').slice(0, 7).split('-').map(Number);
  if (!anioInicio || !mesInicio || !anioFin || !mesFin) return [];
  const meses: { a_o: number; mes: number }[] = [];
  let anio = anioInicio;
  let mes = mesInicio;
  while (anio < anioFin || (anio === anioFin && mes <= mesFin)) {
    meses.push({ a_o: anio, mes });
    if (mes === 12) {
      anio += 1;
      mes = 1;
    } else mes += 1;
  }
  return meses;
}

function periodoDe(periodoEnd: string, periodoStart: string) {
  const fin = String(periodoEnd ?? '').slice(0, 10);
  const ini = String(periodoStart ?? '').slice(0, 10);
  return {
    anio: Number(fin.slice(0, 4)) || 0,
    mes: Number(fin.slice(5, 7)) || 0,
    corte: Number(ini.slice(8, 10)) || 0,
  };
}

function mesesDeLiquidaciones(liquidaciones: any[], f: FiltrosAnalisisNomina) {
  const meses = new Map<string, { a_o: number; mes: number }>();
  for (const liquidacion of liquidaciones) {
    for (const periodo of mesesEntre(liquidacion.periodo_start, liquidacion.periodo_end)) {
      if (f.anios.length && !f.anios.includes(periodo.a_o)) continue;
      if (f.meses.length && !f.meses.includes(periodo.mes)) continue;
      meses.set(`${periodo.a_o}-${periodo.mes}`, periodo);
    }
  }
  return Array.from(meses.values());
}

/** Los conceptos usan meses calendario explícitos aunque el corte de nómina los cruce. */
function mesesFuente(liquidaciones: any[], f: FiltrosAnalisisNomina) {
  if (f.anios.length) {
    const meses = f.meses.length ? f.meses : Array.from({ length: 12 }, (_, i) => i + 1);
    return f.anios.flatMap((a_o) => meses.map((mes) => ({ a_o, mes })));
  }
  return mesesDeLiquidaciones(liquidaciones, f);
}

function mesClave(anio: number, mes: number) {
  return `${anio}-${String(mes).padStart(2, '0')}`;
}

function destinoDeConcepto(
  liquidaciones: any[],
  conductorId: string,
  anio: number,
  mes: number,
  desde: string,
  hasta: string,
) {
  const candidatas = liquidaciones.filter((l) => l.conductor_id === conductorId);
  const mismoMes = candidatas.find((l) => {
    const periodo = periodoDe(l.periodo_end, l.periodo_start);
    return periodo.anio === anio && periodo.mes === mes;
  });
  if (mismoMes) return mismoMes;

  const queCruzan = candidatas
    .map((l) => {
      const inicio = String(l.periodo_start ?? '').slice(0, 10);
      const fin = String(l.periodo_end ?? '').slice(0, 10);
      const inicioComun = inicio > desde ? inicio : desde;
      const finComun = fin < hasta ? fin : hasta;
      const dias = inicioComun <= finComun
        ? (Date.parse(`${finComun}T00:00:00Z`) - Date.parse(`${inicioComun}T00:00:00Z`)) / 86_400_000 + 1
        : 0;
      return { liquidacion: l, dias };
    })
    .filter((x) => x.dias > 0)
    .sort((a, b) => b.dias - a.dias);
  return queCruzan[0]?.liquidacion ?? candidatas[0] ?? null;
}

/** Agrupa las marcas de Recorridos por la liquidación del mismo mes de referencia. */
function agruparBonosRecorridos(
  liquidaciones: any[],
  marcas: any[],
  f: FiltrosAnalisisNomina,
): Map<string, BonificacionAnalisis[]> {
  const acumulados = new Map<string, Map<string, any>>();
  for (const marca of marcas) {
    if (marca.segmento?.deleted_at) continue;
    const conductorId = marca.registro_dia?.conductor_id;
    if (!conductorId) continue;
    const fecha = marca.registro_dia.fecha.toISOString().slice(0, 10);
    const anio = Number(fecha.slice(0, 4));
    const mes = Number(fecha.slice(5, 7));
    if (f.anios.length && !f.anios.includes(anio)) continue;
    if (f.meses.length && !f.meses.includes(mes)) continue;

    const placa = marca.segmento?.vehiculo_placa ?? marca.segmento?.vehiculo?.placa ?? null;
    if (f.placas.length && (!placa || !f.placas.includes(placa))) continue;
    const destino = destinoDeConcepto(
      liquidaciones,
      conductorId,
      anio,
      mes,
      `${mesClave(anio, mes)}-01`,
      `${mesClave(anio, mes)}-${String(new Date(Date.UTC(anio, mes, 0)).getUTCDate()).padStart(2, '0')}`,
    );
    if (!destino) continue;

    /// En Recorridos la existencia de la marca define la cantidad. El valor
    /// monetario sale de la configuración vigente asociada, no del snapshot de pago.
    const nombre = String(marca.config_liquidacion?.nombre ?? '').trim() || 'BONO';
    const valorUnitario = num(marca.config_liquidacion?.valor);
    const vehiculoId = marca.segmento?.vehiculo_id ?? null;
    const clave = `${vehiculoId ?? ''}|${nombre}|${valorUnitario.toFixed(2)}`;
    const porLiquidacion = acumulados.get(destino.id) ?? new Map<string, any>();
    const bono = porLiquidacion.get(clave) ?? {
      vehiculo_id: vehiculoId,
      placa,
      nombre,
      valor_unitario: valorUnitario,
      valores: new Map<string, number>(),
    };
    const mesReferencia = mesClave(anio, mes);
    bono.valores.set(mesReferencia, (bono.valores.get(mesReferencia) ?? 0) + 1);
    porLiquidacion.set(clave, bono);
    acumulados.set(destino.id, porLiquidacion);
  }

  return new Map(
    Array.from(acumulados, ([liquidacionId, bonos]) => [
      liquidacionId,
      Array.from(bonos.values()).map((bono) => ({
        ...bono,
        valores: Array.from(bono.valores, ([mes, cantidad]) => ({ mes, cantidad })),
      })),
    ]),
  );
}

/** Mantiene el detalle por mes de calendario sin depender de que exista una nómina. */
function agruparBonosCalendario(marcas: any[], f: FiltrosAnalisisNomina): BonificacionRecorridoAnalisis[] {
  const acumulados = new Map<string, BonificacionRecorridoAnalisis>();
  for (const marca of marcas) {
    if (marca.segmento?.deleted_at) continue;
    const registro = marca.registro_dia;
    const conductorId = registro?.conductor_id;
    if (!conductorId) continue;
    const fecha = registro.fecha.toISOString().slice(0, 10);
    const anio = Number(fecha.slice(0, 4));
    const mesNumero = Number(fecha.slice(5, 7));
    if (f.anios.length && !f.anios.includes(anio)) continue;
    if (f.meses.length && !f.meses.includes(mesNumero)) continue;

    const placa = marca.segmento?.vehiculo_placa ?? marca.segmento?.vehiculo?.placa ?? null;
    if (f.placas.length && (!placa || !f.placas.includes(placa))) continue;
    const nombre = String(marca.config_liquidacion?.nombre ?? '').trim() || 'BONO';
    const valorUnitario = num(marca.config_liquidacion?.valor);
    const mes = mesClave(anio, mesNumero);
    const conductor = `${registro.conductor?.nombre ?? ''} ${registro.conductor?.apellido ?? ''}`.trim() || 'Sin conductor';
    const clave = [conductorId, placa ?? '', nombre, valorUnitario.toFixed(2), mes].join('|');
    const fila = acumulados.get(clave) ?? {
      conductor_id: conductorId,
      conductor,
      placa,
      nombre,
      mes,
      cantidad: 0,
      valor_unitario: valorUnitario,
      total: 0,
      fechas: [],
    };
    fila.cantidad += 1;
    fila.total = Math.round((fila.total + valorUnitario) * 100) / 100;
    fila.fechas.push(fecha);
    acumulados.set(clave, fila);
  }
  return Array.from(acumulados.values()).map((fila) => ({
    ...fila,
    fechas: Array.from(new Set(fila.fechas)).sort(),
  })).sort((a, b) =>
    (a.placa ?? '').localeCompare(b.placa ?? '') ||
    a.mes.localeCompare(b.mes) ||
    a.conductor.localeCompare(b.conductor, 'es') ||
    a.nombre.localeCompare(b.nombre, 'es'),
  );
}

/** Agrupa el importe calculado en cada planilla por corte de nómina. */
function agruparRecargosJornada(
  liquidaciones: any[],
  planillas: any[],
  f: FiltrosAnalisisNomina,
): Map<string, RecargoJornadaAnalisis[]> {
  const resultado = new Map<string, RecargoJornadaAnalisis[]>();
  for (const planilla of planillas) {
    const anio = Number(planilla.a_o);
    const mes = Number(planilla.mes);
    if (f.anios.length && !f.anios.includes(anio)) continue;
    if (f.meses.length && !f.meses.includes(mes)) continue;
    const placa = planilla.vehiculos?.placa ?? null;
    if (f.placas.length && (!placa || !f.placas.includes(placa))) continue;

    const mesReferencia = mesClave(anio, mes);
    const desdeMes = `${mesReferencia}-01`;
    const hastaMes = `${mesReferencia}-${String(new Date(Date.UTC(anio, mes, 0)).getUTCDate()).padStart(2, '0')}`;
    const destino = destinoDeConcepto(
      liquidaciones,
      planilla.conductor_id,
      anio,
      mes,
      desdeMes,
      hastaMes,
    );
    if (!destino) continue;

    const diasConRecargos = (planilla.dias_laborales_planillas ?? []).filter((dia: any) =>
      (dia.detalles_recargos_dias ?? []).some((detalle: any) => {
        const codigo = String(detalle.tipos_recargos?.codigo ?? '').toUpperCase();
        return (CODIGOS_RECARGO as readonly string[]).includes(codigo) && num(detalle.horas) > 0;
      }),
    );
    const dias = diasConRecargos.map((dia: any) => ({
      fecha: `${mesReferencia}-${String(dia.dia).padStart(2, '0')}`,
    }));
    if (!dias.length) continue;
    const valor = Math.round(diasConRecargos.reduce((total: number, dia: any) =>
      total + (dia.detalles_recargos_dias ?? []).reduce(
        (suma: number, detalle: any) => suma + num(detalle.valor_calculado),
        0,
      ),
    ) * 100) / 100;
    const lista = resultado.get(destino.id) ?? [];
    lista.push({
      planilla_id: planilla.id,
      numero_planilla: planilla.numero_planilla ?? null,
      vehiculo_id: planilla.vehiculo_id ?? null,
      placa,
      cliente_id: planilla.empresa_id ?? null,
      cliente: String(planilla.clientes?.nombre ?? '').trim(),
      mes: mesReferencia,
      dias,
      valor,
    });
    resultado.set(destino.id, lista);
  }

  for (const [id, grupos] of resultado) {
    resultado.set(id, grupos.sort(
      (a, b) => a.mes.localeCompare(b.mes) ||
        (a.numero_planilla ?? '').localeCompare(b.numero_planilla ?? '') ||
        a.cliente.localeCompare(b.cliente, 'es'),
    ));
  }
  return resultado;
}

/** Lista los días laborados y suma el valor calculado guardado en la planilla. */
function agruparPlanillasConRecargos(
  planillas: any[],
  f: FiltrosAnalisisNomina,
): RecargoPlanillaAnalisis[] {
  const resultado: RecargoPlanillaAnalisis[] = [];
  for (const planilla of planillas) {
    const anio = Number(planilla.a_o);
    const mesNumero = Number(planilla.mes);
    if (f.anios.length && !f.anios.includes(anio)) continue;
    if (f.meses.length && !f.meses.includes(mesNumero)) continue;
    const placa = planilla.vehiculos?.placa ?? null;
    if (f.placas.length && (!placa || !f.placas.includes(placa))) continue;

    const mes = mesClave(anio, mesNumero);
    const diasPlanilla = (planilla.dias_laborales_planillas ?? [])
      .filter((dia: any) => !dia.deleted_at);
    const tieneRecargos = diasPlanilla.some((dia: any) =>
      (dia.detalles_recargos_dias ?? []).some((detalle: any) =>
        detalle.activo && !detalle.deleted_at && num(detalle.horas) > 0,
      ),
    );
    if (!tieneRecargos) continue;
    const dias = diasPlanilla
      .filter((dia: any) => !dia.disponibilidad && num(dia.total_horas) > 0)
      .map((dia: any) => ({ fecha: `${mes}-${String(dia.dia).padStart(2, '0')}` }))
      .sort((a: RecargoPlanillaDiaAnalisis, b: RecargoPlanillaDiaAnalisis) => a.fecha.localeCompare(b.fecha));
    const valorPagar = diasPlanilla.reduce((total: number, dia: any) =>
      total + (dia.detalles_recargos_dias ?? []).reduce(
        (suma: number, detalle: any) => suma + num(detalle.valor_calculado),
        0,
      ),
    0);

    const conductor = planilla.conductores;
    resultado.push({
      planilla_id: planilla.id,
      numero_planilla: planilla.numero_planilla ?? null,
      estado: String(planilla.estado ?? ''),
      conductor_id: planilla.conductor_id,
      conductor: `${conductor?.nombre ?? ''} ${conductor?.apellido ?? ''}`.trim() || 'Sin conductor',
      vehiculo_id: planilla.vehiculo_id ?? null,
      placa,
      empresa_id: planilla.empresa_id,
      empresa: String(planilla.clientes?.nombre ?? '').trim() || 'Sin empresa en planilla',
      mes,
      dias,
      valor_pagar: Math.round(valorPagar * 100) / 100,
    });
  }
  return resultado.sort((a, b) =>
    (a.placa ?? '').localeCompare(b.placa ?? '') ||
    a.mes.localeCompare(b.mes) ||
    (a.numero_planilla ?? '').localeCompare(b.numero_planilla ?? '') ||
    a.empresa.localeCompare(b.empresa, 'es'),
  );
}

export const NominaAnalisisService = {
  async consultar(f: FiltrosAnalisisNomina): Promise<ResultadoAnalisisNomina> {
    const where: any = { deleted_at: null };
    if (f.anios.length) {
      const periodos: any[] = f.anios.map((a) => ({ periodo_end: { startsWith: `${a}-` } }));
      const mesesDeReferencia = f.meses.length ? f.meses : Array.from({ length: 12 }, (_, i) => i + 1);
      for (const anio of f.anios) {
        for (const mes of mesesDeReferencia) {
          const inicio = `${anio}-${String(mes).padStart(2, '0')}-01`;
          const siguienteMes = mes === 12
            ? `${anio + 1}-01-01`
            : `${anio}-${String(mes + 1).padStart(2, '0')}-01`;
          /// El corte 21→20 que contiene diciembre termina en enero: sin este
          /// solapamiento, diciembre desaparece al filtrar por su año de referencia.
          periodos.push({ periodo_start: { lt: siguienteMes }, periodo_end: { gte: inicio } });
        }
      }
      where.OR = periodos;
    }
    if (f.conductores.length) where.conductor_id = { in: f.conductores };
    if (f.estados.length) where.estado_flujo = { in: f.estados };
    if (f.placas.length) {
      const filtroPlanillas: any = {
        deleted_at: null,
        vehiculos: { placa: { in: f.placas } },
        dias_laborales_planillas: {
          some: {
            deleted_at: null,
            detalles_recargos_dias: {
              some: { activo: true, deleted_at: null, horas: { gt: 0 } },
            },
          },
        },
      };
      if (f.anios.length) filtroPlanillas.a_o = { in: f.anios };
      if (f.meses.length) filtroPlanillas.mes = { in: f.meses };
      const porPlaca = {
        OR: [
          { liquidacion_vehiculo: { some: { deleted_at: null, vehiculos: { placa: { in: f.placas } } } } },
          { pernotes: { some: { deleted_at: null, vehiculos: { placa: { in: f.placas } } } } },
          { mantenimientos: { some: { deleted_at: null, vehiculos: { placa: { in: f.placas } } } } },
          {
            conductores: {
              is: {
                registros_dia_laboral: {
                  some: {
                    deleted_at: null,
                    bonos: {
                      some: {
                        deleted_at: null,
                        segmento: {
                          is: {
                            deleted_at: null,
                            vehiculo: { placa: { in: f.placas } },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          { conductores: { is: { recargos_planillas: { some: filtroPlanillas } } } },
        ],
      };
      const condiciones = where.OR ? [{ OR: where.OR }, porPlaca] : [porPlaca];
      delete where.OR;
      where.AND = condiciones;
    }

    const [filas, todas, vehiculosTodos, conductoresTodos] = await Promise.all([
      prisma.liquidaciones.findMany({
        where,
        orderBy: [{ periodo_end: 'desc' }, { created_at: 'desc' }],
        include: {
          conductores: { select: { id: true, nombre: true, apellido: true, numero_identificacion: true } },
          liquidacion_vehiculo: {
            where: { deleted_at: null },
            include: { vehiculos: { select: { id: true, placa: true } } },
          },
          pernotes: {
            where: { deleted_at: null },
            include: {
              clientes: { select: { id: true, nombre: true } },
              vehiculos: { select: { id: true, placa: true } },
            },
          },
          mantenimientos: { where: { deleted_at: null }, include: { vehiculos: { select: { id: true, placa: true } } } },
          firmas_desprendibles: { select: { estado: true, firma_url: true } },
        },
      }),
      // Catálogos sobre TODO el conjunto, no sobre lo filtrado: un filtro de
      // año no debe borrar los otros años del selector.
      prisma.liquidaciones.findMany({
        where: { deleted_at: null },
        select: { periodo_end: true },
      }),
      prisma.liquidacion_vehiculo.findMany({
        where: { deleted_at: null, liquidaciones: { deleted_at: null } },
        select: { vehiculos: { select: { placa: true } } },
        distinct: ['vehiculo_id'],
      }),
      prisma.liquidaciones.findMany({
        where: { deleted_at: null, conductor_id: { not: null } },
        select: { conductores: { select: { id: true, nombre: true, apellido: true } } },
        distinct: ['conductor_id'],
      }),
    ]);

    const bonosPorLiquidacion = new Map<string, BonificacionAnalisis[]>();
    const recargosJornadaPorLiquidacion = new Map<string, RecargoJornadaAnalisis[]>();
    const mesesPlanilla = mesesFuente(filas, f);
    const condicionesFechas = mesesPlanilla.map(({ a_o, mes }) => {
        const desde = `${mesClave(a_o, mes)}-01`;
        const siguienteMes = mes === 12
          ? `${a_o + 1}-01-01`
          : `${a_o}-${String(mes + 1).padStart(2, '0')}-01`;
        return { fecha: { gte: new Date(`${desde}T00:00:00.000Z`), lt: new Date(`${siguienteMes}T00:00:00.000Z`) } };
      });

    const [planillas, marcasBonos] = mesesPlanilla.length
      ? await Promise.all([
        prisma.recargos_planillas.findMany({
          where: {
            deleted_at: null,
            OR: mesesPlanilla,
            ...(f.conductores.length ? { conductor_id: { in: f.conductores } } : {}),
            ...(f.placas.length ? { vehiculos: { placa: { in: f.placas } } } : {}),
          },
          include: {
            conductores: { select: { nombre: true, apellido: true } },
            clientes: { select: { nombre: true } },
            vehiculos: { select: { id: true, placa: true } },
            dias_laborales_planillas: {
              where: { deleted_at: null },
              include: {
                detalles_recargos_dias: {
                  where: { activo: true, deleted_at: null },
                  select: {
                    activo: true,
                    deleted_at: true,
                    horas: true,
                    valor_calculado: true,
                    tipos_recargos: { select: { codigo: true } },
                  },
                },
              },
            },
          },
        }),
        prisma.registro_dia_laboral_bono.findMany({
          where: {
            deleted_at: null,
            registro_dia: {
              deleted_at: null,
              ...(f.conductores.length ? { conductor_id: { in: f.conductores } } : {}),
              OR: condicionesFechas,
            },
            ...(f.placas.length ? {
              segmento: {
                is: {
                  deleted_at: null,
                  OR: [
                    { vehiculo_placa: { in: f.placas } },
                    { vehiculo: { placa: { in: f.placas } } },
                  ],
                },
              },
            } : {}),
          },
          select: {
            registro_dia: {
              select: {
                conductor_id: true,
                fecha: true,
                conductor: { select: { nombre: true, apellido: true } },
              },
            },
            segmento: {
              select: {
                vehiculo_id: true,
                vehiculo_placa: true,
                deleted_at: true,
                vehiculo: { select: { placa: true } },
              },
            },
            config_liquidacion: { select: { nombre: true, valor: true } },
          },
        }),
      ])
      : [[], []];

    const bonificacionesRecorridos = agruparBonosCalendario(marcasBonos, f);
    for (const [id, bonos] of agruparBonosRecorridos(filas, marcasBonos, f)) {
      bonosPorLiquidacion.set(id, bonos);
    }

    const recargosPlanillas = agruparPlanillasConRecargos(planillas, f);
    for (const [id, recargos] of agruparRecargosJornada(filas, planillas, f)) {
      recargosJornadaPorLiquidacion.set(id, recargos);
    }
    const recargosJornadaGrupos = recargosPlanillas.length;

    const liquidaciones: LiquidacionAnalisis[] = filas.map((l: any) => {
      const { anio, mes, corte } = periodoDe(l.periodo_end, l.periodo_start);
      const vehiculosPorId = new Map<string, VehiculoAnalisis>();
      const agregarVehiculo = (v: any) => {
        if (v?.id) vehiculosPorId.set(v.id, { id: v.id, placa: v.placa });
      };
      for (const lv of l.liquidacion_vehiculo ?? []) agregarVehiculo(lv.vehiculos);
      const bonificaciones = bonosPorLiquidacion.get(l.id) ?? [];
      const recargosJornada = recargosJornadaPorLiquidacion.get(l.id) ?? [];
      for (const b of bonificaciones) {
        agregarVehiculo(b.vehiculo_id && b.placa ? { id: b.vehiculo_id, placa: b.placa } : null);
      }
      for (const p of l.pernotes ?? []) agregarVehiculo(p.vehiculos);
      for (const m of l.mantenimientos ?? []) agregarVehiculo(m.vehiculos);
      for (const r of recargosJornada) {
        agregarVehiculo(r.vehiculo_id && r.placa ? { id: r.vehiculo_id, placa: r.placa } : null);
      }
      const vehiculos = Array.from(vehiculosPorId.values());
      const placaDe = (vehiculoId: string | null) =>
        vehiculos.find((v) => v.id === vehiculoId)?.placa ?? null;
      const firmado = (l.firmas_desprendibles ?? []).some(
        (fi: any) => fi.estado === 'Activa' && fi.firma_url && fi.firma_url !== 'pending',
      );
      return {
        id: l.id,
        conductor: {
          id: l.conductores?.id ?? l.conductor_id ?? null,
          nombre: `${l.conductores?.nombre ?? ''} ${l.conductores?.apellido ?? ''}`.trim() || 'Sin conductor',
          cedula: l.conductores?.numero_identificacion ?? null,
        },
        periodo_start: String(l.periodo_start ?? '').slice(0, 10),
        periodo_end: String(l.periodo_end ?? '').slice(0, 10),
        anio,
        mes,
        corte,
        estado_flujo: l.estado_flujo || 'BORRADOR',
        firmado,
        desprendible_visible: !!l.desprendible_visible,
        dias_laborados: num(l.dias_laborados),
        salario_basico: num(l.salario_basico),
        salario_devengado: num(l.salario_devengado),
        auxilio_transporte: num(l.auxilio_transporte),
        total_bonificaciones: Math.round(bonificaciones.reduce(
          (total, bono) => total + bono.valor_unitario * bono.valores.reduce((cantidad, v) => cantidad + v.cantidad, 0),
          0,
        ) * 100) / 100,
        total_recargos: Math.round(recargosJornada.reduce((total, recargo) => total + recargo.valor, 0) * 100) / 100,
        total_pernotes: num(l.total_pernotes),
        total_vacaciones: num(l.total_vacaciones),
        total_licencia: num(l.total_licencia),
        valor_incapacidad: num(l.valor_incapacidad),
        total_anticipos: num(l.total_anticipos),
        salud: num(l.salud),
        pension: num(l.pension),
        sueldo_total: num(l.sueldo_total),
        vehiculos,
        bonificaciones,
        recargos_jornada: recargosJornada,
        pernotes: (l.pernotes ?? []).map((p: any) => ({
          vehiculo_id: p.vehiculo_id ?? null,
          placa: placaDe(p.vehiculo_id ?? null),
          cantidad: num(p.cantidad),
          valor_unitario: num(p.valor),
          fechas: fechasDe(p.fechas),
          cliente: p.clientes?.nombre ?? '',
        })),
        mantenimientos: (l.mantenimientos ?? []).map((m: any) => ({
          vehiculo_id: m.vehiculo_id ?? null,
          placa: placaDe(m.vehiculo_id ?? null),
          valores: valoresMensuales(m.values),
        })),
      };
    });

    const anios = Array.from(
      new Set(todas.map((t: any) => Number(String(t.periodo_end ?? '').slice(0, 4))).filter((a: number) => a > 0)),
    ).sort((a, b) => b - a);
    const placas = Array.from(
      new Set(vehiculosTodos.map((v: any) => v.vehiculos?.placa).filter(Boolean) as string[]),
    ).sort();
    const conductores = conductoresTodos
      .map((c: any) => c.conductores)
      .filter((c: any) => c?.id)
      .map((c: any) => ({ id: c.id as string, nombre: `${c.nombre ?? ''} ${c.apellido ?? ''}`.trim() }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

    return {
      liquidaciones,
      bonificaciones_recorridos: bonificacionesRecorridos,
      recargos_planillas: recargosPlanillas,
      catalogos: { anios, placas, conductores, estados: ESTADOS },
      total: liquidaciones.length,
      meta: { recargos_jornada_grupos: recargosJornadaGrupos },
    };
  },
};
