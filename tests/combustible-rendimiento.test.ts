/**
 * Rendimiento de combustible y validaciones del tanqueo, sin base de datos.
 *
 * Fija el método de llenado a llenado (los parciales suman galones al tramo
 * que cierra el siguiente lleno), la referencia de las alertas (tramos
 * PREVIOS, nunca el propio) y las reglas que rechazan un tanqueo antes de
 * guardarlo: odómetro que retrocede, galones o valor en cero.
 */
import { describe, expect, it } from 'vitest'
import {
  MINIMO_TRAMOS_REFERENCIA,
  UMBRAL_ANOMALIA,
  VENTANA_PROMEDIO,
  calcularTramos,
  rendimientoPonderado,
  validarKilometraje,
  type TanqueoMedible,
} from '../src/modules/combustible/rendimiento'
import { aInstante, filtrosSchema, rangoBogota, tanqueoSchema } from '../src/modules/combustible/combustible.schema'

let n = 0
/** Tanqueo de prueba: un día después del anterior, a 10.000 $/gal. */
function t(km: number, galones: number, lleno = true, dia?: number): TanqueoMedible {
  n++
  return {
    id: `t${n}`,
    fecha_hora: new Date(Date.UTC(2026, 0, dia ?? n, 15)).toISOString(),
    kilometraje: km,
    galones,
    valor_total: galones * 10_000,
    tanque_lleno: lleno,
  }
}

describe('calcularTramos — llenado a llenado', () => {
  it('mide entre dos llenos consecutivos y atribuye el tramo al que lo cierra', () => {
    const a = t(10_000, 40)
    const b = t(10_500, 25)
    const [tramo, ...resto] = calcularTramos([a, b])
    expect(resto).toHaveLength(0)
    expect(tramo.desde_id).toBe(a.id)
    expect(tramo.hasta_id).toBe(b.id)
    expect(tramo.km_recorridos).toBe(500)
    expect(tramo.galones).toBe(25)
    expect(tramo.rendimiento).toBe(20)
    expect(tramo.valor).toBe(250_000)
  })

  it('suma los galones de los parciales al tramo del siguiente lleno', () => {
    const tramos = calcularTramos([t(10_000, 40), t(10_200, 8, false), t(10_350, 5, false), t(10_600, 17)])
    expect(tramos).toHaveLength(1)
    expect(tramos[0].km_recorridos).toBe(600)
    expect(tramos[0].galones).toBe(30)
    expect(tramos[0].rendimiento).toBe(20)
  })

  it('no mide lo anterior al primer lleno (no hay punto de partida)', () => {
    const tramos = calcularTramos([t(9_800, 10, false), t(10_000, 30), t(10_400, 20)])
    expect(tramos).toHaveLength(1)
    expect(tramos[0].km_recorridos).toBe(400)
    expect(tramos[0].galones).toBe(20)
  })

  it('un parcial al final queda pendiente: no inventa un tramo', () => {
    expect(calcularTramos([t(10_000, 40), t(10_300, 10, false)])).toHaveLength(0)
  })

  it('ordena por fecha aunque lleguen desordenados (un tanqueo registrado tarde)', () => {
    const a = t(10_000, 40, true, 1)
    const b = t(10_500, 25, true, 3)
    const tarde = t(10_250, 10, false, 2)
    const tramos = calcularTramos([b, tarde, a])
    expect(tramos).toHaveLength(1)
    expect(tramos[0].galones).toBe(35)
    expect(tramos[0].km_recorridos).toBe(500)
  })

  it('descarta un tramo sin recorrido y toma el lleno nuevo como partida', () => {
    const tramos = calcularTramos([t(10_000, 40), t(10_000, 2), t(10_400, 20)])
    expect(tramos).toHaveLength(1)
    expect(tramos[0].km_recorridos).toBe(400)
    expect(tramos[0].galones).toBe(20)
  })
})

describe('calcularTramos — alertas de rendimiento', () => {
  /// Serie de llenos a 20 km/gal (400 km con 20 gal cada uno) y al final uno
  /// con el rendimiento pedido.
  function serie(tramosNormales: number, ultimoRendimiento: number) {
    const lista: TanqueoMedible[] = [t(10_000, 40)]
    let km = 10_000
    for (let i = 0; i < tramosNormales; i++) {
      km += 400
      lista.push(t(km, 20))
    }
    km += 400
    lista.push(t(km, 400 / ultimoRendimiento))
    return calcularTramos(lista)
  }

  it(`alerta por debajo del ${UMBRAL_ANOMALIA * 100} % de la referencia`, () => {
    const tramos = serie(5, 13) // 65 % de 20
    const ultimo = tramos.at(-1)!
    expect(ultimo.referencia).toBeCloseTo(20)
    expect(ultimo.anomalo).toBe(true)
    expect(ultimo.desviacion).toBeCloseTo(-0.35)
  })

  it('no alerta por encima del umbral', () => {
    expect(serie(5, 16).at(-1)!.anomalo).toBe(false) // 80 %
    expect(serie(5, 21).at(-1)!.anomalo).toBe(false)
  })

  it(`sin ${MINIMO_TRAMOS_REFERENCIA} tramos previos no hay referencia ni alerta`, () => {
    const ultimo = serie(MINIMO_TRAMOS_REFERENCIA - 1, 5).at(-1)!
    expect(ultimo.referencia).toBeNull()
    expect(ultimo.anomalo).toBe(false)
  })

  it(`la referencia son los últimos ${VENTANA_PROMEDIO} tramos previos, sin el propio`, () => {
    /// Tres tramos viejos a 10 km/gal y cinco recientes a 20: si la ventana
    /// mirara más atrás, la referencia bajaría y el tramo de 14 no alertaría.
    const lista: TanqueoMedible[] = [t(10_000, 40)]
    let km = 10_000
    for (let i = 0; i < 3; i++) lista.push(t((km += 400), 40))
    for (let i = 0; i < 5; i++) lista.push(t((km += 400), 20))
    lista.push(t((km += 400), 400 / 14))
    const ultimo = calcularTramos(lista).at(-1)!
    expect(ultimo.referencia).toBeCloseTo(20)
    expect(ultimo.anomalo).toBe(true)
  })

  it('un tramo malo no tapa al siguiente igual de malo… mientras no domine la ventana', () => {
    const lista: TanqueoMedible[] = [t(10_000, 40)]
    let km = 10_000
    for (let i = 0; i < 5; i++) lista.push(t((km += 400), 20))
    lista.push(t((km += 400), 40)) // 10 km/gal
    lista.push(t((km += 400), 40)) // otra vez 10
    const tramos = calcularTramos(lista)
    expect(tramos.at(-2)!.anomalo).toBe(true)
    expect(tramos.at(-1)!.anomalo).toBe(true)
  })
})

