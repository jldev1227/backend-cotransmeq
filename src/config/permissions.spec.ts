import { describe, expect, it } from 'vitest'
import { AREAS, OMAR_OPERACIONES_ID, ROUTE_PERMISSIONS, checkAccess, getAccessibleModules, normalizarRutasOverride } from './permissions'
import { estadoDenegacionPermisos, nivelSuficiente } from '../middlewares/permissions.middleware'

describe('permisos por área y lista blanca personal', () => {
	it('restringe recargos a administración, operaciones y talento humano', () => {
		expect(checkAccess('administracion', 'recargos').level).toBe('full')
		expect(checkAccess('operaciones', 'recargos').level).toBe('full')
		expect(checkAccess('talento_humano', 'recargos').level).toBe('read')
		for (const area of AREAS.filter((a) => !['administracion', 'operaciones', 'talento_humano'].includes(a))) {
			expect(checkAccess(area, 'recargos'), `área ${area}`).toEqual({ allowed: false, level: null })
		}
	})

	it('Operaciones puede recibir edición individual en Recorridos', () => {
		expect(checkAccess('administracion', 'recorridos')).toEqual({ allowed: true, level: 'full' })
		expect(checkAccess('operaciones', 'recorridos')).toEqual({ allowed: true, level: 'read' })
		expect(checkAccess('operaciones', 'recorridos', { recorridos: 'full' })).toEqual({
			allowed: true,
			level: 'full'
		})
		expect(checkAccess('operaciones', 'recorridos', {})).toEqual({ allowed: false, level: null })
	})

	it('Sección 06 permite asignar edición individual a usuarios de Operaciones', () => {
		const modulo = 'liquidaciones-servicios-seccion06'
		expect(checkAccess('administracion', modulo)).toEqual({ allowed: true, level: 'full' })
		expect(checkAccess('operaciones', modulo, null, OMAR_OPERACIONES_ID)).toEqual({ allowed: true, level: 'full' })
		expect(checkAccess('operaciones', modulo)).toEqual({ allowed: true, level: 'read' })
		expect(checkAccess('operaciones', modulo, { [modulo]: 'full' }, 'otro-usuario')).toEqual({
			allowed: true,
			level: 'full'
		})
		expect(checkAccess('facturacion', modulo)).toEqual({ allowed: true, level: 'read' })
		expect(checkAccess('contabilidad', modulo)).toEqual({ allowed: false, level: null })
		expect(checkAccess('operaciones', modulo, { [modulo]: 'read' }, OMAR_OPERACIONES_ID)).toEqual({
			allowed: true,
			level: 'read'
		})
		expect(checkAccess('contabilidad', modulo, null, OMAR_OPERACIONES_ID)).toEqual({ allowed: false, level: null })
	})

	it('la lista personalizada recorta los permisos del área y conserva sus niveles', () => {
		const personalizado = { servicios: 'read', flota: 'read', conductores: 'read' } as const
		const accesibles = getAccessibleModules('hseq', personalizado)
		expect(accesibles).toEqual({ servicios: 'read', flota: 'read', conductores: 'read', perfil: 'full' })
		for (const moduleId of Object.keys(ROUTE_PERMISSIONS)) {
			if (moduleId === 'servicios' || moduleId === 'flota' || moduleId === 'conductores' || moduleId === 'perfil') continue
			expect(checkAccess('hseq', moduleId, personalizado).allowed, moduleId).toBe(false)
		}
	})

	it('sin área no hay acceso; prevalece el nivel más alto de las áreas asignadas', () => {
		expect(checkAccess([], 'recargos', { servicios: 'read' })).toEqual({ allowed: false, level: null })
		expect(checkAccess(['talento_humano', 'operaciones'], 'recargos')).toEqual({
			allowed: true,
			level: 'full'
		})
	})

	it('un nivel personalizado no puede elevar el nivel máximo del área', () => {
		expect(checkAccess('talento_humano', 'recargos', { recargos: 'full' })).toEqual({
			allowed: true,
			level: 'read'
		})
		expect(checkAccess('hseq', 'recargos', { recargos: 'full' })).toEqual({ allowed: false, level: null })
	})

	it('un objeto vacío persistido deja solo el acceso al perfil', () => {
		expect(normalizarRutasOverride({})).toEqual({})
		expect(getAccessibleModules('administracion', {})).toEqual({ perfil: 'full' })
	})

	it('permite consulta más adjuntos para una persona, sin conceder edición', () => {
		const permisos = normalizarRutasOverride({ recargos: 'limited' })
		expect(checkAccess('operaciones', 'recargos', permisos)).toEqual({ allowed: true, level: 'limited' })
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
