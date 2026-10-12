/**
 * Contrato de los tanqueos. Lo que no pasa por aquí no llega a la base: los
 * ceros y los negativos se rechazan antes de que el rendimiento los divida.
 */
import { z } from 'zod'

/// Los combustibles líquidos de la flota, que son los que se miden en galones.
/// `vehiculos.combustible` admite además GAS, ELÉCTRICO e HÍBRIDO, pero el gas
/// se vende por m³ y la carga eléctrica por kWh: mezclarlos con galones daría un
/// «rendimiento» que no significa nada.
export const TIPOS_COMBUSTIBLE = ['DIESEL', 'GASOLINA'] as const
export type TipoCombustible = (typeof TIPOS_COMBUSTIBLE)[number]

/// `ANTICIPO` es la plata de viáticos que ya lleva el conductor;
/// `CREDITO_ESTACION` el convenio o los vales con la estación.
export const MEDIOS_PAGO = ['EFECTIVO', 'TARJETA', 'TRANSFERENCIA', 'CREDITO_ESTACION', 'ANTICIPO'] as const
export type MedioPago = (typeof MEDIOS_PAGO)[number]

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const FECHA = /^\d{4}-\d{2}-\d{2}$/

/// Los `<input>` mandan '' cuando no se tocan; para la base eso es «no lo dijo».
const vacioANull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v)

const textoOpcional = (max: number) =>
  z.preprocess(vacioANull, z.string().trim().max(max).nullable().optional())

const uuidOpcional = z.preprocess(vacioANull, z.string().regex(UUID, 'Identificador inválido').nullable().optional())

/**
 * Fecha y hora del tanqueo. Llega como la escribe un `datetime-local`
 * (`2026-10-10T14:30`, hora de Colombia) o como ISO con zona. Sin zona se
 * interpreta en Bogotá y no en la del servidor: en Railway el proceso corre en
 * UTC y un tanqueo de las 8 p. m. quedaba registrado al día siguiente.
 */
export function aInstante(valor: string): Date | null {
  const local = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(:\d{2})?$/.exec(valor)
  const d = local ? new Date(`${local[1]}T${local[2]}${local[3] ?? ':00'}-05:00`) : new Date(valor)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Día de calendario en Colombia → intervalo [gte, lt). Colombia no tiene horario de verano. */
export function rangoBogota(desde?: string | null, hasta?: string | null): { gte?: Date; lt?: Date } {
  return {
    gte: desde ? new Date(`${desde}T00:00:00-05:00`) : undefined,
    lt: hasta ? new Date(new Date(`${hasta}T00:00:00-05:00`).getTime() + 86_400_000) : undefined,
  }
}

/// Una hora de margen hacia el futuro por relojes desfasados; más que eso es un
/// año o un mes mal digitado, y un tanqueo «del futuro» quedaría como el último
/// del vehículo y haría saltar el error de odómetro en todos los siguientes.
const MARGEN_FUTURO_MS = 60 * 60 * 1000

const fechaHora = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const d = aInstante(v)
    if (!d) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Fecha y hora inválidas' })
      return z.NEVER
    }
    if (d.getTime() > Date.now() + MARGEN_FUTURO_MS) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'La fecha del tanqueo no puede ser futura' })
      return z.NEVER
    }
    return d
  })

export const tanqueoSchema = z.object({
  vehiculo_id: z.string().regex(UUID, 'Elige el vehículo'),
  conductor_id: uuidOpcional,
  fecha_hora: fechaHora,
  kilometraje: z.coerce.number().int('El odómetro va en kilómetros enteros').min(0, 'El odómetro no puede ser negativo').max(9_999_999),
  /// Mayor que cero: un tanqueo de 0 galones o de $0 no es un tanqueo, y en el
  /// rendimiento sería una división entre cero. El tope (1.000 gal, $100 M)
  /// atrapa los ceros de más: el tanque de un bus no pasa de 100 galones.
  galones: z.coerce.number().positive('Los galones deben ser mayores que cero').max(1000, 'Revisa los galones'),
  valor_total: z.coerce.number().positive('El valor debe ser mayor que cero').max(100_000_000, 'Revisa el valor'),
  tipo_combustible: z.enum(TIPOS_COMBUSTIBLE),
  estacion: textoOpcional(255),
  tanque_lleno: z.boolean(),
  medio_pago: z.preprocess(vacioANull, z.enum(MEDIOS_PAGO).nullable().optional()),
  observaciones: textoOpcional(2000),
})
export type TanqueoInput = z.infer<typeof tanqueoSchema>

export const filtrosSchema = z.object({
  vehiculo_id: uuidOpcional,
  conductor_id: uuidOpcional,
  /// Días de calendario en Colombia, ambos incluidos.
  desde: z.preprocess(vacioANull, z.string().regex(FECHA, 'Fecha en formato AAAA-MM-DD').nullable().optional()),
  hasta: z.preprocess(vacioANull, z.string().regex(FECHA, 'Fecha en formato AAAA-MM-DD').nullable().optional()),
  /// Solo los tanqueos cuyo tramo quedó por debajo de lo habitual.
  solo_alertas: z.preprocess((v) => v === '1' || v === 'true' || v === true, z.boolean()).optional(),
  pagina: z.coerce.number().int().min(1).default(1),
  por_pagina: z.coerce.number().int().min(1).max(200).default(25),
})
export type FiltrosTanqueos = z.infer<typeof filtrosSchema>

export const contextoSchema = z.object({
  fecha_hora: z.preprocess(vacioANull, z.string().nullable().optional()),
  /// El tanqueo que se está editando: no cuenta como su propio vecino.
  excluir: uuidOpcional,
})
