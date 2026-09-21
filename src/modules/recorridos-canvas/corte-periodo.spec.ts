import { describe, it, expect } from 'vitest'
import {
  cortePorDefecto,
  corteAnterior,
  corteSiguiente,
  corteDeMes,
  periodoDeCorte,
  etiquetaCorte,
  esFechaValida,
} from './corte-periodo'

describe('corte por defecto', () => {
  it('antes del día 20 sirve el corte que cierra ESTE mes', () => {
    // El 8 de septiembre se está trabajando el corte 21-ago → 20-sep.
    expect(cortePorDefecto(new Date(2026, 8, 8))).toEqual({
      desde: '2026-08-21',
      hasta: '2026-09-20',
    })
  })

  it('el día 20 todavía pertenece al corte que cierra ese día', () => {
    expect(cortePorDefecto(new Date(2026, 8, 20)).hasta).toBe('2026-09-20')
  })

  /**
   * LA GRACIA. Un corte se liquida los días siguientes a su cierre, así que
   * el 21 el canvas debe seguir abriendo el que cerró el día antes y no el
   * que empieza esa mañana, que está vacío.
   */
  it('el día del cierre + 1 sigue sirviendo el corte que acaba de cerrar', () => {
    expect(cortePorDefecto(new Date(2026, 8, 21))).toEqual({
      desde: '2026-08-21',
      hasta: '2026-09-20',
    })
  })

  it('dentro de la gracia sigue sirviendo el corte cerrado', () => {
    // 27 de septiembre: último día de la gracia (20 + 7).
    expect(cortePorDefecto(new Date(2026, 8, 27)).hasta).toBe('2026-09-20')
  })

  it('vencida la gracia pasa al corte en curso', () => {
    // 28 de septiembre: ya manda el corte que se está registrando.
    expect(cortePorDefecto(new Date(2026, 8, 28))).toEqual({
      desde: '2026-09-21',
      hasta: '2026-10-20',
    })
  })

  it('cruza el fin de año sin romperse', () => {
    // 29 de diciembre: vencida la gracia, el corte vivo cierra en enero.
    expect(cortePorDefecto(new Date(2026, 11, 29))).toEqual({
      desde: '2026-12-21',
      hasta: '2027-01-20',
    })
    // Y en enero, el corte abre en diciembre del anterior.
    expect(corteDeMes(2027, 1)).toEqual({ desde: '2026-12-21', hasta: '2027-01-20' })
  })
})

describe('periodo de un corte', () => {
  it('es el mes en que CIERRA, no en el que abre', () => {
    // Igual que en nómina: el corte 21-jul → 20-ago es «agosto». De ahí salen
    // el room de socket y la identidad de los snapshots.
    expect(periodoDeCorte({ desde: '2026-07-21', hasta: '2026-08-20' })).toEqual({
      anio: 2026,
      mes: 8,
    })
  })

  it('dos cortes distintos del mismo periodo comparten sala', () => {
    const a = periodoDeCorte({ desde: '2026-07-21', hasta: '2026-08-20' })
    const b = periodoDeCorte({ desde: '2026-07-25', hasta: '2026-08-15' })
    expect(a).toEqual(b)
  })
})

describe('etiqueta del corte', () => {
  it('omite el año repetido cuando el corte no lo cruza', () => {
    expect(etiquetaCorte({ desde: '2026-07-21', hasta: '2026-08-20' })).toBe(
      '21 Jul — 20 Ago 2026',
    )
  })

  it('escribe los dos años cuando el corte cruza el fin de año', () => {
    expect(etiquetaCorte({ desde: '2026-12-21', hasta: '2027-01-20' })).toBe(
      '21 Dic 2026 — 20 Ene 2027',
    )
  })
})

describe('validación de fechas', () => {
  it('acepta un YYYY-MM-DD real', () => {
    expect(esFechaValida('2026-08-21')).toBe(true)
  })

  it('rechaza formatos y días que no existen', () => {
    for (const v of ['', null, undefined, '21/08/2026', '2026-8-21', '2026-13-01', '2026-02-30']) {
      expect(esFechaValida(v as string)).toBe(false)
    }
  })
})

describe('navegación entre cortes', () => {
  it('el anterior y el siguiente se mueven por el mes de CIERRE', () => {
    const actual = { desde: '2026-08-21', hasta: '2026-09-20' }
    expect(corteAnterior(actual)).toEqual({ desde: '2026-07-21', hasta: '2026-08-20' })
    expect(corteSiguiente(actual)).toEqual({ desde: '2026-09-21', hasta: '2026-10-20' })
  })

  it('cruzan el año por los dos lados', () => {
    expect(corteAnterior({ desde: '2026-12-21', hasta: '2027-01-20' })).toEqual({
      desde: '2026-11-21',
      hasta: '2026-12-20',
    })
    expect(corteSiguiente({ desde: '2026-11-21', hasta: '2026-12-20' })).toEqual({
      desde: '2026-12-21',
      hasta: '2027-01-20',
    })
  })

  /**
   * Un corte a medida —dos fechas cualesquiera— no se desplaza tal cual: se
   * vuelve al 21→20 del periodo vecino. Desplazar los extremos iría torciendo
   * el rango un poco más en cada clic.
   */
  it('un corte libre vuelve al 21→20 en el primer salto', () => {
    expect(corteAnterior({ desde: '2026-09-03', hasta: '2026-09-14' })).toEqual({
      desde: '2026-07-21',
      hasta: '2026-08-20',
    })
  })

  it('ida y vuelta deja el mismo corte', () => {
    const actual = { desde: '2026-08-21', hasta: '2026-09-20' }
    expect(corteSiguiente(corteAnterior(actual))).toEqual(actual)
  })
})
