import { Server as HttpServer } from 'http'
import { Server as IOServer } from 'socket.io'
import { registerLiquidacionTerceroGateway } from './liquidacion-tercero.gateway'
import { registerChatGateway } from '../modules/liquidaciones-chat/liquidaciones-chat.gateway'
import { registerBorradorQueueGateway } from '../queue/borrador-queue.gateway'
import { borradorQueueService } from '../queue/borrador-queue.service'
import { registerBulkSaveLiquidacionTerceroGateway } from '../queue/bulk-save-liquidacion-tercero.gateway'
import { bulkSaveLiquidacionTerceroService } from '../queue/bulk-save-liquidacion-tercero.service'
import { installSocketAuth, corsOrigins } from './auth'
import { registerFormulariosGateway } from '../modules/formularios-dinamicos/formularios-dinamicos.gateway'

let io: IOServer | null = null

const onlineUserIds = new Set<string>()

export function getOnlineUserIds(): string[] {
  return Array.from(onlineUserIds)
}

export function initSockets(server: HttpServer) {
  console.log('═══════════════════════════════════════════════════════')
  console.log('🔌 [initSockets] INICIANDO SOCKET.IO SERVER')
  console.log('═══════════════════════════════════════════════════════')
  
  io = new IOServer(server, { cors: { origin: corsOrigins(), methods: ['GET', 'POST'] } })

  // Verificación de identidad en el handshake. Va ANTES de cualquier
  // `io.on('connection')` para que los handlers ya tengan `socket.data.user`.
  // El gateway de formularios dinámicos la exige (`getSocketUser`); el resto
  // de gateways sigue funcionando igual porque el modo por defecto es
  // `permissive` (ver SOCKET_AUTH_MODE en config/env.ts).
  installSocketAuth(io)

  console.log('✅ [initSockets] Socket.IO server creado')
  
  io.on('connection', socket => {
    console.log(`🔗 [sockets] ✓ NUEVA CONEXIÓN: socket.id=${socket.id}`)
    console.log(`   Rooms actuales: [${Array.from(socket.rooms).join(', ')}]`)
    console.log(`   Handshake: ${JSON.stringify(socket.handshake.headers)}`)
    
    socket.on('ping', () => socket.emit('pong'))

    // Presencia: un usuario autenticado anuncia su userId al conectarse al dashboard
    socket.on('join-dashboard', (userId: string) => {
      console.log(`📨 [sockets] ← join-dashboard RECIBIDO: userId=${userId}, socket.id=${socket.id}`)
      if (userId) {
        socket.data.userId = userId
        socket.join(`user-${userId}`)
        onlineUserIds.add(userId)
        io!.emit('usuarios-online', Array.from(onlineUserIds))
        console.log(`✅ [sockets] Usuario ${userId} unido al room user-${userId}`)
        console.log(`   Rooms del socket: [${Array.from(socket.rooms).join(', ')}]`)
        // Verificar que efectivamente entró al room (a veces el join
        // puede fallar silenciosamente si el namespace no está bien)
        setTimeout(() => {
          if (!socket.rooms.has(`user-${userId}`)) {
            console.error(
              `❌ [sockets] socket ${socket.id} NO está en room user-${userId} ` +
              `tras join-dashboard. Rooms: [${Array.from(socket.rooms).join(', ')}]`
            )
          } else {
            console.log(`✓ [sockets] socket ${socket.id} confirmado en room user-${userId}`)
          }
        }, 100)
      } else {
        console.warn(`⚠️ [sockets] join-dashboard recibido con userId vacío`)
      }
    })

    socket.on('leave-dashboard', () => {
      if (socket.data.userId) {
        onlineUserIds.delete(socket.data.userId)
        io!.emit('usuarios-online', Array.from(onlineUserIds))
        socket.data.userId = undefined
      }
    })

    socket.on('disconnect', () => {
      if (socket.data.userId) {
        onlineUserIds.delete(socket.data.userId)
        io!.emit('usuarios-online', Array.from(onlineUserIds))
        console.log(`Usuario ${socket.data.userId} salió del dashboard (socket ${socket.id})`)
      }
    })

    // Permitir unirse a la sala de una evaluación específica
    socket.on('join-evaluacion', (evaluacionId: string) => {
      const room = `evaluacion-${evaluacionId}`;
      socket.join(room);
      console.log(`Socket ${socket.id} se unió a la sala ${room}`);
    });
    
    // Permitir salir de la sala de una evaluación
    socket.on('leave-evaluacion', (evaluacionId: string) => {
      const room = `evaluacion-${evaluacionId}`;
      socket.leave(room);
      console.log(`Socket ${socket.id} salió de la sala ${room}`);
    });
  })
  registerLiquidacionTerceroGateway(io)
  registerFormulariosGateway(io)
  registerChatGateway(io)
  registerBorradorQueueGateway(io)
  registerBulkSaveLiquidacionTerceroGateway(io)

  // Wire up queue emitter
  borradorQueueService.setEmitter((userId, event, data) => {
    io.to(`user-${userId}`).emit(event, data)
  })
  bulkSaveLiquidacionTerceroService.setEmitter((userId, event, data) => {
    io.to(`user-${userId}`).emit(event, data)
  })

  return io
}

export function getIo() {
  if (!io) throw new Error('Socket.io not initialized')
  return io
}

/** Alias for getIo to maintain compatibility with legacy code */
export const getIO = getIo;

/** Emit an event to a specific user's socket(s) */
export function emitToUser(userId: string, event: string, data: any) {
  if (io) {
    io.to(`user-${userId}`).emit(event, data)
  }
}

/** Emit a liquidacion-servicio event to all connected clients */
export function emitLiquidacionServicio(event: 'liquidacion-servicio-created' | 'liquidacion-servicio-updated' | 'liquidacion-servicio-deleted', data: any) {
  if (io) {
    io.emit(event, data)
  }
}

/** Emit a notification to all connected clients (filtered client-side by usuario_id) */
export function emitNotificacion(data: any) {
  if (io) {
    io.emit('nueva-notificacion', data)
  }
}

/** Emit an actividad PESV event to all connected clients */
export function emitActividadPesv(event: 'actividad-pesv-created' | 'actividad-pesv-updated' | 'actividad-pesv-deleted', data: any) {
  if (io) {
    io.emit(event, data)
  }
}

/** Emit a facturacion-liquidacion event to all connected clients */
export function emitFacturacionLiquidacion(event: 'facturacion-created' | 'facturacion-anulada' | 'liquidacion-servicio-facturada', data: any) {
  if (io) {
    io.emit(event, data)
  }
}
