/**
 * Los 13 calculadores, puros.
 *
 * Ninguna función de este archivo toca Prisma, Fastify ni el reloj. Reciben los
 * registros ya leídos y devuelven numerador, denominador, cobertura y fuentes.
 * Es lo que permite probar «denominador cero», «turno que cruza medianoche» o
 * «envío anulado» sin levantar una base ni un servidor — y es la única forma de
 * que esos casos se prueben de verdad, porque montar el escenario en base
 * cuesta tanto que se acaba probando solo el camino feliz.
 *
 * El repositorio (`repositorio.ts`) lee; esto decide.
 */

import {
  RegistroCobertura,
  claveVehiculoFecha,
  coberturaVacia,
  horasEntre,
  kilometrosDeTramo,
  type CoberturaDatos,
} from '../dominio/calidad'
import { diasEntre } from '../dominio/periodos'
import {
  porcentaje,
  redondear,
  tasaPorMillon,
  type FuenteIndicador,
  type IncidenciaIndicador,
  type UnidadIndicador,
} from './tipos'

/** Lo que devuelve un calculador antes de que el ensamblador le ponga meta y tendencia. */
export interface Calculo {
  value: number | null
  numerator: number | null
  denominator: number | null
  dataCoverage: CoberturaDatos
  sources: FuenteIndicador[]
  issues: IncidenciaIndicador[]
  razonSinDatos: string | null
  desglose?: Array<{ etiqueta: string; valor: number | null; unidad?: UnidadIndicador }>
}

function sinDatos(razon: string, cobertura = coberturaVacia()): Calculo {
  return {
    value: null,
    numerator: null,
    denominator: null,
    dataCoverage: cobertura,
    sources: [],
    issues: [],
    razonSinDatos: razon,
  }
}

/** Los primeros `n` ids, para el enlace profundo sin volcar la tabla entera. */
function muestra(ids: Array<string | null | undefined>, n = 25): string[] {
  return ids.filter((x): x is string => Boolean(x)).slice(0, n)
}

// ─────────────────────────────────────────────────────────────────────────
//  1. TSV — Tasa de siniestralidad vial
// ─────────────────────────────────────────────────────────────────────────

export type Severidad = 'FATALIDAD' | 'LESION_GRAVE' | 'LESION_LEVE' | 'SOLO_DANOS'

export interface SiniestroInsumo {
  id: string
  severidad: Severidad
  costoDirecto: number | null
  costoIndirecto: number | null
}

export interface TramoInsumo {
  id: string
  vehiculoId: string | null
  kmInicial: number | null
  kmFinal: number | null
}

/**
 * Siniestros por millón de kilómetros.
 *
 * Sin kilómetros confiables devuelve `SIN_DATOS` y **enseña los recorridos sin
 * kilometraje** como incidencia: la alternativa —estimar los km con un
 * promedio— produciría una tasa que se puede citar en un informe y que no
 * corresponde a nada.
 */
export function calcularTSV(siniestros: SiniestroInsumo[], tramos: TramoInsumo[]): Calculo {
  const cobertura = new RegistroCobertura()
  let kilometros = 0
  const sinKm: string[] = []

  for (const t of tramos) {
    cobertura.contarEsperado()
    const { km, motivo } = kilometrosDeTramo(t.kmInicial, t.kmFinal)
    if (km == null) {
      cobertura.excluir(motivo!, t.id)
      sinKm.push(t.id)
      continue
    }
    cobertura.contarValido()
    kilometros += km
  }

  const resultado = cobertura.resultado()

  const issues: IncidenciaIndicador[] = []
  if (sinKm.length > 0) {
    issues.push({
      code: 'RECORRIDOS_SIN_KILOMETRAJE',
      message:
        'Hay recorridos sin kilometraje utilizable. Mientras no se completen, la tasa se calcula sobre menos kilómetros de los reales.',
      count: sinKm.length,
      actionUrl: '/dashboard/nomina?vista=dias-laborados',
    })
  }

  if (kilometros <= 0) {
    return {
      ...sinDatos(
        'No hay kilómetros válidos en el periodo: sin denominador confiable la tasa no se puede calcular.',
        resultado,
      ),
      numerator: siniestros.length,
      issues,
      desglose: desgloseSeveridad(siniestros),
    }
  }

  const valor = tasaPorMillon(siniestros.length, kilometros)

  return {
    value: valor,
    numerator: siniestros.length,
    denominator: redondear(kilometros),
    dataCoverage: resultado,
    sources: [
      {
        dominio: 'pesv_incident',
        registros: siniestros.length,
        recordIds: muestra(siniestros.map((s) => s.id)),
        actionUrl: '/dashboard/pesv?vista=operacion&panel=siniestros',
      },
      {
        dominio: 'registro_dia_laboral_segmento',
        registros: resultado.validos,
        recordIds: muestra(tramos.map((t) => t.id)),
        actionUrl: '/dashboard/nomina?vista=dias-laborados',
      },
    ],
    issues,
    razonSinDatos: null,
    desglose: desgloseSeveridad(siniestros, kilometros),
  }
}

function desgloseSeveridad(
  siniestros: SiniestroInsumo[],
  kilometros?: number,
): Array<{ etiqueta: string; valor: number | null; unidad?: UnidadIndicador }> {
  const orden: Severidad[] = ['FATALIDAD', 'LESION_GRAVE', 'LESION_LEVE', 'SOLO_DANOS']
  const etiquetas: Record<Severidad, string> = {
    FATALIDAD: 'Fatalidad',
    LESION_GRAVE: 'Lesión grave',
    LESION_LEVE: 'Lesión leve',
    SOLO_DANOS: 'Solo daños',
  }
  return orden.map((sev) => {
    const n = siniestros.filter((s) => s.severidad === sev).length
    return {
      etiqueta: etiquetas[sev],
      valor: kilometros && kilometros > 0 ? tasaPorMillon(n, kilometros) : n,
      unidad: kilometros && kilometros > 0 ? ('RATE' as UnidadIndicador) : ('COUNT' as UnidadIndicador),
    }
  })
}

