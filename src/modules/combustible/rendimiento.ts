/**
 * Rendimiento de combustible (km por galón), sin base de datos.
 *
 * Método de LLENADO A LLENADO, el estándar de las flotas: solo cuando el
 * tanque queda lleno se sabe cuánto combustible se gastó desde el llenado
 * anterior, porque lo que entra para volver a llenarlo ES lo consumido. Entre
 * dos llenos consecutivos:
 *
 *   rendimiento = (km del lleno actual − km del lleno anterior)
 *                 / (galones de TODOS los tanqueos posteriores al lleno anterior,
 *                    incluidos los parciales y el lleno actual)
 *
 * Por qué no tanqueo a tanqueo: un tanqueo parcial no dice cuánto quedaba en
 * el tanque. Dividir los km desde el tanqueo anterior entre los galones de un
 * parcial daba rendimientos absurdos —altísimos si se echaron 3 galones,
 * bajísimos si se echaron 30— y esas cifras eran justo las que disparaban las
 * alertas. Los parciales no se pierden: sus galones se suman al tramo que
 * cierra el siguiente lleno.
 *
 * Lo que va antes del PRIMER lleno de un vehículo no se puede medir (no hay
 * punto de partida conocido) y queda fuera de los tramos.
 */

/// Una alerta salta cuando el tramo rinde menos del 75 % de lo habitual en el
/// vehículo. Con el 90 % sonaba con cualquier cambio de ruta (trocha contra
/// pavimento, carga, aire acondicionado mueven el consumo 10–20 %); por debajo
/// del 75 % la causa suele ser otra: fuga, robo de combustible, un tanqueo
/// mal registrado o un problema mecánico. Es lo que vale la pena revisar.
export const UMBRAL_ANOMALIA = 0.75

/// «Lo habitual» son los últimos 5 tramos del mismo vehículo ANTERIORES al que
/// se evalúa. El tramo no entra en su propia referencia: si entrara, un
/// rendimiento muy bajo arrastraría el promedio hacia abajo y se taparía a sí
/// mismo. Cinco tramos son unas dos o tres semanas de operación normal:
/// suficiente para absorber una ruta rara y lo bastante reciente para seguir
/// al vehículo si cambia de operación.
export const VENTANA_PROMEDIO = 5

/// Con menos de 3 tramos previos no hay referencia fiable y no se alerta: con
/// uno solo, cualquier diferencia de ruta parecería anomalía.
export const MINIMO_TRAMOS_REFERENCIA = 3

export interface TanqueoMedible {
  id: string
  /** Instante del tanqueo (ISO o milisegundos). */
  fecha_hora: string | number | Date
  kilometraje: number
  galones: number
  valor_total: number
  tanque_lleno: boolean
}

/** Tramo entre dos llenos consecutivos; se atribuye al lleno que lo cierra. */
export interface Tramo {
  /** Tanqueo (lleno) que cierra el tramo. */
  hasta_id: string
  /** Lleno anterior, donde empieza el tramo. */
  desde_id: string
  km_recorridos: number
  /** Galones de los tanqueos posteriores al lleno anterior, este incluido. */
  galones: number
  /** Lo pagado por esos galones: da el costo por km del tramo. */
  valor: number
  rendimiento: number
  /** Rendimiento de referencia (últimos tramos previos), si lo hay. */
  referencia: number | null
  /** `rendimiento / referencia` − 1, en fracción (−0,3 = 30 % por debajo). */
  desviacion: number | null
  anomalo: boolean
}

const instante = (f: TanqueoMedible['fecha_hora']) => (f instanceof Date ? f.getTime() : new Date(f).getTime())

/**
 * Orden cronológico. A igual instante manda el odómetro: dos registros con la
 * misma hora (uno digitado sin minutos, por ejemplo) quedan en el orden en que
 * se recorrieron.
 */
export function ordenarTanqueos<T extends TanqueoMedible>(tanqueos: readonly T[]): T[] {
  return [...tanqueos].sort((a, b) => instante(a.fecha_hora) - instante(b.fecha_hora) || a.kilometraje - b.kilometraje)
}

