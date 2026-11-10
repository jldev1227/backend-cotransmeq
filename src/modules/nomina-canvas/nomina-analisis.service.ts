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
 *   · bonificaciones y recargos guardados en la liquidación del canvas,
 *   · y el detalle por vehículo de pernoctes y mantenimientos.
 *
 * Los filtros de conductor, estado y placa van en el `where`. Año y mes tienen
 * dos significados distintos: el resumen usa el mes en que termina el corte,
 * mientras que las pestañas de conceptos usan el mes guardado en cada dato.
 * Por eso se consultan también cortes que se cruzan con los meses de referencia
 * y el cliente aplica cada filtro sobre la fecha que corresponde.
 */
import { prisma } from '../../config/prisma';

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
  /** `{ mes: '2026-09', cantidad }` por mes guardado en la nómina. */
  valores: { mes: string; cantidad: number }[];
}

export interface RecargoNominaAnalisis {
  id: string;
  vehiculo_id: string | null;
  placa: string | null;
  empresa_id: string;
  empresa: string;
  mes: string;
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
  recargos_nomina: RecargoNominaAnalisis[];
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
  meta: { recargos_nomina_items: number };
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

function periodoDe(periodoEnd: string, periodoStart: string) {
  const fin = String(periodoEnd ?? '').slice(0, 10);
  const ini = String(periodoStart ?? '').slice(0, 10);
  return {
    anio: Number(fin.slice(0, 4)) || 0,
    mes: Number(fin.slice(5, 7)) || 0,
    corte: Number(ini.slice(8, 10)) || 0,
  };
}

function mesClave(anio: number, mes: number) {
  return `${anio}-${String(mes).padStart(2, '0')}`;
}

export const NominaAnalisisService = {
  async consultar(f: FiltrosAnalisisNomina): Promise<ResultadoAnalisisNomina> {
    const where: any = { deleted_at: null };
    if (f.anios.length) {
      const periodos: any[] = [];
      const mesesDeReferencia = f.meses.length ? f.meses : Array.from({ length: 12 }, (_, i) => i + 1);
      // La ventana mensual ya cubre los ciclos que terminan en el año y los
      // que lo cruzan. Un OR adicional por año incluiría todos los meses si
      // el usuario pidió, por ejemplo, únicamente agosto.
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
      const porPlaca = {
        OR: [
          { liquidacion_vehiculo: { some: { deleted_at: null, vehiculos: { placa: { in: f.placas } } } } },
          { bonificaciones: { some: { deleted_at: null, vehiculos: { placa: { in: f.placas } } } } },
          { recargos: { some: { deleted_at: null, incluir: true, vehiculos: { placa: { in: f.placas } } } } },
          { pernotes: { some: { deleted_at: null, vehiculos: { placa: { in: f.placas } } } } },
          { mantenimientos: { some: { deleted_at: null, vehiculos: { placa: { in: f.placas } } } } },
        ],
      };
      const condiciones = where.OR ? [{ OR: where.OR }, porPlaca] : [porPlaca];
      delete where.OR;
      where.AND = condiciones;
    }

    const [filas, todas, vehiculosTodos, bonificacionesTodas, recargosTodos, conductoresTodos] = await Promise.all([
      prisma.liquidaciones.findMany({
        where,
        orderBy: [{ periodo_end: 'desc' }, { created_at: 'desc' }],
        include: {
          conductores: { select: { id: true, nombre: true, apellido: true, numero_identificacion: true } },
          liquidacion_vehiculo: {
            where: { deleted_at: null },
            include: { vehiculos: { select: { id: true, placa: true } } },
          },
          bonificaciones: {
            where: { deleted_at: null },
            include: { vehiculos: { select: { id: true, placa: true } } },
          },
          recargos: {
            where: { deleted_at: null, incluir: true },
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
      prisma.bonificaciones.findMany({
        where: { deleted_at: null, liquidaciones: { is: { deleted_at: null } }, vehiculo_id: { not: null } },
        select: { vehiculos: { select: { placa: true } } },
        distinct: ['vehiculo_id'],
      }),
      prisma.recargos.findMany({
        where: { deleted_at: null, incluir: true, liquidaciones: { is: { deleted_at: null } }, vehiculo_id: { not: null } },
        select: { vehiculos: { select: { placa: true } } },
        distinct: ['vehiculo_id'],
      }),
      prisma.liquidaciones.findMany({
        where: { deleted_at: null, conductor_id: { not: null } },
        select: { conductores: { select: { id: true, nombre: true, apellido: true } } },
        distinct: ['conductor_id'],
      }),
    ]);

    const liquidaciones: LiquidacionAnalisis[] = filas.map((l: any) => {
      const { anio, mes, corte } = periodoDe(l.periodo_end, l.periodo_start);
      const vehiculosPorId = new Map<string, VehiculoAnalisis>();
      const agregarVehiculo = (v: any) => {
        if (v?.id) vehiculosPorId.set(v.id, { id: v.id, placa: v.placa });
      };
      for (const lv of l.liquidacion_vehiculo ?? []) agregarVehiculo(lv.vehiculos);
      const bonificaciones: BonificacionAnalisis[] = (l.bonificaciones ?? []).map((b: any) => ({
        vehiculo_id: b.vehiculo_id ?? null,
        placa: b.vehiculos?.placa ?? null,
        nombre: String(b.name ?? '').trim() || 'BONO',
        valor_unitario: num(b.value),
        valores: valoresMensuales(b.values),
      }));
      const recargosNomina: RecargoNominaAnalisis[] = (l.recargos ?? []).map((r: any) => ({
        id: r.id,
        vehiculo_id: r.vehiculo_id ?? null,
        placa: r.vehiculos?.placa ?? null,
        empresa_id: r.empresa_id,
        empresa: String(r.clientes?.nombre ?? '').trim() || 'Sin empresa',
        mes: String(r.mes ?? '').slice(0, 7) || mesClave(anio, mes),
        valor: num(r.valor),
      }));
      for (const b of bonificaciones) {
        agregarVehiculo(b.vehiculo_id && b.placa ? { id: b.vehiculo_id, placa: b.placa } : null);
      }
      for (const r of recargosNomina) {
        agregarVehiculo(r.vehiculo_id && r.placa ? { id: r.vehiculo_id, placa: r.placa } : null);
      }
      for (const p of l.pernotes ?? []) agregarVehiculo(p.vehiculos);
      for (const m of l.mantenimientos ?? []) agregarVehiculo(m.vehiculos);
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
        bonificaciones,
        recargos_nomina: recargosNomina,
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
      new Set([
        ...vehiculosTodos.map((v: any) => v.vehiculos?.placa),
        ...bonificacionesTodas.map((b: any) => b.vehiculos?.placa),
        ...recargosTodos.map((r: any) => r.vehiculos?.placa),
      ].filter(Boolean) as string[]),
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
      meta: { recargos_nomina_items: liquidaciones.reduce((total, l) => total + l.recargos_nomina.length, 0) },
    };
  },
};
