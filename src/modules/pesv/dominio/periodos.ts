/**
 * Períodos de cálculo en zona de negocio.
 *
 * `businessDateFor` y `BUSINESS_TIMEZONE` se reutilizan de Formularios: es la
 * misma pregunta («¿a qué día pertenece este instante?») y tener dos
 * implementaciones garantizaba que un preoperacional de las 19:00 contara para
 * un día en la inspección y para otro en el indicador.
 *
 * Todo lo que sale de aquí son cadenas `YYYY-MM-DD` o `Date` a medianoche UTC
 * de esa fecha civil. Las columnas `@db.Date` de Prisma se leen y escriben así,
 * y mezclar `Date` con hora local es lo que hace que un `gte` se coma o se deje
 * un día según el servidor donde corra.
 */

import { BUSINESS_TIMEZONE, businessDateFor } from '../../formularios-dinamicos/domain/assignments'

export { BUSINESS_TIMEZONE, businessDateFor }

export type Granularidad = 'ANUAL' | 'TRIMESTRAL' | 'MENSUAL'

export interface Periodo {
  granularidad: Granularidad
  anio: number
  /** 1–4. Presente solo en `TRIMESTRAL`. */
  trimestre?: number
  /** 1–12. Presente solo en `MENSUAL`. */
  mes?: number
  /** Inicio inclusivo, `YYYY-MM-DD`. */
  desde: string
  /** Fin inclusivo, `YYYY-MM-DD`. */
  hasta: string
  etiqueta: string
}

const NOMBRES_MES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

function ymd(anio: number, mes: number, dia: number): string {
  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
}

/** Último día del mes, contando bisiestos. */
export function ultimoDiaDelMes(anio: number, mes: number): number {
  return new Date(Date.UTC(anio, mes, 0)).getUTCDate()
}

/**
 * Construye el período de cálculo.
 *
 * El orden de precedencia es mes → trimestre → año, y no al revés: pedir
 * `?anio=2026&mes=3` significa marzo de 2026, no todo 2026. Si se invirtiera,
 * un filtro de mes en la URL no haría nada y el usuario vería el acumulado
 * creyendo que ve el mes.
 */
export function construirPeriodo(anio: number, trimestre?: number | null, mes?: number | null): Periodo {
  if (mes != null) {
    if (mes < 1 || mes > 12) throw new RangeError(`Mes fuera de rango: ${mes}`)
    return {
      granularidad: 'MENSUAL',
      anio,
      mes,
      desde: ymd(anio, mes, 1),
      hasta: ymd(anio, mes, ultimoDiaDelMes(anio, mes)),
      etiqueta: `${NOMBRES_MES[mes - 1]} de ${anio}`,
    }
  }

  if (trimestre != null) {
    if (trimestre < 1 || trimestre > 4) throw new RangeError(`Trimestre fuera de rango: ${trimestre}`)
    const mesInicio = (trimestre - 1) * 3 + 1
    const mesFin = mesInicio + 2
    return {
      granularidad: 'TRIMESTRAL',
      anio,
      trimestre,
      desde: ymd(anio, mesInicio, 1),
      hasta: ymd(anio, mesFin, ultimoDiaDelMes(anio, mesFin)),
      etiqueta: `T${trimestre} de ${anio}`,
    }
  }

  return {
    granularidad: 'ANUAL',
    anio,
    desde: ymd(anio, 1, 1),
    hasta: ymd(anio, 12, 31),
    etiqueta: `año ${anio}`,
  }
}

/**
 * El período inmediatamente anterior, con la misma granularidad.
 *
 * Es lo que alimenta la tendencia de cada indicador. Se calcula y no se
 * almacena: guardar un histórico de resultados obligaría a recalcularlo entero
 * cada vez que se corrige un dato de origen, y entonces la tendencia mentiría
 * hasta el siguiente recálculo.
 */
export function periodoAnterior(periodo: Periodo): Periodo {
  switch (periodo.granularidad) {
    case 'MENSUAL': {
      const mes = periodo.mes!
      return mes === 1
        ? construirPeriodo(periodo.anio - 1, null, 12)
        : construirPeriodo(periodo.anio, null, mes - 1)
    }
    case 'TRIMESTRAL': {
      const t = periodo.trimestre!
      return t === 1
        ? construirPeriodo(periodo.anio - 1, 4, null)
        : construirPeriodo(periodo.anio, t - 1, null)
    }
    case 'ANUAL':
      return construirPeriodo(periodo.anio - 1, null, null)
  }
}

