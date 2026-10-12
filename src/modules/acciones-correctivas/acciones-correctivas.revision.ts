/**
 * «Próxima revisión» de una acción correctiva, calculada en el servidor.
 *
 * Es copia EXACTA de `resumenRevision`, `fechaMasRecienteActividad` y
 * `accionCerrada` de `ingreso-svelte/src/lib/acciones-correctivas/dashboard-utils.ts`
 * (y de su gemelo en cotransmeq-app). Vive aquí porque el tablero pagina en el
 * servidor: con 24 tarjetas por página, el cliente ya no ve todas las filas y
 * no puede contar cuántas revisiones están vencidas ni filtrar por ellas.
 * Antes el listado pedía `limit: 50` y todo —conteos, paneles, filtro— salía
 * de esas 50; con la 51.ª acción los números empezaban a mentir sin avisar.
 *
 * Si cambias la regla en un lado, cámbiala en el otro: el detalle de la acción
 * sigue calculándola en el cliente y los dos tienen que decir lo mismo.
 *
 * Funciones puras (sin Prisma) para poder probarlas sin base.
 */

/** Días entre una actividad y la siguiente revisión (`INTERVALO_SEGUIMIENTO_DIAS` del front). */
export const INTERVALO_SEGUIMIENTO_DIAS = 15

/// La empresa opera en Colombia: «hoy» es el día de Bogotá, no el del
/// servidor. Railway corre en UTC, y entre las 19:00 y la medianoche de
/// Bogotá el servidor ya está en el día siguiente: una revisión que vence
/// «hoy» saldría como vencida ayer.
const ZONA_EMPRESA = 'America/Bogota'
const MS_DIA = 24 * 60 * 60 * 1000

export type EstadoRevision = 'vencida' | 'hoy' | 'proxima' | 'al-dia' | 'cerrada' | 'sin-actividad'

export interface ResumenRevision {
  /** ISO YYYY-MM-DD de la última actividad registrada. */
  ultimaFecha: string | null
  /** ISO YYYY-MM-DD: `ultimaFecha` + `INTERVALO_SEGUIMIENTO_DIAS`. */
  proximaFecha: string | null
  /** Días desde hoy hasta la próxima revisión (negativo si está vencida). */
  diasHasta: number | null
  estado: EstadoRevision
}

type Fecha = Date | string | null | undefined

/** Lo mínimo de una acción que hace falta para su revisión (la fila ligera del listado). */
export interface FilaRevision {
  estado_global?: string | null
  evaluacion_cierre_eficaz?: string | null
  fecha_cierre_definitivo?: Fecha
  fecha_seguimiento?: Fecha
  fecha_implementacion?: Fecha
  fecha_identificacion_hallazgo?: Fecha
  causas?: Array<{ fecha_seguimiento?: Fecha }>
  seguimientos_correccion?: Array<{ fecha_seguimiento?: Fecha }>
}

/**
 * Fecha a ISO `YYYY-MM-DD`.
 *
 * Las columnas son `@db.Date`: Prisma las entrega como medianoche UTC, así
 * que el día es el de `toISOString()`. Con `getDate()` (hora local) un
 * servidor al oeste de UTC restaría un día. Es lo mismo que veía el front,
 * que recibía la fecha serializada («2026-06-04T00:00:00.000Z») y cortaba
 * por la «T».
 */
export function isoFecha(valor: Fecha): string | null {
  if (!valor) return null
  if (valor instanceof Date) {
    if (Number.isNaN(valor.getTime())) return null
    return valor.toISOString().slice(0, 10)
  }
  const limpio = valor.trim()
  if (!limpio) return null
  return limpio.split('T')[0]
}

/** Día de hoy en Bogotá, `YYYY-MM-DD` (`en-CA` formatea justo así). */
export function hoyBogota(ahora: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA_EMPRESA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(ahora)
}

/// Aritmética de calendario en UTC: sin horas ni cambios de horario que
/// muevan el resultado medio día. `setUTCFullYear` porque `Date.UTC` lee los
/// años 0–99 como 1900–1999.
function aUtc(iso: string): Date | null {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return null
  const fecha = new Date(Date.UTC(2000, m - 1, d))
  fecha.setUTCFullYear(y)
  return Number.isNaN(fecha.getTime()) ? null : fecha
}

export function sumarDias(iso: string, dias: number): string {
  const base = aUtc(iso)
  if (!base) return ''
  base.setUTCDate(base.getUTCDate() + dias)
  return base.toISOString().slice(0, 10)
}

