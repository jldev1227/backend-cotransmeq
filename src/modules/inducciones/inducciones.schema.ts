import { z } from 'zod'

// Enum para sedes
export const SedeEnum = z.enum([
  'yopal',
  'villanueva',
  'ambas',
  'lugar_prestacion'
])

// Schema de temas informados (11 temas del checklist)
export const temasInformadosSchema = z.object({
  peligros_riesgos: z.boolean().default(false),
  normas_comportamiento: z.boolean().default(false),
  uso_epp: z.boolean().default(false),
  prohibicion_alcohol_drogas: z.boolean().default(false),
  manejo_residuos: z.boolean().default(false),
  uso_agua_energia: z.boolean().default(false),
  procedimiento_derrames: z.boolean().default(false),
  alarma_evacuacion: z.boolean().default(false),
  pasos_emergencia: z.boolean().default(false),
  numeros_emergencia: z.boolean().default(false),
  seguridad_vial: z.boolean().default(false)
})

// Schema para crear una inducción de visitante
export const createInduccionVisitanteSchema = z.object({
  // Sede visitada
  sede: SedeEnum,

  // Fecha de la visita (ISO string)
  fecha: z.string().datetime(),

  // Datos del visitante
  visitante_nombre: z.string().min(1, 'El nombre del visitante es requerido').max(255),
  visitante_cargo: z.string().min(1, 'El cargo del visitante es requerido').max(255),
  visitante_cedula: z.string().min(1, 'La cédula del visitante es requerida').max(50),
  visitante_entidad: z.string().min(1, 'La entidad/empresa es requerida').max(255),
  visitante_firma: z.string().min(1, 'La firma del visitante es requerida'), // Base64

  // Temas informados (checklist)
  temas_informados: temasInformadosSchema,

  // Datos del responsable Cotransmeq (opcionales — se asignan desde el backend con el usuario autenticado)
  responsable_nombre: z.string().max(255).optional(),
  responsable_cargo: z.string().max(255).optional(),
  responsable_cedula: z.string().max(50).optional(),
  responsable_firma: z.string().optional(),

  // Observaciones opcionales
  observaciones: z.string().optional()
})

// Schema para actualizar una inducción
export const updateInduccionVisitanteSchema = z.object({
  sede: SedeEnum.optional(),
  fecha: z.string().datetime().optional(),
  visitante_nombre: z.string().min(1).max(255).optional(),
  visitante_cargo: z.string().min(1).max(255).optional(),
  visitante_cedula: z.string().min(1).max(50).optional(),
  visitante_entidad: z.string().min(1).max(255).optional(),
  visitante_firma: z.string().optional(),
  temas_informados: temasInformadosSchema.partial().optional(),
  responsable_nombre: z.string().min(1).max(255).optional(),
  responsable_cargo: z.string().min(1).max(255).optional(),
  responsable_cedula: z.string().min(1).max(50).optional(),
  responsable_firma: z.string().optional(),
  observaciones: z.string().optional()
})

// Schema para filtrar inducciones
export const filtrosInduccionSchema = z.object({
  sede: SedeEnum.optional(),
  fecha_desde: z.string().datetime().optional(),
  fecha_hasta: z.string().datetime().optional(),
  visitante_nombre: z.string().optional(),
  visitante_entidad: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20)
})

export type CreateInduccionVisitanteInput = z.infer<typeof createInduccionVisitanteSchema>
export type UpdateInduccionVisitanteInput = z.infer<typeof updateInduccionVisitanteSchema>
export type FiltrosInduccionInput = z.infer<typeof filtrosInduccionSchema>
export type TemasInformados = z.infer<typeof temasInformadosSchema>
export type Sede = z.infer<typeof SedeEnum>

// Labels legibles para los temas (útil para exportación y UI)
export const TEMAS_LABELS: Record<keyof TemasInformados, string> = {
  peligros_riesgos: 'Peligros y riesgos generales de las instalaciones (tráfico, locativo, químico, caídas, ruido)',
  normas_comportamiento: 'Normas básicas de comportamiento para visitantes dentro de las instalaciones',
  uso_epp: 'Uso obligatorio de Elementos de Protección Personal (EPP) según alcance de la visita',
  prohibicion_alcohol_drogas: 'Prohibición de ingreso bajo efectos de alcohol, drogas o sustancias psicoactivas',
  manejo_residuos: 'Manejo y clasificación de residuos en puntos ecológicos',
  uso_agua_energia: 'Uso racional del agua y la energía eléctrica durante la visita',
  procedimiento_derrames: 'Procedimiento a seguir en caso de derrame de combustible u otra sustancia química',
  alarma_evacuacion: 'Señal de alarma, rutas de evacuación y punto de encuentro de la sede',
  pasos_emergencia: 'Pasos de actuación ante una emergencia',
  numeros_emergencia: 'Números de emergencia (Bomberos, Cruz Roja, Policía, contacto de la empresa, etc.)',
  seguridad_vial: 'Normas de seguridad vial si se transporta en vehículo de la empresa'
}

export const SEDE_LABELS: Record<Sede, string> = {
  yopal: 'Sede Yopal',
  villanueva: 'Sede Villanueva',
  ambas: 'Visita a las dos Sedes',
  lugar_prestacion: 'Lugar Prestación Servicio'
}