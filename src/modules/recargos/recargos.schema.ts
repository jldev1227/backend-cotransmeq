import { z } from 'zod'

// Schema para día laboral
export const diaLaboralSchema = z.object({
  dia: z.number().int().min(1).max(31),
  hora_inicio: z.number().min(0).max(100).optional().nullable(),
  hora_fin: z.number().min(0).max(100).optional().nullable(),
  total_horas: z.number().min(0).max(100).default(0),
  es_festivo: z.boolean().default(false),
  es_domingo: z.boolean().default(false),
  kilometraje_inicial: z.number().optional().nullable(),
  kilometraje_final: z.number().optional().nullable(),
  pernocte: z.boolean().default(false),
  disponibilidad: z.boolean().default(false),
  observaciones: z.string().optional().nullable()
})

// Schema para crear recargo
export const createRecargoSchema = z.object({
  conductor_id: z.string().uuid(),
  vehiculo_id: z.string().uuid(),
  empresa_id: z.string().uuid(),
  numero_planilla: z.string().max(50).optional().nullable(),
  mes: z.number().int().min(1).max(12),
  año: z.number().int().min(2000).max(2100),
  observaciones: z.string().optional().nullable(),
  dias_laborales: z.array(diaLaboralSchema).optional().default([]),
  
  // Relación con servicio
  servicio_id: z.string().uuid().optional().nullable(),
  
  // Estado del conductor
  estado_conductor: z.enum(['optimo', 'fatigado', 'regular', 'malo']).optional().nullable(),
  
  // Condiciones de vía (tipo de terreno)
  via_trocha: z.boolean().default(false),
  via_afirmado: z.boolean().default(false),
  via_mixto: z.boolean().default(false),
  via_pavimentada: z.boolean().default(false),
  
  // Riesgos de seguridad
  riesgo_desniveles: z.boolean().default(false),
  riesgo_deslizamientos: z.boolean().default(false),
  riesgo_sin_senalizacion: z.boolean().default(false),
  riesgo_animales: z.boolean().default(false),
  riesgo_peatones: z.boolean().default(false),
  riesgo_trafico_alto: z.boolean().default(false),
  
  // Evaluación
  fuente_consulta: z.enum(['conductor', 'gps', 'cliente', 'sistema']).optional().nullable(),
  calificacion_servicio: z.enum(['excelente', 'bueno', 'regular', 'malo']).optional().nullable(),
  
  // Métricas de tiempo
  tiempo_disponibilidad_horas: z.number().min(0).max(999).optional().nullable(),
  duracion_trayecto_horas: z.number().min(0).max(999).optional().nullable(),
  numero_dias_servicio: z.number().int().min(1).max(31).optional().nullable()
})

// Schema para actualizar recargo
export const updateRecargoSchema = createRecargoSchema.partial().extend({
  estado: z.enum(['pendiente', 'liquidada', 'facturada', 'no_esta', 'encontrada', 'borrador', 'activo', 'completado', 'liquidado', 'cancelado']).optional()
})

// Schema para filtros de búsqueda
export const buscarRecargosSchema = z.object({
  mes: z.string().optional(),
  año: z.string().optional(),
  ano: z.string().optional(), // Alternativa sin ñ
  conductor_id: z.string().uuid().optional(),
  vehiculo_id: z.string().uuid().optional(),
  empresa_id: z.string().uuid().optional(),
  estado: z.string().optional(),
  numero_planilla: z.string().optional(),
  page: z.string().optional().default('1'),
  limit: z.string().optional().default('50')
}).transform((data) => {
  // Si viene 'ano' sin ñ, usarlo como 'año'
  if (data.ano && !data.año) {
    data.año = data.ano
  }
  return data
})

// Schema para liquidar recargo
export const liquidarRecargoSchema = z.object({
  observaciones: z.string().optional()
})

// Schema para cambio de estado masivo
export const cambiarEstadoMultipleSchema = z.object({
  ids: z.array(z.string().uuid()).min(1, 'Debe proporcionar al menos un ID'),
  estado: z.enum([
    'pendiente',
    'liquidada',
    'facturada',
    'no_esta',
    'encontrada',
    'borrador',
    'activo',
    'completado',
    'liquidado',
    'cancelado'
  ])
})

export type CreateRecargoDTO = z.infer<typeof createRecargoSchema>
export type UpdateRecargoDTO = z.infer<typeof updateRecargoSchema>
export type DiaLaboralDTO = z.infer<typeof diaLaboralSchema>
export type BuscarRecargosDTO = z.infer<typeof buscarRecargosSchema>