export function diasEntre(desdeIso: string, hastaIso: string): number {
  const a = aUtc(desdeIso)
  const b = aUtc(hastaIso)
  if (!a || !b) return 0
  return Math.round((b.getTime() - a.getTime()) / MS_DIA)
}

/**
 * Fecha más reciente con actividad: seguimiento de alguna causa, seguimiento
 * de la corrección inmediata, seguimiento o implementación a nivel acción y,
 * solo si no hubo nada de eso, la identificación del hallazgo (para que una
 * acción recién creada tenga desde cuándo contar).
 */
export function fechaMasRecienteActividad(fila: FilaRevision): string | null {
  const fechas: string[] = []
  const anotar = (f: Fecha) => {
    const iso = isoFecha(f)
    if (iso) fechas.push(iso)
  }

  fila.causas?.forEach((c) => anotar(c.fecha_seguimiento))
  fila.seguimientos_correccion?.forEach((s) => anotar(s.fecha_seguimiento))
  anotar(fila.fecha_seguimiento)
  anotar(fila.fecha_implementacion)

  if (!fechas.length) anotar(fila.fecha_identificacion_hallazgo)

  if (!fechas.length) return null
  /// ISO con año de cuatro cifras: el orden de texto es el cronológico.
  fechas.sort()
  return fechas[fechas.length - 1]
}

export function accionCerrada(fila: FilaRevision): boolean {
  if (fila.estado_global === 'CUMPLIDA') return true
  if (fila.evaluacion_cierre_eficaz === 'EFICAZ' && fila.fecha_cierre_definitivo) return true
  return false
}

export function resumenRevision(fila: FilaRevision, hoy: string = hoyBogota()): ResumenRevision {
  if (accionCerrada(fila)) {
    return { ultimaFecha: null, proximaFecha: null, diasHasta: null, estado: 'cerrada' }
  }

  const ultima = fechaMasRecienteActividad(fila)
  if (!ultima) {
    return { ultimaFecha: null, proximaFecha: null, diasHasta: null, estado: 'sin-actividad' }
  }

  const proximaFecha = sumarDias(ultima, INTERVALO_SEGUIMIENTO_DIAS)
  const diasHasta = diasEntre(hoy, proximaFecha)

  let estado: EstadoRevision
  if (diasHasta < 0) estado = 'vencida'
  else if (diasHasta === 0) estado = 'hoy'
  else if (diasHasta <= 7) estado = 'proxima'
  else estado = 'al-dia'

  return { ultimaFecha: ultima, proximaFecha, diasHasta, estado }
}

export type FiltroRevision = 'vencidas' | 'proximas'

/**
 * Panel en el que cae una acción según su revisión; `null` si en ninguno
 * (las cerradas no se revisan).
 *
 * «Vencidas» incluye la que toca hoy: hoy ya hay que hacerla. «Próximas»
 * incluye las que están lejos y las que nunca tuvieron actividad, igual que
 * los paneles del tablero.
 */
export function panelRevision(estado: EstadoRevision): FiltroRevision | null {
  if (estado === 'vencida' || estado === 'hoy') return 'vencidas'
  if (estado === 'proxima' || estado === 'al-dia' || estado === 'sin-actividad') return 'proximas'
  return null
}

// ── Resumen del listado ─────────────────────────────────────────────────

/** Fila ligera del listado: lo que hace falta para contar, sin el detalle de la tarjeta. */
export interface FilaListado extends FilaRevision {
  id: string
  accion_numero: string
  responsable_ejecucion?: string | null
  estado_global: string
  tipo_accion_ejecutar?: string | null
  fecha_limite_cierre_accion?: Fecha
  causas?: Array<{ fecha_seguimiento?: Fecha; estado_seguimiento?: string | null }>
}

/** Un chip de los paneles «Vencidas de revisión» / «Próximas revisiones». */
export interface RevisionPendiente extends ResumenRevision {
  id: string
  accion_numero: string
  responsable_ejecucion: string | null
}

export interface ResumenListado {
  /** Acciones que cumplen todo salvo el estado: el «Total» de los conteos. */
  total_estados: number
  por_estado: Record<'EN_PROCESO' | 'VENCIDA' | 'CUMPLIDA' | 'REPLANTEADA', number>
  /** Del resultado: fecha límite de cierre dentro de los próximos 7 días. */
  proximas_vencer: number
  /** Acciones que cumplen todo salvo la revisión, ya ordenadas por urgencia. */
  revisiones: { vencidas: RevisionPendiente[]; proximas: RevisionPendiente[] }
  /** Del resultado: estado de las causas de sus acciones. */
  causas: { total: number; en_proceso: number; vencida: number; cumplida: number }
  /** Del resultado: acciones por tipo (`Sin tipo` si no lo tiene). */
  por_tipo: Record<string, number>
}

