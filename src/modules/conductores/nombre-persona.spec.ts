import { describe, it, expect } from 'vitest'
import { normalizarNombrePersona, normalizarNombresEnPayload } from './nombre-persona'

describe('normalización de nombres', () => {
  it('pasa a mayúsculas', () => {
    expect(normalizarNombrePersona('juan perez')).toBe('JUAN PEREZ')
  })

  it('colapsa espacios de más y recorta los de los extremos', () => {
    expect(normalizarNombrePersona('  juan   carlos   perez  ')).toBe('JUAN CARLOS PEREZ')
  })

  it('colapsa también el espacio no separable que llega al pegar desde Word', () => {
    expect(normalizarNombrePersona('JUAN  PEREZ')).toBe('JUAN PEREZ')
  })

  it('CONSERVA tildes y Ñ', () => {
    // Quitarlas cambiaría el nombre de la persona, no lo limpiaría.
    expect(normalizarNombrePersona('josé muñoz')).toBe('JOSÉ MUÑOZ')
  })

  it('conserva apóstrofo y guion de los apellidos compuestos', () => {
    expect(normalizarNombrePersona("d'angelo")).toBe("D'ANGELO")
    expect(normalizarNombrePersona('perez-gomez')).toBe('PEREZ-GOMEZ')
  })

  it('quita dígitos y puntuación, que en este campo son erratas', () => {
    expect(normalizarNombrePersona('juan perez 123')).toBe('JUAN PEREZ')
    expect(normalizarNombrePersona('juan, perez.')).toBe('JUAN PEREZ')
  })

  it('un nombre que queda vacío se guarda como nulo, no como cadena vacía', () => {
    expect(normalizarNombrePersona('   ')).toBeNull()
    expect(normalizarNombrePersona('123')).toBeNull()
    expect(normalizarNombrePersona(null)).toBeNull()
  })
})

describe('normalización del payload', () => {
  it('solo toca nombre y apellido', () => {
    const r = normalizarNombresEnPayload({ nombre: 'ana', apellido: 'ruiz', email: 'a@B.com' })
    expect(r).toEqual({ nombre: 'ANA', apellido: 'RUIZ', email: 'a@B.com' })
  })

  it('no inventa campos que no venían', () => {
    // En un PATCH parcial, añadir `apellido: null` borraría el que ya estaba.
    const r = normalizarNombresEnPayload({ nombre: 'ana' })
    expect('apellido' in r).toBe(false)
  })

  it('respeta el borrado explícito', () => {
    // `nombre: ''` es una intención de borrar, no un «no tocar».
    const r = normalizarNombresEnPayload({ nombre: '' })
    expect(r.nombre).toBeNull()
  })
})
