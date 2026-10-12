import type { FastifyReply, FastifyRequest } from 'fastify'

/**
 * Límite de intentos en memoria, por clave y ventana fija.
 *
 * Hasta oct-2026 nada frenaba los intentos: el login aceptaba contraseñas sin
 * tope y los formularios públicos que mandan correo (acceso del conductor,
 * certificados de terceros, recuperación de contraseña) se podían repetir sin
 * límite para adivinar quién existe o para llenarle el buzón a alguien.
 *
 * Va en memoria y no en la base porque el backend corre en un solo contenedor:
 * un reinicio borra los contadores, lo cual es aceptable (el peor caso es
 * regalar una ventana más). Si algún día hay varias réplicas, esto pasa a
 * Redis o a la base.
 */
export interface Limitador {
  /** Cuenta un intento. Devuelve los segundos de espera si se pasó del tope, o 0. */
  consumir(clave: string): number
  /** Segundos de espera si la clave ya está bloqueada, sin contar el intento. */
  bloqueado(clave: string): number
  /** Olvida la clave (p. ej. tras un login correcto). */
  reiniciar(clave: string): void
}

export function crearLimitador(opciones: { max: number; ventanaMs: number }): Limitador {
  const contadores = new Map<string, { n: number; hasta: number }>()

  const vigente = (clave: string) => {
    const fila = contadores.get(clave)
    if (!fila) return null
    if (fila.hasta <= Date.now()) {
      contadores.delete(clave)
      return null
    }
    return fila
  }
  const espera = (fila: { hasta: number }) => Math.max(1, Math.ceil((fila.hasta - Date.now()) / 1000))

  return {
    consumir(clave) {
      /// Barrido perezoso: cada tanto se tiran las ventanas vencidas para que
      /// un barrido de IPs o de cédulas no haga crecer el mapa sin fin.
      if (contadores.size > 10_000) {
        const ahora = Date.now()
        for (const [k, v] of contadores) if (v.hasta <= ahora) contadores.delete(k)
      }
      const fila = vigente(clave) ?? { n: 0, hasta: Date.now() + opciones.ventanaMs }
      fila.n++
      contadores.set(clave, fila)
      return fila.n > opciones.max ? espera(fila) : 0
    },
    bloqueado(clave) {
      const fila = vigente(clave)
      return fila && fila.n >= opciones.max ? espera(fila) : 0
    },
    reiniciar(clave) {
      contadores.delete(clave)
    }
  }
}

/**
 * IP del cliente detrás de Cloudflare.
 *
 * La API de producción solo se alcanza por Cloudflare, que pone la IP real en
 * `CF-Connecting-IP`. Sin eso, `request.ip` es la del túnel y todos los
 * usuarios compartirían contador: el primero que se equivocara cinco veces
 * bloquearía el login de toda la empresa. En local no hay cabecera y se usa la
 * IP de la conexión.
 */
export function ipCliente(request: FastifyRequest): string {
  const cf = request.headers['cf-connecting-ip']
  if (typeof cf === 'string' && cf.trim()) return cf.trim()
  const xff = request.headers['x-forwarded-for']
  const primera = (Array.isArray(xff) ? xff[0] : xff)?.split(',')[0]?.trim()
  return primera || request.ip || 'desconocida'
}

/** Respuesta 429 uniforme, con `Retry-After` para que el cliente sepa cuánto esperar. */
export function responderLimite(reply: FastifyReply, segundos: number) {
  const minutos = Math.ceil(segundos / 60)
  return reply
    .status(429)
    .header('Retry-After', String(segundos))
    .send({
      success: false,
      error: 'Demasiados intentos',
      message: `Demasiados intentos. Vuelve a intentarlo en ${minutos === 1 ? '1 minuto' : `${minutos} minutos`}.`,
      reintentar_en: segundos
    })
}

/**
 * Atajo para rutas públicas: cuenta el intento por IP y, si se da, por la
 * clave del recurso (cédula, correo…). Devuelve true si ya respondió con 429.
 *
 * Dos limitadores y no uno: por IP el tope es más alto (una oficina entera
 * sale por la misma IP), y por clave es bajo (nadie necesita pedir diez
 * enlaces para la misma cédula en una hora).
 */
export function limitarIntento(
  request: FastifyRequest,
  reply: FastifyReply,
  limites: { porIp: Limitador; porClave?: Limitador },
  clave?: string | null
): boolean {
  let espera = limites.porIp.consumir(ipCliente(request))
  if (limites.porClave && clave) {
    espera = Math.max(espera, limites.porClave.consumir(clave.trim().toLowerCase()))
  }
  if (espera > 0) {
    responderLimite(reply, espera)
    return true
  }
  return false
}

/** El mismo límite como `preHandler` de una ruta; `clave` saca del body la cédula o el correo. */
export function preHandlerLimite(
  limites: { porIp: Limitador; porClave?: Limitador },
  clave?: (request: FastifyRequest) => string | null | undefined
) {
  return async function (request: FastifyRequest, reply: FastifyReply) {
    if (limitarIntento(request, reply, limites, clave?.(request))) return reply
  }
}

/** Presets compartidos, con su porqué, para no inventar números en cada ruta. */
export const MINUTO = 60_000
export const HORA = 60 * MINUTO
/// Formularios públicos que envían un correo o un enlace: nadie legítimo pide
/// más de tres para la misma cédula en una hora; por IP se deja margen para
/// una oficina o un patio que sale a internet por la misma conexión.
export const limitesEnvioDeEnlace = () => ({
  porIp: crearLimitador({ max: 30, ventanaMs: HORA }),
  porClave: crearLimitador({ max: 3, ventanaMs: HORA })
})
