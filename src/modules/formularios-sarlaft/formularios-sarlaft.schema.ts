import { z } from 'zod'

export const tipoFormularioEnum = z.enum([
  'cliente_proveedor',
  'accionistas',
  'personal',
  'autorizacion_propietario',
  'declaracion_empresa_transporte'
])

export const tipoDocumentoEnum = z.enum([
  // SARLAFT (SLFT-PTEE-FR-04 / 05 / 06)
  'cedula_representante',
  'rut',
  'certificado_existencia',
  'composicion_accionaria',
  // Autorización del Propietario (SLFT-PTEE-FR-12)
  'identidad_propietario',
  'identidad_tercero',
  'rut_propietario',
  'rut_tercero',
  'tarjeta_propiedad',
  'certificacion_bancaria',
  'cert_existencia_propietario',
  'cert_tradicion_vehiculo',
  'contrato_relacion_juridica',
  'formulario_conocimiento_tercero',
  'otros_anexos',
  // Declaración de empresa de transporte (GC-FOR-13)
  'anexo_alertas',
  'relacion_vehiculos'
])

// Schema base para una respuesta individual.
// El arreglo de strings cubre las preguntas `seleccion_multiple`.
const respuestaValorSchema = z.union([z.string(), z.number(), z.null(), z.array(z.string())])
const filaTablaSchema = z.record(z.string(), respuestaValorSchema)

// Schema del JSON payload (llega como string en multipart, lo parseamos)
export const submitFormularioSarlaftSchema = z.object({
  codigo_formulario: z.enum(['SLFT-PTEE-FR-04', 'SLFT-PTEE-FR-05', 'SLFT-PTEE-FR-06', 'SLFT-PTEE-FR-12', 'GC-FOR-13']),
  fecha_diligenciamiento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  respuestas: z.record(z.string(), z.union([respuestaValorSchema, filaTablaSchema, z.array(filaTablaSchema)])),
  /**
   * Doble digitación del correo de entrega. Viaja FUERA de `respuestas` a
   * propósito: es un control de captura, no una respuesta del formato, y no
   * debe quedar en el snapshot que se archiva. El backend la compara con
   * `DET-REP-04` y la descarta; validarla solo en el navegador no basta
   * porque el PDF se entrega a esa dirección.
   *
   * Solo la usa la declaración de empresa de transporte; los otros cuatro
   * formatos la omiten y siguen igual.
   */
  correo_confirmacion: z.string().trim().max(254).optional(),
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
