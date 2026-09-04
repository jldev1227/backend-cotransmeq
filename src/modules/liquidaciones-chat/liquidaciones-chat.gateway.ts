import { Server as IOServer, Socket } from 'socket.io'
import { resolveActor } from '../../sockets/auth'

interface ChatUser {
  id: string
  name: string
  joinedAt: string
}

interface ChatRoom {
  liquidacionId: string
  users: Map<string, ChatUser>
}

const chatRooms = new Map<string, ChatRoom>()

function getRoomKey(liquidacionId: string): string {
  return `chat:liquidacion-tercero:${liquidacionId}`
}

function broadcastPresence(roomKey: string) {
  const room = chatRooms.get(roomKey)
  if (!room) return

  const users = Array.from(room.users.values()).map((u) => ({
    id: u.id,
    name: u.name,
    joinedAt: u.joinedAt,
  }))

  const io = getIo()
  io.to(roomKey).emit('chat:presence', { users })
}

function getIo(): IOServer {
  const { getIo: _getIo } = require('../../sockets')
  return _getIo()
}

export function registerChatGateway(io: IOServer) {
  io.on('connection', (socket: Socket) => {
    /**
     * Sala de chat de una liquidación.
     *
     * La identidad sale del token, no del payload. Antes se tomaba el `user`
     * que mandara el cliente y se publicaba tal cual en la presencia del chat:
     * cualquiera podía aparecer en la sala con el nombre de otra persona, y
     * además leer toda la conversación conociendo solo el uuid de la
     * liquidación.
     *
     * Queda pendiente comprobar si este usuario puede ver ESTA liquidación;
     * eso depende de una regla de negocio —área, autoría— que hay que acordar.
     */
    socket.on('chat:join', ({ liquidacionId, user }: { liquidacionId: string; user?: { id: string; name: string } }) => {
      const actor = resolveActor(socket, user)
      if (!actor) {
        console.warn('[chat] join rechazado: sin identidad')
        return
      }
      if (!liquidacionId) return

      const roomKey = getRoomKey(liquidacionId)
      socket.join(roomKey)

      if (!chatRooms.has(roomKey)) {
        chatRooms.set(roomKey, { liquidacionId, users: new Map() })
      }
      const room = chatRooms.get(roomKey)!
      room.users.set(socket.id, {
        id: actor.id,
        name: actor.name,
        joinedAt: new Date().toISOString(),
      })

      broadcastPresence(roomKey)
      console.log(`[chat] ${user.name} joined ${roomKey}`)
    })

    socket.on('chat:leave', ({ liquidacionId }: { liquidacionId: string }) => {
      const roomKey = getRoomKey(liquidacionId)
      socket.leave(roomKey)

      const room = chatRooms.get(roomKey)
      if (room) {
        room.users.delete(socket.id)
        if (room.users.size === 0) {
          chatRooms.delete(roomKey)
        } else {
          broadcastPresence(roomKey)
        }
      }
    })

    socket.on('chat:typing', ({ liquidacionId, userId, name, typing }: { liquidacionId: string; userId: string; name: string; typing: boolean }) => {
      const roomKey = getRoomKey(liquidacionId)
      io.to(roomKey).emit('chat:typing', { userId, name, typing })
    })

    socket.on('disconnect', () => {
      for (const [roomKey, room] of chatRooms.entries()) {
        if (room.users.has(socket.id)) {
          room.users.delete(socket.id)
          if (room.users.size === 0) {
            chatRooms.delete(roomKey)
          } else {
            broadcastPresence(roomKey)
          }
        }
      }
    })
  })
}
