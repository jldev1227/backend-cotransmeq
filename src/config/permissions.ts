/**
 * Sistema de permisos por área
 * 
 * Áreas disponibles:
 * - administracion: Acceso total
 * - operaciones
 * - contabilidad
 * - facturacion
 * - talento_humano
 * - hseq
 * 
 * Niveles de acceso:
 * - full: CRUD completo
 * - read: Solo lectura/consulta
 * - limited: Acceso parcial (ej: solo registrar facturas)
 */

export type AccessLevel = 'full' | 'read' | 'limited'

export type Area = 'administracion' | 'operaciones' | 'contabilidad' | 'facturacion' | 'talento_humano' | 'hseq'

export interface RoutePermission {
  /** Áreas con acceso completo (CRUD) */
  full: Area[]
  /** Áreas con acceso solo lectura */
  read?: Area[]
  /** Áreas con acceso limitado (funcionalidad específica) */
  limited?: Area[]
  /** Si es true, cualquier usuario autenticado puede acceder */
  general?: boolean
  /** Descripción para documentación */
  description?: string
}

/**
 * Mapa de permisos por módulo/ruta
 * admin siempre tiene acceso total (se valida aparte)
 */
export const ROUTE_PERMISSIONS: Record<string, RoutePermission> = {
  perfil: {
    full: ['administracion', 'operaciones', 'contabilidad', 'facturacion', 'talento_humano', 'hseq'],
    general: true,
    description: 'Mi perfil'
  },

  flota: {
    full: ['administracion', 'operaciones', 'contabilidad', 'facturacion', 'talento_humano', 'hseq'],
    general: true,
    description: 'Gestión de flota vehicular'
  },

  conductores: {
    full: ['administracion', 'operaciones', 'contabilidad', 'facturacion', 'talento_humano', 'hseq'],
    general: true,
    description: 'Gestión de conductores'
  },

  servicios: {
    full: ['administracion', 'operaciones'],
    read: ['hseq', 'talento_humano', 'facturacion'],
    description: 'Gestión de servicios de transporte'
  },

  recargos: {
    full: ['administracion', 'operaciones'],
    read: ['hseq', 'facturacion', 'talento_humano'],
    description: 'Gestión de recargos/planillas'
  },

  clientes: {
    full: ['administracion', 'operaciones', 'contabilidad', 'facturacion', 'hseq'],
    general: true,
    description: 'Gestión de clientes/empresas'
  },

  asistencias: {
    full: ['administracion', 'hseq'],
    description: 'Formularios de asistencia'
  },

  'acciones-correctivas': {
    full: ['administracion', 'hseq'],
    description: 'Acciones correctivas y preventivas'
  },

  evaluaciones: {
    full: ['administracion', 'hseq'],
    description: 'Evaluaciones de conductores'
  },

  'salidas-nc': {
    full: ['administracion', 'operaciones', 'hseq'],
    description: 'Salidas no conformes'
  },

  nomina: {
    full: ['administracion', 'talento_humano', 'facturacion'],
    description: 'Gestión de nómina'
  },

  extractos: {
    full: ['administracion', 'operaciones'],
    description: 'Extractos de operaciones'
  },

  'liquidaciones-servicios': {
    full: ['administracion', 'operaciones'],
    limited: ['facturacion'], // Solo puede registrar facturas, no editar/anular liquidaciones
    description: 'Liquidaciones de servicios'
  },

  pesv: {
    full: ['administracion', 'operaciones', 'contabilidad', 'facturacion', 'talento_humano', 'hseq'],
    general: true,
    description: 'Plan Estratégico de Seguridad Vial'
  },

  contabilidad: {
    full: ['administracion', 'contabilidad'],
    description: 'Módulo de contabilidad'
  },

  terceros: {
    full: ['administracion', 'contabilidad', 'talento_humano', 'facturacion', 'operaciones'],
    description: 'Gestión de terceros'
  },

  usuarios: {
    full: ['administracion'],
    description: 'Gestión de usuarios del sistema'
  },

  sesiones: {
    full: ['administracion'],
    description: 'Visualización de sesiones de usuarios'
  }
}

/**
 * Verifica si un usuario tiene acceso a un módulo dado su role y area
 */
export function checkAccess(
  userRole: string | null | undefined,
  userAreas: Area[] | Area | null | undefined,
  moduleId: string
): { allowed: boolean; level: AccessLevel | null } {
  const permission = ROUTE_PERMISSIONS[moduleId]
  if (!permission) {
    return { allowed: false, level: null }
  }

  // Si es general, cualquier usuario autenticado tiene acceso
  if (permission.general) {
    return { allowed: true, level: 'full' }
  }

  // Normalize to array
  const areas: Area[] = !userAreas ? [] : Array.isArray(userAreas) ? userAreas : [userAreas]
  if (areas.length === 0) {
    return { allowed: false, level: null }
  }

  // Verificar acceso full — si alguna de las áreas del usuario tiene acceso full
  if (areas.some(a => permission.full.includes(a))) {
    return { allowed: true, level: 'full' }
  }

  // Verificar acceso read
  if (permission.read && areas.some(a => permission.read!.includes(a))) {
    return { allowed: true, level: 'read' }
  }

  // Verificar acceso limited
  if (permission.limited && areas.some(a => permission.limited!.includes(a))) {
    return { allowed: true, level: 'limited' }
  }

  return { allowed: false, level: null }
}

/**
 * Obtiene todos los módulos accesibles para un usuario
 */
export function getAccessibleModules(
  userRole: string | null | undefined,
  userAreas: Area[] | Area | null | undefined
): Record<string, AccessLevel> {
  const modules: Record<string, AccessLevel> = {}

  for (const [moduleId] of Object.entries(ROUTE_PERMISSIONS)) {
    const { allowed, level } = checkAccess(userRole, userAreas, moduleId)
    if (allowed && level) {
      modules[moduleId] = level
    }
  }

  return modules
}
