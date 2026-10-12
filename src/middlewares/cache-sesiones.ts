/**
 * Caché del estado de las sesiones del dashboard, compartida por el middleware
 * de autenticación y por quien las cierra.
 *
 * Consultar la sesión en cada petición costaría una ida a la base por cada
 * llamada del front (un listado dispara varias). Con 30 s de caché, cerrar una
 * sesión o desactivar a alguien surte efecto en medio minuto como mucho, y en
 * este proceso de inmediato, porque quien cierra vacía la caché.
 *
 * Vive aparte del middleware para que `sesiones.service` pueda vaciarla sin
 * importar el middleware (que a su vez importa servicios que importan
 * `sesiones.service`).
 */

export interface UsuarioDeSesion {
  id: string
  role: string | null
  area: string[]
  permisos: Record<string, unknown>
  nombre: string | null
  correo: string | null
}

export const CACHE_SESION_MS = 30_000

/// La clave es el hash del token, no el token: lo que se guarda en memoria no
/// sirve para autenticarse si el proceso se vuelca a un log o a un dump.
const cache = new Map<string, { hasta: number; usuario: UsuarioDeSesion | null }>()

export function leerSesionEnCache(tokenHash: string): UsuarioDeSesion | null | undefined {
  const fila = cache.get(tokenHash)
  if (!fila) return undefined
  if (fila.hasta <= Date.now()) {
    cache.delete(tokenHash)
    return undefined
  }
  return fila.usuario
}

export function guardarSesionEnCache(tokenHash: string, usuario: UsuarioDeSesion | null): void {
  /// Tope para que un ataque con miles de tokens distintos no haga crecer el
  /// mapa sin límite: al pasarlo se vacía entero y se vuelve a llenar solo.
  if (cache.size > 5000) cache.clear()
  cache.set(tokenHash, { hasta: Date.now() + CACHE_SESION_MS, usuario })
}

/** Olvida todo lo cacheado. Se llama al cerrar sesiones o cambiar a un usuario. */
export function olvidarSesionesEnCache(): void {
  cache.clear()
}
