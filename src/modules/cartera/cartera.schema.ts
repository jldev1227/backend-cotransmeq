/**
 * Validación de entrada del módulo de cartera.
 *
 * Los montos llegan como texto cuando el abono va en multipart (con
 * comprobante) y como número cuando va en JSON: `z.coerce` acepta los dos.
 */
import { z } from 'zod'
import { MEDIOS_PAGO } from '../../lib/pagos/medios'
import { TRAMOS } from './cartera.calculo'
import { esDiaValido } from './cartera.condiciones'

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const dia = z.string().trim().refine(esDiaValido, 'Fecha inválida (AAAA-MM-DD)')

/// Vacío → 0: un campo de retención que el usuario no tocó llega como ''.
const monto = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? 0 : v),
  z.coerce
    .number({ invalid_type_error: 'Debe ser un número' })
    .finite()
    .min(0, 'No puede ser negativo')
    .max(999_999_999_999, 'Valor fuera de rango')
    .transform((v) => Math.round(v * 100) / 100),
)

const textoOpcional = (max: number) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z.string().trim().max(max).nullable().optional(),
  )

export const registrarAbonoSchema = z
  .object({
    fecha: dia,
    valor: monto,
    retefuente: monto,
    reteica: monto,
    reteiva: monto,
    otros_descuentos: monto,
    medio: z.enum(MEDIOS_PAGO, { errorMap: () => ({ message: 'Medio de pago no válido' }) }),
    referencia: textoOpcional(120),
    observaciones: textoOpcional(2000),
  })
  .refine((a) => a.valor + a.retefuente + a.reteica + a.reteiva + a.otros_descuentos > 0, {
    message: 'El abono debe tener algún valor o alguna retención',
    path: ['valor'],
  })

export type RegistrarAbonoInput = z.infer<typeof registrarAbonoSchema>

export const condicionesSchema = z
  .object({
    valor_total: z.union([z.number(), z.string()]).nullable().optional(),
    fecha_emision: z.string().nullable().optional(),
    plazo_dias: z.union([z.number(), z.string()]).nullable().optional(),
    fecha_vencimiento: z.string().nullable().optional(),
  })
  .strict()

export const ESTADOS_FILTRO = ['abiertas', 'todas', 'pendiente', 'abonada', 'vencida', 'pagada'] as const

export const filtrosFacturasSchema = z.object({
  cliente_id: z
    .string()
    .refine((v) => v === 'sin-cliente' || UUID.test(v), 'Cliente inválido')
    .optional(),
  estado: z.enum(ESTADOS_FILTRO).optional(),
  tramo: z.enum(TRAMOS as unknown as [string, ...string[]]).optional(),
  q: z.string().max(120).optional(),
})

export type FiltrosFacturasCartera = z.infer<typeof filtrosFacturasSchema>

export const eliminarAbonoSchema = z.object({ motivo: textoOpcional(500) }).partial()
