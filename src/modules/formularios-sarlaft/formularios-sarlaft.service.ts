import { prisma } from "../../config/prisma";
import {
  getFormularioPorCodigo,
  FormularioDefinicion,
  SeccionDefinicion,
  PreguntaDefinicion,
  getDocumentosRequeridos,
  UPLOAD_MAX_BYTES,
  UPLOAD_MIME_PERMITIDOS,
  UPLOAD_EXT_PERMITIDAS,
  TipoDocumentoId,
  DOCUMENTOS_REQUERIDOS,
} from "./formularios-sarlaft.constants";
import type {
  SubmitFormularioSarlaftInput,
  ArchivoUpload,
} from "./formularios-sarlaft.schema";
import { EmailService } from "../../services/email.service";
import {
  uploadToS3,
  deleteFromS3,
  getS3SignedUrl,
  getS3ObjectStream,
} from "../../config/aws";
import { getConfigPorTipo, type TipoFormularioSarlaft } from "./sarlaft-config";
import { PDFGeneratorSarlaftService } from "./pdf-generator-sarlaft-html.service";
import { SarlaftEvidenciaService } from "./evidencia-sarlaft.service";
import { DeclaracionTransportePdfService } from "./declaracion-transporte-pdf.service";
import { DeclaracionTransporteEmailService } from "./declaracion-transporte-email.service";
import {
  DeclaracionTransporteDocumentosService,
  type DocumentoGeneradoDTO,
} from "./declaracion-transporte-documentos.service";
import {
  CAMPOS as CAMPOS_DECL,
  esDecisionFinal,
  extraerDatosClaveDeclaracion,
  limpiarRespuestas,
  normalizarCorreo,
  validarDeclaracionTransporte,
} from "./declaracion-transporte.validacion";
import {
  avisoSandboxHtml,
  copiaDeclaranteHabilitada,
  resolverDestino,
  ttlDescargaPublica,
} from "./sarlaft-email-mode";
import crypto from "crypto";

/** Tipo lógico del formato que se dibuja sobre el PDF controlado de la marca.
 *  Es el único que NO usa el generador HTML genérico. */
const TIPO_DECLARACION = "declaracion_empresa_transporte";

const MENSAJE_RECIBIDO =
  "Formulario y documentos recibidos exitosamente. El Oficial de Cumplimiento de COTRANSMEQ S.A.S. revisará la información y se pondrá en contacto si requiere aclaraciones.";

/** Una firma manuscrita capturada en el formulario. */
export interface FirmaCapturada {
  /** Id de la pregunta de tipo `firma` que la produjo. */
  id: string;
  /** Etiqueta para el PDF (ej. "PROPIETARIO DEL VEHÍCULO"). */
  label: string;
  /** Nombre del firmante, si se pudo resolver. */
  nombre: string | null;
  dataUrl: string;
}

function esDataUrlDeImagen(v: any): v is string {
  return (
    typeof v === "string" && /^data:image\/(png|jpe?g|webp);base64,/i.test(v)
  );
}

/**
 * Etiqueta y nombre del firmante asociados a cada pregunta de tipo `firma`.
 * Los tres formularios SARLAFT tienen una sola firma (la de quien autoriza);
 * SLFT-PTEE-FR-12 tiene dos (propietario y tercero autorizado).
 */
const FIRMANTES: Record<string, { label: string; nombreId: string }> = {
  "CLI-ENC-04": { label: "QUIEN AUTORIZA", nombreId: "CLI-ENC-03" },
  "ACC-ENC-04": { label: "QUIEN AUTORIZA", nombreId: "ACC-ENC-03" },
  "PER-ENC-04": { label: "QUIEN AUTORIZA", nombreId: "PER-ENC-03" },
  "AUT-FIR-07": { label: "PROPIETARIO DEL VEHÍCULO", nombreId: "AUT-FIR-03" },
  "AUT-FIR-12": { label: "TERCERO AUTORIZADO", nombreId: "AUT-FIR-08" },
  "DET-FIR-01": { label: "REPRESENTANTE LEGAL", nombreId: "DET-REP-01" },
};

/**
 * Recorre la definición del formulario y devuelve todas las firmas
 * efectivamente capturadas (dataURL base64 proveniente del canvas del front),
 * en el orden en que aparecen en el documento.
 */
function extraerFirmas(
  formulario: FormularioDefinicion,
  respuestas: Record<string, any> | null | undefined,
): FirmaCapturada[] {
  if (!respuestas) return [];
  const firmas: FirmaCapturada[] = [];
  for (const seccion of formulario.secciones) {
    for (const p of seccion.preguntas) {
      if (p.tipo_respuesta !== "firma") continue;
      const valor = respuestas[p.id];
      if (!esDataUrlDeImagen(valor)) continue;
      const meta = FIRMANTES[p.id];
      firmas.push({
        id: p.id,
        label: meta?.label ?? "QUIEN AUTORIZA",
        nombre: meta ? firstString(respuestas[meta.nombreId]) : null,
        dataUrl: valor,
      });
    }
  }
  return firmas;
}

// ──────────────────────────────────────────────────────────
// Generación de radicado
// ──────────────────────────────────────────────────────────
const RADICADO_PREFIJO: Record<string, { serie: string; tipo: string }> = {
  cliente_proveedor: { serie: "SARLAFT", tipo: "CLI" },
  accionistas: { serie: "SARLAFT", tipo: "ACC" },
  personal: { serie: "SARLAFT", tipo: "PER" },
  autorizacion_propietario: { serie: "AUTPROP", tipo: "PRO" },
  declaracion_empresa_transporte: { serie: "DECL-TRA", tipo: "DEC" },
};

/** Series cuyo radicado es `SERIE-AAAA-#####`, sin el segmento de tipo. */
const SERIES_SIN_TIPO = new Set(["AUTPROP", "DECL-TRA"]);

/**
 * Construye el radicado del envío. El correlativo se calcula por conteo, así
 * que dos envíos simultáneos del mismo tipo pueden proponer el mismo número;
 * `intento` desplaza el correlativo para que el llamador pueda reintentar ante
 * una colisión con el índice UNIQUE de `radicado`.
 */
async function generarRadicado(
  tipoFormulario: string,
  intento = 0,
): Promise<string> {
  const year = new Date().getFullYear();
  const { serie, tipo } =
    RADICADO_PREFIJO[tipoFormulario] ?? RADICADO_PREFIJO.cliente_proveedor;

  // Conteo del año actual
  const desde = new Date(`${year}-01-01T00:00:00Z`);
  const hasta = new Date(`${year}-12-31T23:59:59Z`);

  const count = await prisma.formulario_sarlaft_ptee.count({
    where: {
      fecha_envio: { gte: desde, lte: hasta },
      tipo_formulario: tipoFormulario,
    },
  });

  const correlativo = String(count + 1 + intento).padStart(5, "0");
  return SERIES_SIN_TIPO.has(serie)
    ? `${serie}-${year}-${correlativo}`
    : `${serie}-${year}-${tipo}-${correlativo}`;
}

