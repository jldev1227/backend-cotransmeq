// @ts-nocheck
import { prisma } from '../../config/prisma'
import argon2 from 'argon2'

export const UsuariosService = {
  async create(nombre: string, telefono: string | undefined, correo: string, password: string, permisos?: Record<string, boolean>, ultimoAcceso?: string) {
    const hash = await argon2.hash(password)
    const data: any = { nombre, correo, password: hash }
    if (telefono) data.telefono = telefono
    if (permisos) data.permisos = permisos
    if (ultimoAcceso) data.ultimoAcceso = new Date(ultimoAcceso)
    return prisma.usuarios.create({ data })
  },
  async list() {
    return prisma.usuarios.findMany()
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
