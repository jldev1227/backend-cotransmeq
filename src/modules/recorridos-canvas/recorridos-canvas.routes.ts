import { FastifyInstance } from 'fastify'
import { authMiddleware } from '../../middlewares/auth.middleware'
import { requirePermission } from '../../middlewares/permissions.middleware'
import { RecorridosCanvasController } from './recorridos-canvas.controller'
import { RecorridosSnapshotsController } from './recorridos-snapshots.controller'
import { requireRecorridosEdicion } from './recorridos.middleware'

/**
 * Rutas del canvas de recorridos.
 *
 * El módulo es `recorridos` y NO `conductores`: `conductores` es
 * `general: true` (cualquier área autenticada tiene `full`), y con eso
 * cualquiera podría reescribir los tramos que alimentan la nómina. La regla
 * está en `config/permissions.ts` y su espejo del frontend.
 *
 * Aquí solo hay LECTURA: las escrituras del canvas viajan por socket
 * (`sheet:patch`), donde `RecorridosPatchService` vuelve a comprobar el área
 * porque los sockets no pasan por `requirePermission`.
 */
const MODULO = 'recorridos'

export async function recorridosCanvasRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authMiddleware)

  const puedeLeer = { preHandler: requirePermission(MODULO, 'read') }
  // `requirePermission` queda como registro de la regla en el mapa de módulos;
  // `requireRecorridosEdicion` es el que rechaza de verdad, sin depender del
  // modo `warn`.
  const puedeEscribir = {
    preHandler: [requirePermission(MODULO, 'full'), requireRecorridosEdicion],
  }

  // Ruta con literal antes que cualquier paramétrica del mismo prefijo, para
  // que Fastify no tenga que desambiguar.
  app.get('/recorridos/canvas/bonos', puedeLeer, RecorridosCanvasController.bonos)
  app.get('/recorridos/canvas', puedeLeer, RecorridosCanvasController.periodo)

  // Snapshots del periodo. Capturar y revertir son escrituras: cambian lo que
  // el resto de la sala está mirando.
  app.get('/recorridos/snapshots', puedeLeer, RecorridosSnapshotsController.listar)
  app.post('/recorridos/snapshots', puedeEscribir, RecorridosSnapshotsController.capturar)
  app.get('/recorridos/snapshots/:id', puedeLeer, RecorridosSnapshotsController.obtener)
  app.get('/recorridos/snapshots/:id/diff', puedeLeer, RecorridosSnapshotsController.diff)
  app.post(
    '/recorridos/snapshots/:id/revertir',
    puedeEscribir,
    RecorridosSnapshotsController.revertir,
  )
}

/**
 * Disparador del cron horario. Va en un plugin aparte porque NO lleva
 * `authMiddleware`: se autentica con el secreto de cabecera `x-cron-secret`.
 */
export async function recorridosSnapshotsCronRoutes(app: FastifyInstance) {
  app.post('/recorridos-snapshots/cron-hora', RecorridosSnapshotsController.cronHora)
}
