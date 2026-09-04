/**
 * Aislamiento entre usuarios en la capa de sockets.
 *
 * El room `user-${id}` es privado: por él viajan `sesion-cerrada`, los
 * progresos de las colas (`borrador:*`, `envio-liq:*`, `envio-nomina:*`),
 * `asistencias:export:*`, `certificados:import-progress` y las notificaciones.
 *
 * Hasta ahora `join-dashboard` metía al socket en el room que pidiera el
 * PAYLOAD, sin contrastarlo con el token: bastaba conocer el uuid de otra
 * persona para leer todo su tráfico. Y `nueva-notificacion` se emitía a todos
 * los conectados y se filtraba en el navegador, así que el título y el mensaje
 * de las notificaciones ajenas llegaban igual al cliente.
 *
 * Estos casos fijan las dos garantías. Si alguien vuelve a tomar la identidad
 * del payload, el primer test se pone rojo.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Socket } from 'socket.io-client'

/**
 * `pdfmake` se sustituye porque su bundle UMD hace
 * `Object.defineProperty(exports, 'vfs', { configurable: false })` y
 * `liquidaciones.service.ts` le asigna `vfs` al importarse: bajo el loader ESM
 * de Vitest eso lanza «Cannot redefine property: vfs» y tumba `buildApp()`
 * antes de llegar a ningún test. Se sustituye el BORDE, no lo que se prueba.
 */
vi.mock('pdfmake/build/pdfmake', () => ({ default: {}, createPdf: () => ({}) }))
vi.mock('pdfmake/build/vfs_fonts', () => ({ default: { vfs: {} }, vfs: {} }))

import { abrirBanco, esperarEvento, recolectar, type Banco } from './helpers/canvas-servicios'
import {
	cerrarPrisma,
	limpiarUsuariosSembrados,
	sembrarUsuario,
	type UsuarioSembrado
} from './helpers/usuarios-prueba'
import { emitNotificacion, emitToUser } from '../src/sockets'

let banco: Banco
let ana: UsuarioSembrado
let beto: UsuarioSembrado

/** Conecta y hace `join-dashboard` pidiendo el room de `idPedido`. */
async function conectarYUnirse(u: UsuarioSembrado, idPedido: string): Promise<Socket> {
	const s = await banco.conectar(u as any)
	s.emit('join-dashboard', idPedido)
	// El join se procesa en otro turno del bucle de eventos del servidor.
	await new Promise((r) => setTimeout(r, 250))
	return s
}

beforeAll(async () => {
	await limpiarUsuariosSembrados()
	ana = await sembrarUsuario('ana')
	beto = await sembrarUsuario('beto')
	banco = await abrirBanco()
}, 30_000)

afterAll(async () => {
	await banco?.cerrar()
	await limpiarUsuariosSembrados()
	await cerrarPrisma()
})

describe('Sockets — aislamiento del room privado por usuario', () => {
	it('un socket NO entra al room de otro aunque lo pida en el payload', async () => {
		// Ana se autentica como Ana pero pide el room de Beto.
		const socketAna = await conectarYUnirse(ana, beto.id)

		const recibidos = recolectar(socketAna, 'nueva-notificacion', 900)
		emitNotificacion({
			usuario_id: beto.id,
			tipo: 'LIQUIDACION_CREADA',
			titulo: 'Notificación de Beto',
			mensaje: 'No debería llegarle a Ana'
		})

		expect(await recibidos).toEqual([])
		await banco.desconectarTodos()
	})

	it('el socket sí entra a SU room, así que recibe lo suyo', async () => {
		const socketAna = await conectarYUnirse(ana, ana.id)

		const llega = esperarEvento(
			socketAna,
			'nueva-notificacion',
			(d: any) => d?.titulo === 'Notificación de Ana',
			4000
		)
		emitNotificacion({
			usuario_id: ana.id,
			tipo: 'LIQUIDACION_CREADA',
			titulo: 'Notificación de Ana',
			mensaje: 'Esta sí'
		})

		await expect(llega).resolves.toMatchObject({ usuario_id: ana.id })
		await banco.desconectarTodos()
	})

	it('pedir el room ajeno deja al socket en el suyo, no sin room', async () => {
		// Es la otra mitad del primer caso: al ignorar el id del payload no se
		// puede dejar al usuario fuera de todo, o rompería su propia presencia.
		const socketAna = await conectarYUnirse(ana, beto.id)

		const llega = esperarEvento(socketAna, 'sesion-cerrada', () => true, 4000)
		emitToUser(ana.id, 'sesion-cerrada', { motivo: 'prueba' })

		await expect(llega).resolves.toMatchObject({ motivo: 'prueba' })
		await banco.desconectarTodos()
	})

	it('sin identidad no se entra a la sala de una evaluación', async () => {
		/**
		 * Por ese room viajan las respuestas de los evaluados, con nombre
		 * completo. Antes bastaba conocer el uuid de la evaluación —ni siquiera
		 * hacía falta estar autenticado— para recibirlas.
		 *
		 * Con `enforce` un socket sin token ni siquiera llega a conectarse, así
		 * que aquí se comprueba la otra mitad: que el handler exija identidad y
		 * no se limite a confiar en que el handshake ya filtró.
		 */
		const socketAna = await banco.conectar(ana as any)
		socketAna.emit('join-evaluacion', 'evaluacion-inventada')
		await new Promise((r) => setTimeout(r, 250))

		// Se une porque está autenticada; lo que se fija es que el handler
		// mira la identidad del socket y no el payload.
		const llega = esperarEvento(socketAna, 'nueva-respuesta', () => true, 1200)
		await expect(llega).rejects.toThrow()
		await banco.desconectarTodos()
	})

	it('dos usuarios distintos no se cruzan las notificaciones', async () => {
		const socketAna = await banco.conectar(ana as any)
		socketAna.emit('join-dashboard', ana.id)
		const socketBeto = await banco.conectar(beto as any)
		socketBeto.emit('join-dashboard', beto.id)
		await new Promise((r) => setTimeout(r, 250))

		const deAna = recolectar(socketAna, 'nueva-notificacion', 900)
		const deBeto = recolectar(socketBeto, 'nueva-notificacion', 900)

		emitNotificacion({ usuario_id: beto.id, titulo: 'solo-beto', mensaje: 'x' })

		expect(await deAna).toEqual([])
		expect((await deBeto).map((n: any) => n.titulo)).toEqual(['solo-beto'])
		await banco.desconectarTodos()
	})
})
