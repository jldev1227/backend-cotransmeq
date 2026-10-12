import { CronJob } from 'cron'
import { prisma } from '../config/prisma'
import { NotificacionesService } from '../modules/notificaciones/notificaciones.service'
import {
  areasAviso,
  codigoIncidente,
  fechaLimiteInvestigacion,
  hoyColombia,
  requiereRecordatorio,
  sumarDias,
  DIAS_PARA_INVESTIGAR,
  TIPO_LABEL,
  type EstadoIncidente,
  type Severidad,
  type TipoIncidente,
} from '../modules/incidentes/incidentes.dominio'
import { emitNotificacion } from '../sockets'
import { logger } from '../utils/logger'

/**
 * Recordatorio de investigación pendiente.
 *
 * La Res. 1401 de 2007 da 15 días para investigar un incidente o accidente.
 * Cada mañana se buscan los reportes sin cerrar que ya cumplieron ese plazo y
 * se avisa una sola vez a quienes recibieron el reporte (HSEQ, administración
 * y talento humano si hubo lesionados).
 *
 * «Una sola vez» lo garantiza la huella `referencia_tipo` + `referencia_id`:
 * antes de crear el aviso se mira si ese usuario ya lo tiene. Así correr el
 * cron dos veces no duplica nada, y si un día no corrió el aviso sale al
 * siguiente en vez de perderse.
 */
export const HUELLA_RECORDATORIO = 'incidente_investigacion_pendiente'

export interface ResultadoRecordatorio {
  pendientes: number
  avisos: number
  /** En `dryRun`, los avisos que se habrían creado; en ejecución real, los creados. */
  detalle: Array<{ incidente_id: string; codigo: string; usuario_id: string; titulo: string }>
}

const fechaLarga = (iso: string) =>
  new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`))

export async function recordarInvestigacionesPendientes(
  opciones: { hoy?: string; dryRun?: boolean } = {},
): Promise<ResultadoRecordatorio> {
  const hoy = opciones.hoy ?? hoyColombia()
  /// Filtro grueso en la base (sin cerrar y con 15 días o más); la regla fina
  /// la decide `requiereRecordatorio`, la misma que prueban los tests.
  const candidatos = await prisma.pesv_incident.findMany({
    where: {
      deleted_at: null,
      estado: { not: 'CERRADO' },
      fecha: { lte: new Date(`${sumarDias(hoy, -DIAS_PARA_INVESTIGAR)}T00:00:00Z`) },
    },
    select: {
      id: true,
      consecutivo: true,
      tipo: true,
      estado: true,
      fecha: true,
      severidad: true,
      heridos: true,
      fallecidos: true,
      vehiculo: { select: { placa: true } },
    },
    orderBy: { fecha: 'asc' },
  })

  const resultado: ResultadoRecordatorio = { pendientes: 0, avisos: 0, detalle: [] }
  for (const inc of candidatos) {
    const fecha = inc.fecha.toISOString().slice(0, 10)
    if (!requiereRecordatorio({ estado: inc.estado as EstadoIncidente, fecha }, hoy)) continue
    resultado.pendientes++

    const severidad = (inc.severidad as Severidad | null) ?? null
    const areas = areasAviso({ severidad, heridos: inc.heridos, fallecidos: inc.fallecidos })
    const codigo = codigoIncidente(inc.consecutivo)
    const limite = fechaLimiteInvestigacion(fecha)
    const venceHoy = limite === hoy
    const titulo = `${venceHoy ? 'Hoy vence la investigación' : 'Investigación vencida'} · ${codigo}${inc.vehiculo ? ` · ${inc.vehiculo.placa}` : ''}`
    const mensaje =
      `${TIPO_LABEL[inc.tipo as TipoIncidente]} del ${fechaLarga(fecha)} sin investigación cerrada. ` +
      (venceHoy
        ? 'Hoy se cumplen los 15 días que da la Res. 1401 de 2007.'
        : `El plazo de 15 días (Res. 1401 de 2007) venció el ${fechaLarga(limite)}.`) +
      ' Completa la investigación y ciérrala en el módulo de incidentes.'

    const [destinatarios, yaAvisados] = await Promise.all([
      prisma.usuarios.findMany({ where: { activo: true, area: { hasSome: areas } }, select: { id: true } }),
      prisma.notificacion.findMany({ where: { referencia_id: inc.id, referencia_tipo: HUELLA_RECORDATORIO }, select: { usuario_id: true } }),
    ])
    const avisados = new Set(yaAvisados.map((n) => n.usuario_id))
    for (const u of destinatarios) {
      if (avisados.has(u.id)) continue
      resultado.detalle.push({ incidente_id: inc.id, codigo, usuario_id: u.id, titulo })
      resultado.avisos++
      if (opciones.dryRun) continue
      const n = await NotificacionesService.crear({
        usuario_id: u.id,
        tipo: 'GENERAL',
        titulo,
        mensaje,
        referencia_id: inc.id,
        referencia_tipo: HUELLA_RECORDATORIO,
      })
      emitNotificacion(n)
    }
  }
  return resultado
}

export function startIncidentesInvestigacionCron() {
  // Todos los días a las 7:10 de Colombia, después de los avisos de documentos.
  const job = new CronJob(
    '10 7 * * *',
    async () => {
      try {
        const r = await recordarInvestigacionesPendientes()
        logger.info({ pendientes: r.pendientes, avisos: r.avisos }, '✅ Cron recordatorio de investigación de incidentes')
      } catch (error) {
        logger.error({ err: error }, '❌ Cron recordatorio de investigación de incidentes')
      }
    },
    null,
    true,
    'America/Bogota',
  )
  return job
}
