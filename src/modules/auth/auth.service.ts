import { prisma } from '../../config/prisma'
import argon2 from 'argon2'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { env } from '../../config/env'

export const AuthService = {
  async login(correo: string, password: string) {
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
    const token = jwt.sign({ sub: user.id, correo: user.correo, role: user.role }, env.JWT_SECRET, { expiresIn: '30d' })
    return { user, token }
  }
}
