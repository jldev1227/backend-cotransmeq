import { Socket } from 'socket.io'

declare global {
  namespace NodeJS {
    interface ProcessEnv { }
  }

  interface SocketWithUser extends Socket {
    user?: any
  }
}
