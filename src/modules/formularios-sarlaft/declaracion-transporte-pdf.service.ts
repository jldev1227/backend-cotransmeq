/**
 * Generador del PDF de la Declaración SARLAFT/PTEE para empresa de transporte
 * — formato GC-FOR-13 de COTRANSMEQ S.A.S.
 *
 * A diferencia de `pdf-generator-sarlaft-html.service.ts`, que RECREA un
 * documento a partir de las respuestas, aquí se abre el formato controlado de
 * la marca y se escribe encima. Motivos:
 *
 *  - el texto legal, el logo y la maqueta son documento controlado y no se
 *    pueden reproducir "parecido";
 *  - el declarante debe recibir el mismo formato que aceptó;
 *  - no se rasteriza la página: se conserva el texto original vectorial, con
 *    su capa de texto seleccionable e imprimible.
 *
 * El generador es deliberadamente estricto: si un valor no cabe de forma
 * legible en su celda, falla en vez de producir un documento ilegible.
 */
import { PDFDocument, PDFFont, PDFName, PDFPage, PDFRef, StandardFonts, rgb } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import {
  TEMPLATE_DECLARACION_TRANSPORTE,
  assertTemplateEmitible,
  leerTemplateVerificado,
  type TemplateManifest
} from './declaracion-transporte-template.manifest'
import {
  COORDENADAS,
  SUBRAYADO,
  type CampoTexto,
  type CampoCasilla
} from './declaracion-transporte-pdf.coordinates'
import {
  CAMPOS,
  OPCION_CON_ALERTAS,
  OPCION_SIN_ALERTAS,
  marcaResultadoDeEstado,
  type MarcaResultado,
  type Respuestas
} from './declaracion-transporte.validacion'

const NEGRO = rgb(0.05, 0.05, 0.05)

/** Estado documental de la versión que se está emitiendo. */
export type EstadoDocumental = 'recibida' | 'evaluada'

export interface DatosDeclaracionPDF {
  radicado: string
  /** Snapshot de respuestas ya validado y limpio. */
  respuestas: Respuestas
  /** `recibida` no marca resultado; `evaluada` marca exactamente una casilla. */
  estado_documental: EstadoDocumental
  /** Estado administrativo del formulario. Solo se usa si `evaluada`. */
  estado_administrativo?: string | null
  /** Número secuencial de la versión documental que se está emitiendo. */
  version_documento: number
  fecha_generacion?: Date
}

export interface ResultadoDeclaracionPDF {
  buffer: Buffer
  sha256: string
  nombre_archivo: string
  /** Manifiesto del template usado, para dejarlo en la trazabilidad. */
  template: TemplateManifest
  marca_resultado: MarcaResultado
}

// ──────────────────────────────────────────────────────────
// Utilidades de texto — puras y testeables
// ──────────────────────────────────────────────────────────

/**
 * Deja el texto en condiciones de dibujarse: sin caracteres de control, sin
 * saltos de línea y con espacios colapsados.
 *
 * Los saltos de línea se colapsan porque cada campo del formato es una raya de
 * una sola línea; dejarlos pasar rompería el `drawText` de pdf-lib.
 */
