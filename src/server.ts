import 'dotenv/config'
/// Lo primero tras el `.env`: Sentry (si hay `SENTRY_DSN`) tiene que estar
/// listo antes de que cargue el resto. Sin DSN no hace nada.
import './lib/sentry'
import { buildApp } from './app'
import { env } from './config/env'
import { initSockets } from './sockets'
import { testDatabaseConnection } from './config/prisma'
import { logger } from './utils/logger'
import {
  instalarApagadoOrdenado,
  registrarCron,
  registrarServidor,
  cronsRegistrados,
} from './lib/apagado'
import { startAccionesCorrectivasCronJobs } from './jobs/acciones-correctivas.cron'
import { startLiquidacionesSnapshotJob } from './jobs/snapshot-liquidaciones.job'
import { startAdicionalesPeriodoSnapshotJob } from './jobs/snapshot-adicionales-periodo.job'
import { startLiquidacionesMensualSnapshotJob } from './jobs/snapshot-liquidaciones-mensual.job'
import { startCerrarServiciosConPlanillaCron } from './jobs/cerrar-servicios-con-planilla.cron'
import { startSincronizarKilometrajeCron } from './jobs/sincronizar-kilometraje.cron'
import { startVencimientosDocumentosCron } from './jobs/vencimientos-documentos.cron'
import { startMantenimientoPlanesCron } from './jobs/mantenimiento-planes.cron'
import { startVencimientosDocumentosConductorCron } from './jobs/vencimientos-documentos-conductor.cron'
import { startIncidentesInvestigacionCron } from './jobs/incidentes-investigacion.cron'
import { startRecorridosSnapshotJob } from './jobs/snapshot-recorridos.job'
import { startNominaSnapshotJob } from './jobs/snapshot-nomina.job'
import { startConsultarSimitCron } from './jobs/consultar-simit.cron'

async function start() {
  try {
    logger.info('🚀 Starting Cotransmeq Backend...')
    
    // Test database connection first
    await testDatabaseConnection()
    
    const app = buildApp()

    await app.ready() // Asegurarse de que todos los plugins estén registrados
    registrarServidor(app)

    /// CRONS: cada uno se arranca DENTRO de `registrarCron('nombre', …)`.
    /// Así el apagado ordenado (SIGTERM de Docker en cada despliegue) deja de
    /// programarlo y espera a que termine la ejecución en curso antes de
    /// cerrar la base. Un cron nuevo se añade igual, con su `start*()` que
    /// devuelva el `CronJob`:
    ///
    ///   registrarCron('mi-cron', startMiCron())
    ///
    /// Llamar a `startMiCron()` suelto funciona, pero el apagado no lo ve y
    /// Docker lo corta a medias. Ver `src/lib/apagado.ts`.
    registrarCron('acciones-correctivas', startAccionesCorrectivasCronJobs())
    registrarCron('snapshot-liquidaciones-terceros', startLiquidacionesSnapshotJob())
    registrarCron('snapshot-liquidaciones-mensual', startLiquidacionesMensualSnapshotJob())
    registrarCron('snapshot-adicionales-periodo', startAdicionalesPeriodoSnapshotJob())
    registrarCron('snapshot-recorridos', startRecorridosSnapshotJob())
    registrarCron('snapshot-nomina', startNominaSnapshotJob())
    registrarCron('cerrar-servicios-con-planilla', startCerrarServiciosConPlanillaCron())
    registrarCron('sincronizar-kilometraje', startSincronizarKilometrajeCron())
    registrarCron('vencimientos-documentos', startVencimientosDocumentosCron())
    registrarCron('mantenimiento-planes', startMantenimientoPlanesCron())
    registrarCron('vencimientos-documentos-conductor', startVencimientosDocumentosConductorCron())
    registrarCron('incidentes-investigacion', startIncidentesInvestigacionCron())
    registrarCron('consultar-simit', startConsultarSimitCron())
    logger.info({ crons: cronsRegistrados() }, '⏰ Crons registrados para el apagado ordenado')

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

/// Antes de `start()`: un SIGTERM que llegue durante el arranque también se
/// atiende. Antes solo había SIGINT, y el SIGTERM de Docker mataba el proceso
/// con los crons a medias (ver `src/lib/apagado.ts`).
instalarApagadoOrdenado()

start()
