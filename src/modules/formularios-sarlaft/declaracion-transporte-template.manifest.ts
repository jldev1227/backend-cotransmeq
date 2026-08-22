/**
 * Manifiesto del formato controlado GC-FOR-13 de COTRANSMEQ S.A.S.
 *
 * El PDF fuente es un documento controlado: el generador NO lo recrea, escribe
 * encima. Por eso el asset se congela en `src/assets/pdf-templates/` con su
 * SHA-256 registrado aquí, y el servicio se niega a dibujar sobre un archivo
 * cuyo hash no coincida. Sin esa verificación bastaría con reemplazar el PDF
 * en disco para cambiar el texto legal que firma el declarante.
 *
 * Rotar el template = copiar el nuevo PDF con un nombre versionado, actualizar
 * `archivo`, `sha256`, `version_template` y `estado_aprobacion`, y dejar el
 * anterior en el repositorio: los documentos ya emitidos siguen refiriéndose a
 * su hash.
 */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

/** Estado de control documental del asset.
 *
 *  - `aprobado`             → el responsable documental validó la maqueta y el
 *                             archivo puede emitirse a un tercero.
 *  - `pendiente_aprobacion` → hay una observación abierta sobre la maqueta. Se
 *                             puede generar en dev/QA para poder revisarlo,
 *                             pero `NODE_ENV=production` lo rechaza. */
export type EstadoAprobacionTemplate = 'aprobado' | 'pendiente_aprobacion'

export interface TemplateManifest {
  /** Marca dueña del formato. Nunca se comparte entre empresas. */
  marca: 'cotransmeq'
  empresa: string
  /** Código documental visible en el formato. Es `FOR`, no `FR`: así aparece
   *  impreso y no se homogeneiza con el resto de formatos del sistema. */
  codigo: string
  /** Versión documental visible en el formato. */
  version_template: string
  /** Fecha impresa en el formato. Este formato no la trae en el encabezado. */
  fecha_documento: string | null
  /** Nombre del archivo dentro de `src/assets/pdf-templates/declaracion-empresa-transporte/`. */
  archivo: string
  /** SHA-256 esperado del asset. */
  sha256: string
  /** Tamaño de página esperado, en puntos. */
  page: { width: number; height: number }
  estado_aprobacion: EstadoAprobacionTemplate
  /** Observación de control documental abierta, si la hay. */
  observacion?: string
}

export const TEMPLATE_DECLARACION_TRANSPORTE: TemplateManifest = {
  marca: 'cotransmeq',
  empresa: 'COTRANSMEQ S.A.S.',
  codigo: 'GC-FOR-13',
  version_template: '01',
  fecha_documento: null,
  archivo: 'GC-FOR-13-v01.pdf',
  sha256: '01797d062fb3ba793207eb9ed45e0dfc00a1a59a9970c5f9c1f62a94e39598ec',
  page: { width: 612, height: 792 },
  // La auditoría documental encontró la maqueta completa y utilizable: logo,
  // marca de agua, paleta naranja/verde/azul y ondas del pie salen enteras.
  // Quedan dos observaciones de redacción que NO se corrigen desde el código
  // (ver `observacion`): cambiarlas alteraría el texto controlado.
  estado_aprobacion: 'aprobado',
  observacion:
    'Observaciones de redacción abiertas y no corregidas a propósito: el código usa ' +
    '"FOR" donde otros formatos usan "FR", y el compromiso contiene la palabra inglesa ' +
    '"situation". Ambas requieren autorización documental para tocarse.'
}

/** Carpeta del asset. En build, `npm run build` copia `src/assets` a `dist/assets`,
 *  así que `__dirname` apunta a `dist/modules/...` y hay que subir dos niveles. */
function templatesDir(): string {
  return resolve(__dirname, '../../assets/pdf-templates/declaracion-empresa-transporte')
}

export function rutaTemplate(manifest: TemplateManifest = TEMPLATE_DECLARACION_TRANSPORTE): string {
  return resolve(templatesDir(), manifest.archivo)
}

/**
 * Lee el asset y verifica su SHA-256 contra el manifiesto.
 * Falla en vez de dibujar sobre un archivo desconocido.
 */
export function leerTemplateVerificado(
  manifest: TemplateManifest = TEMPLATE_DECLARACION_TRANSPORTE
): Buffer {
  const ruta = rutaTemplate(manifest)
  let bytes: Buffer
  try {
    bytes = readFileSync(ruta)
  } catch {
    throw new Error(
      `[DeclaracionTransporte] No se encontró el template ${manifest.codigo} en ${ruta}. ` +
        'Verifica que el build haya copiado src/assets a dist/assets.'
    )
  }
  const hash = createHash('sha256').update(bytes).digest('hex')
  if (hash !== manifest.sha256) {
    throw new Error(
      `[DeclaracionTransporte] El template ${manifest.codigo} no coincide con el hash registrado. ` +
        `Esperado ${manifest.sha256}, encontrado ${hash}. No se genera el documento sobre un asset desconocido.`
    )
  }
  return bytes
}

/**
 * Impide que un template sin aprobación documental se emita en producción.
 * En dev/QA se permite para poder revisarlo visualmente y cerrar la decisión.
 */
export function assertTemplateEmitible(
  manifest: TemplateManifest = TEMPLATE_DECLARACION_TRANSPORTE,
  nodeEnv: string | undefined = process.env.NODE_ENV
): void {
  if (manifest.estado_aprobacion === 'aprobado') return
  if (nodeEnv === 'production') {
    throw Object.assign(
      new Error(
        `El formato ${manifest.codigo} v${manifest.version_template} está marcado como ` +
          `"${manifest.estado_aprobacion}" en el control documental y no puede emitirse en producción. ` +
          (manifest.observacion ?? '')
      ),
      { statusCode: 503 }
    )
  }
}