// ─────────────────────────────────────────────────────────────────────────
//  2. CSV — Costos de la siniestralidad vial
// ─────────────────────────────────────────────────────────────────────────

/**
 * Suma de costos.
 *
 * Un siniestro sin costos capturados NO suma cero: se cuenta como excluido. Si
 * los ceros entraran, tres siniestros sin valorar harían parecer que la
 * siniestralidad no costó nada, que es justo lo contrario de lo que el
 * indicador debe señalar.
 */
export function calcularCSV(siniestros: SiniestroInsumo[]): Calculo {
  const cobertura = new RegistroCobertura()
  let total = 0
  let conCosto = 0
  const sinCosto: string[] = []

  for (const s of siniestros) {
    cobertura.contarEsperado()
    const directo = s.costoDirecto ?? null
    const indirecto = s.costoIndirecto ?? null
    if (directo == null && indirecto == null) {
      cobertura.excluir('SIN_FECHA', s.id)
      sinCosto.push(s.id)
      continue
    }
    cobertura.contarValido()
    conCosto += 1
    total += (directo ?? 0) + (indirecto ?? 0)
  }

  const resultado = cobertura.resultado()
  const issues: IncidenciaIndicador[] = []
  if (sinCosto.length > 0) {
    issues.push({
      code: 'SINIESTROS_SIN_COSTO',
      message: 'Siniestros registrados sin costo directo ni indirecto. El total mostrado es una cota inferior.',
      count: sinCosto.length,
      actionUrl: '/dashboard/pesv?vista=operacion&panel=siniestros',
    })
  }

  if (siniestros.length === 0) {
    /// Cero siniestros SÍ es un cero legítimo: el periodo tuvo operación y no
    /// hubo eventos. Es la única de las trece métricas donde el cero informa.
    return {
      value: 0,
      numerator: 0,
      denominator: 0,
      dataCoverage: resultado,
      sources: [],
      issues,
      razonSinDatos: null,
    }
  }

  if (conCosto === 0) {
    return { ...sinDatos('Hay siniestros en el periodo, pero ninguno tiene costos capturados.', resultado), issues }
  }

  return {
    value: redondear(total),
    numerator: redondear(total),
    denominator: conCosto,
    dataCoverage: resultado,
    sources: [
      {
        dominio: 'pesv_incident',
        registros: siniestros.length,
        recordIds: muestra(siniestros.map((s) => s.id)),
        actionUrl: '/dashboard/pesv?vista=operacion&panel=siniestros',
      },
    ],
    issues,
    razonSinDatos: null,
    desglose: [
      {
        etiqueta: 'Costos directos',
        valor: redondear(siniestros.reduce((a, s) => a + (s.costoDirecto ?? 0), 0)),
        unidad: 'CURRENCY',
      },
      {
        etiqueta: 'Costos indirectos',
        valor: redondear(siniestros.reduce((a, s) => a + (s.costoIndirecto ?? 0), 0)),
        unidad: 'CURRENCY',
      },
    ],
  }
}

// ─────────────────────────────────────────────────────────────────────────
//  3.1 RSVI y 3.2 GRV — matriz de riesgos
// ─────────────────────────────────────────────────────────────────────────

export type NivelRiesgo = 'BAJO' | 'MEDIO' | 'ALTO' | 'CRITICO'

export interface RiesgoInsumo {
  id: string
  nivelInicial: NivelRiesgo | null
  nivelFinal: NivelRiesgo | null
}

const NIVELES_CRITICOS: NivelRiesgo[] = ['ALTO', 'CRITICO']

/** Riesgos con valoración final menos riesgos con valoración inicial. */
export function calcularRSVI(riesgos: RiesgoInsumo[]): Calculo {
  const cobertura = new RegistroCobertura()
  let iniciales = 0
  let finales = 0

  for (const r of riesgos) {
    cobertura.contarEsperado()
    if (r.nivelInicial == null) {
      cobertura.excluir('SIN_FECHA', r.id)
      continue
    }
    cobertura.contarValido()
    iniciales += 1
    if (r.nivelFinal != null) finales += 1
  }

  const resultado = cobertura.resultado()
  if (iniciales === 0) {
    return sinDatos(
      'La matriz de riesgos no tiene ninguna valoración inicial registrada para el ciclo.',
      resultado,
    )
  }

  const sinFinal = iniciales - finales
  const issues: IncidenciaIndicador[] =
    sinFinal > 0
      ? [
          {
            code: 'RIESGOS_SIN_VALORACION_FINAL',
            message:
              'Riesgos con valoración inicial pero sin valoración final. Hasta cerrarlos, la reducción medida es parcial.',
            count: sinFinal,
            actionUrl: '/dashboard/pesv?vista=matriz&paso=6',
          },
        ]
      : []

  return {
    value: finales - iniciales,
    numerator: finales,
    denominator: iniciales,
    dataCoverage: resultado,
    sources: [
      {
        dominio: 'pesv_risk',
        registros: riesgos.length,
        recordIds: muestra(riesgos.map((r) => r.id)),
        actionUrl: '/dashboard/pesv?vista=matriz&paso=6',
      },
    ],
    issues,
    razonSinDatos: null,
    desglose: [
      { etiqueta: 'Riesgos valorados inicialmente', valor: iniciales, unidad: 'COUNT' },
      { etiqueta: 'Riesgos con valoración final', valor: finales, unidad: 'COUNT' },
    ],
  }
}

