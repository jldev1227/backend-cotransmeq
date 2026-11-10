import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  conductor: vi.fn(),
  registros: vi.fn()
}))

vi.mock('../../config/prisma', () => ({
  prisma: {
    conductores: { findUnique: db.conductor },
    registro_dia_laboral: { findMany: db.registros }
  }
}))

import { fechaValida, pendientesDelCorte, periodoDeFecha } from '../../modules/dias-laborados/corte-diligenciamiento.service'

describe('secuencia de días por corte de nómina', () => {
  beforeEach(() => {
    db.conductor.mockReset()
    db.registros.mockReset()
    db.conductor.mockResolvedValue({ fecha_ingreso: null })
    db.registros.mockResolvedValue([])
  })

  it('cruza mes y año y admite cortes 25→24, 26→25 y mes natural', () => {
    expect(periodoDeFecha('2026-11-08', 21)).toEqual({ desde: '2026-10-21', hasta: '2026-11-20' })
    expect(periodoDeFecha('2026-11-26', 25)).toEqual({ desde: '2026-11-25', hasta: '2026-12-24' })
    expect(periodoDeFecha('2027-01-04', 26)).toEqual({ desde: '2026-12-26', hasta: '2027-01-25' })
    expect(periodoDeFecha('2026-02-15', 1)).toEqual({ desde: '2026-02-01', hasta: '2026-02-28' })
    expect(fechaValida('2028-02-29')).toBe(true)
    expect(fechaValida('2027-02-29')).toBe(false)
  })

  it('señala el 6 y 7 pendientes antes de permitir el 8, desde el ingreso', async () => {
    db.conductor.mockResolvedValue({ fecha_ingreso: new Date('2026-11-01T00:00:00.000Z') })
    db.registros.mockResolvedValue([1, 2, 3, 4, 5].map((dia) => ({ fecha: new Date(`2026-11-0${dia}T00:00:00.000Z`) })))
    const resumen = await pendientesDelCorte('conductor', '2026-11-08', 21)
    expect(resumen.inicioExigible).toBe('2026-11-01')
    expect(resumen.pendientes).toEqual(['2026-11-06', '2026-11-07', '2026-11-08'])
    expect(db.registros).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ deleted_at: null })
    }))
  })
})
