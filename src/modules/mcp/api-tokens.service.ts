import { createHash, randomBytes } from 'crypto'
import { prisma } from '../../config/prisma'

/** Los tokens llevan prefijo propio para reconocerlos en logs y en el gestor de secretos. */
const PREFIJO = 'cmq_'
const MAX_TOKENS_ACTIVOS = 10
/** No se escribe `last_used_at` en cada llamada: basta con saber el uso aproximado. */
const REFRESCO_USO_MS = 5 * 60 * 1000

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function pareceToken(valor: string | undefined | null): valor is string {
  return !!valor && valor.startsWith(PREFIJO) && valor.length > 20
}

export class ErrorApiToken extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message)
  }
}

/**
 * Tokens personales con los que Claude (u otra herramienta MCP) actúa en nombre
 * de un usuario. Heredan exactamente sus permisos: rol, áreas y `permisos_rutas`
 * se leen en cada llamada (ver `cargarUsuarioAsistente`), así que un cambio de
 * permisos o desactivar al usuario aplica de inmediato.
 *
 * Solo se guarda el hash SHA-256: el valor completo se muestra una única vez.
 */
export const apiTokensService = {
  async crear(usuarioId: string, nombre: string) {
    const activos = await prisma.api_tokens.count({ where: { usuario_id: usuarioId, revoked_at: null } })
    if (activos >= MAX_TOKENS_ACTIVOS) {
      throw new ErrorApiToken(
        `Ya tienes ${MAX_TOKENS_ACTIVOS} conexiones activas. Revoca alguna antes de crear otra.`,
        400,
      )
    }

    const token = `${PREFIJO}${randomBytes(32).toString('base64url')}`
    const fila = await prisma.api_tokens.create({
      data: {
        usuario_id: usuarioId,
        nombre: nombre.trim(),
        prefijo: token.slice(0, 10),
        token_hash: hashToken(token),
      },
      select: { id: true, nombre: true, prefijo: true, created_at: true },
    })

    // El valor completo solo existe en esta respuesta.
    return { id: fila.id, nombre: fila.nombre, prefijo: fila.prefijo, createdAt: fila.created_at, lastUsedAt: null, token }
  },

  async listar(usuarioId: string) {
    const filas = await prisma.api_tokens.findMany({
      where: { usuario_id: usuarioId, revoked_at: null },
      select: { id: true, nombre: true, prefijo: true, created_at: true, last_used_at: true },
      orderBy: { created_at: 'desc' },
    })
    return filas.map((f) => ({
      id: f.id,
      nombre: f.nombre,
      prefijo: f.prefijo,
      createdAt: f.created_at,
      lastUsedAt: f.last_used_at,
    }))
  },

  async revocar(usuarioId: string, id: string) {
    const r = await prisma.api_tokens.updateMany({
      where: { id, usuario_id: usuarioId, revoked_at: null },
      data: { revoked_at: new Date() },
    })
    if (r.count === 0) throw new ErrorApiToken('Conexión no encontrada', 404)
    return { ok: true }
  },

  /** Id del usuario dueño de un token vigente, o null si no existe, se revocó o el usuario está inactivo. */
  async autenticar(token: string): Promise<string | null> {
    const fila = await prisma.api_tokens.findFirst({
      where: { token_hash: hashToken(token), revoked_at: null },
      select: { id: true, last_used_at: true, usuario: { select: { id: true, activo: true } } },
    })
    if (!fila || !fila.usuario.activo) return null

    if (!fila.last_used_at || Date.now() - fila.last_used_at.getTime() > REFRESCO_USO_MS) {
      void prisma.api_tokens
        .update({ where: { id: fila.id }, data: { last_used_at: new Date() } })
        .catch(() => undefined)
    }
    return fila.usuario.id
  },
}
