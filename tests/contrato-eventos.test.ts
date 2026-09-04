/**
 * Contrato de eventos de socket entre backend y frontend.
 *
 * Este test existe porque el desajuste no daba ningún síntoma. El módulo de
 * Servicios no emitía NADA mientras el frontend tenía seis listeners montados
 * con su lógica de parche escrita; la página de Flota escuchaba
 * `vehiculo-creado` y el backend emitía `vehiculo:oculto`; había 24 eventos
 * saliendo del backend que nadie recogía. Nada fallaba, nada se ponía rojo:
 * simplemente el tiempo real no funcionaba y la lista solo se actualizaba al
 * recargar.
 *
 * Lo que se comprueba:
 *
 *   1. Ningún listener del frontend espera un evento que nadie emite.
 *   2. Los nombres siguen una de las convenciones admitidas.
 *   3. Ningún evento se construye interpolando en tiempo de ejecución.
 *
 * NO se comprueba la dirección contraria (emitido sin consumidor) como fallo:
 * hay eventos legítimos sin consumidor todavía —colas cuyo progreso aún no se
 * pinta, por ejemplo—. Se listan al final como aviso, para que la deuda esté a
 * la vista sin bloquear.
 *
 * El escaneo es textual, así que no puede resolver un nombre que se decide en
 * una variable. Esos casos van en `EMITIDOS_INDIRECTAMENTE`, con su motivo.
 */

import { describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import {
	emitidosPorElBackend,
	escuchadosPorElFrontend,
	porEvento
} from './helpers/escanear-eventos'

const RAIZ_BACKEND = resolve(__dirname, '..')
const RAIZ_FRONTEND = resolve(RAIZ_BACKEND, '..', 'cotransmeq-app')

/**
 * Eventos que SÍ se emiten, pero cuyo nombre no aparece como literal junto a
 * la llamada y el escaneo textual no puede ver.
 *
 * Cada entrada necesita su motivo. Si una deja de estar justificada, lo suyo
 * es arreglar el emisor —no ampliar esta lista—.
 */
const EMITIDOS_INDIRECTAMENTE: Record<string, string> = {
	'asistencias:formulario:updated':
		'asistencias.controller.ts elige el nombre con un ternario y lo pasa en una variable',
	'asistencias:formulario:disabled':
		'asistencias.controller.ts elige el nombre con un ternario y lo pasa en una variable'
}

/**
 * Convenciones admitidas hoy.
 *
 * Conviven varias porque el proyecto las mezcló desde el principio y renombrar
 * de golpe dejaría mudas las páginas que ya escuchan el nombre viejo. Lo que
 * esta comprobación impide es inventar una SÉPTIMA forma.
 */
const CONVENCIONES = [
	/^[a-z0-9]+(?:-[a-z0-9]+)*:[a-z0-9]+(?:-[a-z0-9]+)*$/, // dominio:accion
	/^[a-z0-9]+(?:-[a-z0-9]+)*:[a-z0-9-]+:[a-z0-9-]+$/, // dominio:sub:accion
	/^[a-z0-9]+(?:-[a-z0-9]+)*$/, // kebab plano
	/^[a-z]+:[a-z]+\.[a-z]+$/ // forms:assignment.changed
]

describe('Contrato de eventos de socket', () => {
	const emision = emitidosPorElBackend(RAIZ_BACKEND)
	const emitidos = porEvento(emision.apariciones)
	const escuchados = porEvento(escuchadosPorElFrontend(RAIZ_FRONTEND))

	it('ningún listener del frontend espera un evento que nadie emite', () => {
		const fantasmas = [...escuchados.entries()]
			.filter(([evento]) => !emitidos.has(evento) && !(evento in EMITIDOS_INDIRECTAMENTE))
			.map(([evento, sitios]) => `  ${evento}  ← ${sitios[0].archivo}:${sitios[0].linea}`)

		expect(
			fantasmas,
			`Estos listeners esperan eventos que el backend nunca emite. O el nombre\n` +
				`está mal escrito en un lado, o falta la emisión, o el listener sobra:\n\n` +
				fantasmas.join('\n')
		).toEqual([])
	})

	it('los nombres de evento siguen una convención conocida', () => {
		const raros = [...emitidos.keys()]
			.filter((e) => !CONVENCIONES.some((re) => re.test(e)))
			.sort()

		expect(
			raros,
			`Nombres que no encajan en ninguna convención del proyecto:\n${raros.join('\n')}`
		).toEqual([])
	})

	it('ningún evento se construye interpolando en tiempo de ejecución', () => {
		const sitios = emision.interpolados.map((i) => `  ${i.evento}  (${i.archivo}:${i.linea})`)

		expect(
			sitios,
			`Un nombre construido en tiempo de ejecución no se puede buscar ni\n` +
				`declarar. Úsalo como literal:\n\n${sitios.join('\n')}`
		).toEqual([])
	})

	it('deja constancia de los eventos que nadie consume', () => {
		// No falla a propósito: es deuda conocida, no una regresión. Sirve para
		// que el número esté a la vista y no crezca en silencio.
		const huerfanos = [...emitidos.keys()].filter((e) => !escuchados.has(e)).sort()

		console.log(
			`\n  [contrato] ${huerfanos.length} eventos emitidos sin consumidor en el ` +
				`frontend del dashboard.\n  Algunos son legítimos (colas cuyo progreso ` +
				`aún no se pinta); otros son trabajo pendiente.\n`
		)

		expect(emitidos.size).toBeGreaterThan(0)
	})
})
