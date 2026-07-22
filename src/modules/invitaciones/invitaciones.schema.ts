import { z } from 'zod'

export const crearInvitacionSchema = z.object({
  correo: z.string().email('Correo inválido'),
  area: z.array(z.enum(['administracion', 'operaciones', 'contabilidad', 'facturacion', 'talento_humano', 'hseq'])).min(1, 'Selecciona al menos un área'),
  cargo: z.string().optional(),
})

export const aceptarInvitacionSchema = z.object({
  token: z.string().min(1),
  nombre: z.string().min(2, 'El nombre debe tener al menos 2 caracteres'),
  password: z.string().min(6, 'La contraseña debe tener al menos 6 caracteres'),
  telefono: z.string().optional(),
})
