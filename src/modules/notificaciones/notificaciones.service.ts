import type { Prisma } from '@prisma/client'
import { prisma } from '../../config/prisma'
import { AREAS, getAccessibleModules, normalizarRutasOverride, type Area } from '../../config/permissions'
import { filtroNotificacionesPermitidas } from './permisos-notificaciones'
import { cargarEntidadesOcultas } from '../../lib/ocultos-operativos'

async function whereNotificacionesPermitidas(usuario_id: string) {
  const [usuario, ocultas] = await Promise.all([
    prisma.usuarios.findUnique({
      where: { id: usuario_id },
      select: { id: true, area: true, permisos_rutas: true },
    }),
    cargarEntidadesOcultas(),
  ])
  if (!usuario) return { usuario_id, referencia_tipo: '__sin_permiso__' }
  const areas = usuario.area.filter((area): area is Area => AREAS.includes(area as Area))
  const modulos = getAccessibleModules(
    areas,
    normalizarRutasOverride(usuario.permisos_rutas),
    usuario.id,
  )
  const conductorIds = ocultas.conductores.map((c) => c.id)
  const vehiculoIds = ocultas.vehiculos.map((v) => v.id)
  const referenciasOcultas: Prisma.notificacionWhereInput[] = []
  if (conductorIds.length || vehiculoIds.length) {
    const enviosOcultos = await prisma.form_submission.findMany({
      where: {
        deleted_at: null,
        OR: [
          ...(conductorIds.length ? [{ conductor_id: { in: conductorIds } }] : []),
          ...(vehiculoIds.length ? [{ vehicle_id: { in: vehiculoIds } }] : []),
        ],
      },
      select: { id: true },
    })
    if (enviosOcultos.length) {
      referenciasOcultas.push({
        referencia_tipo: { in: ['preoperacional', 'preop_malo'] },
        referencia_id: { in: enviosOcultos.map((e) => e.id) },
      })
    }
    if (conductorIds.length) referenciasOcultas.push({ referencia_tipo: { startsWith: 'doccond:' }, referencia_id: { in: conductorIds } })
    if (vehiculoIds.length) referenciasOcultas.push({ referencia_tipo: { startsWith: 'docveh:' }, referencia_id: { in: vehiculoIds } })
  }
  return {
    AND: [
      { usuario_id, ...filtroNotificacionesPermitidas(modulos) },
      ...(referenciasOcultas.length ? [{ NOT: { OR: referenciasOcultas } }] : []),
    ],
  }
}

export const NotificacionesService = {

  /** Crear una notificación */
  async crear(data: {
    usuario_id: string
    tipo:
      | 'LIQUIDACION_ANULADA'
      | 'LIQUIDACION_PENDIENTE'
      | 'LIQUIDACION_CREADA'
      | 'LIQUIDACION_ACTUALIZADA'
      | 'LIQUIDACION_FACTURADA'
      | 'FACTURA_ANULADA'
      | 'ACTIVIDAD_PESV_ASIGNADA'
      | 'ACTIVIDAD_PESV_ACTUALIZADA'
      | 'ACTIVIDAD_PESV_VENCIDA'
      | 'ACCION_CORRECTIVA_RECORDATORIO'
      | 'ACCION_CORRECTIVA_VENCIDA'
      | 'GENERAL'
    titulo: string
    mensaje: string
    referencia_id?: string
    referencia_tipo?: string
  }) {
    return await prisma.notificacion.create({ data: data as any })
  },

  /** Crear notificaciones masivas (para múltiples usuarios) */
  async crearMasivas(notificaciones: Array<{
    usuario_id: string
    tipo:
      | 'LIQUIDACION_ANULADA'
      | 'LIQUIDACION_PENDIENTE'
      | 'LIQUIDACION_CREADA'
      | 'LIQUIDACION_ACTUALIZADA'
      | 'LIQUIDACION_FACTURADA'
      | 'FACTURA_ANULADA'
      | 'ACTIVIDAD_PESV_ASIGNADA'
      | 'ACTIVIDAD_PESV_ACTUALIZADA'
      | 'ACTIVIDAD_PESV_VENCIDA'
      | 'ACCION_CORRECTIVA_RECORDATORIO'
      | 'ACCION_CORRECTIVA_VENCIDA'
      | 'GENERAL'
    titulo: string
    mensaje: string
    referencia_id?: string
    referencia_tipo?: string
  }>) {
    return await prisma.notificacion.createMany({ data: notificaciones as any })
  },

  /** Listar notificaciones de un usuario con paginación */
  async listarPorUsuario(usuario_id: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit
    const where = await whereNotificacionesPermitidas(usuario_id)
    const [notificaciones, total, noLeidas] = await Promise.all([
      prisma.notificacion.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
      }),
      prisma.notificacion.count({ where }),
      prisma.notificacion.count({ where: { AND: [where, { leida: false }] } }),
    ])
    return { notificaciones, total, noLeidas, totalPages: Math.ceil(total / limit), page }
  },

  /** Contar no leídas */
  async contarNoLeidas(usuario_id: string) {
    const where = await whereNotificacionesPermitidas(usuario_id)
    return await prisma.notificacion.count({ where: { AND: [where, { leida: false }] } })
  },

  /** Push de prueba con el aviso más reciente que el usuario aún puede recibir. */
  async ultimaVisible(usuario_id: string) {
    const where = await whereNotificacionesPermitidas(usuario_id)
    return prisma.notificacion.findFirst({ where, orderBy: { created_at: 'desc' } })
  },

  /** Marcar una como leída */
  async marcarLeida(id: string, usuario_id: string) {
    // Verifica propietario y permiso actual antes de tocar una notificación histórica.
    const where = await whereNotificacionesPermitidas(usuario_id)
    const notif = await prisma.notificacion.findFirst({
      where: { AND: [where, { id }] },
    })
    if (!notif) throw new Error('Notificación no encontrada')
    return await prisma.notificacion.update({
      where: { id },
      data: { leida: true },
    })
  },

  /** Marcar todas como leídas */
  async marcarTodasLeidas(usuario_id: string) {
    const where = await whereNotificacionesPermitidas(usuario_id)
    return await prisma.notificacion.updateMany({
      where: { AND: [where, { leida: false }] },
      data: { leida: true },
    })
  },

  /**
   * Quienes pueden aprobar liquidaciones: usuarios activos del área administración, que es la
   * misma regla con la que `cambiarEstado` deja aprobar. Antes se tomaban los `role: 'admin'` y se
   * descartaba a cualquiera con `permisos` como objeto (lo normal es `{}`), así que casi nadie
   * recibía «Liquidación pendiente de revisión».
   */
  async obtenerUsuariosAprobadores(): Promise<Array<{ id: string; nombre: string; correo: string }>> {
    return prisma.usuarios.findMany({
      where: { activo: true, area: { has: 'administracion' } },
      select: { id: true, nombre: true, correo: true },
    })
  },
}
