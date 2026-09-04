/**
 * Ensamblador de indicadores.
 *
 * Junta tres piezas que se mantienen separadas a propósito:
 *
 *   repositorio.ts  → lee (habla con Prisma)
 *   calculadores.ts → decide (puro, probado sin base)
 *   este archivo    → viste el resultado con meta, semáforo y tendencia
 *
 * La tendencia se calcula ejecutando los mismos calculadores sobre el período
 * anterior. Es el doble de consultas, y aun así se prefiere a guardar un
 * histórico de resultados: un snapshot almacenado se queda obsoleto en cuanto
 * alguien corrige un dato de origen, y entonces la flecha de tendencia miente
 * hasta el siguiente recálculo sin que nada lo delate.
 */

import { prisma } from '../../../config/prisma'
import { fusionarCoberturas } from '../dominio/calidad'
import { construirPeriodo, periodoAnterior, type Periodo } from '../dominio/periodos'
import {
  calcularCMP,
  calcularCPF,
  calcularCPFSV,
  calcularCPLAN,
  calcularCPMVH,
  calcularCSV,
  calcularEJLC,
  calcularELVL,
  calcularGRV,
  calcularGVE,
  calcularIDP,
  calcularNCAC,
  calcularRSVI,
  calcularTSV,
  type Calculo,
} from './calculadores'
import { leerInsumos, type InsumosIndicadores } from './repositorio'
import {
  CODIGOS_INDICADOR,
  FICHAS,
  calcularTendencia,
  evaluarSemaforo,
  type CodigoIndicador,
  type MetaIndicador,
  type ResultadoIndicador,
} from './tipos'

export * from './tipos'
export { leerInsumos } from './repositorio'

/** Aplica los 13 calculadores sobre un juego de insumos ya leído. */
export function calcularTodos(insumos: InsumosIndicadores): Record<CodigoIndicador, Calculo> {
  return {
    TSV: calcularTSV(insumos.siniestros, insumos.tramos),
    CSV: calcularCSV(insumos.siniestros),
    RSVI: calcularRSVI(insumos.riesgos),
    GRV: calcularGRV(insumos.riesgos),
    CMP: calcularCMP(insumos.metas),
    CPLAN: calcularCPLAN(insumos.actividades),
    EJLC: calcularEJLC(insumos.dias, insumos.politicasJornada),
    GVE: calcularGVE(insumos.vehiculosUsados, insumos.vehiculosCubiertosVelocidad),
    ELVL: calcularELVL(
      insumos.eventosVelocidad,
      insumos.desplazamientos,
      insumos.hayHistoricoVelocidadMensual,
    ),
    IDP: calcularIDP(
      insumos.enviosPreoperacionales,
      insumos.vehiculoFechaTrabajado,
      insumos.hayAsignacionPreoperacional,
    ),
    CPMVH: calcularCPMVH(insumos.mantenimientos),
    CPFSV: calcularCPFSV(insumos.formaciones),
    CPF: calcularCPF(insumos.formaciones, insumos.poblacionObjetivo),
    NCAC: calcularNCAC(insumos.acciones),
  }
}

/**
 * Metas del ciclo indexadas por código de indicador.
 *
 * Solo cuentan las metas que declaran `indicador_codigo`: una meta de gestión
 * («capacitar a todo el personal nuevo») no es la meta de un indicador y
 * asociarla por parecido de nombre pondría un umbral que nadie aprobó.
 */
export async function leerMetas(cicloId: string | null): Promise<Partial<Record<CodigoIndicador, MetaIndicador>>> {
  if (!cicloId) return {}
  const filas = await prisma.pesv_goal.findMany({
    where: { deleted_at: null, cycle_id: cicloId, indicador_codigo: { not: null } },
    select: { indicador_codigo: true, valor_meta: true, sentido: true, umbral_alerta: true },
  })

  const metas: Partial<Record<CodigoIndicador, MetaIndicador>> = {}
  for (const f of filas) {
    const codigo = f.indicador_codigo as CodigoIndicador
    if (!CODIGOS_INDICADOR.includes(codigo)) continue
    metas[codigo] = {
      valor: f.valor_meta == null ? null : Number(f.valor_meta),
      sentido: f.sentido,
      umbralAlerta: f.umbral_alerta == null ? null : Number(f.umbral_alerta),
    }
  }
  return metas
}

