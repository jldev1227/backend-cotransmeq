import { prisma } from '../../config/prisma'
import {
  getAccessibleModules,
  normalizarRutasOverride,
  type AccessLevel,
  type Area,
} from '../../config/permissions'

/** Por dónde llega la petición: el chat de la app o un cliente MCP (Claude). */
export type Canal = 'app' | 'mcp'

/** Lo que se sabe de la pantalla del usuario (solo en el chat de la app). */
export interface ContextoHerramienta {
  /** Ruta actual con su query, p. ej. `/dashboard/servicios?estado=planificado`. */
  ruta?: string
}

/** Quién conversa con el asistente y qué módulos puede ver. */
export interface UsuarioAsistente {
  id: string
  nombre: string
  rol: string
  areas: string[]
  /**
   * Módulos accesibles con su nivel, resueltos con la MISMA regla que pinta el
   * menú lateral (`checkAccess` + `permisos_rutas`). Un admin los tiene todos.
   */
  modulos: ReadonlyMap<string, AccessLevel>
}

/**
 * Una capacidad que el modelo puede invocar. Es la misma pieza que expone el
 * servidor MCP, por eso no sabe nada de Azure ni de HTTP: recibe argumentos ya
 * parseados y devuelve datos planos con nombres de negocio.
 */
export interface Herramienta {
  nombre: string
  /** Lo que lee el modelo para decidir cuándo usarla. */
  descripcion: string
  /** JSON Schema de los argumentos. */
  parametros: Record<string, unknown>
  /** Texto corto para la UI mientras corre ("Buscando conductores…"). */
  etiqueta: string
  /**
   * `moduleId` de `ROUTE_PERMISSIONS` que el usuario debe poder ver para usarla,
   * o `null` si aplica a todos. Es la misma regla que decide si ve la pantalla:
   * el asistente nunca muestra datos de un módulo al que el usuario no entra.
   * Basta cualquier nivel (`limited` incluido): el asistente solo consulta.
   */
  requiere: string | null
  /**
   * Nivel mínimo sobre `requiere`. Las consultas no lo ponen (basta ver el
   * módulo); las acciones que escriben piden `'full'`, que es exactamente lo que
   * exige la ruta REST equivalente (`requirePermission('<modulo>', 'full')`).
   */
  nivel?: AccessLevel
  /**
   * `true` si crea o modifica datos. Se usa para el `readOnlyHint` de MCP y
   * para que el prompt le exija al modelo confirmar antes de llamarla.
   */
  escribe?: boolean
  /** Restricción extra por rol (p. ej. solo `admin`). */
  soloRoles?: string[]
  /**
   * Dónde se ofrece. Por defecto en ambos; las que dependen del navegador
   * (navegar a una pantalla) se marcan `['app']`.
   */
  canales?: Canal[]
  ejecutar(
    args: Record<string, unknown>,
    usuario: UsuarioAsistente,
    contexto?: ContextoHerramienta,
  ): Promise<unknown>
}

/// Misma jerarquía que `permissions.middleware.ts`: `limited` < `read` < `full`.
const JERARQUIA: readonly AccessLevel[] = ['limited', 'read', 'full']

export function puedeUsar(h: Herramienta, u: UsuarioAsistente, canal: Canal): boolean {
  if (h.canales && !h.canales.includes(canal)) return false
  if (h.soloRoles && !h.soloRoles.includes(u.rol)) return false
  if (h.requiere === null) return true
  const nivel = u.modulos.get(h.requiere)
  if (!nivel) return false
  return !h.nivel || JERARQUIA.indexOf(nivel) >= JERARQUIA.indexOf(h.nivel)
}

/**
 * Construye el usuario del asistente leyendo la BD, no el JWT.
 *
 * `permisos_rutas` no viaja en el token a propósito (ver `auth.service.ts`): es
 * la palanca con la que un administrador recorta el acceso de alguien y tiene
 * que aplicar ya. Una consulta por conversación es barata y garantiza que el
 * asistente y el menú lateral cuentan lo mismo.
 *
 * Devuelve `null` si el usuario no existe o está inactivo.
 */
export async function cargarUsuarioAsistente(userId: string): Promise<UsuarioAsistente | null> {
  const u = await prisma.usuarios.findUnique({
    where: { id: userId },
    select: { id: true, nombre: true, role: true, area: true, permisos_rutas: true, activo: true },
  })
  if (!u || !u.activo) return null

  const rol = String(u.role ?? 'usuario')
  const areas = Array.isArray(u.area) ? (u.area as string[]) : []
  const accesibles = getAccessibleModules(rol, areas as Area[], normalizarRutasOverride(u.permisos_rutas))

  return {
    id: u.id,
    nombre: u.nombre,
    rol,
    areas,
    modulos: new Map(Object.entries(accesibles)),
  }
}