/** Variación de los riesgos en nivel ALTO o CRITICO. */
export function calcularGRV(riesgos: RiesgoInsumo[]): Calculo {
  const cobertura = new RegistroCobertura()
  let altosIniciales = 0
  let altosFinales = 0
  let conFinal = 0

  for (const r of riesgos) {
    cobertura.contarEsperado()
    if (r.nivelInicial == null) {
      cobertura.excluir('SIN_FECHA', r.id)
      continue
    }
    cobertura.contarValido()
    if (NIVELES_CRITICOS.includes(r.nivelInicial)) altosIniciales += 1
    if (r.nivelFinal != null) {
      conFinal += 1
      if (NIVELES_CRITICOS.includes(r.nivelFinal)) altosFinales += 1
    }
  }

  const resultado = cobertura.resultado()
  if (resultado.validos === 0) {
    return sinDatos('No hay riesgos valorados en el ciclo.', resultado)
  }
  if (conFinal === 0) {
    return {
      ...sinDatos(
        'Ningún riesgo tiene valoración final. La variación de riesgos críticos no es calculable todavía.',
        resultado,
      ),
      denominator: altosIniciales,
    }
  }

  return {
    value: altosFinales - altosIniciales,
    numerator: altosFinales,
    denominator: altosIniciales,
    dataCoverage: resultado,
    sources: [
      {
        dominio: 'pesv_risk',
        registros: riesgos.length,
        recordIds: muestra(riesgos.map((r) => r.id)),
        actionUrl: '/dashboard/pesv?vista=matriz&paso=6',
      },
    ],
    issues: [],
    razonSinDatos: null,
    desglose: [
      { etiqueta: 'Riesgos altos o críticos (inicial)', valor: altosIniciales, unidad: 'COUNT' },
      { etiqueta: 'Riesgos altos o críticos (final)', valor: altosFinales, unidad: 'COUNT' },
    ],
  }
}

// ─────────────────────────────────────────────────────────────────────────
//  4. CMP — Cumplimiento de metas
// ─────────────────────────────────────────────────────────────────────────

export interface MetaInsumo {
  id: string
  lograda: boolean | null
}

/**
 * Metas logradas sobre metas definidas.
 *
 * Una meta con `lograda = null` es una meta sin evaluar: se excluye del
 * denominador. Contarla como no lograda castigaría al ciclo por no haberla
 * cerrado todavía, y contarla como lograda sería regalar cumplimiento.
 */
export function calcularCMP(metas: MetaInsumo[]): Calculo {
  const cobertura = new RegistroCobertura()
  let evaluadas = 0
  let logradas = 0

  for (const m of metas) {
    cobertura.contarEsperado()
    if (m.lograda == null) {
      cobertura.excluir('SIN_FECHA', m.id)
      continue
    }
    cobertura.contarValido()
    evaluadas += 1
    if (m.lograda) logradas += 1
  }

  const resultado = cobertura.resultado()
  const pendientes = metas.length - evaluadas
  const issues: IncidenciaIndicador[] =
    pendientes > 0
      ? [
          {
            code: 'METAS_SIN_EVALUAR',
            message: 'Metas definidas que todavía no se han declarado logradas o no logradas.',
            count: pendientes,
            actionUrl: '/dashboard/pesv?vista=indicadores&panel=metas',
          },
        ]
      : []

  if (metas.length === 0) {
    return sinDatos('El ciclo no tiene metas definidas.', resultado)
  }
  if (evaluadas === 0) {
    return { ...sinDatos('Hay metas definidas, pero ninguna se ha evaluado todavía.', resultado), issues }
  }

  return {
    value: porcentaje(logradas, evaluadas),
    numerator: logradas,
    denominator: evaluadas,
    dataCoverage: resultado,
    sources: [
      {
        dominio: 'pesv_goal',
        registros: metas.length,
        recordIds: muestra(metas.map((m) => m.id)),
        actionUrl: '/dashboard/pesv?vista=indicadores&panel=metas',
      },
    ],
    issues,
    razonSinDatos: null,
  }
}

// ─────────────────────────────────────────────────────────────────────────
//  5. CPLAN — Cumplimiento del plan anual
// ─────────────────────────────────────────────────────────────────────────

export interface ActividadInsumo {
  id: string
  estado: 'PENDIENTE' | 'EN_PROGRESO' | 'COMPLETADA' | 'VENCIDA' | 'CANCELADA'
}

/**
 * Actividades ejecutadas sobre programadas.
 *
 * `CANCELADA` sale del denominador: una actividad que la dirección decidió no
 * hacer no es un incumplimiento del plan. `VENCIDA` sí se queda dentro — no
 * ejecutarla a tiempo es exactamente lo que el indicador mide.
 */
