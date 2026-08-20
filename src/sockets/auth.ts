import { Server as IOServer, Socket } from 'socket.io'
import jwt from 'jsonwebtoken'
import { env } from '../config/env'

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
  area?: string | null
  role?: string | null
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

    try {
      const payload = jwt.verify(token, env.JWT_SECRET) as any
      socket.data.user = {
        id: payload.sub || payload.id,
        name: payload.nombre || payload.name || payload.correo || 'Usuario',
        correo: payload.correo ?? null,
        area: payload.area ?? null,
        role: payload.role ?? null,
      } satisfies SocketUser
      return next()
    } catch {
      if (modo === 'enforce') {
        return next(new Error('unauthorized: token inválido'))
      }
      console.warn(
        `[sockets][auth] token INVÁLIDO (permissive) socket=${socket.id}`,
      )
      return next()
    }
  })

  console.log(`🔐 [sockets] auth instalada en modo "${modo}"`)
}
