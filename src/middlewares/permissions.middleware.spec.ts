import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../services/permisos-rutas.service', () => ({ obtenerPermisosRutas: vi.fn() }))

import { obtenerPermisosRutas } from '../services/permisos-rutas.service'
import { requirePermission } from './permissions.middleware'

const obtener = vi.mocked(obtenerPermisosRutas)

async function consultar(
	area: string,
	override: Record<string, 'full' | 'read' | 'limited'> | null,
	nivel: 'limited' | 'full',
	method: 'GET' | 'POST' = 'GET',
	url = '/api/recargos'
) {
	const app = Fastify()
	app.addHook('preHandler', async (request) => {
		(request as any).user = { id: 'usuario-prueba', role: 'usuario', area: [area] }
	})
	app.get('/api/recargos', { preHandler: requirePermission('recargos', nivel) }, async () => ({ ok: true }))
	app.post('/api/recargos/:id/planilla', { preHandler: requirePermission('recargos', 'limited') }, async () => ({ ok: true }))
	app.post('/api/recargos', { preHandler: requirePermission('recargos', 'full') }, async () => ({ ok: true }))
	obtener.mockResolvedValueOnce(override)
	const response = await app.inject({ method, url })
	await app.close()
	return response
}

describe('guardas HTTP de recargos', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		delete process.env.PERMISSIONS_MODE
	})

	it.each([
		['administracion', 200],
		['operaciones', 200],
		['talento_humano', 200],
		['hseq', 403],
		['facturacion', 403],
		['contabilidad', 403],
		['mantenimiento', 403]
	] as const)('área %s: GET recargos responde %i', async (area, status) => {
		const response = await consultar(area, null, 'limited')
		expect(response.statusCode).toBe(status)
	})

	it('una lista blanca limitada consulta y adjunta, pero no edita planillas', async () => {
		const lectura = await consultar('operaciones', { recargos: 'limited' }, 'limited')
		expect(lectura.statusCode).toBe(200)
		const adjunto = await consultar('operaciones', { recargos: 'limited' }, 'limited', 'POST', '/api/recargos/uuid/planilla')
		expect(adjunto.statusCode).toBe(200)
		const edicion = await consultar('operaciones', { recargos: 'limited' }, 'full', 'POST')
		expect(edicion.statusCode).toBe(404)
	})

	it('una lista blanca oculta recargos aunque el área tenga acceso general', async () => {
		const response = await consultar('hseq', { servicios: 'read', flota: 'read' }, 'limited')
		expect(response.statusCode).toBe(404)
	})
})