/**
 * `Date` a medianoche UTC de una fecha civil `YYYY-MM-DD`.
 *
 * Nunca `new Date('2026-03-01')` con hora local: en Bogotá (UTC-5) eso produce
 * el 29 de febrero a las 19:00 UTC, y una consulta `gte` sobre una columna
 * `@db.Date` se traería un día de más.
 */
export function aFechaUtc(ymdStr: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymdStr)
  if (!m) throw new RangeError(`Fecha inválida, se esperaba YYYY-MM-DD: "${ymdStr}"`)
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
}

/** Fin del día en UTC, para columnas `timestamptz` filtradas por fecha civil. */
export function finDelDiaUtc(ymdStr: string): Date {
  const d = aFechaUtc(ymdStr)
  d.setUTCHours(23, 59, 59, 999)
  return d
}

/**
 * Rango `timestamptz` que cubre exactamente los días civiles del período en la
 * zona de negocio.
 *
 * Bogotá es UTC-5 fijo, pero se resuelve con `Intl` igualmente: la aritmética
 * de offsets a mano es lo que se rompe el día que alguien mueva la zona.
 */
export function rangoInstantes(periodo: Periodo, zona: string = BUSINESS_TIMEZONE): { desde: Date; hasta: Date } {
  return {
    desde: instanteInicioDeDia(periodo.desde, zona),
    hasta: instanteFinDeDia(periodo.hasta, zona),
  }
}

function offsetMinutos(fecha: Date, zona: string): number {
  /// `en-US` con `timeZoneName: 'longOffset'` da «GMT-05:00». Es la única vía
  /// estándar de obtener el offset real de una zona en una fecha concreta sin
  /// meter una librería.
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: zona,
    timeZoneName: 'longOffset',
  }).formatToParts(fecha)
  const texto = partes.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+00:00'
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(texto)
  if (!m) return 0
  const signo = m[1] === '-' ? -1 : 1
  return signo * (Number(m[2]) * 60 + Number(m[3]))
}

export function instanteInicioDeDia(ymdStr: string, zona: string = BUSINESS_TIMEZONE): Date {
  const base = aFechaUtc(ymdStr)
  return new Date(base.getTime() - offsetMinutos(base, zona) * 60_000)
}

export function instanteFinDeDia(ymdStr: string, zona: string = BUSINESS_TIMEZONE): Date {
  const inicio = instanteInicioDeDia(ymdStr, zona)
  return new Date(inicio.getTime() + 24 * 3600_000 - 1)
}

/** Los meses `YYYY-MM` que toca el período, en orden. */
export function mesesDelPeriodo(periodo: Periodo): string[] {
  const desde = aFechaUtc(periodo.desde)
  const hasta = aFechaUtc(periodo.hasta)
  const meses: string[] = []
  const cursor = new Date(Date.UTC(desde.getUTCFullYear(), desde.getUTCMonth(), 1))
  while (cursor <= hasta) {
    meses.push(`${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`)
    cursor.setUTCMonth(cursor.getUTCMonth() + 1)
  }
  return meses
}

/** Días naturales del período, ambos extremos incluidos. */
export function diasDelPeriodo(periodo: Periodo): number {
  const desde = aFechaUtc(periodo.desde).getTime()
  const hasta = aFechaUtc(periodo.hasta).getTime()
  return Math.round((hasta - desde) / 86_400_000) + 1
}

/** Fecha de hoy en zona de negocio, `YYYY-MM-DD`. */
export function hoyEnBogota(ahora: Date = new Date()): string {
  return businessDateFor(ahora, BUSINESS_TIMEZONE)
}

/**
 * Días entre dos fechas civiles (`hasta - desde`), sin horas de por medio.
 *
 * Positivo si `hasta` es posterior. Es lo que decide si un documento está
 * `POR_VENCER`: restar timestamps con hora daría 29,7 días donde hay 30 y el
 * umbral fallaría por redondeo justo el día del límite.
 */
export function diasEntre(desdeYmd: string, hastaYmd: string): number {
  return Math.round((aFechaUtc(hastaYmd).getTime() - aFechaUtc(desdeYmd).getTime()) / 86_400_000)
}

/** `Date` → `YYYY-MM-DD` leyendo los componentes UTC (columnas `@db.Date`). */
export function fechaAYmd(fecha: Date | null | undefined): string | null {
  if (!fecha) return null
  return `${fecha.getUTCFullYear()}-${String(fecha.getUTCMonth() + 1).padStart(2, '0')}-${String(
    fecha.getUTCDate(),
  ).padStart(2, '0')}`
}
