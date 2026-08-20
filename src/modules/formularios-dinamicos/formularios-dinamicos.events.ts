/**
 * Eventos Socket.IO del módulo.
 *
 * DOS REGLAS, y las dos existen por un fallo concreto que evitan:
 *
 *  1. **Se emite solo DESPUÉS del commit.** Emitir dentro de la transacción
 *     hace que los clientes invaliden su caché y hagan un GET que todavía no ve
 *     los datos; si además la transacción termina en rollback, quedan
 *     mostrando algo que nunca existió. Por eso `emitir()` se llama fuera del
 *     `prisma.$transaction`, nunca dentro.
 *
 *  2. **El payload no lleva datos.** Solo ids, `revision` y `occurredAt`: el
 *     evento sirve para invalidar, y HTTP sigue siendo la autoridad. Meter la
 *     definición o las respuestas convertiría el socket en un canal de
 *     distribución de datos personales sin control de permisos por room.
 *
 * `eventId` permite deduplicar en el cliente: la reconexión reenvía y el runner
 * no debe procesar dos veces el mismo aviso.
 */

import { randomUUID } from 'crypto'
import { getIo } from '../../sockets'
import { logger } from '../../utils/logger'

export const FORM_EVENTS = {
  assignmentChanged: 'forms:assignment.changed',
  versionPublished: 'forms:version.published',
  submissionAccepted: 'forms:submission.accepted',
  submissionVoided: 'forms:submission.voided',
  attachmentReady: 'forms:attachment.ready',
} as const

export type FormEvent = (typeof FORM_EVENTS)[keyof typeof FORM_EVENTS]

/** Room del dashboard. Solo entran usuarios con permiso `formularios`. */
export const ADMIN_ROOM = 'forms:admin'

/** Room de un conductor. El id lo deriva el backend del token, nunca el cliente. */
export function conductorRoom(conductorId: string): string {
  return `conductor:${conductorId}:forms`
}

interface EventPayload {
  [key: string]: unknown
}

/**
 * Emite a los rooms indicados.
 *
 * Nunca lanza: un socket caído no debe tumbar una petición HTTP que ya hizo
 * commit. Si el `io` no está inicializado (tests, scripts) se registra y se
 * sigue.
 */
function emitir(event: FormEvent, rooms: string[], payload: EventPayload): void {
  const sobre = { eventId: randomUUID(), occurredAt: new Date().toISOString(), ...payload }
  try {
    const io = getIo()
    for (const room of new Set(rooms)) {
      io.to(room).emit(event, sobre)
    }
  } catch (err) {
    logger.warn(
      { type: 'forms-socket-emit-failed', event, rooms, error: err instanceof Error ? err.message : String(err) },
      '[formularios] no se pudo emitir el evento; HTTP sigue siendo la autoridad',
    )
  }
}

export const formEvents = {
  /** Cambió la audiencia, la vigencia o el estado de una asignación. */
  assignmentChanged(params: {
    assignmentId: string
    versionId: string
    formId: string
    status: string
    /** Conductores concretos afectados. Vacío → solo el room admin. */
    conductorIds?: string[]
  }): void {
    emitir(
      FORM_EVENTS.assignmentChanged,
      [ADMIN_ROOM, ...(params.conductorIds ?? []).map(conductorRoom)],
      {
        assignmentId: params.assignmentId,
        versionId: params.versionId,
        formId: params.formId,
        status: params.status,
      },
    )
  },

  /**
   * Se publicó una versión. El `revision` va en el payload para que un cliente
   * con la definición cacheada sepa si su ETag quedó obsoleto sin pedirla.
   */
  versionPublished(params: {
    formId: string
    versionId: string
    versionNumber: number
    revision: number
    conductorIds?: string[]
  }): void {
    emitir(FORM_EVENTS.versionPublished, [ADMIN_ROOM, ...(params.conductorIds ?? []).map(conductorRoom)], {
      formId: params.formId,
      versionId: params.versionId,
      versionNumber: params.versionNumber,
      revision: params.revision,
    })
  },

  /**
   * El servidor aceptó un envío.
   *
   * `idempotentReplay` distingue "se guardó ahora" de "ya estaba guardado": el
   * segundo caso es el reintento de una outbox que perdió la respuesta, y el
   * portal no debe mostrar dos confirmaciones.
   */
  submissionAccepted(params: {
    conductorId: string
    submissionId: string
    clientSubmissionId: string
    assignmentId: string
    businessDate: string
    idempotentReplay: boolean
  }): void {
    emitir(FORM_EVENTS.submissionAccepted, [conductorRoom(params.conductorId), ADMIN_ROOM], {
      submissionId: params.submissionId,
      clientSubmissionId: params.clientSubmissionId,
      assignmentId: params.assignmentId,
      businessDate: params.businessDate,
      idempotentReplay: params.idempotentReplay,
    })
  },

  submissionVoided(params: { conductorId: string; submissionId: string; assignmentId: string }): void {
    emitir(FORM_EVENTS.submissionVoided, [conductorRoom(params.conductorId), ADMIN_ROOM], {
      submissionId: params.submissionId,
      assignmentId: params.assignmentId,
    })
  },

  /** Un adjunto quedó verificado; la outbox puede continuar con el SUBMIT. */
  attachmentReady(params: {
    conductorId: string
    submissionId: string
    attachmentId: string
    clientAttachmentId: string
  }): void {
    emitir(FORM_EVENTS.attachmentReady, [conductorRoom(params.conductorId)], {
      submissionId: params.submissionId,
      attachmentId: params.attachmentId,
      clientAttachmentId: params.clientAttachmentId,
    })
  },
}
