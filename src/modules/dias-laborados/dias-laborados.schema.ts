import { z } from 'zod'

// ─── Solicitar acceso (enviar magic link) ──────────────
export const solicitarAccesoSchema = z.object({
  numero_identificacion: z.string().min(5).max(12)
})
export type SolicitarAccesoInput = z.infer<typeof solicitarAccesoSchema>

// ─── Segmento cliente/vehículo dentro de un día laborado ──────────────
export const segmentoSchema = z.object({
  id: z.string().uuid().optional(),
  cliente_id: z.string().uuid().optional().nullable(),
  cliente_nombre: z.string().optional().nullable(),
  vehiculo_id: z.string().uuid().optional().nullable(),
  vehiculo_placa: z.string().min(1, 'Placa requerida'),
  hora_inicio: z.string().regex(/^\d{2}:\d{2}$/),
  hora_fin: z.string().regex(/^\d{2}:\d{2}$/),
  // Turnos que cruzan medianoche: la hora corresponde al día siguiente (+1)
  inicio_dia_siguiente: z.boolean().optional().default(false),
  fin_dia_siguiente: z.boolean().optional().default(false),
  horas_conducidas: z.number().min(0).max(24),
  km_inicial: z.number().int().nonnegative().optional().nullable(),
  km_final: z.number().int().nonnegative().optional().nullable(),
  pernocte: z.boolean().optional().default(false),
  observaciones: z.string().optional().nullable()
})
export type SegmentoInput = z.infer<typeof segmentoSchema>

// ─── Placa de un día de MANTENIMIENTO ──────────────
// Un día de mantenimiento no es un recorrido (no tiene cliente, horario ni
// horas), así que la placa no cabe en un segmento: va en el registro padre.
// La placa se guarda como texto además del id porque es un snapshot — si el
// vehículo se da de baja o cambia de placa, el histórico debe seguir diciendo
// qué carro fue.
export const mantenimientoVehiculoFields = {
  mantenimiento_vehiculo_id: z.string().uuid().optional().nullable(),
  mantenimiento_vehiculo_placa: z
    .string()
    .trim()
    .min(1, 'Indica la placa del vehículo en mantenimiento')
    .max(20)
    .optional()
    .nullable()
}

/**
 * Exige placa cuando el día es de MANTENIMIENTO.
 *
 * Se expone como helper para que las tres rutas de escritura (portal, edición
 * admin y carga masiva) apliquen exactamente la misma regla; si viviera
 * duplicada en cada schema, una de las tres se quedaría atrás.
 */
export function exigirPlacaSiMantenimiento(
  tipo: string | null | undefined,
  placa: string | null | undefined,
  ctx: z.RefinementCtx,
  path: (string | number)[] = ['mantenimiento_vehiculo_placa']
) {
  if (tipo !== 'MANTENIMIENTO') return
  if (placa && placa.trim() !== '') return
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path,
    message: 'Un día de mantenimiento requiere la placa del vehículo'
  })
}

// ─── Crear / actualizar registro de día ──────────────
// Solo metadata global (tipo, fecha, observaciones).
// Los detalles (cliente, vehículo, horarios, horas) van en `segmentos`.
export const crearRegistroSchema = z
  .object({
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    tipo: z.enum(['LABORADO', 'DISPONIBLE', 'DESCANSO', 'MANTENIMIENTO']),
    observaciones: z.string().optional().nullable(),
    ...mantenimientoVehiculoFields,
    // Tramos: cada cambio de cliente/vehículo en el día.
    // Para tipo LABORADO se persiste con createMany.
    // Para otros tipos, no se requieren segmentos.
    segmentos: z.array(segmentoSchema).optional().default([])
  })
  .superRefine((v, ctx) =>
    exigirPlacaSiMantenimiento(v.tipo, v.mantenimiento_vehiculo_placa, ctx)
  )
export type CrearRegistroInput = z.infer<typeof crearRegistroSchema>

// ─── Query para listar registros ──────────────
export const listarRegistrosSchema = z.object({
  mes: z.string().regex(/^\d{4}-\d{2}$/).optional(),    // "2025-06"
  desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
})
export type ListarRegistrosInput = z.infer<typeof listarRegistrosSchema>

// ─── Query para calendario admin (todos los conductores) ──────────────
export const calendarAdminSchema = z.object({
  mes: z.coerce.number().int().min(1).max(12),
  anio: z.coerce.number().int().min(2020).max(2100),
  conductor_id: z.string().uuid().optional()
})
export type CalendarAdminInput = z.infer<typeof calendarAdminSchema>
