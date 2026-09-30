import { describe, expect, it } from 'vitest'
import { buildPortalAccessLink } from './portal-access-link'

describe('buildPortalAccessLink', () => {
  it('conserva el portal web para solicitudes web', () => {
    expect(buildPortalAccessLink({
      canal: 'web',
      token: 'token.seguro',
      webBaseUrl: 'http://localhost:5173/',
      mobileBaseUrl: 'cotransmeq://portal'
    })).toBe('http://localhost:5173/public/portal?token=token.seguro')
  })

  it('para mobile manda el https de la página puente: Gmail anula el esquema propio', () => {
    expect(buildPortalAccessLink({
      canal: 'mobile',
      token: 'token.seguro',
      webBaseUrl: 'http://localhost:5173/',
      mobileBaseUrl: 'cotransmeq://portal'
    })).toBe('http://localhost:5173/public/abrir-app?token=token.seguro')
  })

  it('respeta un MOBILE_PORTAL_URL https y codifica el token', () => {
    expect(buildPortalAccessLink({
      canal: 'mobile',
      token: 'token con+caracteres',
      webBaseUrl: 'http://localhost:5173',
      mobileBaseUrl: 'https://app.ejemplo.com/abrir?fuente=email'
    })).toBe('https://app.ejemplo.com/abrir?fuente=email&token=token%20con%2Bcaracteres')
  })
})
