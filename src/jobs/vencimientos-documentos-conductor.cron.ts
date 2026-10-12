import { CronJob } from 'cron'
import { Prisma } from '@prisma/client'
import { prisma } from '../config/prisma'
import { NotificacionesService } from '../modules/notificaciones/notificaciones.service'
import {
  CATEGORIAS_DOCUMENTO_CONDUCTOR,
  CATEGORIA_CONDUCTOR_POR_CLAVE,
  type CategoriaDocumentoConductor,
} from '../modules/conductores-documentos/catalogo'
import {
  DIAS_AVISO_VENCIDO,
  UMBRALES,
  diasAvisoDe,
  referenciaAviso,
  umbralDe,
} from '../modules/conductores-documentos/vigencia'
import { emitNotificacion } from '../sockets'
import { logger } from '../utils/logger'

/**
 * Avisos de vencimiento de los documentos del conductor (licencia, exámenes,
 * cursos, seguridad social, SIMIT, antecedentes).
 *
 * Mismo esquema que el de los documentos del vehículo: para el documento
 * actual de cada conductor y categoría (el `vigente` de vencimiento más
 * lejano) calcula el umbral y avisa una sola vez por umbral, con la huella
 * `doccond:<categoría>:<vence>:<umbral>` en `referencia_tipo`.
 *
 * La licencia sale de `conductores.vencimiento_licencia` aunque no haya
 * archivo: es la fecha que usa el FUEC, y casi ninguna licencia está cargada
 * todavía como documento. Avisar solo de las que tienen archivo dejaría
 * fuera justo las que más importan.
 *
 * Solo conductores vinculados (los mismos que cuenta el panel de talento
 * humano: ni inactivos, ni retirados, ni desvinculados) y no ocultos.
 */

/// Talento humano gestiona la renovación; HSEQ y administración responden por
/// la documentación ante clientes y en la auditoría del PESV.
const AREAS_DESTINO = ['talento_humano', 'hseq', 'administracion']
const ESTADOS_FUERA = ['inactivo', 'retirado', 'desvinculado']

const CATEGORIAS_VENCEN = CATEGORIAS_DOCUMENTO_CONDUCTOR.filter((c) => c.vence).map((c) => c.clave)
/// Ventana de la consulta: la más ancha de las categorías; cada fila se
/// recorta luego con la suya en `umbralDe`.
const VENTANA_DIAS = Math.max(UMBRALES[0], ...CATEGORIAS_DOCUMENTO_CONDUCTOR.filter((c) => c.vence).map((c) => diasAvisoDe(c)))

