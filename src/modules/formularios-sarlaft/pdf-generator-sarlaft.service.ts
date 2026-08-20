import PDFDocument from "pdfkit";
import * as path from "path";
import * as fs from "fs";

/**
 * Generador de PDF para un formulario SARLAFT + PTEE.
 *
 * Estructura del PDF:
 *   1. Encabezado con logo, código de formulario y radicado
 *   2. Metadata del titular y del envío
 *   3. Una sección por cada sección del formulario (secciones normales)
 *   4. Tablas repetibles con todas las filas
 *   5. Firma (si viene como base64) embebida al final
 *
 * Adaptado del patrón de `pdf-generator-acciones.service.ts` para producir
 * un PDF con todas las respuestas del formulario diligenciado, ideal para
 * enviar como adjunto al correo de notificación y para descarga admin.
 */

const C = {
  ink: "#18181b",
  muted: "#71717a",
  label: "#065f46",
  sectionBg: "#059669",
  sectionText: "#ffffff",
  border: "#a7f3d0",
  line: "#d1fae5",
  accent: "#047857",
  accentLight: "#ecfdf5",
  white: "#ffffff",
  badgeGreenBg: "#d1fae5",
  badgeGreenText: "#065f46",
  badgeAmberBg: "#fef3c7",
  badgeAmberText: "#92400e",
  badgeRedBg: "#fee2e2",
  badgeRedText: "#991b1b",
  badgeGrayBg: "#f3f4f6",
  badgeGrayText: "#374151"
};

const MARGIN = 28;
const GUTTER = 4;
const CELL_PAD = 3;
const ROW_GAP = 3;
const BLOCK_GAP = 5;
const LINE_GAP = 1.5;
const BODY = 8;
const LABEL = 7;
const SECTION = 9;

type PreguntaLite = {
  id: string;
  pregunta: string;
  opciones?: string[] | null;
  obligatorio?: boolean;
};

type SeccionLite = {
  seccion: string;
  /** Clave bajo la cual se agrupan las filas de tabla repetible. */
  key_tabla?: string;
  preguntas: PreguntaLite[];
};

type FormularioLite = {
  codigo: string;
  version: string;
  secciones: SeccionLite[];
};

type DocumentoAdjunto = {
  id: string;
  tipo_documento: string;
  nombre_archivo: string;
  mime_type: string;
  tamano_bytes: string;
};

export interface SarlaftPDFData {
  radicado: string;
  tipo_formulario: 'cliente_proveedor' | 'accionistas' | 'personal';
  version: string;
  fecha_envio: string;
  fecha_diligenciamiento: string | null;
  nombre_completo: string | null;
  tipo_documento: string | null;
  numero_documento: string | null;
  correo: string | null;
  telefono: string | null;
  ip_origen: string | null;
  user_agent: string | null;
  referer: string | null;
  estado: string;
  respuestas: Record<string, any>;
  documentos: DocumentoAdjunto[];
  formulario: FormularioLite;
}

