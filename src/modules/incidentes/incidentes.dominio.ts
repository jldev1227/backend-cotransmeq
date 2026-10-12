/**
 * Reglas del módulo de incidentes, sin base de datos.
 *
 * Viven aparte del servicio para poder probarlas solas: el servicio arrastra
 * Prisma, S3 y sockets al importarse, y una regla de transición o de plazo no
 * debería necesitar nada de eso para comprobarse.
 *
 * Guía normativa: Res. 1401 de 2007 (investigación de incidentes y accidentes
 * de trabajo: investigar dentro de los 15 días siguientes, equipo
 * investigador, causas inmediatas y básicas) y Res. 40595 de 2022 (PESV:
 * registro y análisis de siniestros viales).
 */

export const TIPOS_INCIDENTE = ['ACCIDENTE_TRANSITO', 'INCIDENTE', 'CASI_ACCIDENTE'] as const
export type TipoIncidente = (typeof TIPOS_INCIDENTE)[number]

export const ESTADOS_INCIDENTE = ['REPORTADO', 'EN_INVESTIGACION', 'CERRADO'] as const
export type EstadoIncidente = (typeof ESTADOS_INCIDENTE)[number]

/** El enum `enum_pesv_severidad` del PESV, del más leve al más grave. */
export const SEVERIDADES = ['SOLO_DANOS', 'LESION_LEVE', 'LESION_GRAVE', 'FATALIDAD'] as const
export type Severidad = (typeof SEVERIDADES)[number]

export const TRAYECTOS = ['LABORAL', 'IN_ITINERE', 'MISION', 'PARTICULAR'] as const
export type Trayecto = (typeof TRAYECTOS)[number]

/// Res. 1401 de 2007, art. 4: la investigación se hace dentro de los quince
/// días calendario siguientes al evento.
export const DIAS_PARA_INVESTIGAR = 15

export const TIPO_LABEL: Record<TipoIncidente, string> = {
  ACCIDENTE_TRANSITO: 'Accidente de tránsito',
  INCIDENTE: 'Incidente',
  CASI_ACCIDENTE: 'Casi-accidente',
}

export const ESTADO_LABEL: Record<EstadoIncidente, string> = {
  REPORTADO: 'Reportado',
  EN_INVESTIGACION: 'En investigación',
  CERRADO: 'Cerrado',
}

export const SEVERIDAD_LABEL: Record<Severidad, string> = {
  SOLO_DANOS: 'Solo daños materiales',
  LESION_LEVE: 'Lesionados (leve)',
  LESION_GRAVE: 'Lesionados (grave)',
  FATALIDAD: 'Fatalidad',
}

/** Radicado visible: `INC-0007`. */
export function codigoIncidente(consecutivo: number): string {
  return `INC-${String(consecutivo).padStart(4, '0')}`
}

/** Acepta `INC-0007`, `inc 7` o `7` y devuelve el consecutivo; null si no es un radicado. */
export function consecutivoDeTexto(texto: string): number | null {
  const m = texto.trim().match(/^(?:inc[-\s]?)?0*(\d{1,9})$/i)
  return m ? Number(m[1]) : null
}

// ── Fechas (YYYY-MM-DD, sin zona) ─────────────────────────────────────────

export function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

export function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000)
}

/** Hoy en Colombia: el cron corre en servidores en UTC y a las 7 p. m. de aquí allá ya es mañana. */
export function hoyColombia(ahora = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(ahora)
}

// ── Plazo de investigación ────────────────────────────────────────────────

/** Último día para tener la investigación hecha. */
export function fechaLimiteInvestigacion(fechaEvento: string): string {
  return sumarDias(fechaEvento, DIAS_PARA_INVESTIGAR)
}

export interface Plazo {
  limite: string
  /** Negativo cuando ya pasó. Null si el incidente está cerrado. */
  dias_restantes: number | null
  vencido: boolean
}

