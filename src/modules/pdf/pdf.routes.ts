import { FastifyInstance } from 'fastify';
import { PdfController } from './pdf.controller';
import { authMiddleware } from '../../middlewares/auth.middleware';

export async function pdfRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authMiddleware);

  app.post('/pdf/from-html', PdfController.fromHtml);
}
