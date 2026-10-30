import { getIo } from '../../sockets'

export interface EventoConsultaSimitActualizada {
  tipo: 'vehiculo' | 'conductor'
  entidad_id: string
  consulta_id: string
  consultado_at: string
  estado_consulta: 'en_curso' | 'sin_deuda' | 'con_deuda' | 'error'
}

/** Notifica una consulta persistida sin enviar al socket sus datos financieros. */
export function emitirConsultaSimitActualizada(evento: EventoConsultaSimitActualizada): void {
  try {
    getIo().emit('simit:consulta:actualizada', evento)
  } catch {
    /* El resultado ya quedó guardado; Socket.IO no debe revertirlo. */
  }
}
