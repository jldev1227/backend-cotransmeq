import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { authMiddleware } from '../../middlewares/auth.middleware'
import { requirePermission } from '../../middlewares/permissions.middleware'
import { checkAccess } from '../../config/permissions'
import { prisma } from '../../config/prisma'
import * as cap from './capacitaciones.service'
import { crearCertificadoPdf } from './certificado-pdf'
import * as archivos from './capacitaciones.archivos'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'

type Req = FastifyRequest<{ Params: { id: string; moduloId: string; leccionId: string }; Body: any }>
type Resolver = (r: FastifyRequest) => Promise<cap.CapPersona>
type Handler = (r: Req, p: cap.CapPersona) => Promise<unknown>
const ok = (data: unknown) => ({ success: true, data })
const body = (r: FastifyRequest): Record<string, unknown> =>
  r.body && typeof r.body === 'object' && !Array.isArray(r.body) ? r.body as Record<string, unknown> : {}

function wrap(handler: Handler, resolver: Resolver) {
  return async (r: Req, reply: FastifyReply) => {
    try { return reply.send(ok(await handler(r, await resolver(r)))) }
    catch (error) {
      if (error instanceof cap.CapError) return reply.status(error.status).send({ success: false, message: error.message })
      r.log.error({ err: error }, '[capacitaciones] error')
      return reply.status(500).send({ success: false, message: 'No se pudo completar la operación.' })
    }
  }
}

function gestor(r: FastifyRequest) {
  const u = (r as any).user
  const acceso = checkAccess(u?.area, 'capacitaciones-gestion', u?.permisos_rutas, u?.id)
  return acceso.allowed && acceso.level === 'full'
}

async function equipo(r: FastifyRequest): Promise<cap.CapPersona> {
  const id = (r as any).user?.id as string
  const u = await prisma.usuarios.findFirst({ where: { id, activo: true }, select: { nombre: true } })
  if (!u) throw new cap.CapError('La sesión no está activa.', 401)
  return { tipo: 'administrativo', id, nombre: u.nombre }
}

async function conductor(r: FastifyRequest): Promise<cap.CapPersona> {
  const id = (r as any).conductorPortal?.id as string
  const c = await prisma.conductores.findFirst({
    where: { id, estado: 'activo', oculto: false, deleted_at: null }, select: { nombre: true, apellido: true }
  })
  if (!c) throw new cap.CapError('El conductor no está activo.', 401)
  return { tipo: 'conductor', id, nombre: (c.nombre + ' ' + c.apellido).trim() }
}

async function conPortadaUrl(curso: any) {
  if (typeof curso.portadaUrl === 'string' && curso.portadaUrl) return curso
  const configuracion = curso.configuracion as Record<string, unknown> | null
  if (typeof configuracion?.portadaArchivoId !== 'string') return curso
  try {
    const portada = await archivos.urlArchivo(configuracion.portadaArchivoId)
    return { ...curso, portadaUrl: portada.url }
  } catch {
    // Una portada faltante no debe impedir ver o gestionar el curso.
    return curso
  }
}

async function detalleConArchivos(data: any) {
  data.curso = await conPortadaUrl(data.curso)
  for (const modulo of data.curso.modulos) {
    for (const leccion of modulo.lecciones) {
      const contenido = leccion.contenido as Record<string, unknown>
      if (!contenido || typeof contenido !== 'object') continue
      if (typeof contenido.archivoId === 'string') {
        const enlace = await archivos.urlArchivo(contenido.archivoId)
        contenido.url = enlace.url
        if (enlace.previewUrl) contenido.previewUrl = enlace.previewUrl
      }
      if (typeof contenido.subtitulosArchivoId === 'string') {
        contenido.subtitulosUrl = (await archivos.urlArchivo(contenido.subtitulosArchivoId)).url
      }
    }
  }
  return data
}

