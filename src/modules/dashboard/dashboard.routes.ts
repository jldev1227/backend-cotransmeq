/**
 * Panel de inicio. Ver `secciones.ts` para quién ve qué y `periodo.ts` para
 * el rango de fechas.
 *
 *  GET /dashboard/secciones            → qué secciones le tocan al usuario
 *  GET /dashboard/secciones/:id?desde&hasta → los datos de una sección
 *
 * Cada sección se pide por separado: la página pinta las tarjetas con su
 * esqueleto y las va llenando, en vez de esperar a la consulta más lenta.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { authMiddleware } from '../../middlewares/auth.middleware'
import { requirePermission } from '../../middlewares/permissions.middleware'
import { obtenerPermisosRutas } from '../../services/permisos-rutas.service'
import { getAccessibleModules, type AccessLevel } from '../../config/permissions'
import { resolverPeriodo, type Periodo } from './periodo'
import { seccionesVisibles, type IdSeccion, type UsuarioPanel } from './secciones'
import { seccionOperaciones } from './seccion-operaciones'
import { seccionHseq } from './seccion-hseq'
import { seccionMantenimiento } from './seccion-mantenimiento'
import {
  aplicarSeguridadSocialDefecto,
  guardarSeguridadSocialDefecto,
  leerSeguridadSocialDefecto,
  seccionTalentoHumano,
} from './seccion-talento-humano'
import { z } from 'zod'
import { seccionContabilidad, seccionFacturacion } from './seccion-facturacion'

export interface ContextoSeccion {
  periodo: Periodo
  /** Módulos accesibles del usuario con su nivel: los widgets se omiten sin ellos. */
  modulos: Record<string, AccessLevel>
  user: UsuarioPanel
}

const CONSTRUCTORES: Partial<Record<IdSeccion, (ctx: ContextoSeccion) => Promise<Record<string, unknown>>>> = {
  operaciones: seccionOperaciones,
  hseq: seccionHseq,
  mantenimiento: seccionMantenimiento,
  talento_humano: seccionTalentoHumano,
  facturacion: seccionFacturacion,
  contabilidad: seccionContabilidad,
}

async function modulosDe(user: any): Promise<Record<string, AccessLevel>> {
  const override = await obtenerPermisosRutas(user.id ?? user.sub)
  return getAccessibleModules(user.role, user.area, override)
}

export async function dashboardRoutes(app: FastifyInstance) {
  const protegida = {
    onRequest: authMiddleware,
    preHandler: requirePermission('dashboard'),
  }

  app.get('/dashboard/secciones', protegida, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user
    const modulos = await modulosDe(user)
    const secciones = seccionesVisibles(user, modulos).map((s) => ({
      id: s.id,
      titulo: s.titulo,
      descripcion: s.descripcion,
      disponible: Boolean(CONSTRUCTORES[s.id]),
    }))
    return reply.send({ success: true, data: { secciones, modulos } })
  })

  app.get('/dashboard/secciones/:id', protegida, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user
    const { id } = request.params as { id: string }
    const modulos = await modulosDe(user)
    const seccion = seccionesVisibles(user, modulos).find((s) => s.id === id)
    if (!seccion) {
      return reply.status(404).send({ success: false, message: 'Esa sección no está disponible para tu usuario.' })
    }
    const construir = CONSTRUCTORES[seccion.id]
    if (!construir) {
      return reply.status(200).send({ success: true, data: null, message: 'Sección en construcción' })
    }
    const periodo = resolverPeriodo(request.query as Record<string, unknown>)
    try {
      const data = await construir({ periodo, modulos, user })
      return reply.send({ success: true, data: { periodo: { desde: periodo.desde, hasta: periodo.hasta, dias: periodo.dias }, ...data } })
    } catch (err) {
      request.log.error({ err }, `[dashboard] sección ${seccion.id}`)
      return reply.status(500).send({ success: false, message: 'No se pudo armar la sección' })
    }
  })

  // ── Seguridad social por defecto (talento humano) ──────────────────────
  // Leer la pide la sección; guardarla y aplicarla exigen permiso completo
  // sobre conductores, porque escribe en sus fichas.
  const texto = z.string().trim().max(120).nullable().optional()
  const seguridadSchema = z.object({ eps: texto, fondo_pension: texto, arl: texto })
  const escribeConductores = { onRequest: authMiddleware, preHandler: requirePermission('conductores', 'full') }

  app.get('/dashboard/talento-humano/seguridad-social', protegida, async (_request, reply) => {
    return reply.send({ success: true, data: await leerSeguridadSocialDefecto() })
  })

  app.put('/dashboard/talento-humano/seguridad-social', escribeConductores, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = seguridadSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ success: false, message: 'Datos inválidos', details: parsed.error.flatten() })
    const user = (request as any).user
    const valor = await guardarSeguridadSocialDefecto(
      { eps: parsed.data.eps || null, fondo_pension: parsed.data.fondo_pension || null, arl: parsed.data.arl || null },
      user?.id ?? user?.sub ?? null
    )
    return reply.send({ success: true, data: valor })
  })

  app.post('/dashboard/talento-humano/seguridad-social/aplicar', escribeConductores, async (_request, reply) => {
    const valor = await leerSeguridadSocialDefecto()
    if (!valor.eps && !valor.fondo_pension && !valor.arl) {
      return reply.status(400).send({ success: false, message: 'Primero guarda la EPS, el fondo de pensión o la ARL por defecto.' })
    }
    const resultado = await aplicarSeguridadSocialDefecto(valor)
    return reply.send({ success: true, data: resultado, message: 'Seguridad social aplicada a los vinculados que no la tenían' })
  })
}
