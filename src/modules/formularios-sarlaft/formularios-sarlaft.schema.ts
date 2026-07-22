import { z } from 'zod'

export const tipoFormularioEnum = z.enum(['cliente_proveedor', 'accionistas', 'personal'])

export const tipoDocumentoEnum = z.enum(['cedula_representante', 'rut', 'certificado_existencia', 'composicion_accionaria'])

// Schema base para una respuesta individual
const respuestaValorSchema = z.union([z.string(), z.number(), z.null()])
const filaTablaSchema = z.record(z.string(), respuestaValorSchema)

// Schema del JSON payload (llega como string en multipart, lo parseamos)
export const submitFormularioSarlaftSchema = z.object({
  codigo_formulario: z.enum(['GC-FR-04', 'GC-FR-05', 'GC-FR-06']),
  fecha_diligenciamiento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  respuestas: z.record(z.string(), z.union([respuestaValorSchema, filaTablaSchema, z.array(filaTablaSchema)])),
  contexto: z.object({
    user_agent: z.string().optional(),
    referer: z.string().optional()
  }).optional()
})

export type SubmitFormularioSarlaftInput = z.infer<typeof submitFormularioSarlaftSchema>

// Schema de cada archivo del multipart — Fastify los expone en request.files
export interface ArchivoUpload {
  fieldname: string
  filename: string
  mimetype: string
  buffer: Buffer
  size: number
}
