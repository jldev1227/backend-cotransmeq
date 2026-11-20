import { describe, expect, it } from 'vitest'
import {
  diasCubiertos,
  nuevoEscaneadoSchema,
} from '../src/modules/formularios-dinamicos/formularios-escaneados.schema'

const base = {
  assignmentId: 'e8d510f4-4744-4ae7-b62c-e0e6e1f07d90',
  conductorId: 'd10967dd-bd27-4a17-83dc-87999bfa45a3',
  vehicleId: 'f9b95220-9be0-4dcf-9f97-b7dcbacbf46d',
  dateFrom: '2026-08-22',
  dateTo: '2026-08-27',
  explanation: 'Inspecciones firmadas del período.',
  details: {},
  originalName: 'preoperacionales.pdf',
  byteSize: 1024,
  sha256: 'a'.repeat(64),
}

describe('PDF de formulario físico', () => {
  it('acepta rangos inclusivos aunque crucen mes o año', () => {
    expect(nuevoEscaneadoSchema.safeParse(base).success).toBe(true)
    expect(
      nuevoEscaneadoSchema.safeParse({ ...base, dateFrom: '2026-08-30', dateTo: '2026-09-02' })
        .success,
    ).toBe(true)
    expect(diasCubiertos(new Date('2026-08-22'), new Date('2026-08-27'))).toBe(6)
    expect(diasCubiertos(new Date('2026-12-30'), new Date('2027-01-02'))).toBe(4)
  })

  it('rechaza fechas inexistentes o invertidas', () => {
    expect(nuevoEscaneadoSchema.safeParse({ ...base, dateFrom: '2026-02-30' }).success).toBe(false)
    expect(nuevoEscaneadoSchema.safeParse({ ...base, dateTo: '2026-08-21' }).success).toBe(false)
  })
})
