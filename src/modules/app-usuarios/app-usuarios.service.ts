/**
 * Acceso de usuarios administrativos a la app móvil.
 *
 * El usuario genera desde su perfil un enlace de 30 días. El enlace lleva un código opaco
 * (aquí solo vive su sha256); la app lo canjea por un JWT con la MISMA forma que el del login
 * del dashboard más `tipo: 'app_usuario'` y el id del enlace. Así la app usa los endpoints de
 * siempre: crear un servicio desde el teléfono sigue la misma secuencia (socket a todos, aviso
 * al conductor) que desde la web.
 *
 * El enlace se puede canjear varias veces mientras esté vigente: la app reintenta cuando la red
 * falla, y un código de un solo uso dejaría fuera a quien perdió la respuesta del primer canje.
 * La contención es otra: un enlace vigente por usuario, revocable, y revocarlo corta las
 * sesiones que salieron de él (`sesionAppVigente`, que consulta el middleware).
 */

import crypto from 'crypto'
import jwt from 'jsonwebtoken'

import { env } from '../../config/env'
import { prisma } from '../../config/prisma'
import { getAccessibleModules, normalizarRutasOverride, type Area } from '../../config/permissions'
import { getEmailFrontendUrl } from '../../services/email.service'
import { SesionesService } from '../sesiones/sesiones.service'

export const VIGENCIA_ENLACE_DIAS = 30
/** Áreas que pueden entrar a la app. El rol admin entra siempre. */
export const AREAS_APP: Area[] = ['administracion', 'operaciones', 'hseq']

export class AppUsuariosError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string
  ) {
    super(message)
  }
}

const sha256 = (valor: string) => crypto.createHash('sha256').update(valor).digest('hex')

export function puedeUsarApp(usuario: { role?: string | null; area?: string[] | null }) {
  if (usuario.role === 'admin') return true
  return (usuario.area ?? []).some((a) => (AREAS_APP as string[]).includes(a))
}

/** Enlace web que abre la app: pasa por el puente https porque Gmail y WhatsApp anulan los esquemas propios. */
function urlEnlace(codigo: string) {
  return `${getEmailFrontendUrl()}/public/abrir-app?tipo=usuario&codigo=${encodeURIComponent(codigo)}`
}

function resumen(enlace: { id: string; created_at: Date; expires_at: Date; ultimo_uso_at: Date | null; usos: number }) {
  return {
    id: enlace.id,
    creado: enlace.created_at,
    vence: enlace.expires_at,
    ultimo_uso: enlace.ultimo_uso_at,
    usos: enlace.usos
  }
}

async function cargarUsuarioHabilitado(usuarioId: string) {
  const usuario = await prisma.usuarios.findUnique({
    where: { id: usuarioId },
    select: {
      id: true,
      nombre: true,
      correo: true,
      role: true,
      area: true,
      cargo: true,
      activo: true,
      permisos: true,
      permisos_rutas: true
    }
  })
  if (!usuario || usuario.activo === false) {
    throw new AppUsuariosError('El usuario no existe o está inactivo.', 403, 'USUARIO_INACTIVO')
  }
  if (!puedeUsarApp(usuario)) {
    throw new AppUsuariosError(
      'La app es para administración, operaciones y HSEQ. Tu usuario no tiene ninguna de esas áreas.',
      403,
      'AREA_NO_HABILITADA'
    )
  }
  return usuario
}

export async function enlaceVigente(usuarioId: string) {
  const enlace = await prisma.usuario_enlace_app.findFirst({
    where: {
      usuario_id: usuarioId,
      revoked_at: null,
      expires_at: { gt: new Date() }
    },
    orderBy: { created_at: 'desc' }
  })
  return enlace ? resumen(enlace) : null
}

/** Revoca el enlace vigente (si hay) y emite uno nuevo. El código solo se devuelve aquí, una vez. */
export async function generarEnlace(usuarioId: string) {
  await cargarUsuarioHabilitado(usuarioId)
  const codigo = crypto.randomBytes(32).toString('base64url')
  const ahora = new Date()
  const enlace = await prisma.$transaction(async (tx) => {
    await tx.usuario_enlace_app.updateMany({
      where: { usuario_id: usuarioId, revoked_at: null },
      data: { revoked_at: ahora }
    })
    return tx.usuario_enlace_app.create({
      data: {
        usuario_id: usuarioId,
        codigo_hash: sha256(codigo),
        expires_at: new Date(ahora.getTime() + VIGENCIA_ENLACE_DIAS * 86_400_000)
      }
    })
  })
  cacheEnlaces.clear()
  return { ...resumen(enlace), url: urlEnlace(codigo) }
}

