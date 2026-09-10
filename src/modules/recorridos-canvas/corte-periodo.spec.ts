import { describe, it, expect } from 'vitest'
import {
  cortePorDefecto,
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

  it('pasado el día 20 salta al corte siguiente', () => {
    // El 25 de septiembre ya se llena el corte que cierra en octubre.
    expect(cortePorDefecto(new Date(2026, 8, 25))).toEqual({
      desde: '2026-09-21',
      hasta: '2026-10-20',
    })
  })

  it('el día 20 todavía pertenece al corte que cierra ese día', () => {
    expect(cortePorDefecto(new Date(2026, 8, 20)).hasta).toBe('2026-09-20')
  })

  it('cruza el fin de año sin romperse', () => {
    // 25 de diciembre: el corte vivo cierra en enero del año siguiente.
    expect(cortePorDefecto(new Date(2026, 11, 25))).toEqual({
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
