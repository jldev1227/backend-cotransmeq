/**
 * Secciones del panel de inicio y a quién le tocan.
 *
 * Dos filtros, los dos obligatorios:
 *  - `areas`: para quién está pensada la sección. El rol admin las ve todas.
 *  - `modulos`: de dónde salen sus datos. Si el usuario no puede ver alguno
 *    (por área o por su lista blanca `permisos_rutas`), la sección no se
 *    construye, aunque su área coincida: el panel no puede ser una puerta
 *    trasera a datos que la pantalla del módulo le niega.
 *
 * Dentro de cada sección, los widgets que leen de OTRO módulo (por ejemplo
 * «liquidaciones pendientes» dentro de Operaciones) se omiten uno a uno con
 * el mismo criterio; ver cada `seccion-*.ts`.
 */
import type { AccessLevel, Area } from '../../config/permissions'

export type IdSeccion = 'operaciones' | 'hseq' | 'mantenimiento' | 'talento_humano' | 'facturacion' | 'contabilidad'

export interface Seccion {
  id: IdSeccion
  titulo: string
  descripcion: string
  areas: Area[]
  modulos: string[]
}

export const SECCIONES: readonly Seccion[] = [
  {
    id: 'operaciones',
    titulo: 'Operaciones',
    descripcion: 'Servicios, conductores y placas en servicio, clientes y pendientes de cierre.',
    areas: ['operaciones', 'administracion'],
    modulos: ['servicios'],
  },
  {
    id: 'hseq',
    titulo: 'HSEQ',
    descripcion: 'Preoperacionales, descansos 21-9, fatiga y conductores en servicio.',
    areas: ['hseq', 'administracion'],
    modulos: ['formularios', 'conductores'],
  },
  {
    id: 'mantenimiento',
    titulo: 'Mantenimiento',
    descripcion: 'Novedades de los preoperacionales, mantenimientos, kilometraje y vencimientos.',
    areas: ['mantenimiento', 'administracion'],
    modulos: ['flota', 'formularios'],
  },
  {
    id: 'talento_humano',
    titulo: 'Talento humano',
    descripcion: 'Vinculados, datos pendientes, licencias, nómina y control de fatiga.',
    areas: ['talento_humano', 'administracion'],
    modulos: ['conductores'],
  },
  {
    id: 'facturacion',
    titulo: 'Facturación',
    descripcion: 'Liquidaciones por facturar, facturado por cliente, tercero y placa.',
    areas: ['facturacion', 'administracion'],
    modulos: ['liquidaciones-servicios'],
  },
  {
    id: 'contabilidad',
    titulo: 'Contabilidad',
    descripcion: 'Liquidaciones de terceros mes a mes, pagos previstos y terceros con datos incompletos.',
    areas: ['contabilidad', 'administracion'],
    modulos: ['terceros'],
  },
]

export interface UsuarioPanel {
  id: string
  role?: string | null
  area?: string[] | string | null
}

export function areasDe(user: UsuarioPanel): Area[] {
  const a = user.area
  return (Array.isArray(a) ? a : a ? [a] : []) as Area[]
}

export function seccionesVisibles(user: UsuarioPanel, modulos: Record<string, AccessLevel>): Seccion[] {
  const admin = user.role === 'admin'
  const areas = areasDe(user)
  return SECCIONES.filter((s) => {
    const porArea = admin || s.areas.some((a) => areas.includes(a))
    const porModulo = s.modulos.every((m) => Boolean(modulos[m]))
    return porArea && porModulo
  })
}
