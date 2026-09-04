/**
 * Logotipo de Cotransmeq para los documentos que genera el backend.
 *
 * Este repo arrastra del original tres archivos con nombre parecido y solo
 * dos son de la marca correcta:
 *
 *   - `cotransmeq-logo.png`   → Cotransmeq (177x113). El bueno para pdfkit.
 *   - `logo_cotransmeq-264.webp` → Cotransmeq, mismo arte en webp.
 *   - `logo.png` / `transmeralda-logo.png` → TRANSMERALDA. No usarlos.
 *
 * pdfkit solo lee PNG y JPEG, así que el `.webp` no sirve para los
 * generadores; de ahí que el PNG sea el candidato principal.
 *
 * Se prueban dos rutas porque el script de build (`cp -r src/assets
 * dist/assets`) deja los assets en `dist/assets/` la primera vez y en
 * `dist/assets/assets/` en builds posteriores.
 *
 * Nunca hay fallback a la marca de Transmeralda: un documento de Cotransmeq
 * con el logotipo de la otra empresa es peor que uno sin logotipo, y quien
 * llama ya tiene su propio respaldo en texto.
 */
import * as path from 'path'
import * as fs from 'fs'

// Relativos a este archivo (`src/lib/` en dev, `dist/lib/` en el build). El
// segundo cubre el caso de `cp -r src/assets dist/assets` cuando `dist/assets`
// ya existe y copia dentro, dejando `dist/assets/assets/`.
const CANDIDATOS = [
  '../assets/cotransmeq-logo.png',
  '../assets/assets/cotransmeq-logo.png'
]

let _logoPath: string | null | undefined

/** Ruta absoluta al logotipo de Cotransmeq, o `null` si no está en el build. */
export function resolverLogoCotransmeq(): string | null {
  if (_logoPath !== undefined) return _logoPath
  for (const rel of CANDIDATOS) {
    const p = path.join(__dirname, rel)
    if (fs.existsSync(p)) {
      _logoPath = p
      return _logoPath
    }
  }
  _logoPath = null
  return _logoPath
}

/**
 * Logotipo para las plantillas de correo.
 *
 * El HTML de un correo no puede leer el disco del servidor, así que aquí va
 * una URL pública. `EMAIL_LOGO_URL` manda; el valor por defecto apunta al
 * objeto de Cotransmeq que sí es público. El antiguo `assets/logo.webp`
 * respondía 403 —el correo salía con la imagen rota— y `assets/logo.png` es
 * el logotipo de Transmeralda.
 */
export const LOGO_EMAIL_URL_POR_DEFECTO =
  'https://transmeralda.s3.us-east-2.amazonaws.com/assets/cotransmeq.png'
