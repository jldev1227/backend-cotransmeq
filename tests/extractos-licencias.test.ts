import { describe, expect, it } from 'vitest'
import { validarVigenciaLicencias } from '../src/modules/extractos/extractos.service'

describe('vigencia de licencia al emitir un extracto', () => {
  const hoy = '2026-10-20'
  const conductor = (fecha: string | null) => [{ nombre: 'ANA PÉREZ', licencia_vigencia: fecha }]

  it('acepta una licencia vigente hoy o después', () => {
    expect(() => validarVigenciaLicencias(conductor(hoy), hoy)).not.toThrow()
    expect(() => validarVigenciaLicencias(conductor('2027-01-01'), hoy)).not.toThrow()
  })

  it('rechaza una licencia vencida e identifica al conductor', () => {
    expect(() => validarVigenciaLicencias(conductor('2026-10-19'), hoy))
      .toThrow('La licencia de ANA PÉREZ venció')
  })

  it('exige fecha y rechaza fechas de calendario inválidas', () => {
    expect(() => validarVigenciaLicencias(conductor(null), hoy)).toThrow('Indique una fecha válida')
    expect(() => validarVigenciaLicencias(conductor('2026-02-31'), hoy))
      .toThrow('Indique una fecha válida')
    expect(() => validarVigenciaLicencias(conductor('2026-13-01'), hoy))
      .toThrow('Indique una fecha válida')
  })
})
