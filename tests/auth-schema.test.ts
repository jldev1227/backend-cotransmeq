import { describe, expect, it } from 'vitest'
import { loginSchema } from '../src/modules/auth/auth.schema'

describe('loginSchema', () => {
  it('recorta espacios y normaliza el correo a minúsculas', () => {
    const resultado = loginSchema.parse({
      correo: '  1227JLdev@gmail.com  ',
      password: 'clave-de-prueba'
    })

    expect(resultado.correo).toBe('1227jldev@gmail.com')
  })
})
