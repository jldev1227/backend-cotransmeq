/**
 * Contrato del canvas de RECORRIDOS.
 *
 * El libro es un PERIODO (`anio`/`mes`) y cada hoja es un CONDUCTOR. Dentro de
 * una hoja, UNA FILA = UN RECORRIDO (un `registro_dia_laboral_segmento`), no un
 * día: si alguien hizo dos recorridos el mismo día, salen dos filas seguidas.
 * No se agrupa por día ni por cliente, y el orden es cronológico ascendente
 * (la fecha más antigua arriba).
 *
 * Los días que no tienen recorridos —DESCANSO, MANTENIMIENTO y los DISPONIBLE
 * sin tramo— aparecen igual, como una fila `tipo_fila: 'dia'`. Omitirlos
 * escondería justamente los días que hay que revisar cuando un conteo de bonos
 * no cuadra.
 *
 * Las columnas de bono son DINÁMICAS: las decide `bono_config_visual` para el
 * año del periodo, y viajan resueltas desde el servidor. El builder del canvas
 * no elige geometría, solo pinta lo que llega — mismo criterio que
 * `nomina-canvas.types.ts`.
 */

/** Estados de día que admite `registro_dia_laboral.tipo`. */
export const TIPOS_DIA = ['LABORADO', 'DISPONIBLE', 'DESCANSO', 'MANTENIMIENTO'] as const
export type TipoDia = (typeof TIPOS_DIA)[number]

/**
 * Una columna de bono del canvas.
 *
 * `config_id` es la identidad estable (FK a `configuraciones_liquidacion`); el
 * `nombre` es un rótulo que puede cambiar de un año a otro, así que nunca se
 * usa para casar datos. Ese fue justamente el fallo del puente viejo entre
 * recorridos y nómina, que emparejaba por nombre en minúsculas.
 */
export interface BonoColumna {
  config_id: string
  nombre: string
  /** Valor unitario vigente del año. Es lo que el PDF imprime en la celda. */
  valor: number
  anio: number
}

/** Una fila del canvas: un recorrido, o un día sin recorridos. */
export interface FilaRecorrido {
  /**
   * `segmento` → la fila ES un recorrido y versiona por segmento.
   * `dia`      → día sin tramos; solo se pueden tocar campos del padre.
   */
  tipo_fila: 'segmento' | 'dia'
  registro_dia_id: string
  segmento_id: string | null
  /**
   * Versión para el compare-and-swap. Es la del segmento cuando la fila es un
   * recorrido, y la del día cuando no lo es.
   */
  version: number

  /** `YYYY-MM-DD`. Se serializa como texto para que no viaje un Date con zona. */
  fecha: string
  tipo_dia: string
  /** Orden del tramo dentro del día (1, 2, 3…). `0` en las filas de día. */
  orden: number

  cliente_id: string | null
  cliente_nombre: string | null
  vehiculo_id: string | null
  vehiculo_placa: string | null

  hora_inicio: string | null
  hora_fin: string | null
  inicio_dia_siguiente: boolean
  fin_dia_siguiente: boolean
  horas_conducidas: number
  km_inicial: number | null
  km_final: number | null
  pernocte: boolean
  observaciones: string | null

  /**
   * Bonos marcados en esta fila, por `config_id`. Solo lleva las claves de las
   * columnas visibles: un bono otorgado con una config que después se ocultó
   * sigue en la base, pero no se pinta.
   */
  bonos: Record<string, boolean>
}

/** Una hoja del libro: todo lo que hizo un conductor en el mes. */
export interface HojaRecorridos {
  conductor_id: string
  nombre: string
  apellido: string
  numero_identificacion: string | null
  /** Ya desambiguado y recortado a los 31 caracteres que admite Univer. */
  nombre_hoja: string
  filas: FilaRecorrido[]
}

export interface RecorridosPeriodoDTO {
  /** Mes en que CIERRA el corte. Identifica el room y los snapshots. */
  anio: number
  mes: number
  /** Primer día del corte, `YYYY-MM-DD` inclusive. */
  desde: string
  /** Último día del corte, `YYYY-MM-DD` inclusive. */
  hasta: string
  /** «Agosto 2026», para el título del libro y del PDF. */
  etiqueta: string
  /** Columnas de bono visibles, en el orden en que se pintan. */
  bonos: BonoColumna[]
  hojas: HojaRecorridos[]
  /** Motivos por los que el libro puede no ser lo que el usuario espera. */
  avisos: string[]
}

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

export function etiquetaPeriodo(anio: number, mes: number): string {
  return `${MESES[mes - 1] ?? mes} ${anio}`
}

/**
 * Nombre de pestaña de un conductor, recortado a 31 caracteres.
 *
 * Univer no admite más, y tampoco `: \ / ? * [ ]`. Se prefiere apellido primero
 * porque al truncar es lo que permite distinguir a dos personas.
 */
export function nombreHojaConductor(c: { nombre: string; apellido: string }): string {
  const crudo = `${c.apellido} ${c.nombre}`.replace(/[:\\/?*[\]]/g, ' ').replace(/\s+/g, ' ').trim()
  return (crudo || 'SIN NOMBRE').slice(0, 31)
}

/**
 * Desambigua nombres repetidos con un sufijo `~2`, `~3`…
 *
 * Dos conductores homónimos —o dos cuyos nombres colisionan al truncar a 31
 * caracteres— dejarían el libro con dos pestañas iguales, y elegir hoja por
 * nombre pasaría a ser una lotería.
 */
export function nombresUnicos(
  conductores: Array<{ id: string; nombre: string; apellido: string }>,
): Record<string, string> {
  const usados = new Map<string, number>()
  const salida: Record<string, string> = {}
  for (const c of conductores) {
    const base = nombreHojaConductor(c)
    const vistas = usados.get(base) ?? 0
    usados.set(base, vistas + 1)
    if (vistas === 0) {
      salida[c.id] = base
      continue
    }
    const sufijo = `~${vistas + 1}`
    salida[c.id] = `${base.slice(0, 31 - sufijo.length)}${sufijo}`
  }
  return salida
}