export function plazoInvestigacion(inc: { estado: EstadoIncidente; fecha: string }, hoy: string): Plazo {
  const limite = fechaLimiteInvestigacion(inc.fecha)
  if (inc.estado === 'CERRADO') return { limite, dias_restantes: null, vencido: false }
  const dias = diasEntre(hoy, limite)
  return { limite, dias_restantes: dias, vencido: dias < 0 }
}

/**
 * ¿Toca el recordatorio de investigación pendiente?
 *
 * Sale el día en que se cumplen los 15 días (último día del plazo) o después,
 * si sigue sin cerrar: así quien lo recibe aún llega a tiempo, y si el cron no
 * corrió ese día el aviso sale al siguiente en vez de perderse. Se avisa una
 * sola vez; eso lo garantiza la huella de la notificación, no esta función.
 */
export function requiereRecordatorio(inc: { estado: EstadoIncidente; fecha: string }, hoy: string): boolean {
  if (inc.estado === 'CERRADO') return false
  return diasEntre(inc.fecha, hoy) >= DIAS_PARA_INVESTIGAR
}

// ── Transiciones de estado ────────────────────────────────────────────────

export const ACCIONES_ESTADO = ['iniciar_investigacion', 'cerrar', 'reabrir'] as const
export type AccionEstado = (typeof ACCIONES_ESTADO)[number]

/**
 * REPORTADO → EN_INVESTIGACION → CERRADO, y CERRADO → EN_INVESTIGACION para
 * reabrir. No hay atajo de REPORTADO a CERRADO: la Res. 1401 obliga a
 * investigar también los incidentes, no solo los accidentes.
 */
const TRANSICIONES: Record<AccionEstado, { desde: EstadoIncidente; hacia: EstadoIncidente }> = {
  iniciar_investigacion: { desde: 'REPORTADO', hacia: 'EN_INVESTIGACION' },
  cerrar: { desde: 'EN_INVESTIGACION', hacia: 'CERRADO' },
  reabrir: { desde: 'CERRADO', hacia: 'EN_INVESTIGACION' },
}

/// Una sola forma con campos opcionales y no una unión discriminada: el
/// tsconfig va sin `strictNullChecks` y ahí `if (!t.ok)` no estrecha la unión.
export interface ResultadoTransicion {
  ok: boolean
  desde: EstadoIncidente
  hacia: EstadoIncidente | null
  motivo: string | null
}

export function transicion(actual: EstadoIncidente, accion: AccionEstado): ResultadoTransicion {
  const t = TRANSICIONES[accion]
  if (!t) return { ok: false, desde: actual, hacia: null, motivo: 'Acción desconocida' }
  if (actual !== t.desde) {
    const motivos: Record<AccionEstado, string> = {
      iniciar_investigacion: 'La investigación ya se había iniciado',
      cerrar:
        actual === 'REPORTADO'
          ? 'Primero hay que iniciar la investigación: un reporte no se cierra sin investigar'
          : 'El incidente ya está cerrado',
      reabrir: 'Solo se reabre un incidente cerrado',
    }
    return { ok: false, desde: actual, hacia: null, motivo: motivos[accion] }
  }
  return { ok: true, desde: t.desde, hacia: t.hacia, motivo: null }
}

/** Mientras no esté cerrado, el reporte se puede corregir. */
export function reporteEditable(estado: EstadoIncidente): boolean {
  return estado !== 'CERRADO'
}

/** La investigación solo se escribe con la investigación abierta. */
export function investigacionEditable(estado: EstadoIncidente): boolean {
  return estado === 'EN_INVESTIGACION'
}

// ── Coherencia del reporte ────────────────────────────────────────────────

export interface DatosGravedad {
  tipo: TipoIncidente
  severidad: Severidad | null
  heridos: number
  fallecidos: number
  fecha: string
}

