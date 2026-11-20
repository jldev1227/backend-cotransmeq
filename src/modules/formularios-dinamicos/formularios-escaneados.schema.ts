import { z } from 'zod'

export const fechaEscaneadoSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`)
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
  }, 'Fecha inválida.')

export const nuevoEscaneadoSchema = z
  .object({
    formId: z.string().uuid(),
    conductorId: z.string().uuid(),
    vehicleId: z.string().uuid(),
    dateFrom: fechaEscaneadoSchema,
    dateTo: fechaEscaneadoSchema,
    explanation: z.string().trim().max(2000).default(''),
    novedades: z.array(z.object({
      fecha: fechaEscaneadoSchema,
      descripcion: z.string().trim().min(1).max(500),
    })).max(50).default([]),
    details: z
      .record(z.string().trim().min(1).max(80), z.string().trim().min(1).max(500))
      .default({})
      .refine((v) => Object.keys(v).length <= 20, 'Máximo 20 datos adicionales.'),
    originalName: z.string().trim().min(1).max(255),
    byteSize: z
      .number()
      .int()
      .positive()
      .max(25 * 1024 * 1024),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .refine((v) => v.dateTo >= v.dateFrom, {
    path: ['dateTo'],
    message: 'La fecha final debe ser igual o posterior a la inicial.',
  })
  .refine((v) => v.novedades.every((n) => n.fecha >= v.dateFrom && n.fecha <= v.dateTo), {
    path: ['novedades'],
    message: 'Las novedades deben estar dentro del período cubierto por el PDF.',
  })

/** Ambas fechas cuentan; UTC evita que el cambio de mes o de horario altere días. */
export function diasCubiertos(desde: Date, hasta: Date): number {
  return Math.round((hasta.getTime() - desde.getTime()) / 86_400_000) + 1
}
