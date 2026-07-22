import { FastifyInstance } from 'fastify'
import { prisma } from '../../config/prisma'
import { authMiddleware } from '../../middlewares/auth.middleware'
import * as service from './certificacion-envio.service'

export async function certificacionEnvioRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authMiddleware)

  app.post('/certificados-tributarios/enviar-email', async (request, reply) => {
    try {
      const body = request.body as any
      const result = await service.enviarCertificacionEmail({
        tercero_id: body.tercero_id,
        certificado_ids: body.certificado_ids || [],
        email_destino: body.email_destino,
        mensaje_personalizado: body.mensaje_personalizado,
        tipo_envio: body.tipo_envio || 'individual'
      })
      return reply.send(result)
    } catch (err: any) {
      console.error('Error enviar email certificación:', err)
      return reply.status(400).send({ error: 'Error al enviar email', details: err?.message })
    }
  })

  app.post('/certificados-tributarios/enviar-masivo', async (request, reply) => {
    try {
      const body = request.body as any
      const { tercero_ids, mensaje_personalizado } = body

      if (!Array.isArray(tercero_ids) || tercero_ids.length === 0) {
        return reply.status(400).send({ error: 'tercero_ids es requerido y debe ser un array' })
      }

      const resultados = []
      for (const terceroId of tercero_ids) {
        try {
          const archivos = await prisma.certificado_archivo.findMany({
            where: { tercero_id: terceroId }
          })
          const tercero = await prisma.terceros.findUnique({ where: { id: terceroId } })

          if (!tercero?.correo) {
            resultados.push({ tercero_id: terceroId, status: 'skipped', reason: 'Sin correo' })
            continue
          }

          if (archivos.length === 0) {
            resultados.push({ tercero_id: terceroId, status: 'skipped', reason: 'Sin certificados' })
            continue
          }

          const ids = archivos.map(a => a.id)
          const result = await service.enviarCertificacionEmail({
            tercero_id: terceroId,
            certificado_ids: ids,
            email_destino: tercero.correo,
            mensaje_personalizado,
            tipo_envio: 'masivo'
          })

          resultados.push({ tercero_id: terceroId, status: 'sent', token: result.token })
        } catch (err: any) {
          resultados.push({ tercero_id: terceroId, status: 'error', error: err?.message })
        }
      }

      return reply.send({ success: true, resultados })
    } catch (err: any) {
      console.error('Error envío masivo:', err)
      return reply.status(400).send({ error: 'Error en envío masivo', details: err?.message })
    }
  })

  app.get('/certificados-tributarios/envios', async (request, reply) => {
    try {
      const query = request.query as any
      const result = await service.getAllEnvios({
        page: parseInt(query.page || '1'),
        limit: parseInt(query.limit || '20')
      })
      return reply.send({ success: true, ...result })
    } catch (err: any) {
      console.error('Error listar envíos:', err)
      return reply.status(500).send({ error: 'Error al listar envíos', details: err?.message })
    }
  })

  app.get('/certificados-tributarios/envios/tercero/:terceroId', async (request, reply) => {
    try {
      const { terceroId } = request.params as any
      const envios = await service.getEnviosByTercero(terceroId)
      return reply.send({ success: true, envios })
    } catch (err: any) {
      console.error('Error listar envíos de tercero:', err)
      return reply.status(500).send({ error: 'Error al listar envíos', details: err?.message })
    }
  })
}
