import { CronJob } from 'cron'
import { Prisma } from '@prisma/client'
import { prisma } from '../config/prisma'
import { NotificacionesService } from '../modules/notificaciones/notificaciones.service'
import { CATEGORIAS_DOCUMENTO, CATEGORIA_POR_CLAVE } from '../modules/vehiculos-documentos/catalogo'
import { emitNotificacion } from '../sockets'
import { logger } from '../utils/logger'

/**
 * Avisos de vencimiento de los documentos del vehículo (SOAT, pólizas,
 * tecnomecánica, tarjeta de operación, preventiva, GPS).
 *
 * Cada día, para el documento actual de cada placa y categoría (el `vigente`
 * de vencimiento más lejano, igual que el panel), calcula en qué umbral está
 * y avisa una sola vez por umbral: 30, 15 y 7 días antes, el día que vence y
 * al vencer. Un documento renovado tiene otra fecha, así que su ciclo de
 * avisos empieza de cero.
 *
 * El umbral es el menor que todavía no se alcanzó (a 12 días → el de 15): si
 * el cron no corre un día, el aviso sale al siguiente en vez de perderse.
 *
 * «Vencido» solo se avisa los primeros días: lo que venció hace meses ya está
 * en rojo en el panel, y avisarlo todo de golpe el primer día serían cientos
 * de notificaciones que nadie leería.
 */

/// Quién recibe los avisos. Mantenimiento gestiona la renovación; HSEQ y
/// administración responden por la documentación ante clientes y el PESV.
const AREAS_DESTINO = ['mantenimiento', 'hseq', 'administracion']
const UMBRALES = [30, 15, 7, 0] as const
const DIAS_AVISO_VENCIDO = 3

const CATEGORIAS_VENCEN = CATEGORIAS_DOCUMENTO.filter((c) => c.vence).map((c) => c.clave)

/** Umbral en que cae un documento, o null si todavía no toca avisar. */
export function umbralDe(dias: number): string | null {
  if (dias < 0) return dias >= -DIAS_AVISO_VENCIDO ? 'vencido' : null
  const u = [...UMBRALES].reverse().find((x) => dias <= x)
  return u === undefined ? null : String(u)
}

function textoAviso(etiqueta: string, placa: string, dias: number, vence: string): { titulo: string; mensaje: string } {
  const fecha = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${vence}T00:00:00Z`))
  /// «Venció: Tarjeta de operación» y no «Tarjeta de operación vencido»: el
  /// género cambia según el documento.
  if (dias < 0) return { titulo: `⚠️ Venció: ${etiqueta} · ${placa}`, mensaje: `Venció el ${fecha}. Sube la renovación en la hoja de vida del vehículo.` }
  if (dias === 0) return { titulo: `⚠️ Vence hoy: ${etiqueta} · ${placa}`, mensaje: `Vence hoy, ${fecha}. Sube la renovación en la hoja de vida del vehículo.` }
  return {
    titulo: `${etiqueta} vence en ${dias} ${dias === 1 ? 'día' : 'días'} · ${placa}`,
    mensaje: `Vence el ${fecha}. Programa la renovación y súbela en la hoja de vida del vehículo.`,
  }
}

export async function avisarVencimientosDocumentos(): Promise<{ documentos: number; avisos: number }> {
  const filas = await prisma.$queryRaw<Array<{ vehiculo_id: string; placa: string; categoria: string; vence: Date; dias: number }>>(Prisma.sql`
    WITH ultimo AS (
      SELECT DISTINCT ON (doc.vehiculo_id, doc.categoria) doc.vehiculo_id, doc.categoria,
             coalesce(doc.fecha_vencimiento, (doc.metadata->>'fechaVigenciaOriginal')::date, doc.fecha_vigencia::date) AS vence
      FROM documento doc
      WHERE doc.deleted_at IS NULL AND doc.estado = 'vigente' AND doc.vehiculo_id IS NOT NULL
        AND doc.categoria IN (${Prisma.join(CATEGORIAS_VENCEN)})
        AND coalesce(doc.fecha_vencimiento, doc.fecha_vigencia::date) IS NOT NULL
      ORDER BY doc.vehiculo_id, doc.categoria,
               coalesce(doc.fecha_vencimiento, (doc.metadata->>'fechaVigenciaOriginal')::date, doc.fecha_vigencia::date) DESC
    )
    SELECT u.vehiculo_id, ve.placa, u.categoria, u.vence,
           (u.vence - (now() AT TIME ZONE 'America/Bogota')::date)::int AS dias
    FROM ultimo u JOIN vehiculos ve ON ve.id = u.vehiculo_id AND ve.deleted_at IS NULL AND ve.oculto = false
    WHERE u.vence <= (now() AT TIME ZONE 'America/Bogota')::date + ${UMBRALES[0]}::int
      AND u.vence >= (now() AT TIME ZONE 'America/Bogota')::date - ${DIAS_AVISO_VENCIDO}::int`)

  if (!filas.length) return { documentos: 0, avisos: 0 }

  const destinatarios = await prisma.usuarios.findMany({
    where: { activo: true, area: { hasSome: AREAS_DESTINO } },
    select: { id: true },
  })
  let avisos = 0
  for (const f of filas) {
    const umbral = umbralDe(f.dias)
    if (!umbral) continue
    const vence = f.vence.toISOString().slice(0, 10)
    /// Huella del aviso: categoría + vencimiento + umbral (cabe en los 50 de la columna).
    const referencia_tipo = `docveh:${f.categoria}:${vence}:${umbral}`
    const etiqueta = CATEGORIA_POR_CLAVE.get(f.categoria)?.etiqueta ?? f.categoria
    const { titulo, mensaje } = textoAviso(etiqueta, f.placa, f.dias, vence)
    const yaAvisados = new Set(
      (
        await prisma.notificacion.findMany({
          where: { referencia_id: f.vehiculo_id, referencia_tipo },
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
        referencia_id: f.vehiculo_id,
        referencia_tipo,
      })
      emitNotificacion(n)
      avisos++
    }
  }
  return { documentos: filas.length, avisos }
}

export function startVencimientosDocumentosCron() {
  // Todos los días a las 7:00 de Colombia, antes de que arranque la jornada.
  const job = new CronJob(
    '0 7 * * *',
    async () => {
      try {
        const r = await avisarVencimientosDocumentos()
        logger.info(r, '✅ Cron vencimientos de documentos de vehículos')
      } catch (error) {
        logger.error({ err: error }, '❌ Cron vencimientos de documentos de vehículos')
      }
    },
    null,
    true,
    'America/Bogota',
  )
  return job
}
