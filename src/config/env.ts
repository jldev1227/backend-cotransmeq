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
  // SMTP fallback (usado cuando no hay RESEND_API_KEY)
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().transform(s => Number(s)).optional(),
  SMTP_SECURE: z.string().transform(s => s === 'true').optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().optional(),
})

export const env = envSchema.parse(process.env)
