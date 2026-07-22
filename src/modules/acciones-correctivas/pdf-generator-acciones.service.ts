import PDFDocument from "pdfkit";
import * as path from "path";
import * as fs from "fs";

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
  causaBg: "#ecfdf5",
  causaBorder: "#6ee7b7",
  white: "#ffffff",
  badgeGreenBg: "#d1fae5",
  badgeGreenText: "#065f46",
  badgeAmberBg: "#fef3c7",
  badgeAmberText: "#92400e",
  badgeRedBg: "#fee2e2",
  badgeRedText: "#991b1b",
  badgeGrayBg: "#f3f4f6",
  badgeGrayText: "#374151",
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

type SeguimientoRow = {
  fecha_seguimiento?: Date | string | null;
  descripcion_observaciones?: string | null;
  estado_accion?: string | null;
  responsable_seguimiento?: string | null;
  cargo_responsable_seguimiento?: string | null;
  evaluacion_eficaz?: string | null;
  adjunto_url?: string | null;
};

type ReplanteoRow = {
  nueva_fecha_limite?: Date | string | null;
  responsable?: string | null;
  justificacion?: string | null;
  cambios?: string | null;
};

type AprobacionRow = {
  rol?: string | null;
  aprobador?: { nombre?: string | null; correo?: string | null; cargo?: string | null } | null;
  estado?: string | null;
  fecha?: Date | string | null;
  comentario?: string | null;
};

type EvaluacionEficaciaRow = {
  fecha_evaluacion?: Date | string | null;
  evaluador?: string | null;
  analisis_evaluacion?: string | null;
};

type CausaRow = {
  orden: number;
  analisis_causa: string;
  es_causa_raiz?: boolean | null;
  descripcion_plan_accion?: string | null;
  fecha_limite_implementacion?: Date | string | null;
  responsable_ejecucion?: string | null;
  fecha_seguimiento?: Date | string | null;
  estado_seguimiento?: string | null;
  descripcion_observaciones?: string | null;
  fecha_evaluacion_eficacia?: Date | string | null;
  criterio_evaluacion_eficacia?: string | null;
  analisis_evidencias_cierre?: string | null;
  evaluacion_cierre_eficaz?: string | null;
  soporte_cierre_eficaz?: string | null;
  fecha_cierre?: Date | string | null;
  responsable_cierre?: string | null;
  seguimientos?: SeguimientoRow[];
};

type CicloRow = {
  numero_ciclo: number;
  fecha_seguimiento?: Date | string | null;
  descripcion?: string | null;
  resultado_ciclo?: string | null;
  responsable?: string | null;
  cargo?: string | null;
  criterios_cumplidos?: string[] | unknown | null;
  impedimento?: string | null;
  nueva_fecha?: Date | string | null;
  adjunto_url?: string | null;
};

type EvidenciaRow = {
  orden: number;
  tipo_evidencia?: string | null;
  descripcion?: string | null;
  fecha?: Date | string | null;
  estado_ubicacion?: string | null;
  adjunto_url?: string | null;
};

type RegistradoPor = {
  nombre?: string | null;
  correo?: string | null;
  cargo?: string | null;
};

