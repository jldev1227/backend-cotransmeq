import { prisma } from '../../config/prisma'

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
    const [notificaciones, total, noLeidas] = await Promise.all([
      prisma.notificacion.findMany({
        where: { usuario_id },
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
      }),
      prisma.notificacion.count({ where: { usuario_id } }),
      prisma.notificacion.count({ where: { usuario_id, leida: false } }),
    ])
    return { notificaciones, total, noLeidas, totalPages: Math.ceil(total / limit), page }
  },

  /** Contar no leídas */
  async contarNoLeidas(usuario_id: string) {
    return await prisma.notificacion.count({ where: { usuario_id, leida: false } })
  },

  /** Marcar una como leída */
  async marcarLeida(id: string, usuario_id: string) {
    // Primero verificar que existe y es del usuario
    const notif = await prisma.notificacion.findFirst({
      where: { id, usuario_id },
    })
    if (!notif) throw new Error('Notificación no encontrada')
    return await prisma.notificacion.update({
      where: { id },
      data: { leida: true },
    })
  },

  /** Marcar todas como leídas */
  async marcarTodasLeidas(usuario_id: string) {
    return await prisma.notificacion.updateMany({
      where: { usuario_id, leida: false },
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
