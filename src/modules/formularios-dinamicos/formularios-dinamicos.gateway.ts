/**
 * Handlers de socket del módulo: unir a rooms. Nada más.
 *
 * **No acepta identidad del cliente.** `forms:join` no lleva `conductorId`: el
 * backend lo deriva del token del handshake. Si lo aceptara, cualquiera con un
 * socket abierto podría unirse a `conductor:<otro>:forms` y recibir los avisos
 * de envíos de otra persona.
 *
 * Los eventos salientes viven en `formularios-dinamicos.events.ts`; aquí solo
 * está la entrada.
 */

import type { Server as IOServer, Socket } from 'socket.io'
import jwt from 'jsonwebtoken'
import { env } from '../../config/env'
import { logger } from '../../utils/logger'
import { checkAccess } from '../../config/permissions'
import { getSocketUser } from '../../sockets/auth'
import { ADMIN_ROOM, conductorRoom } from './formularios-dinamicos.events'

const MODULO = 'formularios'

/**
 * Conductor autenticado de un socket del portal.
 *
 * `installSocketAuth` verifica el token del dashboard y guarda `socket.data.user`,
 * pero descarta `tipo` y `cedula`, así que un token de portal queda como un
 * usuario sin áreas. Aquí se vuelve a leer el token para distinguirlos: es la
 * forma menos invasiva de añadir el portal sin cambiar el contrato de
 * `SocketUser`, que otros gateways ya consumen.
 */
function conductorDelSocket(socket: Socket): { id: string; cedula?: string } | null {
  const raw =
    (socket.handshake.auth as any)?.token ||
    (typeof socket.handshake.headers?.authorization === 'string'
      ? socket.handshake.headers.authorization.split(' ')[1]
      : null) ||
    (socket.handshake.query as any)?.token

  if (typeof raw !== 'string' || !raw) return null

  try {
    const payload = jwt.verify(raw, env.JWT_SECRET) as any
    if (payload.tipo !== 'conductor_portal') return null
    return { id: payload.sub, cedula: payload.cedula }
  } catch {
    return null
  }
}

export function registerFormulariosGateway(io: IOServer): void {
  io.on('connection', (socket) => {
    /**
     * El conductor pide entrar a su propio room. No recibe parámetros a
     * propósito: el único id posible es el del token.
     */
    socket.on('forms:join', (_payload: unknown, ack?: (r: unknown) => void) => {
      const conductor = conductorDelSocket(socket)
      if (!conductor) {
        ack?.({ ok: false, error: 'unauthorized' })
        return
      }
      const room = conductorRoom(conductor.id)
      socket.join(room)
      ack?.({ ok: true, room })
    })

    socket.on('forms:leave', (_payload: unknown, ack?: (r: unknown) => void) => {
      const conductor = conductorDelSocket(socket)
      if (conductor) socket.leave(conductorRoom(conductor.id))
      ack?.({ ok: true })
    })

    /**
     * El dashboard pide entrar al room admin. Se comprueba el permiso del
     * módulo con el mismo `checkAccess` que usan las rutas HTTP: sin esto,
     * cualquier usuario autenticado —incluido uno sin acceso a formularios—
     * recibiría los avisos de envíos con datos de salud y fatiga.
     */
    socket.on('forms:join-admin', (_payload: unknown, ack?: (r: unknown) => void) => {
      const user = getSocketUser(socket)
      if (!user) {
        ack?.({ ok: false, error: 'unauthorized' })
        return
      }
      const { allowed } = checkAccess(user.role, user.area as any, MODULO)
      if (!allowed) {
        logger.warn(
          { type: 'forms-socket-admin-denied', userId: user.id, areas: user.area },
          '[formularios] se denegó la entrada al room admin',
        )
        ack?.({ ok: false, error: 'forbidden' })
        return
      }
      socket.join(ADMIN_ROOM)
      ack?.({ ok: true, room: ADMIN_ROOM })
    })

    socket.on('forms:leave-admin', (_payload: unknown, ack?: (r: unknown) => void) => {
      socket.leave(ADMIN_ROOM)
      ack?.({ ok: true })
    })
  })
}