export type AccionCorrectivaPDF = {
  accion_numero: string;
  created_at?: Date | string | null;
  updated_at?: Date | string | null;
  id?: string | null;
  lugar_sede?: string | null;
  proceso_origen_hallazgo?: string | null;
  componente_elemento_referencia?: string | null;
  fuente_genero_hallazgo?: string | null;
  fuente_genero_hallazgo_otros?: string | null;
  marco_legal_normativo?: string | null;
  fecha_identificacion_hallazgo?: Date | string | null;
  descripcion_hallazgo?: string | null;
  tipo_hallazgo_detectado?: string | null;
  tipo_hallazgo_otros?: string | null;
  variable_categoria_analisis?: string | null;
  valoracion_riesgo?: string | null;
  requiere_actualizar_matriz?: boolean | null;
  matriz_a_actualizar?: string | null;
  tipo_accion_ejecutar?: string | null;
  aplica_correccion_inmediata?: boolean | null;
  justificacion_no_correccion?: string | null;
  responsable_correccion?: string | null;
  correccion_solucion_inmediata?: string | null;
  fecha_implementacion?: Date | string | null;
  replanteo_correccion?: ReplanteoRow | null;
  seguimientos_correccion?: SeguimientoRow[];
  causas?: CausaRow[];
  fecha_limite_evaluacion_eficacia?: Date | string | null;
  fecha_limite_cierre_accion?: Date | string | null;
  criterio_evaluacion_eficacia?: string | null;
  ciclos_eficacia?: CicloRow[];
  evaluaciones_eficacia?: EvaluacionEficaciaRow[] | unknown;
  evidencias_eficacia?: EvidenciaRow[];
  evaluacion_cierre_eficaz?: string | null;
  fecha_cierre_definitivo?: Date | string | null;
  responsable_cierre?: string | null;
  cargo_responsable_cierre?: string | null;
  observaciones_cierre?: string | null;
  analisis_evidencias_cierre?: string | null;
  soporte_cierre_eficaz?: string | null;
  estado_accion?: string | null;
  observaciones?: string | null;
  aplica_reapertura?: boolean | null;
  fecha_reapertura?: Date | string | null;
  razon_reapertura?: string | null;
  accion_origen_reapertura?: string | null;
  estado_global?: string | null;
  fecha_actualizacion_estado?: Date | string | null;
  registrado_por?: RegistradoPor | null;
  aprobaciones?: AprobacionRow[];
};

type FieldItem = { label: string; value: unknown; wide?: boolean };

export class PDFGeneratorAccionesService {
  static async generarPDFAccion(accion: AccionCorrectivaPDF): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: "LETTER",
          layout: "portrait",
          margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
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

