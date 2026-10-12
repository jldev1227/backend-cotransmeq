/**
 * Contrato de la API de mantenimiento de flota.
 *
 * Los `<input>` del panel mandan '' cuando el usuario no toca un campo y
 * números como texto; aquí se normaliza todo antes de que llegue al servicio,
 * que así solo ve `null` o valores válidos.
 */
import { z } from 'zod'
import { CLAVES_CATEGORIA, TIPOS_ADJUNTO } from './catalogo'

const vacioANull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v)

const fecha = z.preprocess(vacioANull, z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha en formato AAAA-MM-DD').nullable().optional())

/// Kilómetros y periodicidades: enteros no negativos. 3.000.000 km es más de
/// lo que recorre un bus en toda su vida útil; un número mayor es un dedo de más.
const kilometros = z.preprocess(vacioANull, z.coerce.number().int('Kilómetros enteros').min(0).max(3_000_000).nullable().optional())
const positivo = (max: number) => z.preprocess(vacioANull, z.coerce.number().int().min(1).max(max).nullable().optional())
const dinero = z.preprocess(vacioANull, z.coerce.number().min(0).max(999_999_999_999).nullable().optional())
const texto = (max: number) =>
  z.preprocess(vacioANull, z.string().trim().max(max).nullable().optional())

export const estadoPlanFiltro = z.enum(['todos', 'vencido', 'proximo', 'al_dia', 'sin_datos', 'pausado', 'alerta'])

export const listarPlanesSchema = z.object({
  q: z.string().trim().max(120).optional(),
  estado: estadoPlanFiltro.default('todos'),
  categoria: z.preprocess(vacioANull, z.enum(CLAVES_CATEGORIA).nullable().optional()),
  vehiculo_id: z.preprocess(vacioANull, z.string().uuid().nullable().optional()),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(500).default(50),
})
export type ListarPlanesInput = z.infer<typeof listarPlanesSchema>

const camposPlan = {
  categoria: z.enum(CLAVES_CATEGORIA),
  nombre: z.string().trim().min(2, 'Ponle un nombre al plan').max(255),
  periodicidad_km: positivo(500_000),
  periodicidad_meses: positivo(120),
  observaciones: texto(2000),
}

/**
 * Alta de un plan para uno o varios vehículos a la vez. Cada vehículo trae su
 * punto de partida (último km y fecha), porque cada uno tiene su odómetro.
 */
export const crearPlanSchema = z
  .object({
    ...camposPlan,
    vehiculos: z
      .array(
        z.object({
          vehiculo_id: z.string().uuid(),
          ultima_ejecucion_km: kilometros,
          ultima_ejecucion_fecha: fecha,
        }),
      )
      .min(1, 'Elige al menos un vehículo')
      .max(500),
  })
  .refine((p) => p.periodicidad_km || p.periodicidad_meses, {
    message: 'Indica cada cuántos kilómetros, cada cuántos meses o ambos',
    path: ['periodicidad_km'],
  })
export type CrearPlanInput = z.infer<typeof crearPlanSchema>

export const actualizarPlanSchema = z.object({
  categoria: camposPlan.categoria.optional(),
  nombre: camposPlan.nombre.optional(),
  periodicidad_km: camposPlan.periodicidad_km,
  periodicidad_meses: camposPlan.periodicidad_meses,
  observaciones: camposPlan.observaciones,
  ultima_ejecucion_km: kilometros,
  ultima_ejecucion_fecha: fecha,
  activo: z.boolean().optional(),
})
export type ActualizarPlanInput = z.infer<typeof actualizarPlanSchema>

export const ESTADOS_ORDEN = ['PROGRAMADO', 'EN_CURSO', 'EJECUTADO', 'CANCELADO'] as const

export const listarOrdenesSchema = z.object({
  q: z.string().trim().max(120).optional(),
  /// `abiertas` = PROGRAMADO + EN_CURSO: lo que alguien tiene que mover.
  estado: z.enum(['todas', 'abiertas', ...ESTADOS_ORDEN]).default('todas'),
  tipo: z.enum(['todos', 'PREVENTIVO', 'CORRECTIVO']).default('todos'),
  vehiculo_id: z.preprocess(vacioANull, z.string().uuid().nullable().optional()),
  plan_id: z.preprocess(vacioANull, z.string().uuid().nullable().optional()),
  desde: fecha,
  hasta: fecha,
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(20),
})
export type ListarOrdenesInput = z.infer<typeof listarOrdenesSchema>

const lineaRepuesto = z.object({
  descripcion: z.string().trim().min(1, 'Describe el repuesto').max(255),
  cantidad: z.coerce.number().positive().max(100_000).default(1),
  valor_unitario: z.coerce.number().min(0).max(999_999_999),
})

const camposOrden = {
  descripcion: z.string().trim().min(3, 'Describe el trabajo').max(4000),
  fecha: fecha,
  km: kilometros,
  taller: texto(255),
  responsable: texto(255),
  numero_factura: texto(60),
  repuestos: z.array(lineaRepuesto).max(200).optional(),
  costo_mano_obra: dinero,
  observaciones: texto(4000),
}

export const crearOrdenSchema = z
  .object({
    tipo: z.enum(['PREVENTIVO', 'CORRECTIVO']),
    plan_id: z.preprocess(vacioANull, z.string().uuid().nullable().optional()),
    vehiculo_id: z.preprocess(vacioANull, z.string().uuid().nullable().optional()),
    ...camposOrden,
  })
  .refine((o) => (o.tipo === 'PREVENTIVO' ? !!o.plan_id : !!o.vehiculo_id), {
    message: 'Una preventiva va ligada a un plan; una correctiva, a un vehículo',
    path: ['plan_id'],
  })
export type CrearOrdenInput = z.infer<typeof crearOrdenSchema>

export const actualizarOrdenSchema = z.object({
  descripcion: camposOrden.descripcion.optional(),
  fecha: camposOrden.fecha,
  km: camposOrden.km,
  taller: camposOrden.taller,
  responsable: camposOrden.responsable,
  numero_factura: camposOrden.numero_factura,
  repuestos: camposOrden.repuestos,
  costo_mano_obra: camposOrden.costo_mano_obra,
  observaciones: camposOrden.observaciones,
})
export type ActualizarOrdenInput = z.infer<typeof actualizarOrdenSchema>

export const cambiarEstadoOrdenSchema = z
  .object({
    estado: z.enum(['EN_CURSO', 'EJECUTADO', 'CANCELADO']),
    fecha_ejecucion: fecha,
    km_ejecucion: kilometros,
    motivo: texto(1000),
  })
  .refine((c) => c.estado !== 'CANCELADO' || !!c.motivo, {
    message: 'Di por qué se anula la orden',
    path: ['motivo'],
  })
export type CambiarEstadoOrdenInput = z.infer<typeof cambiarEstadoOrdenSchema>

export const costosSchema = z.object({
  desde: fecha,
  hasta: fecha,
  vehiculo_id: z.preprocess(vacioANull, z.string().uuid().nullable().optional()),
})
export type CostosInput = z.infer<typeof costosSchema>

export const tipoAdjuntoSchema = z.enum(TIPOS_ADJUNTO).catch('OTRO')
