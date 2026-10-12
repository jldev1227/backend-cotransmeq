/**
 * Reglas puras del mantenimiento de flota: cuándo toca el próximo, cuándo un
 * plan está vencido o próximo, cuánto vale una orden y qué cambios de estado
 * admite. Sin base de datos: «hoy» entra como parámetro.
 */
import { describe, expect, it } from 'vitest'
import {
  avanzaPlan,
  calcularProximo,
  compararUrgencia,
  evaluarPlan,
  huellaAvisoPlan,
  sumarMeses,
  tienePeriodicidad,
  totalesOrden,
  transicionValida,
  UMBRAL_DIAS_PROXIMO,
  UMBRAL_KM_PROXIMO,
} from '../src/modules/mantenimiento/calculo'
import { seccionesVisibles } from '../src/modules/dashboard/secciones'
import { getAccessibleModules } from '../src/config/permissions'

const HOY = '2026-10-10'

describe('sumarMeses', () => {
  it('suma meses de calendario', () => {
    expect(sumarMeses('2026-10-10', 3)).toBe('2027-01-10')
    expect(sumarMeses('2026-01-15', 12)).toBe('2027-01-15')
  })
  it('recorta al último día cuando el mes de llegada es más corto', () => {
    /// Sin el recorte, `Date` desbordaba: 31-ago + 3 meses «tocaba» el 1-dic.
    expect(sumarMeses('2026-08-31', 3)).toBe('2026-11-30')
    expect(sumarMeses('2026-01-31', 1)).toBe('2026-02-28')
    expect(sumarMeses('2028-01-31', 1)).toBe('2028-02-29')
  })
})

describe('calcularProximo', () => {
  it('por kilómetros y por meses a la vez', () => {
    expect(
      calcularProximo({ periodicidad_km: 5000, periodicidad_meses: 3, ultima_km: 120_000, ultima_fecha: '2026-09-01' }),
    ).toEqual({ proximo_km: 125_000, proxima_fecha: '2026-12-01' })
  })
  it('sin último km no inventa un próximo km', () => {
    expect(calcularProximo({ periodicidad_km: 5000, ultima_km: null, ultima_fecha: '2026-09-01' })).toEqual({
      proximo_km: null,
      proxima_fecha: null,
    })
  })
  it('los meses mandan sobre los días si vienen los dos', () => {
    expect(calcularProximo({ periodicidad_meses: 1, periodicidad_dias: 90, ultima_km: null, ultima_fecha: '2026-09-01' }).proxima_fecha).toBe(
      '2026-10-01',
    )
    expect(calcularProximo({ periodicidad_dias: 45, ultima_km: null, ultima_fecha: '2026-09-01' }).proxima_fecha).toBe('2026-10-16')
  })
  it('un plan necesita alguna periodicidad', () => {
    expect(tienePeriodicidad({})).toBe(false)
    expect(tienePeriodicidad({ periodicidad_km: 0, periodicidad_meses: null })).toBe(false)
    expect(tienePeriodicidad({ periodicidad_meses: 6 })).toBe(true)
  })
})

describe('evaluarPlan: umbrales de 500 km y 15 días', () => {
  const evaluar = (proximo_km: number | null, km_actual: number | null, proxima_fecha: string | null = null) =>
    evaluarPlan({ proximo_km, km_actual, proxima_fecha, hoy: HOY })

  it('los umbrales son los documentados', () => {
    expect(UMBRAL_KM_PROXIMO).toBe(500)
    expect(UMBRAL_DIAS_PROXIMO).toBe(15)
  })
  it('por km: 501 restantes al día, 500 próximo, 0 vencido', () => {
    expect(evaluar(10_501, 10_000).estado).toBe('al_dia')
    expect(evaluar(10_500, 10_000)).toMatchObject({ estado: 'proximo', km_restantes: 500, motivo: 'km' })
    /// «A los 10.000 km» quiere decir que a los 10.000 ya toca.
    expect(evaluar(10_000, 10_000)).toMatchObject({ estado: 'vencido', km_restantes: 0, motivo: 'km' })
    expect(evaluar(10_000, 10_620)).toMatchObject({ estado: 'vencido', km_restantes: -620 })
  })
  it('por fecha: 16 días al día, 15 próximo, hoy próximo, ayer vencido', () => {
    expect(evaluar(null, null, '2026-10-26').estado).toBe('al_dia')
    expect(evaluar(null, null, '2026-10-25')).toMatchObject({ estado: 'proximo', dias_restantes: 15, motivo: 'fecha' })
    expect(evaluar(null, null, '2026-10-10')).toMatchObject({ estado: 'proximo', dias_restantes: 0 })
    expect(evaluar(null, null, '2026-10-09')).toMatchObject({ estado: 'vencido', dias_restantes: -1, motivo: 'fecha' })
  })
  it('vence con lo que llegue primero', () => {
    expect(evaluar(20_000, 10_000, '2026-10-01')).toMatchObject({ estado: 'vencido', motivo: 'fecha' })
    expect(evaluar(10_000, 10_100, '2027-01-01')).toMatchObject({ estado: 'vencido', motivo: 'km' })
    expect(evaluar(10_000, 10_100, '2026-10-01')).toMatchObject({ estado: 'vencido', motivo: 'ambos' })
    expect(evaluar(10_200, 10_000, '2026-10-20')).toMatchObject({ estado: 'proximo', motivo: 'ambos' })
  })
  it('un kilometraje de 0 en la ficha es «no se sabe», no un vehículo nuevo', () => {
    expect(evaluar(5_000, 0)).toMatchObject({ estado: 'sin_datos', km_restantes: null })
    expect(evaluar(5_000, 0, '2026-10-01').estado).toBe('vencido')
  })
  it('un plan pausado no está vencido aunque lo esté', () => {
    expect(evaluarPlan({ proximo_km: 1, km_actual: 9_999, proxima_fecha: '2020-01-01', hoy: HOY, activo: false }).estado).toBe('pausado')
  })
  it('ordena por urgencia: vencidos primero y, dentro, el más pasado', () => {
    const a = evaluar(10_000, 10_900) // 900 km de más
    const b = evaluar(null, null, '2026-10-09') // 1 día tarde
    const c = evaluar(10_400, 10_000) // próximo
    const orden = [c, b, a].sort(compararUrgencia)
    expect(orden.map((e) => e.estado)).toEqual(['vencido', 'vencido', 'proximo'])
    expect(orden[0]).toBe(a)
  })
})

