/**
 * Correo de prueba de la guía del portal (`POST /api/formularios/campana-portal/test`).
 *
 * Antes la prueba emitía un magic link REAL de 30 días del conductor y lo
 * mandaba a la dirección `to` que eligiera el cliente: con `formularios:full`
 * se podía entrar al portal de cualquier conductor. Aquí se fija que:
 *
 * - la prueba no emite token ni lleva `?token=` en el enlace;
 * - el destinatario es siempre el correo de quien la pide (`to` solo se acepta
 *   si es ese mismo correo);
 * - el envío real de la campaña sigue yendo al correo del conductor.
 *
 * No toca la base ni manda correos: `prisma`, el correo y el emisor de tokens
 * son dobles.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { enviados, emitirTokenPortal } = vi.hoisted(() => ({
  enviados: [] as any[],
  emitirTokenPortal: vi.fn(async (_conductor: unknown) => 'TOKEN-REAL-DEL-CONDUCTOR')
}))

vi.mock('../src/config/prisma', () => ({ prisma: {} }))
vi.mock('../src/config/env', () => ({ env: { EMAIL_FRONTEND_URL: 'https://portal.ejemplo.test' } }))
vi.mock('../src/services/email.service', () => ({
  EmailService: {
    sendEmail: async (opciones: any) => {
      enviados.push(opciones)
      return { id: 'correo-1' }
    }
  }
}))
vi.mock('../src/modules/conductor-portal/portal-token.service', () => ({ emitirTokenPortal }))

import {
  correoDePrueba,
  enviarGuia,
  enviarGuiaDePrueba,
  type AudienciaCampana
} from '../src/modules/formularios-dinamicos/formularios-campana-email.service'

const conductor: AudienciaCampana = {
  conductorId: 'cond-1',
  nombre: 'Ana',
  apellido: 'Pérez',
  numeroIdentificacion: '1234567',
  email: 'ana.conductora@ejemplo.test'
}

beforeEach(() => {
  enviados.length = 0
  emitirTokenPortal.mockClear()
})

describe('correoDePrueba', () => {
  it('usa el correo de la sesión cuando no viene `to`', () => {
    expect(correoDePrueba('admin@ejemplo.test')).toBe('admin@ejemplo.test')
    expect(correoDePrueba('admin@ejemplo.test', '')).toBe('admin@ejemplo.test')
  })

  it('acepta `to` solo si es el mismo correo, sin distinguir mayúsculas', () => {
    expect(correoDePrueba('Admin@Ejemplo.test', ' admin@ejemplo.TEST ')).toBe('Admin@Ejemplo.test')
  })

  it('rechaza un `to` distinto al del usuario', () => {
    expect(() => correoDePrueba('admin@ejemplo.test', 'otro@fuera.test')).toThrow(/tu propio correo/)
    expect(() => correoDePrueba('admin@ejemplo.test', ['admin@ejemplo.test'])).toThrow(/tu propio correo/)
  })

  it('rechaza si la sesión no trae un correo válido', () => {
    expect(() => correoDePrueba(undefined, 'otro@fuera.test')).toThrow(/correo válido/)
    expect(() => correoDePrueba(null)).toThrow(/correo válido/)
    expect(() => correoDePrueba('no-es-correo')).toThrow(/correo válido/)
  })
})

describe('enviarGuiaDePrueba', () => {
  it('no emite token y el enlace va a la entrada del portal sin sesión', async () => {
    await enviarGuiaDePrueba(conductor, 'admin@ejemplo.test')

    expect(emitirTokenPortal).not.toHaveBeenCalled()
    expect(enviados).toHaveLength(1)
    const [correo] = enviados
    expect(correo.to).toEqual(['admin@ejemplo.test'])
    expect(correo.subject).toMatch(/^\[PRUEBA\]/)
    expect(correo.html).not.toContain('token=')
    expect(correo.html).toContain('https://portal.ejemplo.test/public/portal"')
    expect(correo.html).toContain('Correo de prueba.')
    /// La nota de «botón personal» es mentira en la prueba: no debe aparecer.
    expect(correo.html).not.toContain('Este botón es personal')
  })
})

describe('enviarGuia (campaña real)', () => {
  it('emite el token del conductor y lo manda solo a su propio correo', async () => {
    await enviarGuia(conductor)

    expect(emitirTokenPortal).toHaveBeenCalledTimes(1)
    expect(enviados[0].to).toEqual([conductor.email])
    expect(enviados[0].html).toContain('token=TOKEN-REAL-DEL-CONDUCTOR')
  })

  it('ya no acepta un destinatario alternativo', () => {
    /// Si alguien vuelve a añadir el `overrideTo`, este test lo delata.
    expect(enviarGuia.length).toBe(1)
  })
})
