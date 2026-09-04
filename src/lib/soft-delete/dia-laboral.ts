/**
 * Borrado lógico de un día laborado y de todo lo que cuelga de él.
 *
 * EL PROBLEMA QUE RESUELVE
 *
 * `registro_dia_laboral` y `registro_dia_laboral_segmento` ya tenían
 * `deleted_at`, pero el código los borraba físicamente: el guardado destruía
 * los segmentos anteriores en cada pasada, y el endpoint de borrado —incluido
 * el del PORTAL DEL CONDUCTOR, donde quien acciona es un usuario final y no un
 * administrador— destruía el día entero. Con él se iban sus bonos, que llevan
 * `valor`.
 *
 * POR QUÉ VIVE AQUÍ Y NO EN EL SERVICIO
 *
 * El servicio de días laborados arrastra el stack de sockets y la cola de
 * nómina al importarse. Un test que solo quiere comprobar el marcado no debería
 * necesitar Redis levantado, así que la lógica está en un módulo que no importa
 * nada más que Prisma.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '../../config/prisma'

/**
 * Retira los segmentos activos de un día y, con ellos, sus bonos.
 *
 * Marcar el segmento sin marcar sus bonos dejaría filas con `valor` colgando de
 * algo que ya nadie ve, y la consulta de bonos busca por `registro_dia_id`, no
 * por segmento: se seguirían pagando. Van juntos o no van.
 */
export async function retirarSegmentos(
  tx: Prisma.TransactionClient,
  registroDiaId: string
): Promise<void> {
  const ahora = new Date()

  await tx.registro_dia_laboral_bono.updateMany({
    where: {
      deleted_at: null,
      segmento: { registro_dia_id: registroDiaId }
    },
    data: { deleted_at: ahora }
  })

  await tx.registro_dia_laboral_segmento.updateMany({
    where: { registro_dia_id: registroDiaId, deleted_at: null },
    data: { deleted_at: ahora }
  })
}

/**
 * Retira un día laborado entero: el registro, sus segmentos y sus bonos.
 *
 * El registro se MARCA, no se borra. La unicidad `(conductor_id, fecha)` sigue
 * siendo global a propósito, así que la fila marcada conserva su día y el
 * `upsert` del guardado la revive si el conductor vuelve a registrarlo. Sin
 * eso, un día borrado por error quedaría bloqueado para siempre.
 */
export async function retirarDiaLaboral(registroId: string): Promise<void> {
  const ahora = new Date()

  await prisma.$transaction(async (tx) => {
    await retirarSegmentos(tx, registroId)

    /// Los bonos que cuelgan del día pero no de un segmento —los hay— se
    /// marcan aquí: `retirarSegmentos` solo alcanza los que tienen segmento.
    await tx.registro_dia_laboral_bono.updateMany({
      where: { registro_dia_id: registroId, deleted_at: null },
      data: { deleted_at: ahora }
    })

    await tx.registro_dia_laboral.updateMany({
      where: { id: registroId, deleted_at: null },
      data: { deleted_at: ahora }
    })
  })
}
