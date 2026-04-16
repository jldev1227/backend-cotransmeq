import { prisma } from '../../config/prisma'
import argon2 from 'argon2'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { env } from '../../config/env'
import { SesionesService } from '../sesiones/sesiones.service'

export const AuthService = {
  async login(correo: string, password: string, options?: { ip?: string | null; userAgent?: string | null; rememberMe?: boolean }) {
    const user = await prisma.usuarios.findUnique({ where: { correo } })
    if (!user) return null
    
    // Detectar si la contraseña está en formato bcrypt (empieza con $2a$, $2b$, o $2y$)
    // o en formato argon2 (empieza con $argon2)
    let valid = false
    if (user.password.startsWith('$2a$') || user.password.startsWith('$2b$') || user.password.startsWith('$2y$')) {
      // Contraseña en formato bcrypt (del backend antiguo)
      valid = await bcrypt.compare(password, user.password)
    } else if (user.password.startsWith('$argon2')) {
      // Contraseña en formato argon2 (nuevas contraseñas)
      valid = await argon2.verify(user.password, password)
    } else {
      // Formato desconocido
      return null
    }
    
    if (!valid) return null

    // Check if user is disabled
    if (user.activo === false) {
      return { disabled: true }
    }

    const rememberMe = options?.rememberMe ?? false
    const expiresIn = rememberMe ? '90d' : '30d'
    const tokenExpiry = new Date(Date.now() + (rememberMe ? 90 : 30) * 24 * 60 * 60 * 1000)

    const token = jwt.sign(
      { sub: user.id, correo: user.correo, role: user.role, nombre: user.nombre, area: user.area },
      env.JWT_SECRET,
      { expiresIn }
    )

    // Crear sesión
    try {
      await SesionesService.crear({
        usuarioId: user.id,
        ip: options?.ip || null,
        userAgent: options?.userAgent || null,
        rememberMe,
        tokenExpiry,
        token
      })
    } catch (err) {
      console.error('Error al crear sesión:', err)
    }

    // Actualizar último acceso
    await prisma.usuarios.update({
      where: { id: user.id },
      data: { ultimo_acceso: new Date() }
    })
    
    // Excluir password de la respuesta
    const { password: _, ...userSinPassword } = user
    return { user: userSinPassword, token }
  },

  async logout(token: string) {
    try {
      const tokenHash = SesionesService.hashToken(token)
      await SesionesService.cerrar(tokenHash)
    } catch (err) {
      console.error('Error al cerrar sesión:', err)
    }
  }
}
