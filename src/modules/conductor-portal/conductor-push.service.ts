import { prisma } from '../../config/prisma'
import { logger } from '../../utils/logger'

/**
 * Envío de push a los dispositivos de un conductor.
 *
 * Extraído del flujo de nómina, que fue el primero en necesitarlo. Aquel sigue
 * con su propia copia: migrarlo es un cambio aparte y no se toca un camino de
 * avisos de pago que ya funciona solo para compartir código.
 *
 * El contrato importante es el orden: el inbox se escribe SIEMPRE antes, y el
 * push es un intento posterior. Así el aviso existe aunque Expo, APNs/FCM o el
 * teléfono estén fuera de servicio, y la app lo recoge igualmente en su ronda
 * de sincronización.
 */

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'

interface ExpoTicket {
  status: 'ok' | 'error'
  id?: string
  message?: string
  details?: { error?: string }
}

async function enviarExpo(
  tokens: string[],
  contenido: { title: string; body: string; data: Record<string, unknown>; channelId: string },
): Promise<ExpoTicket[]> {
  const response = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip, deflate',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(
      tokens.map((to) => ({
        to,
        sound: 'default',
        channelId: contenido.channelId,
        priority: 'high',
        title: contenido.title,
        body: contenido.body,
        data: contenido.data,
      })),
    ),
  })
  const payload = (await response.json().catch(() => null)) as
    | { data?: ExpoTicket[]; errors?: { message?: string }[] }
    | null
  if (!response.ok) {
    throw new Error(payload?.errors?.[0]?.message ?? `Expo Push respondió ${response.status}.`)
  }
  return payload?.data ?? []
}

export type ResultadoPush = 'ENVIADA' | 'SIN_DISPOSITIVO' | 'ERROR'

/**
 * Intenta entregar un aviso ya registrado en el inbox.
 *
 * Nunca lanza: el aviso ya está guardado y el conductor lo verá al abrir la
 * app. Lo que pase con el push queda en `estado_push` y `error_push`, que es
 * donde hay que mirar cuando alguien dice «no me llegó nada».
 */
export async function enviarPushConductor(params: {
  conductorId: string
  notificacionId: string
  titulo: string
  cuerpo: string
  datos: Record<string, unknown>
  canal: string
}): Promise<ResultadoPush> {
  try {
    const dispositivos = await prisma.conductor_push_device.findMany({
      where: { conductor_id: params.conductorId, activo: true },
      select: { id: true, expo_push_token: true },
    })

    if (!dispositivos.length) {
      await prisma.conductor_notification.update({
        where: { id: params.notificacionId },
        data: { estado_push: 'SIN_DISPOSITIVO' },
      })
      return 'SIN_DISPOSITIVO'
    }

    const tickets = await enviarExpo(
      dispositivos.map((item) => item.expo_push_token),
      { title: params.titulo, body: params.cuerpo, data: params.datos, channelId: params.canal },
    )

    /// Un token que Expo declara muerto se desactiva aquí. Sin esto, cada aviso
    /// futuro volvería a intentarlo y a fallar: el teléfono se reinstaló, se
    /// cambió, o el usuario revocó el permiso.
    for (const [indice, ticket] of tickets.entries()) {
      if (ticket.details?.error === 'DeviceNotRegistered' && dispositivos[indice]) {
        await prisma.conductor_push_device.update({
          where: { id: dispositivos[indice].id },
          data: { activo: false },
        })
      }
    }

    const aceptado = tickets.find((ticket) => ticket.status === 'ok')
    const errores = tickets.filter((ticket) => ticket.status === 'error')

    if (!aceptado) {
      const detalle =
        errores.map((t) => t.message ?? t.details?.error).filter(Boolean).join('; ') ||
        'Expo no aceptó ningún dispositivo.'
      await prisma.conductor_notification.update({
        where: { id: params.notificacionId },
        data: { estado_push: 'ERROR', error_push: detalle },
      })
      return 'ERROR'
    }

    await prisma.conductor_notification.update({
      where: { id: params.notificacionId },
      data: {
        estado_push: 'ENVIADA',
        expo_ticket_id: aceptado.id ?? null,
        enviada_at: new Date(),
        error_push: errores.length ? errores.map((t) => t.message).join('; ') : null,
      },
    })
    return 'ENVIADA'
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : 'No se pudo enviar el push.'
    logger.error({ err: error, ...params }, 'Fallo al enviar push al conductor')
    await prisma.conductor_notification
      .update({
        where: { id: params.notificacionId },
        data: { estado_push: 'ERROR', error_push: mensaje },
      })
      .catch(() => undefined)
    return 'ERROR'
  }
}
