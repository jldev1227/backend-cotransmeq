import { execFile } from 'child_process'
import { randomUUID } from 'crypto'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'

/**
 * Comprime un PDF escaneado con Ghostscript (`/ebook`), con los mismos
 * ajustes que el importador de documentos de vehículos: un escaneo de
 * cédula o de examen médico de 3-4 MB suele quedar en unos cientos de KB.
 *
 * Si `gs` no está instalado, falla o tarda demasiado, se sube el original:
 * comprimir es un ahorro, nunca un motivo para rechazar el documento. La
 * imagen de producción instala `ghostscript` en el `apk add` del Dockerfile
 * (desde el 11-oct-2026); si alguien lo quita, esto vuelve a subir originales
 * sin avisar.
 *
 * Asíncrono a propósito: `spawnSync` (lo que usa el importador, que corre
 * solo) congelaría la API entera mientras Ghostscript trabaja.
 */
const MIN_BYTES = 300 * 1024
const TIEMPO_MAXIMO_MS = 60_000

export async function comprimirPdf(buffer: Buffer): Promise<Buffer> {
  if (buffer.length < MIN_BYTES) return buffer
  const base = path.join(os.tmpdir(), `doccond-${randomUUID()}`)
  const entrada = `${base}-in.pdf`
  const salida = `${base}-out.pdf`
  try {
    await fs.writeFile(entrada, buffer)
    await new Promise<void>((resolve, reject) =>
      execFile(
        'gs',
        [
          '-dSAFER',
          '-sDEVICE=pdfwrite',
          '-dCompatibilityLevel=1.5',
          '-dPDFSETTINGS=/ebook',
          '-dNOPAUSE',
          '-dQUIET',
          '-dBATCH',
          `-sOutputFile=${salida}`,
          entrada,
        ],
        { timeout: TIEMPO_MAXIMO_MS },
        (error) => (error ? reject(error) : resolve()),
      ),
    )
    const comprimido = await fs.readFile(salida)
    /// Solo si ahorra de verdad: un PDF ya optimizado puede salir igual o
    /// más pesado, y entonces no vale la pena perder fidelidad.
    return comprimido.length > 0 && comprimido.length <= buffer.length * 0.85 ? comprimido : buffer
  } catch {
    return buffer
  } finally {
    await Promise.allSettled([fs.unlink(entrada), fs.unlink(salida)])
  }
}
