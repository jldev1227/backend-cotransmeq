/**
 * Contrato común de los 13 indicadores.
 *
 * La regla que decide el diseño entero: **un indicador sin insumos suficientes
 * devuelve `SIN_DATOS`, nunca cero.** Un 0 % de cumplimiento y un «no hay con
 * qué calcularlo» se ven igual en una tarjeta y significan lo contrario; el
 * primero es un hallazgo de auditoría y el segundo es un problema de captura.
 *
 * Por eso `valor`, `numerador` y `denominador` son `number | null`, y por eso
 * `dataCoverage` viaja siempre: quien mira la tarjeta tiene que poder saber
 * sobre cuántos registros se calculó y cuántos se quedaron fuera.
 */

import type { CoberturaDatos } from '../dominio/calidad'
import type { Periodo } from '../dominio/periodos'

export const CODIGOS_INDICADOR = [
  'TSV',
  'CSV',
  'RSVI',
  'GRV',
  'CMP',
  'CPLAN',
  'EJLC',
  'GVE',
  'ELVL',
  'IDP',
  'CPMVH',
  'CPFSV',
  'CPF',
  'NCAC',
] as const

export type CodigoIndicador = (typeof CODIGOS_INDICADOR)[number]

export type EstadoIndicador = 'OK' | 'ALERTA' | 'CRITICO' | 'SIN_DATOS'
export type UnidadIndicador = 'PERCENT' | 'RATE' | 'COUNT' | 'CURRENCY'
export type SentidoMeta = 'MAYOR_ES_MEJOR' | 'MENOR_ES_MEJOR'
export type FrecuenciaIndicador = 'MENSUAL' | 'TRIMESTRAL' | 'ANUAL'

/** De dónde salió el número, para poder volver al registro. */
export interface FuenteIndicador {
  dominio: string
  /** Cuántos registros aportó. */
  registros: number
  /** Muestra de ids para el enlace profundo. Nunca la lista entera. */
  recordIds: string[]
  /** Ruta del dashboard con el filtro ya puesto. */
  actionUrl?: string
}

/** Problema de datos que el usuario puede ir a corregir. */
export interface IncidenciaIndicador {
  code: string
  message: string
  count: number
  actionUrl?: string
}

export interface ResultadoIndicador {
  code: CodigoIndicador
  nombre: string
  descripcion: string
  frecuencia: FrecuenciaIndicador
  periodo: {
    granularidad: Periodo['granularidad']
    anio: number
    trimestre?: number
    mes?: number
    desde: string
    hasta: string
    etiqueta: string
  }
  status: EstadoIndicador
  value: number | null
  unit: UnidadIndicador
  numerator: number | null
  denominator: number | null
  /** La fórmula tal cual, para que el auditor la reproduzca a mano. */
  formula: string
  target: number | null
  sentido: SentidoMeta
  /** Diferencia contra el mismo indicador en el período anterior. */
  tendencia: {
    valorAnterior: number | null
    delta: number | null
    direccion: 'SUBE' | 'BAJA' | 'IGUAL' | 'SIN_COMPARACION'
    /** `true` si el movimiento va en el sentido deseado por la meta. */
    favorable: boolean | null
  }
  dataCoverage: CoberturaDatos
  sources: FuenteIndicador[]
  issues: IncidenciaIndicador[]
  /** Por qué está en `SIN_DATOS`, en lenguaje de la persona que lo va a leer. */
  razonSinDatos: string | null
  calculadoAt: string
  /** Desglose opcional (severidad, trimestre, área…) para el detalle. */
  desglose?: Array<{ etiqueta: string; valor: number | null; unidad?: UnidadIndicador }>
}

/** Ficha estática de cada indicador. Es lo que el paso 20 exige documentar. */
export interface FichaIndicador {
  code: CodigoIndicador
  nombre: string
  descripcion: string
  formula: string
  unit: UnidadIndicador
  frecuencia: FrecuenciaIndicador
  sentido: SentidoMeta
  /** Pasos de la matriz que este indicador alimenta. */
  pasos: number[]
  /** Dominios de los que bebe, para explicar la procedencia sin calcular. */
  fuentes: string[]
}

