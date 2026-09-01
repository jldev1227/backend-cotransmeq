import fs from 'fs';
import path from 'path';

/**
 * Cache en memoria de los woff2 cargados desde src/assets/fonts/*.woff2
 * como data-URLs base64. Se leen una sola vez por proceso y se reusan
 * entre requests para no penalizar el render del PDF.
 */
const FONT_CACHE = new Map<string, string>();

/**
 * Devuelve un data-URL `data:font/woff2;base64,...` listo para inyectar
 * en un `@font-face { src: url(...) }`.
 *
 * Usa `import.meta.url` para resolver la ruta relativa al archivo TS,
 * de modo que funcione tanto en `ts-node` como compilado en `dist/`.
 */
export function loadFontAsDataUrl(filename: string): string {
  const cached = FONT_CACHE.get(filename);
  if (cached) return cached;

  const fontPath = path.join(__dirname, '..', '..', 'assets', 'fonts', filename);
  const buf = fs.readFileSync(fontPath);
  const dataUrl = `data:font/woff2;base64,${buf.toString('base64')}`;
  FONT_CACHE.set(filename, dataUrl);
  return dataUrl;
}

/**
 * CSS `@font-face` para todas las familias/pesos usados en los PDFs
 * (Fraunces display, Inter Tight texto, JetBrains Mono números).
 *
 * Mantener `font-display: block` para que Puppeteer/Chromium espere
 * a que las fuentes estén listas antes de medir el layout (importante
 * para evitar reescalados que muevan el contenido entre páginas).
 */
export function buildFontsCss(): string {
  const fonts = [
    { family: 'Fraunces', weight: 500, file: 'fraunces-500.woff2' },
    { family: 'Fraunces', weight: 600, file: 'fraunces-600.woff2' },
    { family: 'Inter Tight', weight: 400, file: 'intertight-400.woff2' },
    { family: 'Inter Tight', weight: 500, file: 'intertight-500.woff2' },
    { family: 'Inter Tight', weight: 600, file: 'intertight-600.woff2' },
    { family: 'Inter Tight', weight: 700, file: 'intertight-700.woff2' },
    { family: 'Inter Tight', weight: 800, file: 'intertight-800.woff2' },
    { family: 'JetBrains Mono', weight: 400, file: 'jetbrainsmono-400.woff2' },
    { family: 'JetBrains Mono', weight: 700, file: 'jetbrainsmono-700.woff2' },
  ];

  return fonts
    .map(
      (f) => `
@font-face {
  font-family: '${f.family}';
  font-style: normal;
  font-weight: ${f.weight};
  font-display: block;
  src: url(${loadFontAsDataUrl(f.file)}) format('woff2');
}`
    )
    .join('\n');
}