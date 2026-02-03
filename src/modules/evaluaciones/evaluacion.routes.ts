import { FastifyInstance } from 'fastify';
import { EvaluacionesController } from './evaluacion.controller';

export async function evaluacionesRoutes(app: FastifyInstance) {
  app.get('/evaluaciones', EvaluacionesController.list);
  app.get('/evaluaciones/:id', EvaluacionesController.findById);
  app.post('/evaluaciones', EvaluacionesController.create);
  app.put('/evaluaciones/:id', EvaluacionesController.update);
  app.delete('/evaluaciones/:id', EvaluacionesController.delete);

  // Rutas para responder y consultar resultados
  app.post('/evaluaciones/:id/responder', EvaluacionesController.responder);
  app.get('/evaluaciones/:id/resultados', EvaluacionesController.resultados);
  app.get('/evaluaciones/:id/verificar', EvaluacionesController.verificarDispositivo);
}
