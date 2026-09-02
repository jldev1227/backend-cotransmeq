// src/lib/nomina/periodo.ts
//
// Aritmética del periodo de nómina. Funciones puras, sin BD y sin Univer,
// para poder testearlas en Node — que es el criterio del repo para todo lo
// que sea cuentas o texto.
//
// EL PERIODO NO ES EL MES. Los Excel de nómina van del día 21 del mes
// anterior al día 20 del mes de la nómina. Las planillas, en cambio, se
// indexan por (`recargos_planillas.mes`, `.año`) y el día es un `Int` 1-31
// dentro de ese mes. O sea que un periodo de nómina SIEMPRE cruza dos meses
// de planilla y hay que unir los dos.
//
// El día de corte se deja como parámetro (`CORTE_DEFECTO = 21`) porque está
// deducido de los archivos de agosto 2026, no de ninguna regla escrita.
//
// Todo se calcula en UTC a propósito: aquí no hay horas, solo fechas de
// calendario, y con hora local un `new Date('2026-08-01')` se convierte en
// 31 de julio a las 19:00 en Bogotá y el periodo empieza un día antes.

export const CORTE_DEFECTO = 21;

export const MESES = [
  'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO',
  'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE',
] as const;

/** Índice 0 = domingo, para casar con `Date.getUTCDay()`. */
export const DIAS_SEMANA = [
  'DOMINGO', 'LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO',
] as const;

export interface DiaPeriodo {
  /** ISO `YYYY-MM-DD`. Es la clave con la que se cruza todo. */
  fecha: string;
  dia: number;
  /** 1-12. Es el `mes` de `recargos_planillas`, no un índice. */
  mes: number;
  anio: number;
  nombreMes: string;
  nombreDia: string;
  esDomingo: boolean;
  /** Posición 0..n dentro del periodo = columna del canvas. */
  indice: number;
}

