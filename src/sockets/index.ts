import { Server as HttpServer } from 'http'
import { Server as IOServer } from 'socket.io'
import { registerLiquidacionTerceroGateway } from './liquidacion-tercero.gateway'
import { registerChatGateway } from '../modules/liquidaciones-chat/liquidaciones-chat.gateway'
import { registerBorradorQueueGateway } from '../queue/borrador-queue.gateway'
import { borradorQueueService } from '../queue/borrador-queue.service'
import { registerBulkSaveLiquidacionTerceroGateway } from '../queue/bulk-save-liquidacion-tercero.gateway'
import { bulkSaveLiquidacionTerceroService } from '../queue/bulk-save-liquidacion-tercero.service'
import { envioLiquidacionesQueueService } from '../queue/envio-liquidaciones-queue.service'
import { borradorNominaQueueService } from '../queue/borrador-nomina-queue.service'
import { envioNominaQueueService } from '../queue/envio-nomina-queue.service'
import { installSocketAuth, corsOrigins, resolveActor, getSocketUser } from './auth'
import { registerSheetGateway } from './sheet.gateway'
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
  
  io = new IOServer(server, {
    cors: { origin: corsOrigins(), methods: ['GET', 'POST'] }
  })

  // Verificación de identidad en el handshake. Va ANTES de cualquier
  // `io.on('connection')` para que los handlers ya tengan `socket.data.user`.
  installSocketAuth(io)

  console.log('✅ [initSockets] Socket.IO server creado')

  io.on('connection', socket => {
    console.log(`🔗 [sockets] ✓ NUEVA CONEXIÓN: socket.id=${socket.id}`)
    /// Antes se volcaban los headers completos del handshake, y ahí viaja el
    /// `Authorization: Bearer <jwt>`: cualquiera con acceso a los logs se
    /// llevaba tokens de sesión válidos. Se registra solo el origen.
    console.log(`   Origen: ${socket.handshake.headers?.origin ?? '(sin origin)'}`)


    socket.on('ping', () => socket.emit('pong'))

    // Presencia: un usuario autenticado anuncia su userId al conectarse al dashboard.
    //
    // El id NO se toma del payload. `user-${id}` es un room privado: por él
    // viajan `sesion-cerrada`, los progresos de las colas (`borrador:*`,
    // `envio-liq:*`, `envio-nomina:*`), `asistencias:export:*` y
    // `certificados:import-progress`. Aceptar el id que declarara el cliente
    // permitía entrar al room de cualquiera con solo conocer su uuid y leer
    // todo su tráfico. Manda la identidad del token; el payload solo sirve de
    // respaldo mientras `SOCKET_AUTH_MODE` no sea `enforce`, que es lo mismo
    // que hace `resolveActor` en el resto de handlers.
    socket.on('join-dashboard', (userIdPedido: string) => {
      const actor = resolveActor(socket, userIdPedido ? { id: userIdPedido } : null)
      const userId = actor?.id

      if (userId && userIdPedido && userId !== userIdPedido) {
        console.warn(
          `⚠️ [sockets] join-dashboard pidió el room de ${userIdPedido} pero el ` +
            `token es de ${userId}. Se usa el del token.`
        )
      }

      if (!userId) {
        console.warn('⚠️ [sockets] join-dashboard sin identidad; no se une a ningún room')
        return
      }

      socket.data.userId = userId
      socket.join(`user-${userId}`)
      onlineUserIds.add(userId)
      io!.emit('usuarios-online', Array.from(onlineUserIds))
      console.log(`✅ [sockets] Usuario ${userId} unido al room user-${userId}`)

      // El join puede fallar en silencio si el namespace no está bien montado.
      setTimeout(() => {
        if (!socket.rooms.has(`user-${userId}`)) {
          console.error(
            `❌ [sockets] socket ${socket.id} NO está en room user-${userId} ` +
              `tras join-dashboard. Rooms: [${Array.from(socket.rooms).join(', ')}]`
          )
        }
      }, 100)
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

    /**
     * Sala de una evaluación concreta.
     *
     * Exige identidad: por este room viajan las respuestas de los evaluados
     * (`nueva-respuesta`, con nombre completo incluido) y hasta ahora bastaba
     * conocer el uuid de la evaluación para recibirlas, sin estar siquiera
     * autenticado.
     *
     * NO se comprueba todavía si ESTE usuario puede ver ESA evaluación:
     * `config/permissions.ts` no define un módulo para evaluaciones, y
     * llamar a `checkAccess` con un módulo inexistente deniega a todo el
     * mundo. Decidir esa regla —¿solo quien la creó?, ¿su área?— es lo que
     * queda pendiente aquí.
     */
    socket.on('join-evaluacion', (evaluacionId: string) => {
      const user = getSocketUser(socket)
      if (!user) {
        console.warn('[sockets] join-evaluacion rechazado: sin identidad')
        return
      }
      if (!evaluacionId) return

      const room = `evaluacion-${evaluacionId}`;
      socket.join(room);
      console.log(`Socket ${socket.id} (${user.id}) se unió a la sala ${room}`);
    });
    
    // Permitir salir de la sala de una evaluación
    socket.on('leave-evaluacion', (evaluacionId: string) => {
      const room = `evaluacion-${evaluacionId}`;
      socket.leave(room);
      console.log(`Socket ${socket.id} salió de la sala ${room}`);
    });
  })
  registerLiquidacionTerceroGateway(io)
  registerSheetGateway(io)
  registerFormulariosGateway(io)
  registerChatGateway(io)
  registerBorradorQueueGateway(io)
  registerBulkSaveLiquidacionTerceroGateway(io)

  // Wire up queue emitter.
  //
  // La cola de borradores emite a dos destinos distintos: el progreso al
  // usuario que lanzó el job, y las altas de hoja al room del libro, que es
  // donde están todos los que tienen ese periodo abierto.
  borradorQueueService.setEmitter((target, event, data) => {
    if (target.room) io.to(target.room).emit(event, data)
    if (target.userId) io.to(`user-${target.userId}`).emit(event, data)
  })
  bulkSaveLiquidacionTerceroService.setEmitter((userId, event, data) => {
    io.to(`user-${userId}`).emit(event, data)
  })
  // Cola de envíos por correo de liquidaciones de terceros: el progreso va
  // al usuario que lanzó; el estado ENVIADO/ERROR de cada cierre, al room
  // del libro del periodo, para que todos los canvas lo pinten en vivo.
  envioLiquidacionesQueueService.setEmitter((target, event, data) => {
    if (target.room) io.to(target.room).emit(event, data)
    if (target.userId) io.to(`user-${target.userId}`).emit(event, data)
  })
  // Cola de envíos de desprendibles de nómina. Mismo reparto: el progreso
  // del lote va a quien lo lanzó, y el ENVIADO/ERROR de cada desprendible al
  // room del libro del periodo, para que los canvas abiertos lo pinten sin
  // recargar.
  envioNominaQueueService.setEmitter((target, event, data) => {
    if (target.room) io.to(target.room).emit(event, data)
    if (target.userId) io.to(`user-${target.userId}`).emit(event, data)
  })

  // Cola de generación de borradores de nómina. Mismo reparto que las otras:
  // el progreso del lote va a quien lo lanzó, y el alta de cada borrador al
  // room del libro, para que los canvas abiertos la vean aparecer.
  borradorNominaQueueService.setEmitter((target, event, data) => {
    if (target.room) io.to(target.room).emit(event, data)
    if (target.userId) io.to(`user-${target.userId}`).emit(event, data)
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

/**
 * Metadatos que viajan con cada evento de dominio, bajo la clave `_evento`.
 *
 * POR QUÉ EXISTE: los clientes ya recibían la entidad, pero no QUIÉN la
 * tocó ni QUÉ cambió. El feed de eventos de `/dashboard/liquidaciones-servicios`
 * necesita ambas cosas para escribir "Juan pasó LS-045 de BORRADOR a
 * LIQUIDADA" sin pedir nada más al servidor, y para distinguir un alta de
 * una edición de un cambio de estado (que se pinta más discreto).
 *
 * Va como sobre aparte y NO mezclado con los campos de la entidad, para no
 * colisionar nunca con una columna real ni romper a los consumidores
 * antiguos, que siguen leyendo `data.id`, `data.estado`, etc.
 */
export interface EventoSocketMeta {
  /** Qué pasó. `estado` es un `updated` que además cambió de estado. */
  tipo: 'created' | 'updated' | 'deleted' | 'estado' | 'anulada'
  /** A qué tab del dashboard afecta, para invalidar solo esa caché. */
  scope: 'liquidaciones' | 'facturas' | 'terceros'
  /** Quién lo hizo. `null` cuando la acción no viene de un request de usuario. */
  actor: { id: string | null; nombre: string } | null
  /**
   * Cómo nombrar la entidad en el feed (consecutivo, nº de factura…).
   * Se manda resuelto para que el cliente no tenga que tener la entidad
   * cargada — el evento puede llegar de un tab que ni siquiera está abierto.
   */
  etiqueta: string
  estado_anterior?: string
  estado_nuevo?: string
  /** ISO. Lo pone el servidor: los relojes de los clientes no coinciden. */
  ts: string
}

/** Construye el sobre `_evento`. `ts` siempre lo pone el servidor. */
export function eventoMeta(
  meta: Omit<EventoSocketMeta, 'ts'>,
): EventoSocketMeta {
  return { ...meta, ts: new Date().toISOString() }
}

/**
 * Emite `data` con el sobre `_evento` adjunto.
 *
 * `data` se copia superficialmente: adjuntar `_evento` mutando el objeto de
 * Prisma que el handler todavía va a devolver por HTTP haría que el sobre
 * se colara en la respuesta REST.
 */
function emitConMeta(event: string, data: any, meta?: EventoSocketMeta) {
  if (!io) return
  if (!meta) {
    io.emit(event, data)
    return
  }
  const payload =
    data && typeof data === 'object' && !Array.isArray(data)
      ? { ...data, _evento: meta }
      : { data, _evento: meta }
  io.emit(event, payload)
}

/**
 * Un borrador se autoguardó.
 *
 * Evento APARTE de `liquidacion-servicio-created/updated` a propósito. Esos dos
 * los escuchan el listado y el canvas para pintar la fila y para avisar al
 * usuario; si el autoguardado los usara, cada tecleo repintaría la hoja de todo
 * el mundo y anunciaría una liquidación que todavía no existe para ellos.
 *
 * Hoy no lo escucha nadie, y así debe quedarse hasta que haya algo concreto que
 * quiera enterarse (por ejemplo, la propia pestaña del autor en otro
 * dispositivo). Que no rompa nada al añadirlo es justamente el punto.
 */
export function emitLiquidacionServicioBorrador(
  data: { id: string; consecutivo: string; estado: string; version: number },
  meta?: EventoSocketMeta,
) {
  emitConMeta('liquidacion-servicio-borrador', data, meta)
}

/** Emit a liquidacion-servicio event to all connected clients */
export function emitLiquidacionServicio(
  event: 'liquidacion-servicio-created' | 'liquidacion-servicio-updated' | 'liquidacion-servicio-deleted',
  data: any,
  meta?: EventoSocketMeta,
) {
  emitConMeta(event, data, meta)
}

/**
 * Emite un evento de items de terceros.
 *
 * Este módulo no emitía NADA: guardar los terceros de una liquidación no
 * llegaba a los demás usuarios, así que el tab de Terceros solo se
 * actualizaba recargando a mano.
 */
export function emitLiquidacionTercero(
  event: 'liquidacion-tercero-updated',
  data: any,
  meta?: EventoSocketMeta,
) {
  emitConMeta(event, data, meta)
}

/**
 * Entrega una notificación a SU destinatario.
 *
 * Antes esto era un `io.emit` global y el filtrado por `usuario_id` se hacía
 * en el navegador: las notificaciones de todo el mundo llegaban al cliente de
 * todo el mundo —con su título y su mensaje— y solo se ocultaban al pintar.
 * Como los llamadores ya recorren la lista de destinatarios y emiten una por
 * cada uno, basta con dirigirla al room privado del usuario.
 *
 * El `io.emit` se conserva solo para el caso sin destinatario conocido, que no
 * debería darse; si aparece en los logs, es que un llamador no está poniendo
 * `usuario_id`.
 */
export function emitNotificacion(data: any) {
  if (!io) return

  const destinatario = data?.usuario_id
  if (destinatario) {
    io.to(`user-${destinatario}`).emit('nueva-notificacion', data)
    return
  }

  console.warn('[sockets] nueva-notificacion sin usuario_id: se emite a todos')
  io.emit('nueva-notificacion', data)
}

/** Emit an actividad PESV event to all connected clients */
export function emitActividadPesv(event: 'actividad-pesv-created' | 'actividad-pesv-updated' | 'actividad-pesv-deleted', data: any) {
  if (io) {
    io.emit(event, data)
  }
}

/** Emit a facturacion-liquidacion event to all connected clients */
export function emitFacturacionLiquidacion(
  event:
    | 'facturacion-created'
    | 'facturacion-updated'
    | 'facturacion-anulada'
    | 'liquidacion-servicio-facturada',
  data: any,
  meta?: EventoSocketMeta,
) {
  emitConMeta(event, data, meta)
}
