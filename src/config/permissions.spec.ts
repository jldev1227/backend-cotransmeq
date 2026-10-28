import { describe, expect, it } from 'vitest'
import { AREAS, ROUTE_PERMISSIONS, checkAccess, getAccessibleModules, normalizarRutasOverride } from './permissions'
import { estadoDenegacionPermisos, nivelSuficiente } from '../middlewares/permissions.middleware'

describe('permisos por área y lista blanca personal', () => {
	it('restringe recargos a administración, operaciones y talento humano', () => {
		expect(checkAccess('usuario', 'administracion', 'recargos').level).toBe('full')
		expect(checkAccess('usuario', 'operaciones', 'recargos').level).toBe('full')
		expect(checkAccess('usuario', 'talento_humano', 'recargos').level).toBe('read')
		for (const area of AREAS.filter((a) => !['administracion', 'operaciones', 'talento_humano'].includes(a))) {
			expect(checkAccess('usuario', area, 'recargos'), `área ${area}`).toEqual({ allowed: false, level: null })
		}
	})

	it('la lista blanca sustituye los permisos del área, incluso los módulos generales', () => {
		const personalizado = { servicios: 'read', flota: 'read', conductores: 'read' } as const
		const accesibles = getAccessibleModules('usuario', 'hseq', personalizado)
		expect(accesibles).toEqual({ servicios: 'read', flota: 'read', conductores: 'read', perfil: 'full' })
		for (const moduleId of Object.keys(ROUTE_PERMISSIONS)) {
			if (moduleId === 'servicios' || moduleId === 'flota' || moduleId === 'conductores' || moduleId === 'perfil') continue
			expect(checkAccess('usuario', 'hseq', moduleId, personalizado).allowed, moduleId).toBe(false)
		}
	})

	it('el rol admin conserva acceso total; usuarios con varias áreas obtienen el nivel más alto', () => {
		expect(checkAccess('admin', [], 'recargos', { servicios: 'read' })).toEqual({
			allowed: true,
			level: 'full'
		})
		expect(checkAccess('usuario', ['talento_humano', 'operaciones'], 'recargos')).toEqual({
			allowed: true,
			level: 'full'
		})
	})

	it('permite consulta más adjuntos para una persona, sin conceder edición', () => {
		const permisos = normalizarRutasOverride({ recargos: 'limited' })
		expect(checkAccess('usuario', 'operaciones', 'recargos', permisos)).toEqual({ allowed: true, level: 'limited' })
		expect(nivelSuficiente('limited', 'limited')).toBe(true)
		expect(nivelSuficiente('limited', 'full')).toBe(false)
		expect(nivelSuficiente('read', 'limited')).toBe(true)
	})

	it('descarta niveles limitados no declarados por el módulo', () => {
		expect(normalizarRutasOverride({ servicios: 'limited', recargos: 'limited' })).toEqual({ recargos: 'limited' })
	})

	it('oculta con 404 los módulos excluidos de la lista blanca individual', () => {
		expect(estadoDenegacionPermisos({ servicios: 'read' })).toBe(404)
		expect(estadoDenegacionPermisos(null)).toBe(403)
	})
})
