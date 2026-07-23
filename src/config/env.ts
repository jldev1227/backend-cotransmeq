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
  // URL pública (single, sin coma) usada por los emails para construir enlaces
  // del portal conductor, certificados, invitaciones, etc. Debe ser la URL
  // canónica que verán los destinatarios al hacer clic. Si está vacía, se
  // intenta tomar la primera URL válida de FRONTEND_URL (separadas por coma).
  EMAIL_FRONTEND_URL: z.string().optional(),
  // SMTP fallback (usado cuando no hay RESEND_API_KEY)
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().transform(s => Number(s)).optional(),
  SMTP_SECURE: z.string().transform(s => s === 'true').optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  // Email de copia oculta (BCC) para copias de auditoría de notificaciones
  // a conductores. Si está configurado, se añade como BCC en todos los
  // emails de envío de desprendibles y primas.
  NOTIF_BCC_EMAIL: z.string().optional(),

  // AWS S3 — Certificados Tributarios
  AWS_REGION: z.string().optional(),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  AWS_S3_BUCKET_NAME: z.string().optional(),

  // Cola de borradores de liquidaciones de terceros
  BORRADOR_QUEUE_CONCURRENCY: z.string().transform(s => Number(s)).default('1'),
  BORRADOR_QUEUE_MAX_SIZE: z.string().transform(s => Number(s)).default('10'),
  BORRADOR_QUEUE_JOB_TTL_MS: z.string().transform(s => Number(s)).default('300000'),

  // Prefijo del número de planilla auto-generado (TM = Transmeralda, CM = Cotransmeq)
  PLANILLA_PREFIX: z.string().trim().min(1).max(5).optional().default('TM')
})

export const env = envSchema.parse(process.env)
