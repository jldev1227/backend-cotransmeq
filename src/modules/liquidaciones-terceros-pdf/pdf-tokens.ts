/**
 * Tokens visuales del documento de liquidación de terceros.
 *
 * ⚠️ ESPEJO EXACTO de
 * `ingreso-svelte/src/lib/styles/pdf-tokens.ts`.
 *
 * Están duplicados a propósito: son dos builds distintos y no hay paquete
 * compartido. El test `pdf-tokens.spec.ts` de al lado lee el fichero del frontend y
 * falla si los dos mapas divergen — es la única forma de enterarse, porque
 * una divergencia no rompe nada: simplemente el preview se ve de un color y
 * el PDF descargado de otro, y nadie lo nota hasta que el cliente compara.
 *
 * El PDF real lo renderiza el backend con Puppeteer + Chromium a partir de
 * `liquidaciones-terceros-pdf.template.ts`. Este componente de preview NO
 * genera el PDF: solo lo imita. Por eso los dos tienen que partir de aquí.
 *
 * ── Por qué el mapa es PLANO ──
 * Cada clave es una custom property CSS (`--tpdf-<clave>`). Plano significa
 * que el test puede compararlo línea a línea sin interpretar estructuras
 * anidadas, y que `pdfCssVars()` es una traducción directa sin lógica.
 *
 * ── Por qué hay una escala ──
 * El preview se dibuja sobre un lienzo de 2480px (unas 4 veces una carta) y
 * luego se reduce por CSS, así que necesita cuerpos tipográficos mayores que
 * el documento impreso. Las medidas en `pt` de aquí son las del DOCUMENTO;
 * `pdfCssVars(escala)` las multiplica. Los colores y los bordes no escalan.
 */

/** Claves cuyo valor es una medida en `pt` y por tanto escala. */
const CLAVES_ESCALABLES = new Set([
	'fs-micro',
	'fs-head',
	'fs-body',
	'fs-foot',
	'fs-titulo',
	'fs-seccion'
]);

export const PDF_TOKENS: Record<string, string> = {
	// ── Color ────────────────────────────────────────────────────────
	/**
	 * Color de marca del documento.
	 *
	 * La CLAVE conserva el nombre histórico —`verde`, y de ahí `--tpdf-verde`—
	 * igual que `app.css` de este repo conserva `--emerald-*` con valores
	 * naranjas: renombrarla obligaría a tocar `documento.css.ts` y
	 * `PreviewTerceroPDF.svelte`, que son idénticos a los de transmeralda y
	 * deben seguir siéndolo. Lo que cambia es el VALOR: el naranja de
	 * Cotransmeq, no el verde de la otra empresa.
	 */
	verde: '#7c2d12',
	/** Borde de las cabeceras de marca. Un tono más oscuro, no negro. */
	'verde-borde': '#431407',
	/** Fondo de la banda de periodo y de las filas de adicional. */
	'verde-suave': '#fff7ed',
	/** Texto sobre fondos de marca claros (totales a favor). */
	'verde-texto': '#9a3412',

	tinta: '#0f172a',
	'tinta-suave': '#475569',
	'tinta-tenue': '#64748b',

	/** Rejilla: el borde de TODA celda de cuerpo. Un único valor. */
	rejilla: '#dde3eb',
	/** Marco exterior de cabecera y bandas. */
	marco: '#000000',

	/** Fondo de las filas de pie (`tfoot`). */
	'foot-bg': '#e2e8f0',
	/** Fondo de las columnas de uso interno. */
	'interno-bg': '#f8fafc',
	/** Cabecera de las columnas de uso interno: gris, no verde. */
	'interno-head': '#475569',
	'interno-borde': '#334155',

	/** Descuentos y saldos en contra. */
	rojo: '#b91c1c',
	/** Gastos operativos. */
	ambar: '#92400e',
	/** Anticipos. */
	azul: '#1d4ed8',
	/** Pagos internos por concepto: verde CLARO, para no confundirlos con
	    el verde pleno del neto que sí se le paga a un propietario. */
	'verde-claro': '#ea580c',
	/** Fondo de los bloques de concepto. */
	'verde-claro-bg': '#ffedd5',

	// ── Bordes ───────────────────────────────────────────────────────
	'borde-rejilla': '1px',
	'borde-marco': '2px',

	// ── Tipografía (medidas del DOCUMENTO; el preview las escala) ────
	'fs-micro': '6pt',
	'fs-head': '6.6pt',
	'fs-body': '7.4pt',
	'fs-foot': '8pt',
	'fs-seccion': '9pt',
	'fs-titulo': '10pt',

	'fuente-sans': "'Inter Tight', Arial, Helvetica, sans-serif",
	'fuente-mono': "'JetBrains Mono', 'Courier New', monospace",

	// ── Espaciado de celda ───────────────────────────────────────────
	// En px a propósito: son separaciones físicas de la rejilla, no
	// tipografía, y no deben crecer con el cuerpo de letra.
	'pad-y': '3px',
	'pad-x': '5px'
};

/**
 * Multiplica una medida en `pt`. Devuelve el valor tal cual si no lo es.
 *
 * Se redondea a un decimal: sin eso salen cuerpos como `9.239999999pt` en
 * el CSS generado, que además cambian con cualquier reajuste de la escala.
 */
function escalar(valor: string, escala: number): string {
	const m = valor.match(/^([\d.]+)pt$/);
	if (!m) return valor;
	return `${Math.round(Number(m[1]) * escala * 10) / 10}pt`;
}

/**
 * Los tokens como declaraciones de custom properties, listas para inyectar
 * en un atributo `style` o dentro de un bloque `<style>`.
 *
 * @param escala multiplicador de las medidas tipográficas. 1 = documento
 *   impreso (lo que usa el backend). El preview usa un valor mayor porque
 *   dibuja sobre un lienzo de 2480px.
 */
export function pdfCssVars(escala = 1): string {
	return Object.entries(PDF_TOKENS)
		.map(([k, v]) => `--tpdf-${k}:${CLAVES_ESCALABLES.has(k) ? escalar(v, escala) : v}`)
		.join(';');
}

/**
 * Escala del preview.
 *
 * El lienzo del preview mide 2480px de ancho contra los ~279mm de una carta
 * apaisada. No es exactamente la razón entre ambos: se ajustó a ojo para que
 * el texto se lea cómodo en pantalla sin que las tablas desborden.
 */
export const ESCALA_PREVIEW = 1.35;
