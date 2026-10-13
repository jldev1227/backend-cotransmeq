import { Server as IOServer, Socket } from 'socket.io'
import jwt from 'jsonwebtoken'
import { env } from '../config/env'
import { hashToken, TIPOS_DEL_EQUIPO, usuarioDeSesion } from '../middlewares/auth.middleware'
import { sesionAppVigente } from '../modules/app-usuarios/app-usuarios.service'
import { tokenPortalRegistrado } from '../modules/conductor-portal/portal-token.service'

/**
 * Usuario autenticado de un socket. Vive en `socket.data.user`.
 *
 * REGLA: los handlers deben usar SIEMPRE esto y nunca el `user` que llega en
 * el payload de un evento. Ese payload lo escribe el cliente, así que hasta
 * ahora cualquiera podía firmar cambios como otro usuario — y ese id se
 * persistía tal cual en `actualizado_por_id`.
 */
export interface SocketUser {
  id: string
  name: string
  correo?: string | null
  /** Áreas del usuario (arreglo); los tokens viejos podían traer un string. */
  area?: string | string[] | null
  role?: string | null
  tokenType?: 'dashboard' | 'app_usuario'
}

export function getSocketUser(socket: Socket): SocketUser | null {
  return (socket.data?.user as SocketUser) ?? null
}

/**
 * Identidad efectiva de un evento.
 *
 * En `enforce` devuelve siempre la del token. En `permissive`/`off` cae al
 * `user` del payload cuando no hay token, para no romper a los clientes que
 * aún no lo mandan. El día que se pase a `enforce`, el fallback deja de
 * usarse solo.
 */
export function resolveActor(
  socket: Socket,
  payloadUser?: { id?: string; name?: string } | null,
): SocketUser | null {
  const auth = getSocketUser(socket)
  if (auth) return auth
  if (env.SOCKET_AUTH_MODE === 'enforce') return null
  if (!payloadUser?.id) return null
  return { id: payloadUser.id, name: payloadUser.name || 'Usuario' }
}

function extraerToken(socket: Socket): string | null {
  const fromAuth = (socket.handshake.auth as any)?.token
  if (typeof fromAuth === 'string' && fromAuth) return fromAuth

  const header = socket.handshake.headers?.authorization
  if (typeof header === 'string') {
    const parts = header.split(' ')
    if (parts.length === 2) return parts[1]
  }

  const fromQuery = (socket.handshake.query as any)?.token
  if (typeof fromQuery === 'string' && fromQuery) return fromQuery

  return null
}

/** Orígenes permitidos para el handshake. Vacío → '*' (comportamiento previo). */
export function corsOrigins(): string[] | '*' {
  const raw = (env.SOCKET_CORS_ORIGINS || '').trim()
  if (!raw) return '*'
  const list = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return list.length ? list : '*'
}

/**
 * Identidad que da un token en el handshake.
 *
 *  - Token del equipo (dashboard o `app_usuario`) con su sesión abierta → el
 *    usuario, con rol, áreas, nombre y correo leídos de la base, igual que
 *    `authMiddleware`.
 *  - Token registrado del portal del conductor → identidad de conductor
 *    separada de la del equipo. El gateway de formularios lo verifica por su cuenta.
 *  - Cualquier otro (sesión cerrada, enlace revocado, tokens de impresión o de
 *    días laborados) → `null`, como un token inválido.
 *
 * Hasta oct-2026 bastaba con que el JWT estuviera bien firmado: un token del
 * portal o uno de una sesión ya cerrada conectaba como persona del equipo, y
 * los gateways que solo piden identidad (`sheet:patch` de nómina y cierres,
 * chat) lo daban por bueno.
 */
async function identidadDelToken(token: string): Promise<SocketUser | { portalConductorId: string } | null> {
  let payload: any
  try {
    payload = jwt.verify(token, env.JWT_SECRET)
  } catch {
    return null
  }
  if (payload?.tipo === 'conductor_portal') {
    return typeof payload.sub === 'string' && (await tokenPortalRegistrado(token))
      ? { portalConductorId: payload.sub }
      : null
  }
  if (!TIPOS_DEL_EQUIPO.has(payload?.tipo)) return null

  const usuario = await usuarioDeSesion(hashToken(token))
  if (!usuario) return null
  if (payload.tipo === 'app_usuario' && !(await sesionAppVigente(payload.enlace, token))) return null

  return {
    id: usuario.id,
    name: usuario.nombre || usuario.correo || 'Usuario',
    correo: usuario.correo,
    area: usuario.area,
    role: usuario.role,
    tokenType: payload.tipo === 'app_usuario' ? 'app_usuario' : 'dashboard',
  }
}

let sinTokenContador = 0

/**
 * Middleware de handshake. Reusa exactamente la lógica de
 * `middlewares/auth.middleware.ts` (mismo `JWT_SECRET`, mismo `sub || id`).
 */
export function installSocketAuth(io: IOServer): void {
  const modo = env.SOCKET_AUTH_MODE

  if (modo === 'off') {
    console.warn(
      '⚠️  [sockets] SOCKET_AUTH_MODE=off — los sockets NO verifican identidad.',
    )
    return
  }

  io.use((socket, next) => {
    const token = extraerToken(socket)

    if (!token) {
      sinTokenContador++
      if (modo === 'enforce') {
        return next(new Error('unauthorized: falta token'))
      }
      // En permissive dejamos pasar, pero dejamos rastro para poder medir
      // cuántos clientes faltan por migrar antes de apretar a 'enforce'.
      console.warn(
        `[sockets][auth] conexión SIN token (permissive) socket=${socket.id} ` +
          `total_sin_token=${sinTokenContador} origin=${socket.handshake.headers.origin ?? '-'}`,
      )
      return next()
    }

    identidadDelToken(token)
      .then((identidad) => {
        if (identidad && 'portalConductorId' in identidad) {
          socket.data.portalConductorId = identidad.portalConductorId
          return next()
        }
        if (identidad) {
          socket.data.user = identidad
          return next()
        }
        if (modo === 'enforce') return next(new Error('unauthorized: token inválido'))
        console.warn(`[sockets][auth] token INVÁLIDO (permissive) socket=${socket.id}`)
        return next()
      })
      .catch(() =>
        /// Un fallo de la base no debe dejar entrar como alguien en `enforce`, ni
        /// tumbar la conexión en `permissive`.
        modo === 'enforce' ? next(new Error('unauthorized: no se pudo verificar la sesión')) : next(),
      )
  })

  console.log(`🔐 [sockets] auth instalada en modo "${modo}"`)
}
