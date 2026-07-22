import { z } from 'zod'

// ═════════════════════════════════════════════════════
//  Cada bono referencia una configuración de liquidación
//  activa. La FK viaja como `config_liquidacion_id` (UUID).
// ═════════════════════════════════════════════════════

// Schema de un bono individual (input)
export const bonoInputSchema = z.object({
	registro_dia_id: z.string().uuid(),
	// Opcional: si el bono es a nivel de tramo (segmento) o de día completo
	segmento_id: z.string().uuid().nullable().optional(),
	// FK a configuraciones_liquidacion.id
	config_liquidacion_id: z.string().uuid(),
	// Snapshot opcional del valor al momento de crear el bono.
	// El frontend NO lo envía; el backend lo hidrata desde la config.
	valor: z.number().min(0).max(99_999_999).nullable().optional(),
	observaciones: z.string().max(500).nullable().optional()
})
export type BonoInput = z.infer<typeof bonoInputSchema>

// ═════════════════════════════════════════════════════
//  Reemplazo masivo de bonos para un conjunto de claves.
//  El frontend envía la lista DESEADA de bonos; el backend
//  hace diff (crea los nuevos, elimina los que ya no están).
// ═════════════════════════════════════════════════════
//  Una "clave" se construye en el cliente como:
//     `${config_liquidacion_id}::${registro_dia_id}::${segmento_id ?? ''}`
export const sincronizarBonosSchema = z.object({
	// Lista de bonos a crear (los que no estén ya persistidos)
	crear: z.array(bonoInputSchema),
	// Lista de IDs de bonos a eliminar (los que el usuario desmarcó)
	eliminar: z.array(z.string().uuid())
})
export type SincronizarBonosInput = z.infer<typeof sincronizarBonosSchema>

// ═════════════════════════════════════════════════════
//  Query: listar bonos de un rango de fechas (opcional conductor)
// ═════════════════════════════════════════════════════
export const listarBonosSchema = z.object({
	desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	conductor_id: z.string().uuid().optional()
})
export type ListarBonosInput = z.infer<typeof listarBonosSchema>
