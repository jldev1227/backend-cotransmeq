import crypto from 'crypto'
import { FastifyReply, FastifyRequest } from 'fastify'
import jwt from 'jsonwebtoken'
import { env } from '../config/env'
import { prisma } from '../config/prisma'
import { sesionAppVigente } from '../modules/app-usuarios/app-usuarios.service'
import { guardarSesionEnCache, leerSesionEnCache, type UsuarioDeSesion } from './cache-sesiones'

/**
 * Tipos de token que abren la API del equipo.
 *
 * El backend firma con el mismo secreto varias clases de token: los del
 * dashboard (sin `tipo`), los de la app de administrativos (`app_usuario`) y
 * los del portal del conductor (`conductor_portal`, `conductor_dias_laborados`
 * y los de impresión). Hasta oct-2026 este middleware aceptaba cualquiera, así
 * que el enlace de 30 días que le llega por correo a un conductor abría
 * nómina, primas, facturación o liquidaciones, borrar incluido. Los tokens del
 * portal tienen sus propias rutas y su propia verificación; aquí solo entran
 * los de personas del equipo.
 */
export const TIPOS_DEL_EQUIPO = new Set<string | undefined>([undefined, 'app_usuario'])

/** Mismo hash con el que `SesionesService` guarda el token en `sesiones.token_hash`. */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex').substring(0, 64)
}

/**
 * Usuario de una sesión vigente, o null si la sesión se cerró, venció o el
 * usuario quedó inactivo.
 *
 * El JWT solo prueba que el token lo firmamos nosotros. Hasta oct-2026 era lo
 * único que se miraba: cerrar la sesión, cerrarla desde administración o
 * desactivar a alguien no le quitaba el acceso, que seguía hasta que el token
 * vencía (30 días, 90 con «recordarme»). Ahora manda la fila de `sesiones`.
 *
 * El rol, las áreas y los permisos salen de aquí y no del token: en el token
 * quedaban congelados hasta el siguiente login, así que quitarle un área a
 * alguien no surtía efecto en semanas.
 */
export async function usuarioDeSesion(tokenHash: string): Promise<UsuarioDeSesion | null> {
  const enCache = leerSesionEnCache(tokenHash)
  if (enCache !== undefined) return enCache

  const sesion = await prisma.sesiones.findFirst({
    where: { token_hash: tokenHash, is_active: true, token_expiry: { gt: new Date() } },
    select: {
      id: true,
      usuario: {
        select: { id: true, role: true, area: true, permisos: true, nombre: true, correo: true, activo: true }
      }
    }
  })
  const u = sesion?.usuario
  const usuario: UsuarioDeSesion | null =
    u && u.activo !== false
      ? {
          id: u.id,
          role: u.role ?? null,
          area: Array.isArray(u.area) ? u.area : [],
          permisos: (u.permisos as Record<string, unknown> | null) ?? {},
          nombre: u.nombre ?? null,
          correo: u.correo ?? null
        }
      : null
  guardarSesionEnCache(tokenHash, usuario)

  /// La actividad se apunta al refrescar la caché (como mucho cada 30 s por
  /// sesión), no en cada petición. Sin `await`: un fallo aquí no debe tumbar
  /// la petición del usuario.
  if (sesion && usuario) {
    void prisma.sesiones
      .update({ where: { id: sesion.id }, data: { last_activity: new Date() } })
      .catch(() => undefined)
  }
  return usuario
}

export async function authMiddleware(request: FastifyRequest, reply: FastifyReply) {
  const auth = request.headers['authorization']
  if (!auth) return reply.status(401).send({ error: 'No token' })
  const parts = auth.split(' ')
  if (parts.length !== 2) return reply.status(401).send({ error: 'Invalid token' })
  const token = parts[1]

  let payload: any
  try {
    payload = jwt.verify(token, env.JWT_SECRET)
  } catch {
    return reply.status(401).send({ error: 'Invalid token' })
  }

  if (!TIPOS_DEL_EQUIPO.has(payload?.tipo)) {
    return reply.status(401).send({ error: 'Invalid token', message: 'Este acceso no sirve para esta sección.' })
  }

  const usuario = await usuarioDeSesion(hashToken(token))
  if (!usuario) {
    return reply
      .status(401)
      .send({ error: 'Sesión cerrada', message: 'Tu sesión se cerró o venció. Inicia sesión de nuevo.' })
  }

  ;(request as any).user = {
    ...payload,
    id: usuario.id,
    sub: usuario.id,
    role: usuario.role,
    area: usuario.area,
    permisos: usuario.permisos,
    nombre: usuario.nombre ?? payload.nombre,
    correo: usuario.correo ?? payload.correo
  }

  /// Las sesiones de la app móvil además dependen de su enlace, que se revoca
  /// desde el perfil del usuario.
  if (payload.tipo === 'app_usuario' && !(await sesionAppVigente(payload.enlace, token))) {
    return reply.status(401).send({ error: 'Sesión revocada', message: 'Tu acceso a la app fue revocado o venció.' })
  }
}
