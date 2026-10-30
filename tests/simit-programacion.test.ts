import { describe, expect, it } from 'vitest'
import { normalizarProgramacion, expresionCronSimit } from '../src/modules/simit/simit.service'
import { seccionesVisibles } from '../src/modules/dashboard/secciones'
import { moduloDeNotificacion, puedeRecibirNotificacion } from '../src/modules/notificaciones/permisos-notificaciones'

describe('programación SIMIT', () => {
  it('usa la frecuencia diaria y la hora de Colombia como valores iniciales', () => {
    expect(normalizarProgramacion(null)).toEqual({
      cadaHoras: 24,
      horaInicio: '08:00',
      horarios: ['08:00'],
    })
  })

  it('calcula los horarios y la expresión cron desde la hora elegida', () => {
    const programacion = normalizarProgramacion({ cadaHoras: 6, horaInicio: '08:30' })
    expect(programacion.horarios).toEqual(['02:30', '08:30', '14:30', '20:30'])
    expect(expresionCronSimit(programacion)).toBe('30 2,8,14,20 * * *')
  })

  it('descarta una frecuencia y una hora que no estén admitidas', () => {
    expect(normalizarProgramacion({ cadaHoras: 7, horaInicio: '8:30' })).toEqual({
      cadaHoras: 24,
      horaInicio: '08:00',
      horarios: ['08:00'],
    })
  })
})

describe('integración SIMIT con el panel y notificaciones', () => {
  it('muestra el panel SIMIT a Operaciones con acceso a sus fuentes', () => {
    const secciones = seccionesVisibles(
      { id: 'usuario', area: ['operaciones'] },
      { servicios: 'full', flota: 'full', conductores: 'full' },
    )
    expect(secciones.map(({ id }) => id)).toContain('simit')
  })

  it('conserva las notificaciones SIMIT dentro del permiso de su ficha', () => {
    const avisoVehiculo = { tipo: 'GENERAL', referencia_tipo: 'simit:veh:20261030:1234567890' }
    const avisoConductor = { tipo: 'GENERAL', referencia_tipo: 'simit:con:20261030:1234567890' }

    expect(moduloDeNotificacion(avisoVehiculo)).toBe('flota')
    expect(moduloDeNotificacion(avisoConductor)).toBe('conductores')
    expect(puedeRecibirNotificacion({ id: 'usuario', area: ['hseq'], permisos_rutas: null }, avisoVehiculo)).toBe(true)
    expect(puedeRecibirNotificacion({ id: 'usuario', area: ['talento_humano'], permisos_rutas: null }, avisoConductor)).toBe(true)
  })
})
