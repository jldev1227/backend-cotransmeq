/**
 * El sincronizador de extractos no crea conductores con basura.
 *
 * `sincronizar()` CREA un conductor por cada nombre que no encuentre en la base,
 * y corre en CADA carga de `/dashboard/extractos`. Sin filtro, una celda mal
 * parseada se convierte en una fila permanente: en la base de Transmeralda hay once
 * conductores con identificación `EXT-<timestamp>`, y uno se llama literalmente
 * «0». Salió de una línea de `extractos.txt` con un cero en la columna del
 * conductor, y desde entonces aparece en el desplegable de PESV mezclado con
 * los conductores reales.
 *
 * Sin base de datos: se prueba el predicado, que es donde estaba el agujero.
 */

import { describe, expect, it } from 'vitest'
import { pareceNombreDePersona } from '../src/modules/extractos/extractos.service'

describe('pareceNombreDePersona', () => {
  it('acepta nombres reales, incluidos los cortos y con partículas', () => {
    for (const nombre of [
      'JONATHAN DAMAWER HERNANDEZ BRAVO',
      'ANA GIL',
      'JOSE DE LA CRUZ',
      'OMAR SORACA',
      "O'CONNOR PEREZ"
    ]) {
      expect(pareceNombreDePersona(nombre), nombre).toBe(true)
    }
  })

  it('rechaza el cero que creó el conductor fantasma de producción', () => {
    /// Este es EL caso: la fila `nombre: "0"`, sin apellido, con
    /// identificación `EXT-1788410485465-6`.
    expect(pareceNombreDePersona('0')).toBe(false)
  })

  it('rechaza vacíos, rellenos y marcadores de celda sin dato', () => {
    for (const basura of [
      '',
      '   ',
      null,
      undefined,
      '##########',
      '###',
      '---',
      'N/A',
      'n/a',
      'NULL',
      'ninguno',
      '12345',
      '0.00'
    ]) {
      expect(pareceNombreDePersona(basura as any), JSON.stringify(basura)).toBe(false)
    }
  })

  it('rechaza lo demasiado corto para ser un nombre', () => {
    expect(pareceNombreDePersona('A')).toBe(false)
    expect(pareceNombreDePersona('AB')).toBe(false)
  })
})
