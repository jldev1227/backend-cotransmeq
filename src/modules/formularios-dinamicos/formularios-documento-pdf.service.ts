import { FastifyRequest, FastifyReply } from 'fastify'
import { pdfFromHtml } from '../../services/pdf.service'

/**
 * PDF del documento de un envío de formulario dinámico.
 *
 * ── Por qué el cuerpo llega ya renderizado ──
 * La disposición del documento se DERIVA de la definición del formulario: de los
 * diecinueve tipos de campo, del catálogo de opciones de cada uno y de si sus
 * escalas coinciden. Rehacer esa decisión aquí significaría un segundo
 * renderizador que tendría que mantenerse de acuerdo con el del cliente sobre
 * cada detalle, y que divergiría de él a la primera modificación —con el
 * agravante de que la divergencia no rompe nada: simplemente el PDF sale
 * distinto del preview y nadie lo nota hasta que un auditor compara.
 *
 * Así que el cliente manda el cuerpo y su hoja de estilos —los mismos que ya
 * tiene en pantalla, de modo que el PDF ES el preview— y el servidor aporta lo
 * único que el navegador no puede dar por sí solo: Chromium en un contexto
 * aislado y la espera a que las imágenes terminen de cargar.
 *
 * ── Sobre las imágenes ──
 * Las fotos y firmas viajan como URL firmadas de S3, absolutas. `pdfFromHtml`
 * espera a que `document.images` termine antes de imprimir, así que Chromium las
 * descarga solo. El logo del membrete sí llega como data-URL: es una ruta
 * relativa del cliente y `setContent` no tiene URL base contra la que resolverla.
 *
 * ── Seguridad ──
 * El HTML se renderiza en una página aislada de Puppeteer, sin sesión ni
 * cookies. No hay nada que un cliente autenticado pueda alcanzar mandando
 * marcado propio que no alcanzara ya con su propio navegador.
 */

/** Tope del cuerpo. Un preoperacional de 131 ítems ronda los 200 KB. */
const MAX_HTML = 6_000_000
const MAX_CSS = 400_000

/**
 * Tipografía base del documento.
 *
 * Se declara explícita en vez de heredar: Chromium arranca sin la hoja de
 * estilos de la aplicación, así que sin esto el PDF saldría en la serif por
 * defecto del navegador y no se parecería al preview. Solo fuentes de sistema —
 * el documento es una rejilla administrativa, no una pieza de marca.
 */
const TIPOGRAFIA = `
  :root {
    --font-mono: ui-monospace, 'SF Mono', 'JetBrains Mono', 'Courier New', monospace;
  }
  html, body {
    margin: 0;
    padding: 0;
    background: #fff;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
`

export const FormulariosDocumentoPdfService = {
  /** POST /api/formularios/documento/pdf */
  async renderizar(request: FastifyRequest, reply: FastifyReply) {
    try {
      const body = (request.body ?? {}) as {
        html?: unknown
        css?: unknown
        filename?: unknown
      }

      if (typeof body.html !== 'string' || !body.html.trim()) {
        return reply.status(400).send({ error: 'Falta el campo "html" (cuerpo del documento).' })
      }
      if (typeof body.css !== 'string' || !body.css.trim()) {
        return reply.status(400).send({ error: 'Falta el campo "css" (hoja de estilos del documento).' })
      }
      if (body.html.length > MAX_HTML || body.css.length > MAX_CSS) {
        return reply.status(413).send({ error: 'El documento es demasiado grande para renderizarlo.' })
      }

      /// El nombre viaja a una cabecera `Content-Disposition`: se restringe a
      /// caracteres seguros para que no pueda inyectar directivas propias.
      const filename = String(body.filename || 'documento').replace(/[^a-z0-9_\-]/gi, '_')

      const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>${filename}</title>
<style>${TIPOGRAFIA}</style>
<style>${body.css}</style>
</head>
<body>${body.html}</body>
</html>`

      /// `preferCSSPageSize`: el `@page { size: letter; margin: 8mm }` viaja
      /// dentro del CSS del documento, que es donde el diseño lo decide.
      const pdf = await pdfFromHtml({
        html,
        landscape: false,
        format: 'Letter',
        marginMm: 0,
        preferCSSPageSize: true,
      })

      reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `inline; filename="${filename}.pdf"`)
        .header('Content-Length', String(pdf.length))
        .header('Cache-Control', 'private, max-age=0, no-store')
        .send(pdf)
    } catch (error: any) {
      request.log.error({ err: error }, 'Error generando PDF de documento de formulario')
      return reply.status(500).send({ error: error?.message || 'Error generando el PDF' })
    }
  },
}
