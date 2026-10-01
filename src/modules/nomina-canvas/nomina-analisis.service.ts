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
 * Los filtros que la base resuelve bien (años por prefijo del periodo,
 * conductores, estados, placas) van en el `where`; los meses se filtran en
 * memoria porque un LIKE «____-09-%» no existe en Prisma y el conjunto es de
 * cientos de filas, no de millones.
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
      where.OR = f.anios.map((a) => ({ periodo_end: { startsWith: `${a}-` } }));
    }
    if (f.conductores.length) where.conductor_id = { in: f.conductores };
    if (f.estados.length) where.estado_flujo = { in: f.estados };
    if (f.placas.length) {
      where.liquidacion_vehiculo = {
        some: { deleted_at: null, vehiculos: { placa: { in: f.placas } } },
      };
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
          bonificaciones: { where: { deleted_at: null } },
          recargos: { where: { deleted_at: null }, include: { clientes: { select: { id: true, nombre: true } } } },
          pernotes: { where: { deleted_at: null }, include: { clientes: { select: { id: true, nombre: true } } } },
          mantenimientos: { where: { deleted_at: null } },
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

    const liquidaciones: LiquidacionAnalisis[] = filas
      .map((l: any) => {
        const { anio, mes, corte } = periodoDe(l.periodo_end, l.periodo_start);
        const vehiculos: VehiculoAnalisis[] = (l.liquidacion_vehiculo ?? [])
          .map((lv: any) => lv.vehiculos)
          .filter((v: any) => v?.id)
          .map((v: any) => ({ id: v.id, placa: v.placa }));
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
          pernotes: (l.pernotes ?? []).map((p: any) => ({
            vehiculo_id: p.vehiculo_id ?? null,
            placa: placaDe(p.vehiculo_id ?? null),
            cantidad: num(p.cantidad),
            valor_unitario: num(p.valor),
            fechas: Array.isArray(p.fechas) ? p.fechas.map((x: unknown) => String(x)) : [],
            cliente: p.clientes?.nombre ?? '',
          })),
          mantenimientos: (l.mantenimientos ?? []).map((m: any) => ({
            vehiculo_id: m.vehiculo_id ?? null,
            placa: placaDe(m.vehiculo_id ?? null),
            valores: valoresMensuales(m.values),
          })),
        };
      })
      .filter((l) => !f.meses.length || f.meses.includes(l.mes));

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
