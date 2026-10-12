/**
 * Reglas de cartera: saldo, estado derivado y tramos de edad.
 *
 * Puras: se fija `hoy` en cada caso para que el resultado no dependa del día
 * en que corra la suite.
 */
import { describe, expect, it } from 'vitest'
import {
  agruparPorCliente,
  aplicadoDeAbono,
  finDeMes,
  resumirCartera,
  situacionFactura,
  tramoEdad,
  type FacturaParaAgrupar,
} from './cartera.calculo'

const HOY = '2026-10-10'

describe('situacionFactura', () => {
  it('sin abonos y sin vencer: pendiente, todo el valor es saldo', () => {
    const s = situacionFactura({ valor_total: 1_000_000, fecha_vencimiento: '2026-10-30', abonos: [] }, HOY)
    expect(s).toMatchObject({ saldo: 1_000_000, aplicado: 0, estado: 'pendiente', tramo: 'corriente', dias_vencida: 0 })
  })

  it('las retenciones bajan el saldo igual que lo recibido', () => {
    const s = situacionFactura(
      {
        valor_total: 1_000_000,
        fecha_vencimiento: '2026-10-30',
        abonos: [{ valor: 600_000, retefuente: 35_000, reteica: 9_660, reteiva: 0 }],
      },
      HOY,
    )
    expect(s.recibido).toBe(600_000)
    expect(s.retenciones).toBe(44_660)
    expect(s.saldo).toBe(355_340)
    expect(s.estado).toBe('abonada')
  })

  it('pagada cuando lo aplicado cubre el valor, aunque ya haya vencido', () => {
    const s = situacionFactura(
      {
        valor_total: '1234567.89',
        fecha_vencimiento: '2026-08-01',
        abonos: [
          { valor: '1000000.00', retefuente: '0' },
          { valor: '200000.00', retefuente: '34567.89' },
        ],
      },
      HOY,
    )
    expect(s.saldo).toBe(0)
    expect(s.estado).toBe('pagada')
    expect(s.tramo).toBeNull()
    expect(s.dias_vencida).toBe(0)
  })

  it('suma en centavos: 0,1 + 0,2 no deja un saldo fantasma', () => {
    const s = situacionFactura(
      { valor_total: 0.3, fecha_vencimiento: '2026-10-30', abonos: [{ valor: 0.1 }, { valor: 0.2 }] },
      HOY,
    )
    expect(s.saldo).toBe(0)
    expect(s.estado).toBe('pagada')
  })

  it('el día del vencimiento todavía no está vencida; al día siguiente sí', () => {
    const base = { valor_total: 100, abonos: [] }
    expect(situacionFactura({ ...base, fecha_vencimiento: HOY }, HOY).estado).toBe('pendiente')
    const s = situacionFactura({ ...base, fecha_vencimiento: '2026-10-09' }, HOY)
    expect(s.estado).toBe('vencida')
    expect(s.dias_vencida).toBe(1)
    expect(s.tramo).toBe('d1_30')
  })

  it('vencida con abono parcial sigue siendo vencida (el atraso manda)', () => {
    const s = situacionFactura(
      { valor_total: 1000, fecha_vencimiento: '2026-07-01', abonos: [{ valor: 400 }] },
      HOY,
    )
    expect(s.estado).toBe('vencida')
    expect(s.saldo).toBe(600)
    expect(s.dias_vencida).toBe(101)
    expect(s.tramo).toBe('d90_mas')
  })

  it('un abono de más deja saldo negativo y la factura pagada', () => {
    const s = situacionFactura({ valor_total: 100, fecha_vencimiento: '2026-11-01', abonos: [{ valor: 150 }] }, HOY)
    expect(s.saldo).toBe(-50)
    expect(s.estado).toBe('pagada')
  })
})

describe('tramoEdad', () => {
  it.each([
    [-5, 'corriente'],
    [0, 'corriente'],
    [1, 'd1_30'],
    [30, 'd1_30'],
    [31, 'd31_60'],
    [60, 'd31_60'],
    [61, 'd61_90'],
    [90, 'd61_90'],
    [91, 'd90_mas'],
    [400, 'd90_mas'],
  ] as const)('%i días → %s', (dias, tramo) => {
    expect(tramoEdad(dias)).toBe(tramo)
  })
})