export class PDFGeneratorSarlaftService {
  static async generarPDFSarlaft(data: SarlaftPDFData): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: "LETTER",
          layout: "portrait",
          margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN }
        });

        const chunks: Buffer[] = [];
        doc.on("data", (c) => chunks.push(c));
        doc.on("end", () => resolve(Buffer.concat(chunks)));
        doc.on("error", reject);

        const pageW = doc.page.width;
        const pageH = doc.page.height;
        const contentW = pageW - MARGIN * 2;
        const colW = (contentW - GUTTER) / 2;
        const bottomY = pageH - MARGIN;
        let y = MARGIN;

        const fmtFecha = (f?: string | Date | null) => {
          if (!f) return "—";
          const d = typeof f === "string" ? new Date(f) : f;
          return Number.isNaN(d.getTime())
            ? "—"
            : d.toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric" });
        };

        const fmtFechaHora = (f?: string | Date | null) => {
          if (!f) return "—";
          const d = typeof f === "string" ? new Date(f) : f;
          return Number.isNaN(d.getTime())
            ? "—"
            : d.toLocaleString("es-CO", {
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit"
              });
        };

        const fmtBytes = (b?: string | number | null) => {
          if (b == null) return "—";
          const n = typeof b === "string" ? Number(b) : b;
          if (!Number.isFinite(n)) return "—";
          if (n < 1024) return `${n} B`;
          if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
          return `${(n / 1024 / 1024).toFixed(2)} MB`;
        };

        const fmt = (v: unknown): string => {
          if (v === null || v === undefined || v === "") return "—";
          if (typeof v === "boolean") return v ? "Sí" : "No";
          if (Array.isArray(v)) {
            const items = v.filter((x) => x != null && String(x).trim());
            return items.length ? items.map((x, i) => `${i + 1}. ${x}`).join("\n") : "—";
          }
          return String(v).trim();
        };

        const fmtMoneda = (v: unknown): string => {
          if (v === null || v === undefined || v === "") return "—";
          const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
          if (!Number.isFinite(n)) return String(v);
          return new Intl.NumberFormat("es-CO", {
            style: "currency",
            currency: "COP",
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
          }).format(n);
        };

        const fmtPorcentaje = (v: unknown): string => {
          if (v === null || v === undefined || v === "") return "—";
          const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
          if (!Number.isFinite(n)) return String(v);
          return `${n}%`;
        };

        const measure = (text: string, width: number, size = BODY, font = "Helvetica") => {
          doc.fontSize(size).font(font);
          return doc.heightOfString(text, { width, lineGap: LINE_GAP });
        };

        const writeText = (
          text: string,
          x: number,
          top: number,
          width: number,
          height: number,
          size = BODY,
          font = "Helvetica",
          color = C.ink
        ) => {
          doc.fontSize(size).font(font).fillColor(color);
          doc.text(text, x, top, {
            width,
            height,
            lineGap: LINE_GAP,
            lineBreak: true
          });
        };

        const ensure = (h: number) => {
          if (y + h > bottomY) {
            doc.addPage();
            y = MARGIN;
          }
        };

        const advance = (h: number) => {
          y += h + ROW_GAP;
        };

        const drawPara = (label: string, value: unknown, wide = true) => {
          const text = fmt(value);
          const w = wide ? contentW : colW;
          const padX = 4;
          const labelH = 9;
          const bodyH = Math.max(10, measure(text, w - padX * 2) + 2);
          const total = labelH + bodyH + BLOCK_GAP;
          ensure(total);

          doc.rect(MARGIN, y, wide ? contentW : w, labelH).fill(C.line);
          doc
            .fontSize(LABEL)
            .font("Helvetica-Bold")
            .fillColor(C.label)
            .text(label, MARGIN + padX, y + 2, { width: w - padX * 2, lineBreak: false });

          const boxY = y + labelH;
          doc
            .rect(MARGIN, boxY, wide ? contentW : w, bodyH)
            .lineWidth(0.4)
            .strokeColor(C.border)
            .stroke();
          writeText(text, MARGIN + padX, boxY + 2, w - padX * 2, bodyH - 2);
          y += total;
        };

        const measureKvCell = (label: string, value: string, width: number) => {
          const lbl = `${label}: `;
          doc.fontSize(LABEL).font("Helvetica-Bold");
          const lblW = doc.widthOfString(lbl);
          const valW = Math.max(20, width - lblW - 4);
          const valH = measure(fmt(value), valW);
          const lineH = Math.max(11, valH + 2);
          return { lineH, lbl, lblW, valW };
        };

        const drawKvRow = (left: { label: string; value: unknown } | undefined, right: { label: string; value: unknown } | undefined) => {
          const items = [left, right].filter(Boolean) as { label: string; value: unknown }[];
          if (!items.length) return;

          let rowH = 0;
          const layouts = items.map((item, idx) => {
            const x = MARGIN + idx * (colW + GUTTER);
            const m = measureKvCell(item.label, fmt(item.value), colW);
            rowH = Math.max(rowH, m.lineH);
            return { ...m, x, item };
          });

          ensure(rowH + BLOCK_GAP);
          const baseY = y;

          layouts.forEach((L) => {
            doc.rect(L.x, baseY, colW, rowH).fill(C.accentLight).strokeColor(C.border).lineWidth(0.35).stroke();
            doc.fontSize(LABEL).font("Helvetica-Bold").fillColor(C.label);
            doc.text(L.lbl, L.x + CELL_PAD, baseY + 1, { lineBreak: false });
            writeText(fmt(L.item.value), L.x + L.lblW + CELL_PAD, baseY + 1, L.valW - CELL_PAD, rowH, BODY);
          });

          y = baseY + rowH + BLOCK_GAP;
        };

        const drawSection = (num: string, title: string) => {
          const h = 14;
          ensure(h + 2);
          doc.rect(MARGIN, y, contentW, h).fill(C.sectionBg);
          doc
            .fontSize(SECTION)
            .font("Helvetica-Bold")
            .fillColor(C.sectionText)
            .text(`${num}. ${title}`, MARGIN + 6, y + 3, { width: contentW - 12 });
          advance(h);
        };

        const drawSubTitle = (title: string) => {
          ensure(10);
          doc.fontSize(LABEL).font("Helvetica-Bold").fillColor(C.label).text(title, MARGIN, y);
          advance(8);
        };

        const formatValue = (v: unknown, format?: 'text' | 'moneda' | 'porcentaje' | 'fecha'): string => {
          if (v === null || v === undefined || v === "") return "—";
          switch (format) {
            case 'moneda':
              return fmtMoneda(v);
            case 'porcentaje':
              return fmtPorcentaje(v);
            case 'fecha':
              return fmtFecha(v as string);
            default:
              return fmt(v);
          }
        };

        const drawFields = (fields: { label: string; value: unknown; wide?: boolean; format?: 'text' | 'moneda' | 'porcentaje' | 'fecha' }[]) => {
          const queue = [...fields];
          while (queue.length) {
            const a = queue.shift();
            if (!a) break;
            if (a.wide) {
              drawPara(a.label, formatValue(a.value, a.format), true);
              continue;
            }
            const b = queue.length && !queue[0].wide ? queue.shift() : undefined;
            drawKvRow(
              { label: a.label, value: formatValue(a.value, a.format) },
              b ? { label: b.label, value: formatValue(b.value, b.format) } : undefined
            );
          }
        };

        const drawTableForRepetible = (titulo: string, filas: Array<Record<string, any>>, preguntas: PreguntaLite[]) => {
          if (!filas.length) return;
          drawSubTitle(titulo + ` (${filas.length} ${filas.length === 1 ? 'registro' : 'registros'})`);

          const pad = CELL_PAD;
          // Calcular anchos: 1ra columna estrecha (índice), resto iguales
          const usableW = contentW - pad * 2;
          const idxW = 18;
          const cellW = (usableW - idxW) / Math.max(1, preguntas.length);

          // Header row
          const headH = 11;
          ensure(headH + ROW_GAP);
          const headY = y;
          doc.rect(MARGIN + pad, headY, idxW, headH).fill(C.line).strokeColor(C.border).lineWidth(0.35).stroke();
          doc.fontSize(LABEL).font("Helvetica-Bold").fillColor(C.label).text("#", MARGIN + pad + 4, headY + 2);

          preguntas.forEach((p, i) => {
            const cx = MARGIN + pad + idxW + i * cellW;
            doc.rect(cx, headY, cellW, headH).fill(C.line).strokeColor(C.border).lineWidth(0.35).stroke();
            doc.fontSize(LABEL).font("Helvetica-Bold").fillColor(C.label).text(p.pregunta, cx + 3, headY + 2, {
              width: cellW - 6,
              height: headH - 2,
              ellipsis: true,
              lineBreak: true
            });
          });

          y = headY + headH + ROW_GAP;

          // Data rows
          filas.forEach((fila, idx) => {
            const valuesText = preguntas.map((p) => fmt(fila[p.id]));
            let rowH = 11;
            valuesText.forEach((t, i) => {
              const w = cellW - pad * 2;
              rowH = Math.max(rowH, measure(t, w) + pad * 2);
            });
            ensure(rowH + ROW_GAP);
            const rY = y;

            doc.rect(MARGIN + pad, rY, idxW, rowH).strokeColor(C.border).lineWidth(0.3).stroke();
            doc.fontSize(LABEL).font("Helvetica-Bold").fillColor(C.muted).text(String(idx + 1), MARGIN + pad + 4, rY + 3);

            preguntas.forEach((p, i) => {
              const cx = MARGIN + pad + idxW + i * cellW;
              doc.rect(cx, rY, cellW, rowH).strokeColor(C.border).lineWidth(0.3).stroke();
              writeText(valuesText[i], cx + pad, rY + 2, cellW - pad * 2, rowH - pad, BODY);
            });

            y = rY + rowH + ROW_GAP;
          });
          y += 2;
        };

        const drawFirma = (firmaDataUrl: string | null | undefined) => {
          if (!firmaDataUrl) {
            drawPara("Firma de quien autoriza", "—", true);
            return;
          }
          // Detectar si es dataURL base64
          const match = /^data:image\/(png|jpe?g|webp);base64,(.+)$/i.exec(firmaDataUrl);
          drawSubTitle("Firma de quien autoriza");
          const labelH = 9;
          ensure(labelH + 80);
          if (!match) {
            // No se pudo decodificar: mostrar texto
            doc.rect(MARGIN, y, contentW, 60).fill(C.accentLight).strokeColor(C.border).stroke();
            writeText("Firma registrada en el formulario (no embebida)", MARGIN + 4, y + 20, contentW - 8, 20, BODY, "Helvetica", C.muted);
            y += 60 + BLOCK_GAP;
            return;
          }
          try {
            const imgBuffer = Buffer.from(match[2], "base64");
            // Recuadro para la firma
            const boxH = 80;
            const boxY = y;
            doc.rect(MARGIN, boxY, contentW, boxH).fill(C.accentLight).strokeColor(C.border).stroke();
            doc.image(imgBuffer, MARGIN + 8, boxY + 6, { fit: [contentW - 16, boxH - 12], align: "center", valign: "center" });
            y = boxY + boxH + BLOCK_GAP;
          } catch {
            doc.rect(MARGIN, y, contentW, 60).fill(C.accentLight).strokeColor(C.border).stroke();
            writeText("Firma registrada en el formulario (no se pudo embeber)", MARGIN + 4, y + 20, contentW - 8, 20, BODY, "Helvetica", C.muted);
            y += 60 + BLOCK_GAP;
          }
        };

        const drawFooter = () => {
          const footerY = pageH - MARGIN - 10;
          const origBottom = doc.page.margins.bottom;
          doc.page.margins.bottom = 0;
          doc.fontSize(6).font("Helvetica").fillColor(C.muted);
          doc.text(
            `SARLAFT ${data.formulario.codigo} · Radicado ${data.radicado}  ·  Generado ${fmtFechaHora(new Date())}`,
            MARGIN,
            footerY,
            { width: contentW * 0.7, lineBreak: false }
          );
          doc.page.margins.bottom = origBottom;
          doc.moveTo(MARGIN, footerY - 3).lineTo(MARGIN + contentW, footerY - 3).strokeColor(C.border).lineWidth(0.3).stroke();
        };

        // ── Encabezado ──
        const LOGO_BOX = { w: 118, h: 48 };
        const LOGO_PAD = 5;
        const META_W = 140;
        const GAP = 8;
        const CENTER_W = contentW - LOGO_BOX.w - GAP * 2 - META_W;
        const HEADER_H = Math.max(LOGO_BOX.h, 11 * 4 + 6);
        const META_ROW_H = 16;

        ensure(HEADER_H + 8);
        const baseY = y + 2;

        // Left: Logo
        doc.rect(MARGIN, baseY, LOGO_BOX.w, LOGO_BOX.h).fill(C.accentLight).strokeColor(C.border).lineWidth(0.5).stroke();
        try {
          // No se usa `logo.png`: en este repo ese archivo sigue siendo el
          // logotipo de Transmeralda. Este generador (pdfkit) quedó sustituido
          // por el basado en HTML, pero se corrige la ruta para que no imprima
          // la marca equivocada si alguien vuelve a engancharlo.
          const logoPath = path.join(__dirname, "../../assets/cotransmeq-logo.png");
          if (fs.existsSync(logoPath)) {
            doc.image(logoPath, MARGIN + LOGO_PAD, baseY + LOGO_PAD, { fit: [LOGO_BOX.w - LOGO_PAD * 2, LOGO_BOX.h - LOGO_PAD * 2], align: "center", valign: "center" });
          }
        } catch {
          /* sin logo */
        }

        // Center: Title
        const titleX = MARGIN + LOGO_BOX.w + GAP;
        doc.rect(titleX, baseY, CENTER_W, HEADER_H).strokeColor(C.border).lineWidth(0.5).stroke();
        const titulo = data.tipo_formulario === "cliente_proveedor"
          ? "Cliente / Proveedor"
          : data.tipo_formulario === "accionistas"
            ? "Accionistas"
            : "Vinculación de Personal";
        doc.fontSize(12).font("Helvetica-Bold").fillColor(C.ink).text(`SARLAFT + PTEE — ${titulo}`, titleX + 6, baseY + HEADER_H / 2 - 7, { width: CENTER_W - 12, align: "center" });

        // Right: Metadata table
        const metaX = titleX + CENTER_W + GAP;
        const metaItems = [
          { label: "Código:", value: data.formulario.codigo },
          { label: "Versión:", value: data.version },
          { label: "Generado:", value: fmtFecha(new Date()) }
        ];
        metaItems.forEach((item, i) => {
          const rowY = baseY + i * META_ROW_H;
          const fill = i % 2 === 0 ? C.line : C.white;
          doc.rect(metaX, rowY, META_W, META_ROW_H).fill(fill).strokeColor(C.border).lineWidth(0.5).stroke();
          doc.fontSize(LABEL).font("Helvetica-Bold").fillColor(C.label).text(item.label, metaX + 4, rowY + 3, { lineBreak: false });
          doc.fontSize(BODY).font("Helvetica").fillColor(C.ink).text(item.value, metaX + 4 + doc.widthOfString(item.label), rowY + 3, { width: META_W - 8 - doc.widthOfString(item.label), lineBreak: false });
        });

        // Barra de radicado
        const barY = baseY + HEADER_H + 6;
        const barH = 14;
        doc.rect(MARGIN, barY, contentW, barH).fill(C.accent);
        doc.fontSize(10).font("Helvetica-Bold").fillColor(C.white).text(`Radicado ${data.radicado}`, MARGIN + 6, barY + 3);

        if (data.estado) {
          const statusText = data.estado.toUpperCase();
          const badgeX = MARGIN + 6 + doc.widthOfString(`Radicado ${data.radicado}`) + 12;
          doc.fontSize(LABEL).font("Helvetica-Bold");
          const badgeW = doc.widthOfString(statusText) + 10;
          doc.roundedRect(badgeX, barY + 1, badgeW, barH - 2, 3).fill(C.badgeGrayBg);
          doc.fillColor(C.badgeGrayText);
          doc.text(statusText, badgeX + 5, barY + 3, { width: badgeW - 10 });
        }

        y += HEADER_H + 4 + barH + 4;

        // ── 1 Información del titular ──
        drawSection("1", "Información del titular");
        drawFields([
          { label: "Tipo de formulario", value: titulo },
          { label: "Radicado", value: data.radicado },
          { label: "Nombre / Razón social", value: data.nombre_completo },
          { label: "Documento", value: data.tipo_documento ? `${data.tipo_documento} ${data.numero_documento ?? ''}`.trim() : data.numero_documento },
          { label: "Correo", value: data.correo },
          { label: "Teléfono", value: data.telefono }
        ]);
        drawFields([
          { label: "Fecha de diligenciamiento", value: fmtFecha(data.fecha_diligenciamiento) },
          { label: "Fecha de envío", value: fmtFechaHora(data.fecha_envio) }
        ]);

        // ── 2 Respuestas del formulario ──
        drawSection("2", "Respuestas del formulario");

        for (const seccion of data.formulario.secciones) {
          // Filtrar preguntas con respuesta
          const preguntasConValor = seccion.preguntas.filter((p) => {
            const v = data.respuestas[p.id];
            return v !== undefined && v !== null && v !== "";
          });
          const keyTabla = seccion.key_tabla ?? `${seccion.preguntas[0]?.id.split('-').slice(0, -1).join('-')}__rows`;
          const filasTabla = Array.isArray(data.respuestas[keyTabla]) ? data.respuestas[keyTabla] : null;

          if (preguntasConValor.length === 0 && !filasTabla?.length) continue;

          drawSubTitle(seccion.seccion);

          if (preguntasConValor.length > 0) {
            const fields = preguntasConValor.map((p) => {
              const v = data.respuestas[p.id];
              const isMoneda = /ingresos|egresos|patrimonio|valor|monto/i.test(p.id);
              const isPorcentaje = /%/.test(p.pregunta) || /participacion/i.test(p.id);
              const isFecha = p.pregunta.toLowerCase().includes("fecha");
              const format: 'text' | 'moneda' | 'porcentaje' | 'fecha' | undefined = isMoneda
                ? 'moneda'
                : isPorcentaje
                  ? 'porcentaje'
                  : isFecha
                    ? 'fecha'
                    : undefined;
              return {
                label: p.pregunta,
                value: v,
                wide: p.pregunta.length > 40,
                format
              };
            });
            drawFields(fields);
          }

          if (filasTabla && filasTabla.length > 0) {
            drawTableForRepetible(seccion.seccion, filasTabla, seccion.preguntas);
          }
        }

        // ── 3 Documentos adjuntos ──
        if (data.documentos && data.documentos.length > 0) {
          drawSection("3", "Documentos adjuntos");
          drawSubTitle(`${data.documentos.length} archivo${data.documentos.length === 1 ? '' : 's'} almacenado${data.documentos.length === 1 ? '' : 's'} en S3`);
          data.documentos.forEach((d, i) => {
            drawFields([
              { label: `Documento #${i + 1}`, value: d.tipo_documento },
              { label: "Nombre de archivo", value: d.nombre_archivo, wide: true },
              { label: "Tipo MIME", value: d.mime_type },
              { label: "Tamaño", value: fmtBytes(d.tamano_bytes) }
            ]);
          });
        }

        // ── 4 Firma de quien autoriza ──
        drawSection("4", "Firma de quien autoriza");
        const firma = data.respuestas?.['PER-ENC-04'] ?? data.respuestas?.['ACC-ENC-04'] ?? data.respuestas?.['CLI-ENC-04'];
        drawFirma(firma as string | null | undefined);

        drawFooter();

        doc.end();
      } catch (err) {
        console.error("Error generando PDF SARLAFT:", err);
        reject(err);
      }
    });
  }
}