export async function revocarEnlaces(usuarioId: string) {
  const { count } = await prisma.usuario_enlace_app.updateMany({
    where: { usuario_id: usuarioId, revoked_at: null },
    data: { revoked_at: new Date() }
  })
  cacheEnlaces.clear()
  return count
}

/** Canjea el código del enlace por una sesión de la app que vence cuando vence el enlace. */
export async function canjearCodigo(codigo: string, meta: { ip: string | null; userAgent: string | null }) {
  const enlace = await prisma.usuario_enlace_app.findUnique({
    where: { codigo_hash: sha256(codigo) }
  })
  if (!enlace || enlace.revoked_at || enlace.expires_at <= new Date()) {
    throw new AppUsuariosError(
      'Este enlace ya no es válido. Genera uno nuevo desde tu perfil en la web.',
      401,
      'ENLACE_INVALIDO'
    )
  }
  /// Se revalida al canjear, no solo al generar: alguien pudo cambiar de área o quedar inactivo.
  const usuario = await cargarUsuarioHabilitado(enlace.usuario_id)
  const segundos = Math.floor((enlace.expires_at.getTime() - Date.now()) / 1000)
  const token = jwt.sign(
    {
      sub: usuario.id,
      correo: usuario.correo,
      role: usuario.role,
      nombre: usuario.nombre,
      area: usuario.area,
      permisos: usuario.permisos || {},
      tipo: 'app_usuario',
      enlace: enlace.id
    },
    env.JWT_SECRET,
    { expiresIn: segundos }
  )
  await prisma.usuario_enlace_app.update({
    where: { id: enlace.id },
    data: { ultimo_uso_at: new Date(), usos: { increment: 1 } }
  })
  /// Con fila en `sesiones` la sesión aparece en «Sesiones» del dashboard, se puede cerrar desde
  /// allí y `/auth/profile` la acepta.
  await SesionesService.crear({
    usuarioId: usuario.id,
    ip: meta.ip,
    userAgent: meta.userAgent ? `App móvil · ${meta.userAgent}` : 'App móvil',
    rememberMe: true,
    tokenExpiry: enlace.expires_at,
    token
  })
  return {
    token,
    expires_at: enlace.expires_at,
    usuario: {
      id: usuario.id,
      nombre: usuario.nombre,
      correo: usuario.correo,
      role: usuario.role,
      area: usuario.area,
      cargo: usuario.cargo,
      modulos_accesibles: getAccessibleModules(
        usuario.role,
        (usuario.area || []) as Area[],
        normalizarRutasOverride(usuario.permisos_rutas)
      )
    }
  }
}

/// Caché corta: el middleware consulta esto en cada petición de la app. 30 s es lo mismo que
/// tarda en aplicar un recorte de `permisos_rutas`.
const CACHE_MS = 30_000
const cacheEnlaces = new Map<string, { vigente: boolean; hasta: number }>()

/** ¿Sigue viva la sesión de la app? Enlace sin revocar ni vencer y sesión sin cerrar. */
export async function sesionAppVigente(enlaceId: string, token: string) {
  const clave = `${enlaceId}:${sha256(token)}`
  const cache = cacheEnlaces.get(clave)
  if (cache && cache.hasta > Date.now()) return cache.vigente
  const [enlace, sesionActiva] = await Promise.all([
    prisma.usuario_enlace_app.findUnique({
      where: { id: enlaceId },
      select: { revoked_at: true, expires_at: true }
    }),
    SesionesService.verificarSesionActiva(token)
  ])
  const vigente = !!enlace && !enlace.revoked_at && enlace.expires_at > new Date() && sesionActiva
  cacheEnlaces.set(clave, { vigente, hasta: Date.now() + CACHE_MS })
  return vigente
}
