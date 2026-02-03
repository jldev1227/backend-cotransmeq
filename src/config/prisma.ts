import { PrismaClient } from '@prisma/client'
import { logger } from '../utils/logger'

// Construir URL con parámetros de connection pooling
const getDatabaseUrl = () => {
  const baseUrl = process.env.DATABASE_URL || ''
  const poolParams = new URLSearchParams({
    'connection_limit': '20',      // Máximo 20 conexiones por instancia
    'pool_timeout': '20',           // Esperar 20s antes de timeout
    'connect_timeout': '10'         // Timeout de conexión inicial
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
