/**
 * Comportamiento del handshake con `SOCKET_AUTH_MODE=enforce`.
 *
 * Hasta ahora el modo por defecto era `permissive`: un socket sin token se
 * conectaba igual, y `resolveActor` aceptaba como identidad la que declarara
 * el propio cliente en el payload —un id que además se persiste en
 * `actualizado_por_id`—. Pasar a `enforce` cierra eso, pero es el cambio de
 * mayor alcance de todo el trabajo de seguridad, porque rechaza conexiones.
 *
 * Estos casos fijan lo que tiene que seguir funcionando después:
 *
 *   1. sin token           → rechazado
 *   2. token inventado     → rechazado
 *   3. token del dashboard → aceptado
 *   4. token del PORTAL    → aceptado
 *
 * El cuarto es el que decide si se puede activar. El portal del conductor se
 * autentica con el token del magic link, no con el del dashboard: si ese token
 * no validara igual, `enforce` dejaría a los conductores sin tiempo real en
 * sus formularios sin que nadie se enterase hasta recibir la queja.
 *
 * La suite corre con `SOCKET_AUTH_MODE=enforce` (ver `.env.test`), así que
 * esto prueba el modo de verdad y no una simulación.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import jwt from 'jsonwebtoken'
import { io as clienteIo, type Socket } from 'socket.io-client'

vi.mock('pdfmake/build/pdfmake', () => ({ default: {}, createPdf: () => ({}) }))
vi.mock('pdfmake/build/vfs_fonts', () => ({ default: {}, vfs: {} }))

import { env } from '../src/config/env'
import { abrirBanco, type Banco } from './helpers/canvas-servicios'
import { cerrarPrisma, limpiarUsuariosSembrados, sembrarUsuario } from './helpers/usuarios-prueba'

let banco: Banco
let tokenDashboard: string

const abiertos: Socket[] = []

/** Intenta conectar con el token dado (o sin ninguno) y dice si lo aceptaron. */
function conectarCon(token?: string): Promise<{ ok: boolean; motivo?: string }> {
	return new Promise((resolve) => {
		const s = clienteIo(banco.urlBase, {
			...(token ? { auth: { token } } : {}),
			transports: ['websocket'],
			reconnection: false,
			forceNew: true
		})
		abiertos.push(s)

		const corte = setTimeout(() => resolve({ ok: false, motivo: 'timeout' }), 6000)

		s.on('connect', () => {
			clearTimeout(corte)
			resolve({ ok: true })
		})
		s.on('connect_error', (e) => {
			clearTimeout(corte)
			resolve({ ok: false, motivo: e.message })
		})
	})
}

beforeAll(async () => {
	await limpiarUsuariosSembrados()
	const usuario = await sembrarUsuario('enforce')
	tokenDashboard = usuario.token
	banco = await abrirBanco()
}, 30_000)

afterAll(async () => {
	for (const s of abiertos) {
		try {
			s.removeAllListeners()
			s.disconnect()
		} catch {
			/* noop */
		}
	}
	await banco?.cerrar()
	await limpiarUsuariosSembrados()
	await cerrarPrisma()
})

describe('Handshake en modo enforce', () => {
	it('el modo de la suite es enforce', () => {
		// Si esto falla, los demás casos no prueban lo que dicen probar.
		expect(env.SOCKET_AUTH_MODE).toBe('enforce')
	})

	it('rechaza una conexión sin token', async () => {
		const r = await conectarCon()
		expect(r.ok).toBe(false)
		expect(r.motivo).toContain('unauthorized')
	})

	it('rechaza un token que no firmamos nosotros', async () => {
		const falso = jwt.sign({ sub: 'quien-sea' }, 'secreto-que-no-es-el-nuestro')
		const r = await conectarCon(falso)
		expect(r.ok).toBe(false)
		expect(r.motivo).toContain('unauthorized')
	})

	it('acepta el token del dashboard', async () => {
		const r = await conectarCon(tokenDashboard)
		expect(r.ok).toBe(true)
	})

	it('acepta el token del portal del conductor', async () => {
		/**
		 * Misma forma que emite `portal-token.service.ts`: `tipo` distinto y sin
		 * `area` ni `role`, pero firmado con el MISMO `JWT_SECRET`. Es lo que
		 * hace que `enforce` no rompa el portal.
		 */
		const tokenPortal = jwt.sign(
			{
				sub: 'conductor-de-prueba',
				cedula: '1234567890',
				nombre: 'Conductor Prueba',
				tipo: 'conductor_portal'
			},
			env.JWT_SECRET,
			{ expiresIn: '30d' }
		)

		const r = await conectarCon(tokenPortal)
		expect(r.ok).toBe(true)
	})

	it('rechaza un token caducado', async () => {
		const caducado = jwt.sign({ sub: 'x' }, env.JWT_SECRET, { expiresIn: '-1h' })
		const r = await conectarCon(caducado)
		expect(r.ok).toBe(false)
	})
})