export function calcularCPLAN(actividades: ActividadInsumo[]): Calculo {
  const cobertura = new RegistroCobertura()
  let programadas = 0
  let ejecutadas = 0
  let vencidas = 0

  for (const a of actividades) {
    cobertura.contarEsperado()
    if (a.estado === 'CANCELADA') {
      cobertura.excluir('FUERA_DE_PERIODO', a.id)
      continue
    }
    cobertura.contarValido()
    programadas += 1
    if (a.estado === 'COMPLETADA') ejecutadas += 1
    if (a.estado === 'VENCIDA') vencidas += 1
  }

  const resultado = cobertura.resultado()
  if (programadas === 0) {
    return sinDatos('No hay actividades programadas en el periodo.', resultado)
  }

  const issues: IncidenciaIndicador[] =
    vencidas > 0
      ? [
          {
            code: 'ACTIVIDADES_VENCIDAS',
            message: 'Actividades del plan anual que pasaron su fecha límite sin ejecutarse.',
            count: vencidas,
            actionUrl: '/dashboard/pesv?vista=plan&estado=VENCIDA',
          },
        ]
      : []

  return {
    value: porcentaje(ejecutadas, programadas),
    numerator: ejecutadas,
    denominator: programadas,
    dataCoverage: resultado,
    sources: [
      {
        dominio: 'actividades_pesv',
        registros: actividades.length,
        recordIds: muestra(actividades.map((a) => a.id)),
        actionUrl: '/dashboard/pesv?vista=plan',
      },
    ],
    issues,
    razonSinDatos: null,
  }
}

// ─────────────────────────────────────────────────────────────────────────
//  6. EJLC — Exceso de jornada laboral de conducción
// ─────────────────────────────────────────────────────────────────────────

export interface DiaLaboralInsumo {
  id: string
  conductorId: string
  fecha: string
  tipo: string
  segmentos: Array<{
    id: string
    horasConducidas: number | null
    horaInicio: string | null
    horaFin: string | null
    inicioDiaSiguiente: boolean
    finDiaSiguiente: boolean
  }>
}

/** Política de jornada con vigencia. No es una constante en el código. */
export interface PoliticaJornada {
  horasMaximasConduccion: number
  vigenteDesde: string
  vigenteHasta: string | null
}

function politicaVigente(politicas: PoliticaJornada[], fecha: string): PoliticaJornada | null {
  return (
    politicas.find(
      (p) => p.vigenteDesde <= fecha && (p.vigenteHasta == null || fecha <= p.vigenteHasta),
    ) ?? null
  )
}

/**
 * Días con jornada de conducción por encima del límite vigente.
 *
 * El límite se consulta por fecha contra una política con vigencia, y no se
 * lee de una constante: cuando el límite cambie, los meses anteriores tienen
 * que seguir evaluándose con el que estaba vigente entonces, o el histórico se
 * reescribe solo.
 *
 * Las horas salen de `horas_conducidas` cuando está informada, y si no, del
 * horario respetando las banderas de día siguiente. Un turno de 22:00 a 06:00
 * son 8 horas, no −16.
 */
export function calcularEJLC(dias: DiaLaboralInsumo[], politicas: PoliticaJornada[]): Calculo {
  const cobertura = new RegistroCobertura()
  let trabajados = 0
  let conExceso = 0
  const idsExceso: string[] = []
  let sinPolitica = 0
  let horariosIncoherentes = 0

  for (const dia of dias) {
    cobertura.contarEsperado()

    /// Solo los días que suponen conducción entran en el denominador: un
    /// DESCANSO o un día de MANTENIMIENTO no puede tener exceso de jornada, y
    /// meterlos diluiría el porcentaje hasta volverlo inútil.
    const conduce = dia.segmentos.length > 0
    if (!conduce) {
      cobertura.excluir('FUERA_DE_PERIODO', dia.id)
      continue
    }

    const politica = politicaVigente(politicas, dia.fecha)
    if (!politica) {
      cobertura.excluir('SIN_POLITICA_VIGENTE', dia.id)
      sinPolitica += 1
      continue
    }

    let horas = 0
    let incoherente = false
    for (const seg of dia.segmentos) {
      if (seg.horasConducidas != null && seg.horasConducidas > 0) {
        horas += seg.horasConducidas
        continue
      }
      const { horas: calculadas, motivo } = horasEntre(
        seg.horaInicio,
        seg.horaFin,
        seg.inicioDiaSiguiente,
        seg.finDiaSiguiente,
      )
      if (calculadas == null) {
        if (motivo === 'HORARIO_INCOHERENTE') incoherente = true
        continue
      }
      horas += calculadas
    }

    if (incoherente) {
      cobertura.excluir('HORARIO_INCOHERENTE', dia.id)
      horariosIncoherentes += 1
      continue
    }

    cobertura.contarValido()
    trabajados += 1
    if (horas > politica.horasMaximasConduccion) {
      conExceso += 1
      idsExceso.push(dia.id)
    }
  }

  const resultado = cobertura.resultado()

  const issues: IncidenciaIndicador[] = []
  if (sinPolitica > 0) {
    issues.push({
      code: 'SIN_POLITICA_JORNADA',
      message:
        'Días sin política de jornada vigente para su fecha. Configure la vigencia en el ciclo para poder evaluarlos.',
      count: sinPolitica,
      actionUrl: '/dashboard/pesv?vista=resumen&panel=configuracion',
    })
  }
  if (horariosIncoherentes > 0) {
    issues.push({
      code: 'HORARIOS_INCOHERENTES',
      message: 'Días con horario de inicio y fin incoherente. Corrija el registro diario para incluirlos.',
      count: horariosIncoherentes,
      actionUrl: '/dashboard/nomina?vista=dias-laborados',
    })
  }

  if (trabajados === 0) {
    return {
      ...sinDatos('No hay días de conducción evaluables en el periodo.', resultado),
      issues,
    }
  }

  return {
    value: porcentaje(conExceso, trabajados),
    numerator: conExceso,
    denominator: trabajados,
    dataCoverage: resultado,
    sources: [
      {
        dominio: 'registro_dia_laboral',
        registros: trabajados,
        recordIds: muestra(idsExceso),
        actionUrl: '/dashboard/nomina?vista=dias-laborados',
      },
    ],
    issues,
    razonSinDatos: null,
  }
}

