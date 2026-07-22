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

  // Exportar resultados a PDF
  app.get('/evaluaciones/:id/exportar-pdf', EvaluacionesController.exportarPDF);

  // Exportar resultado individual a PDF
  app.get('/evaluaciones/:id/resultados/:resultadoId/exportar-pdf', EvaluacionesController.exportarPDFIndividual);

  // Exportar ZIP con todos los PDFs individuales
  app.get('/evaluaciones/:id/exportar-zip', EvaluacionesController.exportarZIP);
}
