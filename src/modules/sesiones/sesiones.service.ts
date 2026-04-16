import { prisma } from '../../config/prisma'
import crypto from 'crypto'

export const SesionesService = {
  /**
   * Crear una nueva sesión al hacer login
   */
  async crear(data: {
    usuarioId: string
    ip: string | null
    userAgent: string | null
    rememberMe: boolean
    tokenExpiry: Date
    token: string
  }) {
    // Hash del token para almacenar (no guardamos el token plano)
    const tokenHash = crypto.createHash('sha256').update(data.token).digest('hex').substring(0, 64)

    return prisma.sesiones.create({
      data: {
        usuario_id: data.usuarioId,
        ip: data.ip,
        user_agent: data.userAgent,
        remember_me: data.rememberMe,
        token_expiry: data.tokenExpiry,
        token_hash: tokenHash,
        is_active: true,
        last_activity: new Date()
      }
    })
  },

  /**
   * Actualizar última actividad de una sesión
   */
  async actualizarActividad(tokenHash: string, ip?: string) {
    return prisma.sesiones.updateMany({
      where: { token_hash: tokenHash, is_active: true },
      data: {
        last_activity: new Date(),
        ...(ip ? { ip } : {})
      }
    })
  },

  /**
   * Cerrar sesión (marcar como inactiva)
   */
  async cerrar(tokenHash: string) {
    return prisma.sesiones.updateMany({
      where: { token_hash: tokenHash, is_active: true },
      data: {
        is_active: false,
        closed_at: new Date()
      }
    })
  },

  /**
   * Cerrar todas las sesiones de un usuario
   */
  async cerrarTodas(usuarioId: string) {
    return prisma.sesiones.updateMany({
      where: { usuario_id: usuarioId, is_active: true },
      data: {
        is_active: false,
        closed_at: new Date()
      }
    })
  },

  /**
   * Listar sesiones de un usuario
   */
  async listarPorUsuario(usuarioId: string) {
    return prisma.sesiones.findMany({
      where: { usuario_id: usuarioId },
      orderBy: { created_at: 'desc' },
      take: 50
    })
  },

  /**
   * Listar todas las sesiones activas (para admin)
   */
  async listarActivas() {
    return prisma.sesiones.findMany({
      where: { is_active: true },
      include: {
        usuario: {
          select: {
            id: true,
            nombre: true,
            correo: true,
            role: true,
            area: true,
            cargo: true
          }
        }
      },
      orderBy: { last_activity: 'desc' }
    })
  },

  /**
   * Listar todas las sesiones con filtros (para admin)
   */
  async listarTodas(options?: { activas?: boolean; usuarioId?: string; limit?: number }) {
    return prisma.sesiones.findMany({
      where: {
        ...(options?.activas !== undefined ? { is_active: options.activas } : {}),
        ...(options?.usuarioId ? { usuario_id: options.usuarioId } : {})
      },
      include: {
        usuario: {
          select: {
            id: true,
            nombre: true,
            correo: true,
            role: true,
            area: true,
            cargo: true
          }
        }
      },
      orderBy: { created_at: 'desc' },
      take: options?.limit || 100
    })
  },

  /**
   * Cerrar sesiones expiradas
   */
  async cerrarExpiradas() {
    return prisma.sesiones.updateMany({
      where: {
        is_active: true,
        token_expiry: { lt: new Date() }
      },
      data: {
        is_active: false,
        closed_at: new Date()
      }
    })
  },

  /**
   * Hash de un token
   */
  hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex').substring(0, 64)
  },

  /**
   * Verificar si un token tiene sesión activa
   */
  async verificarSesionActiva(token: string): Promise<boolean> {
    const tokenHash = this.hashToken(token)
    const sesion = await prisma.sesiones.findFirst({
      where: { token_hash: tokenHash, is_active: true }
    })
    return !!sesion
  }
}
