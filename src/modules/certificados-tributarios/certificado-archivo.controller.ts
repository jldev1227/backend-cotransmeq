import { FastifyInstance } from 'fastify'
import { prisma } from '../../config/prisma'
import { authMiddleware } from '../../middlewares/auth.middleware'
import * as service from './certificado-archivo.service'

export async function certificadoArchivoRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authMiddleware)

  app.get('/certificados-tributarios/archivos', async (request, reply) => {
    try {
      const query = request.query as any
      const result = await service.getAllCertificados({
        search: query.search,
        page: parseInt(query.page || '1'),
        limit: parseInt(query.limit || '20')
      })
      return reply.send({ success: true, ...result })
    } catch (err: any) {
      console.error('Error listar archivos:', err)
      return reply.status(500).send({ error: 'Error al listar archivos', details: err?.message })
    }
  })

  app.get('/certificados-tributarios/por-nit/:nit', async (request, reply) => {
    try {
      const { nit } = request.params as any
      const archivos = await service.getCertificadosByNit(nit)
      return reply.send({ success: true, nit, archivos, total: archivos.length })
    } catch (err: any) {
      console.error('Error listar por NIT:', err)
      return reply.status(500).send({ error: 'Error al listar por NIT', details: err?.message })
    }
  })

  app.get('/certificados-tributarios/tercero/:terceroId', async (request, reply) => {
    try {
      const { terceroId } = request.params as any
      const archivos = await prisma.certificado_archivo.findMany({
        where: { tercero_id: terceroId },
        include: {
          tipo_certificado: true
        },
        orderBy: { created_at: 'desc' }
      })

      const { getPresignedUrl } = await import('./certificado-archivo.service')
      const withUrls = await Promise.all(
        archivos.map(async (a) => {
          try {
            const url = await getPresignedUrl(a.s3_key)
            return { ...a, url }
          } catch {
            return { ...a, url: null }
          }
        })
      )

      return reply.send({ success: true, certificados: withUrls })
    } catch (err: any) {
      console.error('Error listar certificados de tercero:', err)
      return reply.status(500).send({ error: 'Error al listar certificados', details: err?.message })
    }
  })

  app.get('/certificados-tributarios/terceros-con-certificados', async (request, reply) => {
    try {
      const query = request.query as any
      const result = await service.getTercerosWithCertificados({
        search: query.search,
        page: parseInt(query.page || '1'),
        limit: parseInt(query.limit || '10')
      })
      return reply.send({ success: true, ...result })
    } catch (err: any) {
      console.error('Error listar terceros con certificados:', err)
      return reply.status(500).send({ error: 'Error al listar', details: err?.message })
    }
  })

  app.post('/certificados-tributarios/sync-s3', async (_request, reply) => {
    try {
      const result = await service.syncS3ToDB()
      return reply.send({ success: true, ...result })
    } catch (err: any) {
      console.error('Error sync S3:', err)
      return reply.status(500).send({ error: 'Error al sincronizar S3', details: err?.message })
    }
  })

  app.post('/certificados-tributarios/link', async (request, reply) => {
    try {
      const body = request.body as any
      const vinculo = await service.linkCertificadoToTercero(body.certificado_id, body.tercero_id)
      return reply.status(201).send({ success: true, vinculo })
    } catch (err: any) {
      console.error('Error link certificado:', err)
      return reply.status(400).send({ error: 'Error al vincular', details: err?.message })
    }
  })

  app.delete('/certificados-tributarios/archivo/:id', async (request, reply) => {
    try {
      const { id } = request.params as any
      const result = await service.deleteCertificado(id)
      return reply.send(result)
    } catch (err: any) {
      console.error('Error delete certificado:', err)
      return reply.status(400).send({ error: 'Error al eliminar', details: err?.message })
    }
  })
}
