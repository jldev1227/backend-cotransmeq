/**
 * Qué deja pedir Chromium al pintar HTML del cliente: nada de la red interna.
 * Solo casos que no necesitan DNS (direcciones literales y nombres internos).
 */
import { describe, expect, it } from 'vitest'
import { urlPermitidaParaPdf } from './pdf-red'

describe('urlPermitidaParaPdf', () => {
  it('deja pasar data:, blob: y about:', async () => {
    expect(await urlPermitidaParaPdf('data:image/png;base64,AAAA')).toBe(true)
    expect(await urlPermitidaParaPdf('about:blank')).toBe(true)
  })

  it.each([
    'http://127.0.0.1:4100/api/usuarios',
    'http://localhost:4100/',
    'http://[::1]:4100/',
    'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.5/',
    'http://172.20.1.1/',
    'http://192.168.1.10/',
    'http://100.100.1.1/',
    'http://[::ffff:10.0.0.1]/',
    'http://frontend:3000/',
    'http://postgres.internal/',
  ])('bloquea la red interna: %s', async (url) => {
    expect(await urlPermitidaParaPdf(url)).toBe(false)
  })

  it('bloquea esquemas que no son web', async () => {
    expect(await urlPermitidaParaPdf('file:///etc/passwd')).toBe(false)
    expect(await urlPermitidaParaPdf('ftp://example.com/x')).toBe(false)
  })

  it('deja pasar direcciones públicas', async () => {
    expect(await urlPermitidaParaPdf('https://8.8.8.8/logo.png')).toBe(true)
  })
})
