/**
 * Cortes de periodo de los recorridos.
 *
 * Los recorridos NO se agrupan por mes natural: se liquidan por CORTE, del 21
 * de un mes al 20 del siguiente, que es el periodo con el que trabaja la
 * planilla. Filtrar por «agosto» partía en dos el corte que Operaciones estaba
 * revisando.
 *
 * El corte es libre —dos fechas cualesquiera—, pero el que se ofrece por
 * defecto es el 21→20 que cierra en el mes en curso.
 *
 * ESPEJO de `ingreso-svelte/src/lib/utils/corte-periodo.ts`. Duplicado a
 * propósito (dos builds, sin paquete compartido): el servidor calcula el mismo
 * corte por defecto cuando la petición no trae fechas.
 */

export interface Corte {
  /** `YYYY-MM-DD`, inclusive. */
  desde: string;
  /** `YYYY-MM-DD`, inclusive. */
  hasta: string;
}

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

/** Día en que abre el corte, en el mes anterior. */
export const DIA_INICIO_CORTE = 21;
/** Día en que cierra el corte, en el mes de referencia. */
export const DIA_FIN_CORTE = 20;

function iso(a: number, m: number, d: number): string {
  return `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Corte 21→20 que cierra en el mes indicado (1-12).
 *
 * Sin argumentos usa el mes en curso, salvo que aún no se haya llegado al día
 * 21: en ese caso el corte vivo es el que cierra ESTE mes, que empezó el 21 del
 * anterior. Es lo que Operaciones tiene abierto cuando entra al canvas.
 */
export function cortePorDefecto(hoy: Date = new Date()): Corte {
  const anio = hoy.getFullYear();
  const mes = hoy.getMonth() + 1;
  // Pasado el día 20 ya se está trabajando el corte del mes siguiente.
  const cierraEn = hoy.getDate() > DIA_FIN_CORTE ? mes + 1 : mes;
  return corteDeMes(cierraEn > 12 ? anio + 1 : anio, cierraEn > 12 ? 1 : cierraEn);
}

/** Corte 21→20 que cierra en `anio`/`mes`. */
export function corteDeMes(anio: number, mes: number): Corte {
  const anioIni = mes === 1 ? anio - 1 : anio;
  const mesIni = mes === 1 ? 12 : mes - 1;
  return {
    desde: iso(anioIni, mesIni, DIA_INICIO_CORTE),
    hasta: iso(anio, mes, DIA_FIN_CORTE)
  };
}

/**
 * Periodo al que pertenece un corte, para el room de socket y los snapshots.
 *
 * Es el mes en que CIERRA, no en el que abre: un corte del 21-jul al 20-ago es
 * «agosto», igual que en nómina. Se deriva de `hasta` para que dos usuarios con
 * cortes ligeramente distintos del mismo periodo compartan sala y versiones.
 */
export function periodoDeCorte(corte: Corte): { anio: number; mes: number } {
  const [a, m] = corte.hasta.split('-').map(Number);
  return { anio: a, mes: m };
}

/** «21 jul — 20 ago 2026», para el título del libro y del PDF. */
export function etiquetaCorte(corte: Corte): string {
  const [a1, m1, d1] = corte.desde.split('-').map(Number);
  const [a2, m2, d2] = corte.hasta.split('-').map(Number);
  const mes1 = MESES[m1 - 1]?.slice(0, 3) ?? '';
  const mes2 = MESES[m2 - 1]?.slice(0, 3) ?? '';
  if (a1 === a2) return `${d1} ${mes1} — ${d2} ${mes2} ${a2}`;
  return `${d1} ${mes1} ${a1} — ${d2} ${mes2} ${a2}`;
}

/** ¿Es un `YYYY-MM-DD` con sentido? */
export function esFechaValida(v: string | null | undefined): boolean {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [a, m, d] = v.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const fecha = new Date(Date.UTC(a, m - 1, d));
  return fecha.getUTCFullYear() === a && fecha.getUTCMonth() === m - 1 && fecha.getUTCDate() === d;
}
