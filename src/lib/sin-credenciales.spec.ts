/**
 * La red de seguridad que quita `password` de respuestas y eventos: a
 * cualquier profundidad, sin tocar lo que no son objetos planos.
 */
import { describe, expect, it } from 'vitest'
import { sinCredenciales } from './sin-credenciales'

describe('sinCredenciales', () => {
  it('quita `password` en cualquier nivel, también dentro de arreglos', () => {
    const servicio = {
      id: 's1',
      conductores: { id: 'c1', nombre: 'Ana', password: '$argon2id$…' },
      historial: [{ usuario: { id: 'u1', password: '$2b$…', correo: 'a@b.co' } }],
    }
    const limpio = sinCredenciales(servicio)
    expect(limpio).toBe(servicio)
    expect(limpio).toEqual({
      id: 's1',
      conductores: { id: 'c1', nombre: 'Ana' },
      historial: [{ usuario: { id: 'u1', correo: 'a@b.co' } }],
    })
  })

  it('deja intactos fechas, Decimal y demás instancias, y los valores sueltos', () => {
    class Decimal {
      constructor(public valor: string) {}
    }
    const fecha = new Date('2026-10-11T00:00:00Z')
    const monto = new Decimal('100.50')
    const fila = { fecha, monto, password: 'x' }
    sinCredenciales(fila)
    expect(fila).toEqual({ fecha, monto })
    expect(fila.monto).toBe(monto)
    expect(sinCredenciales('texto')).toBe('texto')
    expect(sinCredenciales(null)).toBeNull()
  })

  it('no entra en bucle con estructuras circulares', () => {
    const a: Record<string, unknown> = { password: 'x' }
    a.yo = a
    expect(() => sinCredenciales(a)).not.toThrow()
    expect(a.password).toBeUndefined()
  })
})
