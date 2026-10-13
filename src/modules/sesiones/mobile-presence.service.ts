import { prisma } from '../../config/prisma'
import { logger } from '../../utils/logger'

type Kind = 'usuario' | 'conductor'
type Identidad = { kind: Kind; id: string; platform: 'ios' | 'android' }

/// La presencia representa sockets de la app en primer plano, no tokens vigentes.
/// Un mismo usuario puede tener dos teléfonos; sale de línea al cerrar el último.
const conexiones = new Map<string, Identidad>()

export async function registrarPresenciaMovil(socketId: string, identidad: Identidad): Promise<boolean> {
  if (conexiones.has(socketId)) return false
  conexiones.set(socketId, identidad)
  try {
    await prisma.mobile_app_activity.upsert({
    where: { principal_kind_principal_id: { principal_kind: identidad.kind, principal_id: identidad.id } },
    create: {
      principal_kind: identidad.kind,
      principal_id: identidad.id,
      platform: identidad.platform
    },
    update: { last_seen_at: new Date(), platform: identidad.platform, sessions_count: { increment: 1 } }
    })
  } catch (err) {
    conexiones.delete(socketId)
    logger.error({ err, kind: identidad.kind, principalId: identidad.id }, 'No se registró el acceso móvil')
    return false
  }
  return true
}

export function retirarPresenciaMovil(socketId: string): boolean {
  const identidad = conexiones.get(socketId)
  if (!identidad) return false
  conexiones.delete(socketId)
  void prisma.mobile_app_activity.updateMany({
    where: { principal_kind: identidad.kind, principal_id: identidad.id },
    data: { last_seen_at: new Date() }
  }).catch((err) => logger.error({ err, kind: identidad.kind, principalId: identidad.id }, 'No se actualizó la salida móvil'))
  return true
}

export async function listarActividadMovil() {
  const filas = await prisma.mobile_app_activity.findMany({ orderBy: { last_seen_at: 'desc' } })
  const usuariosIds = filas.filter((f) => f.principal_kind === 'usuario').map((f) => f.principal_id)
  const conductoresIds = filas.filter((f) => f.principal_kind === 'conductor').map((f) => f.principal_id)
  const [usuarios, conductores] = await Promise.all([
    prisma.usuarios.findMany({ where: { id: { in: usuariosIds } }, select: { id: true, nombre: true, correo: true, area: true, activo: true } }),
    prisma.conductores.findMany({ where: { id: { in: conductoresIds } }, select: { id: true, nombre: true, apellido: true, email: true, estado: true } })
  ])
  const porUsuario = new Map(usuarios.map((u) => [u.id, u]))
  const porConductor = new Map(conductores.map((c) => [c.id, c]))
  const enLinea = new Set(Array.from(conexiones.values(), (c) => `${c.kind}:${c.id}`))
  return filas.map((fila) => {
    const usuario = fila.principal_kind === 'usuario' ? porUsuario.get(fila.principal_id) : null
    const conductor = fila.principal_kind === 'conductor' ? porConductor.get(fila.principal_id) : null
    return {
      kind: fila.principal_kind,
      id: fila.principal_id,
      nombre: usuario?.nombre ?? (conductor ? `${conductor.nombre} ${conductor.apellido}`.trim() : 'Persona no disponible'),
      correo: usuario?.correo ?? conductor?.email ?? null,
      area: usuario?.area ?? [],
      platform: fila.platform,
      first_seen_at: fila.first_seen_at,
      last_seen_at: fila.last_seen_at,
      sessions_count: fila.sessions_count,
      en_linea: enLinea.has(`${fila.principal_kind}:${fila.principal_id}`)
    }
  })
}
