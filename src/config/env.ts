import { z } from 'zod'
import dotenv from 'dotenv'

dotenv.config()

const envSchema = z.object({
  PORT: z.string().transform(s => Number(s)).default('4000'),
  DATABASE_URL: z.string(),
  JWT_SECRET: z.string()
})

export const env = envSchema.parse(process.env)
