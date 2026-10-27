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
 *   · los totales que imprime el desprendible (devengado, bonificaciones,
 *     recargos, pernoctes, deducciones y neto),
 *   · y el detalle por vehículo de bonificaciones, recargos, pernoctes y
 *     mantenimientos, que es lo que alimenta las pestañas del análisis.
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
  incluirRecargosJornada?: boolean;
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
  /** `{ mes: 'Septiembre', cantidad }` por mes del año de la liquidación. */
  valores: { mes: string; cantidad: number }[];
}

export interface RecargoAnalisis {
  vehiculo_id: string | null;
  placa: string | null;
  valor: number;
  paga_cliente: boolean;
  cliente_id: string | null;
  cliente: string;
  mes: string;
  porcentaje_propietario: number;
}

export interface RecargoJornadaDiaAnalisis {
  fecha: string;
  valor: number;
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
  recargos: RecargoAnalisis[];
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
  catalogos: CatalogosAnalisis;
  total: number;
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

/** Consolida por planilla, empresa, mes y día los valores registrados en Recargos. */
function agruparRecargosJornada(
  liquidaciones: any[],
  planillas: any[],
  f: FiltrosAnalisisNomina,
): Map<string, RecargoJornadaAnalisis[]> {
  const planillasPorConductor = new Map<string, any[]>();
  for (const planilla of planillas) {
    const lista = planillasPorConductor.get(planilla.conductor_id) ?? [];
    lista.push(planilla);
    planillasPorConductor.set(planilla.conductor_id, lista);
  }

  const resultado = new Map<string, RecargoJornadaAnalisis[]>();
  for (const liquidacion of liquidaciones) {
    const desde = String(liquidacion.periodo_start ?? '').slice(0, 10);
    const hasta = String(liquidacion.periodo_end ?? '').slice(0, 10);
    const grupos = new Map<string, RecargoJornadaAnalisis>();
    const agregarDia = (planilla: any, dia: any, fecha: string) => {
      if (fecha < desde || fecha > hasta) return;
      const anio = Number(fecha.slice(0, 4));
      const mes = Number(fecha.slice(5, 7));
      if (f.anios.length && !f.anios.includes(anio)) return;
      if (f.meses.length && !f.meses.includes(mes)) return;
      const placa = planilla.vehiculos?.placa ?? null;
      if (f.placas.length && (!placa || !f.placas.includes(placa))) return;

      let valorDia = 0;
      let tieneRecargo = false;
      for (const detalle of dia.detalles_recargos_dias ?? []) {
        const codigo = String(detalle.tipos_recargos?.codigo ?? '').toUpperCase();
        if (!(CODIGOS_RECARGO as readonly string[]).includes(codigo)) continue;
        const horas = num(detalle.horas);
        const valor = num(detalle.valor_calculado);
        if (horas <= 0 && valor <= 0) continue;
        tieneRecargo = true;
        valorDia += valor;
      }
      if (!tieneRecargo) return;

      const mesReferencia = String(anio) + '-' + String(mes).padStart(2, '0');
      const vehiculoId = planilla.vehiculo_id ?? null;
      const clienteId = planilla.empresa_id ?? null;
      const clave = [planilla.id, vehiculoId, placa, clienteId, mesReferencia].join('|');
      const valorRedondeado = Math.round(valorDia * 100) / 100;
      const existente = grupos.get(clave);
      if (existente) {
        existente.dias.push({ fecha, valor: valorRedondeado });
        existente.valor = Math.round((existente.valor + valorRedondeado) * 100) / 100;
      } else {
        grupos.set(clave, {
          planilla_id: planilla.id,
          numero_planilla: planilla.numero_planilla ?? null,
          vehiculo_id: vehiculoId,
          placa,
          cliente_id: clienteId,
          cliente: planilla.clientes?.nombre ?? '',
          mes: mesReferencia,
          dias: [{ fecha, valor: valorRedondeado }],
          valor: valorRedondeado,
        });
      }
    };

    /// Esta pestaña contrasta con lo que está registrado en Recargos:
    /// no sustituir esos datos por las horas editables del snapshot del canvas.
    for (const planilla of planillasPorConductor.get(liquidacion.conductor_id) ?? []) {
      for (const dia of planilla.dias_laborales_planillas ?? []) {
        const fecha =
          String(planilla.a_o) +
          '-' +
          String(planilla.mes).padStart(2, '0') +
          '-' +
          String(dia.dia).padStart(2, '0');
        agregarDia(planilla, dia, fecha);
      }
    }

    resultado.set(
      liquidacion.id,
      Array.from(grupos.values()).sort(
        (a, b) =>
          a.mes.localeCompare(b.mes) ||
          (a.numero_planilla ?? '').localeCompare(b.numero_planilla ?? '') ||
          (a.cliente ?? '').localeCompare(b.cliente ?? '', 'es'),
      ),
    );
  }
  return resultado;
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
          { bonificaciones: { some: { deleted_at: null, vehiculos: { placa: { in: f.placas } } } } },
          { recargos: { some: { deleted_at: null, vehiculos: { placa: { in: f.placas } } } } },
          { pernotes: { some: { deleted_at: null, vehiculos: { placa: { in: f.placas } } } } },
          { mantenimientos: { some: { deleted_at: null, vehiculos: { placa: { in: f.placas } } } } },
          ...(f.incluirRecargosJornada
            ? [{ conductores: { is: { recargos_planillas: { some: filtroPlanillas } } } }]
            : []),
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
          bonificaciones: { where: { deleted_at: null }, include: { vehiculos: { select: { id: true, placa: true } } } },
          recargos: {
            where: { deleted_at: null },
            include: {
              clientes: { select: { id: true, nombre: true } },
              vehiculos: { select: { id: true, placa: true } },
            },
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

    const recargosJornadaPorLiquidacion = new Map<string, RecargoJornadaAnalisis[]>();
    if (f.incluirRecargosJornada && filas.length) {
      const conductores = Array.from(new Set(filas.map((l: any) => l.conductor_id).filter(Boolean)));
      const mesesPlanilla = new Map<string, { a_o: number; mes: number }>();
      for (const liquidacion of filas as any[]) {
        for (const periodo of mesesEntre(liquidacion.periodo_start, liquidacion.periodo_end)) {
          if (f.anios.length && !f.anios.includes(periodo.a_o)) continue;
          if (f.meses.length && !f.meses.includes(periodo.mes)) continue;
          mesesPlanilla.set(`${periodo.a_o}-${periodo.mes}`, periodo);
        }
      }

      const planillas = conductores.length && mesesPlanilla.size
        ? await prisma.recargos_planillas.findMany({
            where: {
              deleted_at: null,
              conductor_id: { in: conductores },
              OR: Array.from(mesesPlanilla.values()),
              ...(f.placas.length ? { vehiculos: { placa: { in: f.placas } } } : {}),
              dias_laborales_planillas: {
                some: {
                  deleted_at: null,
                  detalles_recargos_dias: {
                    some: {
                      activo: true,
                      deleted_at: null,
                      OR: [{ horas: { gt: 0 } }, { valor_calculado: { gt: 0 } }],
                    },
                  },
                },
              },
            },
            include: {
              vehiculos: { select: { id: true, placa: true } },
              clientes: { select: { id: true, nombre: true } },
              dias_laborales_planillas: {
                where: { deleted_at: null },
                include: {
                  detalles_recargos_dias: {
                    where: { activo: true, deleted_at: null },
                    select: {
                      horas: true,
                      valor_calculado: true,
                      tipos_recargos: { select: { codigo: true } },
                    },
                  },
                },
              },
            },
          })
        : [];
      for (const [id, recargos] of agruparRecargosJornada(filas, planillas, f)) {
        recargosJornadaPorLiquidacion.set(id, recargos);
      }
    }

    const liquidaciones: LiquidacionAnalisis[] = filas.map((l: any) => {
      const { anio, mes, corte } = periodoDe(l.periodo_end, l.periodo_start);
      const vehiculosPorId = new Map<string, VehiculoAnalisis>();
      const agregarVehiculo = (v: any) => {
        if (v?.id) vehiculosPorId.set(v.id, { id: v.id, placa: v.placa });
      };
      for (const lv of l.liquidacion_vehiculo ?? []) agregarVehiculo(lv.vehiculos);
      for (const b of l.bonificaciones ?? []) agregarVehiculo(b.vehiculos);
      for (const r of l.recargos ?? []) agregarVehiculo(r.vehiculos);
      for (const p of l.pernotes ?? []) agregarVehiculo(p.vehiculos);
      for (const m of l.mantenimientos ?? []) agregarVehiculo(m.vehiculos);
      for (const r of recargosJornadaPorLiquidacion.get(l.id) ?? []) {
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
        total_bonificaciones: num(l.total_bonificaciones),
        total_recargos: num(l.total_recargos),
        total_pernotes: num(l.total_pernotes),
        total_vacaciones: num(l.total_vacaciones),
        total_licencia: num(l.total_licencia),
        valor_incapacidad: num(l.valor_incapacidad),
        total_anticipos: num(l.total_anticipos),
        salud: num(l.salud),
        pension: num(l.pension),
        sueldo_total: num(l.sueldo_total),
        vehiculos,
        bonificaciones: (l.bonificaciones ?? []).map((b: any) => ({
          vehiculo_id: b.vehiculo_id ?? null,
          placa: placaDe(b.vehiculo_id ?? null),
          nombre: String(b.name ?? b.nombre ?? ''),
          valor_unitario: num(b.value ?? b.valor),
          valores: valoresMensuales(b.values),
        })),
        recargos: (l.recargos ?? []).map((r: any) => ({
          vehiculo_id: r.vehiculo_id ?? null,
          placa: placaDe(r.vehiculo_id ?? null),
          valor: num(r.valor),
          paga_cliente: !!r.pag_cliente,
          cliente_id: r.empresa_id ?? r.clientes?.id ?? null,
          cliente: r.clientes?.nombre ?? '',
          mes: String(r.mes ?? ''),
          porcentaje_propietario: num(r.porcentaje_propietario),
        })),
        recargos_jornada: recargosJornadaPorLiquidacion.get(l.id) ?? [],
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
      catalogos: { anios, placas, conductores, estados: ESTADOS },
      total: liquidaciones.length,
    };
  },
};
