import { FastifyReply, FastifyRequest } from 'fastify'
import { UsuariosService } from './usuarios.service'
import { createUsuarioSchema, updatePermisosSchema, updateUsuarioSchema } from './usuarios.schema'
import { uploadToS3, deleteFromS3, getS3SignedUrl } from '../../config/aws'
import { prisma } from '../../config/prisma'
import { SesionesService } from '../sesiones/sesiones.service'
import { getIo } from '../../sockets'

export const UsuariosController = {
  async create(request: FastifyRequest, reply: FastifyReply) {
    const data = createUsuarioSchema.parse(request.body)
    const user = await UsuariosService.create(data.nombre, data.telefono, data.correo, data.password, data.permisos, data.ultimoAcceso)
    reply.status(201).send(user)
  },
  async list(request: FastifyRequest, reply: FastifyReply) {
    const users = await UsuariosService.list()
    reply.send(users)
  },
  async getById(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as { id: string }
    const user = await UsuariosService.getById(id)
    if (!user) return reply.status(404).send({ error: 'Usuario no encontrado' })
    reply.send(user)
  },
  async update(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as { id: string }
    const data = updateUsuarioSchema.parse(request.body)
    const user = await UsuariosService.update(id, data)
    reply.send(user)
  },
  async updatePermisos(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as { id: string }
    const { permisos } = updatePermisosSchema.parse(request.body)
    const user = await UsuariosService.updatePermisos(id, permisos)
    reply.send(user)
  },
  async listConductoresBasicos(request: FastifyRequest, reply: FastifyReply) {
    const conductores = await UsuariosService.listConductoresBasicos()
    reply.send(conductores)
  },

  async toggleActivo(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as { id: string }
    const { activo } = request.body as { activo: boolean }
    const user = await UsuariosService.update(id, { activo })
    
    // If disabling user, close all their sessions and notify via socket
    if (!activo) {
      try {
        await SesionesService.cerrarTodas(id)
        const io = getIo()
        io.emit('usuario-deshabilitado', { usuarioId: id })
      } catch (err) {
        console.error('Error cerrando sesiones del usuario deshabilitado:', err)
      }
    }
    
    reply.send(user)
  },

  async firmantes(_request: FastifyRequest, reply: FastifyReply) {
    const users = await prisma.usuarios.findMany({
      where: { firma_url: { not: null } },
      select: { id: true, nombre: true, cargo: true, firma_url: true }
    })

    const result = await Promise.all(
      users.map(async (u) => {
        let firma_signed_url: string | null = null
        if (u.firma_url) {
          try { firma_signed_url = await getS3SignedUrl(u.firma_url, 3600 * 24) } catch {}
        }
        return { ...u, firma_signed_url }
      })
    )

    reply.send(result)
  },

  async uploadFirma(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as { id: string }

    const user = await prisma.usuarios.findUnique({ where: { id } })
    if (!user) return reply.status(404).send({ error: 'Usuario no encontrado' })

    const data = await request.file()
    if (!data) return reply.status(400).send({ error: 'No se envió ningún archivo' })

    const buffer = await data.toBuffer()
    const ext = data.filename.split('.').pop()?.toLowerCase() || 'png'
    const key = `firmas/${id}.${ext}`

    // Si ya tenía firma, eliminar la anterior
    if (user.firma_url) {
      try { await deleteFromS3(user.firma_url) } catch {}
    }

    await uploadToS3(key, buffer, data.mimetype)

    const updated = await prisma.usuarios.update({
      where: { id },
      data: { firma_url: key },
      select: { id: true, nombre: true, cargo: true, firma_url: true }
    })

    reply.send({ success: true, data: updated })
  },

  async deleteFirma(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as { id: string }

    const user = await prisma.usuarios.findUnique({ where: { id } })
    if (!user) return reply.status(404).send({ error: 'Usuario no encontrado' })

    if (user.firma_url) {
      try { await deleteFromS3(user.firma_url) } catch {}
    }

    await prisma.usuarios.update({
      where: { id },
      data: { firma_url: null }
    })

    reply.send({ success: true })
  }
}