/**
 * Errores de coherencia entre tipo, gravedad y víctimas. Lista vacía = válido.
 *
 * Por definición (Res. 1401), un incidente no deja lesionados y un
 * casi-accidente no deja ni daños: si los hubo, lo que se reporta es otro tipo.
 * Se rechaza en vez de corregir en silencio, porque cambiar el tipo cambia
 * a quién se avisa y lo que cuenta en los indicadores.
 */
export function erroresDeGravedad(d: DatosGravedad, hoy: string): string[] {
  const errores: string[] = []
  const conLesion = d.severidad === 'LESION_LEVE' || d.severidad === 'LESION_GRAVE'

  if (d.fecha > hoy) errores.push('La fecha del evento no puede ser futura')
  if (d.heridos < 0 || d.fallecidos < 0) errores.push('Los lesionados y fallecidos no pueden ser negativos')

  if (d.tipo === 'ACCIDENTE_TRANSITO' && !d.severidad) errores.push('Indica la gravedad del accidente')
  if (d.tipo === 'CASI_ACCIDENTE') {
    if (d.severidad) errores.push('Un casi-accidente no tiene gravedad: si hubo daños o lesiones, es un incidente o un accidente')
    if (d.heridos > 0 || d.fallecidos > 0) errores.push('Un casi-accidente no tiene lesionados: repórtalo como accidente')
  }
  if (d.tipo === 'INCIDENTE' && (conLesion || d.severidad === 'FATALIDAD' || d.heridos > 0 || d.fallecidos > 0)) {
    errores.push('Si hubo lesionados o fallecidos es un accidente, no un incidente')
  }
  if (conLesion && d.heridos < 1) errores.push('La gravedad dice que hubo lesionados: indica cuántos')
  if (d.severidad === 'FATALIDAD' && d.fallecidos < 1) errores.push('La gravedad dice fatalidad: indica cuántos fallecidos')
  if (d.severidad === 'SOLO_DANOS' && (d.heridos > 0 || d.fallecidos > 0)) {
    errores.push('Hay lesionados o fallecidos: la gravedad no puede ser «solo daños»')
  }
  return errores
}

/** ¿Hubo personas lesionadas o fallecidas? Decide si talento humano entra en el aviso. */
export function huboLesionados(d: { severidad: Severidad | null; heridos: number | null; fallecidos: number | null }): boolean {
  return (
    (d.heridos ?? 0) > 0 ||
    (d.fallecidos ?? 0) > 0 ||
    d.severidad === 'LESION_LEVE' ||
    d.severidad === 'LESION_GRAVE' ||
    d.severidad === 'FATALIDAD'
  )
}

/**
 * Áreas que reciben el aviso de un reporte y el recordatorio del plazo.
 *
 * HSEQ investiga y administración responde ante clientes y aseguradoras.
 * Talento humano entra si hubo lesionados: le toca el reporte a la ARL, las
 * incapacidades y el acompañamiento a la persona.
 */
export function areasAviso(d: { severidad: Severidad | null; heridos: number | null; fallecidos: number | null }): string[] {
  const areas = ['hseq', 'administracion']
  if (huboLesionados(d)) areas.push('talento_humano')
  return areas
}

// ── Investigación y cierre ────────────────────────────────────────────────

export interface MiembroEquipo {
  nombre: string
  cargo?: string | null
}

export interface DatosInvestigacion {
  fecha_investigacion: string | null
  equipo_investigador: MiembroEquipo[]
  actos_inseguros: string | null
  condiciones_inseguras: string | null
  factores_personales: string | null
  factores_trabajo: string | null
  analisis_porques: string[]
  causas_identificadas: string | null
  lecciones_aprendidas: string | null
}

export interface DatosCierre {
  fecha_cierre: string | null
  responsable_cierre: string | null
}

const lleno = (v: string | null | undefined) => !!v && v.trim().length > 0

/**
 * Lo que falta para poder cerrar. Lista vacía = se puede cerrar.
 *
 * Lo mínimo que pide la Res. 1401 a una investigación: quién investigó y
 * cuándo, causas inmediatas, causas básicas y la conclusión. Las lecciones
 * aprendidas y las acciones no bloquean: hay eventos de causa externa donde
 * no queda nada que corregir, y obligar a inventar una acción ensucia el
 * módulo de acciones correctivas.
 */
