/**
 * Extrae del código fuente qué eventos de socket se emiten y cuáles se
 * escuchan, a los dos lados.
 *
 * Es la base del test de contrato. La alternativa —mantener la lista a mano—
 * es justo lo que falló hasta ahora: hay eventos que el backend emite y nadie
 * escucha, y listeners esperando eventos que no existen. Nadie lo vio porque
 * no había nada que lo comprobara.
 *
 * Se hace por texto y no con el AST de TypeScript a propósito: lo que interesa
 * es el literal que viaja por el cable. Un evento cuyo nombre se construye en
 * tiempo de ejecución no es greppable por nadie —ni por una persona buscando
 * quién lo emite— y el propio escaneo lo señala como problema.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

export interface Aparicion {
	evento: string
	archivo: string
	linea: number
}

/** Nombres que no son eventos de dominio: los emite o escucha socket.io. */
const DE_LA_LIBRERIA = new Set([
	'connect',
	'connect_error',
	'connection',
	'disconnect',
	'disconnecting',
	'error',
	'reconnect',
	'reconnect_attempt',
	'reconnect_error',
	'reconnect_failed',
	'newListener',
	'removeListener'
])

export function esDeLaLibreria(evento: string): boolean {
	return DE_LA_LIBRERIA.has(evento)
}

function listarArchivos(raiz: string, extensiones: string[]): string[] {
	const salida: string[] = []
	const ignorar = new Set(['node_modules', 'dist', 'build', '.svelte-kit', '.git', 'coverage'])

	const recorrer = (dir: string) => {
		let entradas: string[]
		try {
			entradas = readdirSync(dir)
		} catch {
			return
		}
		for (const entrada of entradas) {
			if (ignorar.has(entrada)) continue
			const ruta = join(dir, entrada)
			let info
			try {
				info = statSync(ruta)
			} catch {
				continue
			}
			if (info.isDirectory()) recorrer(ruta)
			else if (extensiones.some((e) => entrada.endsWith(e))) salida.push(ruta)
		}
	}

	recorrer(raiz)
	return salida
}

/** Número de línea (1-based) de una posición dentro del texto. */
function lineaDe(texto: string, posicion: number): number {
	let n = 1
	for (let i = 0; i < posicion && i < texto.length; i++) if (texto[i] === '\n') n++
	return n
}