export function sanearTexto(valor: unknown): string {
  if (valor == null) return ''
  const s = typeof valor === 'string' ? valor : String(valor)
  return s
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Busca el mayor tamaño de fuente, entre `size` y `minSize`, con el que el
 * texto cabe en `maxWidth`. Devuelve `null` si no cabe ni en el mínimo: el
 * llamador debe fallar, no truncar.
 */
export function ajustarTamano(
  texto: string,
  font: PDFFont,
  campo: Pick<CampoTexto, 'maxWidth' | 'size' | 'minSize'>
): number | null {
  if (!texto) return campo.size
  for (let size = campo.size; size >= campo.minSize - 1e-9; size -= 0.25) {
    if (font.widthOfTextAtSize(texto, size) <= campo.maxWidth) return size
  }
  return null
}

/**
 * Reparte un texto largo entre varias rayas de ancho fijo, cortando por
 * palabras. Devuelve `null` si no cabe en las rayas disponibles.
 */
export function repartirEnLineas(
  texto: string,
  font: PDFFont,
  campos: CampoTexto[]
): Array<{ campo: CampoTexto; texto: string; size: number }> | null {
  if (!texto) return []
  const palabras = texto.split(' ').filter(Boolean)
  const salida: Array<{ campo: CampoTexto; texto: string; size: number }> = []
  let i = 0

  for (const campo of campos) {
    if (i >= palabras.length) break
    // Se usa el tamaño mínimo para decidir el corte: así el reparto no depende
    // de cuánto se acabe reduciendo cada raya por separado.
    let linea = ''
    while (i < palabras.length) {
      const tentativa = linea ? `${linea} ${palabras[i]}` : palabras[i]
      if (font.widthOfTextAtSize(tentativa, campo.minSize) > campo.maxWidth) break
      linea = tentativa
      i++
    }
    if (!linea) return null // ni una palabra cabe: el valor es impublicable
    const size = ajustarTamano(linea, font, campo)
    if (size == null) return null
    salida.push({ campo, texto: linea, size })
  }

  return i >= palabras.length ? salida : null
}

/** Formatea una fecha ISO (`YYYY-MM-DD`) o `Date` como `DD/MM/AAAA`. */
export function formatearFecha(valor: unknown): string {
  const s = sanearTexto(valor)
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) {
    const d = String(valor.getUTCDate()).padStart(2, '0')
    const m = String(valor.getUTCMonth() + 1).padStart(2, '0')
    return `${d}/${m}/${valor.getUTCFullYear()}`
  }
  return s
}

/** Escala una imagen para que quepa en la caja preservando su proporción. */
export function encajarProporcional(
  natural: { width: number; height: number },
  caja: { width: number; height: number }
): { width: number; height: number } {
  const escala = Math.min(caja.width / natural.width, caja.height / natural.height, 1)
  return { width: natural.width * escala, height: natural.height * escala }
}

// ──────────────────────────────────────────────────────────
// Fuente
// ──────────────────────────────────────────────────────────

/** Roboto (Apache-2.0) cubre tildes, Ñ, ¿ y ¡; las fuentes estándar de PDF
 *  solo llegan hasta WinAnsi y no se pueden subsetear. */
function rutaFuente(archivo: string): string {
  return resolve(__dirname, '../../assets/fonts', archivo)
}

// ──────────────────────────────────────────────────────────
// Dibujo
// ──────────────────────────────────────────────────────────

function dibujarCampo(
  page: PDFPage,
  font: PDFFont,
  campo: CampoTexto,
  valor: string,
  etiqueta: string
): void {
  const texto = sanearTexto(valor)
  if (!texto) return
  const size = ajustarTamano(texto, font, campo)
  if (size == null) {
    throw Object.assign(
      new Error(
        `El valor de "${etiqueta}" no cabe de forma legible en el formato ` +
          `(${texto.length} caracteres para ${campo.maxWidth} pt). Acórtalo antes de enviar.`
      ),
      { statusCode: 422 }
    )
  }
  page.drawText(texto, { x: campo.x, y: campo.y, size, font, color: NEGRO })
  extenderSubrayado(page, font, campo, texto, size)
}

/**
 * Continúa la raya del template cuando el valor la desborda.
 *
 * Las rayas vienen impresas con un ancho fijo pensado para escribir a mano, y
 * varias se quedan cortas para un dato real — la de la sección 2 mide 94 pt y
 * una razón social típica pasa de 130 pt. Sin esto el valor quedaría con media
 * línea debajo y el resto al aire, que es justo lo que se ve como defecto de
 * diligenciamiento.
 *
 * Solo se DIBUJA lo que falta, desde donde termina la raya impresa: así el
 * empalme es continuo y no se superpone tinta sobre la línea original.
 */
function extenderSubrayado(
  page: PDFPage,
  font: PDFFont,
  campo: CampoTexto,
  texto: string,
  size: number
): void {
  if (!texto) return
  const tramo = calcularExtensionSubrayado(campo, font.widthOfTextAtSize(texto, size))
  if (!tramo) return
  page.drawLine({
    start: { x: tramo.desde, y: tramo.y },
    end: { x: tramo.hasta, y: tramo.y },
    thickness: SUBRAYADO.grosor,
    color: NEGRO
  })
}

