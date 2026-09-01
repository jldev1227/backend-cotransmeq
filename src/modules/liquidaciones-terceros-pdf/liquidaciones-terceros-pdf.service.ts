import { FastifyRequest, FastifyReply } from 'fastify';
import { LiquidacionesTercerosDescuentosService } from '../liquidaciones-terceros-descuentos/liquidaciones-terceros-descuentos.service';
import { pdfFromHtml } from '../../services/pdf.service';
import { renderTerceroLiquidacionPdf } from './liquidaciones-terceros-pdf.template';

export const LiquidacionesTercerosPdfService = {
  /**
   * GET /api/liquidaciones-terceros/:id/pdf
   *
   * Genera un PDF nativo de la liquidación usando Puppeteer + Chromium
   * con una plantilla editorial optimizada para Letter landscape.
   *
   * IMPORTANTE: este endpoint es READ-ONLY. No debe disparar
   * `recalcularTotales`, `calcularImpuestos` ni ninguna otra operación
   * de escritura sobre la BD. La responsabilidad de mantener los
   * conceptos/totales consistentes es del editor (que llama a
   * `calcularImpuestos` en su `onMount`) y de los endpoints explícitos
   * de recálculo (`POST /recalcular-totales`, `PUT /conceptos`, etc.).
   *
   * Si antes de generar el PDF se recalculaban totales, una versión
   * vieja del backend podía SOBREESCRIBIR valores correctos con valores
   * calculados con lógica desactualizada (ej. AVISOS_TABLEROS /
   * SOBRETASA_BOMBERIL gravando sobre la base imponible en vez del
   * valor de RETENCION_ICA), dejando el documento final inconsistente
   * con lo que el usuario veía en pantalla.
   */
  async descargarPdf(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string };
      if (!id) {
        return reply.status(400).send({ error: 'Falta el ID del cierre.' });
      }

      // Lectura única del cierre (incluye propietarios, conceptos, items,
      // adicionales, facturas). NO se ejecuta ningún recalculador aquí.
      const item = await LiquidacionesTercerosDescuentosService.obtenerPorId(id);
      if (!item) {
        return reply.status(404).send({ error: 'Liquidación no encontrada' });
      }

      const html = renderTerceroLiquidacionPdf(item);

      const filename = `liquidacion_${(item.liquidacion?.consecutivo || item.consecutivo || id)
        .replace(/[^a-z0-9_\-]/gi, '_')}.pdf`;

      // Landscape Letter, márgenes editoriales definidos en el @page del
      // template (8mm lateral, 6mm sup/inf) para aprovechar al máximo la
      // hoja sin recortar el contenido.
      const pdf = await pdfFromHtml({
        html,
        landscape: true,
        format: 'Letter',
        marginMm: 0,
        preferCSSPageSize: true,
      });

      reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `inline; filename="${filename}"`)
        .header('Content-Length', String(pdf.length))
        .header('Cache-Control', 'private, max-age=0, no-store')
        .send(pdf);
    } catch (error: any) {
      request.log.error({ err: error }, 'Error generando PDF de liquidación tercero');
      const status = error?.message?.includes('no encontrada') ? 404 : 500;
      return reply.status(status).send({ error: error?.message || 'Error generando PDF' });
    }
  },
};