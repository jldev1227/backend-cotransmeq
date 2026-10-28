import { z } from 'zod'

export const TIPOS_PREGUNTA = [
  'TEXTO_CORTO', 'TEXTO_LARGO', 'OPCION_UNICA', 'OPCION_MULTIPLE',
  'SI_NO', 'ESCALA', 'NPS', 'NUMERO', 'FECHA', 'CORREO'
] as const

const opcionSchema = z.object({
  id: z.string().uuid(),
  texto: z.string().trim().min(1).max(160)
})

export const preguntaSchema = z.object({
  id: z.string().uuid(),
  titulo: z.string().trim().min(1).max(300),
  descripcion: z.string().trim().max(500).default(''),
  tipo: z.enum(TIPOS_PREGUNTA),
  requerida: z.boolean().default(false),
  opciones: z.array(opcionSchema).max(30).default([]),
  permite_otro: z.boolean().default(false),
  otro_etiqueta: z.string().trim().max(80).default('Otra (especificar)'),
  minimo: z.number().int().min(0).max(10).optional(),
  maximo: z.number().int().min(1).max(10).optional()
}).superRefine((p, ctx) => {
  if (['OPCION_UNICA', 'OPCION_MULTIPLE'].includes(p.tipo) && p.opciones.length < (p.permite_otro ? 0 : 2)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['opciones'], message: 'Agrega al menos dos opciones' })
  }
  if (!['OPCION_UNICA', 'OPCION_MULTIPLE'].includes(p.tipo) && p.permite_otro) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['permite_otro'], message: 'La opción abierta solo aplica a preguntas con opciones' })
  }
  if (new Set(p.opciones.map(o => o.id)).size !== p.opciones.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['opciones'], message: 'Las opciones deben ser únicas' })
  }
  if (p.tipo === 'ESCALA' && (p.minimo ?? 1) >= (p.maximo ?? 5)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['maximo'], message: 'El máximo debe ser mayor que el mínimo' })
  }
})

export const encuestaSchema = z.object({
  titulo: z.string().trim().min(3).max(180),
  descripcion: z.string().trim().max(4000).nullable().optional(),
  mensaje_final: z.string().trim().max(1000).nullable().optional(),
  nombre_modo: z.enum(['NO', 'OPCIONAL', 'OBLIGATORIO']).default('NO'),
  correo_modo: z.enum(['NO', 'OPCIONAL', 'OBLIGATORIO']).default('NO'),
  registrar_origen: z.boolean().default(false),
  politica_origen: z.enum(['PERMITIR', 'MARCAR', 'BLOQUEAR_HUELLA']).default('PERMITIR'),
  fecha_cierre: z.string().datetime({ offset: true }).nullable().optional(),
  preguntas: z.array(preguntaSchema).max(80).default([])
}).superRefine((e, ctx) => {
  if (new Set(e.preguntas.map(p => p.id)).size !== e.preguntas.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['preguntas'], message: 'Las preguntas deben tener ID único' })
  }
  if (!e.registrar_origen && e.politica_origen !== 'PERMITIR') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['politica_origen'], message: 'Activa el registro de origen para comparar respuestas' })
  }
})

export const respuestaSchema = z.object({
  nombre: z.string().trim().max(160).nullable().optional(),
  correo: z.string().trim().max(254).nullable().optional(),
  dispositivo: z.string().trim().max(255).nullable().optional(),
  respuestas: z.record(z.unknown())
})

export type Pregunta = z.infer<typeof preguntaSchema>
export type EncuestaInput = z.infer<typeof encuestaSchema>
export type RespuestaInput = z.infer<typeof respuestaSchema>
