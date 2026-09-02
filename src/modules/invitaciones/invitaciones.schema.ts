import { z } from 'zod'
import { AREAS } from '../../config/permissions'

export const crearInvitacionSchema = z.object({
  correo: z.string().email('Correo inválido'),
  /// Derivado de `config/permissions.ts`: cuando este literal era una copia,
  /// añadir un área nueva al tipo no bastaba para poder invitar a ella.
  area: z.array(z.enum(AREAS as unknown as [string, ...string[]])).min(1, 'Selecciona al menos un área'),
  cargo: z.string().optional(),
})

export const aceptarInvitacionSchema = z.object({
  token: z.string().min(1),
  nombre: z.string().min(2, 'El nombre debe tener al menos 2 caracteres'),
  password: z.string().min(6, 'La contraseña debe tener al menos 6 caracteres'),
  telefono: z.string().optional(),
})
