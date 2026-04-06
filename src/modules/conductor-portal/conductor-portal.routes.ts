// @ts-nocheck
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import jwt from 'jsonwebtoken'
import { prisma } from '../../config/prisma'
import { env } from '../../config/env'
import { EmailService } from '../../services/email.service'
import { LiquidacionesService } from '../liquidaciones/liquidaciones.service'
import { getS3SignedUrl, uploadToS3 } from '../../config/aws'

const TOKEN_VALIDITY_DAYS = 30

/**
 * Middleware de autenticación para el portal del conductor.
 * Verifica el JWT emitido por el magic link.
 */
async function portalAuthMiddleware(request: FastifyRequest, reply: FastifyReply) {
  const auth = request.headers['authorization']
  if (!auth) return reply.status(401).send({ success: false, message: 'Token no proporcionado' })

  const parts = auth.split(' ')
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return reply.status(401).send({ success: false, message: 'Formato de token inválido' })
  }

  try {
    const payload = jwt.verify(parts[1], env.JWT_SECRET) as any
    if (payload.tipo !== 'conductor_portal') {
      return reply.status(401).send({ success: false, message: 'Token no autorizado para este recurso' })
    }

    ;(request as any).conductorPortal = {
      id: payload.sub,
      cedula: payload.cedula,
      nombre: payload.nombre
    }
  } catch (err) {
    return reply.status(401).send({ success: false, message: 'Token inválido o expirado' })
  }
}

