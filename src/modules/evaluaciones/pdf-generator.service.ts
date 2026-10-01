import { pdfFromHtml } from "../../services/pdf.service";
import { buildFontsCss } from "../liquidaciones-terceros-pdf/fonts";
import { pdfCssVars } from "../liquidaciones-terceros-pdf/pdf-tokens";
import {
  renderResultadoIndividualHtml,
  renderResumenEvaluacionHtml,
  type EvaluacionPdf,
  type ResultadoPdf,
} from "./evaluacion-pdf.template";

/**
 * PDFs de evaluaciones: el resumen de participantes y el detalle de una
 * respuesta.
 *
 * ── Qué cambió y por qué ──
 * Esto eran 1.300 líneas de pdfkit dibujando los dos documentos a mano:
 * rejilla negra, Roboto a 6,5 puntos, celdas medidas con `heightOfString`
 * y una maquetación a dos columnas colocada «por la que tuviera menor Y».
 * No se parecía a ningún otro documento del producto.
 *
 * Ahora los documentos son HTML y los pagina Chromium, igual que el
 * desprendible de nómina y el registro de salidas no conformes.
 * `pdfFromHtml` ya existía y es compartido: esto no añade infraestructura.
 * La plantilla vive en `evaluacion-pdf.template.ts`.
 *
 * ── Lo que NO cambió ──
 * La firma pública de esta clase. El controlador y el ZIP de respuestas la
 * llaman igual que antes, con los mismos datos.
 */
export class EvaluacionPDFGeneratorService {
  /**
   * Fuentes embebidas y tokens del PDF, como en el desprendible. Se inyectan
   * por `prelude` para que la plantilla no importe nada de otro módulo.
   */
  private static prelude(): string {
    return `${buildFontsCss()}\n:root { ${pdfCssVars(1)} }`;
  }

  /** Resumen de todos los participantes, en carta apaisada. */
  static async generarPDFEvaluacion(
    evaluacion: EvaluacionPdf,
    resultados: ResultadoPdf[],
  ): Promise<Buffer> {
    const html = renderResumenEvaluacionHtml(evaluacion, resultados, {
      prelude: this.prelude(),
    });
    return pdfFromHtml({
      html,
      landscape: true,
      format: "Letter",
      marginMm: 0,
      // El `@page` de la plantilla manda, igual que en el desprendible.
      preferCSSPageSize: true,
    });
  }

  /** Detalle de una respuesta: preguntas, lo contestado y el acierto. */
  static async generarPDFIndividual(
    evaluacion: EvaluacionPdf,
    resultado: ResultadoPdf,
  ): Promise<Buffer> {
    const html = renderResultadoIndividualHtml(evaluacion, resultado, {
      prelude: this.prelude(),
    });
    return pdfFromHtml({
      html,
      landscape: false,
      format: "Letter",
      marginMm: 0,
      preferCSSPageSize: true,
    });
  }
}
