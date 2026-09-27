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

  it('crea un deep link cuando la solicitud viene de mobile', () => {
    expect(buildPortalAccessLink({
      canal: 'mobile',
      token: 'token.seguro',
      webBaseUrl: 'http://localhost:5173',
      mobileBaseUrl: 'cotransmeq://portal'
    })).toBe('cotransmeq://portal?token=token.seguro')
  })

  it('codifica el token y respeta parámetros existentes', () => {
    expect(buildPortalAccessLink({
      canal: 'mobile',
      token: 'token con+caracteres',
      webBaseUrl: 'http://localhost:5173',
      mobileBaseUrl: 'cotransmeq://portal?fuente=email'
    })).toBe('cotransmeq://portal?fuente=email&token=token%20con%2Bcaracteres')
  })
})