export function faltantesParaCerrar(fechaEvento: string, inv: DatosInvestigacion, cierre: DatosCierre, hoy: string): string[] {
  const faltan: string[] = []
  if (!inv.fecha_investigacion) faltan.push('Fecha de la investigación')
  else if (inv.fecha_investigacion < fechaEvento) faltan.push('La fecha de la investigación es anterior al evento')
  if (!inv.equipo_investigador.some((m) => lleno(m.nombre))) faltan.push('Equipo investigador (al menos una persona)')
  if (!lleno(inv.actos_inseguros) && !lleno(inv.condiciones_inseguras)) {
    faltan.push('Causas inmediatas (actos o condiciones inseguras)')
  }
  if (!lleno(inv.factores_personales) && !lleno(inv.factores_trabajo)) {
    faltan.push('Causas básicas (factores personales o del trabajo)')
  }
  if (!lleno(inv.causas_identificadas)) faltan.push('Causa raíz (conclusión del análisis)')
  if (!cierre.fecha_cierre) faltan.push('Fecha de cierre')
  else {
    if (cierre.fecha_cierre < fechaEvento) faltan.push('La fecha de cierre es anterior al evento')
    if (cierre.fecha_cierre > hoy) faltan.push('La fecha de cierre no puede ser futura')
    if (inv.fecha_investigacion && cierre.fecha_cierre < inv.fecha_investigacion) {
      faltan.push('La fecha de cierre es anterior a la de la investigación')
    }
  }
  if (!lleno(cierre.responsable_cierre)) faltan.push('Responsable del cierre')
  return faltan
}

// ── Indicadores ───────────────────────────────────────────────────────────

/** Días desde el último accidente de tránsito; null si nunca se registró ninguno. */
export function diasSinAccidentes(ultimoAccidente: string | null, hoy: string): number | null {
  if (!ultimoAccidente) return null
  return Math.max(0, diasEntre(ultimoAccidente, hoy))
}

export interface PuntoMensual {
  /** `YYYY-MM` */
  mes: string
  ACCIDENTE_TRANSITO: number
  INCIDENTE: number
  CASI_ACCIDENTE: number
  total: number
}

/**
 * Eventos por mes y tipo, con los meses vacíos incluidos: una serie con
 * huecos dibuja «marzo junto a junio» y esconde justo los meses buenos.
 */
export function serieMensual(eventos: Array<{ fecha: string; tipo: TipoIncidente }>, desdeMes: string, hastaMes: string): PuntoMensual[] {
  const serie: PuntoMensual[] = []
  const indice = new Map<string, PuntoMensual>()
  let [anio, mes] = desdeMes.split('-').map(Number)
  const [anioFin, mesFin] = hastaMes.split('-').map(Number)
  while (anio < anioFin || (anio === anioFin && mes <= mesFin)) {
    const clave = `${anio}-${String(mes).padStart(2, '0')}`
    const punto: PuntoMensual = { mes: clave, ACCIDENTE_TRANSITO: 0, INCIDENTE: 0, CASI_ACCIDENTE: 0, total: 0 }
    serie.push(punto)
    indice.set(clave, punto)
    mes++
    if (mes > 12) {
      mes = 1
      anio++
    }
  }
  for (const e of eventos) {
    const punto = indice.get(e.fecha.slice(0, 7))
    if (!punto) continue
    punto[e.tipo]++
    punto.total++
  }
  return serie
}

/** Primer mes de una ventana de `meses` que termina en el mes de `hoy`. */
export function mesInicioVentana(hoy: string, meses: number): string {
  let [anio, mes] = hoy.split('-').map(Number)
  mes -= meses - 1
  while (mes < 1) {
    mes += 12
    anio--
  }
  return `${anio}-${String(mes).padStart(2, '0')}`
}
