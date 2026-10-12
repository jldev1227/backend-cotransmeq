/**
 * PDF del extracto de contrato (FUEC) generado en el servidor, para la app
 * del conductor.
 *
 * El dashboard arma este mismo PDF en el navegador. La app no puede hacerlo:
 * no tiene pdfmake, ni las imágenes del formato, ni (sin señal) a dónde ir a
 * buscarlas. Así que aquí se genera con la MISMA maquetación —`pdfExtractoDoc.ts`
 * es espejo exacto del archivo del front y su spec falla si divergen— y solo
 * cambia cómo se consiguen las piezas que dependen del entorno:
 *
 *   · imágenes → PNG del disco (`src/assets/fuec/`), los mismos archivos que
 *     el front sirve en `/assets/…` (el logo en webp se pasó a PNG: pdfmake
 *     no lee webp, y el front lo convierte con un canvas al vuelo);
 *   · QR       → la misma librería (`qrcode`) con las mismas opciones, así que
 *     el dibujo es idéntico módulo a módulo;
 *   · fuentes  → las Roboto que trae el paquete de pdfmake, las mismas del
 *     `vfs_fonts` del navegador.
 */
import fs from 'fs'
import path from 'path'
import QRCode from 'qrcode'
import type * as PdfMake from 'pdfmake'
import type { TDocumentDefinitions, TFontDictionary } from 'pdfmake/interfaces'

import {
  OPCIONES_QR_EXTRACTO,
  docExtracto,
  type ImagenesDocExtracto,
  type OpcionesDocExtracto,
  type SnapshotDocExtracto
} from './pdfExtractoDoc'

/// `require` y no `import * as`: el paquete exporta una INSTANCIA, y el
/// namespace que arma `esModuleInterop` copia sus métodos como getters
/// sueltos; llamados desde ahí, `this` deja de ser la instancia y
/// `setUrlAccessPolicy` revienta («has only a getter»).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfmake: typeof PdfMake = require('pdfmake')

const CARPETA_FUENTES = path.join(path.dirname(require.resolve('pdfmake/package.json')), 'build', 'fonts', 'Roboto')
/// La misma correspondencia que el `vfs_fonts` del navegador: «negrita» es Medium.
const FUENTES: TFontDictionary = {
  Roboto: {
    normal: path.join(CARPETA_FUENTES, 'Roboto-Regular.ttf'),
    bold: path.join(CARPETA_FUENTES, 'Roboto-Medium.ttf'),
    italics: path.join(CARPETA_FUENTES, 'Roboto-Italic.ttf'),
    bolditalics: path.join(CARPETA_FUENTES, 'Roboto-MediumItalic.ttf')
  }
}
const RUTAS_FUENTES = new Set(Object.values(FUENTES.Roboto))

/// `src/assets` se copia a `dist/assets` al compilar: la ruta relativa vale en
/// desarrollo (tsx) y en producción (node dist).
const CARPETA_IMAGENES = path.join(__dirname, '..', '..', 'assets', 'fuec')

let imagenesFijas: Promise<Omit<ImagenesDocExtracto, 'qr'>> | null = null

function dataUrlPng(nombre: string): Promise<string | null> {
  return fs.promises
    .readFile(path.join(CARPETA_IMAGENES, nombre))
    .then((b) => `data:image/png;base64,${b.toString('base64')}`)
    /// Sin una imagen el extracto sale igual (con el texto de respaldo que
    /// pone la maquetación), como en el front cuando falla una descarga.
    .catch(() => null)
}

/** Logo, firma y sellos: no cambian entre extractos, se leen una vez por proceso. */
function cargarImagenesFijas() {
  if (!imagenesFijas) {
    imagenesFijas = Promise.all([
      dataUrlPng('logo.png'),
      dataUrlPng('firma.png'),
      dataUrlPng('mintransporte.png'),
      dataUrlPng('supertransporte.png')
    ]).then(([logo, firma, mintransporte, supertransporte]) => ({ logo, firma, mintransporte, supertransporte }))
  }
  return imagenesFijas
}

/** El QR como data URL, idéntico al que dibuja el dashboard para la misma URL. */
export function qrExtracto(urlPublica: string): Promise<string> {
  return QRCode.toDataURL(urlPublica, { ...OPCIONES_QR_EXTRACTO })
}

export async function generarPdfExtracto(snapshot: SnapshotDocExtracto, opciones: OpcionesDocExtracto): Promise<Buffer> {
  const [fijas, qr] = await Promise.all([
    cargarImagenesFijas(),
    opciones.codigo_verificacion && opciones.url_publica ? qrExtracto(opciones.url_publica) : Promise.resolve(null)
  ])
  const doc = docExtracto(snapshot, opciones, { ...fijas, qr })

  /// `pdfmake` en Node es una instancia única para todo el proceso: se fijan
  /// fuentes y políticas justo antes de crear, en el mismo tick, para no
  /// depender de lo que otro módulo haya dejado configurado. Todo entra como
  /// data URL, así que no se le permite descargar nada ni leer más disco que
  /// las cuatro fuentes.
  pdfmake.setFonts(FUENTES)
  pdfmake.setUrlAccessPolicy(() => false)
  pdfmake.setLocalAccessPolicy((ruta) => RUTAS_FUENTES.has(ruta))
  return pdfmake.createPdf(doc as unknown as TDocumentDefinitions).getBuffer()
}