/** Rendimiento ponderado de un conjunto de tramos: km totales / galones totales. */
export function rendimientoPonderado(tramos: readonly Pick<Tramo, 'km_recorridos' | 'galones'>[]): number | null {
  let km = 0
  let gal = 0
  for (const t of tramos) {
    km += t.km_recorridos
    gal += t.galones
  }
  /// Ponderado y no promedio de cocientes: un tramo de 40 km con 2 galones no
  /// debe pesar lo mismo que uno de 600 km con 45 galones.
  return gal > 0 ? km / gal : null
}

/**
 * Tramos de UN vehículo. Recibe su historial completo (no solo el periodo
 * consultado): el tramo que cierra el primer lleno del periodo empieza en un
 * lleno anterior, y la referencia mira los tramos previos.
 */
export function calcularTramos(tanqueos: readonly TanqueoMedible[]): Tramo[] {
  const tramos: Tramo[] = []
  let llenoAnterior: TanqueoMedible | null = null
  let galones = 0
  let valor = 0

  for (const t of ordenarTanqueos(tanqueos)) {
    if (!llenoAnterior) {
      if (t.tanque_lleno) llenoAnterior = t
      continue
    }
    galones += t.galones
    valor += t.valor_total
    if (!t.tanque_lleno) continue

    const km = t.kilometraje - llenoAnterior.kilometraje
    /// Un tramo sin recorrido (dos llenos al mismo odómetro) no mide nada: se
    /// descarta y el lleno nuevo pasa a ser el punto de partida.
    if (km > 0 && galones > 0) {
      tramos.push({
        hasta_id: t.id,
        desde_id: llenoAnterior.id,
        km_recorridos: km,
        galones,
        valor,
        rendimiento: km / galones,
        referencia: null,
        desviacion: null,
        anomalo: false,
      })
    }
    llenoAnterior = t
    galones = 0
    valor = 0
  }

  for (let i = 0; i < tramos.length; i++) {
    const previos = tramos.slice(Math.max(0, i - VENTANA_PROMEDIO), i)
    if (previos.length < MINIMO_TRAMOS_REFERENCIA) continue
    const referencia = rendimientoPonderado(previos)
    if (!referencia) continue
    const tramo = tramos[i]
    tramo.referencia = referencia
    tramo.desviacion = tramo.rendimiento / referencia - 1
    tramo.anomalo = tramo.rendimiento < referencia * UMBRAL_ANOMALIA
  }

  return tramos
}

/** Vecinos de un tanqueo en el historial del vehículo, para validar el odómetro. */
export interface VecinosKm {
  anterior: { fecha_hora: string | Date; kilometraje: number } | null
  siguiente: { fecha_hora: string | Date; kilometraje: number } | null
}

export type ErrorKm = { codigo: 'KM_RETROCEDE' | 'KM_SUPERA_SIGUIENTE'; mensaje: string }

const fmtKm = (n: number) => n.toLocaleString('es-CO')
const fmtFecha = (f: string | Date) =>
  new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: '2-digit', year: 'numeric' }).format(
    f instanceof Date ? f : new Date(f),
  )

/**
 * El odómetro no retrocede. Se compara contra el tanqueo inmediatamente
 * anterior Y contra el siguiente: al registrar uno atrasado (la factura que
 * apareció días después) el que manda es el que queda en medio.
 *
 * Igual al anterior se acepta: dos tanqueos sin mover el vehículo son raros
 * pero posibles (un lleno que se completa en dos bombas).
 */
export function validarKilometraje(km: number, vecinos: VecinosKm): ErrorKm | null {
  if (vecinos.anterior && km < vecinos.anterior.kilometraje) {
    return {
      codigo: 'KM_RETROCEDE',
      mensaje: `El odómetro (${fmtKm(km)} km) es menor que el del tanqueo anterior del ${fmtFecha(vecinos.anterior.fecha_hora)} (${fmtKm(vecinos.anterior.kilometraje)} km).`,
    }
  }
  if (vecinos.siguiente && km > vecinos.siguiente.kilometraje) {
    return {
      codigo: 'KM_SUPERA_SIGUIENTE',
      mensaje: `El odómetro (${fmtKm(km)} km) es mayor que el del tanqueo siguiente del ${fmtFecha(vecinos.siguiente.fecha_hora)} (${fmtKm(vecinos.siguiente.kilometraje)} km). Revisa la fecha o el kilometraje.`,
    }
  }
  return null
}