describe('huella del aviso diario', () => {
  it('cabe en los 50 caracteres de referencia_tipo y cambia con el punto de vencimiento', () => {
    const h = huellaAvisoPlan('vencido', 2_999_999, '2026-10-10')
    expect(h.length).toBeLessThanOrEqual(50)
    expect(h).toBe('mant:vencido:2999999:2026-10-10')
    expect(huellaAvisoPlan('proximo', null, '2026-10-10')).toBe('mant:proximo:-:2026-10-10')
    expect(huellaAvisoPlan('proximo', 15_000, null)).not.toBe(huellaAvisoPlan('proximo', 20_000, null))
  })
})

describe('órdenes de trabajo', () => {
  it('repuestos + mano de obra = total, a centavos', () => {
    expect(
      totalesOrden(
        [
          { descripcion: 'Aceite 15W40 (galón)', cantidad: 4, valor_unitario: 45_000.5 },
          { descripcion: 'Filtro de aceite', cantidad: 1, valor_unitario: 38_000 },
        ],
        60_000,
      ),
    ).toEqual({ costo_repuestos: 218_002, costo_mano_obra: 60_000, costo: 278_002 })
    expect(totalesOrden([], null)).toEqual({ costo_repuestos: 0, costo_mano_obra: 0, costo: 0 })
    expect(totalesOrden([{ descripcion: 'x', cantidad: 3, valor_unitario: 0.1 }], 0).costo).toBe(0.3)
  })
  it('abierta → en curso → cerrada; cerrar y anular son terminales', () => {
    expect(transicionValida('PROGRAMADO', 'EN_CURSO')).toBe(true)
    expect(transicionValida('PROGRAMADO', 'EJECUTADO')).toBe(true)
    expect(transicionValida('EN_CURSO', 'CANCELADO')).toBe(true)
    expect(transicionValida('EN_CURSO', 'PROGRAMADO')).toBe(false)
    expect(transicionValida('EJECUTADO', 'CANCELADO')).toBe(false)
    expect(transicionValida('CANCELADO', 'EN_CURSO')).toBe(false)
  })
  it('cerrar tarde una orden vieja no devuelve el plan hacia atrás', () => {
    expect(avanzaPlan(null, '2026-10-01')).toBe(true)
    expect(avanzaPlan('2026-10-01', '2026-10-01')).toBe(true)
    expect(avanzaPlan('2026-10-05', '2026-10-01')).toBe(false)
  })
})

describe('sección «Mantenimiento» del panel', () => {
  const visibles = (area: string[], role = 'usuario') =>
    seccionesVisibles({ id: 'x', role, area }, getAccessibleModules(role, area as any, null)).map((s) => s.id)

  it('el área mantenimiento ve su propia sección (antes exigía `formularios`)', () => {
    expect(visibles(['mantenimiento'])).toContain('mantenimiento')
  })
  it('las demás áreas siguen sin verla', () => {
    expect(visibles(['contabilidad'])).not.toContain('mantenimiento')
    expect(visibles(['operaciones'])).not.toContain('mantenimiento')
  })
})