/**
 * Decide qué tramo de raya falta dibujar, o `null` si la raya impresa ya cubre
 * el valor. Se expone aparte del dibujo para poder probar la regla sin tener
 * que leer bytes de un content stream comprimido.
 */
export function calcularExtensionSubrayado(
  campo: CampoTexto,
  anchoTexto: number
): { desde: number; hasta: number; y: number } | null {
  if (campo.subrayadoHasta == null) return null
  const finTexto = campo.x + anchoTexto
  if (finTexto <= campo.subrayadoHasta) return null
  return {
    desde: campo.subrayadoHasta,
    hasta: finTexto,
    y: campo.y - SUBRAYADO.offset
  }
}

/** Dibuja una "X" centrada en la casilla ☐ del template. */
function marcarCasilla(page: PDFPage, font: PDFFont, casilla: CampoCasilla): void {
  const ancho = font.widthOfTextAtSize('X', casilla.size)
  // La altura visual de una mayúscula es ~0.72 em en Roboto; centrarla sobre
  // `cy` es lo que hace que la X quede dentro del cuadro y no encima.
  const alto = casilla.size * 0.72
  page.drawText('X', {
    x: casilla.cx - ancho / 2,
    y: casilla.cy - alto / 2,
    size: casilla.size,
    font,
    color: NEGRO
  })
}

// ──────────────────────────────────────────────────────────
// Servicio
// ──────────────────────────────────────────────────────────