describe('rendimientoPonderado', () => {
  it('pondera por galones, no promedia cocientes', () => {
    /// 40 km con 1 gal (40) y 600 km con 50 gal (12): el promedio simple daría 26.
    expect(rendimientoPonderado([{ km_recorridos: 40, galones: 1 }, { km_recorridos: 600, galones: 50 }])).toBeCloseTo(640 / 51)
  })
  it('sin tramos no hay rendimiento', () => {
    expect(rendimientoPonderado([])).toBeNull()
  })
})

describe('validarKilometraje', () => {
  const anterior = { fecha_hora: '2026-10-01T15:00:00Z', kilometraje: 45_320 }
  const siguiente = { fecha_hora: '2026-10-08T15:00:00Z', kilometraje: 46_100 }

  it('rechaza el odómetro que retrocede respecto al tanqueo anterior', () => {
    const e = validarKilometraje(45_000, { anterior, siguiente: null })
    expect(e?.codigo).toBe('KM_RETROCEDE')
    expect(e?.mensaje).toContain('45.320')
  })
  it('rechaza el registrado tarde que supera al tanqueo siguiente', () => {
    expect(validarKilometraje(46_500, { anterior, siguiente })?.codigo).toBe('KM_SUPERA_SIGUIENTE')
  })
  it('acepta el igual al anterior y el que queda en medio', () => {
    expect(validarKilometraje(45_320, { anterior, siguiente })).toBeNull()
    expect(validarKilometraje(45_800, { anterior, siguiente })).toBeNull()
  })
  it('el primer tanqueo del vehículo no tiene con qué compararse', () => {
    expect(validarKilometraje(0, { anterior: null, siguiente: null })).toBeNull()
  })
})

describe('tanqueoSchema', () => {
  const valido = {
    vehiculo_id: '6f1c2c1e-1a2b-4c3d-8e9f-0a1b2c3d4e5f',
    fecha_hora: '2026-10-01T08:30',
    kilometraje: 45_320,
    galones: 12.5,
    valor_total: 200_000,
    tipo_combustible: 'DIESEL',
    tanque_lleno: true,
  }

  it('acepta un tanqueo completo y vacía los textos opcionales', () => {
    const r = tanqueoSchema.parse({ ...valido, estacion: '  ', medio_pago: '', conductor_id: '' })
    expect(r.estacion).toBeNull()
    expect(r.medio_pago).toBeNull()
    expect(r.conductor_id).toBeNull()
  })
  it('rechaza galones en cero', () => {
    expect(tanqueoSchema.safeParse({ ...valido, galones: 0 }).success).toBe(false)
  })
  it('rechaza valor en cero', () => {
    expect(tanqueoSchema.safeParse({ ...valido, valor_total: 0 }).success).toBe(false)
  })
  it('rechaza odómetro negativo o con decimales', () => {
    expect(tanqueoSchema.safeParse({ ...valido, kilometraje: -1 }).success).toBe(false)
    expect(tanqueoSchema.safeParse({ ...valido, kilometraje: 100.5 }).success).toBe(false)
  })
  it('rechaza una fecha futura', () => {
    const futuro = new Date(Date.now() + 3 * 86_400_000).toISOString()
    expect(tanqueoSchema.safeParse({ ...valido, fecha_hora: futuro }).success).toBe(false)
  })
  it('rechaza un combustible que no se mide en galones', () => {
    expect(tanqueoSchema.safeParse({ ...valido, tipo_combustible: 'ELÉCTRICO' }).success).toBe(false)
  })
})

describe('fechas en hora de Colombia', () => {
  it('un datetime-local sin zona se lee en Bogotá, no en la zona del servidor', () => {
    expect(aInstante('2026-10-01T20:30')?.toISOString()).toBe('2026-10-02T01:30:00.000Z')
  })
  it('el rango de días incluye el último día completo', () => {
    const { gte, lt } = rangoBogota('2026-10-01', '2026-10-31')
    expect(gte?.toISOString()).toBe('2026-10-01T05:00:00.000Z')
    expect(lt?.toISOString()).toBe('2026-11-01T05:00:00.000Z')
  })
  it('los filtros toman valores por defecto de paginación', () => {
    const f = filtrosSchema.parse({ desde: '', solo_alertas: '1' })
    expect(f.desde).toBeNull()
    expect(f.solo_alertas).toBe(true)
    expect(f.pagina).toBe(1)
  })
})
