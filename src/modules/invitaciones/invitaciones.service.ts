// @ts-nocheck
import { prisma } from '../../config/prisma'
import argon2 from 'argon2'
import crypto from 'crypto'
import { PERMISOS_DEFAULT } from '../usuarios/usuarios.service'

export const InvitacionesService = {

  async crear({ correo, area, cargo, invitadoPorId }: {
    correo: string
    area: string[]
    cargo?: string
    invitadoPorId: string
  }) {
    // Verificar que el correo no pertenezca ya a un usuario activo
    const existente = await prisma.usuarios.findUnique({ where: { correo } })
    if (existente) {
      throw new Error('Ya existe un usuario con ese correo electrónico.')
    }

    // Invalidar invitaciones previas pendientes para ese correo
    await prisma.invitaciones_usuario.updateMany({
      where: { correo, estado: 'pendiente' },
      data: { estado: 'reemplazada' }
    })

    const token = crypto.randomBytes(32).toString('hex')
    const expires_at = new Date(Date.now() + 72 * 60 * 60 * 1000) // 72 horas

    const inv = await prisma.invitaciones_usuario.create({
      data: {
        correo,
        token,
        area,
        cargo: cargo || null,
        invitado_por_id: invitadoPorId,
        estado: 'pendiente',
        expires_at,
      },
      include: {
        invitado_por: { select: { id: true, nombre: true, correo: true } }
      }
    })

    return inv
  },

  async listar() {
    return prisma.invitaciones_usuario.findMany({
      orderBy: { created_at: 'desc' },
      include: {
        invitado_por: { select: { id: true, nombre: true } }
      }
    })
  },

  async validarToken(token: string) {
    const inv = await prisma.invitaciones_usuario.findUnique({
      where: { token },
      include: {
        invitado_por: { select: { id: true, nombre: true } }
      }
    })

    if (!inv) return null
    if (inv.estado !== 'pendiente') return null
    if (new Date() > inv.expires_at) {
      await prisma.invitaciones_usuario.update({ where: { token }, data: { estado: 'expirada' } })
      return null
    }

    return inv
  },

  async aceptar({ token, nombre, password, telefono }: {
    token: string
    nombre: string
    password: string
    telefono?: string
  }) {
    const inv = await InvitacionesService.validarToken(token)
    if (!inv) throw new Error('Invitación inválida o expirada.')

    const hash = await argon2.hash(password)

    const usuario = await prisma.usuarios.create({
      data: {
        id: crypto.randomUUID(),
        nombre,
        correo: inv.correo,
        password: hash,
        telefono: telefono || null,
        area: inv.area,
        cargo: inv.cargo || null,
        es_invitado: true,
        invitado_por_id: inv.invitado_por_id,
        permisos: PERMISOS_DEFAULT,
        created_at: new Date(),
        updated_at: new Date(),
      },
      select: {
        id: true,
        nombre: true,
        correo: true,
        area: true,
        cargo: true,
      }
    })

    await prisma.invitaciones_usuario.update({
      where: { token },
      data: { estado: 'aceptada' }
    })

    return usuario
  },

  async revocar(id: string) {
    return prisma.invitaciones_usuario.update({
      where: { id },
      data: { estado: 'revocada' }
    })
  }
}
