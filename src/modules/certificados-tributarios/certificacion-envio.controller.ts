import { FastifyInstance } from 'fastify'
import { prisma } from '../../config/prisma'
import { authMiddleware } from '../../middlewares/auth.middleware'
import * as service from './certificacion-envio.service'
import { whereTercerosConCertificados } from './certificado-archivo.service'

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
      const { mensaje_personalizado, filtros } = body
      let tercero_ids: string[] = body.tercero_ids

      /// Con `filtros` el servidor resuelve a quién enviar: son los mismos
      /// terceros que el listado muestra con esos filtros, todas las páginas.
      /// Antes la pantalla mandaba los ids de la página visible y «enviar a
      /// todos» solo le llegaba a diez.
      if (filtros && typeof filtros === 'object') {
        const where = whereTercerosConCertificados({
          search: filtros.search || undefined,
          anio: parseInt(filtros.anio) || undefined,
          tipo: filtros.tipo || undefined,
          correo: 'con'
        })
        const filas = await prisma.terceros.findMany({ where, select: { id: true } })
        tercero_ids = filas.map((t) => t.id)
        if (tercero_ids.length === 0) {
          return reply.status(400).send({ error: 'Ningún tercero con correo coincide con los filtros' })
        }
      }

      if (!Array.isArray(tercero_ids) || tercero_ids.length === 0) {
        return reply.status(400).send({ error: 'tercero_ids o filtros es requerido' })
      }

      const resultados = []
      for (const terceroId of tercero_ids) {
        try {
          /// Con filtro de año o tipo se mandan solo esos certificados.
          const archivos = await prisma.certificado_archivo.findMany({
            where: {
              deleted_at: null,
              tercero_id: terceroId,
              ...(parseInt(filtros?.anio) ? { anio: parseInt(filtros.anio) } : {}),
              ...(filtros?.tipo ? { tipo: filtros.tipo } : {})
            }
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
