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
