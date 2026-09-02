import { z } from 'zod'

// Categorías válidas para clasificar los lugares personalizados.
// `null` se permite para lugares sin categoría definida.
export const CATEGORIAS = [
	'POZO',
	'CAMPAMENTO',
	'PATIO',
	'VEREDA',
	'FINCA',
	'BASE',
	'ESTACION',
	'OTRO'
] as const

export const categoriaEnum = z.enum(CATEGORIAS).nullable().optional()

const latitudSchema = z
	.number()
	.refine((v) => v >= -90 && v <= 90, 'La latitud debe estar entre -90 y 90')
	.transform((v) => Number(v.toFixed(6)))

const longitudSchema = z
	.number()
	.refine((v) => v >= -180 && v <= 180, 'La longitud debe estar entre -180 y 180')
	.transform((v) => Number(v.toFixed(6)))

export const createCustomPlaceSchema = z.object({
	nombre: z.string().min(2, 'El nombre debe tener al menos 2 caracteres').max(255),
	categoria: categoriaEnum,
	descripcion: z.string().max(1000).optional().nullable(),
	direccion: z.string().max(1000).optional().nullable(),
	latitud: latitudSchema,
	longitud: longitudSchema,
	municipio_id: z.string().uuid('municipio_id debe ser un UUID válido').optional().nullable()
})

export const updateCustomPlaceSchema = createCustomPlaceSchema.partial()

export const searchCustomPlaceSchema = z.object({
	q: z.string().min(1).max(255).optional(),
	categoria: categoriaEnum,
	limit: z.coerce.number().int().positive().max(50).default(10)
})

export type CreateCustomPlaceInput = z.infer<typeof createCustomPlaceSchema>
export type UpdateCustomPlaceInput = z.infer<typeof updateCustomPlaceSchema>
export type SearchCustomPlaceInput = z.infer<typeof searchCustomPlaceSchema>
