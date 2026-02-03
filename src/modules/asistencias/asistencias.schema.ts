import { z } from 'zod'

// Enum para tipos de evento
export const TipoEventoEnum = z.enum([
  'capacitacion',
  'asesoria',
  'charla',
  'induccion',
  'reunion',
  'divulgacion',
  'otro'
])

// Helper para validar formato de hora HH:mm
const horaRegex = /^([0-1][0-9]|2[0-3]):([0-5][0-9])$/

// Schema para crear un formulario de asistencia
export const createFormularioAsistenciaSchema = z.object({
  tematica: z.string().min(1, 'La temática es requerida').max(255),
  objetivo: z.string().optional(), // Antes era "descripcion"
  fecha: z.string().datetime(), // Fecha en formato ISO
  hora_inicio: z.string().regex(horaRegex, 'Formato de hora inválido (HH:mm)').optional(),
  hora_finalizacion: z.string().regex(horaRegex, 'Formato de hora inválido (HH:mm)').optional(),
  tipo_evento: TipoEventoEnum.default('capacitacion'),
  tipo_evento_otro: z.string().max(255).optional(),
  lugar_sede: z.string().max(255).optional(),
  nombre_instructor: z.string().max(255).optional(),
  observaciones: z.string().optional()
}).refine(
  (data) => {
    // Si tipo_evento es "otro", tipo_evento_otro debe estar presente
    if (data.tipo_evento === 'otro' && !data.tipo_evento_otro) {
      return false
    }
    return true
  },
  {
    message: 'Debe especificar el tipo de evento cuando selecciona "Otro"',
    path: ['tipo_evento_otro']
  }
)

// Schema para actualizar un formulario de asistencia
export const updateFormularioAsistenciaSchema = z.object({
  tematica: z.string().min(1).max(255).optional(),
  objetivo: z.string().optional(),
  fecha: z.string().datetime().optional(),
  hora_inicio: z.string().regex(horaRegex, 'Formato de hora inválido (HH:mm)').optional(),
  hora_finalizacion: z.string().regex(horaRegex, 'Formato de hora inválido (HH:mm)').optional(),
  tipo_evento: TipoEventoEnum.optional(),
  tipo_evento_otro: z.string().max(255).optional(),
  lugar_sede: z.string().max(255).optional(),
  nombre_instructor: z.string().max(255).optional(),
  observaciones: z.string().optional(),
  activo: z.boolean().optional()
}).refine(
  (data) => {
    // Si tipo_evento es "otro", tipo_evento_otro debe estar presente
    if (data.tipo_evento === 'otro' && !data.tipo_evento_otro) {
      return false
    }
    return true
  },
  {
    message: 'Debe especificar el tipo de evento cuando selecciona "Otro"',
    path: ['tipo_evento_otro']
  }
)

// Schema para crear una respuesta de asistencia (público)
export const createRespuestaAsistenciaSchema = z.object({
  nombre_completo: z.string().min(1, 'El nombre completo es requerido').max(255),
  numero_documento: z.string().min(1, 'El número de documento es requerido').max(50),
  cargo: z.string().min(1, 'El cargo es requerido').max(255),
  numero_telefono: z.string().min(1, 'El número de teléfono es requerido').max(20),
  firma: z.string().min(1, 'La firma es requerida'), // Base64 de la imagen
  device_fingerprint: z.string().min(1, 'El fingerprint del dispositivo es requerido')
})

export type CreateFormularioAsistenciaInput = z.infer<typeof createFormularioAsistenciaSchema>
export type UpdateFormularioAsistenciaInput = z.infer<typeof updateFormularioAsistenciaSchema>
export type CreateRespuestaAsistenciaInput = z.infer<typeof createRespuestaAsistenciaSchema>
export type TipoEvento = z.infer<typeof TipoEventoEnum>
