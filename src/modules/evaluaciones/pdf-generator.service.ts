import PDFDocument from "pdfkit";
import * as path from "path";
import * as fs from "fs";

interface EvaluacionData {
  titulo: string;
  descripcion?: string | null;
  requiere_firma: boolean;
  created_at: string;
  preguntas: PreguntaData[];
}

interface PreguntaData {
  id: string;
  texto: string;
  tipo:
    | "OPCION_UNICA"
    | "OPCION_MULTIPLE"
    | "NUMERICA"
    | "TEXTO"
    | "RELACION"
    | "VERDADERO_FALSO";
  puntaje: number;
  opciones: OpcionData[];
  relacionIzq: string[];
  relacionDer: string[];
  respuestaCorrecta?: number | null;
}

interface OpcionData {
  id: string;
  texto: string;
  esCorrecta: boolean;
}

interface ResultadoData {
  id: string;
  nombre_completo: string;
  numero_documento: string;
  cargo: string;
  correo: string;
  telefono: string;
  puntaje_total: number;
  firma?: string | null;
  created_at: string;
  respuestas: RespuestaDetalleData[];
}

interface RespuestaDetalleData {
  id: string;
  preguntaId: string;
  valor_texto?: string | null;
  valor_numero?: number | null;
  opcionesIds: string[];
  relacion?: any;
  puntaje: number;
  pregunta?: PreguntaData;
}

export class EvaluacionPDFGeneratorService {
  private static getFontsDir(): string {
    const isDist = __dirname.includes("/dist/");
    return isDist
      ? path.join(__dirname, "../../assets/fonts")
      : path.join(__dirname, "../../assets/fonts");
  }

  private static registerFonts(doc: typeof PDFDocument.prototype) {
    const fontsDir = this.getFontsDir();
    const regularPath = path.join(fontsDir, "Roboto-Regular.ttf");
    const boldPath = path.join(fontsDir, "Roboto-Bold.ttf");

    if (fs.existsSync(regularPath)) {
      doc.registerFont("Roboto", regularPath);
    }
    if (fs.existsSync(boldPath)) {
      doc.registerFont("Roboto-Bold", boldPath);
    }
  }