// ──────────────────────────────────────────────────────────
// Extracción de datos clave (para queries/filtrado)
// ──────────────────────────────────────────────────────────
function extraerDatosClave(
  formulario: FormularioDefinicion,
  respuestas: Record<string, any>,
): {
  nombre_completo: string | null;
  tipo_documento: string | null;
  numero_documento: string | null;
  correo: string | null;
  telefono: string | null;
} {
  // Mapeo por tipo de formulario
  if (formulario.tipo === "personal") {
    return {
      nombre_completo: firstString(respuestas["PER-IG-01"]),
      tipo_documento: "CC",
      numero_documento: firstString(respuestas["PER-IG-02"]),
      correo: firstString(respuestas["PER-IP-03"]),
      telefono: firstString(respuestas["PER-IP-02"]),
    };
  }

  if (formulario.tipo === "accionistas") {
    return {
      nombre_completo: firstString(respuestas["ACC-EMP-01"]),
      tipo_documento: "NIT",
      numero_documento: firstString(respuestas["ACC-EMP-02"]),
      correo: firstString(respuestas["ACC-EMP-05"]),
      telefono: firstString(respuestas["ACC-EMP-04"]),
    };
  }

  if (formulario.tipo === TIPO_DECLARACION) {
    // El titular del trámite es la empresa de transporte; el correo y el
    // teléfono son los del representante legal, que es quien recibe la copia.
    return extraerDatosClaveDeclaracion(respuestas);
  }

  if (formulario.tipo === "autorizacion_propietario") {
    // El titular del trámite es el propietario del vehículo, no el tercero.
    const tipoDoc = firstString(respuestas["AUT-DCL-02"]);
    return {
      nombre_completo: firstString(respuestas["AUT-DCL-01"]),
      tipo_documento: tipoDoc === "NIT" ? "NIT" : "CC",
      numero_documento: firstString(respuestas["AUT-DCL-03"]),
      correo: firstString(respuestas["AUT-FIR-06"]),
      telefono: firstString(respuestas["AUT-FIR-05"]),
    };
  }

  // cliente_proveedor — depende del tipo de cliente
  const tipoCliente = firstString(respuestas["CLI-IG-01"]);
  if (tipoCliente === "Persona Natural") {
    return {
      nombre_completo: firstString(respuestas["CLI-PN-01"]),
      tipo_documento: "CC",
      numero_documento: firstString(respuestas["CLI-PN-02"]),
      correo: firstString(respuestas["CLI-PN-09"]),
      telefono: firstString(respuestas["CLI-PN-08"]),
    };
  }
  // Persona Jurídica o sin definir
  return {
    nombre_completo:
      firstString(respuestas["CLI-PJ-01"]) ??
      firstString(respuestas["CLI-PN-01"]),
    tipo_documento: tipoCliente === "Persona Jurídica" ? "NIT" : "CC",
    numero_documento:
      firstString(respuestas["CLI-PJ-02"]) ??
      firstString(respuestas["CLI-PN-02"]),
    correo:
      firstString(respuestas["CLI-DP-06"]) ??
      firstString(respuestas["CLI-PN-09"]),
    telefono:
      firstString(respuestas["CLI-DP-05"]) ??
      firstString(respuestas["CLI-PN-08"]),
  };
}

function firstString(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number") return String(value);
  return null;
}

// ──────────────────────────────────────────────────────────
// Validación de campos obligatorios
// ──────────────────────────────────────────────────────────
function validarObligatorios(
  formulario: FormularioDefinicion,
  respuestas: Record<string, any>,
): string[] {
  const errores: string[] = [];

  for (const seccion of formulario.secciones) {
    if (!esSeccionVisible(seccion, respuestas)) continue;

    if (seccion.tipo_bloque === "tabla_repetible_multiple") {
      const filas = extraerFilasTabla(seccion, respuestas);
      // Si la sección no tiene campos obligatorios, se permite 0 filas
      const tieneObligatorios = seccion.preguntas.some((p) => p.obligatorio);
      if (filas.length === 0 && tieneObligatorios) {
        errores.push(
          `La sección "${seccion.seccion}" requiere al menos un registro.`,
        );
        continue;
      }
      for (let i = 0; i < filas.length; i++) {
        const fila = filas[i];
        for (const p of seccion.preguntas) {
          if (p.obligatorio && estaVacio(fila[p.id])) {
            errores.push(
              `Fila ${i + 1} de "${seccion.seccion}" — campo "${p.pregunta}" es obligatorio.`,
            );
          }
        }
      }
    } else {
      for (const p of seccion.preguntas) {
        if (!p.obligatorio) continue;
        if (p.tipo_respuesta === "declaracion_informativa") continue;
        if (!esPreguntaVisible(p, respuestas)) continue;
        if (estaVacio(respuestas[p.id])) {
          errores.push(`Campo obligatorio pendiente: "${p.pregunta}"`);
        }
      }
    }
  }

  return errores;
}

/** Una respuesta cuenta como vacía si es null/undefined, string en blanco o
 *  arreglo sin elementos (caso `seleccion_multiple`). */
function estaVacio(valor: unknown): boolean {
  if (valor == null) return true;
  if (Array.isArray(valor)) return valor.length === 0;
  if (typeof valor === "string") return valor.trim() === "";
  return false;
}

function esSeccionVisible(
  seccion: SeccionDefinicion,
  respuestas: Record<string, any>,
): boolean {
  if (!seccion.condicional) return true;
  // Convención: "Se diligencia si <ID_PREGUNTA> = <valor>"
  const match = seccion.condicional.match(/si\s+([A-Z0-9-]+)\s*=\s*(.+)$/i);
  if (!match) return true;
  const [, preguntaId, valorEsperado] = match;
  return respuestas[preguntaId] === valorEsperado.trim();
}

function esPreguntaVisible(
  pregunta: PreguntaDefinicion,
  respuestas: Record<string, any>,
): boolean {
  // Regla declarativa (formularios nuevos): depende de otra pregunta.
  const cond = pregunta.condicional_pregunta;
  if (cond) {
    const origen = respuestas[cond.id];
    if (cond.incluye != null) {
      return Array.isArray(origen) && origen.includes(cond.incluye);
    }
    if (cond.igual_a != null) {
      return origen === cond.igual_a;
    }
  }

  const preguntaId = pregunta.id;
  // Las preguntas *-DEC-04-N son condicionales si DEC-04 = Sí
  if (/^(?:PER|ACC|CLI)-DEC-04-[1-4]$/.test(preguntaId)) {
    const tipo = preguntaId.split("-")[0]; // PER, ACC, CLI
    return respuestas[`${tipo}-DEC-04`] === "Sí";
  }
  // CLI-DEC-05 también es condicional a CLI-DEC-04 = Sí
  if (preguntaId === "CLI-DEC-05") {
    return respuestas["CLI-DEC-04"] === "Sí";
  }
  return true;
}