/** Quita comentarios de línea y de bloque para no leer eventos documentados. */
function sinComentarios(texto: string): string {
	// Se sustituyen por espacios en vez de borrarse, para no descuadrar los
	// números de línea que se calculan por posición.
	return texto
		.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
		.replace(/\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '))
}

/**
 * Busca los nombres de evento que viajan en llamadas de emisión o escucha.
 *
 * Contempla las tres formas que usa este código, porque restringirse a la
 * primera daba decenas de falsos «nadie emite esto»:
 *
 *   1. `.emit('nombre', datos)`               — directa
 *   2. `this.emit({ userId }, 'nombre', ...)` — el destino va primero (colas)
 *   3. `emitLiquidacionServicio('nombre', …)` — helper con nombre en el 1.º
 *
 * `interpolados` recoge aparte los `` .emit(`algo:${x}`) ``: viajan por el
 * cable igual, pero su nombre no se puede saber leyendo el código.
 */
function buscarLlamadas(
	archivos: string[],
	raiz: string,
	metodos: string[]
): { apariciones: Aparicion[]; interpolados: Aparicion[] } {
	const apariciones: Aparicion[] = []
	const interpolados: Aparicion[] = []
	const metodo = metodos.join('|')

	// El punto es opcional: además de `socket.emit(...)` hay funciones sueltas
	// (`emit('recargos-bulk-recalc:progress', …)` dentro de un servicio) y
	// helpers propios (`emitToUser(id, 'sesion-cerrada', …)`), que emiten
	// igual. Exigir el punto daba por «no emitidos» eventos que sí salen.
	const prefijo = `(?:\\.|\\b)`
	const patrones = [
		// emit('nombre'  /  .on('nombre'
		new RegExp(`${prefijo}(?:${metodo})\\(\\s*['"]([^'"]+)['"]`, 'g'),
		// emit(destino, 'nombre'  — un argumento intermedio, sin comas dentro
		// salvo las de un objeto simple como { userId }
		new RegExp(
			`${prefijo}(?:${metodo})\\(\\s*(?:\\{[^{}]*\\}|[A-Za-z_$][\\w$.]*)\\s*,\\s*['"]([^'"]+)['"]`,
			'g'
		)
	]
	// Helpers propios (`emitToUser`, `emitLiquidacionServicio`…), con el nombre
	// del evento en el primer o en el segundo argumento.
	const helper = new RegExp(`\\bemit[A-Za-z]\\w*\\s*\\(\\s*['"]([^'"]+)['"]`, 'g')
	const helperSegundo = new RegExp(
		`\\bemit[A-Za-z]\\w*\\s*\\(\\s*(?:\\{[^{}]*\\}|[A-Za-z_$][\\w$.]*)\\s*,\\s*['"]([^'"]+)['"]`,
		'g'
	)
	const plantilla = new RegExp(`\\.(?:${metodo})\\(\\s*\`([^\`]*\\$\\{[^\`]*)\``, 'g')

	const soloEmision = metodos.includes('emit')

	for (const archivo of archivos) {
		const crudo = readFileSync(archivo, 'utf8')
		const texto = sinComentarios(crudo)
		const rel = relative(raiz, archivo)

		const anota = (re: RegExp, destino: Aparicion[]) => {
			for (const m of texto.matchAll(re)) {
				destino.push({ evento: m[1], archivo: rel, linea: lineaDe(texto, m.index ?? 0) })
			}
		}

		for (const re of patrones) anota(re, apariciones)
		if (soloEmision) {
			anota(helper, apariciones)
			anota(helperSegundo, apariciones)
		}
		anota(plantilla, interpolados)
	}

	// Un mismo sitio puede casar con dos patrones; se deduplica por posición.
	const vistos = new Set<string>()
	const unicas = apariciones.filter((a) => {
		const clave = `${a.archivo}:${a.linea}:${a.evento}`
		if (vistos.has(clave)) return false
		vistos.add(clave)
		return true
	})

	return { apariciones: unicas, interpolados }
}

/**
 * Nombres declarados en una tabla `EVENTOS_ALGO = { clave: 'nombre' } as const`.
 *
 * Los emisores por dominio (`servicios.events.ts` y compañía) no escriben el
 * literal en el `.emit(`, sino que lo toman de esa tabla — que es justo lo que
 * queremos, porque así el nombre se declara en un solo sitio. Sin leer estas
 * tablas el escaneo daba por «no emitidos» eventos que sí salen.
 */
function declaradosEnTablas(archivos: string[], raiz: string): Aparicion[] {
	const salida: Aparicion[] = []
	const tabla = /export const EVENTOS_\w+\s*=\s*\{([\s\S]*?)\}\s*as const/g
	const entrada = /['"]?\w+['"]?\s*:\s*['"]([^'"]+)['"]/g

	for (const archivo of archivos) {
		const texto = sinComentarios(readFileSync(archivo, 'utf8'))
		const rel = relative(raiz, archivo)
		for (const t of texto.matchAll(tabla)) {
			for (const e of t[1].matchAll(entrada)) {
				salida.push({ evento: e[1], archivo: rel, linea: lineaDe(texto, t.index ?? 0) })
			}
		}
	}
	return salida
}

/** Eventos que el BACKEND emite (`.emit(` y tablas `EVENTOS_*`). */
export function emitidosPorElBackend(raizBackend: string) {
	const archivos = listarArchivos(join(raizBackend, 'src'), ['.ts'])
	const { apariciones, interpolados } = buscarLlamadas(archivos, raizBackend, ['emit'])
	const deTablas = declaradosEnTablas(archivos, raizBackend)
	return {
		apariciones: [...apariciones, ...deTablas].filter((a) => !esDeLaLibreria(a.evento)),
		interpolados
	}
}

/** Eventos que el BACKEND escucha (`socket.on(`). */
export function escuchadosPorElBackend(raizBackend: string) {
	const archivos = listarArchivos(join(raizBackend, 'src'), ['.ts'])
	const { apariciones } = buscarLlamadas(archivos, raizBackend, ['on'])
	return apariciones.filter((a) => !esDeLaLibreria(a.evento))
}

/**
 * Eventos que el FRONTEND escucha.
 *
 * Se limita a los ficheros que tocan el socket para no recoger los `.on(` de
 * cualquier emisor de eventos del navegador.
 */
export function escuchadosPorElFrontend(raizFrontend: string) {
	const todos = listarArchivos(join(raizFrontend, 'src'), ['.ts', '.svelte'])
	const archivos = todos.filter((a) => {
		const t = readFileSync(a, 'utf8')
		return /socketUtils|socketManager|socketClient|getSocket\(|\$socketStore|socketStore/.test(t)
	})
	const { apariciones } = buscarLlamadas(archivos, raizFrontend, ['on'])
	return apariciones.filter((a) => !esDeLaLibreria(a.evento))
}

/** Eventos que el FRONTEND emite (los que el backend debe escuchar). */
export function emitidosPorElFrontend(raizFrontend: string) {
	const todos = listarArchivos(join(raizFrontend, 'src'), ['.ts', '.svelte'])
	const archivos = todos.filter((a) => {
		const t = readFileSync(a, 'utf8')
		return /socketUtils|socketManager|socketClient|getSocket\(|\$socketStore|socketStore/.test(t)
	})
	const { apariciones } = buscarLlamadas(archivos, raizFrontend, ['emit'])
	return apariciones.filter((a) => !esDeLaLibreria(a.evento))
}

/** Agrupa apariciones por nombre de evento. */
export function porEvento(apariciones: Aparicion[]): Map<string, Aparicion[]> {
	const mapa = new Map<string, Aparicion[]>()
	for (const a of apariciones) {
		const lista = mapa.get(a.evento) ?? []
		lista.push(a)
		mapa.set(a.evento, lista)
	}
	return mapa
}
