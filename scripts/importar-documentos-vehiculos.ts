/**
 * Importa la documentación de los vehículos desde el folder de OneDrive
 * «02. VEHICULOS» a la hoja de vida de cada vehículo (tabla `documento` + S3).
 *
 * Estructura que espera:
 *   <raíz>/1. FLOTA/{SEDE}/{interno} {PLACA}/{N. CATEGORÍA}/archivo.pdf
 *   <raíz>/2. TERCEROS/{SEDE}/{interno} {PLACA}/…
 * Una carpeta de placa con sufijo `_NO`, o dentro de una carpeta OBSOLETO, es
 * un vehículo desvinculado: se ignora. Dentro de cada categoría, lo que está
 * en `OBSOLETO` es historial.
 *
 * El VENCIMIENTO sale del nombre del archivo (así nombran los documentos:
 * `SOAT PUM337 2027-06-16.pdf`, verificado contra el texto de los PDF). Si el
 * nombre no lo trae, se busca «vencimiento/hasta» en el texto del PDF; si
 * tampoco, el documento se sube sin fecha y queda «Sin fecha» en la app para
 * completarlo a mano.
 *
 * Contra lo que ya hay en la base (la carga de 2025):
 *  - mismo archivo (sha256) o misma categoría y vencimiento → se omite;
 *  - vencimiento más nuevo que el actual → se sube como vigente;
 *  - más viejo → se sube como historial, sin tocar el vigente.
 * Además corrige `fecha_vencimiento` en las filas de 2025, que guardaron la
 * fecha un día corrida (el valor bueno está en `metadata.fechaVigenciaOriginal`).
 *
 * POR DEFECTO SOLO SIMULA: no escribe en la base ni sube a S3.
 *
 *   npx tsx scripts/importar-documentos-vehiculos.ts "<raíz 02. VEHICULOS>" \
 *     [--reporte salida.json] [--placa PUM337] [--sin-historial] [--aplicar]
 *
 * Con `--aplicar` los PDF se comprimen con Ghostscript (/ebook) cuando eso
 * ahorra al menos un 15 %, y las imágenes sueltas de un mismo documento
 * (`…_001.png`, `…_002.png`) se unen en un solo PDF.
 */
