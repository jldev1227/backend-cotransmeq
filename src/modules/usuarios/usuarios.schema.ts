import { z } from 'zod'

// permisos: objeto JSON con keys por módulo y boolean values
const permisosSchema = z.record(z.boolean()).optional()

export const createUsuarioSchema = z.object({
  nombre: z.string().min(2, "Nombre debe tener al menos 2 caracteres"),
  telefono: z.string().optional(),
  correo: z.string().email(),
  password: z.string().min(6),
  permisos: permisosSchema,
  ultimoAcceso: z.string().datetime().optional()
})

export const updateUsuarioSchema = z.object({
  nombre: z.string().min(2).optional(),
  telefono: z.string().optional(),
  correo: z.string().email().optional(),
  role: z.string().optional(),
  cargo: z.string().optional().nullable(),
  area: z.array(z.enum(['administracion', 'operaciones', 'contabilidad', 'facturacion', 'talento_humano', 'hseq'])).optional(),
  activo: z.boolean().optional(),
})

export const updatePermisosSchema = z.object({
  permisos: z.record(z.boolean())
})
