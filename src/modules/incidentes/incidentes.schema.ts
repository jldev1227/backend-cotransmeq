/**
 * Contrato de entrada del módulo de incidentes.
 *
 * Los formularios mandan '' cuando el usuario no toca un campo; para la base
 * eso es «no lo dijo» (null), no un texto vacío ni un cero.
 */
import { z } from 'zod'
import { ACCIONES_ESTADO, ESTADOS_INCIDENTE, SEVERIDADES, TIPOS_INCIDENTE, TRAYECTOS } from './incidentes.dominio'

const vacioANull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v)

const texto = (max: number) =>
  z.preprocess(vacioANull, z.string().trim().max(max).nullable().optional())

const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha en formato AAAA-MM-DD')
const fechaOpcional = z.preprocess(vacioANull, fecha.nullable().optional())
const uuidOpcional = z.preprocess(vacioANull, z.string().uuid().nullable().optional())

/// Los montos llegan como número o como texto («1.250.000» no: el front manda el número limpio).
const dinero = z.preprocess(
  (v) => (v === '' || v === undefined ? null : typeof v === 'string' ? Number(v) : v),
  z.number().min(0).max(999_999_999_999).nullable().optional()
)

const entero = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? 0 : typeof v === 'string' ? Number(v) : v),
  z.number().int().min(0).max(500)
)

export const terceroSchema = z.object({
  nombre: z.string().trim().min(1, 'Nombre del tercero').max(160),
  documento: texto(30),
  placa: texto(15),
  telefono: texto(30),
  aseguradora: texto(120),
  lesionado: z.boolean().optional().default(false),
})
export type Tercero = z.infer<typeof terceroSchema>

const reporteBase = {
  tipo: z.enum(TIPOS_INCIDENTE),
  fecha,
  hora: z.preprocess(vacioANull, z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora en formato HH:MM').nullable().optional()),
  lugar: z.string().trim().min(3, 'Describe el lugar').max(255),
  municipio_id: uuidOpcional,
  trayecto: z.enum(TRAYECTOS).optional().default('LABORAL'),
  /// `CHOQUE` | `VOLCAMIENTO` | `ATROPELLO` | … (columna heredada del PESV).
  tipo_evento: texto(60),
  vehiculo_id: uuidOpcional,
  conductor_id: uuidOpcional,
  servicio_id: uuidOpcional,
  descripcion: z.string().trim().min(10, 'Describe qué pasó (mínimo 10 caracteres)').max(5000),
  severidad: z.preprocess(vacioANull, z.enum(SEVERIDADES).nullable().optional()),
  heridos: entero,
  fallecidos: entero,
  terceros: z.array(terceroSchema).max(20).optional().default([]),
  autoridad: texto(120),
  numero_informe: texto(60),
  costo_directo: dinero,
  costo_indirecto: dinero,
}

export const crearIncidenteSchema = z.object(reporteBase)
export type CrearIncidente = z.infer<typeof crearIncidenteSchema>

/// Editar el reporte manda el formulario entero, igual que al crear: así la
/// coherencia tipo–gravedad–lesionados se valida sobre el conjunto y no sobre
/// un parche que por sí solo parece válido.
export const editarIncidenteSchema = crearIncidenteSchema

export const investigacionSchema = z.object({
  fecha_investigacion: fechaOpcional,
  equipo_investigador: z
    .array(z.object({ nombre: z.string().trim().max(160), cargo: texto(120) }))
    .max(12)
    .optional()
    .default([])
    .transform((l) => l.filter((m) => m.nombre.length > 0)),
  actos_inseguros: texto(5000),
  condiciones_inseguras: texto(5000),
  factores_personales: texto(5000),
  factores_trabajo: texto(5000),
  analisis_porques: z
    .array(z.string().trim().max(1000))
    .max(7)
    .optional()
    .default([])
    .transform((l) => l.filter((p) => p.length > 0)),
  causas_identificadas: texto(3000),
  lecciones_aprendidas: texto(5000),
})
export type Investigacion = z.infer<typeof investigacionSchema>

export const cambiarEstadoSchema = z.object({
  accion: z.enum(ACCIONES_ESTADO),
  fecha_cierre: fechaOpcional,
  responsable_cierre: texto(255),
  observaciones_cierre: texto(3000),
})

export const listarSchema = z.object({
  q: z.string().trim().max(120).optional(),
  tipo: z.enum(TIPOS_INCIDENTE).optional(),
  estado: z.enum(ESTADOS_INCIDENTE).optional(),
  severidad: z.enum(SEVERIDADES).optional(),
  /// `vencido`: sin cerrar y con el plazo de 15 días cumplido.
  plazo: z.enum(['vencido']).optional(),
  desde: fecha.optional(),
  hasta: fecha.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})
export type FiltrosListado = z.infer<typeof listarSchema>

export const crearAccionSchema = z.object({
  descripcion_hallazgo: z.string().trim().min(10, 'Describe el hallazgo').max(5000),
  tipo_accion_ejecutar: z.enum(['CORRECTIVA', 'PREVENTIVA', 'MEJORA']).default('CORRECTIVA'),
  accion_numero: texto(50),
  tipo_hallazgo_detectado: texto(100),
  valoracion_riesgo: z.preprocess(vacioANull, z.enum(['ALTO', 'MEDIO', 'BAJO']).nullable().optional()),
  plan_accion: texto(3000),
  responsable_ejecucion: texto(255),
  fecha_limite_implementacion: fechaOpcional,
})
export type CrearAccion = z.infer<typeof crearAccionSchema>

export const vincularAccionSchema = z.object({ accion_id: z.string().uuid() })

export const indicadoresSchema = z.object({
  meses: z.coerce.number().int().min(3).max(36).default(12),
})
