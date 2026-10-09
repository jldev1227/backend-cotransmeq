/**
 * Límite de envíos por IP para el formulario público, en memoria.
 *
 * El backend corre en un solo proceso, así que un `Map` basta y evita meter
 * otra dependencia. Si algún día hay varias réplicas, cambiar por
 * `@fastify/rate-limit` con Redis.
 */
const ventanas = new Map<string, number[]>()

export function excedeLimite(clave: string, maximo: number, ventanaMs: number, ahora = Date.now()): boolean {
  const desde = ahora - ventanaMs
  const marcas = (ventanas.get(clave) ?? []).filter((t) => t > desde)
  if (marcas.length >= maximo) {
    ventanas.set(clave, marcas)
    return true
  }
  marcas.push(ahora)
  ventanas.set(clave, marcas)
  // Poda ocasional para que el mapa no crezca con IPs que no vuelven.
  if (ventanas.size > 5_000) {
    for (const [k, v] of ventanas) if (!v.some((t) => t > desde)) ventanas.delete(k)
  }
  return false
}

/** Solo para pruebas. */
export function reiniciarLimitador() {
  ventanas.clear()
}