export const DeclaracionTransportePdfService = {
  manifest: TEMPLATE_DECLARACION_TRANSPORTE,

  /**
   * Produce el PDF diligenciado sobre el template controlado de la marca.
   * Devuelve el binario y su SHA-256 — es exactamente el que debe persistirse
   * y entregarse, no uno regenerado después.
   */
  async generar(datos: DatosDeclaracionPDF): Promise<ResultadoDeclaracionPDF> {
    const manifest = TEMPLATE_DECLARACION_TRANSPORTE
    assertTemplateEmitible(manifest)

    const plantilla = leerTemplateVerificado(manifest)
    const pdf = await PDFDocument.load(plantilla)

    if (pdf.getPageCount() !== 1) {
      throw new Error(
        `[DeclaracionTransporte] El template ${manifest.codigo} debe tener exactamente una página, tiene ${pdf.getPageCount()}.`
      )
    }
    const page = pdf.getPage(0)
    const { width, height } = page.getSize()
    if (Math.round(width) !== manifest.page.width || Math.round(height) !== manifest.page.height) {
      throw new Error(
        `[DeclaracionTransporte] El template ${manifest.codigo} no es tamaño carta ` +
          `(${Math.round(width)}x${Math.round(height)} pt en vez de ${manifest.page.width}x${manifest.page.height}).`
      )
    }

    pdf.registerFontkit(fontkit)
    let font: PDFFont
    let fontBold: PDFFont
    try {
      font = await pdf.embedFont(readFileSync(rutaFuente('Roboto-Regular.ttf')), { subset: true })
      fontBold = await pdf.embedFont(readFileSync(rutaFuente('Roboto-Bold.ttf')), { subset: true })
    } catch {
      // Sin la fuente incrustada se perderían tildes y Ñ; se cae a Helvetica
      // (WinAnsi) que sí las cubre, pero se deja constancia en el log.
      console.warn(
        '[DeclaracionTransporte] No se pudo incrustar Roboto; se usa Helvetica (WinAnsi).'
      )
      font = await pdf.embedFont(StandardFonts.Helvetica)
      fontBold = await pdf.embedFont(StandardFonts.HelveticaBold)
    }

    const r = datos.respuestas

    // ── Encabezado ───────────────────────────────────────────────────────
    dibujarCampo(page, font, COORDENADAS.razon_social, String(r[CAMPOS.RAZON_SOCIAL] ?? ''), 'Razón social del proveedor')
    dibujarCampo(page, font, COORDENADAS.nit, String(r[CAMPOS.NIT] ?? ''), 'NIT')

    // ── Sección 1 — datos de quien declara ───────────────────────────────
    dibujarCampo(page, font, COORDENADAS.representante_legal, String(r[CAMPOS.REPRESENTANTE] ?? ''), 'Representante legal')
    dibujarCampo(page, font, COORDENADAS.cedula_representante, String(r[CAMPOS.CEDULA] ?? ''), 'Cédula del representante')
    const telefonoCorreo = [sanearTexto(r[CAMPOS.TELEFONO]), sanearTexto(r[CAMPOS.CORREO])]
      .filter(Boolean)
      .join(' / ')
    dibujarCampo(page, font, COORDENADAS.telefono_correo, telefonoCorreo, 'Teléfono / correo')

    // ── Sección 2 — la razón social se repite en la frase de declaración ──
    dibujarCampo(page, font, COORDENADAS.empresa_declaracion, String(r[CAMPOS.RAZON_SOCIAL] ?? ''), 'Razón social (sección 2)')

    // ── Sección 3 — confirmación rápida ──────────────────────────────────
    if (sanearTexto(r[CAMPOS.CNF_VEHICULOS]) === 'Sí') {
      marcarCasilla(page, fontBold, COORDENADAS.confirmaciones.vehiculos_revisados)
    }
    const alertas = sanearTexto(r[CAMPOS.CNF_ALERTAS])
    // Excluyentes por construcción: nunca se marcan las dos.
    if (alertas === OPCION_SIN_ALERTAS) {
      marcarCasilla(page, fontBold, COORDENADAS.confirmaciones.sin_alertas)
    } else if (alertas === OPCION_CON_ALERTAS) {
      marcarCasilla(page, fontBold, COORDENADAS.confirmaciones.con_alertas_anexo)
    }
    if (sanearTexto(r[CAMPOS.CNF_SOPORTES]) === 'Sí') {
      marcarCasilla(page, fontBold, COORDENADAS.confirmaciones.soportes_vigentes)
    }

    // ── Sección 4 — alertas u observaciones ──────────────────────────────
    const observaciones = sanearTexto(r[CAMPOS.OBSERVACIONES])
    if (observaciones) {
      const lineas = repartirEnLineas(observaciones, font, COORDENADAS.observaciones)
      if (!lineas) {
        throw Object.assign(
          new Error(
            'Las alertas u observaciones no caben en las dos líneas del formato. ' +
              'Resume el texto o adjúntalo como documento anexo.'
          ),
          { statusCode: 422 }
        )
      }
      for (const l of lineas) {
        page.drawText(l.texto, { x: l.campo.x, y: l.campo.y, size: l.size, font, color: NEGRO })
        extenderSubrayado(page, font, l.campo, l.texto, l.size)
      }
    }

    // ── Sección 5 — firma y validación ───────────────────────────────────
    dibujarCampo(page, font, COORDENADAS.firma_nombre, String(r[CAMPOS.REPRESENTANTE] ?? ''), 'Nombre del representante legal')
    dibujarCampo(page, font, COORDENADAS.firma_documento, String(r[CAMPOS.CEDULA] ?? ''), 'Número de documento de identidad')

    await incrustarFirma(pdf, page, String(r[CAMPOS.FIRMA] ?? ''))

    dibujarCampo(page, font, COORDENADAS.fecha, formatearFecha(r[CAMPOS.FECHA]), 'Fecha')

    // ── Resultado ────────────────────────────────────────────────────────
    // En la versión recibida NUNCA se marca: el resultado es una decisión
    // interna que en ese momento todavía no existe.
    const marca: MarcaResultado =
      datos.estado_documental === 'evaluada'
        ? marcaResultadoDeEstado(datos.estado_administrativo)
        : null
    if (marca === 'aprobado') marcarCasilla(page, fontBold, COORDENADAS.resultado.aprobado)
    else if (marca === 'condicionado') marcarCasilla(page, fontBold, COORDENADAS.resultado.condicionado)
    else if (marca === 'no_aprobado') marcarCasilla(page, fontBold, COORDENADAS.resultado.no_aprobado)

    // ── Metadatos ────────────────────────────────────────────────────────
    // Se fijan explícitamente TODOS: el archivo de Word original trae autor y
    // productor propios, y dejarlos pasar metería datos ajenos en el documento
    // que se entrega al declarante.
    const generado = datos.fecha_generacion ?? new Date()
    pdf.setTitle(`${manifest.codigo} v${manifest.version_template} — Radicado ${datos.radicado}`)
    pdf.setAuthor(manifest.empresa)
    pdf.setProducer(`${manifest.empresa} — Sistema de cumplimiento SARLAFT + PTEE`)
    pdf.setCreator(`${manifest.empresa} — Sistema de cumplimiento SARLAFT + PTEE`)
    pdf.setSubject(
      `Declaración SARLAFT y PTEE para empresa de transporte · ${manifest.codigo} v${manifest.version_template} · ` +
        `Radicado ${datos.radicado} · Versión documental ${datos.version_documento} (${datos.estado_documental})`
    )
    pdf.setKeywords([
      'SARLAFT',
      'PTEE',
      manifest.codigo,
      datos.radicado,
      datos.estado_documental,
      `v${datos.version_documento}`
    ])
    pdf.setCreationDate(generado)
    pdf.setModificationDate(generado)

    eliminarXmpHeredado(pdf)

    const bytes = await pdf.save({ useObjectStreams: false })
    const buffer = Buffer.from(bytes)
    const sha256 = createHash('sha256').update(buffer).digest('hex')

    return {
      buffer,
      sha256,
      nombre_archivo: nombreArchivo(manifest.codigo, datos),
      template: manifest,
      marca_resultado: marca
    }
  }
}

