/**
 * Reglas de cálculo del mantenimiento de flota: cuándo toca el próximo, en qué
 * estado está un plan, cuánto vale una orden y qué cambios de estado admite.
 *
 * Todo es puro —sin base de datos ni reloj; «hoy» entra como parámetro— para
 * poder probarlo y para que la pantalla, el panel y el cron diario digan lo
 * mismo: antes cada consulta del panel decidía «vencido» a su manera.
 */

/**
 * Umbrales de «próximo». Un plan entra en «próximo» con lo que ocurra primero.
 *
 * - 500 km: un vehículo de transporte especial hace entre 300 y 500 km en una
 *   jornada larga. Con 500 km de margen, mantenimiento tiene al menos un día
 *   para sacarlo de la programación y llevarlo al taller antes de pasarse.
 * - 15 días: lo que suele tardar una cita de taller más un repuesto que no
 *   está en stock. Es además el umbral intermedio de los avisos de documentos
 *   del vehículo, así que la gente ya lo reconoce.
 */
export const UMBRAL_KM_PROXIMO = 500
export const UMBRAL_DIAS_PROXIMO = 15

export type EstadoPlan = 'vencido' | 'proximo' | 'al_dia' | 'sin_datos' | 'pausado'
export type MotivoEstado = 'km' | 'fecha' | 'ambos' | null

const pad = (n: number) => String(n).padStart(2, '0')
const ISO = /^\d{4}-\d{2}-\d{2}$/

/**
 * Suma meses de calendario a una fecha `YYYY-MM-DD`.
 *
 * Si el día no existe en el mes de llegada se toma el último (31-ene + 1 mes
 * = 28-feb). Sin ese recorte, `Date` desborda al mes siguiente y un cambio de
 * aceite trimestral hecho el 31 de agosto «tocaría» el 1 de diciembre.
 */
export function sumarMeses(iso: string, meses: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const total = y * 12 + (m - 1) + meses
  const anio = Math.floor(total / 12)
  const mes = total - anio * 12
  const ultimoDia = new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate()
  return `${anio}-${pad(mes + 1)}-${pad(Math.min(d, ultimoDia))}`
}

export function sumarDias(iso: string, dias: number): string {
  const f = new Date(`${iso}T00:00:00Z`)
  f.setUTCDate(f.getUTCDate() + dias)
  return f.toISOString().slice(0, 10)
}

/** Días de `desde` a `hasta` (negativo si `hasta` ya pasó). */
export function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000)
}

export interface Periodicidad {
  periodicidad_km?: number | null
  periodicidad_meses?: number | null
  periodicidad_dias?: number | null
}

/** `true` si el plan dice cada cuánto: por kilómetros, por tiempo o por ambos. */
export function tienePeriodicidad(p: Periodicidad): boolean {
  return Boolean((p.periodicidad_km ?? 0) > 0 || (p.periodicidad_meses ?? 0) > 0 || (p.periodicidad_dias ?? 0) > 0)
}

/**
 * Próximo mantenimiento a partir del último.
 *
 * Cada eje se calcula por su cuenta: un plan «cada 5.000 km o 3 meses» tiene
 * próximo km Y próxima fecha, y vence con lo que llegue primero (eso lo decide
 * `evaluarPlan`). Sin último km no hay próximo km, y sin última fecha no hay
 * próxima fecha: inventar una base escondería un plan que nunca se ha hecho.
 *
 * Los meses mandan sobre los días si vienen los dos: la pantalla solo escribe
 * meses y `periodicidad_dias` queda por compatibilidad con el PESV.
 */
export function calcularProximo(
  p: Periodicidad & { ultima_km: number | null | undefined; ultima_fecha: string | null | undefined },
): { proximo_km: number | null; proxima_fecha: string | null } {
  const km = p.periodicidad_km && p.periodicidad_km > 0 && p.ultima_km != null && p.ultima_km >= 0 ? p.ultima_km + p.periodicidad_km : null
  let fecha: string | null = null
  if (p.ultima_fecha && ISO.test(p.ultima_fecha)) {
    if (p.periodicidad_meses && p.periodicidad_meses > 0) fecha = sumarMeses(p.ultima_fecha, p.periodicidad_meses)
    else if (p.periodicidad_dias && p.periodicidad_dias > 0) fecha = sumarDias(p.ultima_fecha, p.periodicidad_dias)
  }
  return { proximo_km: km, proxima_fecha: fecha }
}

export interface EvaluacionPlan {
  estado: EstadoPlan
  /** Lo que falta (negativo: lo que se pasó). Null si no se puede saber. */
  km_restantes: number | null
  dias_restantes: number | null
  /** Qué eje puso el estado: el kilometraje, la fecha o los dos. */
  motivo: MotivoEstado
}

/**
 * Estado de un plan con el kilometraje de la ficha y la fecha de hoy.
 *
 * - Por kilómetros vence al LLEGAR al próximo km («a los 10.000 km» quiere
 *   decir que a los 10.000 ya toca), así que 0 restantes es vencido.
 * - Por fecha, el mismo día todavía es a tiempo («toca hoy»): vence al día
 *   siguiente. Es la misma convención de los documentos del vehículo.
 * - Un kilometraje de 0 o vacío en la ficha es «no se sabe», no «nuevo»: la
 *   columna nace en 0 y solo el cron de preoperacionales la llena.
 */