export const FICHAS: Record<CodigoIndicador, FichaIndicador> = {
  TSV: {
    code: 'TSV',
    nombre: 'Tasa de siniestralidad vial',
    descripcion:
      'Siniestros por millón de kilómetros recorridos, desagregada por severidad. Incluye eventos laborales e in itinere dentro del alcance del PESV.',
    formula: '(siniestros del periodo × 1.000.000) / kilómetros recorridos',
    unit: 'RATE',
    frecuencia: 'TRIMESTRAL',
    sentido: 'MENOR_ES_MEJOR',
    pasos: [13, 21],
    fuentes: ['pesv_incident', 'registro_dia_laboral_segmento'],
  },
  CSV: {
    code: 'CSV',
    nombre: 'Costos de la siniestralidad vial',
    descripcion: 'Suma de costos directos e indirectos de los siniestros del periodo, por nivel de pérdida.',
    formula: 'Σ(costo_directo) + Σ(costo_indirecto)',
    unit: 'CURRENCY',
    frecuencia: 'TRIMESTRAL',
    sentido: 'MENOR_ES_MEJOR',
    pasos: [13, 21],
    fuentes: ['pesv_incident'],
  },
  RSVI: {
    code: 'RSVI',
    nombre: 'Reducción de riesgos viales identificados',
    descripcion:
      'Diferencia entre los riesgos con valoración final y los riesgos con valoración inicial. Un valor negativo indica reducción.',
    formula: 'riesgos_valorados_final − riesgos_valorados_inicial',
    unit: 'COUNT',
    frecuencia: 'ANUAL',
    sentido: 'MENOR_ES_MEJOR',
    pasos: [6],
    fuentes: ['pesv_risk'],
  },
  GRV: {
    code: 'GRV',
    nombre: 'Gestión de riesgos viales críticos',
    descripcion: 'Variación del número de riesgos en nivel ALTO o CRITICO entre la valoración inicial y la final.',
    formula: 'riesgos_altos_final − riesgos_altos_inicial',
    unit: 'COUNT',
    frecuencia: 'ANUAL',
    sentido: 'MENOR_ES_MEJOR',
    pasos: [6],
    fuentes: ['pesv_risk'],
  },
  CMP: {
    code: 'CMP',
    nombre: 'Cumplimiento de metas del PESV',
    descripcion: 'Metas declaradas como logradas sobre el total de metas definidas para el ciclo.',
    formula: '(metas_logradas / metas_definidas) × 100',
    unit: 'PERCENT',
    frecuencia: 'TRIMESTRAL',
    sentido: 'MAYOR_ES_MEJOR',
    pasos: [7],
    fuentes: ['pesv_goal'],
  },
  CPLAN: {
    code: 'CPLAN',
    nombre: 'Cumplimiento del plan anual de trabajo',
    descripcion: 'Actividades ejecutadas sobre actividades programadas para el periodo.',
    formula: '(actividades_ejecutadas / actividades_programadas) × 100',
    unit: 'PERCENT',
    frecuencia: 'TRIMESTRAL',
    sentido: 'MAYOR_ES_MEJOR',
    pasos: [9],
    fuentes: ['actividades_pesv'],
  },
  EJLC: {
    code: 'EJLC',
    nombre: 'Exceso de jornada laboral de conducción',
    descripcion:
      'Días con jornada de conducción por encima del límite vigente, sobre días efectivamente trabajados.',
    formula: '(dias_con_exceso / dias_trabajados) × 100',
    unit: 'PERCENT',
    frecuencia: 'MENSUAL',
    sentido: 'MENOR_ES_MEJOR',
    pasos: [15],
    fuentes: ['registro_dia_laboral', 'registro_dia_laboral_segmento'],
  },
  GVE: {
    code: 'GVE',
    nombre: 'Gestión de velocidad en la flota',
    descripcion:
      'Vehículos cubiertos por el programa de velocidad segura sobre los vehículos efectivamente usados en el periodo.',
    formula: '(vehiculos_cubiertos / vehiculos_usados) × 100',
    unit: 'PERCENT',
    frecuencia: 'MENSUAL',
    sentido: 'MAYOR_ES_MEJOR',
    pasos: [8],
    fuentes: ['pesv_program_vehicle', 'registro_dia_laboral_segmento', 'servicios'],
  },
  ELVL: {
    code: 'ELVL',
    nombre: 'Exceso de límites de velocidad',
    descripcion:
      'Desplazamientos con al menos un evento de exceso, sobre el total de desplazamientos del periodo. Exige eventos individuales: los totales mensuales históricos no se convierten en desplazamientos.',
    formula: '(desplazamientos_con_exceso / desplazamientos_totales) × 100',
    unit: 'PERCENT',
    frecuencia: 'MENSUAL',
    sentido: 'MENOR_ES_MEJOR',
    pasos: [8],
    fuentes: ['pesv_speed_event', 'servicios'],
  },
  IDP: {
    code: 'IDP',
    nombre: 'Inspección diaria preoperacional',
    descripcion:
      'Vehículo-fecha con al menos un envío válido de la asignación marcada como preoperacional, sobre vehículo-fecha efectivamente trabajado.',
    formula: '(vehiculo_fecha_inspeccionado / vehiculo_fecha_trabajado) × 100',
    unit: 'PERCENT',
    frecuencia: 'MENSUAL',
    sentido: 'MAYOR_ES_MEJOR',
    pasos: [16],
    fuentes: ['form_submissions', 'registro_dia_laboral_segmento', 'servicios'],
  },
  CPMVH: {
    code: 'CPMVH',
    nombre: 'Cumplimiento del plan de mantenimiento',
    descripcion:
      'Mantenimientos preventivos ejecutados dentro de plazo sobre los programados. Ejecutar después del vencimiento cuenta como ejecutado pero no como oportuno.',
    formula: '(preventivos_oportunos / preventivos_programados) × 100',
    unit: 'PERCENT',
    frecuencia: 'TRIMESTRAL',
    sentido: 'MAYOR_ES_MEJOR',
    pasos: [17],
    fuentes: ['vehicle_maintenance_event'],
  },
  CPFSV: {
    code: 'CPFSV',
    nombre: 'Cumplimiento del plan de formación en seguridad vial',
    descripcion: 'Capacitaciones ejecutadas sobre capacitaciones programadas en el periodo.',
    formula: '(capacitaciones_ejecutadas / capacitaciones_programadas) × 100',
    unit: 'PERCENT',
    frecuencia: 'TRIMESTRAL',
    sentido: 'MAYOR_ES_MEJOR',
    pasos: [10],
    fuentes: ['pesv_training_plan', 'formularios_asistencia'],
  },
  CPF: {
    code: 'CPF',
    nombre: 'Cobertura de personal formado',
    descripcion:
      'Personas distintas que asistieron a formación sobre la población objetivo congelada del periodo.',
    formula: '(personas_capacitadas / poblacion_objetivo) × 100',
    unit: 'PERCENT',
    frecuencia: 'TRIMESTRAL',
    sentido: 'MAYOR_ES_MEJOR',
    pasos: [10],
    fuentes: ['pesv_training_plan', 'respuestas_asistencia'],
  },
  NCAC: {
    code: 'NCAC',
    nombre: 'No conformidades gestionadas y cerradas',
    descripcion:
      'Hallazgos de auditoría PESV cerrados con eficacia evaluada, sobre los hallazgos identificados.',
    formula: '(hallazgos_cerrados_eficaces / hallazgos_identificados) × 100',
    unit: 'PERCENT',
    frecuencia: 'ANUAL',
    sentido: 'MAYOR_ES_MEJOR',
    pasos: [22, 23],
    fuentes: ['acciones_correctivas_preventivas'],
  },
}

