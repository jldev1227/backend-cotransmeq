import { describe, expect, it } from 'vitest'
import { esDiaValido, resolverCondiciones } from './cartera.condiciones'

const ACTUAL = { suma: 1_000_000, fecha_emision: '2026-10-01', plazo_dias: 30, ajuste_valor: 0 }

describe('resolverCondiciones', () => {
  it('sin nada nuevo: valor = suma y vencimiento = emisión + plazo', () => {
    expect(resolverCondiciones({}, ACTUAL)).toEqual({
      valor_total: 1_000_000,
      ajuste_valor: 0,
      fecha_emision: '2026-10-01',
      plazo_dias: 30,
      fecha_vencimiento: '2026-10-31',
    })
  })

  it('el valor digitado se guarda como ajuste sobre la suma', () => {
    const r = resolverCondiciones({ valor_total: '1190000.50' }, ACTUAL)
    expect(r.valor_total).toBe(1_190_000.5)
    expect(r.ajuste_valor).toBe(190_000.5)
  })

  it('conserva el ajuste cuando cambia la suma (se asoció otra liquidación)', () => {
    const r = resolverCondiciones({}, { ...ACTUAL, suma: 1_500_000, ajuste_valor: -20_000 })
    expect(r.valor_total).toBe(1_480_000)
  })

  it('el vencimiento explícito manda y recalcula el plazo', () => {
    const r = resolverCondiciones({ fecha_vencimiento: '2026-11-15', plazo_dias: 30 }, ACTUAL)
    expect(r.plazo_dias).toBe(45)
    expect(r.fecha_vencimiento).toBe('2026-11-15')
  })

  it('cambiar la emisión arrastra el vencimiento con el mismo plazo', () => {
    const r = resolverCondiciones({ fecha_emision: '2026-12-15' }, ACTUAL)
    expect(r.fecha_vencimiento).toBe('2027-01-14')
  })

  it.each([
    [{ fecha_emision: '2026-02-30' }, /emisión/],
    [{ plazo_dias: -1 }, /plazo/],
    [{ plazo_dias: 2.5 }, /plazo/],
    [{ plazo_dias: 400 }, /plazo/],
    [{ fecha_vencimiento: '2026-09-01' }, /anterior/],
    [{ valor_total: -5 }, /valor/],
    [{ valor_total: 'abc' }, /valor/],
  ])('rechaza %o', (entrada, mensaje) => {
    expect(() => resolverCondiciones(entrada as any, ACTUAL)).toThrow(mensaje)
  })
})

describe('esDiaValido', () => {
  it('solo acepta fechas reales en AAAA-MM-DD', () => {
    expect(esDiaValido('2028-02-29')).toBe(true)
    expect(esDiaValido('2026-02-29')).toBe(false)
    expect(esDiaValido('10/10/2026')).toBe(false)
    expect(esDiaValido(undefined)).toBe(false)
  })
})
