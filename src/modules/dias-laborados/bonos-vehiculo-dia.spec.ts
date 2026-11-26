import { describe, expect, it } from 'vitest'
import { resolverVehiculosBonosDia } from './bonos-vehiculo-dia'

const dia = (id: string, fecha: string, tipo = 'DISPONIBLE') => ({
  id, conductor_id: 'conductor', fecha: new Date(`${fecha}T00:00:00.000Z`), tipo,
})
const planilla = (mes: number, dias: number[], id = 'pwr350') => ({
  conductor_id: 'conductor', vehiculo_id: id, a_o: 2026, mes,
  vehiculos: { placa: id.toUpperCase() },
  dias_laborales_planillas: dias.map((numero) => ({ dia: numero, disponibilidad: true })),
})

describe('atribución de bonos de días sin tramo', () => {
  it('asocia los cuatro días disponibles solo por participación fechada en la planilla', () => {
    const dias = [
      dia('oct25', '2026-10-25'), dia('oct29', '2026-10-29'),
      dia('nov8', '2026-11-08'), dia('nov9', '2026-11-09'),
    ]
    const resultado = resolverVehiculosBonosDia(dias, [planilla(10, [25, 29]), planilla(11, [8, 9])])
    expect([...resultado.values()].map((v) => v.id)).toEqual(Array(4).fill('pwr350'))
    expect(resolverVehiculosBonosDia([dia('sinDia', '2026-10-26')], [planilla(10, [25])]).size).toBe(0)
  })

  it('acepta mantenimiento con vehículo propio y excluye descanso y fechas con dos placas', () => {
    const mantenimiento = { ...dia('taller', '2026-11-08', 'MANTENIMIENTO'), mantenimiento_vehiculo_id: 'pwr350' }
    const descanso = dia('descanso', '2026-11-08', 'DESCANSO')
    const disponible = dia('ambiguo', '2026-11-08')
    const resultado = resolverVehiculosBonosDia(
      [mantenimiento, descanso, disponible],
      [planilla(11, [8]), planilla(11, [8], 'pwr352')],
      [{ id: 'pwr350', placa: 'PWR350' }],
    )
    expect(resultado.get('taller')?.id).toBe('pwr350')
    expect(resultado.has('descanso')).toBe(false)
    expect(resultado.has('ambiguo')).toBe(false)
  })
})
