import { prisma } from '../../config/prisma'
import { getS3SignedUrl } from '../../config/aws'
import { logger } from '../../utils/logger'
import { etapasCerradas } from '../conductor-portal/ejecucion-servicio.service'

/**
 * Lo que hizo el conductor con un servicio desde la app, visto por operaciones:
 * inicio y liberación (`servicio_ejecucion`), el preoperacional con el que lo
 * inició, las fotos de la etapa 2 («Durante el desplazamiento», donde van las
 * pausas activas) y el reporte del recorrido.
 *
 * Es sólo lectura. Quien escribe es el portal del conductor
 * (`conductor-portal/ejecucion-servicio.service.ts`).
 */

/** Etapa del preoperacional por etapas en la que se registran las pausas activas. */
const ETAPA_DESPLAZAMIENTO = 2
/** Campo de evidencia de pausas activas (versión por etapas, revisión 2). Va primero. */
const CAMPO_PAUSAS_ACTIVAS = 'pausas_activas_evidencia'

export async function obtenerEjecucionServicio(servicioId: string) {
  const servicio = await prisma.servicio.findFirst({
    where: { id: servicioId, deleted_at: null },
    select: {
      id: true,
      ejecucion: {
        include: {
          preoperacional: {
            select: {
              id: true,
              client_submission_id: true,
              status: true,
              business_date: true,
              submitted_at: true,
              device_json: true,
              deleted_at: true,
              version: {
                select: { version_number: true, title: true, form: { select: { code: true, name: true } } }
              }
            }
          }
        }
      }
    }
  })
  if (!servicio) return null

  const ejecucion = servicio.ejecucion
  if (!ejecucion) return { ejecucion: null, preoperacional: null, fotos_desplazamiento: [] }

  const sub = ejecucion.preoperacional
  const preoperacional = sub
    ? {
        submission_id: sub.id,
        client_submission_id: sub.client_submission_id,
        code: sub.version.form.code,
        nombre: sub.version.form.name,
        version_number: sub.version.version_number,
        status: sub.status,
        eliminado: sub.deleted_at !== null,
        business_date: sub.business_date.toISOString().slice(0, 10),
        submitted_at: sub.submitted_at?.toISOString() ?? null,
        etapas_cerradas: etapasCerradas(sub.status, sub.device_json),
        detalle_path: `/dashboard/formularios/envios/${sub.id}`
      }
    : null

  const fotos_desplazamiento = sub ? await fotosDeDesplazamiento(sub.id) : []

  const reporte = {
    km_final: ejecucion.km_final,
    via_trocha: ejecucion.via_trocha,
    via_afirmado: ejecucion.via_afirmado,
    via_mixto: ejecucion.via_mixto,
    via_pavimentada: ejecucion.via_pavimentada,
    riesgo_desniveles: ejecucion.riesgo_desniveles,
    riesgo_deslizamientos: ejecucion.riesgo_deslizamientos,
    riesgo_sin_senalizacion: ejecucion.riesgo_sin_senalizacion,
    riesgo_animales: ejecucion.riesgo_animales,
    riesgo_peatones: ejecucion.riesgo_peatones,
    riesgo_trafico_alto: ejecucion.riesgo_trafico_alto,
    estado_conductor: ejecucion.estado_conductor,
    novedades: ejecucion.novedades
  }
  const tieneReporte = Object.values(reporte).some((v) => v !== null)

  return {
    ejecucion: {
      conductor_id: ejecucion.conductor_id,
      formato_elegido_por_conductor: ejecucion.formato_elegido_por_conductor,
      iniciado_at: ejecucion.iniciado_at?.toISOString() ?? null,
      iniciado_dispositivo_at: ejecucion.iniciado_dispositivo_at?.toISOString() ?? null,
      iniciado_diferido: ejecucion.iniciado_diferido,
      liberado_at: ejecucion.liberado_at?.toISOString() ?? null,
      liberado_registrado_at: ejecucion.liberado_registrado_at?.toISOString() ?? null,
      liberado_dispositivo_at: ejecucion.liberado_dispositivo_at?.toISOString() ?? null,
      liberado_diferido: ejecucion.liberado_diferido,
      reporte: tieneReporte ? reporte : null
    },
    preoperacional,
    fotos_desplazamiento
  }
}

/**
 * Fotos subidas en campos PHOTO de la etapa 2 del preoperacional, con URL
 * firmada. Las de pausas activas van primero. Una firma que falla se registra
 * y se omite: no debe tumbar el resto de la vista.
 */
async function fotosDeDesplazamiento(submissionId: string) {
  const adjuntos = await prisma.form_attachment.findMany({
    where: {
      submission_id: submissionId,
      kind: 'PHOTO',
      status: 'UPLOADED',
      object_key: { not: null },
      answer: {
        field: {
          type: 'PHOTO',
          section: { settings_json: { path: ['etapa'], equals: ETAPA_DESPLAZAMIENTO } }
        }
      }
    },
    select: {
      id: true,
      object_key: true,
      mime_type: true,
      original_name: true,
      uploaded_at: true,
      created_at: true,
      answer: { select: { field: { select: { key: true, label: true } } } }
    },
    orderBy: { created_at: 'asc' }
  })

  const fotos = await Promise.all(
    adjuntos.map(async (a) => {
      try {
        return {
          id: a.id,
          field_key: a.answer?.field.key ?? null,
          field_label: a.answer?.field.label ?? null,
          pausa_activa: a.answer?.field.key === CAMPO_PAUSAS_ACTIVAS,
          mime_type: a.mime_type,
          original_name: a.original_name,
          uploaded_at: (a.uploaded_at ?? a.created_at).toISOString(),
          url: await getS3SignedUrl(a.object_key!)
        }
      } catch (err) {
        logger.warn(
          {
            type: 'servicio-ejecucion-foto-sign-failed',
            attachmentId: a.id,
            error: err instanceof Error ? err.message : String(err)
          },
          '[servicios] no se pudo firmar la foto del preoperacional'
        )
        return null
      }
    })
  )

  return fotos
    .filter((f): f is NonNullable<typeof f> => f !== null)
    .sort((x, y) => Number(y.pausa_activa) - Number(x.pausa_activa))
}
