import { EventEmitter } from 'node:events'

/** Eventos sin respuestas ni datos personales; los clientes vuelven a consultar el recurso. */
export const EVENTOS_ENCUESTAS = {
  respuesta: 'encuestas:respuesta',
  actualizada: 'encuestas:actualizada',
} as const

export interface ActualizacionEncuesta {
  encuestaId: string
  actualizada_at: string
  estado: string
}

const cambiosLocales = new EventEmitter()

/** Canal local para los streams públicos; Socket.IO sigue notificando a los paneles autenticados. */
export function emitirActualizacionEncuesta(evento: ActualizacionEncuesta): void {
  cambiosLocales.emit(EVENTOS_ENCUESTAS.actualizada, evento)
}

export function escucharActualizacionEncuesta(encuestaId: string, callback: (evento: ActualizacionEncuesta) => void): () => void {
  const listener = (evento: ActualizacionEncuesta) => {
    if (evento.encuestaId === encuestaId) callback(evento)
  }
  cambiosLocales.on(EVENTOS_ENCUESTAS.actualizada, listener)
  return () => cambiosLocales.off(EVENTOS_ENCUESTAS.actualizada, listener)
}
