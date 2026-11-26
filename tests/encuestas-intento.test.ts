import { describe, expect, it } from 'vitest'
import { crearIntento, leerIntento, DURACION_INTENTO_MS } from '../src/modules/encuestas/encuestas.intento'

describe('plazo de encuesta pública', () => {
  it('continúa con el mismo vencimiento y vence exactamente a los 30 minutos', () => {
    const apertura = Date.now()
    const { intento, vence_at } = crearIntento('encuesta-1', apertura)
    expect(leerIntento('encuesta-1', intento, apertura + 10_000)).toEqual({ vence_at, vencido: false })
    expect(leerIntento('encuesta-1', intento, apertura + DURACION_INTENTO_MS)).toEqual({ vence_at, vencido: true })
  })

  it('rechaza una firma alterada o usada en otra encuesta', () => {
    const { intento } = crearIntento('encuesta-1')
    expect(leerIntento('encuesta-2', intento)).toBeNull()
    expect(leerIntento('encuesta-1', `${intento.slice(0, -1)}!`)).toBeNull()
  })
})
