import { Prisma } from '@prisma/client'
import { prisma } from '../../config/prisma'
import { emitNotificacion } from '../../sockets'
import { logger } from '../../utils/logger'
import { CODIGOS_PREOPERACIONAL } from '../dashboard/seccion-hseq'

/**
 * Aviso inmediato a mantenimiento cuando llega un preoperacional con ítems en
 * «Malo».
 *
 * Solo avisa: NO bloquea el inicio del servicio ni la asignación del vehículo.
 * Esa decisión la sigue tomando la gente (un espejo flojo no es lo mismo que
 * los frenos), y un bloqueo automático dejaría a un conductor varado en patio
 * sin nadie que lo pueda destrabar a esa hora.
 *
 * Un aviso por envío (`referencia_tipo = 'preop_malo'`, `referencia_id` = el
 * envío). El front lo abre en `/dashboard/mantenimiento?preoperacional=<id>`
 * —las novedades del envío, con «crear orden correctiva»— y no directo en
 * `/dashboard/formularios/envios/<id>`: esa pantalla es del módulo
 * `formularios`, que el área mantenimiento no tiene, y el aviso la habría
 * llevado a una página prohibida. Desde el resumen, quien sí tiene
 * `formularios` puede saltar al envío completo. Es una huella distinta de `preoperacional`
 * —el aviso general que ya reciben operaciones, HSEQ y administración— para
 * que los dos no se pisen al deduplicar y para que mantenimiento no reciba
 * cada preoperacional, solo los que traen novedades.
 *
 * Nunca lanza: es un efecto secundario del envío y no puede tumbarlo.
 */

/// Valor de la opción «Malo» en el checklist (Bueno `B` / Malo `M` / No aplica
/// `NA`). Es el mismo criterio de la sección «Mantenimiento» del panel.
export const VALOR_MALO = 'M'

/// Áreas que reciben el aviso. Mantenimiento es quien saca el vehículo a taller.
const AREAS_DESTINO = ['mantenimiento']

export const REFERENCIA_PREOP_MALO = 'preop_malo'

/**
 * Etiqueta de un ítem sin su ayuda entre paréntesis: «Frenos (estado de
 * pastillas y líquido)» → «Frenos». Igual que en el panel.
 */
