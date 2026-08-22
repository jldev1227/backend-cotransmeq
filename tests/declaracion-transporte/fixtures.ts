/**
 * Fixtures del formato `declaracion_empresa_transporte`.
 *
 * Los datos son deliberadamente ficticios y reconocibles como tales: ninguna
 * corrida de test debe poder confundirse con un radicado real. La firma se
 * genera en memoria (PNG escrito a mano con zlib) para no versionar una imagen
 * de firma, ni siquiera sintética, dentro del repositorio.
 */
import { Buffer } from 'node:buffer'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import zlib from 'node:zlib'

/** Carpeta de salida para revisión visual. Está en `.gitignore`. */
export const OUT_DIR = resolve(__dirname, '../declaracion-transporte-output')
mkdirSync(OUT_DIR, { recursive: true })

// ─── PNG sintético escrito a mano ───────────────────────────────────

function crc32(buf: Buffer): number {
  const table: number[] = []
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff]
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crcBuf])
}

/**
 * Genera un PNG RGBA con un trazo tipo firma.
 *
 * `opts.width`/`opts.height` permiten probar los tres casos que el generador
 * tiene que resolver sin deformar: firma apaisada, firma alta y firma con
 * fondo transparente.
 */
export function firmaSinteticaDataUrl(
  opts: { width?: number; height?: number; transparente?: boolean } = {}
): string {
  const W = opts.width ?? 600
  const H = opts.height ?? 200
  const transparente = opts.transparente ?? false

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(W, 0)
  ihdr.writeUInt32BE(H, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const stride = 1 + W * 4
  const raw = Buffer.alloc(H * stride)
  const fondo = transparente ? 0 : 255
  for (let y = 0; y < H; y++) {
    raw[y * stride] = 0 // filtro None
    for (let x = 0; x < W; x++) {
      const i = y * stride + 1 + x * 4
      raw[i] = 255
      raw[i + 1] = 255
      raw[i + 2] = 255
      raw[i + 3] = fondo
    }
  }

  // Ambas coordenadas se truncan antes de indexar: `raw` es un Buffer y una
  // asignación con índice fraccionario se descarta en silencio, lo que dejaba
  // el trazo convertido en puntos sueltos.
  const setPixel = (x: number, y: number) => {
    const px = Math.floor(x)
    const py = Math.floor(y)
    if (px < 0 || px >= W || py < 0 || py >= H) return
    const i = py * stride + 1 + px * 4
    raw[i] = 15
    raw[i + 1] = 31
    raw[i + 2] = 26
    raw[i + 3] = 255
  }

  // Trazo continuo con dos ondas, escalado al tamaño pedido.
  //
  // El grosor se calcula como fracción de la altura y no en píxeles fijos: la
  // firma se reduce a ~43 pt de alto dentro de la celda del formato, y un
  // trazo de 1 px desaparecería al escalar, dejando una revisión visual
  // que no prueba nada.
  const grosor = Math.max(2, Math.round(H * 0.03))
  const pasos = W * 4
  for (let s = 0; s <= pasos; s++) {
    const t = s / pasos
    const x = t * (W * 0.9) + W * 0.05
    const y = H / 2 + Math.sin(t * Math.PI * 3) * (H * 0.25)
    for (let d = -grosor; d <= grosor; d++) setPixel(x, y + d)
  }

  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const png = Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0))
  ])
  return 'data:image/png;base64,' + png.toString('base64')
}

// ─── Datos sintéticos base (README_QA_EMAIL) ────────────────────────

export const CORREO_QA = '1227jldev@gmail.com'

/** Fecha fija: los tests no pueden depender del día en que se ejecutan. */
export const FECHA_QA = '2026-08-22'

export function respuestasBase(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    'DET-ENC-01': FECHA_QA,
    'DET-EMP-01': 'TRANSPORTES QA DOCUMENTAL S.A.S.',
    'DET-EMP-02': '900999888-1',
    'DET-REP-01': 'JULIÁN QA DOCUMENTAL',
    'DET-REP-02': '1000000123',
    'DET-REP-03': '+57 300 000 0123',
    'DET-REP-04': CORREO_QA,
    'DET-ACK-01':
      'Sí, declaro que la información es veraz y acepto los compromisos del formato',
    'DET-CNF-01': 'Sí',
    'DET-CNF-02': 'No existen alertas pendientes',
    'DET-CNF-03': 'Sí',
    'DET-FIR-01': firmaSinteticaDataUrl(),
    ...overrides
  }
}

/** Leyenda obligatoria en los anexos sintéticos de QA. */
export const LEYENDA_SINTETICA = 'DOCUMENTO SINTÉTICO DE PRUEBA - SIN VALIDEZ'

/** Anexo mínimo (PDF de una línea) con la leyenda de prueba. */
export function anexoSintetico(): Buffer {
  const contenido = `BT /F1 12 Tf 60 700 Td (${LEYENDA_SINTETICA}) Tj ET`
  const objetos = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${contenido.length} >>\nstream\n${contenido}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ]
  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  objetos.forEach((o, idx) => {
    offsets.push(pdf.length)
    pdf += `${idx + 1} 0 obj\n${o}\nendobj\n`
  })
  const xrefPos = pdf.length
  pdf += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`
  return Buffer.from(pdf, 'latin1')
}
