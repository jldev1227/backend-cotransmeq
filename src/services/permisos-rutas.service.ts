import { prisma } from '../config/prisma'
import { normalizarRutasOverride, type RutasOverride } from '../config/permissions'

/**
 * Lector de `users.permisos_rutas` para los guards de permisos.
 *
 * ¿Por qué no viaja en el JWT, como `permisos`?
 *
 * Porque `permisos_rutas` es la palanca con la que un administrador recorta el
 * acceso de alguien, y tiene que hacer efecto YA. Metido en el token, el
 * recorte no aplicaría hasta que la persona volviera a entrar — y los tokens
 * duran 30 días (90 con «recordarme»). Revocar un acceso implicaría cerrarle
 * la sesión a mano, que es justo lo que nadie se acuerda de hacer.
 *
 * Leerlo de la BD en cada request tampoco vale: la base está en Railway, es
 * remota, y son decenas de milisegundos por petición sobre TODAS las rutas con
 * `requirePermission`. De ahí la caché con TTL corto: como mucho una consulta
 * por usuario cada `TTL_MS`, y un cambio de permisos entra solo en ese plazo.
 * Las escrituras del módulo de usuarios además invalidan la entrada a mano
 * (`invalidarPermisosRutas`), así que en la práctica es inmediato.
 */

/// 30 s: suficientemente corto para que un recorte de permisos se note casi al
/// instante aunque falle la invalidación explícita, y suficientemente largo
/// para que un usuario navegando no genere tráfico contra la BD.
const TTL_MS = 30_000

/// Tope del mapa. Sin él, un backend de larga vida acumula una entrada por cada
/// usuario que haya pasado alguna vez. Con ~200 usuarios reales no llega nunca,
/// pero el bot de monitoreo con tokens rotatorios sí lo haría crecer.
const MAX_ENTRADAS = 1000

interface Entrada {
  valor: RutasOverride | null
  expiraEn: number
}

const cache = new Map<string, Entrada>()

/**
 * Devuelve la lista blanca del usuario, ya normalizada, o `null` si no tiene
 * (columna NULL, `{}`, o sólo claves inválidas) — es decir, si le tocan las
 * reglas por área de siempre.
 *
 * Nunca lanza: si la consulta falla se devuelve `null`, que es el
 * comportamiento previo a esta funcionalidad. Un fallo de BD no debe convertir
 * un 200 en un 403 masivo.
 */
export async function obtenerPermisosRutas(userId: string | null | undefined): Promise<RutasOverride | null> {
  if (!userId) return null

  const ahora = Date.now()
  const enCache = cache.get(userId)
  if (enCache && enCache.expiraEn > ahora) {
    return enCache.valor
  }

  let valor: RutasOverride | null = null
  try {
    const fila = await prisma.usuarios.findUnique({
      where: { id: userId },
      select: { permisos_rutas: true },
    })
    valor = normalizarRutasOverride(fila?.permisos_rutas)
  } catch (err) {
    console.error('[permisos_rutas] no se pudo leer del usuario', userId, err)
    /// Se cachea igualmente el `null` durante el TTL: si la BD está caída, no
    /// tiene sentido reintentar en cada request de cada usuario.
  }

  if (cache.size >= MAX_ENTRADAS) cache.clear()
  cache.set(userId, { valor, expiraEn: ahora + TTL_MS })
  return valor
}

/** Invalida la caché de un usuario (llamar tras actualizar sus permisos). */
export function invalidarPermisosRutas(userId: string) {
  cache.delete(userId)
}

/** Vacía la caché entera. Sólo para tests. */
export function limpiarCachePermisosRutas() {
  cache.clear()
}