export interface FiltrosResumen {
  estado_global?: string
  revision?: FiltroRevision
}

const SIETE_DIAS_MS = 7 * MS_DIA

function aMs(valor: Fecha): number | null {
  if (!valor) return null
  const ms = valor instanceof Date ? valor.getTime() : new Date(valor).getTime()
  return Number.isNaN(ms) ? null : ms
}

/**
 * Conteos del tablero y acciones que entran en el resultado.
 *
 * `filas` son las que cumplen los filtros «de base» (papelera, búsqueda,
 * tipo…) pero NO el estado ni la revisión: esos dos son facetas, y cada
 * conteo se calcula con todos los filtros menos el suyo. Así, con «Vencidas»
 * elegido, los conteos de estado siguen diciendo cuántas hay en proceso o
 * cumplidas —que es lo que se necesita para cambiar de segmento— y, con la
 * revisión elegida, el panel de revisiones sigue mostrando los dos lados.
 * Lo demás (paginador, causas, tipos, «vencen en 7 días») es del resultado.
 *
 * Devuelve los `ids` del resultado en el orden de `filas`, para que la
 * consulta de la página filtre por ellos cuando hay revisión (no es una
 * columna: no se puede pedir en el `where`).
 */
export function resumirListado(
  filas: FilaListado[],
  filtros: FiltrosResumen = {},
  opciones: { hoy?: string; ahora?: number } = {}
): { ids: string[]; resumen: ResumenListado } {
  const hoy = opciones.hoy ?? hoyBogota()
  const ahora = opciones.ahora ?? Date.now()
  const { estado_global, revision } = filtros

  const por_estado: ResumenListado['por_estado'] = {
    EN_PROCESO: 0,
    VENCIDA: 0,
    CUMPLIDA: 0,
    REPLANTEADA: 0
  }
  let total_estados = 0
  const vencidas: RevisionPendiente[] = []
  const proximas: RevisionPendiente[] = []
  const ids: string[] = []
  let proximas_vencer = 0
  const causas = { total: 0, en_proceso: 0, vencida: 0, cumplida: 0 }
  const por_tipo: Record<string, number> = {}

  for (const fila of filas) {
    const resumen = resumenRevision(fila, hoy)
    const panel = panelRevision(resumen.estado)
    const cumpleRevision = !revision || panel === revision
    const cumpleEstado = !estado_global || fila.estado_global === estado_global

    if (cumpleRevision) {
      total_estados++
      if (fila.estado_global in por_estado) {
        por_estado[fila.estado_global as keyof typeof por_estado]++
      }
    }

    if (cumpleEstado && panel) {
      const chip: RevisionPendiente = {
        id: fila.id,
        accion_numero: fila.accion_numero,
        responsable_ejecucion: fila.responsable_ejecucion ?? null,
        ...resumen
      }
      if (panel === 'vencidas') vencidas.push(chip)
      else proximas.push(chip)
    }

    if (!cumpleEstado || !cumpleRevision) continue

    ids.push(fila.id)

    const limite = aMs(fila.fecha_limite_cierre_accion)
    if (limite !== null) {
      const falta = limite - ahora
      if (falta > 0 && falta < SIETE_DIAS_MS) proximas_vencer++
    }

    for (const c of fila.causas ?? []) {
      causas.total++
      if (c.estado_seguimiento === 'En Proceso') causas.en_proceso++
      else if (c.estado_seguimiento === 'Vencida') causas.vencida++
      else if (c.estado_seguimiento === 'Cumplida') causas.cumplida++
    }

    const tipo = fila.tipo_accion_ejecutar || 'Sin tipo'
    por_tipo[tipo] = (por_tipo[tipo] ?? 0) + 1
  }

  /// Mismo orden que pintaba el tablero: la más atrasada primero y, en las
  /// próximas, las que nunca tuvieron actividad (sin días) al final. `sort`
  /// es estable: a igual urgencia queda el orden del listado.
  vencidas.sort((a, b) => (a.diasHasta ?? 0) - (b.diasHasta ?? 0))
  proximas.sort((a, b) => (a.diasHasta ?? 999) - (b.diasHasta ?? 999))

  return {
    ids,
    resumen: {
      total_estados,
      por_estado,
      proximas_vencer,
      revisiones: { vencidas, proximas },
      causas,
      por_tipo
    }
  }
}
