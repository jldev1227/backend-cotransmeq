/**
 * Consulta del registro de actividad (ver `registro-actividad.service.ts`).
 *
 * Quién ve qué: el admin ve todo; los demás ven lo que hizo la gente de sus
 * áreas (y lo suyo). Un usuario sin área solo se ve a sí mismo.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../../config/prisma'
import { authMiddleware } from '../../middlewares/auth.middleware'
import { requirePermission } from '../../middlewares/permissions.middleware'

const FECHA = /^\d{4}-\d{2}-\d{2}$/

const consultaSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(15),
  pagina: z.coerce.number().int().min(1).default(1),
  area: z.string().max(40).optional(),
  usuario_id: z.string().uuid().optional(),
  modulo: z.string().max(60).optional(),
  accion: z.string().max(20).optional(),
  q: z.string().max(120).optional(),
  desde: z.string().regex(FECHA).optional(),
  hasta: z.string().regex(FECHA).optional(),
})

export function areasDe(user: any): string[] {
  return Array.isArray(user?.area) ? user.area : user?.area ? [user.area] : []
}

/** Condición de visibilidad: admin todo; los demás, su gente y ellos mismos. */
export function visibilidadActividad(user: any): Prisma.registro_actividadWhereInput {
  if (user?.role === 'admin') return {}
  const areas = areasDe(user)
  const propio: Prisma.registro_actividadWhereInput = { usuario_id: user.id ?? user.sub }
  if (areas.length === 0) return propio
  return { OR: [{ usuario_areas: { hasSome: areas } }, propio] }
}

export async function actividadRoutes(app: FastifyInstance) {
  const protegida = {
    onRequest: authMiddleware,
    preHandler: requirePermission('actividad'),
  }

  app.get('/actividad', protegida, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = consultaSchema.safeParse(request.query)
    if (!parsed.success) {
      return reply.status(400).send({ success: false, message: 'Parámetros inválidos', details: parsed.error.flatten() })
    }
    const q = parsed.data
    const user = (request as any).user

    const where: Prisma.registro_actividadWhereInput = { AND: [visibilidadActividad(user)] }
    const and = where.AND as Prisma.registro_actividadWhereInput[]
    if (q.area) and.push({ usuario_areas: { has: q.area } })
    if (q.usuario_id) and.push({ usuario_id: q.usuario_id })
    if (q.modulo) and.push({ modulo: q.modulo })
    if (q.accion) and.push({ accion: q.accion })
    if (q.q) {
      and.push({
        OR: [
          { descripcion: { contains: q.q, mode: 'insensitive' } },
          { usuario_nombre: { contains: q.q, mode: 'insensitive' } },
          { recurso_ref: { contains: q.q, mode: 'insensitive' } },
        ],
      })
    }
    if (q.desde) and.push({ created_at: { gte: new Date(`${q.desde}T00:00:00-05:00`) } })
    if (q.hasta) and.push({ created_at: { lt: new Date(`${q.hasta}T24:00:00-05:00`) } })

    const [total, filas] = await Promise.all([
      prisma.registro_actividad.count({ where }),
      prisma.registro_actividad.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (q.pagina - 1) * q.limit,
        take: q.limit,
        select: {
          id: true,
          usuario_id: true,
          usuario_nombre: true,
          usuario_areas: true,
          modulo: true,
          accion: true,
          recurso_id: true,
          recurso_ref: true,
          descripcion: true,
          detalle: true,
          created_at: true,
        },
      }),
    ])

    return reply.send({
      success: true,
      data: filas,
      meta: { total, pagina: q.pagina, limit: q.limit, totalPages: Math.max(1, Math.ceil(total / q.limit)) },
    })
  })

  /// Listas para los filtros de la página: quiénes y qué módulos aparecen en
  /// lo que este usuario puede ver (últimos 90 días, para que no crezca).
  app.get('/actividad/opciones', protegida, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user
    const desde = new Date(Date.now() - 90 * 86400000)
    const where: Prisma.registro_actividadWhereInput = { AND: [visibilidadActividad(user), { created_at: { gte: desde } }] }
    const [usuarios, modulos] = await Promise.all([
      prisma.registro_actividad.groupBy({ by: ['usuario_id', 'usuario_nombre'], where, _count: { _all: true }, orderBy: { usuario_nombre: 'asc' } }),
      prisma.registro_actividad.groupBy({ by: ['modulo'], where, _count: { _all: true }, orderBy: { modulo: 'asc' } }),
    ])
    return reply.send({
      success: true,
      data: {
        usuarios: usuarios.filter((u) => u.usuario_id).map((u) => ({ id: u.usuario_id, nombre: u.usuario_nombre, registros: u._count._all })),
        modulos: modulos.map((m) => ({ id: m.modulo, registros: m._count._all })),
        areas: user?.role === 'admin' ? null : areasDe(user),
      },
    })
  })
}
