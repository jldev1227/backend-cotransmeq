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
 * Las escrituras CELDA A CELDA viajan por socket (`sheet:patch`), donde
 * `RecorridosPatchService` vuelve a comprobar el área porque los sockets no
 * pasan por `requirePermission`. Por REST van solo las que cambian la
 * geometría de la hoja —alta y baja de filas— y devuelven una fila entera, que
 * no cabe en un acuse por celda.
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
  app.get('/recorridos/canvas/placas', puedeLeer, RecorridosCanvasController.placas)
  app.get('/recorridos/canvas', puedeLeer, RecorridosCanvasController.periodo)

  // Filas insertadas o eliminadas desde el propio canvas.
  app.post('/recorridos/canvas/filas', puedeEscribir, RecorridosCanvasController.crearFila)
  app.delete(
    '/recorridos/canvas/filas/:tipo/:id',
    puedeEscribir,
    RecorridosCanvasController.eliminarFila,
  )

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
