import { Server as HttpServer } from 'http'
import { Server as IOServer } from 'socket.io'

let io: IOServer | null = null

export function initSockets(server: HttpServer) {
  io = new IOServer(server, { cors: { origin: '*' } })
  io.on('connection', socket => {
    console.log('socket connected', socket.id)
    socket.on('ping', () => socket.emit('pong'))
    
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
  return io
}

export function getIo() {
  if (!io) throw new Error('Socket.io not initialized')
  return io
}
