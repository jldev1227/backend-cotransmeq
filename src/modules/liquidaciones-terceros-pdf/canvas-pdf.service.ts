import { FastifyRequest, FastifyReply } from 'fastify';
import { pdfFromHtml } from '../../services/pdf.service';
import { buildFontsCss } from './fonts';

/**
 * PDF de un CANVAS del módulo de terceros (cierres, adicionales,
 * ocasional, ingresos).
 *
 * ── Por qué el cuerpo llega ya renderizado ──
 * `descargarPdf` (el hermano de al lado) construye el HTML aquí porque su
 * documento es UNO: la liquidación de un cierre, con una estructura fija.
 * Los canvas no: lo que se imprime de ellos depende de qué mes está
 * abierto, de qué hoja y —sobre todo— de qué columnas ha elegido el
 * usuario en el selector del preview. Rehacer esa decisión en el servidor
 * significaría duplicar los cuatro adaptadores del cliente y mantener las
 * dos copias de acuerdo sobre qué columnas existen.
 *
 * Así que el cliente manda el cuerpo y su hoja de estilos —los mismos que
 * ya tiene en pantalla, de modo que el PDF ES el preview— y el servidor
 * aporta lo único que el navegador no puede: las fuentes embebidas
 * (Fraunces / Inter Tight / JetBrains Mono) y Chromium.
 *
 * El HTML se renderiza en una página aislada de Puppeteer, sin sesión ni
 * cookies; no hay nada que un cliente autenticado pueda alcanzar mandando
 * marcado propio que no alcanzara ya con su propio navegador.
 */

/** Tope del cuerpo. Un mes con 400 filas ronda los 400 KB. */
const MAX_HTML = 6_000_000;
const MAX_CSS = 400_000;

export const CanvasPdfService = {
  /** POST /api/liquidaciones-terceros/canvas/pdf */
  async renderizar(request: FastifyRequest, reply: FastifyReply) {
    try {
      const body = (request.body ?? {}) as {
        html?: unknown;
        css?: unknown;
        filename?: unknown;
        landscape?: unknown;
      };

      if (typeof body.html !== 'string' || !body.html.trim()) {
        return reply
          .status(400)
          .send({ error: 'Falta el campo "html" (cuerpo del documento).' });
      }
      if (typeof body.css !== 'string' || !body.css.trim()) {
        return reply
          .status(400)
          .send({ error: 'Falta el campo "css" (hoja de estilos del documento).' });
      }
      if (body.html.length > MAX_HTML || body.css.length > MAX_CSS) {
        return reply
          .status(413)
          .send({ error: 'El documento es demasiado grande para renderizarlo.' });
      }

      const filename = String(body.filename || 'documento').replace(
        /[^a-z0-9_\-]/gi,
        '_',
      );

      const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>${filename}</title>
<style>${buildFontsCss()}</style>
<style>
  html, body { margin: 0; padding: 0; background: #fff; }
</style>
<style>${body.css}</style>
</head>
<body>${body.html}</body>
</html>`;

      // `preferCSSPageSize`: el `@page { size: letter landscape }` viaja en
      // el CSS del documento, igual que en el PDF de una liquidación.
      const pdf = await pdfFromHtml({
        html,
        landscape: body.landscape !== false,
        format: 'Letter',
        marginMm: 0,
        preferCSSPageSize: true,
      });

      reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `inline; filename="${filename}.pdf"`)
        .header('Content-Length', String(pdf.length))
        .header('Cache-Control', 'private, max-age=0, no-store')
        .send(pdf);
    } catch (error: any) {
      request.log.error({ err: error }, 'Error generando PDF de canvas de terceros');
      return reply
        .status(500)
        .send({ error: error?.message || 'Error generando PDF' });
    }
  },
};
