/**
 * Tokens visuales del registro de Salida No Conforme.
 *
 * ── Por qué existe este archivo y no se reusan los de liquidaciones ──
 * `liquidaciones-terceros-pdf/pdf-tokens.ts` describe OTRO documento: sus
 * claves son de su dominio (`verde`, `interno-bg`, `foot-bg`) y además está
 * espejado en el frontend, con un test que falla si los dos mapas divergen.
 * Meter aquí los colores de un registro ISO —que es rojo— habría obligado a
 * tocar ese espejo y a arrastrar claves que este documento no usa.
 *
 * Lo que SÍ se comparte es el sistema: mismo mecanismo (custom properties
 * `--snc-*` inyectadas en el `<style>`), misma escala tipográfica en `pt`,
 * mismos valores de rejilla y de padding de celda. Los dos documentos salen
 * de la misma empresa y tienen que parecerlo; lo que cambia es el acento.
 *
 * ── Por qué el mapa es PLANO ──
 * Igual que en liquidaciones: cada clave es una custom property y
 * `sncCssVars()` es una traducción directa, sin lógica que interpretar.
 */

export const SNC_TOKENS: Record<string, string> = {
  // ── Color ────────────────────────────────────────────────────────
  /**
   * Rojo del documento.
   *
   * Es el acento de un registro de NO CONFORMIDAD, no el de la marca: aquí
   * el color comunica el tipo de registro, y por eso NO sigue el remapeo de
   * marca que sí aplica al resto del producto.
   */
  rojo: '#dc2626',
  'rojo-borde': '#991b1b',
  'rojo-suave': '#fee2e2',
  'rojo-texto': '#991b1b',

  tinta: '#0f172a',
  'tinta-suave': '#475569',
  'tinta-tenue': '#64748b',

  /** Rejilla: el borde de TODA celda de cuerpo. Un único valor. */
  rejilla: '#d1d5db',
  /** Marco exterior de cabeceras y bandas. */
  marco: '#000000',
  /** Fondo de la etiqueta de cada celda. */
  'label-bg': '#f3f4f6',

  // ── Semáforo de estado y clasificación ───────────────────────────
  // Verde/ámbar/rojo con su significado de siempre. No son colores de
  // marca y no se remapean.
  'ok-bg': '#d1fae5',
  'ok-texto': '#065f46',
  'aviso-bg': '#fef3c7',
  'aviso-texto': '#92400e',
  'mayor-bg': '#ffedd5',
  'mayor-texto': '#9a3412',

  // ── Bordes ───────────────────────────────────────────────────────
  'borde-rejilla': '1px',
  'borde-marco': '2px',

  // ── Tipografía ───────────────────────────────────────────────────
  // Misma escala que el documento de liquidaciones, para que los dos PDF
  // se lean como del mismo juego.
  'fs-micro': '6pt',
  'fs-head': '6.6pt',
  'fs-body': '7.4pt',
  'fs-foot': '8pt',
  'fs-seccion': '9pt',
  'fs-titulo': '13pt',

  'fuente-sans': "'Inter Tight', Arial, Helvetica, sans-serif",
  'fuente-display': "'Fraunces', Georgia, serif",
  'fuente-mono': "'JetBrains Mono', 'Courier New', monospace",

  // ── Espaciado de celda ───────────────────────────────────────────
  // En px a propósito: son separaciones físicas de la rejilla, no
  // tipografía, y no deben crecer con el cuerpo de letra.
  'pad-y': '3px',
  'pad-x': '5px'
};

/**
 * Los tokens como declaraciones de custom properties, listas para inyectar
 * dentro de un bloque `<style>`.
 */
export function sncCssVars(): string {
  return Object.entries(SNC_TOKENS)
    .map(([k, v]) => `--snc-${k}:${v}`)
    .join(';');
}