function registrarAlumno(app: FastifyInstance, base: string, persona: Resolver) {
  app.get(base + '/cursos', wrap((_r, p) => cap.listarCapacitaciones(p), persona))
  app.get(base + '/cursos/:id', wrap(async (r, p) =>
    detalleConArchivos(await cap.obtenerCapacitacion(r.params.id, p)), persona))
  app.put(base + '/cursos/:id/lecciones/:leccionId/progreso',
    wrap((r, p) => cap.guardarProgreso(r.params.id, r.params.leccionId, p, body(r)), persona))
  app.post(base + '/cursos/:id/evaluacion',
    wrap((r, p) => cap.presentarEvaluacion(r.params.id, p, body(r).respuestas), persona))
  app.get(base + '/biometria', wrap((_r, p) => cap.estadoBiometria(p), persona))
  app.post(base + '/biometria/enrolar', wrap((r, p) => cap.enrolarBiometria(p, body(r)), persona))
  app.post(base + '/cursos/:id/biometria/verificar',
    wrap((r, p) => cap.verificarBiometria(p, r.params.id, body(r)), persona))
  app.delete(base + '/biometria', wrap((_r, p) => cap.borrarBiometria(p), persona))
  app.get(base + '/cursos/:id/certificado', wrap(async (r, p) => {
    const c = await cap.obtenerCertificado(r.params.id, p)
    return { codigo: c.codigo, nombre: c.nombre, emitidoAt: c.emitidoAt,
      vigenteHasta: c.vigenteHasta, curso: c.asignacion.curso.titulo }
  }, persona))
  app.get(base + '/cursos/:id/certificado/pdf', async (r, reply) => {
    try {
      const p = await persona(r)
      const c = await cap.obtenerCertificado((r.params as { id: string }).id, p)
      const pdf = await crearCertificadoPdf({
        codigo: c.codigo, nombre: c.nombre, curso: c.asignacion.curso.titulo,
        emitidoAt: c.emitidoAt, vigenteHasta: c.vigenteHasta
      })
      return reply.type('application/pdf').header('Content-Disposition',
        'attachment; filename="certificado-' + c.codigo + '.pdf"').send(pdf)
    } catch (error) {
      if (error instanceof cap.CapError) return reply.status(error.status).send({ success: false, message: error.message })
      r.log.error({ err: error }, '[capacitaciones] certificado PDF')
      return reply.status(500).send({ success: false, message: 'No se pudo generar el certificado.' })
    }
  })
}

export async function capacitacionesRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authMiddleware)
  app.addHook('preHandler', requirePermission('capacitaciones', 'read'))
  registrarAlumno(app, '/capacitaciones', equipo)
  const manage = (handler: Handler) => wrap(async (r, p) => {
    if (!gestor(r)) throw new cap.CapError('No tienes permisos para gestionar capacitaciones.', 403)
    return handler(r, p)
  }, equipo)
  app.get('/capacitaciones/gestion/acceso', manage(async () => ({ puedeGestionar: true })))
  app.get('/capacitaciones/gestion/cursos', manage(async (_r, p) => {
    const cursos = await cap.listarCapacitaciones(p, true)
    return Promise.all(cursos.map(conPortadaUrl))
  }))
  app.get('/capacitaciones/gestion/personas', manage(() => cap.listarPersonasCapacitacion()))
  app.get('/capacitaciones/gestion/cursos/:id/archivos', manage((r) => archivos.listarArchivos(r.params.id)))
  app.post('/capacitaciones/gestion/cursos/:id/archivos/iniciar',
    manage((r) => archivos.iniciarArchivo(r.params.id, body(r))))
  app.post('/capacitaciones/gestion/archivos/:id/confirmar', manage((r) => archivos.confirmarArchivo(r.params.id)))
  app.post('/capacitaciones/gestion/archivos/:id/multipart/completar',
    manage((r) => archivos.completarArchivoMultipart(r.params.id, body(r))))
  app.post('/capacitaciones/gestion/archivos/:id/multipart/abortar',
    manage((r) => archivos.abortarArchivoMultipart(r.params.id, body(r).uploadId)))
  app.get('/capacitaciones/gestion/archivos/:id/url', manage((r) => archivos.urlArchivo(r.params.id)))
  app.post('/capacitaciones/gestion/archivos/:id/contenido', async (r, reply) => {
    try {
      if (!gestor(r)) throw new cap.CapError('No tienes permisos para subir archivos.', 403)
      return reply.send(ok(await archivos.subirArchivoLocal((r.params as { id: string }).id, r)))
    } catch (error) {
      if (error instanceof cap.CapError) return reply.status(error.status).send({ success: false, message: error.message })
      r.log.error({ err: error }, '[capacitaciones] subida')
      return reply.status(500).send({ success: false, message: 'No se pudo subir el archivo.' })
    }
  })
  app.get('/capacitaciones/gestion/cursos/:id', manage(async (r, p) =>
    detalleConArchivos(await cap.obtenerCapacitacion(r.params.id, p, true))))
  app.post('/capacitaciones/gestion/cursos', manage((r, p) => cap.guardarCurso(body(r), p.id)))
  app.put('/capacitaciones/gestion/cursos/:id', manage((r, p) => cap.guardarCurso(body(r), p.id, r.params.id)))
  app.post('/capacitaciones/gestion/cursos/:id/modulos', manage((r) => cap.guardarModulo(r.params.id, body(r))))
  app.put('/capacitaciones/gestion/cursos/:id/modulos/:moduloId',
    manage((r) => cap.guardarModulo(r.params.id, body(r), r.params.moduloId)))
  app.delete('/capacitaciones/gestion/modulos/:id', manage(async (r) => { await cap.eliminarModulo(r.params.id); return null }))
  app.post('/capacitaciones/gestion/modulos/:moduloId/lecciones',
    manage((r) => cap.guardarLeccion(r.params.moduloId, body(r))))
  app.put('/capacitaciones/gestion/modulos/:moduloId/lecciones/:leccionId',
    manage((r) => cap.guardarLeccion(r.params.moduloId, body(r), r.params.leccionId)))
  app.delete('/capacitaciones/gestion/lecciones/:id', manage(async (r) => { await cap.eliminarLeccion(r.params.id); return null }))
  app.put('/capacitaciones/gestion/cursos/:id/preguntas',
    manage((r) => cap.guardarPreguntas(r.params.id, body(r).preguntas)))
  app.post('/capacitaciones/gestion/cursos/:id/asignaciones',
    manage((r) => cap.asignarCapacitacion(r.params.id, body(r).personas)))
}