describe('aplicadoDeAbono', () => {
  it('suma valor y las cuatro retenciones', () => {
    expect(aplicadoDeAbono({ valor: 100, retefuente: 1, reteica: 2, reteiva: 3, otros_descuentos: 4 })).toBe(110)
  })
})

describe('finDeMes', () => {
  it('respeta febrero bisiesto y meses de 30', () => {
    expect(finDeMes('2028-02-10')).toBe('2028-02-29')
    expect(finDeMes('2026-02-10')).toBe('2026-02-28')
    expect(finDeMes('2026-11-01')).toBe('2026-11-30')
    expect(finDeMes('2026-12-31')).toBe('2026-12-31')
  })
})

function fac(
  cliente: string | null,
  valor: number,
  vence: string,
  abonos: { valor: number }[] = [],
): FacturaParaAgrupar {
  return {
    cliente_id: cliente,
    cliente_nombre: cliente ? `Cliente ${cliente}` : null,
    cliente_nit: null,
    fecha_vencimiento: vence,
    situacion: situacionFactura({ valor_total: valor, fecha_vencimiento: vence, abonos }, HOY),
  }
}

describe('agruparPorCliente y resumirCartera', () => {
  const facturas = [
    fac('A', 1000, '2026-10-20'), // corriente, vence este mes
    fac('A', 500, '2026-09-25'), // 15 días
    fac('A', 300, '2026-06-01', [{ valor: 100 }]), // 131 días, saldo 200
    fac('B', 2000, '2026-08-20'), // 51 días
    fac('B', 800, '2026-11-15'), // corriente, vence el mes que viene
    fac('C', 700, '2026-07-01', [{ valor: 700 }]), // pagada: no cuenta
    fac(null, 90, '2026-07-20'), // 82 días, sin cliente
  ]

  it('reparte el saldo de cada factura en su tramo', () => {
    const filas = agruparPorCliente(facturas)
    const a = filas.find((f) => f.cliente_id === 'A')!
    expect(a.edades).toEqual({ corriente: 1000, d1_30: 500, d31_60: 0, d61_90: 0, d90_mas: 200 })
    expect(a.saldo).toBe(1700)
    expect(a.vencido).toBe(700)
    expect(a.facturas).toBe(3)
    expect(a.facturas_vencidas).toBe(2)
    expect(a.max_dias_vencida).toBe(131)

    const b = filas.find((f) => f.cliente_id === 'B')!
    expect(b.edades).toEqual({ corriente: 800, d1_30: 0, d31_60: 2000, d61_90: 0, d90_mas: 0 })
  })

  it('omite clientes sin saldo y agrupa las facturas sin cliente', () => {
    const filas = agruparPorCliente(facturas)
    expect(filas.find((f) => f.cliente_id === 'C')).toBeUndefined()
    const sin = filas.find((f) => f.cliente_id === null)!
    expect(sin.nombre).toBe('Sin cliente')
    expect(sin.edades.d61_90).toBe(90)
  })

  it('ordena por lo vencido, de mayor a menor', () => {
    expect(agruparPorCliente(facturas).map((f) => f.cliente_id)).toEqual(['B', 'A', null])
  })

  it('el resumen cuadra con la suma de las filas', () => {
    const r = resumirCartera(facturas, HOY)
    const filas = agruparPorCliente(facturas)
    expect(r.por_cobrar).toBe(filas.reduce((s, f) => s + f.saldo, 0))
    expect(r.vencido).toBe(filas.reduce((s, f) => s + f.vencido, 0))
    expect(r).toMatchObject({
      por_cobrar: 4590,
      vencido: 2790,
      corriente: 1800,
      por_vencer_mes: 1000,
      facturas_abiertas: 6,
      facturas_vencidas: 4,
      clientes_con_saldo: 3,
    })
  })
})
