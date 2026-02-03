import { z } from 'zod'

// Enum para tipo de municipio
const TipoMunicipioEnum = z.enum(['Municipio', 'Isla', 'Area_no_municipalizada'])

export const createMunicipioSchema = z.object({
  codigo_departamento: z.number().int().positive("El código de departamento debe ser un número entero positivo"),
  nombre_departamento: z.string().min(2, "El nombre del departamento es obligatorio"),
  codigo_municipio: z.number().int().positive("El código de municipio debe ser un número entero positivo"),
  nombre_municipio: z.string().min(2, "El nombre del municipio es obligatorio"),
  tipo: TipoMunicipioEnum,
  longitud: z.number().refine(val => val >= -180 && val <= 180, "La longitud debe estar entre -180 y 180"),
  latitud: z.number().refine(val => val >= -90 && val <= 90, "La latitud debe estar entre -90 y 90")
})

export const updateMunicipioSchema = createMunicipioSchema.partial()

export const buscarMunicipiosSchema = z.object({
  nombre: z.string().optional(),
  departamento: z.string().optional(),
  tipo: TipoMunicipioEnum.optional(),
  codigo_departamento: z.number().int().optional(),
  page: z.number().int().positive().optional(),
  limit: z.number().int().positive().max(100).optional()
})

export type CreateMunicipioInput = z.infer<typeof createMunicipioSchema>
export type UpdateMunicipioInput = z.infer<typeof updateMunicipioSchema>
export type BuscarMunicipiosInput = z.infer<typeof buscarMunicipiosSchema>