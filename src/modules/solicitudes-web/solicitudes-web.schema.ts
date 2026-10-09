/**
 * Contrato del formulario público de la landing y de la gestión en el panel.
 *
 * Lo que entra por la landing se valida aquí con zod ANTES de tocar la base:
 * el formulario es anónimo y cualquiera puede pegarle al endpoint, así que
 * los límites de tamaño son parte de la defensa, no solo de la UX.
 */
import { z } from 'zod'

export const TIPOS_SOLICITUD = ['cotizacion', 'servicio', 'informacion', 'otro'] as const
export type TipoSolicitud = (typeof TIPOS_SOLICITUD)[number]

export const MODALIDADES = ['eventual', 'recurrente', 'contrato', 'sin_definir'] as const
export type Modalidad = (typeof MODALIDADES)[number]

export const ESTADOS_SOLICITUD = ['nueva', 'en_verificacion', 'verificada', 'atendida', 'descartada', 'spam'] as const
export type EstadoSolicitud = (typeof ESTADOS_SOLICITUD)[number]

export const PRIORIDADES = ['alta', 'media', 'baja'] as const
export type Prioridad = (typeof PRIORIDADES)[number]

export const NIVELES_RIESGO = ['bajo', 'medio', 'alto'] as const
export type NivelRiesgo = (typeof NIVELES_RIESGO)[number]

const texto = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional()

/// Los `<input>` mandan '' cuando el usuario no toca el campo; para la base y
/// para el clasificador eso es «no lo dijo», no un valor.
const vacioANull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v)

/** Solo dígitos, «+», espacios, guiones y paréntesis; entre 7 y 15 dígitos. */
const telefono = z
  .string()
  .trim()
  .min(7)
  .max(30)
  .regex(/^[0-9+()\-\s]+$/, 'Solo dígitos, espacios, guiones o paréntesis')
  .refine((v) => {
    const d = v.replace(/\D/g, '').length
    return d >= 7 && d <= 15
  }, 'El teléfono debe tener entre 7 y 15 dígitos')

export const crearSolicitudPublicaSchema = z.object({
  tipo: z.enum(TIPOS_SOLICITUD),
  nombre: z.string().trim().min(3).max(120),
  empresa: texto(160),
  documento: texto(30),
  cargo: texto(80),
  correo: z.string().trim().toLowerCase().email().max(160),
  telefono,
  origen: texto(160),
  destino: texto(160),
  fecha_servicio: z.preprocess(vacioANull, z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha en formato AAAA-MM-DD').nullable().optional()),
  pasajeros: z.preprocess(vacioANull, z.coerce.number().int().min(1).max(500).nullable().optional()),
  tipo_vehiculo: texto(60),
  modalidad: z.preprocess(vacioANull, z.enum(MODALIDADES).nullable().optional()),
  mensaje: z.string().trim().min(10).max(3000),
  /// Ley 1581: sin autorización expresa no se guarda nada.
  acepta_politica: z.literal(true, { errorMap: () => ({ message: 'Debes autorizar el tratamiento de datos' }) }),
  /// Campo trampa: los humanos no lo ven; si trae algo, es un bot.
  sitio_web: z.string().max(200).optional(),
  tiempo_llenado_ms: z.preprocess(vacioANull, z.coerce.number().int().min(0).max(86_400_000).nullable().optional()),
  origen_sitio: z.string().trim().max(80).optional()
})

export type CrearSolicitudPublica = z.infer<typeof crearSolicitudPublicaSchema>

export const listarSolicitudesSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(120).optional(),
  tipo: z.enum(TIPOS_SOLICITUD).optional(),
  estado: z.enum(ESTADOS_SOLICITUD).optional(),
  /// `pendientes` = nueva + en_verificacion + verificada: lo que aún requiere a alguien.
  pendientes: z.coerce.boolean().optional(),
  prioridad: z.enum(PRIORIDADES).optional(),
  riesgo: z.enum(NIVELES_RIESGO).optional(),
  orden: z.enum(['created_at', 'prioridad', 'estado', 'fecha_servicio', 'riesgo_puntaje']).default('created_at'),
  direccion: z.enum(['asc', 'desc']).default('desc')
})

export type ListarSolicitudes = z.infer<typeof listarSolicitudesSchema>

export const gestionarSolicitudSchema = z
  .object({
    estado: z.enum(ESTADOS_SOLICITUD).optional(),
    prioridad: z.enum(PRIORIDADES).optional(),
    /// `null` desasigna.
    asignado_a_id: z.string().uuid().nullable().optional(),
    nota: z.string().trim().min(1).max(2000).optional()
  })
  .refine((v) => v.estado || v.prioridad || v.asignado_a_id !== undefined || v.nota, {
    message: 'No hay nada que cambiar'
  })

export type GestionarSolicitud = z.infer<typeof gestionarSolicitudSchema>
