import { z } from 'zod'

// Enums para validación (deben coincidir con enum_servicio_estado y enum_servicio_proposito_servicio en Prisma)
const EstadoServicioEnum = z.enum(['solicitado', 'planificado', 'en_curso', 'pendiente', 'realizado', 'planilla_asignada', 'liquidado', 'cancelado'])
// Aceptar tanto el formato con espacio (frontend) como con guion bajo (Prisma)
const PropositoServicioEnum = z.enum(['personal', 'personal y herramienta', 'personal_y_herramienta'])

// Helper para UUID opcional que acepta string vacío, null o undefined
const optionalUuid = z.union([
  z.literal('').transform(() => undefined),
  z.null().transform(() => undefined),
  z.string().uuid(),
  z.undefined()
]).optional()

export const createServicioSchema = z.object({
  conductor_id: optionalUuid,
  vehiculo_id: optionalUuid,
  cliente_id: z.string().uuid(),
  origen_id: z.string().uuid(),
  destino_id: z.string().uuid(),
  origen_especifico: z.string().optional(),
  destino_especifico: z.string().optional(),
  estado: EstadoServicioEnum.optional(),
  proposito_servicio: PropositoServicioEnum.optional(),
  fecha_solicitud: z.string().datetime(),
  fecha_realizacion: z.string().datetime().optional(),
  fecha_finalizacion: z.string().datetime().optional(),
  origen_latitud: z.number().optional(),
  origen_longitud: z.number().optional(),
  destino_latitud: z.number().optional(),
  destino_longitud: z.number().optional(),
  valor: z.number().positive().optional(),
  numero_planilla: z.string().optional(),
  observaciones: z.string().optional()
})

export const updateServicioSchema = createServicioSchema.partial()

export const cambiarEstadoSchema = z.object({
  estado: EstadoServicioEnum,
  observaciones: z.string().optional()
})

export const asignarPlanillaSchema = z.object({
  numero_planilla: z.string().min(1, "El número de planilla es requerido")
})

export const buscarServiciosSchema = z.object({
  estado: EstadoServicioEnum.optional(),
  conductor_id: z.string().uuid().optional(),
  vehiculo_id: z.string().uuid().optional(),
  cliente_id: z.string().uuid().optional(),
  origen_id: z.string().uuid().optional(),
  destino_id: z.string().uuid().optional(),
  fecha_desde: z.string().datetime().optional(),
  fecha_hasta: z.string().datetime().optional(),
  proposito_servicio: PropositoServicioEnum.optional(),
  page: z.number().int().positive().optional(),
  limit: z.number().int().positive().max(100).optional()
})

export type CreateServicioInput = z.infer<typeof createServicioSchema>
export type UpdateServicioInput = z.infer<typeof updateServicioSchema>
export type CambiarEstadoInput = z.infer<typeof cambiarEstadoSchema>
export type AsignarPlanillaInput = z.infer<typeof asignarPlanillaSchema>
export type BuscarServiciosInput = z.infer<typeof buscarServiciosSchema>