function extraerFilasTabla(
  seccion: SeccionDefinicion,
  respuestas: Record<string, any>,
): Array<Record<string, any>> {
  // El frontend envía la tabla bajo un key explícito definido en la sección
  // (`key_tabla`) o derivado del id de la primera pregunta como fallback.
  const tablaKey =
    seccion.key_tabla ??
    `${seccion.preguntas[0]?.id.split("-").slice(0, -1).join("-")}__rows`;
  const filas = respuestas[tablaKey];
  if (Array.isArray(filas)) return filas;
  return [];
}

// ──────────────────────────────────────────────────────────
// Validación de archivos
// ──────────────────────────────────────────────────────────
function validarArchivo(archivo: ArchivoUpload): string | null {
  if (archivo.size > UPLOAD_MAX_BYTES) {
    return `El archivo "${archivo.filename}" excede el tamaño máximo de 10 MB.`;
  }
  // Validamos la extensión (lo más confiable) y además el mime type.
  const extOk = UPLOAD_EXT_PERMITIDAS.some((ext) =>
    archivo.filename.toLowerCase().endsWith(ext),
  );
  if (!extOk) {
    return `El archivo "${archivo.filename}" no tiene una extensión permitida. Solo se aceptan: ${UPLOAD_EXT_PERMITIDAS.join(", ")}.`;
  }
  if (archivo.mimetype && !UPLOAD_MIME_PERMITIDOS.includes(archivo.mimetype)) {
    return `El archivo "${archivo.filename}" tiene un tipo MIME no permitido (${archivo.mimetype}).`;
  }
  return null;
}

function calcularHash(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/**
 * Devuelve la URL pública canónica para construir el link redirect al
 * dashboard admin de SARLAFT, idéntica a la lógica del EmailService pero
 * reusada por este módulo.
 */
function getFrontendUrl(): string {
  const v = process.env.EMAIL_FRONTEND_URL?.trim();
  if (v) return v.replace(/\/+$/, "");
  const fe = process.env.FRONTEND_URL?.trim();
  if (fe) {
    const first = fe
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean)[0];
    if (first) return first.replace(/\/+$/, "");
  }
  return "http://localhost:5173";
}

/**
 * URL pública de ESTE backend, usada para construir el enlace temporal de
 * descarga. No sirve `getFrontendUrl()`: el enlace lo atiende el API, no el
 * landing, y apuntarlo al frontend produciría un 404 en el correo.
 */
function getApiPublicUrl(): string {
  const v =
    process.env.SARLAFT_PUBLIC_API_URL?.trim() || process.env.API_PUBLIC_URL?.trim();
  if (v) return v.replace(/\/+$/, "");
  return `http://localhost:${process.env.PORT ?? 4000}`;
}

/** Enlace de descarga de un solo documento, con token aleatorio. */
function urlDescargaPublica(token: string): string {
  return `${getApiPublicUrl()}/api/public/formularios-sarlaft/documentos/descargar?token=${encodeURIComponent(token)}`;
}

