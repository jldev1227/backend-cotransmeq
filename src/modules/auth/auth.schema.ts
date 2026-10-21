import { z } from 'zod'

export const loginSchema = z.object({
  correo: z.string().trim().toLowerCase().email(),
  password: z.string().min(6)
})
