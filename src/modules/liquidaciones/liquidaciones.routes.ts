import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { LiquidacionesController } from './liquidaciones.controller'
import { authMiddleware } from '../../middlewares/auth.middleware'
import { prisma } from '../../config/prisma'
import { env } from '../../config/env'
import { EmailService } from '../../services/email.service'
import jwt from 'jsonwebtoken'

const TOKEN_VALIDITY_DAYS = 30

export async function liquidacionesRoutes(fastify: FastifyInstance) {
  // Aplicar middleware de autenticación
  fastify.addHook('onRequest', authMiddleware)

  // Obtener configuraciones (debe ir antes de /:id)
  fastify.get('/configuraciones-liquidacion', LiquidacionesController.obtenerConfiguraciones)

  // Obtener años disponibles en configuraciones
  fastify.get('/configuraciones-liquidacion/anios', LiquidacionesController.obtenerAniosConfiguraciones)

  // Crear nueva configuración
  fastify.post('/configuraciones-liquidacion', LiquidacionesController.crearConfiguracion)

  // Duplicar configuraciones de un año a otro
  fastify.post('/configuraciones-liquidacion/duplicar', LiquidacionesController.duplicarConfiguraciones)

  // Actualizar configuración
  fastify.put('/configuraciones-liquidacion/:id', LiquidacionesController.actualizarConfiguracion)

  // Eliminar configuración
  fastify.delete('/configuraciones-liquidacion/:id', LiquidacionesController.eliminarConfiguracion)

  // Preview de recargos para un conductor (debe ir antes de /:id)
  fastify.get('/liquidaciones/preview-recargos', LiquidacionesController.previewRecargos)

  // Obtener todas las liquidaciones
  fastify.get('/liquidaciones', LiquidacionesController.obtenerTodas)

  // Obtener una liquidación por ID
  fastify.get('/liquidaciones/:id', LiquidacionesController.obtenerPorId)

  // Obtener analisis
  fastify.get('/liquidaciones/analisis', LiquidacionesController.obtenerAnalisis)

  // Crear liquidación
  fastify.post('/liquidaciones', LiquidacionesController.crear)

  // Actualizar liquidación
  fastify.put('/liquidaciones/:id', LiquidacionesController.actualizar)

  // Eliminar liquidación
  fastify.delete('/liquidaciones/:id', LiquidacionesController.eliminar)

  // ═══════════════════════════════════════════════════════
  // POST /api/liquidaciones/enviar-desprendibles
  // Envía notificación por email a los conductores con link al portal
  // ═══════════════════════════════════════════════════════
  fastify.post('/liquidaciones/enviar-desprendibles', {
    schema: {
      description: 'Enviar notificación de desprendibles por email a los conductores',
      tags: ['liquidaciones'],
      body: {
        type: 'object',
        required: ['liquidacionIds'],
        properties: {
          liquidacionIds: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 100 }
        }
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { liquidacionIds } = request.body as { liquidacionIds: string[] }

      const liquidaciones = await prisma.liquidaciones.findMany({
        where: { id: { in: liquidacionIds } },
        select: {
          id: true,
          periodo_start: true,
          periodo_end: true,
          sueldo_total: true,
          estado: true,
          conductor_id: true,
          conductores: {
            select: {
              id: true,
              nombre: true,
              apellido: true,
              email: true,
              numero_identificacion: true
            }
          }
        }
      })

      if (liquidaciones.length === 0) {
        return reply.status(404).send({ success: false, message: 'No se encontraron liquidaciones' })
      }

      const frontendUrl = env.FRONTEND_URL || 'http://localhost:5173'
      const resultados: any[] = []
      let enviados = 0
      let errores = 0

      for (const liq of liquidaciones) {
        const conductor = liq.conductores
        if (!conductor) {
          resultados.push({ liquidacionId: liq.id, status: 'error', message: 'Sin conductor asociado' })
          errores++
          continue
        }

        if (!conductor.email) {
          resultados.push({
            liquidacionId: liq.id,
            conductor: conductor.nombre,
            status: 'error',
            message: 'Conductor sin email registrado'
          })
          errores++
          continue
        }

        try {
          // Generar o reutilizar token JWT para el conductor
          const existingToken = await prisma.conductor_token.findFirst({
            where: {
              conductor_id: conductor.id,
              expires_at: { gt: new Date() }
            },
            orderBy: { expires_at: 'desc' }
          })

          let portalToken: string

          if (existingToken) {
            portalToken = existingToken.token
          } else {
            const expiresAt = new Date()
            expiresAt.setDate(expiresAt.getDate() + TOKEN_VALIDITY_DAYS)

            portalToken = jwt.sign(
              {
                sub: conductor.id,
                cedula: conductor.numero_identificacion,
                nombre: `${conductor.nombre} ${conductor.apellido || ''}`.trim(),
                tipo: 'conductor_portal'
              },
              env.JWT_SECRET,
              { expiresIn: `${TOKEN_VALIDITY_DAYS}d` }
            )

            await prisma.conductor_token.create({
              data: {
                id: require('crypto').randomUUID(),
                conductor_id: conductor.id,
                token: portalToken,
                expires_at: expiresAt
              }
            })
          }

          // Construir link con token y desprendible_id
          const portalLink = `${frontendUrl}/public/portal?token=${encodeURIComponent(portalToken)}&desprendible=${liq.id}`

          // Formatear datos para el email — extraer mes de periodo_end
          const periodoEndDate = new Date(liq.periodo_end + (liq.periodo_end.length === 10 ? 'T00:00:00' : ''))
          const mesNombre = periodoEndDate.toLocaleDateString('es-CO', { month: 'long' })
          const periodo = `mes de ${mesNombre}`
          const monto = new Intl.NumberFormat('es-CO', {
            style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 0
          }).format(Number(liq.sueldo_total) || 0)
          const nombreCompleto = `${conductor.nombre} ${conductor.apellido || ''}`.trim()

          // Enviar email
          await EmailService.sendDesprendibleNotification({
            to: conductor.email,
            conductorNombre: nombreCompleto,
            periodo,
            monto,
            portalLink
          })

          resultados.push({
            liquidacionId: liq.id,
            conductor: nombreCompleto,
            email: conductor.email,
            status: 'enviado'
          })
          enviados++
        } catch (err: any) {
          request.log.error({ error: err, liquidacionId: liq.id }, 'Error enviando email desprendible')
          resultados.push({
            liquidacionId: liq.id,
            conductor: `${conductor.nombre} ${conductor.apellido || ''}`.trim(),
            email: conductor.email,
            status: 'error',
            message: err.message || 'Error al enviar email'
          })
          errores++
        }
      }

      return reply.send({
        success: true,
        message: `${enviados} email(s) enviado(s), ${errores} error(es)`,
        data: {
          enviados,
          errores,
          total: liquidaciones.length,
          resultados
        }
      })
    } catch (err: any) {
      request.log.error({ error: err }, 'Error en enviar-desprendibles')
      return reply.status(500).send({
        success: false,
        message: err.message || 'Error al enviar desprendibles'
      })
    }
  })

  // ═══════════════════════════════════════════════════════
  // POST /api/liquidaciones/preview-desprendibles
  // Retorna preview de los conductores/emails para confirmar envío
  // ═══════════════════════════════════════════════════════
  fastify.post('/liquidaciones/preview-desprendibles', {
    schema: {
      description: 'Preview de desprendibles a enviar por email',
      tags: ['liquidaciones'],
      body: {
        type: 'object',
        required: ['liquidacionIds'],
        properties: {
          liquidacionIds: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 100 }
        }
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { liquidacionIds } = request.body as { liquidacionIds: string[] }

      const liquidaciones = await prisma.liquidaciones.findMany({
        where: { id: { in: liquidacionIds } },
        select: {
          id: true,
          periodo_start: true,
          periodo_end: true,
          sueldo_total: true,
          estado: true,
          conductores: {
            select: {
              id: true,
              nombre: true,
              apellido: true,
              email: true
            }
          }
        },
        orderBy: { periodo_end: 'desc' }
      })

      const preview = liquidaciones.map(liq => {
        const c = liq.conductores
        return {
          liquidacionId: liq.id,
          conductor: c ? `${c.nombre} ${c.apellido || ''}`.trim() : 'Sin conductor',
          email: c?.email || null,
          periodo_inicio: liq.periodo_start,
          periodo_fin: liq.periodo_end,
          sueldo_total: liq.sueldo_total,
          estado: liq.estado,
          canSend: !!c?.email
        }
      })

      return reply.send({
        success: true,
        data: {
          total: preview.length,
          canSend: preview.filter(p => p.canSend).length,
          cannotSend: preview.filter(p => !p.canSend).length,
          items: preview
        }
      })
    } catch (err: any) {
      request.log.error({ error: err }, 'Error en preview-desprendibles')
      return reply.status(500).send({
        success: false,
        message: err.message || 'Error al obtener preview'
      })
    }
  })

  // PATCH /api/liquidaciones/desprendible-visible - Toggle visibilidad de desprendibles
  fastify.patch('/liquidaciones/desprendible-visible', async (request: FastifyRequest<{
    Body: { liquidacionIds: string[], visible: boolean }
  }>, reply: FastifyReply) => {
    try {
      const { liquidacionIds, visible } = request.body as { liquidacionIds: string[], visible: boolean }

      if (!liquidacionIds || !Array.isArray(liquidacionIds) || liquidacionIds.length === 0) {
        return reply.status(400).send({ success: false, message: 'liquidacionIds es requerido' })
      }

      await prisma.liquidaciones.updateMany({
        where: { id: { in: liquidacionIds } },
        data: { desprendible_visible: visible }
      })

      return reply.send({
        success: true,
        message: `${liquidacionIds.length} liquidación(es) actualizadas`,
        data: { count: liquidacionIds.length, visible }
      })
    } catch (error: any) {
      request.log.error({ error }, 'Error al cambiar visibilidad de desprendibles')
      return reply.status(500).send({ success: false, message: error.message })
    }
  })

  // Generar token para compartir desprendible (requiere auth)
  fastify.post('/liquidaciones/:id/compartir', async (request: FastifyRequest<{
    Params: { id: string }
    Body: { expires_hours?: number }
  }>, reply: FastifyReply) => {
    try {
      const { id } = request.params
      const { expires_hours = 72 } = (request.body as any) || {}

      const liquidacion = await prisma.liquidaciones.findUnique({
        where: { id },
        select: { id: true, share_token: true, share_token_expires_at: true, conductor_id: true }
      })

      if (!liquidacion) {
        return reply.status(404).send({ success: false, message: 'Liquidación no encontrada' })
      }

      // Si ya tiene un token vigente, devolverlo
      if (liquidacion.share_token && liquidacion.share_token_expires_at) {
        if (new Date(liquidacion.share_token_expires_at) > new Date()) {
          return reply.send({
            success: true,
            data: {
              share_token: liquidacion.share_token,
              expires_at: liquidacion.share_token_expires_at,
              liquidacion_id: id
            }
          })
        }
      }

      // Generar nuevo token
      const crypto = await import('crypto')
      const token = crypto.randomBytes(32).toString('hex')
      const expiresAt = new Date()
      expiresAt.setHours(expiresAt.getHours() + expires_hours)

      await prisma.liquidaciones.update({
        where: { id },
        data: {
          share_token: token,
          share_token_expires_at: expiresAt
        }
      })

      return reply.send({
        success: true,
        data: {
          share_token: token,
          expires_at: expiresAt,
          liquidacion_id: id
        }
      })
    } catch (error: any) {
      request.log.error({ error }, 'Error al generar token de compartir')
      return reply.status(500).send({ success: false, message: error.message })
    }
  })
}