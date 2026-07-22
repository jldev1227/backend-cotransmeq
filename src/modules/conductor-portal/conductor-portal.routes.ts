// @ts-nocheck
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import jwt from 'jsonwebtoken'
import { prisma } from '../../config/prisma'
import { env } from '../../config/env'
import { EmailService } from '../../services/email.service'
import { LiquidacionesService } from '../liquidaciones/liquidaciones.service'
import { DiasLaboradosService } from '../dias-laborados/dias-laborados.service'
import { getIO } from '../../sockets'
import { getS3ObjectAsBase64, getS3SignedUrl, uploadToS3 } from '../../config/aws'

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

      // 1. Buscar conductor
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

      // 2. Generar JWT
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

      // 3. Guardar token en BD
      await prisma.conductor_token.create({
        data: {
          id: require('crypto').randomUUID(),
          conductor_id: conductor.id,
          token: jwtToken,
          expires_at: expiresAt
        }
      })

      // 4. Enviar email
      await EmailService.sendPortalAccessLink({
        to: conductor.email,
        conductorNombre: conductor.nombre,
        conductorApellido: conductor.apellido,
        token: jwtToken
      })

      // Ocultar parcialmente el email para la respuesta
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

      // Verificar token en BD
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
            conductor_id: conductor.id,
            desprendible_visible: true
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
            es_cotransmeq: true,
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

        // Obtener todas las primas del conductor una sola vez (para evitar N+1)
        const primasConductor = await prisma.primas.findMany({
          where: {
            conductor_id: conductor.id,
            deleted_at: null
          },
          select: {
            id: true,
            mes: true,
            anio: true,
            prima: true,
            prima_pendiente: true,
            estado: true
          }
        })

        // Formatear respuesta
        const result = liquidaciones.map((liq: any) => {
          const firma = liq.firmas_desprendibles?.[0]
          const yaFirmo = firma && firma.firma_url && firma.firma_url !== '' && firma.firma_url !== 'pending'

          // Buscar prima asociada: mismo conductor, mes/año del periodo_fin (±1 mes tolerancia)
          let prima_asociada: any = null
          try {
            if (liq.periodo_end) {
              const periodoFin = new Date(
                liq.periodo_end + (liq.periodo_end.length === 10 ? 'T00:00:00' : '')
              )
              if (!isNaN(periodoFin.getTime())) {
                const baseYear = periodoFin.getFullYear()
                const baseMonth = periodoFin.getMonth() + 1 // 1-12

                // Calcular candidatos (mes actual, mes anterior, mes siguiente)
                const candidatos: Array<{ anio: number; mes: number }> = []
                for (let offset = -1; offset <= 1; offset++) {
                  const d = new Date(baseYear, baseMonth - 1 + offset, 1)
                  candidatos.push({ anio: d.getFullYear(), mes: d.getMonth() + 1 })
                }

                // Buscar la primera que coincida con un candidato
                for (const p of primasConductor) {
                  const match = candidatos.some(
                    (c) => c.anio === p.anio && c.mes === p.mes
                  )
                  if (match) {
                    prima_asociada = {
                      id: p.id,
                      mes: p.mes,
                      anio: p.anio,
                      prima: p.prima,
                      prima_pendiente: p.prima_pendiente,
                      estado: p.estado
                    }
                    break
                  }
                }
              }
            }
          } catch (e) {
            // Si falla, no romper la respuesta
          }

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
            es_cotransmeq: liq.es_cotransmeq,
            fecha_liquidacion: liq.fecha_liquidacion,
            created_at: liq.created_at,
            firmado: !!yaFirmo,
            fecha_firma: yaFirmo ? firma.fecha_firma : null,
            prima_asociada
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

    // ─── Ver prima con firma reutilizada del desprendible ───
    protectedApp.get('/conductor-portal/prima/:id', {
      schema: {
        description: 'Obtener prima independiente con firma del desprendible del mismo periodo (reutilizada)',
        tags: ['conductor-portal'],
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string' } }
        }
      }
    }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const conductor = (request as any).conductorPortal
        const { id } = request.params

        const prima = await prisma.primas.findFirst({
          where: {
            id,
            conductor_id: conductor.id,
            deleted_at: null
          }
        })

        if (!prima) {
          return reply.status(404).send({ success: false, message: 'Prima no encontrada' })
        }

        // Buscar firma de un desprendible del mismo conductor del mismo mes/año
        // (±1 mes de tolerancia) para reutilizarla
        let firma: { presignedUrl?: string; fecha_firma?: Date | null; liquidacion_id?: string } | null = null
        try {
          const otrasFirmas = await prisma.firmas_desprendibles.findMany({
            where: {
              conductor_id: conductor.id,
              firma_url: { not: '' },
              NOT: { firma_url: 'pending' }
            },
            include: {
              liquidaciones: {
                select: {
                  id: true,
                  periodo_start: true,
                  periodo_end: true
                }
              }
            }
          })

          // Calcular candidatos (±1 mes del mes/año de la prima)
          const candidatos: Array<{ anio: number; mes: number }> = []
          for (let offset = -1; offset <= 1; offset++) {
            const d = new Date(prima.anio, prima.mes - 1 + offset, 1)
            candidatos.push({ anio: d.getFullYear(), mes: d.getMonth() + 1 })
          }

          for (const f of otrasFirmas) {
            if (!f.liquidaciones?.periodo_end) continue
            const fecha = new Date(
              f.liquidaciones.periodo_end + (f.liquidaciones.periodo_end.length === 10 ? 'T00:00:00' : '')
            )
            if (isNaN(fecha.getTime())) continue
            const match = candidatos.some(
              (c) => c.anio === fecha.getFullYear() && c.mes === fecha.getMonth() + 1
            )
            if (!match) continue
            try {
              const presignedUrl = await getS3SignedUrl(f.firma_s3_key, 3600)
              firma = {
                presignedUrl,
                fecha_firma: f.fecha_firma,
                liquidacion_id: f.liquidacion_id
              }
              break
            } catch {}
          }
        } catch (e) {
          request.log.warn({ error: e }, 'No se pudo obtener firma para la prima')
        }

        return reply.send({
          success: true,
          data: {
            prima: {
              id: prima.id,
              conductor_id: prima.conductor_id,
              mes: prima.mes,
              anio: prima.anio,
              prima: prima.prima,
              prima_pendiente: prima.prima_pendiente,
              tiempo_trabajado_dias: prima.tiempo_trabajado_dias,
              sueldo_basico: prima.sueldo_basico,
              auxilio_transporte: prima.auxilio_transporte,
              sueldo_variable: prima.sueldo_variable,
              total_base_liquidacion: prima.total_base_liquidacion,
              estado: prima.estado,
              observaciones: prima.observaciones,
              created_at: prima.created_at,
              updated_at: prima.updated_at
            },
            firma
          }
        })
      } catch (err: any) {
        request.log.error({ error: err }, 'Error obteniendo prima')
        return reply.status(500).send({
          success: false,
          message: err.message || 'Error al obtener la prima'
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

        // Verificar que la liquidación pertenece al conductor
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

        // Obtener liquidación completa usando el service existente
        const liquidacion = await LiquidacionesService.obtenerPorId(id)

        // Obtener preview de recargos
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

        // Obtener firma si existe (con fallback a firma de prima del mismo mes/año)
        let firmaPresigned = ''
        let firmaOrigen: 'desprendible' | 'prima' | null = null
        let firmaFecha: Date | null = null
        try {
          const firma = await prisma.firmas_desprendibles.findFirst({
            where: {
              liquidacion_id: id,
              conductor_id: conductor.id
            }
          })
          if (firma?.firma_s3_key && firma.firma_url !== 'pending' && firma.firma_url !== '') {
            firmaPresigned = await getS3SignedUrl(firma.firma_s3_key, 3600)
            firmaOrigen = 'desprendible'
            firmaFecha = firma.fecha_firma
          }
        } catch {}

        // Fallback: firma de prima del mismo mes/año (±1 mes del periodo_end)
        if (!firmaPresigned && liquidacion?.periodo_end) {
          try {
            const fechaFin = new Date(
              liquidacion.periodo_end + (liquidacion.periodo_end.length === 10 ? 'T00:00:00' : '')
            )
            if (!isNaN(fechaFin.getTime())) {
              const candidatos: Array<{ anio: number; mes: number }> = []
              for (let offset = -1; offset <= 1; offset++) {
                const d = new Date(fechaFin.getFullYear(), fechaFin.getMonth() + offset, 1)
                candidatos.push({ anio: d.getFullYear(), mes: d.getMonth() + 1 })
              }
              const firmasPrimas = await prisma.firmas_primas.findMany({
                where: {
                  conductor_id: conductor.id,
                  firma_url: { not: '' },
                  NOT: { firma_url: 'pending' }
                },
                orderBy: { fecha_firma: 'desc' }
              })
              // Traer primas por separado (evita dependencia de la relación en cliente Prisma)
              const primaIds = Array.from(new Set(firmasPrimas.map((f) => f.prima_id)))
              const primasRelacionadas = primaIds.length
                ? await prisma.primas.findMany({
                    where: { id: { in: primaIds } },
                    select: { id: true, anio: true, mes: true }
                  })
                : []
              const primaMap = new Map(primasRelacionadas.map((p) => [p.id, p]))
              for (const fp of firmasPrimas) {
                const primaRel = primaMap.get(fp.prima_id)
                if (!primaRel) continue
                const match = candidatos.some(
                  (c) => c.anio === primaRel.anio && c.mes === primaRel.mes
                )
                if (!match) continue
                try {
                  firmaPresigned = await getS3SignedUrl(fp.firma_s3_key, 3600)
                  firmaOrigen = 'prima'
                  firmaFecha = fp.fecha_firma
                  break
                } catch {}
              }
            }
          } catch {}
        }

        return reply.send({
          success: true,
          data: {
            liquidacion,
            recargos: recargosData,
            firma: firmaPresigned
              ? { presignedUrl: firmaPresigned, fecha_firma: firmaFecha, origen: firmaOrigen }
              : null
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

        // 1. Verificar que la liquidación pertenece al conductor
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

        // 2. Verificar si ya existe firma
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

        // 3. Convertir base64 a buffer
        const base64Data = firma_base64.replace(/^data:image\/\w+;base64,/, '')
        const buffer = Buffer.from(base64Data, 'base64')

        // Validar tamaño mínimo (firma real debería ser > 2KB)
        if (buffer.length < 2000) {
          return reply.status(400).send({
            success: false,
            message: 'La firma proporcionada no es válida. Debe ser una firma legible.'
          })
        }

        // 4. Subir a S3
        const firmaId = require('crypto').randomUUID()
        const s3Key = `firmas_desprendibles/${id}/${conductor.id}/${firmaId}.png`
        await uploadToS3(s3Key, buffer, 'image/png')

        const ipAddress = (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || request.ip || '0.0.0.0'
        const userAgent = request.headers['user-agent'] || ''
        const now = new Date()

        // 5. Crear o actualizar registro de firma
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

    // ─── Listar primas del conductor con flag firmado ───
    protectedApp.get('/conductor-portal/primas', {
      schema: {
        description: 'Listar primas del conductor con flag de firmado',
        tags: ['conductor-portal']
      }
    }, async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const conductor = (request as any).conductorPortal

        const primas = await prisma.primas.findMany({
          where: { conductor_id: conductor.id, deleted_at: null },
          orderBy: [{ anio: 'desc' }, { mes: 'desc' }]
        })

        // Obtener firmas por separado (evita dependencia del include firmas_primas
        // en el cliente Prisma cuando la migración aún no se ha regenerado)
        const primaIds = primas.map((p) => p.id)
        const firmas = primaIds.length
          ? await prisma.firmas_primas.findMany({
              where: {
                prima_id: { in: primaIds },
                estado: 'Activa',
                firma_url: { not: '' },
                NOT: { firma_url: 'pending' }
              },
              orderBy: { fecha_firma: 'desc' }
            })
          : []

        const firmaPorPrima = new Map<string, { firmado: boolean; fecha_firma: Date | null }>()
        for (const f of firmas) {
          if (!firmaPorPrima.has(f.prima_id)) {
            firmaPorPrima.set(f.prima_id, { firmado: true, fecha_firma: f.fecha_firma })
          }
        }

        return reply.send({
          success: true,
          data: primas.map((p) => {
            const f = firmaPorPrima.get(p.id)
            return {
              id: p.id,
              conductor_id: p.conductor_id,
              mes: p.mes,
              anio: p.anio,
              prima: Number(p.prima) || 0,
              prima_pendiente: p.prima_pendiente != null ? Number(p.prima_pendiente) : null,
              tiempo_trabajado_dias: p.tiempo_trabajado_dias,
              sueldo_basico: p.sueldo_basico != null ? Number(p.sueldo_basico) : null,
              auxilio_transporte: p.auxilio_transporte != null ? Number(p.auxilio_transporte) : null,
              sueldo_variable: p.sueldo_variable != null ? Number(p.sueldo_variable) : null,
              total_base_liquidacion: p.total_base_liquidacion != null ? Number(p.total_base_liquidacion) : null,
              estado: p.estado,
              observaciones: p.observaciones,
              created_at: p.created_at,
              firmado: !!f?.firmado,
              fecha_firma: f?.fecha_firma || null
            }
          })
        })
      } catch (err: any) {
        request.log.error({ error: err }, 'Error listando primas del conductor')
        return reply.status(500).send({
          success: false,
          message: err.message || 'Error al listar primas'
        })
      }
    })

    // ─── Firmar una prima desde el portal ───
    protectedApp.post('/conductor-portal/primas/:id/firmar', {
      schema: {
        description: 'Firmar una prima desde el portal del conductor',
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

        // 1. Verificar que la prima pertenece al conductor
        const prima = await prisma.primas.findFirst({
          where: { id, conductor_id: conductor.id, deleted_at: null },
          select: { id: true }
        })
        if (!prima) {
          return reply.status(404).send({
            success: false,
            message: 'Prima no encontrada'
          })
        }

        // 2. Verificar si ya existe firma
        const firmaExistente = await prisma.firmas_primas.findUnique({
          where: {
            prima_id_conductor_id: {
              prima_id: id,
              conductor_id: conductor.id
            }
          }
        })

        if (firmaExistente && firmaExistente.firma_url && firmaExistente.firma_url !== '' && firmaExistente.firma_url !== 'pending') {
          return reply.status(409).send({
            success: false,
            message: 'Esta prima ya fue firmada'
          })
        }

        // 3. Convertir base64 a buffer
        const base64Data = firma_base64.replace(/^data:image\/\w+;base64,/, '')
        const buffer = Buffer.from(base64Data, 'base64')
        if (buffer.length < 2000) {
          return reply.status(400).send({
            success: false,
            message: 'La firma proporcionada no es válida. Debe ser una firma legible.'
          })
        }

        // 4. Subir a S3
        const firmaId = require('crypto').randomUUID()
        const s3Key = `firmas_primas/${id}/${conductor.id}/${firmaId}.png`
        await uploadToS3(s3Key, buffer, 'image/png')

        const ipAddress = (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || request.ip || '0.0.0.0'
        const userAgent = request.headers['user-agent'] || ''
        const now = new Date()

        // 5. Crear o actualizar registro de firma
        if (firmaExistente) {
          await prisma.firmas_primas.update({
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
          await prisma.firmas_primas.create({
            data: {
              id: firmaId,
              prima_id: id,
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
          message: 'Firma de prima registrada exitosamente',
          data: {
            firmado: true,
            fecha_firma: now.toISOString()
          }
        })
      } catch (err: any) {
        request.log.error({ error: err }, 'Error firmando prima desde portal')
        return reply.status(500).send({
          success: false,
          message: err.message || 'Error al registrar firma de prima'
        })
      }
    })

    // ─── Obtener prima enriquecida con firma (base64) para dashboard ───
    // Orden de prioridad:
    //   1) Firma propia de la prima (firmas_primas)
    //   2) Fallback: firma de desprendible del mismo conductor del mismo mes/año
    //      (liquidaciones con periodo_end ±1 mes del mes/año de la prima)
    protectedApp.get('/conductor-portal/primas/:id/enriquecida', {
      schema: {
        description: 'Obtener prima + firma en base64 con fallback a firma de nomina',
        tags: ['conductor-portal'],
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string' } }
        }
      }
    }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const conductor = (request as any).conductorPortal
        const { id } = request.params

        const prima = await prisma.primas.findFirst({
          where: { id, conductor_id: conductor.id, deleted_at: null }
        })

        if (!prima) {
          return reply.status(404).send({ success: false, message: 'Prima no encontrada' })
        }

        // Cargar datos del conductor por separado (evita depender de relaciones en el cliente Prisma)
        const conductorData = await prisma.conductores.findUnique({
          where: { id: conductor.id },
          select: { id: true, nombre: true, apellido: true, numero_identificacion: true, email: true }
        })
        request.log.info(
          {
            primaId: id,
            conductorId: conductor.id,
            conductorData
          },
          '[PrimaEnriquecida] Datos del conductor cargados'
        )
        ;(prima as any).conductores = conductorData

        // 1) Firma propia de la prima
        let firmaBase64: string | null = null
        let firmaOrigen: 'prima' | 'nomina' | null = null
        let firmaFecha: Date | null = null
        let firmaLiquidacionId: string | null = null

        const firmaPropia = await prisma.firmas_primas.findFirst({
          where: {
            prima_id: id,
            conductor_id: conductor.id,
            firma_url: { not: '' },
            NOT: { firma_url: 'pending' }
          },
          orderBy: { fecha_firma: 'desc' }
        })
        if (firmaPropia && firmaPropia.firma_s3_key) {
          try {
            firmaBase64 = await getS3ObjectAsBase64(firmaPropia.firma_s3_key)
            firmaOrigen = 'prima'
            firmaFecha = firmaPropia.fecha_firma
          } catch {}
        }

        // 2) Fallback: firma de desprendible del mismo mes/año (±1 mes)
        if (!firmaBase64) {
          const candidatos: Array<{ anio: number; mes: number }> = []
          for (let offset = -1; offset <= 1; offset++) {
            const d = new Date(prima.anio, prima.mes - 1 + offset, 1)
            candidatos.push({ anio: d.getFullYear(), mes: d.getMonth() + 1 })
          }
          const otrasFirmas = await prisma.firmas_desprendibles.findMany({
            where: {
              conductor_id: conductor.id,
              firma_url: { not: '' },
              NOT: { firma_url: 'pending' }
            },
            include: {
              liquidaciones: { select: { id: true, periodo_start: true, periodo_end: true } }
            },
            orderBy: { fecha_firma: 'desc' }
          })
          for (const f of otrasFirmas) {
            if (!f.liquidaciones?.periodo_end) continue
            const fecha = new Date(
              f.liquidaciones.periodo_end + (f.liquidaciones.periodo_end.length === 10 ? 'T00:00:00' : '')
            )
            if (isNaN(fecha.getTime())) continue
            const match = candidatos.some(
              (c) => c.anio === fecha.getFullYear() && c.mes === fecha.getMonth() + 1
            )
            if (!match) continue
            try {
              firmaBase64 = await getS3ObjectAsBase64(f.firma_s3_key)
              firmaOrigen = 'nomina'
              firmaFecha = f.fecha_firma
              firmaLiquidacionId = f.liquidacion_id
              break
            } catch {}
          }
        }

        request.log.info(
          {
            primaId: id,
            primaKeys: Object.keys(prima),
            tieneConductor: !!(prima as any).conductores,
            conductorFields: (prima as any).conductores
              ? Object.keys((prima as any).conductores)
              : null,
            conductorValues: (prima as any).conductores,
            firmaOrigen
          },
          '[PrimaEnriquecida] Respuesta enviada'
        )

        return reply.send({
          success: true,
          data: {
            prima,
            firma: firmaBase64
              ? {
                  presignedUrl: firmaBase64,
                  fecha_firma: firmaFecha,
                  origen: firmaOrigen,
                  liquidacion_id: firmaLiquidacionId
                }
              : null
          }
        })
      } catch (err: any) {
        request.log.error({ error: err }, 'Error obteniendo prima enriquecida')
        return reply.status(500).send({
          success: false,
          message: err.message || 'Error al obtener la prima'
        })
      }
    })

    // ─── Obtener firma standalone (presignedUrl) de una prima con fallback ───
    protectedApp.get('/conductor-portal/primas/:id/firma', {
      schema: {
        description: 'Obtener presignedUrl de la firma de la prima con fallback a nomina',
        tags: ['conductor-portal'],
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string' } }
        }
      }
    }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const conductor = (request as any).conductorPortal
        const { id } = request.params

        const prima = await prisma.primas.findFirst({
          where: { id, conductor_id: conductor.id, deleted_at: null },
          select: { id: true, anio: true, mes: true }
        })
        if (!prima) {
          return reply.status(404).send({ success: false, message: 'Prima no encontrada' })
        }

        // 1) Firma propia
        const firmaPropia = await prisma.firmas_primas.findFirst({
          where: {
            prima_id: id,
            conductor_id: conductor.id,
            firma_url: { not: '' },
            NOT: { firma_url: 'pending' }
          },
          orderBy: { fecha_firma: 'desc' }
        })
        if (firmaPropia?.firma_s3_key) {
          try {
            const presignedUrl = await getS3SignedUrl(firmaPropia.firma_s3_key, 3600)
            return reply.send({
              success: true,
              data: {
                presignedUrl,
                fecha_firma: firmaPropia.fecha_firma,
                origen: 'prima'
              }
            })
          } catch {}
        }

        // 2) Fallback: firma de nomina
        const candidatos: Array<{ anio: number; mes: number }> = []
        for (let offset = -1; offset <= 1; offset++) {
          const d = new Date(prima.anio, prima.mes - 1 + offset, 1)
          candidatos.push({ anio: d.getFullYear(), mes: d.getMonth() + 1 })
        }
        const otrasFirmas = await prisma.firmas_desprendibles.findMany({
          where: {
            conductor_id: conductor.id,
            firma_url: { not: '' },
            NOT: { firma_url: 'pending' }
          },
          include: {
            liquidaciones: { select: { id: true, periodo_end: true } }
          },
          orderBy: { fecha_firma: 'desc' }
        })
        for (const f of otrasFirmas) {
          if (!f.liquidaciones?.periodo_end) continue
          const fecha = new Date(
            f.liquidaciones.periodo_end + (f.liquidaciones.periodo_end.length === 10 ? 'T00:00:00' : '')
          )
          if (isNaN(fecha.getTime())) continue
          const match = candidatos.some(
            (c) => c.anio === fecha.getFullYear() && c.mes === fecha.getMonth() + 1
          )
          if (!match) continue
          try {
            const presignedUrl = await getS3SignedUrl(f.firma_s3_key, 3600)
            return reply.send({
              success: true,
              data: {
                presignedUrl,
                fecha_firma: f.fecha_firma,
                origen: 'nomina',
                liquidacion_id: f.liquidacion_id
              }
            })
          } catch {}
        }

        return reply.send({ success: true, data: null })
      } catch (err: any) {
        request.log.error({ error: err }, 'Error obteniendo firma de prima')
        return reply.status(500).send({
          success: false,
          message: err.message || 'Error al obtener firma'
        })
      }
    })

    // ─── Registros de días laborados (reutilizar lógica existente) ───
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

        // Incluir los segmentos de cada registro LABORADO (la fuente de verdad
        // de cliente/vehículo/horas es la tabla pivote registro_dia_laboral_segmento)
        const ids = registros.filter(r => r.tipo === 'LABORADO').map(r => r.id)
        const segmentos = ids.length === 0
          ? []
          : await prisma.registro_dia_laboral_segmento.findMany({
              where: { registro_dia_id: { in: ids } },
              orderBy: { orden: 'asc' }
            });
        const segMap = new Map<string, any[]>()
        for (const s of segmentos) {
          if (!segMap.has(s.registro_dia_id)) segMap.set(s.registro_dia_id, [])
          segMap.get(s.registro_dia_id)!.push(s)
        }
        const data = registros.map(r => ({ ...r, segmentos: segMap.get(r.id) || [] }))

        return reply.send({ success: true, data, count: data.length })
      } catch (err: any) {
        return reply.status(500).send({
          success: false,
          message: err.message || 'Error al listar registros'
        })
      }
    })

    // ─── Guardar/actualizar registro de un día ───
    // NOTA: El padre `registro_dia_laboral` solo guarda tipo + fecha + observaciones.
    // Los detalles (cliente/vehículo/horarios/horas) viven en `registro_dia_laboral_segmento`
    // y llegan en el array `segmentos` del body.
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
            observaciones: { type: 'string' },
            segmentos: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  cliente_id: { type: 'string' },
                  cliente_nombre: { type: 'string' },
                  vehiculo_id: { type: 'string' },
                  vehiculo_placa: { type: 'string' },
                  hora_inicio: { type: 'string' },
                  hora_fin: { type: 'string' },
                  horas_conducidas: { type: 'number' },
                  km_inicial: { type: ['integer', 'null'] },
                  km_final: { type: ['integer', 'null'] },
                  pernocte: { type: 'boolean' },
                  observaciones: { type: 'string' }
                }
              },
              default: []
            }
          }
        }
      }
    }, async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const conductor = (request as any).conductorPortal
        const data = request.body as any
        const fechaDate = new Date(data.fecha + 'T00:00:00.000Z')

        // No permitir fechas futuras
        const hoy = new Date()
        hoy.setHours(0, 0, 0, 0)
        if (fechaDate > hoy) {
          return reply.status(400).send({ success: false, message: 'No puedes registrar días futuros' })
        }

        // Delegar al servicio oficial (maneja correctamente la tabla pivote de segmentos
        // y aplica la transacción replaceAll)
        const registro = await DiasLaboradosService.upsertRegistro(conductor.id, {
          fecha: data.fecha,
          tipo: data.tipo,
          observaciones: data.observaciones || null,
          segmentos: data.segmentos || []
        })

        // Emitir evento en tiempo real para que el dashboard se actualice
        try {
          const io = getIO()
          io.emit('dias-laborados:registro-actualizado', {
            conductor_id: conductor.id,
            conductor_nombre: conductor.nombre,
            conductor_apellido: conductor.apellido,
            fecha: data.fecha,
            tipo: data.tipo,
            segmentos_count: (data.segmentos || []).length,
            timestamp: new Date().toISOString()
          })
        } catch (e) {
          // socket no inicializado → continuar
        }

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

        // Notificar a dashboards en tiempo real
        try {
          const io = getIO()
          io.emit('dias-laborados:registro-actualizado', {
            conductor_id: conductor.id,
            conductor_nombre: conductor.nombre,
            conductor_apellido: conductor.apellido,
            fecha,
            tipo: null,
            segmentos_count: 0,
            eliminado: true,
            timestamp: new Date().toISOString()
          })
        } catch (e) {}

        return reply.send({ success: true, message: 'Registro eliminado exitosamente' })
      } catch (err: any) {
        return reply.status(500).send({
          success: false,
          message: err.message || 'Error al eliminar registro'
        })
      }
    })

    // ─── Listar clientes (para select en formulario dias laborados) ───
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

    // ─── Listar servicios del conductor (planificados, en curso, realizados) ───
    protectedApp.get('/conductor-portal/servicios', {
      schema: {
        description: 'Listar servicios del conductor autenticado (planificados, en curso, realizados)',
        tags: ['conductor-portal'],
        querystring: {
          type: 'object',
          properties: {
            estados: { type: 'string', description: 'CSV de estados a filtrar (ej. planificado,en_curso,realizado)' }
          }
        }
      }
    }, async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const conductor = (request as any).conductorPortal
        const { estados } = request.query as { estados?: string }

        // Por defecto mostrar estados visibles para el conductor
        const estadosDefault = ['solicitado', 'planificado', 'en_curso', 'pendiente', 'realizado', 'planilla_asignada']
        const estadosFiltro = estados
          ? estados.split(',').map((e) => e.trim()).filter(Boolean)
          : estadosDefault

        const servicios = await prisma.servicio.findMany({
          where: {
            conductor_id: conductor.id,
            estado: { in: estadosFiltro as any }
          },
          select: {
            id: true,
            estado: true,
            proposito_servicio: true,
            origen_especifico: true,
            destino_especifico: true,
            fecha_solicitud: true,
            fecha_realizacion: true,
            fecha_finalizacion: true,
            origen_latitud: true,
            origen_longitud: true,
            destino_latitud: true,
            destino_longitud: true,
            valor: true,
            numero_planilla: true,
            // observaciones: NO se exponen en listado
            municipios_servicio_origen_idTomunicipios: {
              select: { id: true, nombre_municipio: true, nombre_departamento: true, latitud: true, longitud: true }
            },
            municipios_servicio_destino_idTomunicipios: {
              select: { id: true, nombre_municipio: true, nombre_departamento: true, latitud: true, longitud: true }
            },
            vehiculos: {
              select: {
                id: true,
                placa: true,
                marca: true,
                linea: true,
                modelo: true,
                color: true,
                clase_vehiculo: true,
                tipo_carroceria: true
              }
            },
            clientes: {
              select: {
                id: true,
                nombre: true,
                nit: true
              }
            }
          },
          orderBy: [{ fecha_solicitud: 'desc' }]
        })

        // Serializar Decimal a number y mapear nombres de campos a la API
        const result = servicios.map((s: any) => ({
          id: s.id,
          estado: s.estado,
          proposito_servicio: s.proposito_servicio,
          origen_especifico: s.origen_especifico,
          destino_especifico: s.destino_especifico,
          fecha_solicitud: s.fecha_solicitud,
          fecha_realizacion: s.fecha_realizacion,
          fecha_finalizacion: s.fecha_finalizacion,
          origen_latitud: s.origen_latitud,
          origen_longitud: s.origen_longitud,
          destino_latitud: s.destino_latitud,
          destino_longitud: s.destino_longitud,
          valor: s.valor ? Number(s.valor) : 0,
          numero_planilla: s.numero_planilla,
          origen: s.municipios_servicio_origen_idTomunicipios,
          destino: s.municipios_servicio_destino_idTomunicipios,
          vehiculo: s.vehiculos,
          cliente: s.clientes
        }))

        return reply.send({ success: true, data: result, count: result.length })
      } catch (err: any) {
        request.log.error({ error: err }, 'Error listando servicios del conductor')
        return reply.status(500).send({
          success: false,
          message: err.message || 'Error al listar servicios'
        })
      }
    })

    // ─── Detalle de un servicio (sin observaciones) ───
    protectedApp.get('/conductor-portal/servicios/:id', {
      schema: {
        description: 'Detalle de un servicio del conductor (excluye observaciones)',
        tags: ['conductor-portal'],
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string' } }
        }
      }
    }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const conductor = (request as any).conductorPortal
        const { id } = request.params

        const servicio = await prisma.servicio.findFirst({
          where: {
            id,
            conductor_id: conductor.id
          },
          select: {
            id: true,
            estado: true,
            proposito_servicio: true,
            origen_especifico: true,
            destino_especifico: true,
            fecha_solicitud: true,
            fecha_realizacion: true,
            fecha_finalizacion: true,
            origen_latitud: true,
            origen_longitud: true,
            destino_latitud: true,
            destino_longitud: true,
            valor: true,
            numero_planilla: true,
            created_at: true,
            // observaciones: NO se exponen
            // no_conformidades: NO se exponen
            municipios_servicio_origen_idTomunicipios: {
              select: { id: true, nombre_municipio: true, nombre_departamento: true, latitud: true, longitud: true }
            },
            municipios_servicio_destino_idTomunicipios: {
              select: { id: true, nombre_municipio: true, nombre_departamento: true, latitud: true, longitud: true }
            },
            vehiculos: {
              select: {
                id: true,
                placa: true,
                marca: true,
                linea: true,
                modelo: true,
                color: true,
                clase_vehiculo: true,
                tipo_carroceria: true,
                combustible: true
              }
            },
            clientes: {
              select: {
                id: true,
                nombre: true,
                nit: true
              }
            }
          }
        })

        if (!servicio) {
          return reply.status(404).send({
            success: false,
            message: 'Servicio no encontrado'
          })
        }

        return reply.send({
          success: true,
          data: {
            id: servicio.id,
            estado: servicio.estado,
            proposito_servicio: servicio.proposito_servicio,
            origen_especifico: servicio.origen_especifico,
            destino_especifico: servicio.destino_especifico,
            fecha_solicitud: servicio.fecha_solicitud,
            fecha_realizacion: servicio.fecha_realizacion,
            fecha_finalizacion: servicio.fecha_finalizacion,
            origen_latitud: servicio.origen_latitud,
            origen_longitud: servicio.origen_longitud,
            destino_latitud: servicio.destino_latitud,
            destino_longitud: servicio.destino_longitud,
            valor: servicio.valor ? Number(servicio.valor) : 0,
            numero_planilla: servicio.numero_planilla,
            created_at: servicio.created_at,
            origen: servicio.municipios_servicio_origen_idTomunicipios,
            destino: servicio.municipios_servicio_destino_idTomunicipios,
            vehiculo: servicio.vehiculos,
            cliente: servicio.clientes
          }
        })
      } catch (err: any) {
        request.log.error({ error: err }, 'Error obteniendo servicio del conductor')
        return reply.status(500).send({
          success: false,
          message: err.message || 'Error al obtener servicio'
        })
      }
    })
  })
}

export default conductorPortalRoutes
