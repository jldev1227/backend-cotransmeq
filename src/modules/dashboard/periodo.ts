/**
 * Periodo del panel: un rango de fechas en hora de Colombia (UTC-5, sin
 * horario de verano, así que el desfase es fijo y no hace falta tz-data).
 *
 * El front manda `desde` y `hasta` en `YYYY-MM-DD` ya resueltos (el mes, la
 * semana o el rango que eligió el usuario); aquí solo se validan, se acotan y
 * se convierten a instantes. Sin parámetros, el mes en curso.
 */
const FECHA = /^\d{4}-\d{2}-\d{2}$/
const MAX_DIAS = 400
export const DESFASE_BOGOTA_MS = 5 * 3600 * 1000

export interface Periodo {
  /** `YYYY-MM-DD`, inclusive. */
  desde: string
  /** `YYYY-MM-DD`, inclusive. */
  hasta: string
  /** Instante de inicio (00:00 Bogotá). */
  inicio: Date
  /** Instante de fin EXCLUSIVO (00:00 Bogotá del día siguiente a `hasta`). */
  fin: Date
  dias: number
  /** Meses calendario que toca el periodo, para tablas que guardan año/mes. */
  meses: Array<{ anio: number; mes: number }>
}

/** Hoy en Bogotá como `YYYY-MM-DD`. */
export function hoyBogota(): string {
  return new Date(Date.now() - DESFASE_BOGOTA_MS).toISOString().slice(0, 10)
}

/** Hora del día (0-23) de un instante, en Bogotá. */
export function horaBogota(d: Date): number {
  return new Date(d.getTime() - DESFASE_BOGOTA_MS).getUTCHours()
}

/** Día `YYYY-MM-DD` de un instante, en Bogotá. */
export function diaBogota(d: Date): string {
  return new Date(d.getTime() - DESFASE_BOGOTA_MS).toISOString().slice(0, 10)
}

function inicioDia(iso: string): Date {
  return new Date(`${iso}T00:00:00-05:00`)
}

function sumarDias(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function resolverPeriodo(q: { desde?: unknown; hasta?: unknown } = {}): Periodo {
  const hoy = hoyBogota()
  let desde = typeof q.desde === 'string' && FECHA.test(q.desde) ? q.desde : `${hoy.slice(0, 7)}-01`
  let hasta = typeof q.hasta === 'string' && FECHA.test(q.hasta) ? q.hasta : finDeMes(hoy.slice(0, 7))
  if (hasta < desde) [desde, hasta] = [hasta, desde]

  const inicio = inicioDia(desde)
  let fin = inicioDia(sumarDias(hasta, 1))
  let dias = Math.round((fin.getTime() - inicio.getTime()) / 86400000)
  if (dias > MAX_DIAS) {
    hasta = sumarDias(desde, MAX_DIAS - 1)
    fin = inicioDia(sumarDias(hasta, 1))
    dias = MAX_DIAS
  }

  const meses: Periodo['meses'] = []
  let [a, m] = desde.split('-').map(Number)
  const [ah, mh] = hasta.split('-').map(Number)
  while (a < ah || (a === ah && m <= mh)) {
    meses.push({ anio: a, mes: m })
    m += 1
    if (m > 12) {
      m = 1
      a += 1
    }
  }

  return { desde, hasta, inicio, fin, dias, meses }
}

export function finDeMes(yyyyMm: string): string {
  const [a, m] = yyyyMm.split('-').map(Number)
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate()
  return `${yyyyMm}-${String(ultimo).padStart(2, '0')}`
}

/** Lista de días `YYYY-MM-DD` del periodo, para series sin huecos. */
export function diasDelPeriodo(p: Periodo): string[] {
  const out: string[] = []
  let d = p.desde
  for (let i = 0; i < p.dias; i++) {
    out.push(d)
    d = sumarDias(d, 1)
  }
  return out
}
