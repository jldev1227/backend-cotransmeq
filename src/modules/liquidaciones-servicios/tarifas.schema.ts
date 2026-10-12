/**
 * Contrato de las tarifas por cliente (`tarifas_servicios`).
 *
 * Hasta oct-2026 el CRUD aceptaba cualquier cuerpo y `crearTarifa` ni siquiera
 * guardaba el cliente: como `cliente_id` es obligatorio, toda creación
 * reventaba en Prisma con un 500. Nadie lo notó porque ninguna pantalla lo
 * usaba; la ficha del cliente es la primera.
 */
import { z } from 'zod'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const esUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v)

const valor = (mensaje: string) => z.coerce.number().min(0, mensaje).max(1_000_000_000, 'Revisa el valor')

const camposTarifa = {
  /// Qué tabla de precios de operadora aplica. Nula en filas viejas; nuevas, obligatoria.
  operadora: z.enum(['PAREX', 'GEOPARK'], { errorMap: () => ({ message: 'Elige la operadora (PAREX o GEOPARK)' }) }),
  anio: z.coerce.number().int().min(2000, 'Año inválido').max(2100, 'Año inválido'),
  /// 24 h y 12 h son las que valoran un servicio: sin ellas la tarifa no sirve.
  valor_24h: z.coerce.number().positive('El valor de 24 h debe ser mayor que cero').max(1_000_000_000, 'Revisa el valor'),
  valor_12h: z.coerce.number().positive('El valor de 12 h debe ser mayor que cero').max(1_000_000_000, 'Revisa el valor'),
  valor_hora: valor('El valor de la hora no puede ser negativo'),
  valor_km: valor('El valor del km no puede ser negativo'),
  km_dia: z.coerce.number().int('Los km por día van enteros').min(0).max(5000).optional(),
  valor_pernocte: valor('El pernocte no puede ser negativo').optional(),
}

export const crearTarifaSchema = z.object({
  cliente_id: z.string().regex(UUID, 'Cliente inválido'),
  ...camposTarifa,
})

/// Editar admite reactivar (`activo: true`) además de los valores.
export const actualizarTarifaSchema = z
  .object({ ...camposTarifa, activo: z.boolean() })
  .partial()
  .refine((d) => Object.keys(d).length > 0, 'No hay cambios que guardar')

export type CrearTarifa = z.infer<typeof crearTarifaSchema>
export type ActualizarTarifa = z.infer<typeof actualizarTarifaSchema>
