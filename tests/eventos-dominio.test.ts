/**
 * Los eventos de Servicios, Flota y Clientes llegan al cliente con el nombre y
 * la forma que el frontend ya espera.
 *
 * Estos tres módulos no emitían nada útil: el frontend llevaba los listeners
 * montados y el backend no mandaba esos eventos, o mandaba otros con nombre
 * distinto. La consecuencia era que crear o editar no le llegaba a nadie más y
 * la lista solo se actualizaba al recargar.
 *
 * Aquí se comprueba el contrato del que depende cada consumidor, que NO es
 * uniforme y por eso conviene fijarlo:
 *
 *   - `servicio:eliminado` manda solo `{ id }` — ya no hay entidad
 *   - `servicio:estado-actualizado` manda `{ servicio, estadoAnterior }`
 *   - `servicio:numero-planilla-actualizado` manda `{ id, servicio }`
 *   - el resto manda la entidad tal cual
 *
 * Un consumidor que espere la entidad en todos se rompe en los tres primeros,
 * que es exactamente el tipo de fallo que este archivo evita.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Socket } from 'socket.io-client'

vi.mock('pdfmake/build/pdfmake', () => ({ default: {}, createPdf: () => ({}) }))
vi.mock('pdfmake/build/vfs_fonts', () => ({ default: { vfs: {} }, vfs: {} }))

import { abrirBanco, esperarEvento, type Banco } from './helpers/canvas-servicios'
import { cerrarPrisma, limpiarUsuariosSembrados, sembrarUsuario } from './helpers/usuarios-prueba'
import {
	emitServicioActualizado,
	emitServicioCancelado,
	emitServicioCreado,
	emitServicioEliminado,
	emitServicioEstadoActualizado,
	emitServicioNumeroPlanillaActualizado
} from '../src/modules/servicios/servicios.events'
import {
	emitVehiculoActualizado,
	emitVehiculoCreado,
	emitVehiculoEliminado
} from '../src/modules/vehiculos/vehiculos.events'
import {
	emitClienteActualizado,
	emitClienteCreado,
	emitClienteEliminado
} from '../src/modules/clientes/clientes.events'

let banco: Banco
let socket: Socket

const SERVICIO = { id: 'srv-1', numero_planilla: 'P-1', estado: 'en_curso' }
const VEHICULO = { id: 'veh-1', placa: 'ABC123' }
const CLIENTE = { id: 'cli-1', nombre: 'Cliente de prueba' }

beforeAll(async () => {
	await limpiarUsuariosSembrados()
	const usuario = await sembrarUsuario('eventos')
	banco = await abrirBanco()
	socket = await banco.conectar(usuario as any)
}, 30_000)

afterAll(async () => {
	await banco?.cerrar()
	await limpiarUsuariosSembrados()
	await cerrarPrisma()
})

/** Emite y espera; falla con un mensaje útil si el evento no llega. */
async function llega<T>(evento: string, emitir: () => void): Promise<T> {
	const promesa = esperarEvento<T>(socket, evento, () => true, 4000)
	emitir()
	return promesa
}

describe('Eventos de dominio — Servicios', () => {
	it('servicio:creado manda la entidad', async () => {
		const d = await llega<any>('servicio:creado', () => emitServicioCreado(SERVICIO))
		expect(d).toMatchObject({ id: 'srv-1' })
	})

	it('servicio:actualizado manda la entidad', async () => {
		const d = await llega<any>('servicio:actualizado', () => emitServicioActualizado(SERVICIO))
		expect(d).toMatchObject({ id: 'srv-1' })
	})

	it('servicio:estado-actualizado manda { servicio, estadoAnterior }', async () => {
		const d = await llega<any>('servicio:estado-actualizado', () =>
			emitServicioEstadoActualizado(SERVICIO, 'solicitado')
		)
		// El store lee `data.servicio.id`; si viniera la entidad plana, el
		// parche por id no encontraría nada y la fila no se actualizaría.
		expect(d.servicio).toMatchObject({ id: 'srv-1' })
		expect(d.estadoAnterior).toBe('solicitado')
	})

	it('servicio:numero-planilla-actualizado manda { id, servicio }', async () => {
		const d = await llega<any>('servicio:numero-planilla-actualizado', () =>
			emitServicioNumeroPlanillaActualizado('srv-1', SERVICIO)
		)
		expect(d.id).toBe('srv-1')
		expect(d.servicio).toMatchObject({ numero_planilla: 'P-1' })
	})

	it('servicio:cancelado manda la entidad', async () => {
		const d = await llega<any>('servicio:cancelado', () => emitServicioCancelado(SERVICIO))
		expect(d).toMatchObject({ id: 'srv-1' })
	})

	it('servicio:eliminado manda SOLO el id', async () => {
		const d = await llega<any>('servicio:eliminado', () => emitServicioEliminado('srv-1'))
		expect(d).toEqual({ id: 'srv-1' })
	})
})

describe('Eventos de dominio — Flota', () => {
	it('vehiculo-creado / -actualizado / -eliminado llegan con esos nombres', async () => {
		// Los nombres van con guion, no con dos puntos: es lo que escucha
		// `/dashboard/flota`. Cambiarlos dejaría la página muda otra vez.
		expect(await llega<any>('vehiculo-creado', () => emitVehiculoCreado(VEHICULO))).toMatchObject({
			placa: 'ABC123'
		})
		expect(
			await llega<any>('vehiculo-actualizado', () => emitVehiculoActualizado(VEHICULO))
		).toMatchObject({ id: 'veh-1' })
		expect(await llega<any>('vehiculo-eliminado', () => emitVehiculoEliminado('veh-1'))).toEqual({
			id: 'veh-1'
		})
	})
})

describe('Eventos de dominio — Clientes', () => {
	it('cliente:created / :updated / :deleted llegan con esos nombres', async () => {
		// En inglés, a diferencia de los de servicios. También es lo que la
		// página ya escucha.
		expect(await llega<any>('cliente:created', () => emitClienteCreado(CLIENTE))).toMatchObject({
			id: 'cli-1'
		})
		expect(
			await llega<any>('cliente:updated', () => emitClienteActualizado(CLIENTE))
		).toMatchObject({ nombre: 'Cliente de prueba' })
		expect(await llega<any>('cliente:deleted', () => emitClienteEliminado('cli-1'))).toEqual({
			id: 'cli-1'
		})
	})
})
