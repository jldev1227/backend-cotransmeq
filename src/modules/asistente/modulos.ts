import { ROUTE_PERMISSIONS } from '../../config/permissions'

/**
 * Pantallas del panel tal como las ve el usuario.
 *
 * Espejo de `ingreso-svelte/src/lib/config/menu.ts` (etiqueta y ruta de
 * entrada de cada módulo). El asistente lo usa para dos cosas: contarle al
 * modelo qué pantallas existen y a cuáles entra este usuario, y validar la ruta
 * de `ir_a` antes de mandar al navegador a ningún sitio. La descripción sale de
 * `ROUTE_PERMISSIONS`, que ya la tiene.
 *
 * Si se añade una entrada al menú del frontend hay que añadirla aquí; si no,
 * el asistente dirá que esa pantalla no existe.
 */
export interface ModuloApp {
  id: string
  etiqueta: string
  ruta: string
  /** Palabras con las que la gente lo nombra, para resolver «llévame a nómina». */
  alias?: string[]
}

export const MODULOS_APP: readonly ModuloApp[] = [
  { id: 'dashboard', etiqueta: 'Inicio', ruta: '/dashboard', alias: ['panel', 'dashboard', 'inicio', 'resumen'] },
  { id: 'actividad', etiqueta: 'Actividad reciente', ruta: '/dashboard/actividad', alias: ['historial', 'bitácora', 'bitacora', 'auditoría', 'auditoria', 'qué hizo'] },
  { id: 'flota', etiqueta: 'Flota', ruta: '/dashboard/flota', alias: ['vehículos', 'vehiculos', 'carros', 'placas'] },
  { id: 'conductores', etiqueta: 'Conductores', ruta: '/dashboard/conductores', alias: ['choferes'] },
  { id: 'servicios', etiqueta: 'Servicios', ruta: '/dashboard/servicios', alias: ['viajes', 'despachos'] },
  { id: 'recargos', etiqueta: 'Recargos', ruta: '/dashboard/recargos', alias: ['planillas'] },
  { id: 'clientes', etiqueta: 'Clientes', ruta: '/dashboard/clientes', alias: ['empresas'] },
  { id: 'sarlaft', etiqueta: 'SARLAFT / PTEE', ruta: '/dashboard/sarlaft', alias: ['ptee', 'cumplimiento'] },
  { id: 'asistencias', etiqueta: 'Asistencias', ruta: '/dashboard/asistencias' },
  {
    id: 'acciones-correctivas',
    etiqueta: 'Acciones C/P',
    ruta: '/dashboard/acciones-correctivas',
    alias: ['acciones correctivas', 'acciones preventivas', 'hallazgos'],
  },
  { id: 'evaluaciones', etiqueta: 'Evaluaciones', ruta: '/dashboard/evaluaciones' },
  { id: 'salidas-nc', etiqueta: 'Salidas NC', ruta: '/dashboard/salidas-nc', alias: ['salidas no conformes', 'no conformidades'] },
  { id: 'viaticos', etiqueta: 'Viáticos', ruta: '/dashboard/viaticos', alias: ['viaticos', 'anticipos de viáticos', 'gastos de conductores'] },
  { id: 'extractos', etiqueta: 'Extractos', ruta: '/dashboard/extractos', alias: ['extractos de contrato', 'fuec', 'extracto'] },
  { id: 'formularios', etiqueta: 'Formularios', ruta: '/dashboard/formularios', alias: ['constructor de formularios'] },
  { id: 'mis-formularios', etiqueta: 'Mis formularios', ruta: '/dashboard/mis-formularios' },
  { id: 'nomina', etiqueta: 'Nómina', ruta: '/dashboard/nomina/canvas', alias: ['nomina', 'desprendibles'] },
  {
    id: 'liquidaciones-servicios',
    etiqueta: 'Liq. Servicios',
    ruta: '/dashboard/liquidaciones-servicios',
    alias: ['liquidaciones de servicios', 'facturación de servicios'],
  },
  {
    id: 'liquidaciones-terceros',
    etiqueta: 'Liq. Terceros',
    ruta: '/dashboard/liquidaciones-terceros',
    alias: ['liquidaciones de terceros', 'propietarios', 'cierres'],
  },
  { id: 'certificados', etiqueta: 'Certificados', ruta: '/dashboard/certificados', alias: ['certificados tributarios', 'retenciones'] },
  { id: 'terceros', etiqueta: 'Terceros', ruta: '/dashboard/terceros' },
  { id: 'usuarios', etiqueta: 'Equipo', ruta: '/dashboard/usuarios', alias: ['usuarios', 'sesiones', 'directorio'] },
  { id: 'perfil', etiqueta: 'Mi perfil', ruta: '/dashboard/perfil', alias: ['perfil', 'mi cuenta', 'contraseña'] },
]

export function descripcionModulo(id: string): string {
  return ROUTE_PERMISSIONS[id]?.description ?? ''
}

export function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

/** Encuentra el módulo al que se refiere un texto libre («nómina», «liq terceros»). */
export function buscarModulo(texto: string): ModuloApp | undefined {
  const q = normalizar(texto)
  if (!q) return undefined
  return (
    MODULOS_APP.find((m) => m.id === q || normalizar(m.etiqueta) === q) ??
    MODULOS_APP.find((m) => m.alias?.some((a) => normalizar(a) === q)) ??
    MODULOS_APP.find(
      (m) =>
        normalizar(m.etiqueta).includes(q) ||
        q.includes(normalizar(m.etiqueta)) ||
        m.alias?.some((a) => normalizar(a).includes(q) || q.includes(normalizar(a))),
    )
  )
}

/** Módulo dueño de una ruta interna, por el prefijo más largo que coincida. */
export function moduloDeRuta(ruta: string): ModuloApp | undefined {
  const sinQuery = ruta.split('?')[0]
  return [...MODULOS_APP]
    .sort((a, b) => b.ruta.length - a.ruta.length)
    .find((m) => {
      // «Nómina» entra por su canvas, pero sus otras pantallas cuelgan de /dashboard/nomina.
      const base = m.ruta.replace(/\/canvas$/, '')
      return sinQuery === m.ruta || sinQuery === base || sinQuery.startsWith(`${base}/`)
    })
}
