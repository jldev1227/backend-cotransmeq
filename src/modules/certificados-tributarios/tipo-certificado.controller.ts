import { FastifyInstance } from 'fastify'
import { authMiddleware } from '../../middlewares/auth.middleware'
import * as service from './tipo-certificado.service'

export async function tipoCertificadoRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authMiddleware)

  app.get('/tipos-certificado', async (_request, reply) => {
    try {
      const tipos = await service.listTiposCertificado()
      return reply.send({ success: true, tipos })
    } catch (err: any) {
      console.error('Error listar tipos certificado:', err)
      return reply.status(500).send({ error: 'Error al listar tipos', details: err?.message })
    }
  })

  app.post('/tipos-certificado', async (request, reply) => {
    try {
      const body = request.body as any
      const tipo = await service.createTipoCertificado({
        nombre: body.nombre,
        descripcion: body.descripcion,
        codigo: body.codigo
      })
      return reply.status(201).send({ success: true, tipo })
    } catch (err: any) {
      console.error('Error crear tipo certificado:', err)
      return reply.status(400).send({ error: 'Error al crear tipo', details: err?.message })
    }
  })

  app.put('/tipos-certificado/:id', async (request, reply) => {
    try {
      const { id } = request.params as any
      const body = request.body as any
      const tipo = await service.updateTipoCertificado(id, {
        nombre: body.nombre,
        descripcion: body.descripcion,
        codigo: body.codigo,
        activo: body.activo
      })
      return reply.send({ success: true, tipo })
    } catch (err: any) {
      console.error('Error actualizar tipo certificado:', err)
      return reply.status(400).send({ error: 'Error al actualizar tipo', details: err?.message })
    }
  })

  app.delete('/tipos-certificado/:id', async (request, reply) => {
    try {
      const { id } = request.params as any
      await service.deleteTipoCertificado(id)
      return reply.send({ success: true })
    } catch (err: any) {
      console.error('Error eliminar tipo certificado:', err)
      return reply.status(400).send({ error: 'Error al eliminar tipo', details: err?.message })
    }
  })
}
