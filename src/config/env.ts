import { z } from 'zod'
import dotenv from 'dotenv'

dotenv.config()

const envSchema = z.object({
  PORT: z.string().transform(s => Number(s)).default('4000'),
  DATABASE_URL: z.string(),
  JWT_SECRET: z.string(),
  RESEND_API_KEY: z.string().optional(),
  FRONTEND_URL: z.string().optional(),
  EMAIL_LOGO_URL: z.string().optional(),
})

export const env = envSchema.parse(process.env)
