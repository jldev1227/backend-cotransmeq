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
 * - mantenimiento
 *
 * Niveles de acceso:
 * - full: CRUD completo
 * - read: Solo lectura/consulta
 * - limited: Acceso parcial (ej: solo registrar facturas)
 */

export type AccessLevel = 'full' | 'read' | 'limited'

export type Area =
  | 'administracion'
  | 'operaciones'
  | 'contabilidad'
  | 'facturacion'
  | 'talento_humano'
  | 'hseq'
  | 'mantenimiento'

/**
 * Lista canónica de áreas. Existe para que los esquemas zod y los formularios
 * no repitan el literal en seis sitios: cuando se añadió `mantenimiento` había
 * ya cuatro copias del array (`usuarios.schema.ts`, `invitaciones.schema.ts`,
 * el mapa de etiquetas del correo y el frontend) y las tres primeras se
 * olvidaron, así que el alta rechazaba con 400 un área que el tipo sí admitía.
 */
export const AREAS: readonly Area[] = [
  'administracion',
  'operaciones',
  'contabilidad',
  'facturacion',
  'talento_humano',
  'hseq',
  'mantenimiento',
]

/** Etiquetas legibles de cada área (correos, UI, mensajes de error). */
export const AREA_LABELS: Record<Area, string> = {
  administracion: 'Administración',
  operaciones: 'Operaciones',
  contabilidad: 'Contabilidad',
  facturacion: 'Facturación',
  talento_humano: 'Talento Humano',
  hseq: 'HSEQ',
  mantenimiento: 'Mantenimiento',
}

