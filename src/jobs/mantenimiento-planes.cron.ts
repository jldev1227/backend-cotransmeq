import { CronJob } from 'cron'
import { prisma } from '../config/prisma'
import { NotificacionesService } from '../modules/notificaciones/notificaciones.service'
import { huellaAvisoPlan } from '../modules/mantenimiento/calculo'
import { MantenimientoService, type PlanSerializado } from '../modules/mantenimiento/mantenimiento.service'
import { emitNotificacion } from '../sockets'
import { logger } from '../utils/logger'

/**
 * Avisos diarios de los planes de mantenimiento vencidos o próximos.
 *
 * Cada mañana evalúa los planes activos con el kilometraje de la ficha (que
 * el cron de preoperacionales mueve cada hora) y la fecha de hoy, y avisa una
 * sola vez por plan y por estado: una vez al entrar en «próximo» y otra al
 * vencerse. La huella (`referencia_tipo`) lleva el punto de vencimiento, así
 * que cuando una orden cierra el plan y el próximo cambia, el ciclo empieza de
 * cero sin borrar los avisos viejos.
 *
 * Si el cron no corre un día, el aviso sale al siguiente: la huella no
 * depende del día, solo del estado.
 *
 * Los umbrales (500 km / 15 días) y su porqué están en
 * `modules/mantenimiento/calculo.ts`.
 */

/// Mantenimiento saca el vehículo a taller; administración aprueba el gasto.
const AREAS_DESTINO = ['mantenimiento', 'administracion']

const fechaLarga = (iso: string) =>
  new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`))
const miles = (n: number) => n.toLocaleString('es-CO')
const dias = (n: number) => `${n} ${n === 1 ? 'día' : 'días'}`

/** Título y mensaje del aviso de un plan. Dice por qué eje (km o fecha) salta. */
export function textoAvisoPlan(p: PlanSerializado): { titulo: string; mensaje: string } {
  const partes: string[] = []
  if (p.km_restantes != null && p.proximo_km != null && (p.motivo === 'km' || p.motivo === 'ambos')) {
    partes.push(
      p.km_restantes <= 0
        ? `tocaba a los ${miles(p.proximo_km)} km y va en ${miles(p.km_actual ?? 0)} km (${miles(-p.km_restantes)} km de más)`
        : `faltan ${miles(p.km_restantes)} km (toca a los ${miles(p.proximo_km)} km)`,
    )
  }
  if (p.dias_restantes != null && p.proxima_fecha && (p.motivo === 'fecha' || p.motivo === 'ambos')) {
    partes.push(
      p.dias_restantes < 0
        ? `tocaba el ${fechaLarga(p.proxima_fecha)} (hace ${dias(-p.dias_restantes)})`
        : p.dias_restantes === 0
          ? 'toca hoy'
          : `toca el ${fechaLarga(p.proxima_fecha)} (en ${dias(p.dias_restantes)})`,
    )
  }
  const detalle = partes.join(' y ')
  const titulo =
    p.estado === 'vencido' ? `⚠️ Mantenimiento vencido: ${p.nombre} · ${p.vehiculo.placa}` : `Mantenimiento próximo: ${p.nombre} · ${p.vehiculo.placa}`
  const cola = p.orden_abierta ? ` Ya está la OT ${p.orden_abierta.consecutivo} abierta.` : ' Abre la orden de trabajo en Mantenimiento.'
  return { titulo: titulo.slice(0, 255), mensaje: `${detalle.charAt(0).toUpperCase()}${detalle.slice(1)}.${cola}` }
}

export async function avisarPlanesMantenimiento(): Promise<{ planes: number; avisos: number }> {
  const planes = await MantenimientoService.planesEnAlerta()
  if (!planes.length) return { planes: 0, avisos: 0 }

  const destinatarios = await prisma.usuarios.findMany({
    where: { activo: true, area: { hasSome: AREAS_DESTINO } },
    select: { id: true },
  })
  let avisos = 0
  for (const p of planes) {
    const referencia_tipo = huellaAvisoPlan(p.estado, p.proximo_km, p.proxima_fecha)
    const yaAvisados = new Set(
      (await prisma.notificacion.findMany({ where: { referencia_id: p.id, referencia_tipo }, select: { usuario_id: true } })).map((n) => n.usuario_id),
    )
    const { titulo, mensaje } = textoAvisoPlan(p)
    for (const u of destinatarios) {
      if (yaAvisados.has(u.id)) continue
      const n = await NotificacionesService.crear({ usuario_id: u.id, tipo: 'GENERAL', titulo, mensaje, referencia_id: p.id, referencia_tipo })
      emitNotificacion(n)
      avisos++
    }
  }
  return { planes: planes.length, avisos }
}

export function startMantenimientoPlanesCron() {
  // Todos los días a las 7:15 de Colombia: después del aviso de documentos
  // (7:00) para no llegar los dos en el mismo segundo, y antes de la jornada.
  const job = new CronJob(
    '15 7 * * *',
    async () => {
      try {
        const r = await avisarPlanesMantenimiento()
        logger.info(r, '✅ Cron avisos de planes de mantenimiento')
      } catch (error) {
        logger.error({ err: error }, '❌ Cron avisos de planes de mantenimiento')
      }
    },
    null,
    true,
    'America/Bogota',
  )
  return job
}
