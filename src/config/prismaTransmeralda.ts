import path from 'path'
import dotenv from 'dotenv'
import { PrismaClient } from '@prisma/client'
import { logger } from '../utils/logger'

// Cargar .env antes de leer TRANSMERALDA_DATABASE_URL
dotenv.config({ path: path.resolve(process.cwd(), '.env') })

/**
 * Cliente Prisma para la base de datos TRANSMERALDA.
 *
 * Mismo schema que Cotransmeq (recargos_planillas, dias_laborales_planillas,
 * detalles_recargos_dias, etc.) — se usa para IMPORTS de recargos desde
 * Transmeralda hacia Cotransmeq.
 *
 * Es un cliente lazy: si `TRANSMERALDA_DATABASE_URL` no está definida en el
 * .env, los endpoints `/importar-desde-transmeralda/*` devuelven 503 sin
 * intentar conectar (no se cae el server).
 *
 * Para que la conexión NO interfiera con el prisma principal, este cliente
 * NO usa connection pool compartido ni logging de queries (solo errores).
 * Si en el futuro se quiere más telemetría, agregar `log` aquí.
 */
let _prismaTransmeralda: PrismaClient | null = null

export function getPrismaTransmeralda(): PrismaClient {
  if (_prismaTransmeralda) return _prismaTransmeralda

  const url = (process.env.TRANSMERALDA_DATABASE_URL || '').trim().replace(/^["']|["']$/g, '')
  if (!url) {
    throw new Error(
      'TRANSMERALDA_DATABASE_URL no está definida. Configurala en .env para usar los endpoints de importación desde Transmeralda.'
    )
  }

  if (!url.startsWith('postgresql://') && !url.startsWith('postgres://')) {
    throw new Error('TRANSMERALDA_DATABASE_URL inválida. Debe comenzar con postgresql://')
  }

  _prismaTransmeralda = new PrismaClient({
    datasources: {
      db: {
        url: `${url}${url.includes('?') ? '&' : '?'}connection_limit=5&connect_timeout=10`
      }
    },
    log: [{ emit: 'event', level: 'error' }]
  })

  logger.info(
    { type: 'transmeralda-prisma-init', host: url.split('@')[1]?.split('/')[0] },
    '🔌 PrismaTransmeralda inicializado'
  )

  return _prismaTransmeralda
}

/**
 * Helper: lanza un error claro si Transmeralda no está configurado.
 * Usado por los controllers antes de tocar el cliente.
 */
export function requireTransmeraldaConfigured(): void {
  const url = (process.env.TRANSMERALDA_DATABASE_URL || '').trim().replace(/^["']|["']$/g, '')
  if (!url) {
    const err: any = new Error(
      'TRANSMERALDA_DATABASE_URL no está configurada. Agrega la URL en .env.'
    )
    err.statusCode = 503
    throw err
  }
}