export async function conductorPortalRoutes(app: FastifyInstance) {

  // ═══════════════════════════════════════════
  // RUTAS PÚBLICAS (sin autenticación)
  // ═══════════════════════════════════════════

  // Solicitar acceso: envía magic link por email
  app.post('/conductor-portal/solicitar-acceso', {
    schema: {
      description: 'Solicitar acceso al portal del conductor (envía email con magic link)',
      tags: ['conductor-portal'],
      body: {
        type: 'object',
        required: ['numero_identificacion'],
        properties: {
          numero_identificacion: { type: 'string', minLength: 5, maxLength: 12 }
        }
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { numero_identificacion } = request.body as { numero_identificacion: string }

      const conductor = await prisma.conductores.findUnique({
        where: { numero_identificacion },
        select: {
          id: true,
          nombre: true,
          apellido: true,
          email: true,
          estado: true
        }
      })

      if (!conductor) {
        return reply.status(404).send({
          success: false,
          message: 'No se encontró un conductor con ese número de identificación'
        })
      }

      if (!conductor.email) {
        return reply.status(400).send({
          success: false,
          message: 'No tienes un correo electrónico registrado. Contacta al administrador para que lo agreguen.'
        })
      }

      const expiresAt = new Date()
      expiresAt.setDate(expiresAt.getDate() + TOKEN_VALIDITY_DAYS)

      const jwtToken = jwt.sign(
        {
          sub: conductor.id,
          cedula: numero_identificacion,
          nombre: `${conductor.nombre} ${conductor.apellido}`,
          tipo: 'conductor_portal'
        },
        env.JWT_SECRET,
        { expiresIn: `${TOKEN_VALIDITY_DAYS}d` }
      )

      await prisma.conductor_token.create({
        data: {
          id: require('crypto').randomUUID(),
          conductor_id: conductor.id,
          token: jwtToken,
          expires_at: expiresAt
        }
      })

      await EmailService.sendPortalAccessLink({
        to: conductor.email,
        conductorNombre: conductor.nombre,
        conductorApellido: conductor.apellido,
        token: jwtToken
      })

      const emailParts = conductor.email.split('@')
      const hidden = emailParts[0].slice(0, 3) + '***@' + emailParts[1]

      return reply.send({
        success: true,
        message: 'Se ha enviado un enlace de acceso a tu correo electrónico',
        email: hidden
      })
    } catch (err: any) {
      const status = err.statusCode || 500
      return reply.status(status).send({
        success: false,
        message: err.message || 'Error al solicitar acceso'
      })
    }
  })

  // Verificar token (al hacer clic en el magic link)
  app.get('/conductor-portal/verificar-token', {
    schema: {
      description: 'Verificar token de acceso al portal del conductor',
      tags: ['conductor-portal'],
      querystring: {
        type: 'object',
        required: ['token'],
        properties: {
          token: { type: 'string' }
        }
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { token } = request.query as { token: string }
      if (!token) {
        return reply.status(400).send({ success: false, message: 'Token requerido' })
      }

      const payload = jwt.verify(token, env.JWT_SECRET) as any

      if (payload.tipo !== 'conductor_portal') {
        return reply.status(401).send({ success: false, message: 'Token inválido' })
      }

      const tokenRecord = await prisma.conductor_token.findUnique({
        where: { token },
        include: {
          conductor: {
            select: {
              id: true,
              nombre: true,
              apellido: true,
              numero_identificacion: true,
              email: true,
              estado: true
            }
          }
        }
      })

      if (!tokenRecord || tokenRecord.expires_at < new Date()) {
        return reply.status(401).send({ success: false, message: 'Token expirado o inválido' })
      }

      return reply.send({
        success: true,
        data: {
          token,
          conductor: tokenRecord.conductor,
          expires_at: tokenRecord.expires_at
        }
      })
    } catch (err: any) {
      if (err.statusCode) {
        return reply.status(err.statusCode).send({ success: false, message: err.message })
      }
      return reply.status(401).send({ success: false, message: 'Token inválido o expirado' })
    }
  })

  // ═══════════════════════════════════════════
  // RUTAS PROTEGIDAS (requieren token de conductor)
  // ═══════════════════════════════════════════

  app.register(async function protectedRoutes(protectedApp) {
    protectedApp.addHook('onRequest', portalAuthMiddleware)

    // ─── Listar desprendibles (liquidaciones) del conductor ───
    protectedApp.get('/conductor-portal/desprendibles', {
      schema: {
        description: 'Listar desprendibles/liquidaciones del conductor autenticado',
        tags: ['conductor-portal']
      }
    }, async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const conductor = (request as any).conductorPortal

        const liquidaciones = await prisma.liquidaciones.findMany({
          where: {
            conductor_id: conductor.id
          },
          select: {
            id: true,
            periodo_start: true,
            periodo_end: true,
            estado: true,
            sueldo_total: true,
            dias_laborados: true,
            salario_devengado: true,
            total_recargos: true,
            total_bonificaciones: true,
            total_pernotes: true,
            created_at: true,
            fecha_liquidacion: true,
            firmas_desprendibles: {
              where: { conductor_id: conductor.id },
              select: {
                id: true,
                firma_url: true,
                fecha_firma: true
              }
            }
          },
          orderBy: { periodo_end: 'desc' }
        })

        const result = liquidaciones.map((liq: any) => {
          const firma = liq.firmas_desprendibles?.[0]
          const yaFirmo = firma && firma.firma_url && firma.firma_url !== '' && firma.firma_url !== 'pending'
          
          return {
            id: liq.id,
            periodo_inicio: liq.periodo_start,
            periodo_fin: liq.periodo_end,
            estado: liq.estado,
            sueldo_total: liq.sueldo_total,
            dias_laborados: liq.dias_laborados,
            salario_devengado: liq.salario_devengado,
            total_recargos: liq.total_recargos,
            total_bonificaciones: liq.total_bonificaciones,
            total_pernotes: liq.total_pernotes,
            fecha_liquidacion: liq.fecha_liquidacion,
            created_at: liq.created_at,
            firmado: !!yaFirmo,
            fecha_firma: yaFirmo ? firma.fecha_firma : null
          }
        })

        return reply.send({
          success: true,
          data: result,
          count: result.length
        })
      } catch (err: any) {
        request.log.error({ error: err }, 'Error listando desprendibles')
        return reply.status(500).send({
          success: false,
          message: err.message || 'Error al listar desprendibles'
        })
      }
    })

    // ─── Obtener datos completos de una liquidación para generar PDF ───
    protectedApp.get('/conductor-portal/desprendibles/:id', {
      schema: {
        description: 'Obtener datos completos de una liquidación para generar PDF',
        tags: ['conductor-portal'],
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string' }
          }
        }
      }
    }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const conductor = (request as any).conductorPortal
        const { id } = request.params

        const liq = await prisma.liquidaciones.findFirst({
          where: { id, conductor_id: conductor.id },
          select: { id: true }
        })

        if (!liq) {
          return reply.status(404).send({
            success: false,
            message: 'Liquidación no encontrada'
          })
        }

        const liquidacion = await LiquidacionesService.obtenerPorId(id)

        let recargosData = null
        try {
          if (liquidacion.periodo_inicio && liquidacion.periodo_fin && liquidacion.conductores?.id) {
            recargosData = await LiquidacionesService.previewRecargos(
              liquidacion.conductores.id,
              liquidacion.periodo_inicio,
              liquidacion.periodo_fin
            )
          }
        } catch (e) {
          // Si falla preview de recargos, no bloquear
        }

        let firmaPresigned = ''
        try {
          const firma = await prisma.firmas_desprendibles.findFirst({
            where: {
              liquidacion_id: id,
              conductor_id: conductor.id
            }
          })
          if (firma?.firma_s3_key && firma.firma_url !== 'pending' && firma.firma_url !== '') {
            firmaPresigned = await getS3SignedUrl(firma.firma_s3_key, 3600)
          }
        } catch {}

        return reply.send({
          success: true,
          data: {
            liquidacion,
            recargos: recargosData,
            firma: firmaPresigned ? { presignedUrl: firmaPresigned } : null
          }
        })
      } catch (err: any) {
        request.log.error({ error: err }, 'Error obteniendo datos de desprendible')
        return reply.status(500).send({
          success: false,
          message: err.message || 'Error al obtener datos'
        })
      }
    })

    // ─── Firmar un desprendible desde el portal ───
    protectedApp.post('/conductor-portal/desprendibles/:id/firmar', {
      schema: {
        description: 'Firmar un desprendible desde el portal del conductor',
        tags: ['conductor-portal'],
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string' }
          }
        },
        body: {
          type: 'object',
          required: ['firma_base64'],
          properties: {
            firma_base64: { type: 'string', minLength: 100 }
          }
        }
      }
    }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const conductor = (request as any).conductorPortal
        const { id } = request.params
        const { firma_base64 } = request.body as { firma_base64: string }

        const liq = await prisma.liquidaciones.findFirst({
          where: { id, conductor_id: conductor.id },
          select: { id: true }
        })

        if (!liq) {
          return reply.status(404).send({
            success: false,
            message: 'Liquidación no encontrada'
          })
        }

        const firmaExistente = await prisma.firmas_desprendibles.findUnique({
          where: {
            liquidacion_id_conductor_id: {
              liquidacion_id: id,
              conductor_id: conductor.id
            }
          }
        })

        if (firmaExistente && firmaExistente.firma_url && firmaExistente.firma_url !== '' && firmaExistente.firma_url !== 'pending') {
          return reply.status(409).send({
            success: false,
            message: 'Este desprendible ya fue firmado'
          })
        }

        const base64Data = firma_base64.replace(/^data:image\/\w+;base64,/, '')
        const buffer = Buffer.from(base64Data, 'base64')

        if (buffer.length < 2000) {
          return reply.status(400).send({
            success: false,
            message: 'La firma proporcionada no es válida. Debe ser una firma legible.'
          })
        }

        const firmaId = require('crypto').randomUUID()
        const s3Key = `firmas_desprendibles/${id}/${conductor.id}/${firmaId}.png`
        await uploadToS3(s3Key, buffer, 'image/png')

        const ipAddress = (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || request.ip || '0.0.0.0'
        const userAgent = request.headers['user-agent'] || ''
        const now = new Date()

        if (firmaExistente) {
          await prisma.firmas_desprendibles.update({
            where: { id: firmaExistente.id },
            data: {
              firma_url: s3Key,
              firma_s3_key: s3Key,
              ip_address: ipAddress,
              user_agent: userAgent,
              fecha_firma: now,
              updated_at: now
            }
          })
        } else {
          await prisma.firmas_desprendibles.create({
            data: {
              id: firmaId,
              liquidacion_id: id,
              conductor_id: conductor.id,
              firma_url: s3Key,
              firma_s3_key: s3Key,
              ip_address: ipAddress,
              user_agent: userAgent,
              fecha_firma: now,
              estado: 'Activa',
              created_at: now,
              updated_at: now
            }
          })
        }

        return reply.send({
          success: true,
          message: 'Firma registrada exitosamente',
          data: {
            firmado: true,
            fecha_firma: now.toISOString()
          }
        })
      } catch (err: any) {
        request.log.error({ error: err }, 'Error firmando desprendible desde portal')
        return reply.status(500).send({
          success: false,
          message: err.message || 'Error al registrar firma'
        })
      }
    })

    // ─── Registros de días laborados ───
    protectedApp.get('/conductor-portal/dias-laborados/registros', {
      schema: {
        description: 'Listar registros de días laborados del conductor',
        tags: ['conductor-portal'],
        querystring: {
          type: 'object',
          properties: {
            mes: { type: 'string', pattern: '^\\d{4}-\\d{2}$' },
            desde: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
            hasta: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }
          }
        }
      }
    }, async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const conductor = (request as any).conductorPortal
        const { mes, desde, hasta } = request.query as any

        const where: any = { conductor_id: conductor.id }
        if (mes) {
          const [year, month] = mes.split('-').map(Number)
          const start = new Date(year, month - 1, 1)
          const end = new Date(year, month, 0, 23, 59, 59)
          where.fecha = { gte: start, lte: end }
        } else if (desde && hasta) {
          where.fecha = {
            gte: new Date(desde + 'T00:00:00.000Z'),
            lte: new Date(hasta + 'T23:59:59.999Z')
          }
        }

        const registros = await prisma.registro_dia_laboral.findMany({
          where,
          orderBy: { fecha: 'asc' }
        })

        return reply.send({ success: true, data: registros, count: registros.length })
      } catch (err: any) {
        return reply.status(500).send({
          success: false,
          message: err.message || 'Error al listar registros'
        })
      }
    })

    // ─── Guardar/actualizar registro de un día ───
    protectedApp.post('/conductor-portal/dias-laborados/registros', {
      schema: {
        description: 'Crear o actualizar registro de día laboral',
        tags: ['conductor-portal'],
        body: {
          type: 'object',
          required: ['fecha', 'tipo'],
          properties: {
            fecha: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
            tipo: { type: 'string', enum: ['LABORADO', 'DISPONIBLE', 'DESCANSO', 'MANTENIMIENTO'] },
            hora_inicio: { type: 'string' },
            hora_fin: { type: 'string' },
            horas_conducidas: { type: 'number' },
            cliente_id: { type: 'string' },
            cliente_nombre: { type: 'string' },
            vehiculo_placa: { type: 'string' },
            observaciones: { type: 'string' }
          }
        }
      }
    }, async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const conductor = (request as any).conductorPortal
        const data = request.body as any
        const fecha = new Date(data.fecha + 'T00:00:00.000Z')

        const hoy = new Date()
        hoy.setHours(0, 0, 0, 0)
        if (fecha > hoy) {
          return reply.status(400).send({ success: false, message: 'No puedes registrar días futuros' })
        }

        const registro = await prisma.registro_dia_laboral.upsert({
          where: {
            conductor_id_fecha: {
              conductor_id: conductor.id,
              fecha
            }
          },
          update: {
            tipo: data.tipo,
            hora_inicio: data.tipo === 'LABORADO' ? data.hora_inicio : null,
            hora_fin: data.tipo === 'LABORADO' ? data.hora_fin : null,
            horas_conducidas: data.tipo === 'LABORADO' && data.horas_conducidas != null ? data.horas_conducidas : null,
            cliente_id: data.tipo === 'LABORADO' ? data.cliente_id : null,
            cliente_nombre: data.tipo === 'LABORADO' ? data.cliente_nombre : null,
            vehiculo_placa: data.tipo === 'LABORADO' ? data.vehiculo_placa : null,
            observaciones: data.observaciones || null,
          },
          create: {
            id: require('crypto').randomUUID(),
            conductor_id: conductor.id,
            fecha,
            tipo: data.tipo,
            hora_inicio: data.tipo === 'LABORADO' ? data.hora_inicio : null,
            hora_fin: data.tipo === 'LABORADO' ? data.hora_fin : null,
            horas_conducidas: data.tipo === 'LABORADO' && data.horas_conducidas != null ? data.horas_conducidas : null,
            cliente_id: data.tipo === 'LABORADO' ? data.cliente_id : null,
            cliente_nombre: data.tipo === 'LABORADO' ? data.cliente_nombre : null,
            vehiculo_placa: data.tipo === 'LABORADO' ? data.vehiculo_placa : null,
            observaciones: data.observaciones || null,
          }
        })

        return reply.send({ success: true, message: 'Registro guardado exitosamente', data: registro })
      } catch (err: any) {
        return reply.status(500).send({
          success: false,
          message: err.message || 'Error al guardar registro'
        })
      }
    })

    // ─── Eliminar registro ───
    protectedApp.delete('/conductor-portal/dias-laborados/registros/:fecha', {
      schema: {
        description: 'Eliminar registro de un día',
        tags: ['conductor-portal'],
        params: {
          type: 'object',
          required: ['fecha'],
          properties: {
            fecha: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }
          }
        }
      }
    }, async (request: FastifyRequest<{ Params: { fecha: string } }>, reply: FastifyReply) => {
      try {
        const conductor = (request as any).conductorPortal
        const { fecha } = request.params
        const fechaDate = new Date(fecha + 'T00:00:00.000Z')

        const registro = await prisma.registro_dia_laboral.findUnique({
          where: {
            conductor_id_fecha: {
              conductor_id: conductor.id,
              fecha: fechaDate
            }
          }
        })

        if (!registro) {
          return reply.status(404).send({ success: false, message: 'Registro no encontrado' })
        }

        await prisma.registro_dia_laboral.delete({ where: { id: registro.id } })
        return reply.send({ success: true, message: 'Registro eliminado exitosamente' })
      } catch (err: any) {
        return reply.status(500).send({
          success: false,
          message: err.message || 'Error al eliminar registro'
        })
      }
    })

    // ─── Listar clientes ───
    protectedApp.get('/conductor-portal/dias-laborados/clientes', {
      schema: {
        description: 'Obtener lista de clientes para el formulario',
        tags: ['conductor-portal']
      }
    }, async (_request: FastifyRequest, reply: FastifyReply) => {
      const clientes = await prisma.clientes.findMany({
        where: { deletedAt: null, oculto: false },
        select: { id: true, nombre: true, nit: true, tipo: true },
        orderBy: { nombre: 'asc' }
      })
      return reply.send({ success: true, data: clientes })
    })

    // ─── Listar vehículos ───
    protectedApp.get('/conductor-portal/dias-laborados/vehiculos', {
      schema: {
        description: 'Obtener lista de vehículos para el formulario',
        tags: ['conductor-portal']
      }
    }, async (_request: FastifyRequest, reply: FastifyReply) => {
      const vehiculos = await prisma.vehiculos.findMany({
        where: { oculto: false, deleted_at: null },
        select: { id: true, placa: true, marca: true, linea: true, modelo: true, estado: true, conductor_id: true },
        orderBy: { placa: 'asc' }
      })
      return reply.send({ success: true, data: vehiculos })
    })
  })
}

export default conductorPortalRoutes