function utc(anio: number, mes: number, dia: number): Date {
  return new Date(Date.UTC(anio, mes - 1, dia));
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function mesAnterior(anio: number, mes: number): { anio: number; mes: number } {
  return mes === 1 ? { anio: anio - 1, mes: 12 } : { anio, mes: mes - 1 };
}

/**
 * Los días del periodo de nómina de (`anio`, `mes`), en orden.
 *
 * Con `corte = 21` y agosto de 2026 devuelve del 21-jul-2026 al 20-ago-2026.
 * Con `corte = 1` devuelve el mes natural completo, que es la salida de
 * escape si algún día se decide alinear nómina y planilla.
 */
export function diasDelPeriodo(
  anio: number,
  mes: number,
  corte: number = CORTE_DEFECTO,
): DiaPeriodo[] {
  const c = Math.min(Math.max(Math.trunc(corte) || CORTE_DEFECTO, 1), 28);
  const inicio = c === 1 ? utc(anio, mes, 1) : (() => {
    const prev = mesAnterior(anio, mes);
    return utc(prev.anio, prev.mes, c);
  })();
  // Con corte 1 el periodo es el mes natural: hasta el último día.
  const fin = c === 1
    ? utc(anio, mes + 1 > 12 ? 1 : mes + 1, 1)
    : utc(anio, mes, c);

  const dias: DiaPeriodo[] = [];
  const cursor = new Date(inicio);
  const limite = c === 1 && mes === 12 ? utc(anio + 1, 1, 1) : fin;
  let i = 0;
  while (cursor < limite) {
    const dow = cursor.getUTCDay();
    dias.push({
      fecha: iso(cursor),
      dia: cursor.getUTCDate(),
      mes: cursor.getUTCMonth() + 1,
      anio: cursor.getUTCFullYear(),
      nombreMes: MESES[cursor.getUTCMonth()],
      nombreDia: DIAS_SEMANA[dow],
      esDomingo: dow === 0,
      indice: i++,
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dias;
}

/**
 * Los (año, mes) de planilla que hay que consultar para cubrir el periodo.
 * Normalmente dos; con corte 1, uno.
 */
export function mesesDePlanilla(
  anio: number,
  mes: number,
  corte: number = CORTE_DEFECTO,
): { anio: number; mes: number }[] {
  if ((Math.trunc(corte) || CORTE_DEFECTO) === 1) return [{ anio, mes }];
  return [mesAnterior(anio, mes), { anio, mes }];
}

/** Etiqueta de cabecera: `AGOSTO 2026 (21 JUL — 20 AGO)`. */
export function etiquetaPeriodo(
  anio: number,
  mes: number,
  corte: number = CORTE_DEFECTO,
): string {
  const dias = diasDelPeriodo(anio, mes, corte);
  if (!dias.length) return `${MESES[mes - 1]} ${anio}`;
  const a = dias[0];
  const b = dias[dias.length - 1];
  return `${MESES[mes - 1]} ${anio} (${a.dia} ${a.nombreMes.slice(0, 3)} — ${b.dia} ${b.nombreMes.slice(0, 3)})`;
}

// ─────────────────────────────────────────────────────────────────────────
// Texto de días por empresa
// ─────────────────────────────────────────────────────────────────────────

/** Un tramo de días seguidos. `desde === hasta` cuando es un día suelto. */
interface Tramo {
  desde: number;
  hasta: number;
}

/**
 * A partir de cuántos días seguidos se escribe «13 AL 19» en vez de
 * «13, 14, 15…». Deducido de los archivos: las rachas de 3 se listan
 * (`1, 2 Y 3 DE AGOSTO`, `14, 15 Y 16`) y las de 5 y 7 se abrevian
 * (`21 AL 25`, `13 AL 19`). No hay ninguna racha de 4 en los 26 archivos,
 * así que el corte exacto entre 3 y 5 es una elección, no un dato.
 */
const MIN_DIAS_PARA_RANGO = 4;

function tramos(dias: number[]): Tramo[] {
  const ordenados = [...new Set(dias)].sort((a, b) => a - b);
  const out: Tramo[] = [];
  for (const d of ordenados) {
    const ultimo = out[out.length - 1];
    if (ultimo && d === ultimo.hasta + 1) ultimo.hasta = d;
    else out.push({ desde: d, hasta: d });
  }
  return out;
}

/**
 * Los días de un mes en el formato del Excel:
 * `25 DE JULIO DE 2026`, `26 Y 29 DE JULIO DE 2026`,
 * `1, 2 Y 3 DE AGOSTO DE 2026`, `7, 13 AL 19 DE AGOSTO DE 2026`.
 *
 * La conjunción final («… Y 16») solo aparece cuando ningún trozo es un
 * rango; en cuanto hay un «AL» por medio, todo se separa con comas
 * (`1 AL 5, 13 DE AGOSTO DE 2026`). Es la regla que siguen los 26
 * archivos, aunque los escribieron a mano y por tanto es una convención
 * observada, no una especificación.
 */
export function textoDias(dias: number[], mes: number, anio: number): string {
  if (!dias.length) return '';
  const ts = tramos(dias);
  const hayRango = ts.some((t) => t.hasta - t.desde + 1 >= MIN_DIAS_PARA_RANGO);

  const piezas: string[] = [];
  for (const t of ts) {
    const largo = t.hasta - t.desde + 1;
    if (largo >= MIN_DIAS_PARA_RANGO) piezas.push(`${t.desde} AL ${t.hasta}`);
    else for (let d = t.desde; d <= t.hasta; d++) piezas.push(String(d));
  }

  let lista: string;
  if (piezas.length === 1) {
    lista = piezas[0];
  } else if (hayRango) {
    lista = piezas.join(', ');
  } else {
    lista = `${piezas.slice(0, -1).join(', ')} Y ${piezas[piezas.length - 1]}`;
  }

  return `${lista} DE ${MESES[mes - 1]} DE ${anio}`;
}

// ─────────────────────────────────────────────────────────────────────────
// Semanas
// ─────────────────────────────────────────────────────────────────────────

export interface SemanaPeriodo {
  /** `SEMANA DEL 27 DE JULIO AL 2 DE AGOSTO`. */
  etiqueta: string;
  /** Índices dentro de `diasDelPeriodo()`, para sumar la fila de horas. */
  indices: number[];
  desde: string;
  hasta: string;
}

/**
 * Parte el periodo en semanas de lunes a domingo, recortadas por los
 * extremos. Es lo que alimenta el bloque «TOTAL HORAS SEMANALES» del Excel,
 * donde la primera y la última semana salen cortas (el periodo empieza en
 * martes y acaba en jueves).
 */
export function semanasDelPeriodo(dias: DiaPeriodo[]): SemanaPeriodo[] {
  if (!dias.length) return [];
  const grupos: DiaPeriodo[][] = [];
  let actual: DiaPeriodo[] = [];
  for (const d of dias) {
    const esLunes = DIAS_SEMANA[new Date(`${d.fecha}T00:00:00Z`).getUTCDay()] === 'LUNES';
    if (esLunes && actual.length) {
      grupos.push(actual);
      actual = [];
    }
    actual.push(d);
  }
  if (actual.length) grupos.push(actual);

  return grupos.map((g) => {
    const a = g[0];
    const b = g[g.length - 1];
    const etiqueta =
      a.mes === b.mes
        ? `SEMANA DEL ${a.dia} AL ${b.dia} DE ${a.nombreMes}`
        : `SEMANA DEL ${a.dia} DE ${a.nombreMes} AL ${b.dia} DE ${b.nombreMes}`;
    return { etiqueta, indices: g.map((d) => d.indice), desde: a.fecha, hasta: b.fecha };
  });
}

/**
 * Los tramos de mes seguidos del periodo, para los merges de la fila de
 * cabecera del canvas (`JULIO` sobre las 11 primeras columnas, `AGOSTO`
 * sobre las 20 siguientes).
 */
export function tramosDeMes(
  dias: DiaPeriodo[],
): { nombreMes: string; mes: number; anio: number; desde: number; hasta: number }[] {
  const out: { nombreMes: string; mes: number; anio: number; desde: number; hasta: number }[] = [];
  for (const d of dias) {
    const ultimo = out[out.length - 1];
    if (ultimo && ultimo.mes === d.mes && ultimo.anio === d.anio) ultimo.hasta = d.indice;
    else out.push({ nombreMes: d.nombreMes, mes: d.mes, anio: d.anio, desde: d.indice, hasta: d.indice });
  }
  return out;
}