/** `true` si el string es un área conocida. Útil para validar entrada cruda. */
export function esAreaValida(valor: unknown): valor is Area {
  return typeof valor === 'string' && (AREAS as readonly string[]).includes(valor)
}

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
    full: ['administracion', 'operaciones', 'contabilidad', 'facturacion', 'talento_humano', 'hseq', 'mantenimiento'],
    general: true,
    description: 'Mi perfil'
  },

  flota: {
    full: ['administracion', 'operaciones', 'contabilidad', 'facturacion', 'talento_humano', 'hseq', 'mantenimiento'],
    general: true,
    description: 'Gestión de flota vehicular'
  },

  conductores: {
    full: ['administracion', 'operaciones', 'contabilidad', 'facturacion', 'talento_humano', 'hseq', 'mantenimiento'],
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
    full: ['administracion', 'operaciones', 'contabilidad', 'facturacion', 'hseq', 'mantenimiento'],
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

  // Módulo propio y no reutilizado: los envíos incluyen datos de salud, fatiga
  // y firmas de los conductores, así que el acceso tiene que poder concederse y
  // revocarse por separado de cualquier otro módulo.
  //
  // `operaciones` solo lee: consulta preoperacionales del día para despachar,
  // pero no debe poder publicar ni cambiar un formulario de HSEQ.
  //
  // Espejo EXACTO de `ingreso-svelte/src/lib/config/permissions.ts`. Si aquí y
  // allí no coinciden, el sidebar muestra una entrada que la API rechaza con
  // 403 (o al contrario, oculta algo a quien sí puede usarlo).
  formularios: {
    full: ['administracion', 'hseq'],
    read: ['operaciones'],
    description: 'Formularios dinámicos (constructor, asignaciones y envíos)'
  },

  /**
   * Diligenciar lo que a uno le asignaron.
   *
   * Módulo APARTE de `formularios` y `general: true` a propósito. `formularios`
   * es el constructor: publicar una versión o cambiar una asignación afecta a
   * cientos de personas y por eso solo lo tienen `administracion` y `hseq`.
   * Rellenar un formato que alguien te asignó no tiene nada de eso, y si
   * dependiera del mismo permiso, a un usuario de contabilidad al que HSEQ le
   * asigna una inspección no le aparecería la pantalla —ni siquiera podría
   * abrirla, porque el guard resuelve el módulo por el primer segmento de la
   * ruta—.
   *
   * El acceso a UNA asignación concreta no lo da este permiso: lo dan los
   * targets de la asignación, resueltos en `condicionAcceso`. Esto solo abre la
   * puerta de la pantalla.
   */
  'mis-formularios': {
    full: ['administracion', 'operaciones', 'contabilidad', 'facturacion', 'talento_humano', 'hseq', 'mantenimiento'],
    general: true,
    description: 'Diligenciar los formularios asignados a mí'
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

  // Espejo EXACTO de `ingreso-svelte/src/lib/config/permissions.ts`.
  // Faltaban en el backend, así que `requirePermission('liquidaciones-terceros')`
  // habría devuelto 403 a todo el mundo: `checkAccess` deniega cualquier
  // moduleId ausente de este mapa.
  'liquidaciones-terceros': {
    full: ['administracion', 'operaciones'],
    limited: ['facturacion', 'contabilidad'],
    description: 'Liquidaciones de terceros (propietarios)'
  },
  'liquidaciones-terceros-adicionales': {
    full: ['administracion', 'operaciones'],
    limited: ['facturacion', 'contabilidad'],
    description: 'Adicionales (unificados) de cierres finales de terceros'
  },

  // El módulo dejó de ser un panel de conteos y pasó a ser el expediente de
  // cumplimiento: aprueba evidencia, declara pasos cumplidos y configura metas.
  // Por eso deja de ser `general: true` y se gradúa por área.
  //
  //  - `full`   HSEQ y Administración: además son los ÚNICOS que pueden
  //             aprobar o rechazar evidencia. Esa restricción NO la da este
  //             mapa —`full` no basta—, la aplica `puedeRevisar()` en el
  //             servicio, porque es una regla de negocio y no de módulo.
  //  - `limited` Operaciones, Mantenimiento y Talento Humano: aportan evidencia
  //             donde el requisito les fue asignado y registran su operación.
  //             No aprueban, ni siquiera lo suyo.
  //  - `read`   Contabilidad y Facturación: consultan.
  //
  // Espejo EXACTO de `ingreso-svelte/src/lib/config/permissions.ts`. Si aquí y
  // allí no coinciden, el sidebar muestra una entrada que la API rechaza con
  // 403, o al revés.
  pesv: {
    full: ['administracion', 'hseq'],
    limited: ['operaciones', 'mantenimiento', 'talento_humano'],
    read: ['contabilidad', 'facturacion'],
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
 * Permisos por ruta asignados a UN usuario concreto (`users.permisos_rutas`).
 * Las claves son moduleId de `ROUTE_PERMISSIONS`; el valor, el nivel exacto.
 */
export type RutasOverride = Record<string, AccessLevel>

/** Módulo que nunca se puede quitar: sin él el usuario no puede ni ver su ficha. */
const MODULO_SIEMPRE_ACCESIBLE = 'perfil'

const NIVELES_VALIDOS: readonly AccessLevel[] = ['full', 'read', 'limited']

/**
 * Normaliza `permisos_rutas` tal como viene de la BD (JSONB, sin garantías de
 * forma). Descarta claves que no son módulos conocidos y niveles que no son
 * `full|read|limited`: un JSON escrito a mano con `"formularios": true` no debe
 * conceder nada, pero tampoco tumbar la petición con una excepción.
 *
 * Devuelve `null` si no queda ninguna clave utilizable, que es exactamente el
 * caso «no hay lista blanca, aplica las reglas por área».
 */
export function normalizarRutasOverride(valor: unknown): RutasOverride | null {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return null

  const limpio: RutasOverride = {}
  for (const [moduleId, nivel] of Object.entries(valor as Record<string, unknown>)) {
    if (!ROUTE_PERMISSIONS[moduleId]) continue
    if (!NIVELES_VALIDOS.includes(nivel as AccessLevel)) continue
    limpio[moduleId] = nivel as AccessLevel
  }

  return Object.keys(limpio).length > 0 ? limpio : null
}

/**
 * Verifica si un usuario tiene acceso a un módulo dado su role y area.
 *
 * @param rutasOverride Lista blanca por usuario (`users.permisos_rutas`).
 *
 * Semántica del override — esto es lo importante:
 *
 *  - `null`, `undefined` o `{}` → NO hay override. Se aplican las reglas por
 *    área de siempre, tal cual estaban antes de existir esta columna.
 *
 *  - Con ≥1 clave → **sustituye por completo** a las reglas por área. No suma
 *    ni resta sobre ellas: sólo los módulos listados son accesibles, y con
 *    exactamente el nivel que diga el valor. Un usuario de `administracion`
 *    con `{"flota":"read"}` pierde todo lo demás y sobre flota sólo lee.
 *    Se hizo así a propósito: la alternativa (mezclar área + override) obliga
 *    a razonar sobre dos fuentes a la vez para responder «¿por qué ve esto?»,
 *    y era justo lo que se quería quitar de encima.
 *
 *  - Excepciones a la lista blanca:
 *      · `perfil` sigue accesible siempre (si no, el usuario no puede ni
 *        cambiar su contraseña ni subir su firma).
 *      · `role === 'admin'` conserva acceso total. Un admin bloqueado por su
 *        propio JSON no tendría cómo desbloquearse.
 *      · `general: true` NO exime: la gracia del override es poder recortar
 *        también los módulos que hoy ve todo el mundo (flota, conductores…).
 */
export function checkAccess(
  userRole: string | null | undefined,
  userAreas: Area[] | Area | null | undefined,
  moduleId: string,
  rutasOverride?: RutasOverride | null
): { allowed: boolean; level: AccessLevel | null } {
  const permission = ROUTE_PERMISSIONS[moduleId]
  if (!permission) {
    return { allowed: false, level: null }
  }

  const override = normalizarRutasOverride(rutasOverride)
  if (override) {
    // Un admin nunca se queda fuera, aunque su JSON no liste el módulo.
    if (userRole === 'admin') {
      return { allowed: true, level: 'full' }
    }
    if (moduleId === MODULO_SIEMPRE_ACCESIBLE) {
      return { allowed: true, level: 'full' }
    }

    const nivel = override[moduleId]
    return nivel ? { allowed: true, level: nivel } : { allowed: false, level: null }
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
 * Obtiene todos los módulos accesibles para un usuario.
 *
 * `rutasOverride` se respeta con la misma semántica que en `checkAccess`, y por
 * eso se recorre `ROUTE_PERMISSIONS` en vez del propio override: así las claves
 * que alguien haya metido a mano y no correspondan a ningún módulo real se caen
 * solas, y el sidebar del frontend nunca pinta una entrada que la API no sirve.
 */
export function getAccessibleModules(
  userRole: string | null | undefined,
  userAreas: Area[] | Area | null | undefined,
  rutasOverride?: RutasOverride | null
): Record<string, AccessLevel> {
  const modules: Record<string, AccessLevel> = {}

  for (const [moduleId] of Object.entries(ROUTE_PERMISSIONS)) {
    const { allowed, level } = checkAccess(userRole, userAreas, moduleId, rutasOverride)
    if (allowed && level) {
      modules[moduleId] = level
    }
  }

  return modules
}
