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
