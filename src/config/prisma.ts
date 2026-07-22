import path from 'path'
import dotenv from 'dotenv'
import { PrismaClient } from '@prisma/client'
import { logger } from '../utils/logger'

// Cargar .env antes de leer DATABASE_URL (evita race al importar prisma antes que env.ts)
dotenv.config({ path: path.resolve(process.cwd(), '.env') })

function resolveDatabaseBaseUrl(): string {
  let url = (process.env.DATABASE_URL || '').trim().replace(/^["']|["']$/g, '')

  if (!url && process.env.DB_HOST) {
    const user = encodeURIComponent(process.env.DB_USER || '')
    const password = encodeURIComponent(process.env.DB_PASSWORD || '')
    const host = process.env.DB_HOST
    const port = process.env.DB_PORT || '5432'
    const database = process.env.DB_NAME || 'postgres'
    const params = new URLSearchParams({ schema: 'public' })
    if (host.includes('azure.com')) {
      params.set('sslmode', 'require')
    }
    url = `postgresql://${user}:${password}@${host}:${port}/${database}?${params.toString()}`
  }

  if (!url.startsWith('postgresql://') && !url.startsWith('postgres://')) {
    throw new Error(
      'DATABASE_URL inválida o vacía. Debe comenzar con postgresql:// (revise .env en la raíz del backend o use DB_HOST, DB_USER, DB_PASSWORD, DB_NAME).'
    )
  }

  return url
}

// Construir URL con parámetros de connection pooling
const getDatabaseUrl = () => {
  const baseUrl = resolveDatabaseBaseUrl()
  const poolParams = new URLSearchParams({
    connection_limit: '1',
    pool_timeout: '30',
    connect_timeout: '10',
    pgbouncer: 'true'
  })
  return `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}${poolParams.toString()}`
}

export const prisma = new PrismaClient({
  datasources: {
    db: {
      url: getDatabaseUrl()
    }
  },
  log: [
    { emit: 'event', level: 'query' },
    { emit: 'event', level: 'error' },
    { emit: 'event', level: 'info' },
    { emit: 'event', level: 'warn' },
  ],
})

// Log de conexión exitosa
prisma.$on('info', (e: any) => {
  logger.info({ 
    type: 'database-info',
    message: e.message,
    target: e.target 
  }, '📊 Database Info')
})

// Log de errores de base de datos
prisma.$on('error', (e: any) => {
  logger.error({
    type: 'database-error',
    message: e.message,
    target: e.target
  }, '❌ Database Error')
})

// Log de queries (solo en desarrollo)
if (process.env.NODE_ENV !== 'production') {
  prisma.$on('query', (e: any) => {
    logger.debug({
      type: 'database-query',
      query: e.query,
      params: e.params,
      duration: `${e.duration}ms`
    }, '🔍 Database Query')
  })
}

// Test de conexión inicial
export const testDatabaseConnection = async () => {
  try {
    console.log('🔌 Testing database connection...')
    
    await prisma.$connect()
    console.log('✅ Database connected successfully')
    
    logger.info({
      type: 'database-connection',
      status: 'connected',
      database: 'PostgreSQL'
    }, '✅ Database connected successfully')
    
    // Opcional: hacer un query simple para verificar
    const result = await prisma.$queryRaw`SELECT 1 as test`
    console.log('🏓 Database health check passed')
    
    logger.info({
      type: 'database-test',
      result: 'ok'
    }, '🏓 Database health check passed')
    
    return true
  } catch (error) {
    console.error('❌ Failed to connect to database:', error)
    
    logger.error({
      type: 'database-connection',
      status: 'failed',
      error: error instanceof Error ? error.message : 'Unknown error'
    }, '❌ Failed to connect to database')
    throw error
  }
}