/** Nombre estable y legible del archivo entregado. */
export function nombreArchivo(codigo: string, datos: DatosDeclaracionPDF): string {
  const radicado = datos.radicado.replace(/[^A-Za-z0-9_-]/g, '_')
  return `${codigo}_${radicado}_v${datos.version_documento}.pdf`
}

/**
 * Elimina el flujo XMP heredado del archivo de Word original.
 *
 * Además del diccionario `Info`, el template arrastra un `/Metadata` con
 * `dc:creator`, que `setAuthor()` no toca. Sin quitarlo, el documento
 * entregado al declarante seguiría declarando un autor ajeno: en un template
 * es el nombre de una persona y en el otro, literalmente, el de la otra marca.
 *
 * No basta con borrar la referencia del catálogo: el objeto seguiría
 * serializándose en el archivo aunque nadie lo apunte. Hay que borrar también
 * el objeto indirecto del contexto.
 *
 * XMP es opcional en PDF y los metadatos que importan ya viajan en `Info`.
 */
function eliminarXmpHeredado(pdf: PDFDocument): void {
  const clave = PDFName.of('Metadata')
  const ref = pdf.catalog.get(clave)
  pdf.catalog.delete(clave)
  if (ref instanceof PDFRef) {
    pdf.context.delete(ref)
  }
}

/**
 * Incrusta la firma manuscrita dentro de la celda, preservando proporción.
 *
 * La firma llega como data URL del canvas. Nunca se dibuja como texto: un
 * `data:image/...` impreso en el PDF sería a la vez ilegible y una fuga.
 */
async function incrustarFirma(pdf: PDFDocument, page: PDFPage, dataUrl: string): Promise<void> {
  const m = /^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUrl ?? '')
  if (!m) {
    throw Object.assign(
      new Error('La firma del representante legal no es una imagen PNG o JPG válida.'),
      { statusCode: 422 }
    )
  }
  const bytes = Buffer.from(m[2].replace(/\s/g, ''), 'base64')
  const imagen =
    m[1].toLowerCase() === 'png' ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes)

  const caja = COORDENADAS.firma_imagen
  const { width, height } = encajarProporcional(
    { width: imagen.width, height: imagen.height },
    caja
  )
  page.drawImage(imagen, {
    // Centrada en la celda: una firma apaisada y una alta quedan igual de
    // contenidas sin tocar los bordes de la tabla.
    x: caja.x + (caja.width - width) / 2,
    y: caja.y + (caja.height - height) / 2,
    width,
    height
  })
}