export function evaluarPlan(params: {
  proximo_km: number | null | undefined
  proxima_fecha: string | null | undefined
  km_actual: number | null | undefined
  hoy: string
  activo?: boolean
}): EvaluacionPlan {
  const kmActual = params.km_actual != null && params.km_actual > 0 ? params.km_actual : null
  const km_restantes = params.proximo_km != null && kmActual != null ? params.proximo_km - kmActual : null
  const dias_restantes = params.proxima_fecha ? diasEntre(params.hoy, params.proxima_fecha) : null

  const motivoDe = (porKm: boolean, porFecha: boolean): MotivoEstado =>
    porKm && porFecha ? 'ambos' : porKm ? 'km' : porFecha ? 'fecha' : null

  if (params.activo === false) return { estado: 'pausado', km_restantes, dias_restantes, motivo: null }

  const vencidoKm = km_restantes != null && km_restantes <= 0
  const vencidoFecha = dias_restantes != null && dias_restantes < 0
  if (vencidoKm || vencidoFecha) return { estado: 'vencido', km_restantes, dias_restantes, motivo: motivoDe(vencidoKm, vencidoFecha) }

  const proximoKm = km_restantes != null && km_restantes <= UMBRAL_KM_PROXIMO
  const proximoFecha = dias_restantes != null && dias_restantes <= UMBRAL_DIAS_PROXIMO
  if (proximoKm || proximoFecha) return { estado: 'proximo', km_restantes, dias_restantes, motivo: motivoDe(proximoKm, proximoFecha) }

  if (km_restantes == null && dias_restantes == null) return { estado: 'sin_datos', km_restantes, dias_restantes, motivo: null }
  return { estado: 'al_dia', km_restantes, dias_restantes, motivo: null }
}

const RANGO_ESTADO: Record<EstadoPlan, number> = { vencido: 0, proximo: 1, al_dia: 2, sin_datos: 3, pausado: 4 }

/**
 * Orden de urgencia: primero el estado y, dentro de él, lo que esté más cerca
 * (o más pasado) en proporción a su umbral, para que 400 km y 3 días se puedan
 * comparar.
 */
export function compararUrgencia(a: EvaluacionPlan, b: EvaluacionPlan): number {
  const r = RANGO_ESTADO[a.estado] - RANGO_ESTADO[b.estado]
  if (r !== 0) return r
  const cercania = (e: EvaluacionPlan) =>
    Math.min(
      e.km_restantes != null ? e.km_restantes / UMBRAL_KM_PROXIMO : Number.POSITIVE_INFINITY,
      e.dias_restantes != null ? e.dias_restantes / UMBRAL_DIAS_PROXIMO : Number.POSITIVE_INFINITY,
    )
  return cercania(a) - cercania(b)
}

/**
 * Huella del aviso diario de un plan (`notificacion.referencia_tipo`, 50
 * caracteres). Lleva el punto de vencimiento: cuando una orden cierra el plan,
 * el próximo cambia y su ciclo de avisos empieza de cero sin borrar nada.
 */
export function huellaAvisoPlan(estado: 'vencido' | 'proximo', proximo_km: number | null, proxima_fecha: string | null): string {
  return `mant:${estado}:${proximo_km ?? '-'}:${proxima_fecha ?? '-'}`.slice(0, 50)
}

// ── Órdenes de trabajo ──────────────────────────────────────────────────

export type EstadoOrden = 'PROGRAMADO' | 'EN_CURSO' | 'EJECUTADO' | 'CANCELADO'

/**
 * Cambios de estado permitidos. Cerrar y anular son terminales: reabrir una
 * preventiva cerrada obligaría a deshacer lo que movió en su plan, y anular
 * una cerrada dejaría el plan apoyado en una orden que «no ocurrió».
 */
const TRANSICIONES: Record<EstadoOrden, EstadoOrden[]> = {
  PROGRAMADO: ['EN_CURSO', 'EJECUTADO', 'CANCELADO'],
  EN_CURSO: ['EJECUTADO', 'CANCELADO'],
  EJECUTADO: [],
  CANCELADO: [],
}

export function transicionValida(desde: EstadoOrden, hacia: EstadoOrden): boolean {
  return TRANSICIONES[desde]?.includes(hacia) ?? false
}

export interface LineaRepuesto {
  descripcion: string
  cantidad: number
  valor_unitario: number
}

/** Redondeo a centavos: los `Decimal(14,2)` de la base no guardan más. */
const centavos = (n: number) => Math.round(n * 100) / 100

/** Repuestos + mano de obra = total. El cliente no manda totales: se calculan aquí. */
export function totalesOrden(repuestos: LineaRepuesto[], manoObra: number | null | undefined) {
  const costo_repuestos = centavos(repuestos.reduce((s, r) => s + r.cantidad * r.valor_unitario, 0))
  const costo_mano_obra = centavos(manoObra ?? 0)
  return { costo_repuestos, costo_mano_obra, costo: centavos(costo_repuestos + costo_mano_obra) }
}

/**
 * Si cerrar esta orden debe mover el plan. Solo cuando es al menos tan
 * reciente como la última ejecución registrada: cerrar tarde una orden vieja
 * no puede devolver el plan hacia atrás.
 */
export function avanzaPlan(ultimaPlan: string | null | undefined, ejecucionOrden: string): boolean {
  return !ultimaPlan || ejecucionOrden >= ultimaPlan
}
