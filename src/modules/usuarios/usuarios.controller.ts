import { FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { UsuariosService, UsuarioError, type CrearUsuarioInput } from './usuarios.service'
import { createUsuarioSchema, updatePermisosSchema, updateUsuarioSchema } from './usuarios.schema'
import { uploadToS3, deleteFromS3, getS3SignedUrl } from '../../config/aws'
import { prisma } from '../../config/prisma'
import { SesionesService } from '../sesiones/sesiones.service'
import { getIo, getOnlineUserIds } from '../../sockets'

const setBonosPlanillaSchema = z.object({
  userIds: z.array(z.string().uuid()).min(1, 'Debes seleccionar al menos un usuario'),
  granted: z.boolean()
})

export const UsuariosController = {
  /**
   * POST /api/usuarios — alta manual de un usuario (solo administración).
   *
   * Devuelve 409 y no 400 cuando el correo ya existe: el cuerpo es válido, lo
   * que falla es el estado del recurso, y la UI necesita distinguir «corrige
   * el formulario» de «esa persona ya está dada de alta».
   */
  async create(request: FastifyRequest, reply: FastifyReply) {
    try {
      /// El cast es por el `strictNullChecks: false` del tsconfig: sin él zod
      /// infiere TODAS las claves del objeto como opcionales, y `nombre`,
      /// `correo` y `password` dejarían de encajar en `CrearUsuarioInput`
      /// aunque `parse` ya garantice que vienen.
      const data = createUsuarioSchema.parse(request.body) as CrearUsuarioInput
      const user = await UsuariosService.create(data)
      return reply.status(201).send(user)
    } catch (err: any) {
      if (err instanceof UsuarioError && err.codigo === 'CORREO_DUPLICADO') {
        return reply.status(409).send({ error: 'Correo duplicado', message: err.message })
      }
      if (err?.issues) {
        return reply.status(400).send({ error: 'Datos inválidos', details: err.issues })
      }
      request.log.error({ err }, 'Error creando usuario')
      return reply.status(500).send({ error: 'No se pudo crear el usuario' })
    }
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

  // ─── BONO PLANILLA: otorgar / revocar permiso individual ─────
  // POST /api/usuarios/permisos/bonos-planilla
  //   body: { userIds: string[], granted: boolean }
  // Solo accesible para administradores.
  async setBonosPlanilla(request: FastifyRequest, reply: FastifyReply) {
    try {
      const data = setBonosPlanillaSchema.parse(request.body)
      const updated = await UsuariosService.setBonosPlanilla(data.userIds, data.granted)
      return reply.send({ success: true, updated, granted: data.granted })
    } catch (err: any) {
      if (err?.issues) {
        return reply.status(400).send({ error: 'Datos inválidos', details: err.issues })
      }
      return reply.status(500).send({ error: err.message || 'Error al actualizar el permiso' })
    }
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
  },

  async listConPresencia(_request: FastifyRequest, reply: FastifyReply) {
    const users = await UsuariosService.list()
    const onlineIds = new Set(getOnlineUserIds())
    const result = users.map(u => ({
      ...u,
      en_linea: onlineIds.has(u.id),
    }))
    reply.send(result)
  },

  async getOnlineIds(_request: FastifyRequest, reply: FastifyReply) {
    reply.send(getOnlineUserIds())
  },
}
