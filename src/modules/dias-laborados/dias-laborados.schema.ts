import { z } from 'zod'

// ─── Solicitar acceso (enviar magic link) ──────────────
export const solicitarAccesoSchema = z.object({
  numero_identificacion: z.string().min(5).max(12)
})
export type SolicitarAccesoInput = z.infer<typeof solicitarAccesoSchema>

/**
 * Descripción del servicio de UN tramo. Obligatoria.
 *
 * Se declara una vez y se reutiliza en las cuatro rutas que escriben tramos
 * —portal, edición de un tramo, edición del día con tramo y carga por patrón—
 * porque si cada schema repitiera la regla, una de las cuatro se quedaría atrás
 * y entraría un tramo sin describir por la puerta de al lado.
 *
 * `trim()` antes del `min(1)`: un espacio en blanco no es una descripción.
 */
export const descripcionServicio = z
  .string()
  .trim()
  .min(1, 'Describe el servicio de este tramo')
  .max(500)

/** La misma regla donde el campo puede no venir, pero vacío nunca vale. */
export const descripcionServicioOpcional = descripcionServicio.optional()

/**
 * Días de desfase de un extremo del tramo respecto a la fecha del día.
 *
 * 0 = ese mismo día, 1 = el siguiente. El tope es 2 y no infinito a propósito:
 * en la operación un tramo nunca cruza más de una medianoche, el 2 está solo
 * para que un caso raro pueda registrarse, y sin tope un dedo torcido convierte
 * un turno en uno de sesenta días. Lo mismo vigila la CHECK
 * `chk_segmento_offset_dias`.
 */
export const diasOffset = z.number().int().min(0).max(2)

/**
 * Coherencia del horario de un tramo, contando el desfase de días.
 *
 * Se comparte porque las cuatro rutas que escriben tramos tienen que rechazar
 * lo mismo, y porque sin esto el que avisa es Postgres: sus CHECK dicen
 * «violates check constraint chk_segmento_horas», que no le explica nada a
 * quien está corrigiendo una planilla, y salen como 500 en vez de 400.
 */
export function exigirHorarioCoherente(
  v: {
    hora_inicio?: string | null
    hora_fin?: string | null
    dias_offset_inicio?: number | null
    dias_offset_fin?: number | null
  },
  ctx: z.RefinementCtx,
  prefijo: (string | number)[] = []
) {
  const offIni = v.dias_offset_inicio ?? 0
  const offFin = v.dias_offset_fin ?? 0

  if (offFin < offIni) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [...prefijo, 'dias_offset_fin'],
      message: 'El tramo no puede terminar un día antes de empezar.'
    })
    return
  }
  if (!v.hora_inicio || !v.hora_fin) return

  const min = (h: string, dias: number) =>
    h.split(':').reduce((a, x) => a * 60 + Number(x), 0) + dias * 24 * 60
  if (min(v.hora_fin, offFin) > min(v.hora_inicio, offIni)) return

  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: [...prefijo, 'hora_fin'],
    message:
      'La hora de fin debe ser posterior a la de inicio. Si el turno termina ' +
      'pasada la medianoche, marca la hora como del día siguiente.'
  })
}

// ─── Segmento cliente/vehículo dentro de un día laborado ──────────────
export const segmentoSchema = z.object({
  id: z.string().uuid().optional(),
  cliente_id: z.string().uuid().optional().nullable(),
  cliente_nombre: z.string().optional().nullable(),
  vehiculo_id: z.string().uuid().optional().nullable(),
  vehiculo_placa: z.string().min(1, 'Placa requerida'),
  hora_inicio: z.string().regex(/^\d{2}:\d{2}$/),
  hora_fin: z.string().regex(/^\d{2}:\d{2}$/),
  dias_offset_inicio: diasOffset.default(0),
  dias_offset_fin: diasOffset.default(0),
  horas_conducidas: z.number().min(0).max(24),
  km_inicial: z.number().int().nonnegative().optional().nullable(),
  km_final: z.number().int().nonnegative().optional().nullable(),
  pernocte: z.boolean().optional().default(false),
  descripcion_servicio: descripcionServicio
})
  .superRefine((v, ctx) => exigirHorarioCoherente(v, ctx))
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
