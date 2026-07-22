import { z } from 'zod'

// ═════════════════════════════════════════════════════
//  Listar configs visibles de un año.
//  Devuelve TODAS las configs activas del año, con un flag
//  `visible` resuelto:
//    - true  si hay registro con visible=true
//    - false si hay registro con visible=false
//    - true  por DEFAULT si no hay registro
// ═════════════════════════════════════════════════════
export const listarBonoConfigVisualSchema = z.object({
	anio: z.coerce.number().int().min(2000).max(2100)
})
export type ListarBonoConfigVisualInput = z.infer<typeof listarBonoConfigVisualSchema>

// ═════════════════════════════════════════════════════
//  Guardar (reemplazar) la selección de visibilidad para
//  un año. `visibles` es la lista de IDs de configuración
//  que el usuario quiere VISIBLES. Las que no estén en la
//  lista se marcan como `visible = false` (upsert en bloque).
// ═════════════════════════════════════════════════════
export const guardarBonoConfigVisualSchema = z.object({
	anio: z.number().int().min(2000).max(2100),
	visibles: z.array(z.string().uuid())
})
export type GuardarBonoConfigVisualInput = z.infer<typeof guardarBonoConfigVisualSchema>
