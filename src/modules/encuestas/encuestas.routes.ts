import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { ZodError, z } from 'zod'
import { authMiddleware } from '../../middlewares/auth.middleware'
import { requirePermission } from '../../middlewares/permissions.middleware'
import { crearLimitador, ipCliente, MINUTO, responderLimite } from '../../utils/limitador'
import { logger } from '../../utils/logger'
import { encuestaSchema, respuestaSchema } from './encuestas.schema'
import { EncuestaError, EncuestasService } from './encuestas.service'
import { exportarExcel, exportarPdf } from './encuestas.export'
import { generarBorradorEncuesta } from './encuestas.ai'
import { asistenteConfigurado } from '../asistente/azure-openai'
import { escucharActualizacionEncuesta, EVENTOS_ENCUESTAS } from './encuestas.events'

const uuid = z.string().uuid()
const limiteEnvios = crearLimitador({ max: 120, ventanaMs: 15 * MINUTO })
const limiteGeneracion = crearLimitador({ max: 12, ventanaMs: 15 * MINUTO })
const instruccionesIA = z.object({ instrucciones: z.string().trim().min(5).max(12_000) })

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

  app.get('/public/encuestas/:token/eventos', async (request, reply) => {
    try {
      const token = (request.params as { token: string }).token
      const encuesta = await EncuestasService.publica(token)
      const raw = reply.raw
      reply.hijack()
      raw.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
        'Access-Control-Allow-Origin': '*'
      })
      const enviar = (evento: { actualizada_at: string; estado: string }) => {
        raw.write(`event: ${EVENTOS_ENCUESTAS.actualizada}\ndata: ${JSON.stringify(evento)}\n\n`)
      }
      const baja = escucharActualizacionEncuesta(encuesta.id, enviar)
      const latido = setInterval(() => raw.write(': keep-alive\n\n'), 20_000)
      const cerrar = () => {
        clearInterval(latido)
        baja()
      }
      raw.once('close', cerrar)
      enviar({ actualizada_at: encuesta.actualizada_at, estado: encuesta.estado })
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
  app.post('/encuestas/generar', editar, async (request, reply) => {
    const entrada = instruccionesIA.safeParse(request.body ?? {})
    if (!entrada.success) {
      return reply.status(422).send({ success: false, code: 'DATOS_INVALIDOS', message: 'Describe la encuesta en al menos 5 caracteres y máximo 12.000.' })
    }
    const usuarioId = String((request as any).user?.id ?? '')
    if (!usuarioId) return reply.status(401).send({ success: false, code: 'USUARIO_NO_VALIDO', message: 'Inicia sesión para usar el asistente.' })
    const espera = limiteGeneracion.consumir(usuarioId)
    if (espera) return responderLimite(reply, espera)
    if (!asistenteConfigurado()) {
      return reply.status(503).send({ success: false, code: 'ASISTENTE_NO_CONFIGURADO', message: 'El asistente no está disponible en este momento.' })
    }
    try {
      const encuesta = await generarBorradorEncuesta(entrada.data.instrucciones)
      return reply.send({ success: true, encuesta })
    } catch (err) {
      logger.error({ error: err instanceof Error ? err.message : 'Error desconocido' }, 'Encuestas: no fue posible generar el borrador con IA')
      return reply.status(502).send({ success: false, code: 'ERROR_GENERACION', message: 'El asistente no pudo preparar la encuesta. Ajusta las instrucciones y vuelve a intentarlo.' })
    }
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
  app.post('/encuestas/:id/abrir', editar, async (request, reply) => {
    try { return reply.send({ success: true, encuesta: await EncuestasService.abrir(idDe(request)) }) }
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
