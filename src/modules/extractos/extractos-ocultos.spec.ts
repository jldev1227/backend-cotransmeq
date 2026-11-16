import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '../../config/prisma'
import { opcionesFormulario } from './extractos.service'

describe('opciones del extracto de contrato', () => {
	const sufijo = randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()
	const vehiculoOcultoId = randomUUID()
	const vehiculoBorradoId = randomUUID()
	const conductorOcultoId = randomUUID()
	const conductorBorradoId = randomUUID()

	afterAll(async () => {
		await prisma.vehiculos.deleteMany({ where: { id: { in: [vehiculoOcultoId, vehiculoBorradoId] } } })
		await prisma.conductores.deleteMany({ where: { id: { in: [conductorOcultoId, conductorBorradoId] } } })
	})

	it('incluye fichas ocultas y deja fuera las que están en papelera', async () => {
		const now = new Date()
		await prisma.vehiculos.createMany({
			data: [
				{
					id: vehiculoOcultoId,
					placa: `ZX${sufijo}`,
					clase_vehiculo: 'PRUEBA',
					created_at: now,
					updated_at: now,
					oculto: true,
				},
				{
					id: vehiculoBorradoId,
					placa: `ZY${sufijo}`,
					clase_vehiculo: 'PRUEBA',
					created_at: now,
					updated_at: now,
					oculto: true,
					deleted_at: now,
				},
			],
		})
		await prisma.conductores.createMany({
			data: [
				{
					id: conductorOcultoId,
					nombre: `Conductor ${sufijo}`,
					apellido: 'Oculto',
					tipo_identificacion: 'CC',
					created_at: now,
					updated_at: now,
					oculto: true,
				},
				{
					id: conductorBorradoId,
					nombre: `Conductor ${sufijo}`,
					apellido: 'Papelera',
					tipo_identificacion: 'CC',
					created_at: now,
					updated_at: now,
					oculto: true,
					deleted_at: now,
				},
			],
		})

		try {
			const opciones = await opcionesFormulario()
			expect(opciones.vehiculos.map((vehiculo) => vehiculo.id)).toContain(vehiculoOcultoId)
			expect(opciones.conductores.map((conductor) => conductor.id)).toContain(conductorOcultoId)
			expect(opciones.vehiculos.map((vehiculo) => vehiculo.id)).not.toContain(vehiculoBorradoId)
			expect(opciones.conductores.map((conductor) => conductor.id)).not.toContain(conductorBorradoId)
		} finally {
			await prisma.vehiculos.deleteMany({ where: { id: { in: [vehiculoOcultoId, vehiculoBorradoId] } } })
			await prisma.conductores.deleteMany({ where: { id: { in: [conductorOcultoId, conductorBorradoId] } } })
		}
	})
})
