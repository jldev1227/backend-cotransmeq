import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '../../config/prisma'
import { RecargosService } from './recargos.service'

describe('reutilización del número de planilla', () => {
	const sufijo = randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()
	const clienteId = randomUUID()
	const vehiculoId = randomUUID()
	const conductorAId = randomUUID()
	const conductorBId = randomUUID()
	const planillaIds: string[] = []

	afterAll(async () => {
		if (planillaIds.length) {
			await prisma.dias_laborales_planillas.deleteMany({
				where: { recargo_planilla_id: { in: planillaIds } },
			})
			await prisma.recargos_planillas.deleteMany({ where: { id: { in: planillaIds } } })
		}
		await prisma.conductores.deleteMany({ where: { id: { in: [conductorAId, conductorBId] } } })
		await prisma.vehiculos.deleteMany({ where: { id: vehiculoId } })
		await prisma.clientes.deleteMany({ where: { id: clienteId } })
	})

	it('permite reutilizarlo entre conductores/períodos y bloquea el duplicado activo exacto', async () => {
		const now = new Date()
		await prisma.clientes.create({ data: { id: clienteId, nombre: `Cliente test ${sufijo}` } })
		await prisma.vehiculos.create({
			data: {
				id: vehiculoId,
				placa: `RX${sufijo}`,
				clase_vehiculo: 'PRUEBA',
				created_at: now,
				updated_at: now,
			},
		})
		await prisma.conductores.createMany({
			data: [
				{
					id: conductorAId,
					nombre: `Conductor ${sufijo}`,
					apellido: 'A',
					tipo_identificacion: 'CC',
					created_at: now,
					updated_at: now,
				},
				{
					id: conductorBId,
					nombre: `Conductor ${sufijo}`,
					apellido: 'B',
					tipo_identificacion: 'CC',
					created_at: now,
					updated_at: now,
				},
			],
		})

		const numero = `DUP-${sufijo}`
		const crear = async (conductorId: string, mes: number) => {
			const recargo = await RecargosService.create({
				conductor_id: conductorId,
				vehiculo_id: vehiculoId,
				empresa_id: clienteId,
				numero_planilla: numero,
				mes,
				año: 2026,
				dias_laborales: [],
			} as any)
			planillaIds.push(recargo.id)
			return recargo
		}

		const original = await crear(conductorAId, 10)
		await expect(crear(conductorAId, 10)).rejects.toThrow('Ya existe la planilla')
		const otroPeriodo = await crear(conductorAId, 11)
		const otroConductor = await crear(conductorBId, 10)

		await prisma.recargos_planillas.update({
			where: { id: original.id },
			data: { deleted_at: new Date() },
		})
		const reutilizadaTrasEliminar = await crear(conductorAId, 10)

		expect(otroPeriodo.id).not.toBe(original.id)
		expect(otroConductor.id).not.toBe(original.id)
		expect(reutilizadaTrasEliminar.id).not.toBe(original.id)
	})
})
