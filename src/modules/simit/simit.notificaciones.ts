import { createHash } from 'node:crypto'
import { prisma } from '../../config/prisma'
import { NotificacionesService } from '../notificaciones/notificaciones.service'
import { emitNotificacion } from '../../sockets'
import { logger } from '../../utils/logger'

const AREAS_DESTINO = ['talento_humano', 'hseq']

type TipoSimit = 'vehiculo' | 'conductor'

function fechaColombia(fecha: Date): string {
  const partes = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(fecha)
  const valor = Object.fromEntries(partes.map((parte) => [parte.type, parte.value]))
  return `${valor.year}${valor.month}${valor.day}`
}

function formatoDinero(valor: number | null): string {
  return new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(Number(valor ?? 0))
}

function cantidad(valor: number | null, singular: string, plural: string): string {
  const numero = valor ?? 0
  return `${numero} ${numero === 1 ? singular : plural}`
}

/** Avisa a Talento Humano y HSEQ cuando una consulta finalizada reporta obligaciones. */
export async function notificarPendientesSimit(params: {
  tipo: TipoSimit
  entidadId: string
  consultaId: string
  estado: 'sin_deuda' | 'con_deuda' | 'error'
  comparendos: number | null
  multas: number | null
  acuerdosPago: number | null
  saldoTotal: number | null
  consultadoAt: Date
}): Promise<number> {
  if (params.estado !== 'con_deuda') return 0

  try {
    const entidad = params.tipo === 'vehiculo'
      ? await prisma.vehiculos.findFirst({
        where: { id: params.entidadId, deleted_at: null },
        select: { placa: true },
      })
      : await prisma.conductores.findFirst({
        where: { id: params.entidadId, deleted_at: null },
        select: { nombre: true, apellido: true },
      })
    if (!entidad) return 0

    let sujeto: string
    if (params.tipo === 'vehiculo') {
      sujeto = `Vehículo ${(entidad as { placa: string }).placa}`
    } else {
      const conductor = entidad as { nombre: string; apellido: string }
      sujeto = `Conductor ${`${conductor.nombre} ${conductor.apellido}`.trim()}`
    }
    const destinatarios = await prisma.usuarios.findMany({
      where: { activo: true, area: { hasSome: AREAS_DESTINO } },
      select: { id: true },
    })
    if (!destinatarios.length) return 0

    /// Una sola alerta por resultado y día evita repetir la misma notificación si el cron
    /// tiene una frecuencia menor a 24 horas; un nuevo resultado puede avisar de nuevo.
    const firma = createHash('sha256')
      .update([
        params.comparendos ?? 0,
        params.multas ?? 0,
        params.acuerdosPago ?? 0,
        Number(params.saldoTotal ?? 0),
      ].join(':'))
      .digest('hex')
      .slice(0, 10)
    const prefijo = params.tipo === 'conductor' ? 'con' : 'veh'
    const referenciaTipo = `simit:${prefijo}:${fechaColombia(params.consultadoAt)}:${firma}`
    const notificados = new Set((await prisma.notificacion.findMany({
      where: { referencia_id: params.entidadId, referencia_tipo: referenciaTipo },
      select: { usuario_id: true },
    })).map((notificacion) => notificacion.usuario_id))

    const resumen = [
      cantidad(params.comparendos, 'comparendo', 'comparendos'),
      cantidad(params.multas, 'multa', 'multas'),
      cantidad(params.acuerdosPago, 'acuerdo de pago', 'acuerdos de pago'),
      `saldo reportado: $${formatoDinero(params.saldoTotal)} COP`,
    ].join('; ')
    let avisos = 0
    for (const destinatario of destinatarios) {
      if (notificados.has(destinatario.id)) continue
      const notificacion = await NotificacionesService.crear({
        usuario_id: destinatario.id,
        tipo: 'GENERAL',
        titulo: `Pendiente SIMIT · ${sujeto}`,
        mensaje: `SIMIT reporta obligaciones pendientes para ${sujeto} (${resumen}). Revisa el estado de cuenta en su ficha.`,
        referencia_id: params.entidadId,
        referencia_tipo: referenciaTipo,
      })
      emitNotificacion(notificacion)
      avisos++
    }
    return avisos
  } catch (error) {
    /// Un fallo al avisar no cambia el resultado ya guardado en el historial SIMIT.
    logger.error({ err: error, tipo: params.tipo, entidad_id: params.entidadId, consulta_id: params.consultaId }, 'No se pudo emitir la notificación de obligaciones SIMIT')
    return 0
  }
}