// ─────────────────────────────────────────────────────────────────────────
//  7. GVE — Gestión de velocidad en la flota
// ─────────────────────────────────────────────────────────────────────────

/**
 * Vehículos cubiertos por el programa de velocidad sobre vehículos usados.
 *
 * El denominador son los vehículos que EFECTIVAMENTE operaron en el periodo,
 * no la flota registrada: un vehículo parado todo el trimestre no necesita
 * cobertura y contarlo bajaría el indicador sin que nadie pudiera hacer nada.
 */
export function calcularGVE(vehiculosUsados: string[], vehiculosCubiertos: string[]): Calculo {
  const cobertura = new RegistroCobertura()
  const usados = new Set(vehiculosUsados)
  const cubiertos = new Set(vehiculosCubiertos)
  cobertura.esperadoYValido(usados.size)

  if (usados.size === 0) {
    return sinDatos('Ningún vehículo operó en el periodo: no hay flota que cubrir.', cobertura.resultado())
  }

  const cubiertosEnUso = Array.from(usados).filter((v) => cubiertos.has(v))
  const descubiertos = Array.from(usados).filter((v) => !cubiertos.has(v))

  const issues: IncidenciaIndicador[] =
    descubiertos.length > 0
      ? [
          {
            code: 'VEHICULOS_SIN_PROGRAMA_VELOCIDAD',
            message: 'Vehículos que operaron sin estar cubiertos por el programa de velocidad segura.',
            count: descubiertos.length,
            actionUrl: '/dashboard/pesv?vista=plan&panel=programas',
          },
        ]
      : []

  return {
    value: porcentaje(cubiertosEnUso.length, usados.size),
    numerator: cubiertosEnUso.length,
    denominator: usados.size,
    dataCoverage: cobertura.resultado(),
    sources: [
      {
        dominio: 'pesv_program_vehicle',
        registros: cubiertos.size,
        recordIds: muestra(Array.from(cubiertos)),
        actionUrl: '/dashboard/pesv?vista=plan&panel=programas',
      },
      {
        dominio: 'operacion',
        registros: usados.size,
        recordIds: muestra(descubiertos),
        actionUrl: '/dashboard/flota',
      },
    ],
    issues,
    razonSinDatos: null,
  }
}

// ─────────────────────────────────────────────────────────────────────────
//  8. ELVL — Exceso de límites de velocidad
// ─────────────────────────────────────────────────────────────────────────

export interface EventoVelocidadInsumo {
  id: string
  servicioId: string | null
  vehiculoId: string | null
  businessDate: string
}

/**
 * Desplazamientos con al menos un exceso sobre el total de desplazamientos.
 *
 * Exige EVENTOS individuales. La tabla vieja `excesos_velocidad` guarda un total
 * mensual por conductor y vehículo: con eso no se sabe cuántos desplazamientos
 * tuvieron exceso, y repartir el total entre los viajes sería inventar los
 * eventos. Cuando solo hay serie histórica, el indicador devuelve `SIN_DATOS` y
 * el panel muestra la serie aparte, claramente etiquetada.
 *
 * Un evento sin servicio se atribuye a la clave `vehículo|fecha`: no identifica
 * el viaje exacto, pero sí un desplazamiento real de ese vehículo ese día. Los
 * que no tienen ni servicio ni vehículo se excluyen y se cuentan.
 */
export function calcularELVL(
  eventos: EventoVelocidadInsumo[],
  desplazamientos: Array<{ id: string; vehiculoId: string | null; fecha: string }>,
  hayHistoricoMensual: boolean,
): Calculo {
  const cobertura = new RegistroCobertura()

  if (desplazamientos.length === 0) {
    return sinDatos('No hay desplazamientos registrados en el periodo.', cobertura.resultado())
  }

  const clavesDesplazamiento = new Map<string, string>()
  for (const d of desplazamientos) {
    cobertura.contarEsperado()
    cobertura.contarValido()
    if (d.vehiculoId) clavesDesplazamiento.set(claveVehiculoFecha(d.vehiculoId, d.fecha), d.id)
  }

  const conExceso = new Set<string>()
  let huerfanos = 0
  for (const e of eventos) {
    if (e.servicioId) {
      conExceso.add(e.servicioId)
      continue
    }
    if (e.vehiculoId) {
      const id = clavesDesplazamiento.get(claveVehiculoFecha(e.vehiculoId, e.businessDate))
      if (id) {
        conExceso.add(id)
        continue
      }
    }
    huerfanos += 1
  }

  const issues: IncidenciaIndicador[] = []
  if (huerfanos > 0) {
    issues.push({
      code: 'EVENTOS_VELOCIDAD_SIN_DESPLAZAMIENTO',
      message:
        'Eventos de exceso que no se pudieron atribuir a ningún desplazamiento del periodo. No entran en el numerador.',
      count: huerfanos,
      actionUrl: '/dashboard/pesv?vista=operacion&panel=velocidad',
    })
  }

  if (eventos.length === 0) {
    if (hayHistoricoMensual) {
      return {
        ...sinDatos(
          'Solo existe la serie histórica de totales mensuales, que no identifica desplazamientos. Registre eventos individuales para poder calcular el indicador.',
          cobertura.resultado(),
        ),
        denominator: desplazamientos.length,
        issues,
      }
    }
    /// Sin eventos y sin histórico, cero SÍ es un cero legítimo: hubo
    /// desplazamientos y ninguno tuvo exceso registrado. Se marca la
    /// procedencia para que quien lo lea sepa que depende de la captura.
    return {
      value: 0,
      numerator: 0,
      denominator: desplazamientos.length,
      dataCoverage: cobertura.resultado(),
      sources: [
        {
          dominio: 'servicios',
          registros: desplazamientos.length,
          recordIds: muestra(desplazamientos.map((d) => d.id)),
          actionUrl: '/dashboard/servicios',
        },
      ],
      issues: issues.concat({
        code: 'SIN_EVENTOS_DE_VELOCIDAD',
        message:
          'No hay eventos de exceso registrados. Confirme que la fuente (GPS o registro manual) esté alimentando el periodo.',
        count: 0,
        actionUrl: '/dashboard/pesv?vista=operacion&panel=velocidad',
      }),
      razonSinDatos: null,
    }
  }

  return {
    value: porcentaje(conExceso.size, desplazamientos.length),
    numerator: conExceso.size,
    denominator: desplazamientos.length,
    dataCoverage: cobertura.resultado(),
    sources: [
      {
        dominio: 'pesv_speed_event',
        registros: eventos.length,
        recordIds: muestra(eventos.map((e) => e.id)),
        actionUrl: '/dashboard/pesv?vista=operacion&panel=velocidad',
      },
      {
        dominio: 'servicios',
        registros: desplazamientos.length,
        recordIds: muestra(Array.from(conExceso)),
        actionUrl: '/dashboard/servicios',
      },
    ],
    issues,
    razonSinDatos: null,
  }
}

