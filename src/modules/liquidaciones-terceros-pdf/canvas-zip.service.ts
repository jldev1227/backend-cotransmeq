import { FastifyRequest, FastifyReply } from 'fastify';
import archiver from 'archiver';
import { pdfFromHtml } from '../../services/pdf.service';
import { buildFontsCss } from './fonts';

/**
 * ZIP con un PDF por hoja de un canvas de terceros.
 *
 * ── Por qué un ZIP y no un PDF de muchas páginas ──
 * Cada hoja del canvas de cierres es un par placa-propietario, y cada una se
 * archiva por separado: se manda al propietario, se adjunta a su liquidación y
 * se guarda en su carpeta. Un único PDF de cuarenta hojas obliga a partirlo a
 * mano justo después de generarlo, que es el trabajo que este endpoint existe
 * para evitar.
 *
 * ── Por qué secuencial ──
 * Cuarenta páginas de Chromium abiertas a la vez agotan la memoria del
 * contenedor antes de terminar la décima. `getBrowser()` reutiliza el navegador,
 * así que el coste por documento es una pestaña, no un arranque; ir de uno en
 * uno cuesta tiempo de pared pero no se cae.
 *
 * El cuerpo llega ya renderizado por la misma razón que en `canvas-pdf.service`:
 * lo que se imprime depende de las columnas que el usuario dejó activas, y
 * rehacer esa decisión aquí duplicaría los adaptadores del cliente.
 */

/** Tope del cuerpo entero. Cuarenta hojas de un mes cargado rondan los 8 MB. */
const MAX_BODY = 32_000_000;
const MAX_CSS = 400_000;

/**
 * Tope de documentos por petición.
 *
 * No es un límite del formato sino de la paciencia: a ~1,5 s por hoja, ciento
 * veinte son tres minutos con la petición abierta. Un mes real no pasa de
 * cuarenta; si alguien pide más, es que algo va mal en el cliente.
 */
const MAX_DOCS = 120;

interface DocumentoEntrada {
  html: string;
  filename: string;
}

/** Nombre seguro para una entrada del ZIP y para la cabecera de descarga. */
function nombreSeguro(valor: unknown, porDefecto: string): string {
  const limpio = String(valor || porDefecto)
    .normalize('NFD')
    /// Se quitan los diacríticos en vez de sustituir la letra entera: «MARÍA»
    /// debe quedar «MARIA», no «MAR_A», que es ilegible en una lista de cuarenta.
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9_\-]/gi, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_|_$/g, '');
  return limpio || porDefecto;
}

export const CanvasZipService = {
  /** POST /api/liquidaciones-terceros/canvas/pdf-zip */
  async renderizar(request: FastifyRequest, reply: FastifyReply) {
    try {
      const body = (request.body ?? {}) as {
        css?: unknown;
        documentos?: unknown;
        zipname?: unknown;
      };

      if (typeof body.css !== 'string' || !body.css.trim()) {
        return reply.status(400).send({ error: 'Falta el campo "css" (hoja de estilos del documento).' });
      }
      if (body.css.length > MAX_CSS) {
        return reply.status(413).send({ error: 'La hoja de estilos es demasiado grande.' });
      }
      if (!Array.isArray(body.documentos) || body.documentos.length === 0) {
        return reply.status(400).send({ error: 'Falta el campo "documentos" (una entrada por hoja).' });
      }
      if (body.documentos.length > MAX_DOCS) {
        return reply
          .status(413)
          .send({ error: `Demasiadas hojas en una sola petición (máximo ${MAX_DOCS}).` });
      }

      const documentos: DocumentoEntrada[] = [];
      for (const [i, item] of (body.documentos as any[]).entries()) {
        if (!item || typeof item.html !== 'string' || !item.html.trim()) {
          return reply.status(400).send({ error: `La hoja ${i + 1} llegó sin cuerpo ("html").` });
        }
        documentos.push({ html: item.html, filename: nombreSeguro(item.filename, `hoja_${i + 1}`) });
      }

      const totalBytes = documentos.reduce((n, d) => n + d.html.length, 0) + body.css.length;
      if (totalBytes > MAX_BODY) {
        return reply.status(413).send({ error: 'El conjunto de hojas es demasiado grande para una sola petición.' });
      }

      const zipname = nombreSeguro(body.zipname, 'documentos');

      /// Se generan TODOS los PDF antes de empezar a escribir el ZIP: si uno
      /// falla a mitad, el usuario recibe un error claro en vez de un archivo
      /// truncado que parece válido hasta que intenta abrirlo.
      const generados: Array<{ nombre: string; pdf: Buffer }> = [];
      const fuentes = buildFontsCss();

      for (const doc of documentos) {
        const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>${doc.filename}</title>
<style>${fuentes}</style>
<style>
  html, body { margin: 0; padding: 0; background: #fff; }
</style>
<style>${body.css}</style>
</head>
<body>${doc.html}</body>
</html>`;

        const pdf = await pdfFromHtml({
          html,
          landscape: true,
          format: 'Letter',
          marginMm: 0,
          preferCSSPageSize: true,
        });
        generados.push({ nombre: `${doc.filename}.pdf`, pdf });
      }

      const archivo = archiver('zip', { zlib: { level: 6 } });

      /// `archiver` emite el error por evento y no por rechazo de promesa: sin
      /// este manejador, un fallo al comprimir tumbaría el proceso entero en vez
      /// de responder un 500.
      let fallo: Error | null = null;
      archivo.on('error', (err) => {
        fallo = err;
        request.log.error({ err }, 'Error comprimiendo el ZIP de canvas');
      });

      reply
        .header('Content-Type', 'application/zip')
        .header('Content-Disposition', `attachment; filename="${zipname}.zip"`)
        .header('Cache-Control', 'private, max-age=0, no-store');

      /// Se envía el stream y no un Buffer: un mes completo son decenas de MB y
      /// materializarlos en memoria antes de responder duplica el pico.
      reply.send(archivo);

      for (const g of generados) {
        if (fallo) break;
        archivo.append(g.pdf, { name: g.nombre });
      }
      await archivo.finalize();
    } catch (error: any) {
      request.log.error({ err: error }, 'Error generando ZIP de PDFs de canvas de terceros');
      /// Si las cabeceras ya salieron, la respuesta está en curso y no se puede
      /// convertir en un JSON de error: solo queda cortarla.
      if (reply.sent) return
      return reply.status(500).send({ error: error?.message || 'Error generando el ZIP' });
    }
  },
};
