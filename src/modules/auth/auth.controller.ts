import { FastifyReply, FastifyRequest } from 'fastify'
import { AuthService } from './auth.service'
import { loginSchema } from './auth.schema'
import { UsuariosService } from '../usuarios/usuarios.service'
import { SesionesService } from '../sesiones/sesiones.service'
import argon2 from 'argon2'
import bcrypt from 'bcrypt'
import { prisma } from '../../config/prisma'
import { uploadToS3, deleteFromS3, getS3SignedUrl } from '../../config/aws'

export const AuthController = {
  async login(request: FastifyRequest, reply: FastifyReply) {
    const data = loginSchema.parse(request.body)
    
    // Extraer IP y user agent
    const ip = request.headers['x-forwarded-for'] as string || request.ip || null
    const userAgent = request.headers['user-agent'] || null
    const rememberMe = (request.body as any)?.rememberMe ?? false

    const result = await AuthService.login(data.correo, data.password, {
      ip,
      userAgent,
      rememberMe
    })
    if (!result) return reply.status(401).send({ error: 'Invalid credentials' })
    if ('disabled' in result) return reply.status(403).send({ error: 'Tu cuenta está deshabilitada. Contacta al administrador.', disabled: true })
    reply.send(result)
  },

  async logout(request: FastifyRequest, reply: FastifyReply) {
    const auth = request.headers['authorization']
    if (auth) {
      const token = auth.split(' ')[1]
      if (token) {
        await AuthService.logout(token)
      }
    }
    reply.send({ message: 'Sesión cerrada' })
  },

  async profile(request: FastifyRequest, reply: FastifyReply) {
    const user = (request as any).user
    if (!user?.id) {
      return reply.status(401).send({ error: 'No autenticado' })
    }

    // Validar que exista una sesión activa para este token
    const auth = request.headers['authorization']
    const token = auth?.split(' ')[1]
    if (token) {
      const sesionActiva = await SesionesService.verificarSesionActiva(token)
      if (!sesionActiva) {
        return reply.status(401).send({ error: 'Sesión no válida o expirada. Inicie sesión nuevamente.' })
      }
      // Actualizar última actividad
      const tokenHash = SesionesService.hashToken(token)
      const ip = request.headers['x-forwarded-for'] as string || request.ip || undefined
      await SesionesService.actualizarActividad(tokenHash, ip)
    }

    try {
      const fullUser = await UsuariosService.getById(user.id)
      if (!fullUser) {
        return reply.status(404).send({ error: 'Usuario no encontrado' })
      }

      // Retornar datos del usuario sin password
      reply.send({
        id: fullUser.id,
        nombre: fullUser.nombre,
        correo: fullUser.correo,
        telefono: fullUser.telefono,
        role: fullUser.role,
        rol: fullUser.role,
        area: fullUser.area || null,
        cargo: fullUser.cargo || null,
        firma_url: fullUser.firma_url || null,
        permisos: fullUser.permisos || {},
        ultimo_acceso: fullUser.ultimo_acceso
      })
    } catch (error) {
      console.error('Error obteniendo perfil:', error)
      reply.status(500).send({ error: 'Error interno' })
    }
  },

  async changePassword(request: FastifyRequest, reply: FastifyReply) {
    const user = (request as any).user
    if (!user?.id) {
      return reply.status(401).send({ error: 'No autenticado' })
    }

    const { currentPassword, newPassword } = request.body as { currentPassword: string; newPassword: string }

    if (!currentPassword || !newPassword) {
      return reply.status(400).send({ error: 'Se requiere la contraseña actual y la nueva' })
    }

    if (newPassword.length < 6) {
      return reply.status(400).send({ error: 'La nueva contraseña debe tener al menos 6 caracteres' })
    }

    try {
      const fullUser = await prisma.usuarios.findUnique({ where: { id: user.id } })
      if (!fullUser) {
        return reply.status(404).send({ error: 'Usuario no encontrado' })
      }

      // Verificar contraseña actual
      let valid = false
      if (fullUser.password.startsWith('$2a$') || fullUser.password.startsWith('$2b$') || fullUser.password.startsWith('$2y$')) {
        valid = await bcrypt.compare(currentPassword, fullUser.password)
      } else if (fullUser.password.startsWith('$argon2')) {
        valid = await argon2.verify(fullUser.password, currentPassword)
      }

      if (!valid) {
        return reply.status(400).send({ error: 'La contraseña actual es incorrecta' })
      }

      // Hash de la nueva contraseña con argon2
      const newHash = await argon2.hash(newPassword)
      await prisma.usuarios.update({
        where: { id: user.id },
        data: { password: newHash, updated_at: new Date() }
      })

      reply.send({ message: 'Contraseña actualizada correctamente' })
    } catch (error) {
      console.error('Error cambiando contraseña:', error)
      reply.status(500).send({ error: 'Error interno' })
    }
  },

  async updateMyProfile(request: FastifyRequest, reply: FastifyReply) {
    const user = (request as any).user
    if (!user?.id) {
      return reply.status(401).send({ error: 'No autenticado' })
    }

    const { telefono, nombre } = request.body as { telefono?: string; nombre?: string }

    try {
      const updateData: any = { updated_at: new Date() }
      if (telefono !== undefined) updateData.telefono = telefono
      if (nombre !== undefined) updateData.nombre = nombre

      const updated = await prisma.usuarios.update({
        where: { id: user.id },
        data: updateData,
        select: {
          id: true,
          nombre: true,
          correo: true,
          telefono: true,
          role: true,
          area: true,
          cargo: true,
          permisos: true,
          ultimo_acceso: true
        }
      })

      reply.send(updated)
    } catch (error) {
      console.error('Error actualizando perfil:', error)
      reply.status(500).send({ error: 'Error interno' })
    }
  },

  async mySession(request: FastifyRequest, reply: FastifyReply) {
    const user = (request as any).user
    if (!user?.id) {
      return reply.status(401).send({ error: 'No autenticado' })
    }

    const auth = request.headers['authorization']
    const token = auth?.split(' ')[1]
    if (!token) {
      return reply.status(401).send({ error: 'No token' })
    }

    try {
      const tokenHash = SesionesService.hashToken(token)
      const sesion = await prisma.sesiones.findFirst({
        where: { token_hash: tokenHash, is_active: true }
      })

      if (!sesion) {
        return reply.send({ sesion: null })
      }

      const now = new Date()
      const diffMs = now.getTime() - sesion.created_at.getTime()
      const diffMins = Math.floor(diffMs / 60000)
      const horas = Math.floor(diffMins / 60)
      const mins = diffMins % 60

      reply.send({
        sesion: {
          id: sesion.id,
          ip: sesion.ip,
          user_agent: sesion.user_agent,
          remember_me: sesion.remember_me,
          token_expiry: sesion.token_expiry,
          last_activity: sesion.last_activity,
          created_at: sesion.created_at,
          is_active: sesion.is_active,
          duracion_minutos: diffMins,
          duracion_texto: horas > 0 ? `${horas}h ${mins}m` : `${mins}m`
        }
      })
    } catch (error) {
      console.error('Error obteniendo sesión:', error)
      reply.status(500).send({ error: 'Error interno' })
    }
  },

  async getMyFirma(request: FastifyRequest, reply: FastifyReply) {
    const user = (request as any).user
    if (!user?.id) return reply.status(401).send({ error: 'No autenticado' })

    const dbUser = await prisma.usuarios.findUnique({ where: { id: user.id }, select: { firma_url: true } })
    if (!dbUser?.firma_url) return reply.send({ firma_url: null, firma_signed_url: null })

    try {
      const firma_signed_url = await getS3SignedUrl(dbUser.firma_url, 3600)
      reply.send({ firma_url: dbUser.firma_url, firma_signed_url })
    } catch {
      reply.send({ firma_url: dbUser.firma_url, firma_signed_url: null })
    }
  },

  async uploadMyFirma(request: FastifyRequest, reply: FastifyReply) {
    const user = (request as any).user
    if (!user?.id) return reply.status(401).send({ error: 'No autenticado' })

    const data = await request.file()
    if (!data) return reply.status(400).send({ error: 'No se envió ningún archivo' })

    const buffer = await data.toBuffer()
    const ext = data.filename.split('.').pop()?.toLowerCase() || 'png'
    const key = `firmas/${user.id}.${ext}`

    // Eliminar firma anterior si existe
    const dbUser = await prisma.usuarios.findUnique({ where: { id: user.id }, select: { firma_url: true } })
    if (dbUser?.firma_url) {
      try { await deleteFromS3(dbUser.firma_url) } catch {}
    }

    await uploadToS3(key, buffer, data.mimetype)
    await prisma.usuarios.update({ where: { id: user.id }, data: { firma_url: key } })

    const firma_signed_url = await getS3SignedUrl(key, 3600)
    reply.send({ success: true, firma_url: key, firma_signed_url })
  },

  async deleteMyFirma(request: FastifyRequest, reply: FastifyReply) {
    const user = (request as any).user
    if (!user?.id) return reply.status(401).send({ error: 'No autenticado' })

    const dbUser = await prisma.usuarios.findUnique({ where: { id: user.id }, select: { firma_url: true } })
    if (dbUser?.firma_url) {
      try { await deleteFromS3(dbUser.firma_url) } catch {}
    }

    await prisma.usuarios.update({ where: { id: user.id }, data: { firma_url: null } })
    reply.send({ success: true })
  }
}