// ─────────────────────────────────────────────────────────────────────────
//  9. IDP — Inspección diaria preoperacional
// ─────────────────────────────────────────────────────────────────────────

export interface EnvioPreoperacionalInsumo {
  id: string
  vehiculoId: string | null
  businessDate: string
  status: 'DRAFT' | 'SUBMITTED' | 'VOIDED'
  /** `true` si otro envío posterior lo sustituye. */
  sustituido: boolean
  /** `true` si su asignación está etiquetada como preoperacional PESV. */
  asignacionPesv: boolean
}

/**
 * Vehículo-fecha inspeccionado sobre vehículo-fecha trabajado.
 *
 * Cuatro reglas y todas vienen de un error concreto:
 *
 *  - Un vehículo cuenta UNA vez por día aunque tenga cuatro segmentos: sin
 *    deduplicar, el vehículo más usado hunde el porcentaje de toda la flota.
 *  - Un borrador no cuenta: el conductor lo tiene a medias en el teléfono.
 *  - Un envío anulado no cuenta, y su reemplazo válido ocupa su lugar.
 *  - Un envío de una asignación no etiquetada como preoperacional no cuenta:
 *    si contara cualquier formulario, una encuesta de clima laboral acreditaría
 *    la inspección del vehículo.
 */
export function calcularIDP(
  envios: EnvioPreoperacionalInsumo[],
  vehiculoFechaTrabajado: Array<{ vehiculoId: string; fecha: string }>,
  hayAsignacionPesv: boolean,
): Calculo {
  const cobertura = new RegistroCobertura()

  const denominador = new Set<string>()
  for (const t of vehiculoFechaTrabajado) {
    denominador.add(claveVehiculoFecha(t.vehiculoId, t.fecha))
  }

  const inspeccionados = new Set<string>()
  for (const e of envios) {
    cobertura.contarEsperado()
    if (!e.asignacionPesv) {
      cobertura.excluir('SIN_ASIGNACION_PESV', e.id)
      continue
    }
    if (e.status === 'DRAFT') {
      cobertura.excluir('BORRADOR', e.id)
      continue
    }
    if (e.status === 'VOIDED') {
      cobertura.excluir('ANULADO', e.id)
      continue
    }
    if (e.sustituido) {
      cobertura.excluir('SUSTITUIDO', e.id)
      continue
    }
    if (!e.vehiculoId) {
      cobertura.excluir('SIN_VEHICULO', e.id)
      continue
    }
    cobertura.contarValido()
    inspeccionados.add(claveVehiculoFecha(e.vehiculoId, e.businessDate))
  }

  const resultado = cobertura.resultado()

  if (!hayAsignacionPesv) {
    return {
      ...sinDatos(
        'No hay ninguna asignación de Formularios etiquetada como preoperacional PESV. Etiquete la asignación para que sus envíos acrediten la inspección.',
        resultado,
      ),
      denominator: denominador.size,
      issues: [
        {
          code: 'SIN_ASIGNACION_PREOPERACIONAL',
          message: 'Ninguna asignación tiene propósito PESV «PREOPERACIONAL».',
          count: 1,
          actionUrl: '/dashboard/formularios/asignaciones',
        },
      ],
    }
  }

  if (denominador.size === 0) {
    return sinDatos('Ningún vehículo registró operación en el periodo.', resultado)
  }

  const cubiertos = Array.from(denominador).filter((k) => inspeccionados.has(k))
  const faltantes = Array.from(denominador).filter((k) => !inspeccionados.has(k))

  const issues: IncidenciaIndicador[] = []
  if (faltantes.length > 0) {
    issues.push({
      code: 'VEHICULO_FECHA_SIN_PREOPERACIONAL',
      message: 'Días de operación de un vehículo sin inspección preoperacional entregada.',
      count: faltantes.length,
      actionUrl: '/dashboard/pesv?vista=operacion&panel=inspecciones',
    })
  }
  /// Inspecciones que no corresponden a ningún día trabajado. No suben el
  /// indicador (el numerador se cuenta sobre el denominador), pero delatan que
  /// el registro diario está incompleto.
  const sobrantes = Array.from(inspeccionados).filter((k) => !denominador.has(k)).length
  if (sobrantes > 0) {
    issues.push({
      code: 'PREOPERACIONAL_SIN_DIA_TRABAJADO',
      message:
        'Inspecciones entregadas para días en los que el vehículo no figura como trabajado. Revise el registro diario.',
      count: sobrantes,
      actionUrl: '/dashboard/nomina?vista=dias-laborados',
    })
  }

  return {
    value: porcentaje(cubiertos.length, denominador.size),
    numerator: cubiertos.length,
    denominator: denominador.size,
    dataCoverage: resultado,
    sources: [
      {
        dominio: 'form_submissions',
        registros: resultado.validos,
        recordIds: muestra(envios.map((e) => e.id)),
        actionUrl: '/dashboard/formularios/envios',
      },
      {
        dominio: 'operacion',
        registros: denominador.size,
        recordIds: [],
        actionUrl: '/dashboard/nomina?vista=dias-laborados',
      },
    ],
    issues,
    razonSinDatos: null,
  }
}

