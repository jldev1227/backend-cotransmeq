import { prisma } from '../../config/prisma'
import { logger } from '../../utils/logger'
import { enviarPushConductor } from '../conductor-portal/conductor-push.service'
import { avisarEquipo } from '../avisos-equipo/avisos-equipo.service'

/** El FUEC queda en el buzón aunque el teléfono no tenga push disponible. */
export async function notificarFuecEmitido(extracto: {
  id: string
  numero_completo: string
  placa: string
  vigencia_desde: string
  vigencia_hasta: string
  conductores: Array<{ conductor_id: string | null }>
}): Promise<void> {
  const titulo = 'Tienes un nuevo extracto FUEC'
  const cuerpo = `FUEC ${extracto.numero_completo} · ${extracto.placa} · ${extracto.vigencia_desde} al ${extracto.vigencia_hasta}`
  const datos = { type: 'FUEC_EMITIDO', extracto_id: extracto.id, route: `/extractos/${extracto.id}` }
  for (const conductorId of new Set(extracto.conductores.map((c) => c.conductor_id).filter((id): id is string => !!id))) {
    try {
      const aviso = await prisma.conductor_notification.create({
        data: { conductor_id: conductorId, tipo: 'FUEC_EMITIDO', titulo, cuerpo, datos },
      })
      await enviarPushConductor({ conductorId, notificacionId: aviso.id, titulo, cuerpo, datos, canal: 'extractos' })
    } catch (error) {
      /// Una caída de Expo o del buzón no debe deshacer el FUEC firmado.
      logger.error({ err: error, extractoId: extracto.id, conductorId }, 'No fue posible avisar del FUEC emitido')
    }
  }
}

/** Aviso de la campana de Operaciones, también visible en la app de gestión. */
export async function notificarOperacionesFuecEmitido(extracto: {
  id: string
  consecutivo: number
  numero_completo: string
  placa: string
  contratante_nombre: string
  creado_por: { nombre: string } | null
}): Promise<void> {
  await avisarEquipo({
    evento: 'fuec_creado',
    titulo: `Nuevo FUEC · consecutivo ${extracto.consecutivo}`,
    mensaje: `${extracto.creado_por?.nombre ?? 'Un usuario'} creó el FUEC No. ${extracto.numero_completo} para ${extracto.contratante_nombre || 'un contratante'} · placa ${extracto.placa}.`,
    referencia_id: extracto.id,
    referencia_tipo: 'extracto',
  })
}
