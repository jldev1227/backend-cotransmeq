/**
 * Los días del corte que NO generan recargos.
 *
 * POR QUÉ EXISTE. El corte se arma desde las planillas, y una planilla solo
 * existe cuando hubo jornada: un día de descanso, de disponibilidad o de taller
 * no produce ninguna, así que desaparecía de todas partes. En el canvas la
 * columna de ese día salía en blanco —indistinguible de «no hay dato»— y en el
 * desprendible ni figuraba, aunque el conductor sí lo hubiera registrado en el
 * portal.
 *
 * Esto los recupera de `registro_dia_laboral`, que es donde el portal los
 * guarda, y les pone una INICIAL para que quepan en la celda de un día del
 * canvas, que mide 46 px:
 *
 *     D   DISPONIBLE
 *     DE  DESCANSO
 *     M   MANTENIMIENTO
 *     V   VACACIONES
 *
 * ⚠️ ESTOS DÍAS NO TIENEN HORARIO, y no es que falte el dato: el portal no lo
 * pide. La validación del formulario solo exige tramos —y con ellos las horas—
 * cuando el tipo es `LABORADO`; los otros tres se registran con la fecha y poco
 * más. De los 198 días de esos tipos que había al escribir esto, CERO tenían
 * hora de inicio. Por eso lo que se enseña es la fecha, el concepto y, cuando
 * la hay, la observación o la placa del taller — nunca un horario inventado.
 *
 * ⚠️ LAS VACACIONES NO SON UN DÍA DEL PORTAL. No hay tabla de periodos: son
 * `periodo_start_vacaciones` y `periodo_end_vacaciones` de la liquidación del
 * corte, así que se derivan del rango en vez de leerse fila a fila. Un día
 * puede caer a la vez en vacaciones y en un registro del portal; manda
 * VACACIONES, que es la situación laboral real.
 *
 * Los días LABORADOS no salen de aquí: esos los pone el corte a partir de sus
 * recargos, que es la única fuente que cuadra con lo que se paga.
 */
import { prisma } from '../../config/prisma';

export type InicialConcepto = 'D' | 'DE' | 'M' | 'V';

export interface ConceptoDia {
  /** `YYYY-MM-DD`. */
  fecha: string;
  /** Lo que cabe en la celda del canvas. */
  inicial: InicialConcepto;
  /** Nombre completo, para el desprendible y el tooltip. */
  etiqueta: string;
  /**
   * La observación del conductor, o la placa cuando es mantenimiento. `null`
   * cuando no hay nada que decir — que es lo normal: solo 23 de 198 días
   * traían observación.
   */
  detalle: string | null;
}

/** Tipos de `registro_dia_laboral` que no generan recargos, y su inicial. */
const POR_TIPO: Record<string, { inicial: InicialConcepto; etiqueta: string }> = {
  DISPONIBLE: { inicial: 'D', etiqueta: 'DISPONIBLE' },
  DESCANSO: { inicial: 'DE', etiqueta: 'DESCANSO' },
  MANTENIMIENTO: { inicial: 'M', etiqueta: 'MANTENIMIENTO' },
};

const TIPOS_SIN_RECARGO = Object.keys(POR_TIPO);

const iso = (d: Date): string => d.toISOString().slice(0, 10);

const limpio = (t: string | null | undefined): string | null => {
  const v = String(t ?? '').trim();
  return v === '' ? null : v;
};

/**
 * Los días sin recargo que el conductor registró en el portal, por conductor.
 *
 * Se piden TODOS los conductores del corte de una vez: una consulta por hoja
 * serían veintisiete en un corte normal, que es lo que ya se evita con los
 * bonos y los ajustes de horas.
 */
export async function conceptosDelPortal(
  conductorIds: string[],
  desde: string,
  hasta: string,
): Promise<Map<string, ConceptoDia[]>> {
  const porConductor = new Map<string, ConceptoDia[]>();
  if (!conductorIds.length || !desde || !hasta) return porConductor;

  const filas = await prisma.registro_dia_laboral.findMany({
    where: {
      deleted_at: null,
      conductor_id: { in: conductorIds },
      tipo: { in: TIPOS_SIN_RECARGO },
      fecha: { gte: new Date(`${desde}T00:00:00.000Z`), lte: new Date(`${hasta}T00:00:00.000Z`) },
    },
    select: {
      conductor_id: true,
      fecha: true,
      tipo: true,
      observaciones: true,
      mantenimiento_vehiculo_placa: true,
    },
    orderBy: { fecha: 'asc' },
  });

  for (const f of filas) {
    const mapa = POR_TIPO[f.tipo];
    if (!mapa) continue;
    const lista = porConductor.get(f.conductor_id) ?? [];
    lista.push({
      fecha: iso(f.fecha),
      inicial: mapa.inicial,
      etiqueta: mapa.etiqueta,
      /// La placa es el detalle útil del día de taller: sin ella el registro no
      /// sirve para cruzarlo con la orden del taller.
      detalle:
        mapa.inicial === 'M'
          ? limpio(f.mantenimiento_vehiculo_placa) ?? limpio(f.observaciones)
          : limpio(f.observaciones),
    });
    porConductor.set(f.conductor_id, lista);
  }
  return porConductor;
}

/**
 * Los días de vacaciones que caen dentro de la ventana del corte.
 *
 * Las fechas de la liquidación son `VarChar`, no `Date`: son lo que se teclea
 * en el formulario. Una que no se pueda interpretar se ignora en vez de
 * producir un rango de «Invalid Date» que se comería el corte entero.
 */
export function conceptosDeVacaciones(
  vacacionesInicio: string | null | undefined,
  vacacionesFin: string | null | undefined,
  desde: string,
  hasta: string,
): ConceptoDia[] {
  const ini = limpio(vacacionesInicio)?.slice(0, 10);
  const fin = limpio(vacacionesFin)?.slice(0, 10);
  if (!ini || !fin || !desde || !hasta) return [];
  if (Number.isNaN(Date.parse(ini)) || Number.isNaN(Date.parse(fin))) return [];

  // Se recorre por fecha ISO y no sumando días a un `Date`: comparar cadenas
  // `YYYY-MM-DD` no tiene zona horaria de la que arrepentirse.
  const arranque = ini > desde ? ini : desde;
  const cierre = fin < hasta ? fin : hasta;
  if (arranque > cierre) return [];

  const dias: ConceptoDia[] = [];
  const cursor = new Date(`${arranque}T00:00:00.000Z`);
  const tope = new Date(`${cierre}T00:00:00.000Z`);
  while (cursor.getTime() <= tope.getTime()) {
    dias.push({ fecha: iso(cursor), inicial: 'V', etiqueta: 'VACACIONES', detalle: null });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dias;
}

/**
 * Un solo concepto por fecha, con VACACIONES por encima del registro del
 * portal: si el conductor marcó «disponible» un día que luego entró en su
 * periodo de vacaciones, lo que hay que ver es que estaba de vacaciones.
 */
export function fusionarConceptos(
  delPortal: ConceptoDia[],
  deVacaciones: ConceptoDia[],
): ConceptoDia[] {
  const porFecha = new Map<string, ConceptoDia>();
  for (const c of delPortal) porFecha.set(c.fecha, c);
  for (const c of deVacaciones) porFecha.set(c.fecha, c);
  return [...porFecha.values()].sort((a, b) => a.fecha.localeCompare(b.fecha));
}