export function textoAviso(
  cat: Pick<CategoriaDocumentoConductor, 'etiqueta' | 'etiquetaFecha'>,
  conductor: string,
  dias: number,
  vence: string,
): { titulo: string; mensaje: string } {
  const fecha = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${vence}T00:00:00Z`),
  )
  const donde = 'en la hoja de vida del conductor (pestaña Documentos)'
  /// Una consulta (SIMIT, antecedentes) no vence: toca repetirla.
  if (cat.etiquetaFecha) {
    if (dias < 0) return { titulo: `⚠️ Pendiente: ${cat.etiqueta} · ${conductor}`, mensaje: `Tocaba actualizarla el ${fecha}. Súbela ${donde}.` }
    if (dias === 0) return { titulo: `⚠️ Toca hoy: ${cat.etiqueta} · ${conductor}`, mensaje: `Toca actualizarla hoy, ${fecha}. Súbela ${donde}.` }
    return {
      titulo: `${cat.etiqueta}: toca actualizarla en ${dias} ${dias === 1 ? 'día' : 'días'} · ${conductor}`,
      mensaje: `Toca actualizarla el ${fecha}. Súbela ${donde}.`,
    }
  }
  /// «Venció: Licencia de conducción» y no «… vencido»: el género cambia según el documento.
  if (dias < 0) return { titulo: `⚠️ Venció: ${cat.etiqueta} · ${conductor}`, mensaje: `Venció el ${fecha}. Sube la renovación ${donde}.` }
  if (dias === 0) return { titulo: `⚠️ Vence hoy: ${cat.etiqueta} · ${conductor}`, mensaje: `Vence hoy, ${fecha}. Sube la renovación ${donde}.` }
  return {
    titulo: `${cat.etiqueta} vence en ${dias} ${dias === 1 ? 'día' : 'días'} · ${conductor}`,
    mensaje: `Vence el ${fecha}. Programa la renovación y súbela ${donde}.`,
  }
}

export async function avisarVencimientosDocumentosConductor(): Promise<{ documentos: number; avisos: number }> {
  const filas = await prisma.$queryRaw<Array<{ conductor_id: string; conductor: string; categoria: string; vence: Date; dias: number }>>(Prisma.sql`
    WITH ultimo AS (
      SELECT DISTINCT ON (doc.conductor_id, doc.categoria) doc.conductor_id, doc.categoria,
             coalesce(doc.fecha_vencimiento, (doc.metadata->>'fechaVigenciaOriginal')::date, doc.fecha_vigencia::date) AS vence
      FROM documento doc
      WHERE doc.deleted_at IS NULL AND doc.estado = 'vigente' AND doc.conductor_id IS NOT NULL
        AND doc.categoria IN (${Prisma.join(CATEGORIAS_VENCEN)})
      ORDER BY doc.conductor_id, doc.categoria,
               coalesce(doc.fecha_vencimiento, (doc.metadata->>'fechaVigenciaOriginal')::date, doc.fecha_vigencia::date) DESC NULLS LAST
    ),
    fechas AS (
      SELECT u.conductor_id, u.categoria, u.vence FROM ultimo u WHERE u.categoria <> 'LICENCIA'
      UNION ALL
      -- La licencia: la ficha manda (igual que en la pestaña); el documento solo si la ficha no tiene fecha.
      SELECT c.id, 'LICENCIA', coalesce(c.vencimiento_licencia, u.vence)
      FROM conductores c LEFT JOIN ultimo u ON u.conductor_id = c.id AND u.categoria = 'LICENCIA'
    )
    SELECT f.conductor_id, trim(c.nombre || ' ' || c.apellido) AS conductor, f.categoria, f.vence,
           (f.vence - (now() AT TIME ZONE 'America/Bogota')::date)::int AS dias
    FROM fechas f
    JOIN conductores c ON c.id = f.conductor_id AND c.deleted_at IS NULL AND c.oculto = false
      AND c.estado::text NOT IN (${Prisma.join(ESTADOS_FUERA)})
    WHERE f.vence IS NOT NULL
      AND f.vence <= (now() AT TIME ZONE 'America/Bogota')::date + ${VENTANA_DIAS}::int
      AND f.vence >= (now() AT TIME ZONE 'America/Bogota')::date - ${DIAS_AVISO_VENCIDO}::int`)

  if (!filas.length) return { documentos: 0, avisos: 0 }

  const destinatarios = await prisma.usuarios.findMany({
    where: { activo: true, area: { hasSome: AREAS_DESTINO } },
    select: { id: true },
  })
  let documentos = 0
  let avisos = 0
  for (const f of filas) {
    const cat = CATEGORIA_CONDUCTOR_POR_CLAVE.get(f.categoria)
    if (!cat) continue
    const umbral = umbralDe(f.dias, diasAvisoDe(cat))
    if (!umbral) continue
    documentos++
    const vence = f.vence.toISOString().slice(0, 10)
    const referencia_tipo = referenciaAviso(f.categoria, vence, umbral)
    const { titulo, mensaje } = textoAviso(cat, f.conductor, f.dias, vence)
    const yaAvisados = new Set(
      (
        await prisma.notificacion.findMany({
          where: { referencia_id: f.conductor_id, referencia_tipo },
          select: { usuario_id: true },
        })
      ).map((n) => n.usuario_id),
    )
    for (const u of destinatarios) {
      if (yaAvisados.has(u.id)) continue
      const n = await NotificacionesService.crear({
        usuario_id: u.id,
        tipo: 'GENERAL',
        titulo,
        mensaje,
        referencia_id: f.conductor_id,
        referencia_tipo,
      })
      emitNotificacion(n)
      avisos++
    }
  }
  return { documentos, avisos }
}

export function startVencimientosDocumentosConductorCron() {
  // Todos los días a las 7:00 de Colombia, antes de que arranque la jornada.
  const job = new CronJob(
    '0 7 * * *',
    async () => {
      try {
        const r = await avisarVencimientosDocumentosConductor()
        logger.info(r, '✅ Cron vencimientos de documentos de conductores')
      } catch (error) {
        logger.error({ err: error }, '❌ Cron vencimientos de documentos de conductores')
      }
    },
    null,
    true,
    'America/Bogota',
  )
  return job
}
