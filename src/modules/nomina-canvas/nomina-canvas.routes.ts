import { FastifyInstance } from 'fastify';
import { NominaCanvasController } from './nomina-canvas.controller';
import { NominaEstadoController, NominaSnapshotsController } from './nomina-estado.controller';
import { NominaEnviosController } from './nomina-envios.controller';
import { NominaBorradoresController } from './nomina-borradores.controller';
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
  // ── Generación de borradores en lote ──
  //
  // `previo` es de lectura porque solo mira: dice quién ya tiene liquidación
  // y quién no tiene planillas, que es lo que hay que ver antes de lanzar.
  app.get('/nomina/borradores/previo', puedeLeer, NominaBorradoresController.previo);
  app.post('/nomina/borradores/generar', puedeEscribir, NominaBorradoresController.generar);
  app.get('/nomina/borradores/status/:jobId', puedeLeer, NominaBorradoresController.estado);
  /// Vuelve a copiar los días de una liquidación desde las planillas. Escribe,
  /// así que exige permiso de escritura como el resto de la generación.
  app.post(
    '/nomina/borradores/:id/refrescar-dias',
    puedeEscribir,
    NominaBorradoresController.refrescarDias,
  );
  /// Restaurar los bonos de una hoja desde lo marcado en recorridos. Pisa
  /// cantidades, así que exige el permiso de escritura igual que el refresco
  /// de días.
  app.post(
    '/nomina/borradores/:id/rehacer-bonos',
    puedeEscribir,
    NominaBorradoresController.rehacerBonos,
  );
  app.delete('/nomina/borradores/job/:jobId', puedeEscribir, NominaBorradoresController.cancelar);

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
