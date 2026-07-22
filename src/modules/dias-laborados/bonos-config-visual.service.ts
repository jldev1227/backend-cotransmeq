import { prisma } from '../../config/prisma'
import { GuardarBonoConfigVisualInput, ListarBonoConfigVisualInput } from './bonos-config-visual.schema'

/**
 * Servicio de Visibilidad de Bonos de Planilla
 *
 *  - Mantiene la tabla pivote `bono_config_visual` que indica qué
 *    `configuraciones_liquidacion` se exponen como columna en la pestaña
 *    de Recorridos.
 *  - Decisión global (toda la empresa) y por AÑO.
 *  - Default de visibilidad: `true` (se muestra salvo que se oculte
 *    explícitamente).
 */
export const BonoConfigVisualService = {
	// ─────────────────────────────────────────────
	// LISTAR configs activas del año con flag `visible` resuelto.
	// (no se devuelven configs inactivas: el modal solo expone
	//  lo que ya está activo en liquidacion).
	// ─────────────────────────────────────────────
	async listar(opts: ListarBonoConfigVisualInput) {
		const { anio } = opts

		const [configs, visuales] = await Promise.all([
			prisma.configuraciones_liquidacion.findMany({
				where: { anio, activo: true },
				orderBy: { nombre: 'asc' }
			}),
			prisma.bono_config_visual.findMany({ where: { anio } })
		])

		const visualMap = new Map(visuales.map((v) => [v.config_liquidacion_id, v.visible]))

		return configs.map((c) => ({
			id: c.id,
			nombre: c.nombre,
			valor: Number(c.valor),
			tipo: c.tipo,
			anio: c.anio,
			activo: c.activo,
			// Resolver: si hay registro, usar su flag; si no, default true
			visible: visualMap.has(c.id) ? visualMap.get(c.id) === true : true
		}))
	},

	// ─────────────────────────────────────────────
	// GUARDAR (reemplazar en bloque) la selección de visibilidad
	// para un año. Itera sobre TODAS las configs activas del año
	// y deja `visible` según pertenezca o no a la lista enviada.
	// ─────────────────────────────────────────────
	async guardar(input: GuardarBonoConfigVisualInput, creadoPorId: string) {
		const { anio, visibles } = input
		const visiblesSet = new Set(visibles)

		// Traer todas las configs activas del año
		const configs = await prisma.configuraciones_liquidacion.findMany({
			where: { anio, activo: true },
			select: { id: true }
		})

		// Diff: separar en crear/actualizar/eliminar
		// - Si la config está en `visibles` → upsert con visible=true
		// - Si no está en `visibles` → upsert con visible=false
		await prisma.$transaction(async (tx) => {
			for (const cfg of configs) {
				const debeEstar = visiblesSet.has(cfg.id)
				await tx.bono_config_visual.upsert({
					where: {
						config_liquidacion_id_anio: {
							config_liquidacion_id: cfg.id,
							anio
						}
					},
					create: {
						id: (await import('crypto')).randomUUID(),
						config_liquidacion_id: cfg.id,
						anio,
						visible: debeEstar,
						creado_por_id: creadoPorId
					},
					update: {
						visible: debeEstar,
						creado_por_id: creadoPorId,
						updated_at: new Date()
					}
				})
			}
		})

		// Re-leer para devolver el estado final
		return this.listar({ anio })
	}
}