import { createHash } from 'crypto'
import { spawnSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { prisma } from '../src/config/prisma'
import { CATEGORIA_POR_CLAVE } from '../src/modules/vehiculos-documentos/catalogo'
import { VehiculosDocumentosService, vencimientoDe } from '../src/modules/vehiculos-documentos/vehiculos-documentos.service'

const args = process.argv.slice(2)
const RAIZ = args.find((a) => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.match(/^--(reporte|placa)$/))
const APLICAR = args.includes('--aplicar')
const SIN_HISTORIAL = args.includes('--sin-historial')
const valorDe = (bandera: string) => (args.includes(bandera) ? args[args.indexOf(bandera) + 1] : undefined)
const REPORTE = valorDe('--reporte') ?? 'importacion-documentos-vehiculos.json'
const SOLO_PLACA = valorDe('--placa')?.toUpperCase().replace(/[^A-Z0-9]/g, '') ?? null
const GRUPOS = ['1. FLOTA', '2. TERCEROS']
/// El historial más viejo que esto no aporta a la hoja de vida y pesa.
const HISTORIAL_DESDE = '2023-01-01'

if (!RAIZ || !fs.existsSync(RAIZ)) {
  console.error('Uso: npx tsx scripts/importar-documentos-vehiculos.ts "<raíz 02. VEHICULOS>" [--reporte f.json] [--placa X] [--sin-historial] [--aplicar]')
  process.exit(1)
}

// ── Normalización ──────────────────────────────────────────────────────────
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
const placaDe = (carpeta: string) => {
  const m = norm(carpeta).match(/\b([A-Z]{3})\s*-?\s*(\d{3})\b/)
  return m ? m[1] + m[2] : null
}

/** Carpeta de categoría (primer nivel dentro de la placa) → clave del catálogo. */
const CARPETAS: Array<[RegExp, string]> = [
  [/HOJA DE VIDA/, 'HOJA_DE_VIDA'],
  [/TARJETA DE PROPIEDAD|LICENCIA DE TRANSITO/, 'TARJETA_DE_PROPIEDAD'],
  [/SOAT/, 'SOAT'],
  [/TECNOMECANICA|TECNICOMECANICA/, 'TECNOMECANICA'],
  [/PREVENTIVA/, 'REVISION_PREVENTIVA'],
  [/PERITAJE/, 'PERITAJE'],
  [/TARJETA DE OPERACI/, 'TARJETA_DE_OPERACION'],
  [/POLIZAS? DE RESPONSABILIDAD/, 'POLIZA_RC'], // se resuelve por subcarpeta/nombre
  [/TODO RIESGO/, 'POLIZA_TODO_RIESGO'],
  [/\bGPS\b/, 'CERTIFICADO_GPS'],
  [/^\W*\d*\W*RUNT\b/, 'RUNT'],
  [/CONTRATO DE PRESTACION/, 'CONTRATO_PRESTACION'],
  [/CONTRATO DE ADMINISTRACION/, 'CONTRATO_ADMINISTRACION'],
  [/CAPACIDAD TRANSPORTADORA/, 'CAPACIDAD_TRANSPORTADORA'],
  [/SENALIZACION|CALCOMANIA/, 'SENALIZACION'],
  [/^\W*\d*\W*RUT\b/, 'RUT_PROPIETARIO'],
  [/SIMIT/, 'SIMIT'],
  [/DIJIN|SIJIN/, 'REVISION_DIJIN'],
  [/PAZ Y SALVO/, 'PAZ_Y_SALVO_MOVILIDAD'],
  [/IMPUESTO/, 'IMPUESTO_VEHICULAR'],
  [/MANUAL|MANUEL DEL VEHICULO/, 'MANUAL'],
]
/// Archivos que no son de la categoría aunque estén en su carpeta.
const AJENOS = /RH-FR|CERTIFICACION LABORAL|\.LNK$|\.INI$|^~\$/

function categoriaDe(rel: string): string | null {
  const partes = rel.split(path.sep)
  const top = norm(partes[0])
  if (/OBSOLET|FACTURA/.test(top)) return null // raíz «0. OBSOLETO» y facturas: mezcla, se ignoran
  const hit = CARPETAS.find(([rx]) => rx.test(top.replace(/^\s*\d+\s*[.\-_]?\s*/, '')) || rx.test(top))
  if (!hit) return null
  if (hit[1] !== 'POLIZA_RC') return hit[1]
  // Subcarpeta o nombre: «EXTRACONTRACTUAL», «RCE»/«REC» (también pegadas a `_`), o la
  // numeración heredada de la estructura: 5.1/8.1 contractual, 5.2/8.2 extracontractual.
  const resto = norm(partes.slice(1).join(' '))
  const sigla = (s: string) => new RegExp(`(?<![A-Z])${s}(?![A-Z])`)
  if (/EXTRA ?CONTRACTUAL/.test(resto) || sigla('RCE').test(resto) || sigla('REC').test(resto) || /(?<![\d.])[58]\.2(?!\d)/.test(resto)) return 'POLIZA_EXTRACONTRACTUAL'
  if (/CONTRACTUAL/.test(resto) || sigla('RCC').test(resto) || /(?<![\d.])[58]\.1(?!\d)/.test(resto)) return 'POLIZA_CONTRACTUAL'
  return 'POLIZA_RC_AMBIGUA'
}

/** Todas las fechas válidas del nombre; el vencimiento es la mayor. */
function fechasDelNombre(nombre: string): string[] {
  const out: string[] = []
  const add = (y: number, m: number, d: number) => {
    const dt = new Date(Date.UTC(y, m - 1, d))
    if (dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d && y >= 2015 && y <= 2035) {
      out.push(dt.toISOString().slice(0, 10))
    }
  }
  const sep = String.raw`\s*[-_.]\s*`
  for (const m of nombre.matchAll(new RegExp(String.raw`(?<!\d)(20\d{2})${sep}(\d{1,2})${sep}(\d{1,2})(?!\d)`, 'g'))) add(+m[1], +m[2], +m[3])
  for (const m of nombre.matchAll(new RegExp(String.raw`(?<!\d)(\d{1,2})${sep}(\d{1,2})${sep}(20\d{2})(?!\d)`, 'g'))) add(+m[3], +m[2], +m[1])
  return out
}

/** «vencimiento / hasta» en el texto del PDF; null si es un escaneo. */
function fechaDelPdf(ruta: string): string | null {
  const r = spawnSync('pdftotext', ['-l', '3', ruta, '-'], { encoding: 'utf8', timeout: 20_000 })
  const txt = r.stdout ?? ''
  if (txt.trim().length < 40) return null
  const U = norm(txt)
  const clave = U.search(/FECHA DE VENCIMIENTO|VENCIMIENTO|VIGENCIA HASTA|HASTA/)
  if (clave < 0) return null
  const tras = fechasDelNombre(txt.slice(clave, clave + 400))
  return tras.length ? tras.sort().at(-1)! : null
}

const sha256 = (buf: Buffer) => createHash('sha256').update(buf).digest('hex')
/** Nombre sin variantes de copia: `_opt`, `_compressed`, ` (1)`, `_001`. */
const nombreBase = (f: string) =>
  norm(path.parse(f).name).replace(/[_ ](OPT|COMPRESSED)$/,'').replace(/\s*\(\d+\)$/,'').replace(/[_ ]0\d{2}$/,'').trim()

// ── Recorrido del folder ───────────────────────────────────────────────────
interface Archivo {
  placa: string
  ruta: string
  rel: string
  categoria: string
  historico: boolean
  fecha: string | null
  fuente_fecha: 'nombre' | 'pdf' | null
  bytes: number
  ext: string
  mtime: number
}

const placasActivas = new Map<string, { carpeta: string; archivos: Archivo[] }>()
const desvinculadas = new Set<string>()

for (const grupo of GRUPOS) {
  const base = path.join(RAIZ, grupo)
  if (!fs.existsSync(base)) continue
  const pendientes = [base]
  while (pendientes.length) {
    const dir = pendientes.pop()!
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue
      const ruta = path.join(dir, e.name)
      const placa = placaDe(e.name)
      if (!placa) {
        pendientes.push(ruta)
        continue
      }
      const relCarpeta = path.relative(RAIZ, ruta)
      if (/_NO\b|OBSOLET/.test(norm(relCarpeta))) {
        desvinculadas.add(placa)
        continue
      }
      if (SOLO_PLACA && placa !== SOLO_PLACA) continue
      const reg = placasActivas.get(placa) ?? { carpeta: relCarpeta, archivos: [] }
      placasActivas.set(placa, reg)
      const cola = [ruta]
      while (cola.length) {
        const d = cola.pop()!
        for (const f of fs.readdirSync(d, { withFileTypes: true })) {
          const full = path.join(d, f.name)
          if (f.isDirectory()) { cola.push(full); continue }
          if (f.name.startsWith('.') || AJENOS.test(norm(f.name))) continue
          const ext = path.extname(f.name).toLowerCase()
          if (!['.pdf', '.png', '.jpg', '.jpeg', '.webp'].includes(ext)) continue
          const rel = path.relative(ruta, full)
          const categoria = categoriaDe(rel)
          if (!categoria) continue
          const st = fs.statSync(full)
          const fechas = fechasDelNombre(f.name)
          reg.archivos.push({
            placa, ruta: full, rel, categoria,
            historico: /OBSOLET/.test(norm(path.dirname(rel))),
            fecha: fechas.length ? fechas.sort().at(-1)! : null,
            fuente_fecha: fechas.length ? 'nombre' : null,
            bytes: st.size, ext, mtime: st.mtimeMs,
          })
        }
      }
    }
  }
}

