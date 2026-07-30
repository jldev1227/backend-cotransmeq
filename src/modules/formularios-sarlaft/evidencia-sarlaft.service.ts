import archiver from "archiver";
import { Readable } from "stream";
import { getS3ObjectStream } from "../../config/aws";

/**
 * Generador de evidencia SARLAFT — produce un archivo ZIP que contiene:
 *  - 01_Resumen_<radicado>.pdf          ← PDF con las respuestas diligenciadas
 *  - 02_Adjuntos/<tipo>_<archivo>       ← archivos originales subidos por el usuario
 *
 * La organización por respuesta (carpeta ZIP por radicado) se hace desde el
 * servicio principal al pasar `zipFileName` por radicado.
 */

type DocumentoAdjunto = {
  id: string;
  tipo_documento: string;
  nombre_archivo: string;
  s3_key: string;
  mime_type: string;
  tamano_bytes: string;
};

export const SarlaftEvidenciaService = {
  /**
   * Genera un buffer ZIP con el PDF + todos los adjuntos.
   * Si `pdfBuffer` no se entrega, se omite del ZIP.
   * Los adjuntos se descargan desde S3 vía stream y se anexan al ZIP.
   */
  async generarZipEvidencia(args: {
    radicado: string
    pdfBuffer?: Buffer | null
    documentos: DocumentoAdjunto[]
  }): Promise<Buffer> {
    const { radicado, pdfBuffer, documentos } = args

    const archive = archiver("zip", { zlib: { level: 6 } })
    const chunks: Buffer[] = []

    archive.on("data", (chunk: Buffer) => chunks.push(chunk))
    const finished = new Promise<Buffer>((resolve, reject) => {
      archive.on("end", () => resolve(Buffer.concat(chunks)))
      archive.on("error", reject)
    })

    // 1) PDF
    if (pdfBuffer && pdfBuffer.length > 0) {
      const sanitized = radicado.replace(/[^a-zA-Z0-9-_]/g, "_")
      archive.append(pdfBuffer, { name: `01_Resumen_${sanitized}.pdf` })
    }

    // 2) Adjuntos — uno por uno, sin bloquear si alguno falla
    for (const doc of documentos) {
      try {
        const stream = await getS3ObjectStream(doc.s3_key)
        if (!stream) continue
        const safeName = sanitizeFileName(doc.nombre_archivo)
        const finalName = `${doc.tipo_documento}_${safeName}`
        archive.append(stream as Readable, { name: `02_Adjuntos/${finalName}` })
      } catch (err) {
        console.error(`[SarlaftEvidencia] No se pudo añadir ${doc.nombre_archivo}:`, err)
      }
    }

    await archive.finalize()
    return finished
  }
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^\w.\- ]/g, "_").slice(0, 120)
}
