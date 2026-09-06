import { pdfFromHtml } from '../../services/pdf.service'
import { renderSalidaNCPdf, type SalidaNCPdf } from './snc-pdf.template'

/**
 * Generación del PDF del registro de Salida No Conforme.
 *
 * ── Qué cambió y por qué ──
 * Esto eran 456 líneas de PDFKit dibujando el documento a mano: una `yPos`
 * que se iba sumando, alturas de celda calculadas con `heightOfString`, y
 * los saltos de página decididos con `checkPage(100)` —una estimación de
 * cuánto ocuparía lo siguiente—. Añadir un campo obligaba a recolocar
 * coordenadas, y una descripción larga se recortaba a 60px de alto: lo que
 * sobraba desaparecía del registro sin dejar rastro.
 *
 * Ahora el documento es HTML y lo pagina Chromium, igual que el PDF de
 * liquidaciones de terceros. `pdfFromHtml` ya existía y es compartido, así
 * que esto no añade infraestructura: solo deja de ser el único documento
 * del producto generado de otra manera.
 *
 * ── Lo que NO cambió ──
 * Es un registro controlado por ISO 9001:2015 cláusula 8.7. Secciones,
 * numeración, referencias normativas y etiquetas de campo son las mismas,
 * literalmente. `snc-pdf-estructura.spec.ts` falla si alguna se pierde.
 *
 * @see snc-pdf.template.ts  — la plantilla
 * @see snc-pdf-tokens.ts    — los tokens visuales
 */
export class PDFGeneratorSNCService {
  static async generarPDF(salida: SalidaNCPdf): Promise<Buffer> {
    /// Márgenes explícitos y NO `preferCSSPageSize`.
    ///
    /// Los dos repos tienen su propia versión de `pdfFromHtml` y difieren
    /// justo ahí: uno borra el margen explícito cuando esa opción está
    /// activa y el otro lo conserva. El mismo registro salía con márgenes
    /// distintos en cada empresa. Pasando `format` + `marginMm` el resultado
    /// no depende de esa diferencia.
    return pdfFromHtml({
      html: renderSalidaNCPdf(salida),
      landscape: false,
      format: 'Letter',
      marginMm: 10
    })
  }
}

export type { SalidaNCPdf }