/** Meta configurada por HSEQ para un indicador de un ciclo. */
export interface MetaIndicador {
  valor: number | null
  sentido: SentidoMeta
  /**
   * Distancia a la meta, en puntos de la unidad, a partir de la cual el
   * semáforo pasa a ALERTA. Por encima de eso, CRITICO.
   */
  umbralAlerta: number | null
}

/**
 * Semáforo.
 *
 * `SIN_DATOS` gana sobre todo lo demás: si no hay valor, no hay nada que
 * comparar. Y sin meta aprobada el estado se queda en `SIN_DATOS` **a
 * propósito** aunque el valor exista: el número se muestra igual en la tarjeta,
 * pero declarar «OK» sin meta sería inventarse el criterio de aceptación.
 */
export function evaluarSemaforo(
  valor: number | null,
  meta: MetaIndicador | null,
): { status: EstadoIndicador; razon: string | null } {
  if (valor == null) {
    return { status: 'SIN_DATOS', razon: 'No hay insumos suficientes para calcular el indicador.' }
  }
  if (!meta || meta.valor == null) {
    return {
      status: 'SIN_DATOS',
      razon: 'El valor se calculó, pero el ciclo no tiene meta aprobada para este indicador.',
    }
  }

  const cumple = meta.sentido === 'MAYOR_ES_MEJOR' ? valor >= meta.valor : valor <= meta.valor
  if (cumple) return { status: 'OK', razon: null }

  const distancia = Math.abs(valor - meta.valor)
  const umbral = meta.umbralAlerta
  if (umbral != null && distancia <= umbral) return { status: 'ALERTA', razon: null }
  /// Sin umbral configurado no se inventa una zona amarilla: fuera de meta es
  /// CRITICO. Una tolerancia por defecto haría que un incumplimiento se viera
  /// ámbar sin que nadie lo hubiera decidido.
  return { status: umbral == null ? 'CRITICO' : 'CRITICO', razon: null }
}

