import { FastifyInstance } from 'fastify';
import { LiquidacionesTercerosPdfService } from './liquidaciones-terceros-pdf.service';
import { CanvasPdfService } from './canvas-pdf.service'
import { CanvasZipService } from './canvas-zip.service';
import { authMiddleware } from '../../middlewares/auth.middleware';

export async function liquidacionesTercerosPdfRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authMiddleware);

  // PDF nativo de la liquidación, renderizado en el backend con
  // Puppeteer + Chromium. Reemplaza al `/api/pdf/from-html` para este
  // flujo: aprovecha la hoja Letter landscape al máximo y usa fuentes
  // embebidas (Fraunces / Inter Tight / JetBrains Mono) para mantener
  // la identidad visual del preview.
  app.get('/liquidaciones-terceros/:id/pdf', LiquidacionesTercerosPdfService.descargarPdf);

  // PDF de un CANVAS. A diferencia del anterior, el cuerpo lo compone el
  // cliente: lo que se imprime depende del mes, la hoja y las columnas que
  // el usuario haya dejado activas en el selector del preview. Aquí solo
  // se le añaden las fuentes embebidas y se pasa por Chromium.
  // Ruta bajo `/canvas/` y no `/:id/`: `:id` es un UUID de cierre y una
  // ruta hermana con literal evita que Fastify tenga que desambiguar.
  //
  // `bodyLimit` explícito: el de Fastify es 1 MiB y el cuerpo de un mes
  // con varios cientos de filas lo pasa de largo. Sin esto el fallo llega
  // como un 413 genérico antes de tocar el handler.
  app.post(
    '/liquidaciones-terceros/canvas/pdf',
    { bodyLimit: 8 * 1024 * 1024 },
    CanvasPdfService.renderizar,
  );

  // Un PDF por hoja, empaquetados en un ZIP. `bodyLimit` mayor que el de arriba
  // porque aquí viajan las cuarenta hojas de un mes en una sola petición.
  app.post(
    '/liquidaciones-terceros/canvas/pdf-zip',
    { bodyLimit: 40 * 1024 * 1024 },
    CanvasZipService.renderizar,
  );
}