// ── Plan ───────────────────────────────────────────────────────────────────
type Accion = 'subir_vigente' | 'subir_historial' | 'no_aplica' | 'omitir_ya_cargado' | 'omitir_duplicado' | 'omitir_viejo' | 'revisar'
interface Paso {
  placa: string
  categoria: string
  accion: Accion
  archivo: string
  fecha: string | null
  fuente_fecha: string | null
  bytes: number
  motivo?: string
  /// Varias imágenes que forman un solo documento.
  partes?: string[]
}

async function main() {
  const placas = [...placasActivas.keys()]
  const vehiculos = await prisma.vehiculos.findMany({
    where: { deleted_at: null },
    select: { id: true, placa: true },
  })
  const idPorPlaca = new Map(vehiculos.map((v) => [v.placa.toUpperCase().replace(/[^A-Z0-9]/g, ''), v.id]))

  const plan: Paso[] = []
  const sinBd = placas.filter((p) => !idPorPlaca.has(p))
  const sinArchivos = placas.filter((p) => idPorPlaca.has(p) && placasActivas.get(p)!.archivos.length === 0)

  for (const placa of placas) {
    const vid = idPorPlaca.get(placa)
    const reg = placasActivas.get(placa)!
    if (!vid || reg.archivos.length === 0) continue

    const existentes = await prisma.documento.findMany({
      where: { vehiculo_id: vid, deleted_at: null },
      select: { categoria: true, estado: true, fecha_vencimiento: true, fecha_vigencia: true, metadata: true, nombre_original: true },
    })
    const shas = new Set(existentes.map((e) => (e.metadata as any)?.sha256).filter(Boolean))
    const vencExist = (cat: string) =>
      existentes.filter((e) => e.categoria === cat).map((e) => vencimientoDe(e as any)).filter(Boolean) as string[]
    const nombresExist = (cat: string) =>
      new Set(existentes.filter((e) => e.categoria === cat).map((e) => nombreBase(String((e.metadata as any)?.originalPath ?? e.nombre_original).replace(/^.*\/\d+-[A-Z_]+-/, ''))))

    // Agrupar por categoría y, dentro, por documento (copias e imágenes sueltas).
    const porCat = new Map<string, Archivo[]>()
    for (const a of reg.archivos) {
      if (!porCat.has(a.categoria)) porCat.set(a.categoria, [])
      porCat.get(a.categoria)!.push(a)
    }

    for (const [cat, archivos] of porCat) {
      if (cat === 'POLIZA_RC_AMBIGUA') {
        for (const a of archivos) plan.push({ placa, categoria: cat, accion: 'revisar', archivo: a.rel, fecha: a.fecha, fuente_fecha: a.fuente_fecha, bytes: a.bytes, motivo: 'Póliza RC sin indicar si es contractual o extracontractual' })
        continue
      }
      const meta = CATEGORIA_POR_CLAVE.get(cat)!
      // Documentos = grupos por (histórico, nombre base). De cada grupo, el archivo más liviano (la copia optimizada).
      const grupos = new Map<string, Archivo[]>()
      for (const a of archivos) {
        const k = `${a.historico}|${nombreBase(path.basename(a.rel))}|${a.fecha}`
        if (!grupos.has(k)) grupos.set(k, [])
        grupos.get(k)!.push(a)
      }
      const docs: Array<{ a: Archivo; partes?: string[]; dup: Archivo[] }> = []
      for (const g of grupos.values()) {
        const imgs = g.filter((x) => x.ext !== '.pdf')
        if (imgs.length > 1 && imgs.length === g.length) {
          const orden = [...imgs].sort((x, y) => x.rel.localeCompare(y.rel))
          docs.push({ a: { ...orden[0], bytes: orden.reduce((s, x) => s + x.bytes, 0) }, partes: orden.map((x) => x.ruta), dup: [] })
        } else {
          const orden = [...g].sort((x, y) => (x.ext === '.pdf' ? 0 : 1) - (y.ext === '.pdf' ? 0 : 1) || x.bytes - y.bytes)
          docs.push({ a: orden[0], dup: orden.slice(1) })
        }
      }
      for (const d of docs) for (const x of d.dup) plan.push({ placa, categoria: cat, accion: 'omitir_duplicado', archivo: x.rel, fecha: x.fecha, fuente_fecha: x.fuente_fecha, bytes: x.bytes, motivo: `copia de ${path.basename(d.a.rel)}` })

      // Fecha del PDF para los vigentes sin fecha en el nombre.
      if (meta.vence) {
        for (const d of docs) {
          if (!d.a.fecha && !d.a.historico && d.a.ext === '.pdf') {
            const f = fechaDelPdf(d.a.ruta)
            if (f) { d.a.fecha = f; d.a.fuente_fecha = 'pdf' }
          }
        }
      }

      // Tecnomecánica de un vehículo nuevo: certificado RUNT o «NA» en lugar de la revisión.
      if (cat === 'TECNOMECANICA') {
        const actuales = docs.filter((d) => !d.a.historico)
        const conFecha = actuales.filter((d) => d.a.fecha)
        const soporteNa = actuales.find((d) => /RUNT|CONSULTA|\bNA\b|NO APLICA/.test(norm(path.basename(d.a.rel))))
        if (!conFecha.length && soporteNa) {
          plan.push({ placa, categoria: cat, accion: 'no_aplica', archivo: soporteNa.a.rel, fecha: null, fuente_fecha: null, bytes: soporteNa.a.bytes, motivo: 'Certificado RUNT en lugar de la revisión: aún no le aplica (confirmar)' })
          for (const d of actuales.filter((x) => x !== soporteNa)) plan.push({ placa, categoria: cat, accion: 'revisar', archivo: d.a.rel, fecha: null, fuente_fecha: null, bytes: d.a.bytes, motivo: 'Junto al soporte de «no aplica»' })
          continue
        }
      }

      if (meta.vence) {
        const existentesV = vencExist(cat)
        const maxExist = existentesV.sort().at(-1) ?? null
        const candidatos = docs.filter((d) => !(d.a.historico && SIN_HISTORIAL))
        // El vigente nuevo: el de vencimiento más lejano entre los actuales, si supera al de la base.
        const actualesConFecha = candidatos.filter((d) => !d.a.historico && d.a.fecha).sort((x, y) => (x.a.fecha! < y.a.fecha! ? 1 : -1))
        const nuevoVigente = actualesConFecha[0] && (!maxExist || actualesConFecha[0].a.fecha! > maxExist) ? actualesConFecha[0] : null
        const sinFechaMasReciente = candidatos.filter((d) => !d.a.historico && !d.a.fecha).sort((x, y) => y.a.mtime - x.a.mtime)[0]
        for (const d of candidatos) {
          const a = d.a
          const base = { placa, categoria: cat, archivo: a.rel, fecha: a.fecha, fuente_fecha: a.fuente_fecha, bytes: a.bytes, partes: d.partes }
          if (a.fecha && existentesV.includes(a.fecha)) { plan.push({ ...base, accion: 'omitir_ya_cargado' }); continue }
          if (!a.fecha) {
            if (a.historico) { plan.push({ ...base, accion: 'omitir_viejo', motivo: 'Historial sin fecha' }); continue }
            if (nombresExist(cat).has(nombreBase(path.basename(a.rel)))) { plan.push({ ...base, accion: 'omitir_ya_cargado', motivo: 'Mismo nombre ya cargado' }); continue }
            // Sin fecha y sin otro vigente con fecha: el más reciente sube como vigente «Sin fecha»
            // (se completa en la app); los demás, al historial.
            if (!actualesConFecha.length && !maxExist) {
              plan.push({ ...base, accion: d === sinFechaMasReciente ? 'subir_vigente' : 'subir_historial', motivo: 'Sin fecha: completar en la app' })
            } else plan.push({ ...base, accion: 'revisar', motivo: 'Sin fecha en el nombre ni en el PDF, y ya hay otro con fecha' })
            continue
          }
          if (a.fecha < HISTORIAL_DESDE) { plan.push({ ...base, accion: 'omitir_viejo', motivo: `Anterior a ${HISTORIAL_DESDE}` }); continue }
          plan.push({ ...base, accion: d === nuevoVigente ? 'subir_vigente' : 'subir_historial' })
        }
      } else {
        // Sin vencimiento: el más reciente de los actuales es el vigente si la categoría está vacía.
        const yaHay = existentes.some((e) => e.categoria === cat)
        const nombres = nombresExist(cat)
        const actuales = docs.filter((d) => !d.a.historico).sort((x, y) => y.a.mtime - x.a.mtime)
        actuales.forEach((d, i) => {
          const a = d.a
          const base = { placa, categoria: cat, archivo: a.rel, fecha: a.fecha, fuente_fecha: a.fuente_fecha, bytes: a.bytes, partes: d.partes }
          if (nombres.has(nombreBase(path.basename(a.rel)))) plan.push({ ...base, accion: 'omitir_ya_cargado' })
          else plan.push({ ...base, accion: !yaHay && i === 0 ? 'subir_vigente' : 'subir_historial' })
        })
        for (const d of docs.filter((x) => x.a.historico)) plan.push({ placa, categoria: cat, accion: 'omitir_viejo', archivo: d.a.rel, fecha: d.a.fecha, fuente_fecha: d.a.fuente_fecha, bytes: d.a.bytes, motivo: 'Obsoleto de un documento sin vencimiento' })
      }
    }
    // Idempotencia: lo ya subido por este importador (mismo sha256) no se repite.
    if (shas.size) {
      for (const p of plan.filter((x) => x.placa === placa && x.accion.startsWith('subir'))) {
        const buf = fs.readFileSync(path.join(RAIZ!, reg.carpeta, p.archivo))
        if (shas.has(sha256(buf))) { p.accion = 'omitir_ya_cargado'; p.motivo = 'Mismo archivo (sha256)' }
      }
    }
  }

  // Filas de 2025 con la fecha corrida un día.
  const aCorregir = await prisma.$queryRaw<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM documento
    WHERE deleted_at IS NULL AND fecha_vencimiento IS NULL
      AND metadata->>'fechaVigenciaOriginal' ~ '^\d{4}-\d{2}-\d{2}$'`

  // ── Reporte ──
  const cuenta = (acc: Accion) => plan.filter((p) => p.accion === acc)
  const mb = (ps: Paso[]) => (ps.reduce((s, p) => s + p.bytes, 0) / 1e6).toFixed(1)
  console.log(`\n${APLICAR ? '🟢 APLICANDO' : '🟡 SIMULACIÓN (no se escribe nada)'} · ${RAIZ}`)
  console.log(`Placas activas en el folder: ${placas.length} · desvinculadas ignoradas: ${desvinculadas.size}`)
  if (sinBd.length) console.log(`⚠️  No existen en la base (se ignoran): ${sinBd.join(', ')}`)
  if (sinArchivos.length) console.log(`·  Carpetas vacías: ${sinArchivos.join(', ')}`)
  for (const acc of ['subir_vigente', 'subir_historial', 'no_aplica', 'omitir_ya_cargado', 'omitir_duplicado', 'omitir_viejo', 'revisar'] as Accion[]) {
    const ps = cuenta(acc)
    console.log(`  ${acc.padEnd(18)} ${String(ps.length).padStart(4)} archivos  ${mb(ps).padStart(7)} MB`)
  }
  console.log(`  corregir_fecha_2025 ${String(aCorregir[0]?.n ?? 0).padStart(3)} filas (fecha_vencimiento ← fechaVigenciaOriginal)`)

  console.log('\nVigentes nuevos por placa:')
  const porPlaca = new Map<string, Paso[]>()
  for (const p of plan.filter((x) => x.accion === 'subir_vigente' || x.accion === 'no_aplica')) {
    if (!porPlaca.has(p.placa)) porPlaca.set(p.placa, [])
    porPlaca.get(p.placa)!.push(p)
  }
  for (const [placa, ps] of [...porPlaca].sort()) {
    console.log(`  ${placa}: ` + ps.map((p) => `${p.categoria}${p.accion === 'no_aplica' ? '=N/A' : p.fecha ? `→${p.fecha}${p.fuente_fecha === 'pdf' ? '(pdf)' : ''}` : '(sin fecha)'}`).join(' · '))
  }
  const conVence = (c: string) => CATEGORIA_POR_CLAVE.get(c)?.vence ?? true
  const revisar = plan.filter(
    (p) => p.accion === 'revisar' || p.accion === 'no_aplica' || (p.accion === 'subir_vigente' && conVence(p.categoria) && (!p.fecha || p.fuente_fecha === 'pdf')),
  )
  if (revisar.length) {
    console.log('\nPara confirmar a mano:')
    for (const p of revisar) console.log(`  ${p.placa} ${p.categoria.padEnd(24)} ${p.accion.padEnd(14)} ${p.fecha ?? '—'}  ${p.archivo}${p.motivo ? `  ← ${p.motivo}` : ''}`)
  }

  fs.writeFileSync(REPORTE, JSON.stringify({ raiz: RAIZ, aplicado: APLICAR, generado: new Date().toISOString(), sin_bd: sinBd, desvinculadas: [...desvinculadas], plan }, null, 1))
  console.log(`\nReporte completo: ${path.resolve(REPORTE)}`)

  if (!APLICAR) return
  await aplicar(plan, idPorPlaca)
}

// ── Escritura (solo con --aplicar) ─────────────────────────────────────────
function comprimirPdf(origen: string): Buffer {
  const original = fs.readFileSync(origen)
  const salida = path.join(os.tmpdir(), `docveh-${process.pid}-${Date.now()}.pdf`)
  const r = spawnSync('gs', ['-sDEVICE=pdfwrite', '-dCompatibilityLevel=1.5', '-dPDFSETTINGS=/ebook', '-dNOPAUSE', '-dQUIET', '-dBATCH', `-sOutputFile=${salida}`, origen], { timeout: 120_000 })
  try {
    if (r.status === 0 && fs.existsSync(salida)) {
      const comprimido = fs.readFileSync(salida)
      if (comprimido.length > 0 && comprimido.length <= original.length * 0.85) return comprimido
    }
  } finally {
    fs.rmSync(salida, { force: true })
  }
  return original
}

/** Une varias imágenes en un PDF (Pillow), en el orden recibido. */
function imagenesAPdf(rutas: string[]): Buffer {
  const salida = path.join(os.tmpdir(), `docveh-img-${process.pid}-${Date.now()}.pdf`)
  const py = 'import sys\nfrom PIL import Image\nims=[Image.open(p).convert("RGB") for p in sys.argv[2:]]\nims[0].save(sys.argv[1], save_all=True, append_images=ims[1:], resolution=150)'
  const r = spawnSync('python3', ['-I', '-c', py, salida, ...rutas], { timeout: 120_000 })
  if (r.status !== 0) throw new Error(`No se pudieron unir las imágenes: ${r.stderr}`)
  const buf = fs.readFileSync(salida)
  fs.rmSync(salida, { force: true })
  return buf
}

const MIME: Record<string, string> = { '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }

async function aplicar(plan: Paso[], idPorPlaca: Map<string, string>) {
  // 1) Fechas corridas de 2025.
  const corr = await prisma.$executeRaw`
    UPDATE documento SET fecha_vencimiento = (metadata->>'fechaVigenciaOriginal')::date, updated_at = now()
    WHERE deleted_at IS NULL AND fecha_vencimiento IS NULL
      AND metadata->>'fechaVigenciaOriginal' ~ '^\d{4}-\d{2}-\d{2}$'`
  console.log(`\nFechas de 2025 corregidas: ${corr}`)

  // 2) Archivos: historial primero (no toca el vigente), luego vigentes y «no aplica».
  const orden: Accion[] = ['subir_historial', 'subir_vigente', 'no_aplica']
  const pasos = plan.filter((p) => orden.includes(p.accion)).sort((a, b) => orden.indexOf(a.accion) - orden.indexOf(b.accion) || String(a.fecha).localeCompare(String(b.fecha)))
  let ok = 0
  let bytesOrig = 0
  let bytesFinal = 0
  for (const p of pasos) {
    const reg = placasActivas.get(p.placa)!
    const ruta = path.join(RAIZ!, reg.carpeta, p.archivo)
    try {
      const original = p.partes ? Buffer.concat(p.partes.map((x) => fs.readFileSync(x))) : fs.readFileSync(ruta)
      let buffer: Buffer
      let ext = path.extname(ruta).toLowerCase()
      if (p.partes) { buffer = imagenesAPdf(p.partes); ext = '.pdf' }
      else buffer = ext === '.pdf' ? comprimirPdf(ruta) : original
      bytesOrig += original.length
      bytesFinal += buffer.length
      await VehiculosDocumentosService.subir({
        vehiculoId: idPorPlaca.get(p.placa)!,
        categoria: p.categoria,
        archivo: { buffer, nombre: path.basename(ruta).replace(/\.[^.]+$/, ext), mimetype: MIME[ext] ?? 'application/pdf' },
        fecha_vencimiento: p.fecha,
        no_aplica: p.accion === 'no_aplica',
        comoHistorial: p.accion === 'subir_historial',
        origen: 'onedrive_2026',
        metadata: { sha256: sha256(fs.readFileSync(ruta)), ruta_origen: path.join(reg.carpeta, p.archivo), fuente_fecha: p.fuente_fecha, bytes_original: original.length },
      })
      ok++
      if (ok % 25 === 0) console.log(`  … ${ok}/${pasos.length}`)
    } catch (e: any) {
      console.error(`  ✘ ${p.placa} ${p.categoria} ${p.archivo}: ${e?.message}`)
    }
  }
  console.log(`✅ Subidos ${ok}/${pasos.length} · ${(bytesOrig / 1e6).toFixed(0)} MB → ${(bytesFinal / 1e6).toFixed(0)} MB`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