/** Tendencia contra el período anterior, con signo interpretado por la meta. */
export function calcularTendencia(
  valor: number | null,
  valorAnterior: number | null,
  sentido: SentidoMeta,
): ResultadoIndicador['tendencia'] {
  if (valor == null || valorAnterior == null) {
    return { valorAnterior, delta: null, direccion: 'SIN_COMPARACION', favorable: null }
  }
  const delta = redondear(valor - valorAnterior)
  if (delta === 0) return { valorAnterior, delta, direccion: 'IGUAL', favorable: null }
  const sube = delta > 0
  return {
    valorAnterior,
    delta,
    direccion: sube ? 'SUBE' : 'BAJA',
    favorable: sentido === 'MAYOR_ES_MEJOR' ? sube : !sube,
  }
}

/**
 * Porcentaje con denominador cero tratado como ausencia de dato.
 *
 * Es el corazón de la regla de `SIN_DATOS`: `0/0` no es 0 %, es «no hubo nada
 * que medir». Devolver 0 aquí haría que un mes sin operación apareciera como
 * incumplimiento total.
 */
export function porcentaje(numerador: number, denominador: number): number | null {
  if (!Number.isFinite(denominador) || denominador <= 0) return null
  return redondear((numerador / denominador) * 100)
}

/** Tasa por millón, con la misma regla de denominador cero. */
export function tasaPorMillon(numerador: number, denominador: number): number | null {
  if (!Number.isFinite(denominador) || denominador <= 0) return null
  return redondear((numerador * 1_000_000) / denominador)
}

/** Dos decimales. Suficiente para un porcentaje y estable al comparar. */
export function redondear(valor: number, decimales = 2): number {
  const factor = 10 ** decimales
  return Math.round(valor * factor) / factor
}
