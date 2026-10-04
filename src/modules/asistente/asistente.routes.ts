import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { authMiddleware } from '../../middlewares/auth.middleware'
import { logger } from '../../utils/logger'
import { asistenteConfigurado } from './azure-openai'
import { cargarUsuarioAsistente } from './asistente.types'
import { conversar, type ContextoChat, type EventoAsistente, type MensajeChat } from './asistente.service'

const chatSchema = z.object({
  mensajes: z
    .array(
      z.object({
        rol: z.enum(['usuario', 'asistente']),
        contenido: z.string().max(8000),
      }),
    )
    .min(1)
    .max(40),
  contexto: z
    .object({
      ruta: z.string().max(300).optional(),
      titulo: z.string().max(120).optional(),
      filtros: z.record(z.unknown()).optional(),
    })
    .optional(),
})

/**
 * Asistente de IA de la app.
 *
 * `POST /api/asistente/chat` responde como Server-Sent Events sobre el mismo
 * POST: el navegador lee el cuerpo como stream (fetch + reader), así que no
 * hace falta EventSource ni un GET con el historial en la URL. Se usa
 * `reply.hijack()` para escribir directamente en la respuesta cruda de Node.
 */
export async function asistenteRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware)

  /** Para que el frontend sepa si hay asistente antes de pintar el botón. */
  app.get('/asistente/estado', async () => ({ disponible: asistenteConfigurado() }))

  app.post('/asistente/chat', async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = chatSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Cuerpo inválido', detalles: parsed.error.flatten() })
    }
    const userId = (request as any).user?.id as string | undefined
    const usuario = userId ? await cargarUsuarioAsistente(userId) : null
    if (!usuario) return reply.status(401).send({ error: 'Usuario no válido' })

    // Con `hijack()` Fastify ya no escribe las cabeceras que acumuló en `reply`,
    // y entre ellas van las de CORS que puso el plugin: sin copiarlas aquí el
    // navegador recibe el stream sin `Access-Control-Allow-Origin` y fetch
    // falla como «no se pudo conectar». curl no lo nota; el navegador sí.
    reply.hijack()
    const res = reply.raw
    res.writeHead(200, {
      ...(reply.getHeaders() as Record<string, string>),
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    res.flushHeaders?.()

    const abort = new AbortController()
    request.raw.on('close', () => abort.abort())
    const emitir = (e: EventoAsistente) => {
      if (!res.writableEnded) res.write(`data: ${JSON.stringify(e)}\n\n`)
    }

    try {
      if (!asistenteConfigurado()) {
        emitir({ t: 'error', mensaje: 'El asistente no está configurado en este servidor.' })
        return
      }
      // zod infiere opcionales con este tsconfig; el esquema ya garantiza los campos.
      await conversar(
        usuario,
        parsed.data.mensajes as MensajeChat[],
        parsed.data.contexto as ContextoChat | undefined,
        emitir,
        abort.signal,
      )
    } catch (e) {
      if (!abort.signal.aborted) {
        logger.error({ error: (e as Error).message }, 'Asistente: la conversación falló')
        emitir({ t: 'error', mensaje: 'El asistente no pudo responder en este momento. Intenta de nuevo.' })
      }
    } finally {
      res.end()
    }
  })
}
