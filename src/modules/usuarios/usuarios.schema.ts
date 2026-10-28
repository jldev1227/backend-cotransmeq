import { z } from 'zod'
import { AREAS, ROUTE_PERMISSIONS } from '../../config/permissions'

// permisos: objeto JSON con keys por módulo y boolean values
const permisosSchema = z.record(z.boolean()).optional()

/// Se deriva de `config/permissions.ts` en vez de repetir el literal: al añadir
/// `mantenimiento` había cuatro copias del array de áreas y sólo se actualizó
/// una, así que el tipo `Area` la admitía pero el alta la rechazaba con 400.
const areaSchema = z.enum(AREAS as unknown as [string, ...string[]])

const nivelAccesoSchema = z.enum(['full', 'read', 'limited'])

/**
 * `permisos_rutas`: lista blanca de módulos por usuario.
 *
 *   { "formularios": "read", "flota": "read" }
 *
 * Las claves deben ser moduleId reales de `ROUTE_PERMISSIONS`; si no, se
 * rechaza en vez de guardarlas y descartarlas en silencio — un typo como
 * `"formulario"` guardado tal cual dejaría al usuario sin ese módulo sin que
 * nadie entendiera por qué.
 *
 * `null` y `{}` significan lo mismo: sin lista blanca, mandan las reglas por
 * área.
 */
const permisosRutasSchema = z
  .record(nivelAccesoSchema)
  .refine(
    (obj) => Object.keys(obj).every((k) => k in ROUTE_PERMISSIONS),
    (obj) => ({
      message:
        `Módulos desconocidos en permisos_rutas: ` +
        Object.keys(obj).filter((k) => !(k in ROUTE_PERMISSIONS)).join(', ') +
        `. Válidos: ${Object.keys(ROUTE_PERMISSIONS).join(', ')}.`,
    })
  )
  .nullable()

export const createUsuarioSchema = z.object({
  nombre: z.string().min(2, 'El nombre debe tener al menos 2 caracteres'),
  correo: z.string().email('Correo inválido'),
  /// Mantiene el mínimo histórico del alta manual y la aceptación de
  /// invitación; el cambio administrativo aplica la política reforzada de
  /// recuperación de cuenta.
  password: z.string().min(6, 'La contraseña debe tener al menos 6 caracteres'),
  telefono: z.string().optional(),
  cargo: z.string().optional().nullable(),
  role: z.string().optional(),
  area: z.array(areaSchema).optional(),
  permisos_rutas: permisosRutasSchema.optional(),
})

export const updateUsuarioSchema = z.object({
  nombre: z.string().min(2).optional(),
  telefono: z.string().optional(),
  correo: z.string().email().optional(),
  role: z.string().optional(),
  cargo: z.string().optional().nullable(),
  area: z.array(areaSchema).optional(),
  activo: z.boolean().optional(),
  permisos_rutas: permisosRutasSchema.optional(),
})

export const updatePermisosSchema = z.object({
  permisos: z.record(z.boolean())
})

/// Misma política que la recuperación de cuenta: así una contraseña puesta
/// por administración también sirve para el siguiente cambio del usuario.
export const cambiarPasswordUsuarioSchema = z.object({
  password: z
    .string()
    .min(8, 'La contraseña debe tener al menos 8 caracteres')
    .max(72, 'La contraseña no puede superar los 72 caracteres')
    .refine((valor) => /[a-zA-ZáéíóúñÁÉÍÓÚÑ]/.test(valor) && /\d/.test(valor), {
      message: 'La contraseña debe combinar al menos una letra y un número.'
    })
})
