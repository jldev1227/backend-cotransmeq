/**
 * Un corte de nómina que cruza un cambio de vigencia se valora por día.
 *
 * EL FALLO
 *
 * El canvas resolvía las tarifas UNA sola vez, con lo vigente al CIERRE del
 * corte, y las aplicaba a los treinta días. Como el corte va del 21 de un mes
 * al 20 del siguiente, cruza cualquier cambio que entre a mitad de mes — y el
 * de la Ley 2466 (15-jul-2026) lo hace.
 *
 * Ese día cambiaron dos cosas a la vez:
 *   · los porcentajes de RD (80→90), HEFD (105→115), HEFN (155→165) y
 *     RNDF (115→125);
 *   · `horas_mensuales_base`, 220 → 210, que es el DIVISOR del valor hora.
 *
 * Lo segundo es lo que se pasaba por alto: al cambiar el divisor, el valor
 * hora sube de 7.958,66 a 8.337,64 y TODOS los códigos valen distinto,
 * también RN, HED y HEN, que no tocaron su porcentaje. En el corte de julio
 * de 2026 eso infló la hoja de un conductor en 97.408 pesos.
 *
 * Las cifras de abajo son las de producción: `configuraciones_salarios` y
 * `tipos_recargos` tal y como están guardadas, y `detalles_recargos_dias`
 * —que sí guarda bien el valor de cada día— como referencia de lo correcto.
 */

import { describe, expect, it } from 'vitest'
import { vigenteEn, tramosPorClave, instanteDeConsulta } from './vigencias'
import { diasDelPeriodo, textoRangoFechas } from './periodo'

/** Las dos filas de `configuraciones_salarios` generales, tal cual. */
const CONFIGS = [
  {
    id: 'vieja',
    salario_basico: 1750905,
    horas_mensuales_base: 220,
    vigencia_desde: '2025-01-01T00:00:00.000-05:00',
    vigencia_hasta: '2026-07-14T18:59:59.999-05:00',
  },
  {
    id: 'nueva',
    salario_basico: 1750905,
    horas_mensuales_base: 210,
    vigencia_desde: '2026-07-14T19:00:00.000-05:00',
    vigencia_hasta: null,
  },
]

/** Las dos filas de `tipos_recargos` del recargo dominical/festivo. */
const RD = [
  { porcentaje: 80, vigencia_desde: '2024-12-31T19:00:00.000-05:00', vigencia_hasta: '2026-07-14T18:59:59.999-05:00' },
  { porcentaje: 90, vigencia_desde: '2026-07-14T19:00:00.000-05:00', vigencia_hasta: null },
]

const valorHora = (c: (typeof CONFIGS)[number]) => c.salario_basico / c.horas_mensuales_base
/** RD es «all-in»: base + %. La misma regla que `valorHoraDeRecargo`. */
const tarifaRD = (c: (typeof CONFIGS)[number], pct: number) => valorHora(c) * (1 + pct / 100)

describe('vigenteEn', () => {
  it('el 14 de julio de 2026 todavía es la vigencia vieja', () => {
    expect(vigenteEn(CONFIGS, '2026-07-14')?.id).toBe('vieja')
    expect(vigenteEn(RD, '2026-07-14')?.porcentaje).toBe(80)
  })

  it('el 15 de julio de 2026 ya es la nueva', () => {
    expect(vigenteEn(CONFIGS, '2026-07-15')?.id).toBe('nueva')
    expect(vigenteEn(RD, '2026-07-15')?.porcentaje).toBe(90)
  })

  it('los días de junio resuelven a la vigencia vieja, no a la del cierre', () => {
    // Es EL fallo: el 21 de junio caía dentro de un corte cuyo cierre es el
    // 20 de julio, y se le aplicaba la tarifa del 20 de julio.
    for (const d of ['2026-06-21', '2026-06-25', '2026-06-30']) {
      expect(vigenteEn(CONFIGS, d)?.horas_mensuales_base).toBe(220)
      expect(vigenteEn(RD, d)?.porcentaje).toBe(80)
    }
  })

  it('devuelve null cuando ninguna fila cubre la fecha', () => {
    expect(vigenteEn(CONFIGS, '2020-01-01')).toBeNull()
  })

  it('no depende del orden de las filas', () => {
    expect(vigenteEn([...CONFIGS].reverse(), '2026-07-15')?.id).toBe('nueva')
  })

  it('consulta a mediodía UTC, que cae dentro del día colombiano', () => {
    // 12:00Z son las 07:00 en Bogotá: ni el primer ni el último instante del
    // día, que es lo que hace que el borde de las 19:00-05 caiga del lado
    // correcto.
    expect(instanteDeConsulta('2026-07-15').toISOString()).toBe('2026-07-15T12:00:00.000Z')
  })
})

