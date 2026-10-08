import { prisma } from '../../config/prisma'
import { logger } from '../../utils/logger'

/**
 * Push a los teléfonos donde un usuario del dashboard tiene la app de gestión.
 *
 * El aviso de verdad es la fila de `notificacion` (la campana de la web), que el
 * llamador ya escribió: esto es un intento adicional y nunca lanza. Un usuario
 * sin dispositivos registrados simplemente no recibe push.
 */

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'

interface ExpoTicket {
  status: 'ok' | 'error'
  id?: string
  message?: string
  details?: { error?: string }
}

export async function enviarPushUsuarios(params: {
  usuarioIds: string[]
  titulo: string
  cuerpo: string
  /** `route` (ruta de la app, p. ej. `/gestion/liquidacion/<id>`) abre esa pantalla al tocar el aviso. */
  datos: Record<string, unknown>
  /** Canal de Android; debe existir en la app. */
  canal: string
}): Promise<void> {
  const usuarioIds = [...new Set(params.usuarioIds)].filter(Boolean)
  if (!usuarioIds.length) return
  try {
    const dispositivos = await prisma.usuario_push_device.findMany({
      where: { usuario_id: { in: usuarioIds }, activo: true },
      select: { id: true, expo_push_token: true },
    })
    if (!dispositivos.length) return

    const response = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Accept-Encoding': 'gzip, deflate', 'Content-Type': 'application/json' },
      body: JSON.stringify(
        dispositivos.map((d) => ({
          to: d.expo_push_token,
          sound: 'default',
          channelId: params.canal,
          priority: 'high',
          title: params.titulo,
          body: params.cuerpo,
          data: params.datos,
        })),
      ),
    })
    const payload = (await response.json().catch(() => null)) as { data?: ExpoTicket[]; errors?: { message?: string }[] } | null
    if (!response.ok) throw new Error(payload?.errors?.[0]?.message ?? `Expo Push respondió ${response.status}.`)

    /// Un token que Expo declara muerto se desactiva: se reinstaló la app o se revocó el permiso.
    const muertos = (payload?.data ?? [])
      .map((ticket, i) => (ticket.details?.error === 'DeviceNotRegistered' ? dispositivos[i]?.id : undefined))
      .filter((id): id is string => Boolean(id))
    if (muertos.length) await prisma.usuario_push_device.updateMany({ where: { id: { in: muertos } }, data: { activo: false } })
  } catch (error) {
    logger.error({ err: error, usuarioIds, titulo: params.titulo }, 'Fallo al enviar push a usuarios')
  }
}

/** Registra (o reasigna) el token de un teléfono al usuario que tiene la sesión abierta. */
export async function registrarDispositivoUsuario(usuarioId: string, token: string, plataforma: string) {
  return prisma.usuario_push_device.upsert({
    where: { expo_push_token: token },
    create: { usuario_id: usuarioId, expo_push_token: token, plataforma },
    update: { usuario_id: usuarioId, plataforma, activo: true, last_seen_at: new Date() },
    select: { id: true },
  })
}

export async function desactivarDispositivoUsuario(usuarioId: string, token: string) {
  await prisma.usuario_push_device.updateMany({ where: { usuario_id: usuarioId, expo_push_token: token }, data: { activo: false } })
}
