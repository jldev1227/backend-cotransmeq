/**
 * Fecha del formulario: la calcula el servidor, no la teclea nadie.
 *
 * Sale de `started_at` convertido a la zona horaria de la ASIGNACIÓN. Lo que se
 * prueba aquí son las dos decisiones que se pagan en un documento HSEQ impreso:
 * que la conversión use el calendario de la operación y no el del servidor, y
 * que lo que llegue del dispositivo en `filledOn` no pueda pisarla.
 */

import { describe, expect, it } from 'vitest'
import {
  CLAVE_FECHA_DILIGENCIAMIENTO,
  conFechaDeFormulario,
  esFechaISO,
  fechaDeFormulario,
  fechaDeFormularioDe,
} from '../src/modules/formularios-dinamicos/domain/fecha-diligenciamiento'

const BOGOTA = 'America/Bogota'

describe('fechaDeFormulario', () => {
  it('usa la zona de la asignación, no UTC', () => {
    /// 22:00 en Colombia son las 03:00 UTC del día siguiente. Un preoperacional
    /// del turno de la noche del 4 no puede salir fechado el 5.
    expect(fechaDeFormulario(new Date('2026-09-05T03:00:00.000Z'), BOGOTA)).toBe('2026-09-04')
  })

  it('cambia de día a la medianoche local', () => {
    expect(fechaDeFormulario(new Date('2026-09-05T04:59:00.000Z'), BOGOTA)).toBe('2026-09-04')
    expect(fechaDeFormulario(new Date('2026-09-05T05:01:00.000Z'), BOGOTA)).toBe('2026-09-05')
  })

  it('cae en la zona de negocio cuando la asignación no declara ninguna', () => {
    expect(fechaDeFormulario(new Date('2026-09-05T03:00:00.000Z'), null)).toBe('2026-09-04')
    expect(fechaDeFormulario(new Date('2026-09-05T03:00:00.000Z'), '')).toBe('2026-09-04')
  })

  it('respeta una zona distinta si la asignación la tiene', () => {
    expect(fechaDeFormulario(new Date('2026-09-05T03:00:00.000Z'), 'UTC')).toBe('2026-09-05')
  })
})

describe('conFechaDeFormulario', () => {
  const inicio = new Date('2026-09-04T13:00:00.000Z')

  it('escribe la fecha en el contexto sin tocar lo demás', () => {
    const contexto = { vehicleId: 'v-1', vehiclePlate: 'JYO215' }
    const salida = conFechaDeFormulario(contexto, inicio, BOGOTA)

    expect(salida).toEqual({
      vehicleId: 'v-1',
      vehiclePlate: 'JYO215',
      [CLAVE_FECHA_DILIGENCIAMIENTO]: '2026-09-04',
    })
  })

  it('descarta la fecha que mande el dispositivo', () => {
    /// Una app vieja todavía envía `filledOn` tecleado. Un dato del cliente no
    /// manda sobre el reloj del registro.
    const salida = conFechaDeFormulario(
      { [CLAVE_FECHA_DILIGENCIAMIENTO]: '2026-01-01' },
      inicio,
      BOGOTA,
    )
    expect(salida[CLAVE_FECHA_DILIGENCIAMIENTO]).toBe('2026-09-04')
  })

  it('no muta el contexto que recibe', () => {
    /// El contexto viene del cliente: mutarlo escondería que el servidor lo está
    /// corrigiendo.
    const contexto = { vehicleId: 'v-1' }
    conFechaDeFormulario(contexto, inicio, BOGOTA)
    expect(contexto).toEqual({ vehicleId: 'v-1' })
  })
})

describe('fechaDeFormularioDe', () => {
  it('lee la fecha guardada', () => {
    expect(fechaDeFormularioDe({ [CLAVE_FECHA_DILIGENCIAMIENTO]: '2026-09-04' })).toBe('2026-09-04')
  })

  it('devuelve null en los envíos anteriores al campo', () => {
    expect(fechaDeFormularioDe({ vehicleId: 'v-1' })).toBeNull()
    expect(fechaDeFormularioDe(null)).toBeNull()
    expect(fechaDeFormularioDe(undefined)).toBeNull()
  })

  it('ignora un valor que no es una fecha', () => {
    expect(fechaDeFormularioDe({ [CLAVE_FECHA_DILIGENCIAMIENTO]: 'ayer' })).toBeNull()
    expect(fechaDeFormularioDe({ [CLAVE_FECHA_DILIGENCIAMIENTO]: '2026-02-31' })).toBeNull()
  })
})

describe('esFechaISO', () => {
  it('acepta una fecha real y rechaza una imposible', () => {
    expect(esFechaISO('2026-09-04')).toBe(true)
    expect(esFechaISO('2026-02-31')).toBe(false)
    expect(esFechaISO('2026-09-04T10:00:00Z')).toBe(false)
    expect(esFechaISO(20260904)).toBe(false)
  })
})