// ──────────────────────────────────────────────────────────
// Service público
// ──────────────────────────────────────────────────────────
export const FormulariosSarlaftService = {
  /**
   * Recibe y persiste un envío de formulario público con sus documentos adjuntos.
   * Acepta multipart/form-data con:
   *  - field 'payload': JSON string con las respuestas
   *  - fields 'doc_<tipo>': archivo (uno por cada documento requerido)
   */
  async submit(
    input: SubmitFormularioSarlaftInput,
    archivos: ArchivoUpload[],
    contextoHttp: {
      ip: string | null;
      userAgent: string | null;
      referer: string | null;
    },
  ) {
    const formulario = getFormularioPorCodigo(input.codigo_formulario);
    if (!formulario) {
      throw Object.assign(
        new Error(
          `Código de formulario no soportado: ${input.codigo_formulario}`,
        ),
        { statusCode: 400 },
      );
    }

    // 1. Validar obligatorios
    const errores = validarObligatorios(formulario, input.respuestas);
    if (errores.length > 0) {
      throw Object.assign(new Error("Hay campos obligatorios pendientes"), {
        statusCode: 422,
        details: errores,
      });
    }

    // 2. Validar archivos subidos
    const tipoCliente = firstString(input.respuestas["CLI-IG-01"]);
    const docsRequeridos = getDocumentosRequeridos(
      formulario.tipo,
      tipoCliente as any,
      // La declaración de empresa de transporte decide sus anexos por
      // respuesta condicional, no por tipo de cliente. Los otros cuatro
      // formatos ignoran este tercer argumento.
      input.respuestas,
    );
    const docsRequeridosIds = new Set(docsRequeridos.map((d) => d.id));
    // Separamos los docs que el usuario está obligado a adjuntar (true) de
    // los opcionales, para validar únicamente los obligatorios. Esto
    // permite que el formulario de Vinculación de Personal pueda
    // mostrar documentos opcionales sin bloquear el envío.
    const docsObligatorios = docsRequeridos.filter((d) => d.obligatorio);
    const archivosSubidosPorTipo = new Map<string, ArchivoUpload>();
    for (const archivo of archivos) {
      // fieldname esperado: "doc_<tipo_documento>"
      const match = archivo.fieldname.match(/^doc_(.+)$/);
      if (!match) continue;
      const tipo = match[1];
      if (!docsRequeridosIds.has(tipo as TipoDocumentoId)) continue;
      const err = validarArchivo(archivo);
      if (err) {
        throw Object.assign(new Error(err), { statusCode: 422 });
      }
      archivosSubidosPorTipo.set(tipo, archivo);
    }
    // Reglas propias de la declaración de empresa de transporte: coherencia de
    // confirmaciones, doble digitación del correo, observaciones condicionales
    // y firma. Se corren aquí, con los anexos ya identificados, porque una de
    // las reglas depende de qué archivos llegaron.
    if (formulario.tipo === TIPO_DECLARACION) {
      const erroresDecl = validarDeclaracionTransporte(input.respuestas, {
        correoConfirmacion: input.correo_confirmacion ?? null,
        anexosRecibidos: [...archivosSubidosPorTipo.keys()],
      });
      if (erroresDecl.length > 0) {
        throw Object.assign(new Error("La declaración tiene datos inconsistentes"), {
          statusCode: 422,
          details: erroresDecl,
        });
      }
    }

    const docsFaltantes = docsObligatorios.filter(
      (d) => !archivosSubidosPorTipo.has(d.id),
    );
    if (docsFaltantes.length > 0) {
      throw Object.assign(
        new Error(
          `Faltan documentos obligatorios: ${docsFaltantes.map((d) => d.nombre).join(", ")}`,
        ),
        {
          statusCode: 422,
          details: docsFaltantes.map((d) => `Falta adjuntar: ${d.nombre}`),
        },
      );
    }

    // 3. Extraer datos clave
    const datosClave = extraerDatosClave(formulario, input.respuestas);

    // El snapshot que se archiva no lleva la confirmación de correo: es un
    // control de captura, no una respuesta del formato.
    const respuestasPersistidas =
      formulario.tipo === TIPO_DECLARACION
        ? limpiarRespuestas(input.respuestas)
        : input.respuestas;

    // 4. Persistir formulario + subir archivos a S3 + crear registros de documentos
    const fechaDiligenciamiento = input.fecha_diligenciamiento
      ? new Date(input.fecha_diligenciamiento)
      : null;
    const year = new Date().getFullYear();

    const s3Keys: string[] = [];
    let registroCreado: any = null;
    let documentosCreados: Array<{
      id: string;
      nombre_archivo: string;
      tipo_documento: string;
      s3_key: string;
      mime_type: string;
      tamano_bytes: string;
    }> = [];
    try {
      // El radicado se calcula por conteo, así que dos envíos simultáneos del
      // mismo tipo pueden proponer el mismo número y chocar con el índice
      // UNIQUE. Reintentamos con el correlativo desplazado.
      let registro: any = null;
      let radicado = "";
      for (let intento = 0; intento < 5; intento++) {
        radicado = await generarRadicado(formulario.tipo, intento);
        try {
          registro = await prisma.formulario_sarlaft_ptee.create({
            data: {
              radicado,
              tipo_formulario: formulario.tipo,
              codigo_formulario: formulario.codigo,
              version: formulario.version,
              fecha_diligenciamiento: fechaDiligenciamiento,
              respuestas: respuestasPersistidas as any,
              nombre_completo: datosClave.nombre_completo,
              tipo_documento: datosClave.tipo_documento,
              numero_documento: datosClave.numero_documento,
              correo: datosClave.correo,
              telefono: datosClave.telefono,
              ip_origen: contextoHttp.ip,
              user_agent: contextoHttp.userAgent,
              referer: contextoHttp.referer,
              estado: "recibido",
            },
          });
          break;
        } catch (err: any) {
          const esColisionRadicado =
            err?.code === "P2002" &&
            (err?.meta?.target ?? []).toString().includes("radicado");
          if (!esColisionRadicado) throw err;
        }
      }
      if (!registro) {
        throw Object.assign(
          new Error(
            "No se pudo asignar un número de radicado. Intenta enviar el formulario de nuevo.",
          ),
          { statusCode: 409 },
        );
      }
      registroCreado = registro;

      // Subir cada archivo a S3 y crear el registro
      for (const [tipo, archivo] of archivosSubidosPorTipo) {
        const ext = archivo.filename.match(/\.[^.]+$/)?.[0] || "";
        const s3Key = `sarlaft/${year}/${radicado}/${tipo}_${Date.now()}${ext}`;
        s3Keys.push(s3Key);
        await uploadToS3(s3Key, archivo.buffer, archivo.mimetype);
        const doc = await prisma.formulario_sarlaft_ptee_documento.create({
          data: {
            formulario_id: registro.id,
            tipo_documento: tipo,
            nombre_archivo: archivo.filename,
            s3_key: s3Key,
            mime_type: archivo.mimetype,
            tamano_bytes: BigInt(archivo.size),
            hash_sha256: calcularHash(archivo.buffer),
          },
        });
        documentosCreados.push({
          id: doc.id,
          nombre_archivo: doc.nombre_archivo,
          tipo_documento: doc.tipo_documento,
          s3_key: doc.s3_key,
          mime_type: doc.mime_type,
          tamano_bytes: doc.tamano_bytes.toString(),
        });
      }

      // 6. Generar el documento.
      //
      // La declaración de empresa de transporte se dibuja sobre el PDF
      // controlado de la marca y su generación NO es opcional: si falla, el
      // envío no puede reportarse como recibido, porque no habría documento
      // que entregar ni que archivar. Los otros cuatro formatos conservan el
      // comportamiento anterior (el PDF es una cortesía del correo interno y
      // su falla solo se registra).
      let pdfBuffer: Buffer | null = null;
      let documentoGenerado: DocumentoGeneradoDTO | null = null;
      let descargaTemporal: { url: string; expiresAt: Date } | null = null;

      if (formulario.tipo === TIPO_DECLARACION) {
        const generado = await DeclaracionTransportePdfService.generar({
          radicado,
          respuestas: respuestasPersistidas as Record<string, unknown>,
          estado_documental: "recibida",
          version_documento: 1,
          fecha_generacion: registro.fecha_envio,
        });
        pdfBuffer = generado.buffer;

        documentoGenerado =
          await DeclaracionTransporteDocumentosService.registrarVersion({
            formularioId: registro.id,
            radicado,
            marca: generado.template.marca,
            pdf: generado.buffer,
            pdfSha256: generado.sha256,
            nombreArchivo: generado.nombre_archivo,
            estadoDocumental: "recibida",
            versionDocumento: 1,
            template: generado.template,
          });

        const { token, expiresAt } =
          await DeclaracionTransporteDocumentosService.crearTokenDescarga(
            documentoGenerado.id,
            ttlDescargaPublica(),
          );
        descargaTemporal = { url: urlDescargaPublica(token), expiresAt };
      } else {
        try {
          pdfBuffer = await PDFGeneratorSarlaftService.generarPDFSarlaft({
            radicado,
            tipo_formulario: formulario.tipo,
            version: formulario.version,
            fecha_envio: registro.fecha_envio.toISOString(),
            fecha_diligenciamiento: fechaDiligenciamiento?.toISOString() ?? null,
            nombre_completo: registro.nombre_completo,
            tipo_documento: registro.tipo_documento,
            numero_documento: registro.numero_documento,
            correo: registro.correo,
            telefono: registro.telefono,
            ip_origen: registro.ip_origen,
            user_agent: registro.user_agent,
            referer: registro.referer,
            estado: registro.estado,
            respuestas: input.respuestas,
            documentos: documentosCreados,
            formulario,
          });
        } catch (pdfErr) {
          console.error(
            "[FormulariosSarlaft] No se pudo generar PDF inicial:",
            pdfErr,
          );
        }
      }

      // 7. Notificación interna. Su falla no borra el radicado ni el documento:
      //    el trámite ya está recibido y la entrega queda reintentable.
      try {
        await this.notificarOficialCumplimiento(
          registradoToDTO(registro),
          formulario,
          documentosCreados,
          pdfBuffer,
          documentoGenerado,
        );
      } catch (err) {
        console.error(
          "[FormulariosSarlaft] No se pudo enviar email de notificación:",
          err,
        );
      }

      // 8. Copia al declarante. Deshabilitada por defecto (ver
      //    `copiaDeclaranteHabilitada`): el único correo que sale es la
      //    notificación interna. Si el negocio la reactiva, es un correo
      //    distinto del interno — destinatario, contenido y adjuntos no se
      //    comparten — y lleva SOLO el PDF generado.
      let entregaEmail: {
        destinatario_enmascarado: string;
        estado: string;
        provider_message_id: string | null;
      } | null = null;

      // Solo si el negocio la tiene habilitada. Por defecto está apagada: el
      // trámite se revisa internamente y el declarante conserva su copia desde
      // la pantalla de confirmación, no por correo.
      if (
        formulario.tipo === TIPO_DECLARACION &&
        documentoGenerado &&
        pdfBuffer &&
        copiaDeclaranteHabilitada()
      ) {
        const correoDeclarante = String(
          (respuestasPersistidas as Record<string, unknown>)[CAMPOS_DECL.CORREO] ?? "",
        ).trim();
        const r = await DeclaracionTransporteEmailService.entregarCopiaDeclarante({
          documentoGeneradoId: documentoGenerado.id,
          destinatario: correoDeclarante,
          radicado: registro.radicado,
          codigoFormulario: formulario.codigo,
          versionFormato: formulario.version,
          razonSocial: registro.nombre_completo,
          pdf: pdfBuffer,
          nombreArchivo: documentoGenerado.nombre_archivo,
          pdfSha256: documentoGenerado.pdf_sha256,
          descarga: descargaTemporal,
        });
        entregaEmail = {
          destinatario_enmascarado: r.destinatario_enmascarado,
          estado: r.estado,
          provider_message_id: r.provider_message_id,
        };
      }

      return {
        radicado: registro.radicado,
        fecha_envio: registro.fecha_envio.toISOString(),
        tipo_formulario: registro.tipo_formulario,
        codigo_formulario: registro.codigo_formulario,
        nombre_completo: registro.nombre_completo,
        documentos_adjuntos: archivosSubidosPorTipo.size,
        ...(documentoGenerado && descargaTemporal
          ? {
              documento: {
                id: documentoGenerado.id,
                nombre_archivo: documentoGenerado.nombre_archivo,
                sha256: documentoGenerado.pdf_sha256,
                version_documento: documentoGenerado.version_documento,
                download_url: descargaTemporal.url,
                expires_at: descargaTemporal.expiresAt.toISOString(),
              },
            }
          : {}),
        ...(entregaEmail ? { entrega_email: entregaEmail } : {}),
        mensaje: MENSAJE_RECIBIDO,
      };
    } catch (err) {
      // Si algo falla después de subir archivos a S3, los limpiamos
      for (const key of s3Keys) {
        try {
          await deleteFromS3(key);
        } catch {}
      }
      // Para la declaración de empresa de transporte el documento generado es
      // parte de la transacción funcional: un radicado sin PDF no es un envío
      // recibido a medias, es un envío que no ocurrió. Se borra el registro
      // para que el declarante pueda corregir y reenviar sin quedar con un
      // número de radicado que no corresponde a ninguna evidencia.
      //
      // El borrado se limita a este tipo y a un registro creado en ESTA
      // llamada; los otros cuatro formatos conservan su comportamiento, donde
      // una falla de PDF solo se registra en el log.
      if (registroCreado && formulario.tipo === TIPO_DECLARACION) {
        try {
          await prisma.formulario_sarlaft_ptee.delete({
            where: { id: registroCreado.id },
          });
        } catch (limpiezaErr) {
          console.error(
            `[FormulariosSarlaft] No se pudo revertir el radicado ${registroCreado.radicado} tras un fallo de generación:`,
            limpiezaErr,
          );
        }
      }
      throw err;
    }
  },

  /**
   * Notifica por email al destinatario correspondiente que se recibió un nuevo
   * envío. Usa la configuración centralizada `sarlaft-config.ts` para resolver
   * los correos destino y adjunta el PDF + los archivos originales.
   */
  async notificarOficialCumplimiento(
    registro: ReturnType<typeof registradoToDTO>,
    formulario: FormularioDefinicion,
    documentos: Array<{
      nombre_archivo: string;
      tipo_documento: string;
      mime_type: string;
      s3_key: string;
      tamano_bytes: string;
    }>,
    pdfBuffer: Buffer | null,
    /** Versión documental recién emitida, si el formato la produce. Permite
     *  dejar su hash en el correo interno y registrar la entrega. */
    documentoGenerado?: DocumentoGeneradoDTO | null,
  ) {
    const cfg = getConfigPorTipo(
      registro.tipo_formulario as TipoFormularioSarlaft,
    );
    const serie = formulario.categoria === "sarlaft" ? "SARLAFT" : "PTEE";
    // En sandbox el destino se sustituye por el buzón de pruebas y el asunto
    // se prefija. Nunca se usa BCC para copiar a los destinatarios reales.
    const destino = resolverDestino(cfg.emails);
    const subject = `${destino.prefijoAsunto}[${serie} ${registro.codigo_formulario}] Nuevo formulario recibido — Radicado ${registro.radicado}`;

    const tipoLabel: Record<string, string> = {
      cliente_proveedor: "Cliente / Proveedor",
      accionistas: "Accionistas",
      personal: "Vinculación de Personal",
      autorizacion_propietario: "Autorización del Propietario",
      declaracion_empresa_transporte: "Declaración de empresa de transporte",
    };

    const frontendUrl = getFrontendUrl();
    const dashboardLink = `${frontendUrl}/dashboard/sarlaft/${registro.id}`;

    // HTML del correo
    const html = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <style>
    /* Paleta naranja de COTRANSMEQ — los mismos tokens que usa el template
       del PDF de evidencia (pdf-generator-sarlaft-html.service.ts), para que
       el correo y el documento que viaja adjunto se lean como una sola pieza.
       No usar verde aquí: la identidad de la marca es el naranja. */
    body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; color: #0F172A; line-height: 1.5; background: #FCFCFB; }
    .container { max-width: 640px; margin: 0 auto; padding: 24px; background: #FCFCFB; }
    .card { background: #ffffff; border-radius: 16px; padding: 24px; box-shadow: 0 4px 24px rgba(0,0,0,0.05); border: 1px solid #E4E4E0; }
    .header { display: flex; align-items: center; gap: 12px; padding-bottom: 16px; border-bottom: 1px solid #E4E4E0; }
    .badge { display: inline-block; background: #ffedd5; color: #9a3412; border: 1px solid #fed7aa; font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 6px; text-transform: uppercase; letter-spacing: 0.05em; }
    h1 { font-size: 18px; margin: 12px 0 4px; color: #9a3412; }
    .subtitle { color: #64748B; font-size: 13px; margin: 0; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; }
    td { padding: 8px 0; font-size: 13px; vertical-align: top; }
    td.label { color: #64748B; width: 200px; }
    td.value { color: #0F172A; font-weight: 600; }
    .footer { margin-top: 24px; padding-top: 16px; border-top: 1px solid #E4E4E0; font-size: 12px; color: #94A3B8; }
    .cta { display: inline-block; margin-top: 16px; padding: 10px 20px; background: #f97316; color: #ffffff; text-decoration: none; border-radius: 8px; font-size: 13px; font-weight: 600; }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      ${avisoSandboxHtml(destino)}
      <div class="header">
        <span class="badge">${registro.codigo_formulario}</span>
      </div>
      <h1>Nuevo formulario SARLAFT + PTEE recibido</h1>
      <p class="subtitle">Tipo: ${tipoLabel[registro.tipo_formulario] ?? registro.tipo_formulario} · Área responsable: ${cfg.area_responsable}</p>

      <table>
        <tr>
          <td class="label">Radicado</td>
          <td class="value">${registro.radicado}</td>
        </tr>
        <tr>
          <td class="label">Fecha de envío</td>
          <td class="value">${new Date(registro.fecha_envio).toLocaleString("es-CO", { timeZone: "America/Bogota" })}</td>
        </tr>
        <tr>
          <td class="label">Titular</td>
          <td class="value">${registro.nombre_completo ?? "—"}</td>
        </tr>
        <tr>
          <td class="label">Documento</td>
          <td class="value">${registro.tipo_documento ? registro.tipo_documento + " " : ""}${registro.numero_documento ?? "—"}</td>
        </tr>
        <tr>
          <td class="label">Correo de contacto</td>
          <td class="value">${registro.correo ?? "—"}</td>
        </tr>
        <tr>
          <td class="label">Teléfono</td>
          <td class="value">${registro.telefono ?? "—"}</td>
        </tr>
        <tr>
          <td class="label">IP de origen</td>
          <td class="value">${registro.ip_origen ?? "—"}</td>
        </tr>
        <tr>
          <td class="label">Adjuntos</td>
          <td class="value">${documentos.length} archivo${documentos.length === 1 ? "" : "s"}</td>
        </tr>
        ${
          documentoGenerado
            ? `<tr>
          <td class="label">Documento generado</td>
          <td class="value">${documentoGenerado.codigo_template} v${documentoGenerado.version_template} · versión documental ${documentoGenerado.version_documento} (${documentoGenerado.estado_documental})</td>
        </tr>
        <tr>
          <td class="label">SHA-256 del PDF</td>
          <td class="value" style="font-family:ui-monospace,Menlo,monospace;font-size:11px;word-break:break-all;">${documentoGenerado.pdf_sha256}</td>
        </tr>`
            : ""
        }
      </table>

      <a href="${dashboardLink}" class="cta">
        Ver en el dashboard →
      </a>

      <p style="margin-top:24px; font-size:13px; color:#64748B;">
        Se adjuntan el PDF con las respuestas diligenciadas y los archivos originales
        proporcionados por el titular. Asimismo, la información suministrada en el
        formulario ha sido almacenada de forma segura y se encuentra disponible en el
        sistema interno de cumplimiento para su consulta, revisión y seguimiento cuando
        sea necesario.
      </p>

      <div class="footer">
        COTRANSMEQ S.A.S. — Sistema de cumplimiento SARLAFT + PTEE<br />
        Resolución 2328 de 2025 · Resolución 14673 de 2025 · Ley 1581 de 2012
      </div>
    </div>
  </div>
</body>
</html>`;

    // Descargar adjuntos desde S3 y armar attachments de nodemailer
    type Attachment = {
      filename: string;
      content: Buffer;
      contentType?: string;
    };
    const attachments: Attachment[] = [];
    if (pdfBuffer && pdfBuffer.length > 0) {
      attachments.push({
        filename:
          documentoGenerado?.nombre_archivo ?? `SARLAFT_${registro.radicado}.pdf`,
        content: pdfBuffer,
        contentType: "application/pdf",
      });
    }
    for (const doc of documentos) {
      try {
        const stream = await getS3ObjectStream(doc.s3_key);
        if (!stream) continue;
        const chunks: Buffer[] = [];
        for await (const chunk of stream as any) {
          chunks.push(
            typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer),
          );
        }
        attachments.push({
          filename: doc.nombre_archivo,
          content: Buffer.concat(chunks),
          contentType: doc.mime_type,
        });
      } catch (err) {
        console.error(
          `[FormulariosSarlaft] No se pudo descargar adjunto ${doc.nombre_archivo} para email:`,
          err,
        );
      }
    }

    // Adjuntar las firmas manuscritas como PNG separados (solo si vienen como
    // data:image del canvas). El PDF de respuestas ya las incluye renderizadas,
    // pero el Oficial de Cumplimiento también recibe una copia limpia y
    // recortada de cada firma para sus archivos de auditoría. SLFT-PTEE-FR-12
    // trae dos: la del propietario y la del tercero autorizado.
    const firmas = extraerFirmas(
      formulario,
      (registro as any).respuestas ??
        ((
          await prisma.formulario_sarlaft_ptee.findUnique({
            where: { id: registro.id },
            select: { respuestas: true },
          })
        )?.respuestas as Record<string, any> | undefined),
    );
    for (const firma of firmas) {
      const m = /^data:image\/(png|jpe?g|webp);base64,(.+)$/i.exec(firma.dataUrl);
      if (!m) continue;
      const ext = m[1] === "jpeg" ? "jpg" : m[1];
      const sufijo =
        firmas.length > 1 ? `_${firma.id.toLowerCase().replace(/-/g, "")}` : "";
      attachments.push({
        filename: `firma${sufijo}_${registro.radicado}.${ext}`,
        content: Buffer.from(m[2], "base64"),
        contentType: `image/${m[1]}`,
      });
    }

    // El `from` NO se fija aquí a propósito. Antes se tomaba de `SMTP_FROM`,
    // que apunta a una cuenta @gmail.com; con RESEND_API_KEY configurada el
    // proveedor activo es Resend y éste rechaza cualquier remitente cuyo
    // dominio no esté verificado ("The gmail.com domain is not verified",
    // HTTP 403), así que ninguna notificación SARLAFT llegaba. Delegando en
    // EmailService.sendEmail se usa el remitente correcto para el proveedor
    // activo: RESEND_FROM / noreply@cotransmeq.com con Resend, SMTP_FROM con
    // SMTP.
    //
    // Si el proveedor es SMTP (nodemailer) podemos adjuntar archivos nativos;
    // para Resend (API) también soporta attachments con el mismo formato.
    //
    // NOTA: este correo NUNCA lleva BCC. Los formularios SARLAFT contienen
    // datos personales sensibles (nombre, documento, correo, firma manuscrita)
    // y van directo al Oficial de Cumplimiento — no se debe hacer copia
    // oculta a otras áreas. El NOTIF_BCC_EMAIL del .env aplica SOLO a las
    // notificaciones de conductores (desprendibles / primas).
    const res = await EmailService.sendEmail({
      to: destino.to,
      subject,
      html,
      attachments,
      bcc: undefined,
    } as any);

    // Trazabilidad de la notificación interna. Solo aplica cuando el formato
    // produce una versión documental: es la fila a la que se cuelga el intento.
    if (documentoGenerado) {
      await DeclaracionTransporteDocumentosService.registrarEntrega({
        documentoGeneradoId: documentoGenerado.id,
        canal: "email_interno",
        // En sandbox se registra el destinatario EFECTIVO, no el productivo:
        // la evidencia debe decir a dónde salió el correo de verdad.
        destinatario: destino.to[0] ?? null,
        estado: "enviado",
        proveedor: process.env.RESEND_API_KEY ? "resend" : "smtp",
        providerMessageId: (res as { id?: string } | null)?.id ?? null,
      }).catch((err) => {
        console.error(
          "[FormulariosSarlaft] No se pudo registrar la entrega interna:",
          err,
        );
      });
    }
  },

  /**
   * Listado paginado para el dashboard admin con búsqueda y filtros.
   */
  async listarAdmin(params: {
    page?: number;
    limit?: number;
    search?: string;
    tipo_formulario?: TipoFormularioSarlaft | null;
    estado?: string | null;
    fecha_desde?: string | null;
    fecha_hasta?: string | null;
  }) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 20));
    const skip = (page - 1) * limit;

    const where: any = {};
    if (params.tipo_formulario) where.tipo_formulario = params.tipo_formulario;
    if (params.estado) where.estado = params.estado;
    if (params.fecha_desde || params.fecha_hasta) {
      where.fecha_envio = {};
      if (params.fecha_desde)
        where.fecha_envio.gte = new Date(params.fecha_desde);
      if (params.fecha_hasta)
        where.fecha_envio.lte = new Date(params.fecha_hasta);
    }
    if (params.search) {
      where.OR = [
        { radicado: { contains: params.search, mode: "insensitive" } },
        { nombre_completo: { contains: params.search, mode: "insensitive" } },
        { numero_documento: { contains: params.search, mode: "insensitive" } },
        { correo: { contains: params.search, mode: "insensitive" } },
      ];
    }

    const [items, total] = await Promise.all([
      prisma.formulario_sarlaft_ptee.findMany({
        where,
        include: {
          _count: { select: { documentos: true } },
          evaluado_por: { select: { id: true, nombre: true, correo: true } },
        },
        orderBy: { fecha_envio: "desc" },
        skip,
        take: limit,
      }),
      prisma.formulario_sarlaft_ptee.count({ where }),
    ]);

    return {
      items: items.map((f) => ({
        id: f.id,
        radicado: f.radicado,
        codigo_formulario: f.codigo_formulario,
        tipo_formulario: f.tipo_formulario,
        version: f.version,
        fecha_envio: f.fecha_envio.toISOString(),
        fecha_diligenciamiento: f.fecha_diligenciamiento?.toISOString() ?? null,
        nombre_completo: f.nombre_completo,
        tipo_documento: f.tipo_documento,
        numero_documento: f.numero_documento,
        correo: f.correo,
        telefono: f.telefono,
        estado: f.estado,
        documentos_count: f._count.documentos,
        evaluado_por: f.evaluado_por
          ? { id: f.evaluado_por.id, nombre: f.evaluado_por.nombre }
          : null,
      })),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  },

  /**
   * Detalle completo de un formulario (con respuestas y documentos).
   */
  async obtenerDetalle(id: string) {
    const f = await prisma.formulario_sarlaft_ptee.findUnique({
      where: { id },
      include: {
        documentos: { orderBy: { tipo_documento: "asc" } },
        evaluado_por: { select: { id: true, nombre: true, correo: true } },
      },
    });
    if (!f) return null;

    // Las versiones documentales viven en su propia tabla y traen su historial
    // de entregas: es lo que permite al dashboard mostrar hash, versión y a
    // dónde salió cada copia sin recalcular nada.
    const generados =
      await prisma.formulario_sarlaft_ptee_documento_generado.findMany({
        where: { formulario_id: id },
        orderBy: { version_documento: "desc" },
        include: {
          entregas: { orderBy: { created_at: "asc" } },
          generado_por: { select: { id: true, nombre: true } },
        },
      });

    const documentosGenerados = generados.map((g) => ({
      id: g.id,
      clase: g.clase,
      marca: g.marca,
      version_documento: g.version_documento,
      estado_documental: g.estado_documental,
      codigo_template: g.codigo_template,
      version_template: g.version_template,
      template_sha256: g.template_sha256,
      pdf_sha256: g.pdf_sha256,
      mime_type: g.mime_type,
      tamano_bytes: g.tamano_bytes.toString(),
      created_at: g.created_at.toISOString(),
      generado_por: g.generado_por
        ? { id: g.generado_por.id, nombre: g.generado_por.nombre }
        : null,
      // El token de descarga NUNCA sale de aquí: solo su estado y vigencia.
      entregas: g.entregas.map((e) => ({
        id: e.id,
        canal: e.canal,
        destinatario: e.destinatario,
        estado: e.estado,
        proveedor: e.proveedor,
        provider_message_id: e.provider_message_id,
        intento: e.intento,
        error_codigo: e.error_codigo,
        expires_at: e.expires_at?.toISOString() ?? null,
        completed_at: e.completed_at?.toISOString() ?? null,
        created_at: e.created_at.toISOString(),
      })),
    }));

    return {
      id: f.id,
      radicado: f.radicado,
      codigo_formulario: f.codigo_formulario,
      tipo_formulario: f.tipo_formulario,
      version: f.version,
      fecha_envio: f.fecha_envio.toISOString(),
      fecha_diligenciamiento: f.fecha_diligenciamiento?.toISOString() ?? null,
      nombre_completo: f.nombre_completo,
      tipo_documento: f.tipo_documento,
      numero_documento: f.numero_documento,
      correo: f.correo,
      telefono: f.telefono,
      estado: f.estado,
      evaluacion_concepto: f.evaluacion_concepto,
      evaluacion_observaciones: f.evaluacion_observaciones,
      evaluado_at: f.evaluado_at?.toISOString() ?? null,
      evaluado_por: f.evaluado_por
        ? {
            id: f.evaluado_por.id,
            nombre: f.evaluado_por.nombre,
            correo: f.evaluado_por.correo,
          }
        : null,
      ip_origen: f.ip_origen,
      user_agent: f.user_agent,
      referer: f.referer,
      respuestas: f.respuestas,
      /** Definición del formato (secciones + preguntas). El dashboard la usa
       *  para renderizar genéricamente los formularios que no tienen un mapa
       *  de campos curado, como SLFT-PTEE-FR-12. */
      definicion: getFormularioPorCodigo(f.codigo_formulario),
      documentos: f.documentos.map((d) => ({
        id: d.id,
        tipo_documento: d.tipo_documento,
        nombre_archivo: d.nombre_archivo,
        s3_key: d.s3_key,
        mime_type: d.mime_type,
        tamano_bytes: d.tamano_bytes.toString(),
        hash_sha256: d.hash_sha256,
        created_at: d.created_at.toISOString(),
      })),
      /** Versiones inmutables del documento generado, de la más reciente a la
       *  más antigua. Vacío para los formatos que no usan template. */
      documentos_generados: documentosGenerados,
      created_at: f.created_at.toISOString(),
      updated_at: f.updated_at.toISOString(),
    };
  },

  /**
   * Genera una URL firmada de S3 para descargar un documento del formulario.
   */
  async obtenerUrlDescargaDocumento(documentoId: string) {
    const doc = await prisma.formulario_sarlaft_ptee_documento.findUnique({
      where: { id: documentoId },
    });
    if (!doc) return null;

    const url = await getS3SignedUrl(doc.s3_key, 300); // 5 minutos
    return {
      id: doc.id,
      nombre_archivo: doc.nombre_archivo,
      mime_type: doc.mime_type,
      tamano_bytes: doc.tamano_bytes.toString(),
      url,
      expires_in: 300,
    };
  },

  /**
   * Actualiza el estado de evaluación de un formulario.
   */
  async actualizarEvaluacion(
    id: string,
    data: {
      estado?: string;
      concepto?: string | null;
      observaciones?: string | null;
      userId: string;
    },
  ) {
    const actualizado = await prisma.formulario_sarlaft_ptee.update({
      where: { id },
      data: {
        ...(data.estado && { estado: data.estado }),
        ...(data.concepto !== undefined && {
          evaluacion_concepto: data.concepto,
        }),
        ...(data.observaciones !== undefined && {
          evaluacion_observaciones: data.observaciones,
        }),
        evaluado_por_id: data.userId,
        evaluado_at: new Date(),
      },
    });

    // Una decisión final emite una versión documental NUEVA con la casilla de
    // resultado marcada. La versión recibida no se toca jamás: es la evidencia
    // de qué firmó el declarante, y sobrescribirla destruiría esa prueba.
    //
    // `en_revision` y `escalado` no emiten versión: son etapas, no decisiones.
    // En particular `escalado` NO equivale a `condicionado`.
    if (
      actualizado.tipo_formulario === TIPO_DECLARACION &&
      esDecisionFinal(actualizado.estado)
    ) {
      try {
        await this.emitirVersionEvaluada(actualizado, data.userId);
      } catch (err) {
        // La decisión administrativa ya quedó registrada; si la emisión del
        // documento falla se informa, pero no se revierte la evaluación ni se
        // devuelve un 500 que haga pensar al usuario que no se guardó nada.
        console.error(
          `[FormulariosSarlaft] No se pudo emitir la versión evaluada del radicado ${actualizado.radicado}:`,
          err,
        );
      }
    }

    return actualizado;
  },

  /**
   * Genera y archiva la versión `evaluada` del documento.
   *
   * Cada llamada crea una versión nueva; el índice único
   * `(formulario_id, clase, version_documento)` impide que dos decisiones
   * simultáneas se pisen o reescriban una versión existente.
   */
  async emitirVersionEvaluada(registro: any, userId: string | null) {
    const version =
      await DeclaracionTransporteDocumentosService.siguienteVersion(registro.id);

    const generado = await DeclaracionTransportePdfService.generar({
      radicado: registro.radicado,
      respuestas: (registro.respuestas ?? {}) as Record<string, unknown>,
      estado_documental: "evaluada",
      estado_administrativo: registro.estado,
      version_documento: version,
    });

    const documento =
      await DeclaracionTransporteDocumentosService.registrarVersion({
        formularioId: registro.id,
        radicado: registro.radicado,
        marca: generado.template.marca,
        pdf: generado.buffer,
        pdfSha256: generado.sha256,
        nombreArchivo: generado.nombre_archivo,
        estadoDocumental: "evaluada",
        versionDocumento: version,
        template: generado.template,
        generadoPorId: userId,
      });

    return documento;
  },

  /**
   * Genera el PDF completo de un formulario radicado (admin).
   */
  async generarPDFRespuesta(
    id: string,
  ): Promise<{
    buffer: Buffer;
    radicado: string;
    tipo_formulario: string;
    nombre_archivo: string;
  } | null> {
    const detalle = await this.obtenerDetalle(id);
    if (!detalle) return null;
    const formulario = getFormularioPorCodigo(detalle.codigo_formulario as any);
    if (!formulario) return null;

    // Para la declaración de empresa de transporte se devuelve el binario
    // ARCHIVADO, no uno regenerado: regenerar produciría otro archivo, con otra
    // fecha de creación y otro hash, y dejaría de coincidir con la evidencia
    // que se entregó y se registró.
    if (detalle.tipo_formulario === TIPO_DECLARACION) {
      const versiones = detalle.documentos_generados ?? [];
      const ultima = versiones[0];
      if (!ultima) return null;
      const fila = await DeclaracionTransporteDocumentosService.obtenerVersion(
        ultima.id,
      );
      if (!fila) return null;
      const buffer = await DeclaracionTransporteDocumentosService.leerBinario(
        fila.s3_key,
      );
      if (!buffer) return null;
      return {
        buffer,
        radicado: detalle.radicado,
        tipo_formulario: detalle.tipo_formulario,
        nombre_archivo: `${fila.codigo_template}_${detalle.radicado}_v${fila.version_documento}.pdf`.replace(
          /[^\w.-]/g,
          "_",
        ),
      };
    }

    const buffer = await PDFGeneratorSarlaftService.generarPDFSarlaft({
      radicado: detalle.radicado,
      tipo_formulario: detalle.tipo_formulario as any,
      version: detalle.version,
      fecha_envio: detalle.fecha_envio,
      fecha_diligenciamiento: detalle.fecha_diligenciamiento,
      nombre_completo: detalle.nombre_completo,
      tipo_documento: detalle.tipo_documento,
      numero_documento: detalle.numero_documento,
      correo: detalle.correo,
      telefono: detalle.telefono,
      ip_origen: detalle.ip_origen,
      user_agent: detalle.user_agent,
      referer: detalle.referer,
      estado: detalle.estado,
      respuestas: detalle.respuestas ?? {},
      documentos: detalle.documentos ?? [],
      formulario,
    });
    return {
      buffer,
      radicado: detalle.radicado,
      tipo_formulario: detalle.tipo_formulario,
      nombre_archivo: `SARLAFT_${detalle.radicado}.pdf`,
    };
  },

  /**
   * Genera un ZIP con el PDF + todos los adjuntos (evidencia completa).
   */
  async generarEvidenciaZip(
    id: string,
  ): Promise<{
    buffer: Buffer;
    radicado: string;
    nombre_archivo: string;
  } | null> {
    const detalle = await this.obtenerDetalle(id);
    if (!detalle) return null;

    let pdfBuffer: Buffer | null = null;
    try {
      const pdf = await this.generarPDFRespuesta(id);
      if (pdf) pdfBuffer = pdf.buffer;
    } catch (err) {
      console.error(
        "[FormulariosSarlaft] No se pudo generar PDF para ZIP:",
        err,
      );
    }

    const buffer = await SarlaftEvidenciaService.generarZipEvidencia({
      radicado: detalle.radicado,
      pdfBuffer,
      documentos: detalle.documentos ?? [],
    });
    return {
      buffer,
      radicado: detalle.radicado,
      nombre_archivo: `Evidencia_SARLAFT_${detalle.radicado}.zip`,
    };
  },
};

// Helper para serializar el registro a DTO de respuesta
function registradoToDTO(r: any) {
  return {
    id: r.id,
    radicado: r.radicado,
    tipo_formulario: r.tipo_formulario,
    codigo_formulario: r.codigo_formulario,
    fecha_envio: r.fecha_envio,
    nombre_completo: r.nombre_completo,
    tipo_documento: r.tipo_documento,
    numero_documento: r.numero_documento,
    correo: r.correo,
    telefono: r.telefono,
    ip_origen: r.ip_origen,
  };
}