// ─────────────────────────────────────────────────────────────────────────
//  10. CPMVH — Cumplimiento del plan de mantenimiento
// ─────────────────────────────────────────────────────────────────────────

export interface MantenimientoInsumo {
  id: string
  tipo: 'PREVENTIVO' | 'CORRECTIVO' | 'PREDICTIVO'
  estado: 'PROGRAMADO' | 'EJECUTADO' | 'CANCELADO'
  fechaProgramada: string | null
  fechaEjecucion: string | null
}

/**
 * Preventivos ejecutados dentro de plazo sobre preventivos programados.
 *
 * Un preventivo ejecutado DESPUÉS de su fecha programada cuenta como ejecutado
 * pero no como oportuno: si contara, el indicador diría 100 % en una flota que
 * hace todos sus mantenimientos con dos meses de retraso.
 */
export function calcularCPMVH(eventos: MantenimientoInsumo[]): Calculo {
  const cobertura = new RegistroCobertura()
  let programados = 0
  let oportunos = 0
  let tardios = 0
  let vencidos = 0
  const idsTardios: string[] = []
  const idsVencidos: string[] = []

  for (const e of eventos) {
    cobertura.contarEsperado()
    if (e.tipo !== 'PREVENTIVO') {
      cobertura.excluir('FUERA_DE_PERIODO', e.id)
      continue
    }
    if (e.estado === 'CANCELADO') {
      cobertura.excluir('ANULADO', e.id)
      continue
    }
    if (!e.fechaProgramada) {
      cobertura.excluir('SIN_FECHA', e.id)
      continue
    }
    cobertura.contarValido()
    programados += 1

    if (e.estado !== 'EJECUTADO' || !e.fechaEjecucion) {
      vencidos += 1
      idsVencidos.push(e.id)
      continue
    }
    if (diasEntre(e.fechaProgramada, e.fechaEjecucion) <= 0) {
      oportunos += 1
    } else {
      tardios += 1
      idsTardios.push(e.id)
    }
  }

  const resultado = cobertura.resultado()
  if (programados === 0) {
    return sinDatos(
      'No hay mantenimientos preventivos programados con fecha en el periodo.',
      resultado,
    )
  }

  const issues: IncidenciaIndicador[] = []
  if (idsVencidos.length > 0) {
    issues.push({
      code: 'MANTENIMIENTOS_SIN_EJECUTAR',
      message: 'Mantenimientos preventivos programados que no se han ejecutado.',
      count: idsVencidos.length,
      actionUrl: '/dashboard/pesv?vista=operacion&panel=mantenimiento',
    })
  }
  if (idsTardios.length > 0) {
    issues.push({
      code: 'MANTENIMIENTOS_TARDIOS',
      message: 'Mantenimientos ejecutados después de su fecha programada. Cuentan como ejecutados, no como oportunos.',
      count: idsTardios.length,
      actionUrl: '/dashboard/pesv?vista=operacion&panel=mantenimiento',
    })
  }

  return {
    value: porcentaje(oportunos, programados),
    numerator: oportunos,
    denominator: programados,
    dataCoverage: resultado,
    sources: [
      {
        dominio: 'vehicle_maintenance_event',
        registros: eventos.length,
        recordIds: muestra(idsTardios.concat(idsVencidos)),
        actionUrl: '/dashboard/pesv?vista=operacion&panel=mantenimiento',
      },
    ],
    issues,
    razonSinDatos: null,
    desglose: [
      { etiqueta: 'Oportunos', valor: oportunos, unidad: 'COUNT' },
      { etiqueta: 'Tardíos', valor: tardios, unidad: 'COUNT' },
      { etiqueta: 'Sin ejecutar', valor: vencidos, unidad: 'COUNT' },
    ],
  }
}

// ─────────────────────────────────────────────────────────────────────────
//  11. CPFSV y 12. CPF — formación
// ─────────────────────────────────────────────────────────────────────────

export interface FormacionInsumo {
  id: string
  ejecutado: boolean
  fechaPlanificada: string | null
  /** Documentos distintos que asistieron, ya normalizados. */
  asistentes: string[]
}

