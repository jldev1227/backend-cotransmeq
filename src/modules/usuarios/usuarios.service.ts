// @ts-nocheck
import { prisma } from '../../config/prisma'
import argon2 from 'argon2'

// Permisos por defecto para nuevos usuarios (todo deshabilitado)
export const PERMISOS_DEFAULT: Record<string, boolean> = {
  flota: false,
  conductores: false,
  servicios: false,
  recargos: false,
  clientes: false,
  asistencias: false,
  'acciones-correctivas': false,
  evaluaciones: false,
  nomina: false,
  usuarios: false,
  // Permiso individual (no por área): otorga o revoca un administrador
  // desde la página de Usuarios → "Permiso de bonos — planilla de días laborados".
  'bonos-planilla': false,
}

// Permisos de admin (todo habilitado)
export const PERMISOS_ADMIN: Record<string, boolean> = {
  flota: true,
  conductores: true,
  servicios: true,
  recargos: true,
  clientes: true,
  asistencias: true,
  'acciones-correctivas': true,
  evaluaciones: true,
  nomina: true,
  usuarios: true,
  'bonos-planilla': true,
}

export const UsuariosService = {
  async create(nombre: string, telefono: string | undefined, correo: string, password: string, permisos?: Record<string, boolean>, ultimoAcceso?: string) {
    const hash = await argon2.hash(password)
    const data: any = { nombre, correo, password: hash }
    if (telefono) data.telefono = telefono
    // Asignar permisos por defecto si no se envían
    data.permisos = permisos || PERMISOS_DEFAULT
    if (ultimoAcceso) data.ultimoAcceso = new Date(ultimoAcceso)
    return prisma.usuarios.create({ data })
  },
  async list() {
    return prisma.usuarios.findMany({
      select: {
        id: true,
        nombre: true,
        correo: true,
        telefono: true,
        role: true,
        cargo: true,
        area: true,
        activo: true,
        firma_url: true,
        permisos: true,
        ultimo_acceso: true,
        created_at: true,
        updated_at: true,
      },
      orderBy: { nombre: 'asc' }
    })
  },
  async getById(id: string) {
    return prisma.usuarios.findUnique({
      where: { id },
      select: {
        id: true,
        nombre: true,
        correo: true,
        telefono: true,
        role: true,
        cargo: true,
        area: true,
        activo: true,
        firma_url: true,
        permisos: true,
        ultimo_acceso: true,
        created_at: true,
        updated_at: true,
      }
    })
  },
  async update(id: string, data: { nombre?: string; telefono?: string; correo?: string; role?: string; cargo?: string; area?: string[]; activo?: boolean }) {
    return prisma.usuarios.update({
      where: { id },
      data,
      select: {
        id: true,
        nombre: true,
        correo: true,
        telefono: true,
        role: true,
        cargo: true,
        area: true,
        activo: true,
        firma_url: true,
        permisos: true,
        ultimo_acceso: true,
        created_at: true,
        updated_at: true,
      }
    })
  },
  async updatePermisos(id: string, permisos: Record<string, boolean>) {
    return prisma.usuarios.update({
      where: { id },
      data: { permisos },
      select: {
        id: true,
        nombre: true,
        correo: true,
        telefono: true,
        role: true,
        cargo: true,
        area: true,
        activo: true,
        firma_url: true,
        permisos: true,
        ultimo_acceso: true,
        created_at: true,
        updated_at: true,
      }
    })
  },

  /**
   * Otorga o revoca el permiso INDIVIDUAL `bonos-planilla` a uno o
   * varios usuarios. Este permiso es independiente del área: solo lo
   * управan los administradores desde la página de Usuarios.
   *
   *  - Devuelve el array de usuarios actualizados.
   *  - Si el usuario está deshabilitado, igual actualiza (un admin puede
   *    preparar el acceso antes de habilitarlo).
   */
  async setBonosPlanilla(userIds: string[], granted: boolean) {
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return []
    }

    // Optimización: leer los permisos actuales en una sola query y
    // mergear en JS para no perder otras claves (nomina, flota, etc.).
    const usuarios = await prisma.usuarios.findMany({
      where: { id: { in: userIds } },
      select: { id: true, permisos: true }
    })

    const updates = await Promise.all(
      usuarios.map(async (u) => {
        const current = (u.permisos as Record<string, boolean> | null) || {}
        const merged: Record<string, boolean> = { ...current, 'bonos-planilla': granted }
        return prisma.usuarios.update({
          where: { id: u.id },
          data: { permisos: merged },
          select: {
            id: true,
            nombre: true,
            correo: true,
            permisos: true
          }
        })
      })
    )

    return updates
  },
  async listConductoresBasicos() {
    return prisma.usuarios.findMany({
      where: {
        role: 'CONDUCTOR',
        deletedAt: null
      },
      select: {
        id: true,
        nombre: true,
        correo: true,
        telefono: true,
        conductores: {
          select: {
            id: true,
            numero_identificacion: true,
            estado: true
          }
        }
      },
      orderBy: {
        nombre: 'asc'
      }
    })
  }
}