  static async generarPDFEvaluacion(
    evaluacion: EvaluacionData,
    resultados: ResultadoData[],
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: "LETTER",
          layout: "landscape",
          margins: { top: 40, bottom: 40, left: 40, right: 40 },
        });

        this.registerFonts(doc);

        const chunks: Buffer[] = [];
        doc.on("data", (chunk) => chunks.push(chunk));
        doc.on("end", () => resolve(Buffer.concat(chunks)));
        doc.on("error", reject);

        const pageWidth = doc.page.width;
        const pageHeight = doc.page.height;

        // ============================================
        // PÁGINA 1: Resumen general
        // ============================================
        this.renderHeader(doc, pageWidth);

        // Título del documento
        let yPos = 100;
        doc
          .fontSize(14)
          .font("Roboto-Bold")
          .fillColor("#000000")
          .text("RESULTADOS DE EVALUACIÓN", 40, yPos, {
            width: pageWidth - 80,
            align: "center",
          });

        yPos += 25;

        // Información de la evaluación
        const tableStartX = 40;
        const tableWidth = pageWidth - 80;

        // Título de la evaluación
        doc
          .rect(tableStartX, yPos, tableWidth, 12)
          .fillAndStroke("#e8e8e8", "#000000");
        doc
          .fillColor("#000000")
          .fontSize(6)
          .font("Roboto-Bold")
          .text("TÍTULO DE LA EVALUACIÓN", tableStartX + 4, yPos + 3, {
            width: tableWidth - 8,
            align: "left",
          });

        doc.rect(tableStartX, yPos + 12, tableWidth, 18).stroke("#000000");
        doc
          .fontSize(8)
          .font("Roboto")
          .text(evaluacion.titulo.toUpperCase(), tableStartX + 4, yPos + 17, {
            width: tableWidth - 8,
            align: "left",
          });

        yPos += 30;

        // Descripción si existe
        if (evaluacion.descripcion) {
          doc
            .rect(tableStartX, yPos, tableWidth, 12)
            .fillAndStroke("#e8e8e8", "#000000");
          doc
            .fillColor("#000000")
            .fontSize(6)
            .font("Roboto-Bold")
            .text("DESCRIPCIÓN", tableStartX + 4, yPos + 3, {
              width: tableWidth - 8,
              align: "left",
            });

          doc.fontSize(7).font("Roboto");
          const descHeight = Math.max(
            18,
            doc.heightOfString(evaluacion.descripcion, {
              width: tableWidth - 8,
            }) + 8,
          );
          doc
            .rect(tableStartX, yPos + 12, tableWidth, descHeight)
            .stroke("#000000");
          doc.text(evaluacion.descripcion, tableStartX + 4, yPos + 16, {
            width: tableWidth - 8,
            align: "left",
          });

          yPos += 12 + descHeight;
        }

        // Fila con info general: Fecha | Total Preguntas | Puntaje Total | Total Participantes | Requiere Firma
        const colCount = 5;
        const colW = tableWidth / colCount;
        const puntajeMaximo = evaluacion.preguntas.reduce(
          (sum, p) => sum + p.puntaje,
          0,
        );
        const fechaCreacion = new Date(
          evaluacion.created_at,
        ).toLocaleDateString("es-CO", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        });

        const infoItems = [
          { label: "FECHA CREACIÓN", value: fechaCreacion },
          {
            label: "TOTAL PREGUNTAS",
            value: String(evaluacion.preguntas.length),
          },
          { label: "PUNTAJE MÁXIMO", value: String(puntajeMaximo) },
          { label: "TOTAL PARTICIPANTES", value: String(resultados.length) },
          {
            label: "REQUIERE FIRMA",
            value: evaluacion.requiere_firma ? "SÍ" : "NO",
          },
        ];

        yPos += 5;
        infoItems.forEach((item, i) => {
          const cellX = tableStartX + i * colW;
          doc.rect(cellX, yPos, colW, 12).fillAndStroke("#e8e8e8", "#000000");
          doc
            .fillColor("#000000")
            .fontSize(6)
            .font("Roboto-Bold")
            .text(item.label, cellX + 2, yPos + 3, {
              width: colW - 4,
              align: "center",
              lineBreak: false,
            });

          doc.rect(cellX, yPos + 12, colW, 16).stroke("#000000");
          doc
            .fontSize(8)
            .font("Roboto")
            .text(item.value, cellX + 2, yPos + 16, {
              width: colW - 4,
              align: "center",
              lineBreak: false,
            });
        });

        yPos += 38;

        // Tabla de resultados de participantes
        doc
          .fontSize(11)
          .font("Roboto-Bold")
          .fillColor("#000000")
          .text("RESUMEN DE PARTICIPANTES", tableStartX, yPos);

        yPos += 18;

        const tableTop = yPos;
        const hasSignature = evaluacion.requiere_firma;

        let tableHeaders: string[];
        let colWidths: number[];

        // Usar todo el ancho disponible del documento (mismo que las tablas de info)
        if (hasSignature) {
          tableHeaders = [
            "No.",
            "NOMBRE COMPLETO",
            "CÉDULA",
            "CARGO",
            "CORREO",
            "TELÉFONO",
            "PUNTAJE",
            "RESULTADO",
            "FIRMA",
          ];
          // Proporciones relativas, se escalan al tableWidth
          const proportions = [3, 18, 8, 19, 11, 7, 6, 7, 14];
          const totalProp = proportions.reduce((a, b) => a + b, 0);
          colWidths = proportions.map((p) =>
            Math.round((p / totalProp) * tableWidth),
          );
          // Ajustar último para que sume exacto
          const diff = tableWidth - colWidths.reduce((a, b) => a + b, 0);
          colWidths[colWidths.length - 1] += diff;
        } else {
          tableHeaders = [
            "No.",
            "NOMBRE COMPLETO",
            "CÉDULA",
            "CARGO",
            "CORREO",
            "TELÉFONO",
            "PUNTAJE",
            "RESULTADO",
          ];
          const proportions = [3, 20, 9, 21, 13, 9, 7, 7];
          const totalProp = proportions.reduce((a, b) => a + b, 0);
          colWidths = proportions.map((p) =>
            Math.round((p / totalProp) * tableWidth),
          );
          const diff = tableWidth - colWidths.reduce((a, b) => a + b, 0);
          colWidths[colWidths.length - 1] += diff;
        }

        const colPositions = [tableStartX];
        for (let i = 0; i < colWidths.length - 1; i++) {
          colPositions.push(colPositions[i] + colWidths[i]);
        }

        // Encabezados
        doc.fontSize(7).font("Roboto-Bold").fillColor("#000000");
        tableHeaders.forEach((header, i) => {
          doc
            .rect(colPositions[i], tableTop, colWidths[i], 20)
            .fillAndStroke("#e0e0e0", "#000000");
          doc
            .fillColor("#000000")
            .text(header, colPositions[i] + 2, tableTop + 6, {
              width: colWidths[i] - 4,
              align: "center",
            });
        });

        yPos = tableTop + 20;
        const rowHeight = 25;

        resultados.forEach((resultado, index) => {
          if (yPos + rowHeight > pageHeight - 60) {
            doc.addPage();
            yPos = 40;

            // Re-dibujar encabezados en nueva página
            this.renderHeader(doc, pageWidth);
            yPos = 100;

            doc.fontSize(7).font("Roboto-Bold").fillColor("#000000");
            tableHeaders.forEach((header, i) => {
              doc
                .rect(colPositions[i], yPos, colWidths[i], 20)
                .fillAndStroke("#e0e0e0", "#000000");
              doc
                .fillColor("#000000")
                .text(header, colPositions[i] + 2, yPos + 6, {
                  width: colWidths[i] - 4,
                  align: "center",
                });
            });
            yPos += 20;
          }

          doc.fontSize(7).font("Roboto");

          colPositions.forEach((pos, i) => {
            doc.rect(pos, yPos, colWidths[i], rowHeight).stroke("#000000");
          });

          const midY = yPos + rowHeight / 2 - 3;

          // No.
          doc.text(String(index + 1), colPositions[0], midY, {
            width: colWidths[0],
            align: "center",
          });
          // Nombre
          doc.text(
            resultado.nombre_completo.toUpperCase(),
            colPositions[1] + 3,
            midY,
            { width: colWidths[1] - 6, align: "center" },
          );
          // Cédula
          doc.text(resultado.numero_documento, colPositions[2], midY, {
            width: colWidths[2],
            align: "center",
          });
          // Cargo
          doc.text(resultado.cargo.toUpperCase(), colPositions[3] + 3, midY, {
            width: colWidths[3] - 6,
            align: "center",
          });
          // Correo
          doc.text(resultado.correo.toLowerCase(), colPositions[4] + 2, midY, {
            width: colWidths[4] - 4,
            align: "center",
          });
          // Teléfono
          doc.text(resultado.telefono, colPositions[5], midY, {
            width: colWidths[5],
            align: "center",
          });
          // Puntaje
          doc
            .font("Roboto-Bold")
            .text(
              `${resultado.puntaje_total}/${puntajeMaximo}`,
              colPositions[6],
              midY,
              { width: colWidths[6], align: "center" },
            );

          // Resultado (Aprobado/Reprobado)
          const porcentaje =
            puntajeMaximo > 0
              ? (resultado.puntaje_total / puntajeMaximo) * 100
              : 0;
          const aprobado = porcentaje >= 70;
          doc
            .font("Roboto-Bold")
            .fillColor(aprobado ? "#16a34a" : "#dc2626")
            .text(aprobado ? "APROBADO" : "REPROBADO", colPositions[7], midY, {
              width: colWidths[7],
              align: "center",
            });
          doc.fillColor("#000000");

          // Firma (si aplica)
          if (hasSignature) {
            try {
              if (resultado.firma && resultado.firma.startsWith("data:image")) {
                const base64Data = resultado.firma.split(",")[1];
                const imageBuffer = Buffer.from(base64Data, "base64");
                const firmaMaxWidth = colWidths[8] - 10;
                const firmaMaxHeight = rowHeight - 6;
                const firmaX = colPositions[8] + 5;
                const firmaY = yPos + 3;
                doc.save();
                doc
                  .rect(
                    colPositions[8] + 1,
                    yPos + 1,
                    colWidths[8] - 2,
                    rowHeight - 2,
                  )
                  .clip();
                doc.image(imageBuffer, firmaX, firmaY, {
                  fit: [firmaMaxWidth, firmaMaxHeight],
                  align: "center",
                  valign: "center",
                });
                doc.restore();
              }
            } catch (e) {
              // Silently handle signature errors
            }
          }

          doc.font("Roboto").fontSize(7);
          yPos += rowHeight;
        });

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  static async generarPDFIndividual(
    evaluacion: EvaluacionData,
    resultado: ResultadoData,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: "LETTER",
          // portrait es el default, sin 'layout'
          margins: { top: 40, bottom: 40, left: 40, right: 40 },
        });

        this.registerFonts(doc);

        const chunks: Buffer[] = [];
        doc.on("data", (chunk) => chunks.push(chunk));
        doc.on("end", () => resolve(Buffer.concat(chunks)));
        doc.on("error", reject);

        const pageWidth = doc.page.width; // 612
        const pageHeight = doc.page.height; // 792
        const tableStartX = 40;
        const tableWidth = pageWidth - 80; // 532
        const bottomMargin = pageHeight - 50;
        const puntajeMaximo = evaluacion.preguntas.reduce(
          (sum, p) => sum + p.puntaje,
          0,
        );

        // ── 2 columnas para preguntas ──────────────────────────
        const colGap = 8;
        const colWidth = (tableWidth - colGap) / 2; // ~262 px
        const col1X = tableStartX;
        const col2X = tableStartX + colWidth + colGap;

        // ══════════════════════════════════════════════
        // CABECERA + INFO PARTICIPANTE (ancho completo)
        // ══════════════════════════════════════════════
        this.renderHeader(doc, pageWidth);
        let y = 100;

        // Título
        doc
          .fontSize(13)
          .font("Roboto-Bold")
          .fillColor("#000000")
          .text("DETALLE DE RESPUESTAS", tableStartX, y, {
            width: tableWidth,
            align: "center",
          });
        y += 20;

        // Evaluación
        doc
          .rect(tableStartX, y, tableWidth, 11)
          .fillAndStroke("#e8e8e8", "#000000");
        doc
          .fillColor("#000000")
          .fontSize(6)
          .font("Roboto-Bold")
          .text("EVALUACIÓN", tableStartX + 4, y + 3, {
            width: tableWidth - 8,
            align: "left",
          });
        doc.rect(tableStartX, y + 11, tableWidth, 15).stroke("#000000");
        doc
          .fontSize(7)
          .font("Roboto")
          .text(evaluacion.titulo.toUpperCase(), tableStartX + 4, y + 14, {
            width: tableWidth - 8,
            align: "left",
          });
        y += 28;

        // Fila 1 participante
        const infoColW = tableWidth / 3;
        const infoRow1 = [
          { label: "NOMBRE", value: resultado.nombre_completo.toUpperCase() },
          { label: "DOCUMENTO", value: resultado.numero_documento },
          { label: "CARGO", value: resultado.cargo.toUpperCase() },
        ];
        infoRow1.forEach((item, i) => {
          const cx = tableStartX + i * infoColW;
          doc.rect(cx, y, infoColW, 11).fillAndStroke("#e8e8e8", "#000000");
          doc
            .fillColor("#000000")
            .fontSize(6)
            .font("Roboto-Bold")
            .text(item.label, cx + 2, y + 3, {
              width: infoColW - 4,
              align: "center",
              lineBreak: false,
            });
          doc.rect(cx, y + 11, infoColW, 13).stroke("#000000");
          doc
            .fontSize(6.5)
            .font("Roboto")
            .text(item.value, cx + 2, y + 14, {
              width: infoColW - 4,
              align: "center",
              lineBreak: false,
            });
        });
        y += 24;

        // Fila 2 participante
        const infoRow2 = [
          { label: "CORREO", value: resultado.correo },
          { label: "TELÉFONO", value: resultado.telefono },
          {
            label: "PUNTAJE",
            value: `${resultado.puntaje_total} / ${puntajeMaximo}`,
          },
        ];
        infoRow2.forEach((item, i) => {
          const cx = tableStartX + i * infoColW;
          doc.rect(cx, y, infoColW, 11).fillAndStroke("#e8e8e8", "#000000");
          doc
            .fillColor("#000000")
            .fontSize(6)
            .font("Roboto-Bold")
            .text(item.label, cx + 2, y + 3, {
              width: infoColW - 4,
              align: "center",
              lineBreak: false,
            });
          doc.rect(cx, y + 11, infoColW, 13).stroke("#000000");
          doc
            .fontSize(6.5)
            .font("Roboto")
            .text(item.value, cx + 2, y + 14, {
              width: infoColW - 4,
              align: "center",
              lineBreak: false,
            });
        });
        y += 24;

        // Resultado + Fecha
        const porcentaje =
          puntajeMaximo > 0
            ? (resultado.puntaje_total / puntajeMaximo) * 100
            : 0;
        const aprobado = porcentaje >= 70;
        const fechaResp = new Date(resultado.created_at).toLocaleDateString(
          "es-CO",
          {
            day: "2-digit",
            month: "long",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          },
        );
        const resColW = tableWidth / 2;

        doc
          .rect(tableStartX, y, resColW, 11)
          .fillAndStroke("#e8e8e8", "#000000");
        doc
          .fillColor("#000000")
          .fontSize(6)
          .font("Roboto-Bold")
          .text("RESULTADO", tableStartX + 2, y + 3, {
            width: resColW - 4,
            align: "center",
            lineBreak: false,
          });
        doc.rect(tableStartX, y + 11, resColW, 13).stroke("#000000");
        doc
          .fontSize(7)
          .font("Roboto-Bold")
          .fillColor(aprobado ? "#16a34a" : "#dc2626")
          .text(aprobado ? "APROBADO" : "REPROBADO", tableStartX + 2, y + 14, {
            width: resColW - 4,
            align: "center",
            lineBreak: false,
          });
        doc.fillColor("#000000");

        doc
          .rect(tableStartX + resColW, y, resColW, 11)
          .fillAndStroke("#e8e8e8", "#000000");
        doc
          .fillColor("#000000")
          .fontSize(6)
          .font("Roboto-Bold")
          .text("FECHA DE RESPUESTA", tableStartX + resColW + 2, y + 3, {
            width: resColW - 4,
            align: "center",
            lineBreak: false,
          });
        doc.rect(tableStartX + resColW, y + 11, resColW, 13).stroke("#000000");
        doc
          .fontSize(6.5)
          .font("Roboto")
          .text(fechaResp, tableStartX + resColW + 2, y + 14, {
            width: resColW - 4,
            align: "center",
            lineBreak: false,
          });
        y += 24;

        // Título sección
        doc
          .fontSize(9)
          .font("Roboto-Bold")
          .fillColor("#000000")
          .text("RESPUESTAS", tableStartX, y);
        y += 12;

        // ══════════════════════════════════════════════
        // PREGUNTAS EN 2 COLUMNAS
        // ══════════════════════════════════════════════
        let yLeft = y;
        let yRight = y;

        /**
         * Renderiza una pregunta en la columna indicada y devuelve
         * la nueva Y de esa columna al terminar.
         */
        const renderQuestion = (
          respuesta: RespuestaDetalleData,
          qIndex: number,
          colX: number,
          colY: number,
        ): number => {
          const pregunta = respuesta.pregunta;
          if (!pregunta) return colY;

          const cw = colWidth;
          const PAD = 4; // padding horizontal interno

          const tipoLabels: Record<string, string> = {
            OPCION_UNICA: "Única",
            OPCION_MULTIPLE: "Múltiple",
            NUMERICA: "Numérica",
            TEXTO: "Texto",
            RELACION: "Relación",
            VERDADERO_FALSO: "V / F",
          };

          let cy = colY;

          // ── Encabezado pregunta ──────────────────────────────────
          doc.rect(colX, cy, cw, 15).fillAndStroke("#f3f4f6", "#d1d5db");
          doc
            .fillColor("#000000")
            .fontSize(6.5)
            .font("Roboto-Bold")
            .text(`P${qIndex + 1}`, colX + 3, cy + 2, { continued: true });
          doc
            .font("Roboto")
            .fontSize(5.5)
            .text(`  [${tipoLabels[pregunta.tipo] || pregunta.tipo}]`, {
              continued: true,
            });

          const esCorrectaTotal = respuesta.puntaje === pregunta.puntaje;
          const esParcial = respuesta.puntaje > 0 && !esCorrectaTotal;
          doc
            .font("Roboto-Bold")
            .fontSize(6)
            .fillColor(
              esCorrectaTotal ? "#16a34a" : esParcial ? "#ca8a04" : "#dc2626",
            )
            .text(`   ${respuesta.puntaje}/${pregunta.puntaje} pts`);
          doc.fillColor("#000000");
          cy += 15;

          // ── Texto de la pregunta (altura dinámica) ───────────────
          doc.fontSize(6.5).font("Roboto-Bold");
          const pregH =
            doc.heightOfString(pregunta.texto, { width: cw - PAD * 2 }) + 6;
          doc.rect(colX, cy, cw, pregH).stroke("#d1d5db");
          doc
            .fillColor("#000000")
            .text(pregunta.texto, colX + PAD, cy + 3, { width: cw - PAD * 2 });
          cy += pregH;

          // ── Encabezado "Respuesta" ───────────────────────────────
          doc.rect(colX, cy, cw, 11).fillAndStroke("#fef3c7", "#d1d5db");
          doc
            .fillColor("#000000")
            .fontSize(5.5)
            .font("Roboto-Bold")
            .text("RESPUESTA DEL PARTICIPANTE", colX + PAD, cy + 3);
          cy += 11;

          // ════════════════════════════════════════════════════════
          //  TIPOS DE RESPUESTA
          // ════════════════════════════════════════════════════════

          if (pregunta.tipo === "TEXTO") {
            const textoResp = respuesta.valor_texto || "Sin respuesta";
            doc.fontSize(6.5).font("Roboto");
            const respH = Math.max(
              16,
              doc.heightOfString(textoResp, { width: cw - PAD * 2 }) + 8,
            );
            doc.rect(colX, cy, cw, respH).stroke("#d1d5db");
            doc
              .fillColor("#000000")
              .text(textoResp, colX + PAD, cy + 4, { width: cw - PAD * 2 });
            cy += respH;
          } else if (pregunta.tipo === "NUMERICA") {
            const valorNum =
              respuesta.valor_numero !== null &&
              respuesta.valor_numero !== undefined
                ? String(respuesta.valor_numero)
                : respuesta.valor_texto || "Sin respuesta";
            const correctaNum =
              pregunta.respuestaCorrecta !== null &&
              pregunta.respuestaCorrecta !== undefined
                ? `   (Correcta: ${pregunta.respuestaCorrecta})`
                : "";
            const content = `${valorNum}${correctaNum}`;
            doc.fontSize(6.5).font("Roboto");
            const numH = Math.max(
              14,
              doc.heightOfString(content, { width: cw - PAD * 2 }) + 6,
            );
            doc.rect(colX, cy, cw, numH).stroke("#d1d5db");
            doc
              .fillColor("#000000")
              .text(content, colX + PAD, cy + 3, { width: cw - PAD * 2 });
            cy += numH;
          } else if (
            pregunta.tipo === "OPCION_UNICA" ||
            pregunta.tipo === "OPCION_MULTIPLE"
          ) {
            const selectedIds: string[] = Array.isArray(respuesta.opcionesIds)
              ? respuesta.opcionesIds
              : [];
            const ICON_W = 14; // espacio reservado para el ícono
            const textW = cw - ICON_W - PAD;

            // ── Pre-calcular altura de CADA opción según su texto ──
            const optionHeights = pregunta.opciones.map((opcion) => {
              // Medir con bold (peor caso = más grande) para no subestimar
              doc.fontSize(6.5).font("Roboto-Bold");
              const textH = doc.heightOfString(opcion.texto, { width: textW });
              return Math.max(14, textH + 6); // mínimo 14px, + padding vertical
            });
            const totalOptH = optionHeights.reduce((s, h) => s + h, 0);

            // Borde exterior de toda la celda de opciones
            doc.rect(colX, cy, cw, totalOptH).stroke("#d1d5db");

            let optAccY = cy; // acumulador de Y para cada opción

            pregunta.opciones.forEach((opcion, oIdx) => {
              const fueSeleccionada = selectedIds.includes(opcion.id);
              const cellH = optionHeights[oIdx];
              const opY = optAccY;

              // Línea divisoria entre opciones
              if (oIdx > 0) {
                doc
                  .moveTo(colX, opY)
                  .lineTo(colX + cw, opY)
                  .stroke("#e5e7eb");
              }

              // Centrar ícono verticalmente en su celda
              const iconX = colX + 6;
              const iconY = opY + cellH / 2;
              const iconR = 3.5;

              // Centrar texto verticalmente en su celda
              doc.fontSize(6.5).font("Roboto-Bold");
              const actualTextH = doc.heightOfString(opcion.texto, {
                width: textW,
              });
              const textY = opY + (cellH - actualTextH) / 2;

              if (fueSeleccionada && opcion.esCorrecta) {
                doc.save();
                doc.circle(iconX, iconY, iconR).fill("#16a34a");
                doc.strokeColor("#ffffff").lineWidth(1);
                doc
                  .moveTo(iconX - 1.5, iconY)
                  .lineTo(iconX - 0.3, iconY + 1.5)
                  .lineTo(iconX + 2, iconY - 1.2)
                  .stroke();
                doc.restore();
                doc
                  .fontSize(6.5)
                  .font("Roboto-Bold")
                  .fillColor("#16a34a")
                  .text(opcion.texto, colX + ICON_W, textY, { width: textW });
              } else if (fueSeleccionada && !opcion.esCorrecta) {
                doc.save();
                doc.circle(iconX, iconY, iconR).fill("#dc2626");
                doc.strokeColor("#ffffff").lineWidth(1);
                doc
                  .moveTo(iconX - 1.5, iconY - 1.5)
                  .lineTo(iconX + 1.5, iconY + 1.5)
                  .stroke();
                doc
                  .moveTo(iconX + 1.5, iconY - 1.5)
                  .lineTo(iconX - 1.5, iconY + 1.5)
                  .stroke();
                doc.restore();
                doc
                  .fontSize(6.5)
                  .font("Roboto-Bold")
                  .fillColor("#dc2626")
                  .text(opcion.texto, colX + ICON_W, textY, { width: textW });
              } else if (!fueSeleccionada && opcion.esCorrecta) {
                doc.save();
                doc.circle(iconX, iconY, iconR).fill("#2563eb");
                doc.restore();
                doc
                  .fontSize(6.5)
                  .font("Roboto")
                  .fillColor("#2563eb")
                  .text(opcion.texto, colX + ICON_W, textY, { width: textW });
              } else {
                doc.save();
                doc
                  .circle(iconX, iconY, iconR)
                  .lineWidth(0.7)
                  .strokeColor("#9ca3af")
                  .stroke();
                doc.restore();
                doc
                  .fontSize(6.5)
                  .font("Roboto")
                  .fillColor("#6b7280")
                  .text(opcion.texto, colX + ICON_W, textY, { width: textW });
              }

              doc.fillColor("#000000").strokeColor("#000000");
              optAccY += cellH; // avanzar al siguiente slot
            });

            cy = optAccY; // cy queda al final de todas las opciones

            // Leyenda compacta
            const legendItems = [
              { color: "#16a34a", filled: true, label: "Sel. correcta" },
              { color: "#dc2626", filled: true, label: "Sel. incorrecta" },
              { color: "#2563eb", filled: true, label: "No seleccionada" },
              { color: "#9ca3af", filled: false, label: "Omitida" },
            ];
            let lx = colX + 2;
            const legendY = cy + 1;
            doc.fontSize(4.5).font("Roboto");
            legendItems.forEach((item, idx) => {
              doc.save();
              if (item.filled)
                doc.circle(lx + 2, legendY + 2, 2).fill(item.color);
              else
                doc
                  .circle(lx + 2, legendY + 2, 2)
                  .lineWidth(0.4)
                  .strokeColor(item.color)
                  .stroke();
              doc.restore();
              const sep = idx < legendItems.length - 1 ? "   " : "";
              doc
                .fillColor("#9ca3af")
                .text(item.label + sep, lx + 6, legendY + 0.5, {
                  continued: idx < legendItems.length - 1,
                  lineBreak: false,
                });
              lx += 6 + doc.widthOfString(item.label + sep);
            });
            doc.fillColor("#000000").strokeColor("#000000");
            cy += 10;
          } else if (pregunta.tipo === "RELACION") {
            const relaciones: { izq: string; der: string }[] = Array.isArray(
              respuesta.relacion,
            )
              ? respuesta.relacion
              : [];

            if (relaciones.length > 0) {
              const ICON_W = 14;
              const textW = cw - ICON_W - PAD;

              // ── Pre-calcular altura de cada relación ──────────────
              const relHeights = relaciones.map((rel) => {
                doc.fontSize(6.5).font("Roboto");
                const label = `${rel.izq}  →  ${rel.der}`;
                return Math.max(
                  14,
                  doc.heightOfString(label, { width: textW }) + 6,
                );
              });
              const totalRelH = relHeights.reduce((s, h) => s + h, 0);

              doc.rect(colX, cy, cw, totalRelH).stroke("#d1d5db");

              let relAccY = cy;

              relaciones.forEach((rel, rIdx) => {
                const cellH = relHeights[rIdx];
                const relY = relAccY;

                if (rIdx > 0)
                  doc
                    .moveTo(colX, relY)
                    .lineTo(colX + cw, relY)
                    .stroke("#e5e7eb");

                const idxIzq = pregunta.relacionIzq.indexOf(rel.izq);
                const esCorrecta =
                  idxIzq !== -1 && pregunta.relacionDer[idxIzq] === rel.der;

                const rx = colX + 6;
                const ry = relY + cellH / 2; // centrar ícono verticalmente

                doc.save();
                if (esCorrecta) {
                  doc.circle(rx, ry, 3.5).fill("#16a34a");
                  doc.strokeColor("#ffffff").lineWidth(1);
                  doc
                    .moveTo(rx - 1.5, ry)
                    .lineTo(rx - 0.3, ry + 1.5)
                    .lineTo(rx + 2, ry - 1.2)
                    .stroke();
                } else {
                  doc.circle(rx, ry, 3.5).fill("#dc2626");
                  doc.strokeColor("#ffffff").lineWidth(1);
                  doc
                    .moveTo(rx - 1.5, ry - 1.5)
                    .lineTo(rx + 1.5, ry + 1.5)
                    .stroke();
                  doc
                    .moveTo(rx + 1.5, ry - 1.5)
                    .lineTo(rx - 1.5, ry + 1.5)
                    .stroke();
                }
                doc.restore();

                const label = `${rel.izq}  →  ${rel.der}`;
                doc.fontSize(6.5).font("Roboto");
                const actualTextH = doc.heightOfString(label, { width: textW });
                const textY = relY + (cellH - actualTextH) / 2;

                doc
                  .fillColor(esCorrecta ? "#16a34a" : "#dc2626")
                  .text(label, colX + ICON_W, textY, { width: textW });
                doc.fillColor("#000000").strokeColor("#000000");

                relAccY += cellH;
              });

              cy = relAccY;
            } else {
              doc.fontSize(6.5).font("Roboto");
              const noRespH = Math.max(
                14,
                doc.heightOfString("Sin respuesta", { width: cw - PAD * 2 }) +
                  6,
              );
              doc.rect(colX, cy, cw, noRespH).stroke("#d1d5db");
              doc
                .fillColor("#000000")
                .text("Sin respuesta", colX + PAD, cy + 3);
              cy += noRespH;
            }
          } else if (pregunta.tipo === "VERDADERO_FALSO") {
            const valorUsuario = respuesta.valor_numero;
            const correcta = pregunta.respuestaCorrecta;
            const esCorrecta =
              typeof valorUsuario === "number" &&
              correcta !== null &&
              correcta !== undefined &&
              valorUsuario === correcta;

            const ICON_W = 14;
            const textW = cw - ICON_W - PAD;

            // Altura dinámica: puede incluir "(Correcta: ...)" en segunda línea
            doc.fontSize(6.5).font("Roboto-Bold");
            const respText =
              typeof valorUsuario === "number"
                ? valorUsuario === 1
                  ? "VERDADERO"
                  : "FALSO"
                : "Sin respuesta";
            const extraText =
              !esCorrecta &&
              correcta !== null &&
              correcta !== undefined &&
              typeof valorUsuario === "number"
                ? `\n(Correcta: ${correcta === 1 ? "Verdadero" : "Falso"})`
                : "";
            const fullText = respText + extraText;
            const vfH = Math.max(
              18,
              doc.heightOfString(fullText, { width: textW }) + 8,
            );

            doc.rect(colX, cy, cw, vfH).stroke("#d1d5db");

            const vx = colX + 6;
            const vy = cy + vfH / 2; // centrar ícono

            doc.save();
            if (typeof valorUsuario === "number") {
              if (esCorrecta) {
                doc.circle(vx, vy, 3.5).fill("#16a34a");
                doc.strokeColor("#ffffff").lineWidth(1);
                doc
                  .moveTo(vx - 1.5, vy)
                  .lineTo(vx - 0.3, vy + 1.5)
                  .lineTo(vx + 2, vy - 1.2)
                  .stroke();
              } else {
                doc.circle(vx, vy, 3.5).fill("#dc2626");
                doc.strokeColor("#ffffff").lineWidth(1);
                doc
                  .moveTo(vx - 1.5, vy - 1.5)
                  .lineTo(vx + 1.5, vy + 1.5)
                  .stroke();
                doc
                  .moveTo(vx + 1.5, vy - 1.5)
                  .lineTo(vx - 1.5, vy + 1.5)
                  .stroke();
              }
              doc.restore();

              // Centrar texto verticalmente
              doc.fontSize(6.5).font("Roboto-Bold");
              const actualTextH = doc.heightOfString(fullText, {
                width: textW,
              });
              const textY = cy + (vfH - actualTextH) / 2;

              doc
                .fillColor(esCorrecta ? "#16a34a" : "#dc2626")
                .text(respText, colX + ICON_W, textY, { width: textW });

              if (!esCorrecta && correcta !== null && correcta !== undefined) {
                doc
                  .font("Roboto")
                  .fillColor("#6b7280")
                  .fontSize(6)
                  .text(
                    `(Correcta: ${correcta === 1 ? "Verdadero" : "Falso"})`,
                    colX + ICON_W,
                    textY + 9,
                    { width: textW },
                  );
              }
            } else {
              doc.restore();
              doc
                .fontSize(6.5)
                .font("Roboto")
                .fillColor("#6b7280")
                .text("Sin respuesta", colX + PAD, cy + (vfH - 8) / 2, {
                  width: cw - PAD * 2,
                });
            }
            doc.fillColor("#000000").strokeColor("#000000");
            cy += vfH;
          }

          cy += 6; // separación entre preguntas
          return cy;
        };

        // ── Placement inteligente: menor Y primero ─────────────
        resultado.respuestas.forEach((respuesta, qIndex) => {
          const pregunta = respuesta.pregunta;
          if (!pregunta) return;

          const estimH = this.estimateQuestionHeight(pregunta, respuesta);
          const leftFits = yLeft + estimH <= bottomMargin;
          const rightFits = yRight + estimH <= bottomMargin;

          if (!leftFits && !rightFits) {
            // Ninguna columna tiene espacio → nueva página
            doc.addPage();
            this.renderHeader(doc, pageWidth);
            yLeft = 100;
            yRight = 100;
          }

          // Elegir columna con menor Y (preferir izquierda en empate)
          if (yLeft <= yRight && (leftFits || !rightFits)) {
            yLeft = renderQuestion(respuesta, qIndex, col1X, yLeft);
          } else {
            yRight = renderQuestion(respuesta, qIndex, col2X, yRight);
          }
        });

        // ══════════════════════════════════════════════
        // FIRMA (si aplica)
        // ══════════════════════════════════════════════
        if (evaluacion.requiere_firma && resultado.firma) {
          let signY = Math.max(yLeft, yRight) + 10;

          if (signY + 80 > bottomMargin) {
            doc.addPage();
            this.renderHeader(doc, pageWidth);
            signY = 100;
          }

          doc
            .fontSize(9)
            .font("Roboto-Bold")
            .fillColor("#000000")
            .text("FIRMA DEL PARTICIPANTE:", tableStartX, signY);
          signY += 15;

          try {
            if (resultado.firma.startsWith("data:image")) {
              const base64Data = resultado.firma.split(",")[1];
              const imageBuffer = Buffer.from(base64Data, "base64");
              const firmaWidth = 200;
              const firmaX = (pageWidth - firmaWidth) / 2;
              doc.image(imageBuffer, firmaX, signY, {
                fit: [firmaWidth, 50],
                align: "center",
                valign: "center",
              });
              signY += 55;
            }
          } catch {
            const lw = 200,
              lx = (pageWidth - 200) / 2;
            doc
              .moveTo(lx, signY + 30)
              .lineTo(lx + lw, signY + 30)
              .stroke();
            signY += 35;
          }

          const lw = 200,
            lx = (pageWidth - 200) / 2;
          doc
            .moveTo(lx, signY)
            .lineTo(lx + lw, signY)
            .stroke();
          doc
            .fontSize(7)
            .font("Roboto")
            .text(resultado.nombre_completo.toUpperCase(), lx, signY + 3, {
              width: lw,
              align: "center",
            });
        }

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  // estimateQuestionHeight ajustado a colWidth (~262 px)
  private static estimateQuestionHeight(
    pregunta: PreguntaData,
    respuesta: RespuestaDetalleData,
  ): number {
    // 15 header + 22 texto pregunta mín + 11 resp-header + 6 spacing
    let height = 54;

    if (pregunta.tipo === "TEXTO") {
      height += 30;
    } else if (pregunta.tipo === "NUMERICA") {
      height += 16;
    } else if (
      pregunta.tipo === "OPCION_UNICA" ||
      pregunta.tipo === "OPCION_MULTIPLE"
    ) {
      // Asumir ~18px por opción para dar margen a textos largos + leyenda
      height += pregunta.opciones.length * 18 + 10;
    } else if (pregunta.tipo === "RELACION") {
      const rels: any[] = Array.isArray(respuesta.relacion)
        ? respuesta.relacion
        : [];
      height += Math.max(16, rels.length * 18);
    } else if (pregunta.tipo === "VERDADERO_FALSO") {
      height += 22;
    }

    return height;
  }
  private static renderHeader(
    doc: typeof PDFDocument.prototype,
    pageWidth: number,
  ) {
    const EMERALD = "#059669";
    const BLACK = "#000000";
    const WHITE = "#ffffff";

    const startX = 40;
    const contentW = pageWidth - 80;
    const startY = 18;
    const headerH = 62;

    const col1W = 160;
    const col3W = 135;
    const col2W = contentW - col1W - col3W;

    const col1X = startX;
    const col2X = startX + col1W;
    const col3X = col2X + col2W;

    // Fondo blanco + borde negro exterior
    doc.rect(col1X, startY, contentW, headerH).fill(WHITE);
    doc
      .rect(col1X, startY, contentW, headerH)
      .lineWidth(1.2)
      .strokeColor(BLACK)
      .stroke();

    // Divisores verticales
    doc.lineWidth(1).strokeColor(BLACK);
    doc
      .moveTo(col2X, startY)
      .lineTo(col2X, startY + headerH)
      .stroke();
    doc
      .moveTo(col3X, startY)
      .lineTo(col3X, startY + headerH)
      .stroke();

    // Filas metadata
    const subRowH = headerH / 3; // ~20.6 px
    const labelH = 9;

    const fecha = new Date().toLocaleDateString("es-CO", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
    const metaRows = [
      { label: "CÓDIGO", value: "HSEG-FR-17" },
      { label: "VERSIÓN", value: "1" },
      { label: "FECHA", value: fecha },
    ];

    metaRows.forEach((row, i) => {
      const rowY = startY + i * subRowH;

      if (i > 0) {
        doc
          .lineWidth(0.6)
          .strokeColor(BLACK)
          .moveTo(col3X, rowY)
          .lineTo(col3X + col3W, rowY)
          .stroke();
      }

      // Label esmeralda
      doc.rect(col3X, rowY, col3W, labelH).fill(EMERALD);
      doc
        .fontSize(5.5)
        .font("Roboto-Bold")
        .fillColor(WHITE)
        .text(row.label, col3X + 4, rowY + 2, {
          width: col3W - 8,
          align: "left",
          lineBreak: false,
        });

      // Valor negro sobre blanco
      const valueH = subRowH - labelH;
      const valueY = rowY + labelH + valueH / 2 - 3.5;
      doc
        .fontSize(7)
        .font("Roboto")
        .fillColor(BLACK)
        .text(row.value, col3X + 4, valueY, {
          width: col3W - 8,
          align: "center",
          lineBreak: false,
        });
    });

    // Logo
    try {
      const logoPath = path.join(
        __dirname,
        "../../assets/transmeralda-logo.webp",
      );
      if (fs.existsSync(logoPath)) {
        doc.image(logoPath, col1X + 12, startY + 10, {
          fit: [col1W - 24, headerH - 20],
          align: "center",
          valign: "center",
        });
      } else {
        throw new Error("no logo");
      }
    } catch {
      doc
        .fontSize(9)
        .font("Roboto-Bold")
        .fillColor(BLACK)
        .text("COTRANSMEQ S.A.S", col1X + 5, startY + headerH / 2 - 6, {
          width: col1W - 10,
          align: "center",
          lineBreak: false,
        });
    }

    // Título
    const titleText = "EVALUACIÓN DE CONOCIMIENTOS";
    doc.fontSize(10).font("Roboto-Bold").fillColor(BLACK);
    const titleH = doc.heightOfString(titleText, { width: col2W - 16 });
    const titleY = startY + (headerH - titleH) / 2;
    doc.text(titleText, col2X + 8, titleY, {
      width: col2W - 16,
      align: "center",
    });

    // Línea esmeralda inferior
    doc.rect(col1X, startY + headerH, contentW, 3).fill(EMERALD);
  }
}