/** Capacitaciones ejecutadas sobre programadas. */
export function calcularCPFSV(formaciones: FormacionInsumo[]): Calculo {
  const cobertura = new RegistroCobertura()
  let programadas = 0
  let ejecutadas = 0
  const pendientes: string[] = []

  for (const f of formaciones) {
    cobertura.contarEsperado()
    if (!f.fechaPlanificada) {
      cobertura.excluir('SIN_FECHA', f.id)
      continue
    }
    cobertura.contarValido()
    programadas += 1
    if (f.ejecutado) ejecutadas += 1
    else pendientes.push(f.id)
  }

  const resultado = cobertura.resultado()
  if (programadas === 0) {
    return sinDatos('No hay capacitaciones planificadas en el periodo.', resultado)
  }

  return {
    value: porcentaje(ejecutadas, programadas),
    numerator: ejecutadas,
    denominator: programadas,
    dataCoverage: resultado,
    sources: [
      {
        dominio: 'pesv_training_plan',
        registros: formaciones.length,
        recordIds: muestra(pendientes),
        actionUrl: '/dashboard/pesv?vista=plan&panel=formacion',
      },
    ],
    issues:
      pendientes.length > 0
        ? [
            {
              code: 'CAPACITACIONES_PENDIENTES',
              message: 'Capacitaciones planificadas que aún no se han ejecutado.',
              count: pendientes.length,
              actionUrl: '/dashboard/pesv?vista=plan&panel=formacion',
            },
          ]
        : [],
    razonSinDatos: null,
  }
}

/**
 * Personas distintas formadas sobre la población objetivo.
 *
 * La población va CONGELADA por periodo (`poblacionObjetivo`), no recalculada:
 * si se contara la plantilla actual, dar de alta a diez personas en diciembre
 * bajaría retroactivamente la cobertura de marzo, y un indicador que cambia
 * solo no sirve para auditar.
 */
export function calcularCPF(formaciones: FormacionInsumo[], poblacionObjetivo: number | null): Calculo {
  const cobertura = new RegistroCobertura()
  const personas = new Set<string>()

  for (const f of formaciones) {
    cobertura.contarEsperado()
    if (!f.ejecutado) {
      cobertura.excluir('FUERA_DE_PERIODO', f.id)
      continue
    }
    cobertura.contarValido()
    for (const doc of f.asistentes) personas.add(doc)
  }

  const resultado = cobertura.resultado()

  if (poblacionObjetivo == null || poblacionObjetivo <= 0) {
    return {
      ...sinDatos(
        'El periodo no tiene población objetivo congelada. Defínala en el plan de formación para poder medir la cobertura.',
        resultado,
      ),
      numerator: personas.size,
      issues: [
        {
          code: 'SIN_POBLACION_OBJETIVO',
          message: 'Ninguna formación del periodo declara población objetivo.',
          count: 1,
          actionUrl: '/dashboard/pesv?vista=plan&panel=formacion',
        },
      ],
    }
  }

  return {
    value: porcentaje(personas.size, poblacionObjetivo),
    numerator: personas.size,
    denominator: poblacionObjetivo,
    dataCoverage: resultado,
    sources: [
      {
        dominio: 'respuestas_asistencia',
        registros: personas.size,
        recordIds: [],
        actionUrl: '/dashboard/asistencias',
      },
    ],
    issues: [],
    razonSinDatos: null,
  }
}

// ─────────────────────────────────────────────────────────────────────────
//  13. NCAC — No conformidades gestionadas y cerradas
// ─────────────────────────────────────────────────────────────────────────

export interface AccionCorrectivaInsumo {
  id: string
  origenPesv: boolean
  cerrada: boolean
  /** `true` si la evaluación de eficacia dio positiva. */
  eficaz: boolean | null
}

/**
 * Hallazgos de auditoría PESV cerrados con eficacia sobre identificados.
 *
 * Solo cuentan las acciones marcadas con `origen_pesv`: si contaran todas las
 * acciones correctivas de la empresa, el indicador mediría la gestión de
 * calidad entera y no la del PESV, que es lo que la norma pide.
 *
 * Cerrar sin eficacia evaluada no suma: el cierre administrativo no es cierre.
 */
export function calcularNCAC(acciones: AccionCorrectivaInsumo[]): Calculo {
  const cobertura = new RegistroCobertura()
  let identificados = 0
  let cerradosEficaces = 0
  const abiertos: string[] = []
  const cerradosSinEficacia: string[] = []

  for (const a of acciones) {
    cobertura.contarEsperado()
    if (!a.origenPesv) {
      cobertura.excluir('FUERA_DE_PERIODO', a.id)
      continue
    }
    cobertura.contarValido()
    identificados += 1
    if (a.cerrada && a.eficaz === true) {
      cerradosEficaces += 1
    } else if (a.cerrada) {
      cerradosSinEficacia.push(a.id)
    } else {
      abiertos.push(a.id)
    }
  }

  const resultado = cobertura.resultado()
  if (identificados === 0) {
    return sinDatos(
      'No hay hallazgos de auditoría PESV registrados en el ciclo. Marque el origen PESV en las acciones que provengan de la auditoría del plan.',
      resultado,
    )
  }

  const issues: IncidenciaIndicador[] = []
  if (abiertos.length > 0) {
    issues.push({
      code: 'HALLAZGOS_ABIERTOS',
      message: 'Hallazgos de auditoría PESV todavía abiertos.',
      count: abiertos.length,
      actionUrl: '/dashboard/acciones-correctivas',
    })
  }
  if (cerradosSinEficacia.length > 0) {
    issues.push({
      code: 'CIERRE_SIN_EFICACIA',
      message: 'Hallazgos cerrados sin evaluación de eficacia aprobada. No cuentan como gestionados.',
      count: cerradosSinEficacia.length,
      actionUrl: '/dashboard/acciones-correctivas',
    })
  }

  return {
    value: porcentaje(cerradosEficaces, identificados),
    numerator: cerradosEficaces,
    denominator: identificados,
    dataCoverage: resultado,
    sources: [
      {
        dominio: 'acciones_correctivas_preventivas',
        registros: identificados,
        recordIds: muestra(abiertos.concat(cerradosSinEficacia)),
        actionUrl: '/dashboard/acciones-correctivas',
      },
    ],
    issues,
    razonSinDatos: null,
  }
}
