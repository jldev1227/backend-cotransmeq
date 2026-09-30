import { FastifyInstance } from 'fastify';
import { EvaluacionesController } from './evaluacion.controller';
import { authMiddleware } from '../../middlewares/auth.middleware';

export async function evaluacionesRoutes(app: FastifyInstance) {
  // ============================================
  // RUTAS PROTEGIDAS (dashboard)
  // Devuelven la clave de respuestas y los datos, documentos y firmas de
  // quienes respondieron: nunca sin autenticación.
  // ============================================
  app.get('/evaluaciones', { onRequest: authMiddleware }, EvaluacionesController.list);
  app.get('/evaluaciones/:id', { onRequest: authMiddleware }, EvaluacionesController.findById);
  app.post('/evaluaciones', { onRequest: authMiddleware }, EvaluacionesController.create);
  app.put('/evaluaciones/:id', { onRequest: authMiddleware }, EvaluacionesController.update);
  app.delete('/evaluaciones/:id', { onRequest: authMiddleware }, EvaluacionesController.delete);

  // Resultados de quienes respondieron
  app.get('/evaluaciones/:id/resultados', { onRequest: authMiddleware }, EvaluacionesController.resultados);

  // Exportar resultados a PDF
  app.get('/evaluaciones/:id/exportar-pdf', { onRequest: authMiddleware }, EvaluacionesController.exportarPDF);

  // Exportar resultado individual a PDF
  app.get('/evaluaciones/:id/resultados/:resultadoId/exportar-pdf', { onRequest: authMiddleware }, EvaluacionesController.exportarPDFIndividual);

  // Exportar ZIP con todos los PDFs individuales
  app.get('/evaluaciones/:id/exportar-zip', { onRequest: authMiddleware }, EvaluacionesController.exportarZIP);

  // ============================================
  // RUTAS PÚBLICAS (página para responder la evaluación)
  // ============================================

  // La evaluación sin la clave de respuestas
  app.get('/public/evaluaciones/:id', EvaluacionesController.findPublic);

  // Responder y consultar la propia respuesta (por huella del dispositivo)
  app.post('/evaluaciones/:id/responder', EvaluacionesController.responder);
  app.get('/evaluaciones/:id/verificar', EvaluacionesController.verificarDispositivo);
}
