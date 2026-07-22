import { FastifyRequest, FastifyReply } from 'fastify';
import { pdfFromHtml } from '../../services/pdf.service';

export class PdfController {
  static async fromHtml(request: FastifyRequest, reply: FastifyReply) {
    try {
      const body = request.body as any;
      const { html, landscape, marginMm, filename, format, heightScale, widthScale } = body || {};

      if (!html || typeof html !== 'string') {
        return reply.status(400).send({ error: 'Falta el campo "html" (string con el contenido a renderizar).' });
      }

      const allowedFormats = new Set(['Letter', 'A4', 'Legal', 'A3', 'A5', 'Tabloid']);
      const safeFormat =
        typeof format === 'string' && allowedFormats.has(format) ? (format as any) : 'Letter';

      // heightScale / widthScale: número entre 0.5 y 3.0. Default 1.0 (sin escala).
      // Protegemos contra valores absurdos que rompan la generación del PDF.
      let safeHeightScale: number | undefined;
      if (typeof heightScale === 'number' && heightScale >= 0.5 && heightScale <= 3) {
        safeHeightScale = heightScale;
      }
      let safeWidthScale: number | undefined;
      if (typeof widthScale === 'number' && widthScale >= 0.5 && widthScale <= 3) {
        safeWidthScale = widthScale;
      }

      const pdf = await pdfFromHtml({
        html,
        landscape: landscape !== false,
        marginMm: typeof marginMm === 'number' ? marginMm : 3,
        format: safeFormat,
        heightScale: safeHeightScale,
        widthScale: safeWidthScale,
      });

      const safeName = (filename || 'documento').replace(/[^a-z0-9_\-]/gi, '_');

      reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `inline; filename="${safeName}.pdf"`)
        .header('Content-Length', String(pdf.length))
        .send(pdf);
    } catch (error: any) {
      request.log.error({ err: error }, 'Error generando PDF');
      return reply.status(500).send({ error: error.message || 'Error generando PDF' });
    }
  }
}