describe('tramos del corte', () => {
  const fechas = diasDelPeriodo(2026, 7, 21).map((d) => d.fecha)
  const clave = (f: string) => `${vigenteEn(CONFIGS, f)?.id}|${vigenteEn(RD, f)?.porcentaje}`

  it('el corte 21-jun → 20-jul de 2026 se parte en dos', () => {
    const tramos = tramosPorClave(fechas, clave)
    expect(tramos).toHaveLength(2)
    expect(tramos[0].desde).toBe('2026-06-21')
    expect(tramos[0].hasta).toBe('2026-07-14')
    expect(tramos[1].desde).toBe('2026-07-15')
    expect(tramos[1].hasta).toBe('2026-07-20')
  })

  it('un corte que no cruza ningún cambio da un solo tramo', () => {
    const agosto = diasDelPeriodo(2026, 8, 21).map((d) => d.fecha)
    expect(tramosPorClave(agosto, clave)).toHaveLength(1)
  })

  it('los tramos cubren el corte entero sin huecos ni solapes', () => {
    const tramos = tramosPorClave(fechas, clave)
    expect(tramos.flatMap((t) => t.fechas)).toEqual(fechas)
  })

  it('rotula cada tramo como el Excel', () => {
    const tramos = tramosPorClave(fechas, clave)
    expect(textoRangoFechas(tramos[0].desde, tramos[0].hasta)).toBe(
      '21 DE JUNIO AL 14 DE JULIO DE 2026',
    )
    expect(textoRangoFechas(tramos[1].desde, tramos[1].hasta)).toBe('15 AL 20 DE JULIO DE 2026')
  })
})

describe('el dinero que salía de más', () => {
  // Contrastado contra `detalles_recargos_dias`, que sí guarda el valor de
  // cada día: el 21-jun-2026 tiene `valor_hora_calculado = 14325.5864` y
  // `valor_calculado = 105007` para 7,33 h de RD.
  const cierre = vigenteEn(CONFIGS, '2026-07-20')!
  const junio = vigenteEn(CONFIGS, '2026-06-21')!

  it('la tarifa del día es la que tiene guardada la planilla', () => {
    const pct = vigenteEn(RD, '2026-06-21')!.porcentaje
    expect(tarifaRD(junio, pct)).toBeCloseTo(14325.5864, 3)
    expect(Math.round(7.33 * tarifaRD(junio, pct))).toBe(105007)
  })

  it('usar la tarifa del cierre infla el mismo día en 11.111 pesos', () => {
    const conCierre = Math.round(7.33 * tarifaRD(cierre, vigenteEn(RD, '2026-07-20')!.porcentaje))
    const correcto = Math.round(7.33 * tarifaRD(junio, vigenteEn(RD, '2026-06-21')!.porcentaje))
    expect(conCierre).toBe(116118) // lo que se venía pagando
    expect(conCierre - correcto).toBe(11111)
  })

  it('el valor hora cambia aunque el porcentaje no: 220 h → 210 h', () => {
    // Por esto RN, HED y HEN también salían caros pese a no tocar su %.
    expect(valorHora(junio)).toBeCloseTo(7958.6591, 3)
    expect(valorHora(cierre)).toBeCloseTo(8337.6429, 3)
    // RN es recargo puro: valorHora × 35 %.
    expect(Math.round(valorHora(junio) * 0.35 * 100) / 100).toBeCloseTo(2785.53, 2)
    expect(Math.round(valorHora(cierre) * 0.35 * 100) / 100).toBeCloseTo(2918.18, 2)
  })
})
