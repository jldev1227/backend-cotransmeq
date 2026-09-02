import { FastifyInstance } from 'fastify';
import { NominaCanvasController } from './nomina-canvas.controller';
import { NominaEstadoController, NominaSnapshotsController } from './nomina-estado.controller';
import { NominaEnviosController } from './nomina-envios.controller';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { requirePermission } from '../../middlewares/permissions.middleware';

/**
 * El canvas cuelga del módulo `nomina` que ya existe en el mapa de permisos
 * (`administracion`, `talento_humano`, `facturacion`). No se crea un módulo
 * nuevo: quien puede liquidar la nómina puede abrir su canvas.
 */
const MODULO = 'nomina';

export async function nominaCanvasRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authMiddleware);

  const puedeLeer = { preHandler: requirePermission(MODULO, 'limited') };
  const puedeEscribir = { preHandler: requirePermission(MODULO, 'full') };

  // El libro del periodo.
  app.get('/nomina/canvas', puedeLeer, NominaCanvasController.periodo);
  app.get('/nomina/canvas/resumen', puedeLeer, NominaCanvasController.resumen);

  // Estado. El vocabulario es de lectura porque la barra lo necesita para
  // decidir qué botones pinta, incluso para quien no puede pulsarlos.
  app.get('/nomina/estados', puedeLeer, NominaEstadoController.vocabulario);
  app.patch('/nomina/liquidaciones/:id/estado', puedeEscribir, NominaEstadoController.cambiar);
  app.post('/nomina/estado-lote', puedeEscribir, NominaEstadoController.cambiarLote);
  app.get(
    '/nomina/liquidaciones/:id/historial-estados',
    puedeLeer,
    NominaEstadoController.historial,
  );

  // Versiones del periodo.
  app.get('/nomina/snapshots', puedeLeer, NominaSnapshotsController.listar);
  app.post('/nomina/snapshots', puedeEscribir, NominaSnapshotsController.capturar);
  app.get('/nomina/snapshots/:id', puedeLeer, NominaSnapshotsController.obtener);
  app.get('/nomina/snapshots/:id/diff', puedeLeer, NominaSnapshotsController.diff);
  app.post('/nomina/snapshots/:id/revertir', puedeEscribir, NominaSnapshotsController.revertir);

  // Envío de desprendibles. El PDF lo compone el servidor, así que el cuerpo
  // es pequeño y no hace falta subir el `bodyLimit` como en terceros.
  app.post('/nomina/envios/lote', puedeEscribir, NominaEnviosController.encolar);
  app.get('/nomina/envios/status/:jobId', puedeLeer, NominaEnviosController.status);
  app.delete('/nomina/envios/job/:jobId', puedeEscribir, NominaEnviosController.cancelar);
  app.get('/nomina/envios/periodo', puedeLeer, NominaEnviosController.estadoPeriodo);
  app.get('/nomina/envios/liquidacion/:id', puedeLeer, NominaEnviosController.historial);
}