/** Dentro del grupo que ya valida el token revocable del portal. */
export async function capacitacionesPortalRoutes(app: FastifyInstance) {
  registrarAlumno(app, '/conductor-portal/capacitaciones', conductor)
}

export async function capacitacionesPublicRoutes(app: FastifyInstance) {
  app.get('/capacitaciones/archivos/:id/contenido', { helmet: false }, async (r, reply) => {
    try {
      const { id } = r.params as { id: string }
      const q = r.query as { expires?: string; signature?: string; preview?: string }
      const { archivo, ruta, mime } = await archivos.archivoLocalFirmado(id, q.expires ?? '', q.signature ?? '', q.preview === '1')
      const info = await stat(ruta)
      const rango = /^bytes=(\d+)-(\d*)$/.exec(String(r.headers.range ?? ''))
      const desde = rango ? Number(rango[1]) : 0
      const hasta = rango ? (rango[2] ? Math.min(Number(rango[2]), info.size - 1) : info.size - 1) : info.size - 1
      if (desde < 0 || desde >= info.size || hasta < desde) {
        return reply.status(416).header('Content-Range', 'bytes */' + info.size).send()
      }
      reply.header('Accept-Ranges', 'bytes').header('Content-Type', mime)
        .header('Cache-Control', 'private, max-age=300').header('X-Content-Type-Options', 'nosniff')
        .header('Content-Disposition', 'inline; filename="' + archivo.nombre.replace(/["\\]/g, '') + (q.preview === '1' ? '.pdf' : '') + '"')
        .header('Content-Length', hasta - desde + 1)
      // Los PDF y README viven en la API, que tiene otro origen que Svelte.
      // Helmet usa SAMEORIGIN por defecto y bloquearía la vista previa.
      const orígenes = [
        'http://localhost:5173', 'http://localhost:5174',
        'http://localhost:5273', 'http://localhost:5274',
        ...(process.env.FRONTEND_URL || '').split(',')
      ].map((value) => value.trim()).filter((value) => {
        try { const url = new URL(value); return url.origin === value && (url.protocol === 'https:' || url.hostname === 'localhost') }
        catch { return false }
      })
      reply.removeHeader('X-Frame-Options')
      reply.header('Content-Security-Policy', `frame-ancestors 'self' ${[...new Set(orígenes)].join(' ')}`)
      if (rango) reply.status(206).header('Content-Range', `bytes ${desde}-${hasta}/${info.size}`)
      return reply.send(createReadStream(ruta, { start: desde, end: hasta }))
    } catch (error) {
      if (error instanceof cap.CapError) return reply.status(error.status).send({ success: false, message: error.message })
      r.log.error({ err: error }, '[capacitaciones] archivo')
      return reply.status(404).send({ success: false, message: 'Archivo no disponible.' })
    }
  })
  app.get('/capacitaciones/certificados/verificar/:codigo', async (r, reply) => {
    try { return reply.send(ok(await cap.verificarCertificado((r.params as { codigo: string }).codigo))) }
    catch (error) {
      if (error instanceof cap.CapError) return reply.status(error.status).send({ success: false, message: error.message })
      r.log.error({ err: error }, '[capacitaciones] verificación')
      return reply.status(500).send({ success: false, message: 'No se pudo verificar el certificado.' })
    }
  })
}
