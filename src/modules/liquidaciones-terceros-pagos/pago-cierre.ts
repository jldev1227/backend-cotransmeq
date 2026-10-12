/**
 * Datos del pago al propietario de un cierre final de terceros.
 *
 * Sin dependencias de Prisma: lo importa `CierreEstadoService`, que valida el
 * pago ANTES de pasar el cierre a PAGADA, y los tests lo prueban sin base.
 */
import { z } from 'zod'
import { CLAVE_COMPROBANTE_PAGO_TERCERO, MEDIOS_PAGO } from '../../lib/pagos/medios'

const DIA = /^\d{4}-\d{2}-\d{2}$/
const esDia = (v: string) => {
  if (!DIA.test(v)) return false
  const d = new Date(`${v}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
}

const textoOpcional = (max: number) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z.string().trim().max(max).nullable().optional(),
  )

export const pagoCierreSchema = z.object({
  fecha: z
    .string({ required_error: 'Falta la fecha del pago' })
    .trim()
    .refine(esDia, 'La fecha del pago no es válida (AAAA-MM-DD)'),
  medio: z.enum(MEDIOS_PAGO, {
    errorMap: () => ({ message: 'Falta el medio del pago (transferencia, consignación, cheque, efectivo u otro)' }),
  }),
  referencia: textoOpcional(120),
  observaciones: textoOpcional(1000),
  /// La clave la devuelve `POST /liquidaciones-terceros-pagos/comprobante`.
  /// Se exige su forma exacta: ver `CLAVE_COMPROBANTE_PAGO_TERCERO`.
  comprobante_s3_key: z.preprocess(
    (v) => (v === '' ? null : v),
    z
      .string()
      .regex(CLAVE_COMPROBANTE_PAGO_TERCERO, 'El comprobante no corresponde a una subida de este módulo')
      .nullable()
      .optional(),
  ),
  comprobante_nombre: textoOpcional(255),
})

export type DatosPagoCierre = z.infer<typeof pagoCierreSchema>

/**
 * Valida el pago que acompaña el paso a PAGADA.
 *
 * Devuelve el primer motivo legible en vez de lanzar: `CierreEstadoService`
 * lo envuelve en su propio `ErrorEstado` (código `FALTA_PAGO`) para que el
 * header del canvas y el lote lo traten como cualquier otro rechazo.
 */
export function validarPagoCierre(pago: unknown): { pago: DatosPagoCierre | null; motivo: string | null } {
  if (pago == null || typeof pago !== 'object') {
    return { pago: null, motivo: 'Para marcar PAGADA indica la fecha y el medio del pago.' }
  }
  const r = pagoCierreSchema.safeParse(pago)
  if (!r.success) return { pago: null, motivo: r.error.errors[0]?.message ?? 'Datos del pago inválidos' }
  return { pago: r.data, motivo: null }
}
