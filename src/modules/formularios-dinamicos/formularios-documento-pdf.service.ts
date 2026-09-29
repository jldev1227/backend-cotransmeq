import { FastifyRequest, FastifyReply } from 'fastify'
import { env } from '../../config/env'
import { pdfFromHtml, pdfFromUrl } from '../../services/pdf.service'

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
 * ── Seguridad: /api/formularios/documento/pdf ──
 * El HTML que manda el cliente se renderiza en una página aislada de
 * Puppeteer, sin sesión ni cookies. No hay nada que un cliente autenticado
 * pueda alcanzar mandando marcado propio que no alcanzara ya con su propio
 * navegador. Sigue siendo cierto después del recibo del portal: aquella
 * impresión corre en un contexto de navegador APARTE, con su propio
 * almacenamiento, que se destruye al terminar —esta página nunca lo ve.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * RECIBO DEL PORTAL — `imprimirReciboDeEnvio`
 *
 * La app móvil también necesita el PDF de un envío, y ahí el cliente NO puede
 * mandar el cuerpo: React Native no tiene DOM, así que no existe el documento
 * que la web sí trae ya pintado. Por el mismo razonamiento de arriba tampoco
 * se rehace en el servidor. Lo que se hace es imprimir la página que el
 * conductor ya ve en la web —`/public/portal/formularios/envios/<id>`—
 * navegándola con Chromium. Un solo documento y un solo sitio que mantener.
 *
 * ── Por qué esto obliga a que haya sesión ──
 * Esa página se autentica en el cliente: lee `portalSession` de
 * `localStorage` y pide el envío con `Authorization: Bearer`. Sin sembrarla,
 * Chromium vería el login. Así que aquí, y SOLO aquí, la página de Puppeteer
 * sí lleva sesión. Deja de ser cierto que «no hay nada que alcanzar», y lo que
 * sostiene la propiedad de seguridad pasa a ser el alcance de esa sesión:
 *
 *   1. La propiedad se comprueba ANTES de imprimir, contra la base y no contra
 *      el parámetro: la ruta llama a `obtenerEnvioPortal`, que filtra por
 *      `conductor_id` del token y devuelve 404 si el envío es de otro. El id
 *      que se navega es el de la fila ya recuperada.
 *   2. El token que se siembra NO es el del conductor. Es uno nuevo, firmado
 *      en el momento, con un `tipo` propio (`conductor_portal_print`), el
 *      `sid` del envío dentro y minutos de vida. `portalAuthMiddleware` solo
 *      lo acepta en `GET /conductor-portal/formularios/submissions/:id` y solo
 *      cuando el `:id` coincide con su `sid`: es exactamente la lectura que la
 *      página necesita y ninguna más. No sirve para listar envíos, ni para
 *      enviar, ni para volver a pedir este mismo PDF. Y como el `tipo` es
 *      suyo, los otros módulos del portal —desprendibles, primas, servicios,
 *      cada uno con su propia copia del middleware— lo rechazan sin tener que
 *      saber que existe.
 *   3. El token nunca entra en una URL. Viaja como `localStorage` sembrado con
 *      `evaluateOnNewDocument`, porque la query string acaba en el log de
 *      acceso del servidor web, en el historial del navegador y en el
 *      `Referer` de cada recurso que pida la página.
 *   4. El contexto de navegador es propio de esta impresión y se destruye al
 *      terminar, así que la sesión sembrada no sobrevive a la petición ni la
 *      ve ninguna otra.
 *
 * El peor caso de una fuga del token sembrado es, por tanto, releer un envío
 * que su propio dueño acababa de pedir imprimir, durante los pocos minutos que
 * vive. La URL que se navega se construye con `FRONTEND_URL` del entorno y el
 * id ya validado; no se acepta ninguna URL del cliente, para que esto no se
 * convierta en un SSRF con sesión.
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


/**
 * Origen del portal web que se va a navegar.
 *
 * `FRONTEND_URL` puede traer varios orígenes separados por coma (CORS); el
 * canónico es el primero. Nunca se toma una URL del cliente: esto abre un
 * navegador con sesión, y aceptar destino sería un SSRF autenticado.
 */
function origenDelPortal(): string {
  const lista = (env.FRONTEND_URL || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)
  const elegido = lista[0] || (env.EMAIL_FRONTEND_URL || '').trim()
  return (elegido || 'http://localhost:5173').replace(/\/+$/, '')
}

/** Sesión del portal tal y como la guarda `portalStore` del frontend. */
export interface SesionDeImpresion {
  token: string
  conductor: {
    id: string
    nombre: string
    apellido: string
    numero_identificacion: string
  }
  expiresAt: string
}

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

  /**
   * PDF del recibo de un envío, imprimiendo la página del portal web.
   *
   * `submissionId` tiene que venir de una fila ya recuperada con el filtro de
   * propiedad del portal, NO del parámetro crudo de la petición: es la primera
   * de las cuatro garantías de la cabecera de este archivo.
   *
   * `data-listo="si"` lo pone la propia página cuando terminó de cargar sus
   * datos. Sin esa espera se imprimiría el «Cargando recibo…», porque en una
   * SPA el evento `load` llega antes que la respuesta de su primer `fetch`.
   */
  async imprimirReciboDeEnvio(submissionId: string, sesion: SesionDeImpresion): Promise<Buffer> {
    return pdfFromUrl({
      url: `${origenDelPortal()}/public/portal/formularios/envios/${encodeURIComponent(submissionId)}`,
      seedLocalStorage: { [env.PORTAL_SESSION_STORAGE_KEY]: JSON.stringify(sesion) },
      waitForSelector: '[data-listo="si"]',
      format: 'Letter',
      landscape: false,
      marginMm: 8,
      viewportWidth: 820,
    })
  },
}