export interface OpcionesIndicadores {
  /** Si es `false`, no consulta el período anterior. El overview lo desactiva
   *  cuando solo necesita el estado, para no duplicar catorce consultas. */
  conTendencia?: boolean
  /** Filtra a estos códigos. Vacío o ausente = los trece. */
  codigos?: CodigoIndicador[]
}

/**
 * Los indicadores del período, listos para la API.
 *
 * `calculadoAt` es único para toda la respuesta: si cada indicador llevara su
 * propio instante, dos tarjetas de la misma pantalla podrían decir que se
 * calcularon con segundos de diferencia y nadie sabría cuál es la foto buena.
 */
export async function calcularIndicadores(
  cicloId: string | null,
  periodo: Periodo,
  opciones: OpcionesIndicadores = {},
): Promise<ResultadoIndicador[]> {
  const conTendencia = opciones.conTendencia !== false
  const anterior = periodoAnterior(periodo)

  const [insumos, metas, insumosAnterior] = await Promise.all([
    leerInsumos(cicloId, periodo),
    leerMetas(cicloId),
    conTendencia ? leerInsumos(cicloId, anterior) : Promise.resolve(null),
  ])

  const calculos = calcularTodos(insumos)
  const calculosAnterior = insumosAnterior ? calcularTodos(insumosAnterior) : null
  const calculadoAt = new Date().toISOString()

  const codigos =
    opciones.codigos && opciones.codigos.length > 0 ? opciones.codigos : [...CODIGOS_INDICADOR]

  return codigos.map((codigo) =>
    ensamblar(codigo, calculos[codigo], calculosAnterior?.[codigo]?.value ?? null, metas[codigo] ?? null, periodo, calculadoAt),
  )
}

function ensamblar(
  codigo: CodigoIndicador,
  calculo: Calculo,
  valorAnterior: number | null,
  meta: MetaIndicador | null,
  periodo: Periodo,
  calculadoAt: string,
): ResultadoIndicador {
  const ficha = FICHAS[codigo]
  /// El sentido de la meta manda sobre el de la ficha: HSEQ puede decidir que
  /// un indicador se persigue al revés en un ciclo concreto, y la tendencia
  /// tiene que interpretarse con el criterio que esté vigente.
  const sentido = meta?.sentido ?? ficha.sentido
  const { status, razon } = evaluarSemaforo(calculo.value, meta)

  return {
    code: codigo,
    nombre: ficha.nombre,
    descripcion: ficha.descripcion,
    frecuencia: ficha.frecuencia,
    periodo: {
      granularidad: periodo.granularidad,
      anio: periodo.anio,
      ...(periodo.trimestre != null ? { trimestre: periodo.trimestre } : {}),
      ...(periodo.mes != null ? { mes: periodo.mes } : {}),
      desde: periodo.desde,
      hasta: periodo.hasta,
      etiqueta: periodo.etiqueta,
    },
    status,
    value: calculo.value,
    unit: ficha.unit,
    numerator: calculo.numerator,
    denominator: calculo.denominator,
    formula: ficha.formula,
    target: meta?.valor ?? null,
    sentido,
    tendencia: calcularTendencia(calculo.value, valorAnterior, sentido),
    dataCoverage: calculo.dataCoverage,
    sources: calculo.sources,
    issues: calculo.issues,
    /// `razonSinDatos` del calculador gana sobre la del semáforo: «no hay
    /// kilómetros válidos» explica más que «no hay meta aprobada», y el usuario
    /// necesita saber qué arreglar primero.
    razonSinDatos: calculo.razonSinDatos ?? razon,
    calculadoAt,
    ...(calculo.desglose ? { desglose: calculo.desglose } : {}),
  }
}

/** Cobertura agregada de todos los indicadores, para la cabecera del panel. */
export function coberturaGlobal(resultados: ResultadoIndicador[]) {
  return fusionarCoberturas(...resultados.map((r) => r.dataCoverage))
}

/** Atajo: los indicadores del año en curso del ciclo dado. */
export async function indicadoresDelAnio(cicloId: string | null, anio: number) {
  return calcularIndicadores(cicloId, construirPeriodo(anio, null, null))
}
