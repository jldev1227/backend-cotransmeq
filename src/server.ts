import 'dotenv/config'
import { buildApp } from './app'
import { env } from './config/env'
import { initSockets } from './sockets'
import { testDatabaseConnection } from './config/prisma'
import { logger } from './utils/logger'
import { startAccionesCorrectivasCronJobs } from './jobs/acciones-correctivas.cron'
import { startLiquidacionesSnapshotJob } from './jobs/snapshot-liquidaciones.job'
import { startCerrarServiciosConPlanillaCron } from './jobs/cerrar-servicios-con-planilla.cron'

async function start() {
  try {
    logger.info('🚀 Starting Cotransmeq Backend...')
    
    // Test database connection first
    await testDatabaseConnection()
    
    const app = buildApp()

    await app.ready() // Asegurarse de que todos los plugins estén registrados

    startAccionesCorrectivasCronJobs()
    startLiquidacionesSnapshotJob()
    startCerrarServiciosConPlanillaCron()

    const address = await app.listen({ port: env.PORT, host: '0.0.0.0' })
    
    // init sockets with underlying server
    initSockets(app.server as any)

    logger.info({
      server: address,
      docs: `http://localhost:${env.PORT}/docs`,
      port: env.PORT
    }, '✅ Server started successfully')
    
    console.log(`🚀 Server listening on ${address}`)
    console.log(`📚 Docs available at http://localhost:${env.PORT}/docs`)
  } catch (err) {
    logger.error({ error: err }, '❌ Failed to start server')
    console.error('Error starting server:', err)
    process.exit(1)
  }
}

start()

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('📴 Shutting down server...')
  try {
    const { prisma } = await import('./config/prisma')
    await prisma.$disconnect()
    logger.info('✅ Database disconnected successfully')
  } catch (error) {
    logger.error({ error }, '❌ Error disconnecting from database')
  }
  process.exit(0)
})