        const fmtFecha = (f?: Date | string | null) => {
          if (!f) return "—";
          const d = typeof f === "string" ? new Date(f) : f;
          return Number.isNaN(d.getTime())
            ? "—"
            : d.toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric" });
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

        const resultadoCiclo = (v?: string | null) =>
          v === "AVANCE_SATISFACTORIO"
            ? "Avance satisfactorio"
            : v === "SIN_AVANCES"
              ? "Sin avances"
              : v === "IMPEDIMENTO_IDENTIFICADO"
                ? "Impedimento identificado"
                : fmt(v);

        const cierreLbl = (v?: string | null) =>
          v === "EFICAZ" ? "Eficaz" : v === "NO EFICAZ" ? "No eficaz" : v === "PARCIAL" ? "Parcial" : fmt(v);

        const fmtEstadoGlobal = (v?: string | null) =>
          v === "EN_PROCESO" ? "En Proceso" : v === "CUMPLIDA" ? "Cumplida" : v === "VENCIDA" ? "Vencida" : v === "REPLANTEADA" ? "Replanteada" : fmt(v);

        const fmtEstadoAprobacion = (v?: string | null) =>
          v === "APROBADO" ? "Aprobado" : v === "RECHAZADO" ? "Rechazado" : v === "PENDIENTE" ? "Pendiente" : v === "NO_APLICA" ? "No aplica" : fmt(v);

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
          color = C.ink,
        ) => {
          doc.fontSize(size).font(font).fillColor(color);
          doc.text(text, x, top, {
            width,
            height,
            lineGap: LINE_GAP,
            lineBreak: true,
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

        const drawKvRow = (left?: FieldItem, right?: FieldItem) => {
          const items = [left, right].filter(Boolean) as FieldItem[];
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

        const colWidths4 = [
          contentW * 0.17,
          contentW * 0.33,
          contentW * 0.17,
          contentW * 0.33,
        ];

        const drawTableRowPairs = (pairs: { label: string; value: unknown }[]) => {
          const pad = CELL_PAD;
          const slots = [
            pairs[0] ?? { label: "", value: "" },
            pairs[1] ?? { label: "", value: "" },
          ];

          let rowH = 11;
          slots.forEach((pair, idx) => {
            const vw = colWidths4[idx * 2 + 1];
            const val = fmt(pair.value);
            rowH = Math.max(rowH, measure(val, vw - pad * 2) + pad * 2);
          });

          ensure(rowH + ROW_GAP);
          const baseY = y;
          let cx = MARGIN;

          slots.forEach((pair, idx) => {
            const lw = colWidths4[idx * 2];
            const vw = colWidths4[idx * 2 + 1];
            const val = fmt(pair.value);

            doc.rect(cx, baseY, lw, rowH).fill(C.line).strokeColor(C.border).lineWidth(0.35).stroke();
            doc
              .fontSize(LABEL)
              .font("Helvetica-Bold")
              .fillColor(C.label)
              .text(pair.label, cx + pad, baseY + 2, {
                width: lw - pad * 2,
                height: rowH - 2,
                lineBreak: true,
              });

            doc.rect(cx + lw, baseY, vw, rowH).strokeColor(C.border).lineWidth(0.35).stroke();
            if (pair.label) {
              writeText(val, cx + lw + pad, baseY + 2, vw - pad * 2, rowH - pad, BODY);
            }

            cx += lw + vw;
          });

          y = baseY + rowH + ROW_GAP;
        };

        const drawTableFullRow = (label: string, value: unknown) => {
          const val = fmt(value);
          const labelW = contentW * 0.22;
          const valueW = contentW - labelW;
          const pad = CELL_PAD;
          const rowH = Math.max(11, measure(val, valueW - pad * 2) + pad * 2);
          ensure(rowH + ROW_GAP);
          const baseY = y;

          doc.rect(MARGIN, baseY, labelW, rowH).fill(C.line).strokeColor(C.border).lineWidth(0.35).stroke();
          doc
            .fontSize(LABEL)
            .font("Helvetica-Bold")
            .fillColor(C.label)
            .text(label, MARGIN + pad, baseY + 2, {
              width: labelW - pad * 2,
              height: rowH - 2,
              lineBreak: true,
            });

          doc.rect(MARGIN + labelW, baseY, valueW, rowH).strokeColor(C.border).lineWidth(0.35).stroke();
          writeText(val, MARGIN + labelW + pad, baseY + 2, valueW - pad * 2, rowH - pad, BODY);

          y = baseY + rowH + ROW_GAP;
        };

        const drawIdentificacionHallazgo = (a: AccionCorrectivaPDF) => {
          drawTableRowPairs([
            { label: "Fecha registro", value: fmtFecha(a.created_at) },
            { label: "Tipo hallazgo", value: a.tipo_hallazgo_detectado },
          ]);
          if (a.tipo_hallazgo_otros) {
            drawTableFullRow("Tipo hallazgo (otro)", a.tipo_hallazgo_otros);
          }
          drawTableRowPairs([
            { label: "Riesgo", value: a.valoracion_riesgo },
            { label: "Tipo acción", value: a.tipo_accion_ejecutar },
          ]);
          drawTableRowPairs([
            { label: "Proceso origen", value: a.proceso_origen_hallazgo },
            { label: "Lugar / Sede", value: a.lugar_sede },
          ]);
          drawTableRowPairs([
            { label: "Fuente", value: a.fuente_genero_hallazgo },
            { label: "Fecha hallazgo", value: fmtFecha(a.fecha_identificacion_hallazgo) },
          ]);
          if (a.fuente_genero_hallazgo_otros) {
            drawTableFullRow("Fuente (otro)", a.fuente_genero_hallazgo_otros);
          }
          drawTableFullRow("Componente / requisito de referencia", a.componente_elemento_referencia);
          drawTableFullRow("Marco legal / normativo / contractual", a.marco_legal_normativo);
          drawTableFullRow("Variable / categoría análisis", a.variable_categoria_analisis);
          drawTableFullRow(
            "Actualizar matrices",
            a.requiere_actualizar_matriz ? fmt(a.matriz_a_actualizar || "Sí") : "No",
          );
          drawTableFullRow("Descripción del hallazgo", a.descripcion_hallazgo);
        };

        const drawFields = (fields: FieldItem[]) => {
          const queue = [...fields];
          while (queue.length) {
            const a = queue.shift();
            if (!a) break;
            if (a.wide) {
              drawPara(a.label, a.value, true);
              continue;
            }
            const b = queue.length && !queue[0].wide ? queue.shift() : undefined;
            drawKvRow(a, b);
          }
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

        const drawSeguimientos = (title: string, items: SeguimientoRow[]) => {
          if (!items?.length) return;
          drawSubTitle(title);
          items.forEach((reg, i) => {
            const parts = [`#${i + 1}`, fmtFecha(reg.fecha_seguimiento), fmt(reg.estado_accion)];
            if (reg.responsable_seguimiento) parts.push(`Resp: ${reg.responsable_seguimiento}`);
            if (reg.cargo_responsable_seguimiento) parts.push(`Cargo: ${reg.cargo_responsable_seguimiento}`);
            if (reg.evaluacion_eficaz) parts.push(`Eval: ${cierreLbl(reg.evaluacion_eficaz)}`);
            const head = parts.join("  ·  ");
            const obs = reg.descripcion_observaciones ? fmt(reg.descripcion_observaciones) : "";
            const body = obs ? `${head}\n${obs}` : head;
            const h = Math.max(12, measure(body, contentW - 8) + 4);
            ensure(h);
            doc.rect(MARGIN, y, contentW, h).fill(C.accentLight).strokeColor(C.border).lineWidth(0.3).stroke();
            writeText(body, MARGIN + 4, y + 2, contentW - 8, h - 2, BODY);
            advance(h);

            if (reg.adjunto_url) {
              drawAdjuntoLink(reg.adjunto_url, reg.adjunto_url);
            }
          });
        };

        const drawAdjuntoLink = (filename: string, url?: string) => {
          if (!filename && !url) return;
          const cleanName = filename.split("?")[0].split("/").pop() || filename;
          const linkUrl = url || filename;
          const iconW = 16;
          const iconH = 12;
          const iconPad = 3;
          const rowH = Math.max(iconH + iconPad * 2, 14);
          ensure(rowH + ROW_GAP);
          const baseY = y;

          // PDF icon box
          doc.save();
          doc.roundedRect(MARGIN + 2, baseY + 1, iconW, iconH, 2).fill("#fee2e2").strokeColor("#f87171").lineWidth(0.4).stroke();
          doc.fontSize(5).font("Helvetica-Bold").fillColor("#dc2626").text("PDF", MARGIN + 3, baseY + 3, { width: iconW - 2, lineBreak: false });
          doc.restore();

          // Underlined clickable filename
          const textX = MARGIN + iconW + 8;
          const textW = contentW - iconW - 16;
          doc.fontSize(BODY).font("Helvetica").fillColor("#0369a1");
          const textH = doc.heightOfString(cleanName, { width: textW, lineGap: LINE_GAP });
          doc.text(cleanName, textX, baseY + 1, { width: textW, lineBreak: true, underline: true });

          // Clickable link area
          const linkH = Math.max(textH, iconH);
          doc.link(textX, baseY, textW, linkH, linkUrl);

          y = baseY + Math.max(rowH, linkH) + ROW_GAP;
        };

        const drawReplanteo = (replanteo: ReplanteoRow) => {
          if (!replanteo) return;
          drawSubTitle("Replanteo de corrección");
          drawFields([
            { label: "Nueva fecha límite", value: fmtFecha(replanteo.nueva_fecha_limite) },
            { label: "Responsable", value: replanteo.responsable },
            { label: "Justificación", value: replanteo.justificacion, wide: true },
            { label: "Cambios", value: replanteo.cambios, wide: true },
          ]);
        };

        const drawAprobaciones = (aprobaciones: AprobacionRow[]) => {
          if (!aprobaciones?.length) return;
          drawSubTitle("Registro de aprobaciones");
          aprobaciones.forEach((ap, i) => {
            const aprobadorNombre = ap.aprobador?.nombre || "—";
            const aprobadorCargo = ap.aprobador?.cargo || "";
            const lines = [
              `#${i + 1}  Rol: ${fmt(ap.rol)}`,
              `Aprobador: ${aprobadorNombre}${aprobadorCargo ? ` (${aprobadorCargo})` : ""}`,
              `Estado: ${fmtEstadoAprobacion(ap.estado)}  ·  Fecha: ${fmtFecha(ap.fecha)}`,
            ];
            if (ap.comentario) lines.push(`Comentario: ${fmt(ap.comentario)}`);
            const body = lines.join("\n");
            const h = Math.max(14, measure(body, contentW - 8) + 4);
            ensure(h);
            doc.rect(MARGIN, y, contentW, h).fill(C.accentLight).strokeColor(C.border).lineWidth(0.3).stroke();
            writeText(body, MARGIN + 4, y + 2, contentW - 8, h - 2, BODY);
            advance(h);
          });
        };

        const drawEvaluacionesEficacia = (evaluaciones: EvaluacionEficaciaRow[]) => {
          if (!evaluaciones?.length) return;
          drawSubTitle("Evaluaciones de eficacia registradas");
          evaluaciones.forEach((ev, i) => {
            const body = [
              `#${i + 1}  Fecha: ${fmtFecha(ev.fecha_evaluacion)}  ·  Evaluador: ${fmt(ev.evaluador)}`,
              ev.analisis_evaluacion ? fmt(ev.analisis_evaluacion) : "",
            ].filter(Boolean).join("\n");
            const h = Math.max(12, measure(body, contentW - 8) + 4);
            ensure(h);
            doc.rect(MARGIN, y, contentW, h).fill(C.accentLight).strokeColor(C.border).lineWidth(0.3).stroke();
            writeText(body, MARGIN + 4, y + 2, contentW - 8, h - 2, BODY);
            advance(h);
          });
        };

        const drawReapertura = (a: AccionCorrectivaPDF) => {
          if (!a.aplica_reapertura) return;
          drawSubTitle("Reapertura de acción");
          drawFields([
            { label: "Fecha de reapertura", value: fmtFecha(a.fecha_reapertura) },
            { label: "Acción origen", value: a.accion_origen_reapertura },
            { label: "Razón de reapertura", value: a.razon_reapertura, wide: true },
          ]);
        };

        const drawCausa = (causa: CausaRow) => {
          const title = `Causa ${causa.orden}${causa.es_causa_raiz ? " (raíz)" : ""}`;
          const titleH = 12;
          ensure(titleH + 2);
          doc.rect(MARGIN, y, contentW, titleH).fill(C.causaBg).strokeColor(C.causaBorder).lineWidth(0.4).stroke();
          doc.fontSize(8).font("Helvetica-Bold").fillColor("#065f46").text(title, MARGIN + 4, y + 2);
          advance(titleH);

          drawPara("Análisis de causas (5 Por Qué)", causa.analisis_causa, true);
          drawFields([
            { label: "Plan de acción", value: causa.descripcion_plan_accion, wide: true },
            { label: "Responsable", value: causa.responsable_ejecucion },
            { label: "Fecha límite", value: fmtFecha(causa.fecha_limite_implementacion) },
            { label: "Estado", value: causa.estado_seguimiento },
            { label: "Últ. seguimiento", value: fmtFecha(causa.fecha_seguimiento) },
          ]);
          if (causa.descripcion_observaciones) {
            drawPara("Observaciones", causa.descripcion_observaciones, true);
          }
          if (causa.seguimientos?.length) {
            drawSeguimientos("Seguimientos de la causa", causa.seguimientos);
          }
          const tieneAdjuntos = causa.seguimientos?.some((s) => s.adjunto_url);
          drawSubTitle("Adjuntos");
          if (tieneAdjuntos) {
            causa.seguimientos?.forEach((seg) => {
              if (seg.adjunto_url) {
                drawAdjuntoLink(seg.adjunto_url, seg.adjunto_url);
              }
            });
          } else {
            ensure(12);
            doc.fontSize(BODY - 1).font("Helvetica-Oblique").fillColor(C.muted);
            doc.text("Sin adjuntos registrados", MARGIN + 4, y, { width: contentW - 8 });
            y += 12 + ROW_GAP;
          }
          const tieneCierre =
            causa.fecha_evaluacion_eficacia ||
            causa.criterio_evaluacion_eficacia ||
            causa.evaluacion_cierre_eficaz;
          if (tieneCierre) {
            drawFields([
              { label: "Eval. eficacia", value: fmtFecha(causa.fecha_evaluacion_eficacia) },
              { label: "Cierre", value: cierreLbl(causa.evaluacion_cierre_eficaz) },
              { label: "Criterio", value: causa.criterio_evaluacion_eficacia, wide: true },
              { label: "Evidencias", value: causa.analisis_evidencias_cierre, wide: true },
              { label: "Soporte", value: causa.soporte_cierre_eficaz, wide: true },
              { label: "Fecha cierre", value: fmtFecha(causa.fecha_cierre) },
              { label: "Resp. cierre", value: causa.responsable_cierre },
            ]);
          }
          y += 2;
        };

        const drawFooter = () => {
          const footerY = pageH - MARGIN - 10;
          const origBottom = doc.page.margins.bottom;
          doc.page.margins.bottom = 0;
          doc.fontSize(6).font("Helvetica").fillColor(C.muted);
          doc.text(
            `Acción ${accion.accion_numero}  ·  Generado ${fmtFecha(new Date())}`,
            MARGIN,
            footerY,
            { width: contentW * 0.6, lineBreak: false },
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
          const logoPath = path.join(__dirname, "../../assets/transmeralda-logo.png");
          if (fs.existsSync(logoPath)) {
            doc.image(logoPath, MARGIN + LOGO_PAD, baseY + LOGO_PAD, { fit: [LOGO_BOX.w - LOGO_PAD * 2, LOGO_BOX.h - LOGO_PAD * 2], align: "center", valign: "center" });
          }
        } catch {
          /* sin logo */
        }

        // Center: Title
        const titleX = MARGIN + LOGO_BOX.w + GAP;
        doc.rect(titleX, baseY, CENTER_W, HEADER_H).strokeColor(C.border).lineWidth(0.5).stroke();
        doc.fontSize(12).font("Helvetica-Bold").fillColor(C.ink).text("Acciones correctivas y preventivas", titleX + 6, baseY + HEADER_H / 2 - 7, { width: CENTER_W - 12, align: "center" });

        // Right: Metadata table
        const metaX = titleX + CENTER_W + GAP;
        const metaItems = [
          { label: "Código:", value: "HSEQ-MTR-07" },
          { label: "Versión:", value: "5" },
          { label: "Generado:", value: fmtFecha(new Date()) },
        ];

        metaItems.forEach((item, i) => {
          const rowY = baseY + i * META_ROW_H;
          const fill = i % 2 === 0 ? C.line : C.white;
          doc.rect(metaX, rowY, META_W, META_ROW_H).fill(fill).strokeColor(C.border).lineWidth(0.5).stroke();
          doc.fontSize(LABEL).font("Helvetica-Bold").fillColor(C.label).text(item.label, metaX + 4, rowY + 3, { lineBreak: false });
          doc.fontSize(BODY).font("Helvetica").fillColor(C.ink).text(item.value, metaX + 4 + doc.widthOfString(item.label), rowY + 3, { width: META_W - 8 - doc.widthOfString(item.label), lineBreak: false });
        });

        // Barra de acción
        const barY = baseY + HEADER_H + 6;
        const barH = 14;
        doc.rect(MARGIN, barY, contentW, barH).fill(C.accent);
        doc.fontSize(10).font("Helvetica-Bold").fillColor(C.white).text(`Acción No. ${accion.accion_numero}`, MARGIN + 6, barY + 3);

        if (accion.estado_global) {
          const statusText = fmtEstadoGlobal(accion.estado_global);
          const statusBg = accion.estado_global === "CUMPLIDA" ? C.badgeGreenBg : accion.estado_global === "VENCIDA" ? C.badgeRedBg : accion.estado_global === "REPLANTEADA" ? C.badgeAmberBg : C.badgeGrayBg;
          const statusTextClr = accion.estado_global === "CUMPLIDA" ? C.badgeGreenText : accion.estado_global === "VENCIDA" ? C.badgeRedText : accion.estado_global === "REPLANTEADA" ? C.badgeAmberText : C.badgeGrayText;
          const badgeX = MARGIN + 6 + doc.widthOfString(`Acción No. ${accion.accion_numero}`) + 12;
          doc.fontSize(LABEL).font("Helvetica-Bold");
          const badgeW = doc.widthOfString(statusText) + 10;
          doc.roundedRect(badgeX, barY + 1, badgeW, barH - 2, 3).fill(statusBg);
          doc.fillColor(statusTextClr);
          doc.text(statusText, badgeX + 5, barY + 3, { width: badgeW - 10 });
        }

        y += HEADER_H + 4 + barH + 4;

        // ── 1 Identificación ──
        drawSection("1", "Identificación del hallazgo");
        drawIdentificacionHallazgo(accion);

        // ── 2 Corrección ──
        drawSection("2", "Corrección inmediata");
        drawFields([
          { label: "¿Aplica corrección inmediata?", value: accion.aplica_correccion_inmediata ?? true },
          { label: "Riesgo hallazgo", value: accion.valoracion_riesgo },
        ]);
        if (accion.aplica_correccion_inmediata === false && accion.justificacion_no_correccion) {
          drawPara("Justificación no corrección", accion.justificacion_no_correccion, true);
        }
        if (accion.aplica_correccion_inmediata) {
          drawPara("Corrección / solución inmediata", accion.correccion_solucion_inmediata, true);
          drawFields([
            { label: "Fecha implementación", value: fmtFecha(accion.fecha_implementacion) },
            { label: "Responsable corrección", value: accion.responsable_correccion },
          ]);
          if (accion.replanteo_correccion) {
            drawReplanteo(accion.replanteo_correccion);
          }
        }
        if (accion.seguimientos_correccion?.length) {
          drawSeguimientos("Seguimiento corrección inmediata", accion.seguimientos_correccion);
        }

        // ── 3 Causas ──
        drawSection("3", "Análisis de causas y plan de acción");
        if (accion.causas?.length) {
          accion.causas.forEach(drawCausa);
        } else {
          drawKvRow({ label: "Causas", value: "—" });
        }

        // ── 4 Aprobaciones ──
        if (accion.aprobaciones?.length) {
          drawSection("4", "Aprobaciones");
          drawAprobaciones(accion.aprobaciones);
        }

        // ── 5 Eficacia ──
        const eficaciaSectionNum = accion.aprobaciones?.length ? "5" : "4";
        drawSection(eficaciaSectionNum, "Evaluación de eficacia");
        drawFields([
          { label: "Fecha límite eval.", value: fmtFecha(accion.fecha_limite_evaluacion_eficacia) },
          { label: "Fecha límite cierre acción", value: fmtFecha(accion.fecha_limite_cierre_accion) },
          { label: "Cierre eficaz", value: cierreLbl(accion.evaluacion_cierre_eficaz) },
          { label: "Fecha cierre", value: fmtFecha(accion.fecha_cierre_definitivo) },
          { label: "Responsable cierre", value: accion.responsable_cierre },
          { label: "Cargo", value: accion.cargo_responsable_cierre },
        ]);
        drawPara("Criterio de evaluación", accion.criterio_evaluacion_eficacia, true);

        if (Array.isArray(accion.evaluaciones_eficacia) && accion.evaluaciones_eficacia.length) {
          drawEvaluacionesEficacia(accion.evaluaciones_eficacia as EvaluacionEficaciaRow[]);
        }

        if (accion.ciclos_eficacia?.length) {
          drawSubTitle("Ciclos de seguimiento a la eficacia");
          accion.ciclos_eficacia.forEach((ciclo) => {
            const critArr = Array.isArray(ciclo.criterios_cumplidos)
              ? (ciclo.criterios_cumplidos as string[])
              : [];
            const crit = critArr.length
              ? `\nCriterios: ${critArr.map((c, i) => `${i + 1}. ${c}`).join(" ")}`
              : "";
            const impedimento = ciclo.impedimento ? `\nImpedimento: ${fmt(ciclo.impedimento)}` : "";
            const nuevaFecha = ciclo.nueva_fecha ? `\nNueva fecha propuesta: ${fmtFecha(ciclo.nueva_fecha)}` : "";
            const body = [
              `${fmtFecha(ciclo.fecha_seguimiento)} · ${resultadoCiclo(ciclo.resultado_ciclo)} · ${fmt(ciclo.responsable)} (${fmt(ciclo.cargo)})`,
              ciclo.descripcion ? fmt(ciclo.descripcion) : "",
              crit,
              impedimento,
              nuevaFecha,
            ]
              .filter(Boolean)
              .join("\n");
            drawPara(`Ciclo ${ciclo.numero_ciclo}`, body, true);
            if (ciclo.adjunto_url) {
              drawAdjuntoLink(ciclo.adjunto_url, ciclo.adjunto_url);
            } else {
              ensure(12);
              doc.fontSize(BODY - 1).font("Helvetica-Oblique").fillColor(C.muted);
              doc.text("Sin adjunto", MARGIN + 4, y, { width: contentW - 8 });
              y += 12 + ROW_GAP;
            }
          });
        }

        if (accion.evidencias_eficacia?.length) {
          drawSubTitle("Evidencias de cierre");
          accion.evidencias_eficacia.forEach((ev) => {
            drawFields([
              { label: `Evidencia #${ev.orden}`, value: ev.tipo_evidencia },
              { label: "Fecha", value: fmtFecha(ev.fecha) },
              { label: "Estado", value: ev.estado_ubicacion === "DISPONIBLE" ? "Disponible" : ev.estado_ubicacion === "PENDIENTE" ? "Pendiente" : fmt(ev.estado_ubicacion) },
              { label: "Descripción", value: ev.descripcion, wide: true },
            ]);
            if (ev.adjunto_url) {
              drawAdjuntoLink(ev.adjunto_url, ev.adjunto_url);
            } else {
              ensure(12);
              doc.fontSize(BODY - 1).font("Helvetica-Oblique").fillColor(C.muted);
              doc.text("Sin adjunto", MARGIN + 4, y, { width: contentW - 8 });
              y += 12 + ROW_GAP;
            }
          });
        }

        if (accion.soporte_cierre_eficaz) {
          drawPara("Soporte del cierre eficaz", accion.soporte_cierre_eficaz, true);
        }
        if (accion.analisis_evidencias_cierre) {
          drawPara("Análisis y evidencias (acción)", accion.analisis_evidencias_cierre, true);
        }
        if (accion.observaciones_cierre) {
          drawPara("Observaciones y lecciones aprendidas", accion.observaciones_cierre, true);
        }

        // ── Reapertura ──
        if (accion.aplica_reapertura) {
          const reaperturaNum = accion.aprobaciones?.length ? "6" : "5";
          drawSection(reaperturaNum, "Reapertura");
          drawReapertura(accion);
        }

        // ── Estado y observaciones ──
        if (accion.estado_global || accion.estado_accion || accion.observaciones) {
          const metaNum = accion.aplica_reapertura ? (accion.aprobaciones?.length ? "7" : "6") : (accion.aprobaciones?.length ? "6" : "5");
          drawSection(metaNum, "Estado y observaciones");
          drawFields([
            { label: "Estado global", value: fmtEstadoGlobal(accion.estado_global) },
            { label: "Estado acción", value: accion.estado_accion },
            { label: "Fecha actualización estado", value: fmtFecha(accion.fecha_actualizacion_estado) },
          ]);
          if (accion.observaciones) {
            drawPara("Observaciones generales", accion.observaciones, true);
          }
        }

        drawFooter();

        doc.end();
      } catch (err) {
        console.error("Error generando PDF:", err);
        reject(err);
      }
    });
  }
}
