import { prisma } from '../../config/prisma'
import { logger } from '../../utils/logger'

/**
 * Avisos al conductor sobre los servicios que le tocan.
 *
 * Escribe en `conductor_notification`, el inbox durable que ya usaba nómina. La
 * app lo lee en su ronda de sincronización —la misma que ya corre cada minuto,
 * al enfocar y al reconectar— y no por push: `conductor_push_device` estaba sin
 * crear en ninguna base, así que un push aquí no habría llegado a nadie.
 *
 * `estado_push` se marca `NO_APLICA` a propósito. Dejarlo en `PENDIENTE` habría
 * hecho que un futuro worker de push reenviara meses después avisos que el
 * conductor ya leyó en la app.
 *
 * Todas las funciones son «mejor esfuerzo»: un fallo aquí se registra y se
 * traga. Un servicio ya guardado no se deshace porque no se pudiera avisar, que
 * es el mismo criterio de `servicios.events.ts` con Socket.IO.
 */

const ESTADO_PUSH = 'NO_APLICA'

type Tipo =
  | 'SERVICIO_ASIGNADO'
  | 'SERVICIO_DESASIGNADO'
  | 'SERVICIO_CANCELADO'
  | 'SERVICIO_ELIMINADO'

/**
 * Instantánea del servicio que viaja dentro del aviso.
 *
 * Imprescindible para el caso de eliminación: cuando el conductor abra la app,
 * el servicio ya está marcado como borrado y la pantalla de detalle no puede
 * cargarlo. Sin esta copia, el aviso diría «se eliminó un servicio» sin poder
 * decir cuál.
 */
interface Instantanea {
  origen: string | null
  destino: string | null
  fecha_realizacion: string | null
  cliente: string | null
  placa: string | null
  numero_planilla: string | null
}

async function instantanea(servicioId: string): Promise<Instantanea | null> {
  const servicio = await prisma.servicio.findUnique({
    where: { id: servicioId },
    select: {
      origen_especifico: true,
      destino_especifico: true,
      fecha_realizacion: true,
      numero_planilla: true,
      clientes: { select: { nombre: true } },
      vehiculos: { select: { placa: true } },
      municipios_servicio_origen_idTomunicipios: { select: { nombre_municipio: true } },
      municipios_servicio_destino_idTomunicipios: { select: { nombre_municipio: true } }
    }
  })
  if (!servicio) return null
  const municipioOrigen = servicio.municipios_servicio_origen_idTomunicipios?.nombre_municipio
  const municipioDestino = servicio.municipios_servicio_destino_idTomunicipios?.nombre_municipio
  return {
    origen: [municipioOrigen, servicio.origen_especifico].filter(Boolean).join(' · ') || null,
    destino: [municipioDestino, servicio.destino_especifico].filter(Boolean).join(' · ') || null,
    fecha_realizacion: servicio.fecha_realizacion?.toISOString() ?? null,
    cliente: servicio.clientes?.nombre ?? null,
    placa: servicio.vehiculos?.placa ?? null,
    numero_planilla: servicio.numero_planilla ?? null
  }
}

/** Resumen de una línea para el cuerpo del aviso. */
function resumen(datos: Instantanea | null): string {
  if (!datos) return ''
  const tramo = datos.origen && datos.destino ? `${datos.origen} → ${datos.destino}` : null
  return [tramo, datos.cliente, datos.placa].filter(Boolean).join(' · ')
}

async function crear(params: {
  conductorId: string
  servicioId: string
  tipo: Tipo
  titulo: string
  cuerpo: string
  datos: Record<string, unknown>
}): Promise<void> {
  try {
    await prisma.conductor_notification.create({
      data: {
        conductor_id: params.conductorId,
        tipo: params.tipo,
        titulo: params.titulo,
        cuerpo: params.cuerpo,
        estado_push: ESTADO_PUSH,
        datos: {
          type: params.tipo,
          servicio_id: params.servicioId,
          ...params.datos
        } as any
      }
    })
  } catch (error) {
    logger.error(
      { err: error, conductorId: params.conductorId, servicioId: params.servicioId, tipo: params.tipo },
      'No fue posible registrar el aviso al conductor'
    )
  }
}

export const ServiciosNotificacionesService = {
  /**
   * El servicio pasa a estar a cargo de este conductor.
   *
   * Cubre las dos puertas por las que ocurre: un servicio creado ya con
   * conductor, y uno que no tenía y ahora sí. Para el conductor son el mismo
   * hecho —«esto es tuyo»— y merecen el mismo aviso.
   */
  async asignado(servicioId: string, conductorId: string): Promise<void> {
    const datos = await instantanea(servicioId)
    await crear({
      conductorId,
      servicioId,
      tipo: 'SERVICIO_ASIGNADO',
      titulo: 'Tienes un servicio asignado',
      cuerpo: resumen(datos) || 'Se te asignó un servicio nuevo. Ábrelo para ver el detalle.',
      /// `route` es lo que lee el contexto de la app para navegar. Mismo
      /// contrato que usan los avisos de nómina.
      datos: { route: `/servicios/${servicioId}`, servicio: datos }
    })
  },

  /** El servicio dejó de ser suyo porque se reasignó a otro conductor. */
  async desasignado(servicioId: string, conductorId: string): Promise<void> {
    const datos = await instantanea(servicioId)
    await crear({
      conductorId,
      servicioId,
      tipo: 'SERVICIO_DESASIGNADO',
      titulo: 'Ya no tienes este servicio',
      cuerpo: resumen(datos)
        ? `Se reasignó a otro conductor: ${resumen(datos)}`
        : 'Un servicio que tenías asignado se reasignó a otro conductor.',
      /// Sin `route`: al dejar de ser suyo, el endpoint del portal filtra por
      /// `conductor_id` y devolvería 404. Llevarlo allí sería mandarlo a un
      /// error.
      datos: { servicio: datos }
    })
  },

  /**
   * El servicio se canceló.
   *
   * El motivo se copia aquí en el momento de cancelar, no se lee después del
   * servicio: `observaciones` es un campo que el portal no expone, y esta copia
   * contiene solo lo que se escribió como razón de la cancelación.
   */
  async cancelado(servicioId: string, conductorId: string, motivo: string | null): Promise<void> {
    const datos = await instantanea(servicioId)
    const detalle = resumen(datos)
    await crear({
      conductorId,
      servicioId,
      tipo: 'SERVICIO_CANCELADO',
      titulo: 'Se canceló un servicio tuyo',
      cuerpo: [detalle, motivo ? `Motivo: ${motivo}` : null].filter(Boolean).join('\n') ||
        'Un servicio que tenías asignado se canceló.',
      datos: { route: `/servicios/${servicioId}`, motivo, servicio: datos }
    })
  },

  /**
   * El servicio se eliminó.
   *
   * Se llama ANTES del borrado lógico, porque después `instantanea` ya no
   * podría decir de qué servicio se trataba. No lleva `route`: no hay adónde ir.
   */
  async eliminado(servicioId: string, conductorId: string): Promise<void> {
    const datos = await instantanea(servicioId)
    await crear({
      conductorId,
      servicioId,
      tipo: 'SERVICIO_ELIMINADO',
      titulo: 'Se eliminó un servicio tuyo',
      cuerpo: resumen(datos)
        ? `Ya no está en tu lista: ${resumen(datos)}`
        : 'Un servicio que tenías asignado se eliminó.',
      datos: { servicio: datos }
    })
  }
}
