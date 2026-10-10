import webpush from 'web-push'
import { prisma } from '../../config/prisma'
import { env } from '../../config/env'
import { logger } from '../../utils/logger'

/**
 * Web Push: la campana del dashboard llevada al sistema operativo.
 *
 * Cada notificación que se entrega por socket (`emitNotificacion`) también se
 * manda, por aquí, a los navegadores donde su destinatario activó los avisos.
 * Así llega aunque el usuario no tenga la app abierta: el service worker la
 * recibe y Chrome la muestra como aviso de Windows/macOS/Android.
 *
 * Igual que el push de Expo, es un intento adicional: la fila de
 * `notificacion` ya se escribió y nada de lo que pase aquí la afecta ni lanza.
 *
 * Decidir si se muestra o no (por ejemplo, si el usuario está mirando la
 * pestaña en ese momento) es cosa del service worker: el servidor no sabe qué
 * pestaña tiene el foco.
 */

/** Lo que viaja al service worker. Debe caber en ~4 KB cifrado. */
export interface PayloadWebPush {
  id: string | null
  tipo: string
  titulo: string
  mensaje: string
  referencia_id: string | null
  referencia_tipo: string | null
  created_at: string
  /** Mostrarlo aunque el dashboard esté a la vista (botón «Probar»). */
  forzar?: boolean
}

interface NotificacionEntregable {
  id?: string | null
  usuario_id?: string | null
  tipo?: string | null
  titulo?: string | null
  mensaje?: string | null
  referencia_id?: string | null
  referencia_tipo?: string | null
  created_at?: Date | string | null
}

/// Mensajes largos (resúmenes de cierres, listas) se recortan: el aviso del
/// sistema solo enseña unas líneas y el límite del payload es duro.
const MAX_MENSAJE = 400

let configurado: boolean | null = null

/** Configura VAPID una sola vez. Sin claves, el push web queda apagado. */
export function webPushHabilitado(): boolean {
  if (configurado !== null) return configurado
  const publica = env.VAPID_PUBLIC_KEY?.trim()
  const privada = env.VAPID_PRIVATE_KEY?.trim()
  if (!publica || !privada) {
    configurado = false
    return false
  }
  try {
    webpush.setVapidDetails(env.VAPID_SUBJECT?.trim() || 'mailto:sistemas@transmeralda.com', publica, privada)
    configurado = true
  } catch (error) {
    logger.error({ err: error }, 'Claves VAPID inválidas: el push web queda apagado')
    configurado = false
  }
  return configurado
}

export function clavePublicaVapid(): string | null {
  return webPushHabilitado() ? env.VAPID_PUBLIC_KEY!.trim() : null
}

export function payloadDe(n: NotificacionEntregable, opciones: { forzar?: boolean } = {}): PayloadWebPush {
  const mensaje = String(n.mensaje ?? '')
  return {
    id: n.id ?? null,
    tipo: n.tipo ?? 'GENERAL',
    titulo: String(n.titulo ?? 'Notificación'),
    mensaje: mensaje.length > MAX_MENSAJE ? `${mensaje.slice(0, MAX_MENSAJE - 1)}…` : mensaje,
    referencia_id: n.referencia_id ?? null,
    referencia_tipo: n.referencia_tipo ?? null,
    created_at: new Date(n.created_at ?? Date.now()).toISOString(),
    ...(opciones.forzar ? { forzar: true } : {}),
  }
}

/**
 * Envía una notificación a todos los navegadores activos de su destinatario.
 * Devuelve cuántos la aceptaron, para la prueba y el spec; los llamadores
 * normales lo ignoran.
 */
export async function enviarWebPush(
  n: NotificacionEntregable,
  opciones: { forzar?: boolean } = {},
): Promise<{ enviados: number; fallidos: number }> {
  const resultado = { enviados: 0, fallidos: 0 }
  if (!n?.usuario_id || !webPushHabilitado()) return resultado
  try {
    const suscripciones = await prisma.usuario_web_push.findMany({
      where: { usuario_id: n.usuario_id, activo: true },
      select: { id: true, endpoint: true, p256dh: true, auth: true },
    })
    if (!suscripciones.length) return resultado

    const cuerpo = JSON.stringify(payloadDe(n, opciones))
    const muertas: string[] = []
    await Promise.all(
      suscripciones.map(async (s) => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, cuerpo, {
            /// Si el equipo está apagado, el servicio de push la guarda un día;
            /// un recordatorio de hace una semana ya no sirve como aviso.
            TTL: 60 * 60 * 24,
            urgency: 'normal',
          })
          resultado.enviados++
        } catch (error: any) {
          resultado.fallidos++
          /// 404/410: el navegador revocó el permiso o borró la suscripción.
          if (error?.statusCode === 404 || error?.statusCode === 410) muertas.push(s.id)
          else logger.warn({ err: error?.body ?? error?.message, statusCode: error?.statusCode }, 'Web push rechazado')
        }
      }),
    )
    if (muertas.length) {
      await prisma.usuario_web_push.updateMany({ where: { id: { in: muertas } }, data: { activo: false } })
    }
  } catch (error) {
    logger.error({ err: error, usuario_id: n.usuario_id }, 'Fallo al enviar web push')
  }
  return resultado
}

/** Registra (o reasigna) la suscripción del navegador al usuario con sesión. */
export async function registrarSuscripcionWeb(
  usuarioId: string,
  sub: { endpoint: string; keys: { p256dh: string; auth: string } },
  userAgent?: string,
) {
  const datos = {
    usuario_id: usuarioId,
    p256dh: sub.keys.p256dh,
    auth: sub.keys.auth,
    user_agent: userAgent?.slice(0, 500) ?? null,
    activo: true,
    last_seen_at: new Date(),
  }
  return prisma.usuario_web_push.upsert({
    where: { endpoint: sub.endpoint },
    create: { endpoint: sub.endpoint, ...datos },
    update: datos,
    select: { id: true },
  })
}

/** Al desactivar o cerrar sesión: ese navegador deja de recibir avisos del usuario. */
export async function desactivarSuscripcionWeb(usuarioId: string, endpoint: string) {
  await prisma.usuario_web_push.updateMany({ where: { usuario_id: usuarioId, endpoint }, data: { activo: false } })
}
