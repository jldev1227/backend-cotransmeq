/**
 * Saneamiento de texto antes de persistirlo.
 *
 * No es «escapar HTML»: el frontend es Svelte y escapa por defecto, así que
 * inyectar `<script>` en una observación no ejecuta nada. Lo que esto resuelve son
 * cuatro problemas concretos y distintos:
 *
 *  1. **El byte nulo rompe Postgres.** Un `U+0000` en una columna `TEXT` hace que el
 *     driver falle con «unsupported Unicode escape sequence». Un teclado
 *     defectuoso o un pegado desde un PDF lo mete sin que nadie lo note, y el
 *     conductor pierde el envío con un error incomprensible.
 *
 *  2. **Los caracteres de control invisibles corrompen los informes.** Un `\f` o
 *     un `\v` dentro de una observación desmonta el PDF y el CSV.
 *
 *  3. **Los caracteres de dirección bidireccional falsean lo que se lee.** Con
 *     `U+202E` (RIGHT-TO-LEFT OVERRIDE) se puede escribir una observación que en
 *     pantalla dice «frenos OK» y almacena lo contrario. En un documento con valor
 *     legal eso no es aceptable.
 *
 *  4. **Las variantes Unicode del mismo texto no se pueden comparar.** «á» existe
 *     como un carácter y como «a» + tilde combinante; sin normalizar, dos
 *     etiquetas idénticas a la vista no coinciden y el detector de duplicados no
 *     las ve.
 *
 * Se aplica a lo que se ESCRIBE (respuestas y textos de la definición), no a lo
 * que se lee: los datos ya guardados se devuelven tal cual.
 */

/**
 * Caracteres de control que se eliminan.
 *
 * C0 (`U+0000`-`U+001F`) y DEL (`U+007F`) EXCEPTO tabulador, salto de linea y
 * retorno de carro, que son legítimos en un texto largo. También C1
 * (`U+0080`-`U+009F`), que ningun teclado produce y que solo llega desde
 * codificaciones mal convertidas.
 */
const CONTROLES = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g

/**
 * Marcas bidireccionales y de formato invisible.
 *
 * `U+200B`–`U+200F` (espacios de ancho cero y marcas LTR/RTL), `U+202A`–`U+202E`
 * (embedding y override), `U+2066`–`U+2069` (isolates) y `U+FEFF` (BOM). Con
 * cualquiera de ellas se puede construir un texto que se lee distinto de como se
 * almacena.
 */
const BIDI_Y_INVISIBLES = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g

/**
 * Copias SIN el flag `g` para `test()`.
 *
 * Una expresión con `g` mantiene `lastIndex` entre llamadas: `test()` sobre el
 * mismo patrón devuelve `true` y luego `false` con la misma entrada. Es el clásico
 * bug de detección intermitente, así que la comprobación usa patrones propios.
 */
const CONTROLES_TEST = new RegExp(CONTROLES.source)
const BIDI_TEST = new RegExp(BIDI_Y_INVISIBLES.source)

export interface SanitizeOptions {
	/** Colapsa cualquier espacio en blanco a uno solo. Para etiquetas y claves. */
	singleLine?: boolean
	/** Recorta a esta longitud tras sanear. */
	maxLength?: number
	/** Máximo de saltos de línea consecutivos. Por defecto 2. */
	maxBlankLines?: number
}

/**
 * Sanea un texto libre.
 *
 * El orden importa: primero se normaliza (para que las secuencias combinantes ya
 * estén compuestas), después se quitan los controles y las marcas invisibles, y al
 * final se recorta. Recortar antes podría cortar por la mitad un par subrogado.
 */
export function sanitizeText(value: string, options: SanitizeOptions = {}): string {
	let texto = value.normalize('NFC').replace(CONTROLES, '').replace(BIDI_Y_INVISIBLES, '')

	if (options.singleLine) {
		texto = texto.replace(/\s+/g, ' ')
	} else {
		/// Se normalizan los finales de línea a `\n` y se limita la cantidad de
		/// líneas en blanco seguidas: pegar desde Word trae docenas y desmontan el
		/// PDF del informe.
		const maxBlancos = options.maxBlankLines ?? 2
		texto = texto
			.replace(/\r\n?/g, '\n')
			.replace(new RegExp(`\n{${maxBlancos + 1},}`, 'g'), '\n'.repeat(maxBlancos))
	}

	texto = texto.trim()

	if (options.maxLength != null && texto.length > options.maxLength) {
		/// `Array.from` respeta los pares subrogados: cortar con `slice` puede
		/// partir un emoji y dejar media unidad de código que Postgres rechaza.
		texto = Array.from(texto).slice(0, options.maxLength).join('')
	}

	return texto
}

/** Sanea si es string; deja el resto intacto. */
export function sanitizeMaybe(value: unknown, options: SanitizeOptions = {}): unknown {
	return typeof value === 'string' ? sanitizeText(value, options) : value
}

/**
 * Sanea un JSON de configuración recursivamente.
 *
 * `config_json`, `validation_json` y `metadata_json` aceptan lo que el builder
 * envie, y ahi tambien puede acabar un `U+0000` pegado desde un PDF. La
 * profundidad se acota: un JSON con mil niveles anidados es un intento de agotar
 * la pila, no una configuración.
 */
export function sanitizeJson(value: unknown, profundidad = 0): unknown {
	if (profundidad > 12) return null
	if (typeof value === 'string') return sanitizeText(value, { maxLength: 20_000 })
	if (Array.isArray(value)) {
		return value.slice(0, 1000).map((v) => sanitizeJson(v, profundidad + 1))
	}
	if (value && typeof value === 'object') {
		const salida: Record<string, unknown> = {}
		for (const [clave, valor] of Object.entries(value as Record<string, unknown>).slice(0, 200)) {
			salida[sanitizeText(clave, { singleLine: true, maxLength: 120 })] = sanitizeJson(
				valor,
				profundidad + 1
			)
		}
		return salida
	}
	return value
}

/**
 * ¿El texto traía algo que hubo que quitar?
 *
 * Se usa para registrar el hecho sin bloquear el envío: si un conductor pega algo
 * con caracteres invisibles, su inspección debe entrar igual, pero conviene saber
 * que pasó para poder investigar el origen.
 */
export function needsSanitizing(value: string): boolean {
	return CONTROLES_TEST.test(value) || BIDI_TEST.test(value) || value !== value.normalize('NFC')
}
