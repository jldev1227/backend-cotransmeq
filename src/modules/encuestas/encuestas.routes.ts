import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { ZodError, z } from 'zod'
import { authMiddleware } from '../../middlewares/auth.middleware'
import { requirePermission } from '../../middlewares/permissions.middleware'
import { crearLimitador, ipCliente, MINUTO, responderLimite } from '../../utils/limitador'
import { encuestaSchema, respuestaSchema } from './encuestas.schema'
import { EncuestaError, EncuestasService } from './encuestas.service'
import { exportarExcel, exportarPdf } from './encuestas.export'

const uuid = z.string().uuid()
const limiteEnvios = crearLimitador({ max: 120, ventanaMs: 15 * MINUTO })

function error(reply: FastifyReply, err: unknown) {
  if (err instanceof ZodError) {
    return reply.status(422).send({ success: false, code: 'DATOS_INVALIDOS', message: err.errors.map(e => e.message).join('. ') })
  }
  if (err instanceof EncuestaError) {
    return reply.status(err.status).send({ success: false, code: err.code, message: err.message })
  }
  return reply.status(500).send({ success: false, code: 'ERROR_INTERNO', message: 'No fue posible completar la operación' })
}

function idDe(request: FastifyRequest): string {
  return uuid.parse((request.params as { id: string }).id)
}

export async function encuestasPublicRoutes(app: FastifyInstance) {
  app.get('/public/encuestas/:token', async (request, reply) => {
    try {
      return reply.send({ success: true, encuesta: await EncuestasService.publica((request.params as { token: string }).token) })
    } catch (err) { return error(reply, err) }
  })

  app.post('/public/encuestas/:token/respuestas', async (request, reply) => {
    const token = (request.params as { token: string }).token
    const ip = ipCliente(request)
    const espera = limiteEnvios.consumir(`${token}:${ip}`)
    if (espera) return responderLimite(reply, espera)
    try {
      const entrada = respuestaSchema.parse(request.body ?? {})
      const resultado = await EncuestasService.responder(token, entrada, ip)
      return reply.status(201).send({ success: true, ...resultado })
    } catch (err) { return error(reply, err) }
  })
}

export async function encuestasRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authMiddleware)
  const leer = { preHandler: requirePermission('encuestas', 'read') }
  const editar = { preHandler: requirePermission('encuestas', 'full') }

  app.get('/encuestas', leer, async (_request, reply) => {
    try { return reply.send({ success: true, encuestas: await EncuestasService.listar() }) }
    catch (err) { return error(reply, err) }
  })
  app.post('/encuestas', editar, async (request, reply) => {
    try {
      const entrada = encuestaSchema.parse(request.body ?? {})
      const encuesta = await EncuestasService.crear(entrada, (request as any).user?.id ?? null)
      return reply.status(201).send({ success: true, encuesta })
    } catch (err) { return error(reply, err) }
  })
  app.get('/encuestas/:id', leer, async (request, reply) => {
    try { return reply.send({ success: true, encuesta: await EncuestasService.obtener(idDe(request)) }) }
    catch (err) { return error(reply, err) }
  })
  app.put('/encuestas/:id', editar, async (request, reply) => {
    try {
      const entrada = encuestaSchema.parse(request.body ?? {})
      return reply.send({ success: true, encuesta: await EncuestasService.actualizar(idDe(request), entrada) })
    } catch (err) { return error(reply, err) }
  })
  app.post('/encuestas/:id/publicar', editar, async (request, reply) => {
    try { return reply.send({ success: true, encuesta: await EncuestasService.publicar(idDe(request)) }) }
    catch (err) { return error(reply, err) }
  })
  app.post('/encuestas/:id/cerrar', editar, async (request, reply) => {
    try { return reply.send({ success: true, encuesta: await EncuestasService.cerrar(idDe(request)) }) }
    catch (err) { return error(reply, err) }
  })
  app.post('/encuestas/:id/duplicar', editar, async (request, reply) => {
    try {
      const encuesta = await EncuestasService.duplicar(idDe(request), (request as any).user?.id ?? null)
      return reply.status(201).send({ success: true, encuesta })
    } catch (err) { return error(reply, err) }
  })
  app.delete('/encuestas/:id', editar, async (request, reply) => {
    try { return reply.send({ success: true, encuesta: await EncuestasService.archivar(idDe(request)) }) }
    catch (err) { return error(reply, err) }
  })
  app.get('/encuestas/:id/resultados', leer, async (request, reply) => {
    try {
      const pagina = Math.min(100_000, Math.max(1, Number((request.query as any)?.pagina) || 1))
      return reply.send({ success: true, ...(await EncuestasService.resultados(idDe(request), pagina)) })
    } catch (err) { return error(reply, err) }
  })
  app.get('/encuestas/:id/exportar.xlsx', leer, async (request, reply) => {
    try {
      const id = idDe(request)
      const buffer = await exportarExcel(id)
      return reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header('Content-Disposition', `attachment; filename="encuesta-${id}.xlsx"`).send(buffer)
    } catch (err) { return error(reply, err) }
  })
  app.get('/encuestas/:id/exportar.pdf', leer, async (request, reply) => {
    try {
      const id = idDe(request)
      const buffer = await exportarPdf(id)
      return reply.header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `attachment; filename="encuesta-${id}.pdf"`).send(buffer)
    } catch (err) { return error(reply, err) }
  })
}