export const limpiarEtiqueta = (label: string) => label.replace(/\s*\(.*$/, '')

export interface ItemMalo {
  key: string
  label: string
  observacion: string | null
}

/**
 * Ítems en «Malo» de un envío ENTREGADO, con la observación de su campo
 * `<clave>_obs` si la hay.
 *
 * Solo `SUBMITTED`: un envío entregado guarda la opción elegida en
 * `form_answer_options`; un borrador la guarda envuelta en `value_json` y no
 * aparecería aquí (ni debe: un borrador no es una inspección hecha).
 */
export async function itemsEnMaloDeEnvio(submissionId: string): Promise<ItemMalo[]> {
  const filas = await prisma.$queryRaw<Array<{ key: string; label: string; observacion: string | null }>>(Prisma.sql`
    SELECT f.key, f.label,
           (SELECT a2.value_text FROM form_answers a2 JOIN form_fields f2 ON f2.id = a2.field_id
             WHERE a2.submission_id = s.id AND f2.key = f.key || '_obs' LIMIT 1) AS observacion
    FROM form_submissions s
    JOIN form_versions v ON v.id = s.version_id
    JOIN form_definitions d ON d.id = v.form_id AND d.code IN (${Prisma.join(CODIGOS_PREOPERACIONAL)})
    JOIN form_answers a ON a.submission_id = s.id
    JOIN form_answer_options ao ON ao.answer_id = a.id
    JOIN form_field_options o ON o.id = ao.option_id AND o.value = ${VALOR_MALO}
    JOIN form_fields f ON f.id = a.field_id
    WHERE s.id = ${submissionId}::uuid AND s.deleted_at IS NULL AND s.status = 'SUBMITTED'
    ORDER BY f.sort_order`)
  return filas.map((f) => ({ key: f.key, label: limpiarEtiqueta(f.label), observacion: f.observacion?.trim() || null }))
}

/**
 * Lo que mantenimiento necesita de un preoperacional: quién, qué vehículo,
 * cuándo y qué quedó en «Malo». Se sirve desde el módulo de mantenimiento
 * para no exigir el permiso de `formularios` a quien solo tiene que reparar.
 * `null` si el envío no existe, no está entregado o no es un preoperacional.
 */
export async function novedadesDeEnvio(submissionId: string) {
  const envio = await prisma.form_submission.findFirst({
    where: { id: submissionId, deleted_at: null, status: 'SUBMITTED', version: { form: { code: { in: CODIGOS_PREOPERACIONAL } } } },
    select: {
      id: true,
      business_date: true,
      submitted_at: true,
      conductor: { select: { nombre: true, apellido: true } },
      usuario: { select: { nombre: true } },
      vehiculo: { select: { id: true, placa: true, marca: true, linea: true, kilometraje: true } },
      version: { select: { title: true, form: { select: { name: true, code: true } } } },
    },
  })
  if (!envio) return null
  const items = await itemsEnMaloDeEnvio(submissionId)
  return {
    id: envio.id,
    formulario: envio.version.form.name || envio.version.title,
    codigo: envio.version.form.code,
    fecha: envio.business_date.toISOString().slice(0, 10),
    enviado_at: envio.submitted_at?.toISOString() ?? null,
    conductor: envio.conductor ? `${envio.conductor.nombre} ${envio.conductor.apellido}`.trim() : (envio.usuario?.nombre ?? null),
    vehiculo: envio.vehiculo
      ? { id: envio.vehiculo.id, placa: envio.vehiculo.placa, marca: envio.vehiculo.marca, linea: envio.vehiculo.linea, km_actual: envio.vehiculo.kilometraje && envio.vehiculo.kilometraje > 0 ? envio.vehiculo.kilometraje : null }
      : null,
    items,
  }
}

/** Texto del aviso. Aparte para poder probarlo sin base. */
export function textoAvisoMalo(params: { placa: string | null; conductor: string | null; fecha: string; items: ItemMalo[] }) {
  const n = params.items.length
  const placa = params.placa ?? 'sin placa'
  const MOSTRAR = 4
  const nombres = params.items.slice(0, MOSTRAR).map((i) => (i.observacion ? `${i.label} («${i.observacion.slice(0, 60)}»)` : i.label))
  const resto = n > MOSTRAR ? ` y ${n - MOSTRAR} más` : ''
  const fecha = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${params.fecha}T00:00:00Z`))
  return {
    titulo: `🔧 ${n} ${n === 1 ? 'ítem' : 'ítems'} en Malo · ${placa}`.slice(0, 255),
    mensaje: `${params.conductor ?? 'El conductor'} reportó en el preoperacional del ${fecha}: ${nombres.join(', ')}${resto}. Revisa el vehículo antes de su próximo servicio.`,
  }
}

/**
 * Avisa a mantenimiento si el envío es un preoperacional con ítems en «Malo».
 * Idempotente: a quien ya recibió el aviso de este envío no se le repite (un
 * reintento de la outbox del portal no duplica nada).
 */
export async function avisarNovedadesPreoperacional(submissionId: string): Promise<{ items: number; avisos: number }> {
  try {
    const envio = await prisma.form_submission.findFirst({
      where: { id: submissionId, deleted_at: null, status: 'SUBMITTED', version: { form: { code: { in: CODIGOS_PREOPERACIONAL } } } },
      select: {
        business_date: true,
        conductor: { select: { nombre: true, apellido: true } },
        usuario: { select: { nombre: true } },
        vehiculo: { select: { placa: true } },
      },
    })
    if (!envio) return { items: 0, avisos: 0 }
    const items = await itemsEnMaloDeEnvio(submissionId)
    if (!items.length) return { items: 0, avisos: 0 }

    const destinatarios = await prisma.usuarios.findMany({
      where: { activo: true, area: { hasSome: AREAS_DESTINO } },
      select: { id: true },
    })
    const yaAvisados = new Set(
      (
        await prisma.notificacion.findMany({
          where: { referencia_id: submissionId, referencia_tipo: REFERENCIA_PREOP_MALO },
          select: { usuario_id: true },
        })
      ).map((n) => n.usuario_id),
    )
    const pendientes = destinatarios.filter((d) => !yaAvisados.has(d.id))
    if (!pendientes.length) return { items: items.length, avisos: 0 }

    const conductor = envio.conductor
      ? `${envio.conductor.nombre} ${envio.conductor.apellido}`.trim()
      : (envio.usuario?.nombre ?? null)
    const { titulo, mensaje } = textoAvisoMalo({
      placa: envio.vehiculo?.placa ?? null,
      conductor,
      fecha: envio.business_date.toISOString().slice(0, 10),
      items,
    })
    const creadas = await prisma.notificacion.createManyAndReturn({
      data: pendientes.map((u) => ({
        usuario_id: u.id,
        tipo: 'GENERAL' as const,
        titulo,
        mensaje,
        referencia_id: submissionId,
        referencia_tipo: REFERENCIA_PREOP_MALO,
      })),
    })
    for (const n of creadas) emitNotificacion(n)
    return { items: items.length, avisos: creadas.length }
  } catch (error) {
    logger.error({ err: error, submissionId }, 'No se pudo avisar a mantenimiento del preoperacional con novedades')
    return { items: 0, avisos: 0 }
  }
}
