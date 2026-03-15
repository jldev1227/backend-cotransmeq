import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { prisma } from '../../config/prisma'
import { uploadToS3, getS3SignedUrl } from '../../config/aws'
import { randomUUID } from 'crypto'

export async function desprendiblesPublicRoutes(app: FastifyInstance) {

  // ============================================
  // RUTA PÚBLICA: Validar token y obtener info del conductor/liquidación
  // ============================================
  app.get('/desprendible/public/:token', async (request: FastifyRequest<{
    Params: { token: string }
  }>, reply: FastifyReply) => {
    try {
      const { token } = request.params

      const liquidacion = await prisma.liquidaciones.findUnique({
        where: { share_token: token },
        include: {
          conductores: {
            select: {
              id: true,
              nombre: true,
              apellido: true,
              numero_identificacion: true,
              cargo: true,
              salario_base: true,
              sede_trabajo: true
            }
          },
          firmas_desprendibles: {
            select: {
              id: true,
              firma_url: true,
              fecha_firma: true,
              estado: true
            }
          }
        }
      })

      if (!liquidacion) {
        return reply.status(404).send({
          success: false,
          message: 'Enlace inválido o no encontrado'
        })
      }

      // Verificar expiración
      if (liquidacion.share_token_expires_at && new Date(liquidacion.share_token_expires_at) < new Date()) {
        return reply.status(410).send({
          success: false,
          message: 'Este enlace ha expirado. Solicita uno nuevo al administrador.'
        })
      }

      // Verificar si ya firmó este conductor
      const yaFirmo = liquidacion.firmas_desprendibles.some(
        f => f.estado === 'Activa'
      )

      const conductor = liquidacion.conductores

      return reply.send({
        success: true,
        data: {
          liquidacion_id: liquidacion.id,
          periodo: `${liquidacion.periodo_start} - ${liquidacion.periodo_end}`,
          periodo_start: liquidacion.periodo_start,
          periodo_end: liquidacion.periodo_end,
          conductor: conductor ? {
            id: conductor.id,
            nombre: `${conductor.nombre} ${conductor.apellido}`,
            numero_identificacion: conductor.numero_identificacion,
            cargo: conductor.cargo
          } : null,
          ya_firmo: yaFirmo,
          neto_pagado: Number(liquidacion.sueldo_total),
          estado: liquidacion.estado
        }
      })
    } catch (error: any) {
      request.log.error({ error }, 'Error al validar token de desprendible')
      return reply.status(500).send({ success: false, message: 'Error interno del servidor' })
    }
  })

  // ============================================
  // RUTA PÚBLICA: Registrar firma digital y obtener datos del desprendible
  // ============================================
  app.post('/desprendible/public/:token/firmar', async (request: FastifyRequest<{
    Params: { token: string }
  }>, reply: FastifyReply) => {
    try {
      const { token } = request.params

      // Obtener la firma como archivo del multipart
      const data = await request.file()

      if (!data) {
        return reply.status(400).send({ success: false, message: 'Debe proporcionar la firma digital' })
      }

      // Validar token
      const liquidacion = await prisma.liquidaciones.findUnique({
        where: { share_token: token },
        include: {
          conductores: {
            select: {
              id: true,
              nombre: true,
              apellido: true,
              numero_identificacion: true,
              email: true,
              telefono: true,
              cargo: true,
              salario_base: true,
              sede_trabajo: true
            }
          },
          liquidacion_vehiculo: {
            include: {
              vehiculos: {
                select: { id: true, placa: true, marca: true, modelo: true, clase_vehiculo: true }
              }
            }
          },
          bonificaciones: true,
          pernotes: {
            include: {
              clientes: { select: { id: true, nombre: true } }
            }
          },
          recargos: {
            include: {
              clientes: { select: { id: true, nombre: true } }
            }
          },
          mantenimientos: true,
          anticipos: true,
          firmas_desprendibles: true
        }
      })

      if (!liquidacion) {
        return reply.status(404).send({ success: false, message: 'Enlace inválido o no encontrado' })
      }

      if (liquidacion.share_token_expires_at && new Date(liquidacion.share_token_expires_at) < new Date()) {
        return reply.status(410).send({ success: false, message: 'Este enlace ha expirado' })
      }

      if (!liquidacion.conductor_id || !liquidacion.conductores) {
        return reply.status(400).send({ success: false, message: 'Liquidación sin conductor asociado' })
      }

      // Subir firma a S3
      const firmaBuffer = await data.toBuffer()
      const firmaId = randomUUID()
      const s3Key = `firmas/desprendibles/${liquidacion.conductor_id}/${firmaId}.png`
      await uploadToS3(s3Key, firmaBuffer, 'image/png')

      // Obtener URL pública de la firma
      const firmaUrl = await getS3SignedUrl(s3Key, 86400 * 30) // 30 días

      // Obtener IP y User Agent
      const ipAddress = (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
        || request.ip
        || '0.0.0.0'
      const userAgent = request.headers['user-agent'] || ''

      // Generar hash de la firma
      const crypto = await import('crypto')
      const hashFirma = crypto.createHash('sha256').update(firmaBuffer).digest('hex')

      const now = new Date()

      // Crear o actualizar registro de firma
      const firma = await prisma.firmas_desprendibles.upsert({
        where: {
          liquidacion_id_conductor_id: {
            liquidacion_id: liquidacion.id,
            conductor_id: liquidacion.conductor_id
          }
        },
        update: {
          firma_url: firmaUrl,
          firma_s3_key: s3Key,
          ip_address: ipAddress,
          user_agent: userAgent,
          fecha_firma: now,
          hash_firma: hashFirma,
          estado: 'Activa',
          updated_at: now
        },
        create: {
          id: firmaId,
          liquidacion_id: liquidacion.id,
          conductor_id: liquidacion.conductor_id,
          firma_url: firmaUrl,
          firma_s3_key: s3Key,
          ip_address: ipAddress,
          user_agent: userAgent,
          fecha_firma: now,
          hash_firma: hashFirma,
          estado: 'Activa',
          created_at: now,
          updated_at: now
        }
      })

      // Construir respuesta con datos completos de la liquidación para generar el PDF
      const conductor = liquidacion.conductores
      const vehiculos = liquidacion.liquidacion_vehiculo.map(lv => lv.vehiculos)

      const liquidacionData = {
        ...liquidacion,
        periodo_inicio: liquidacion.periodo_start,
        periodo_fin: liquidacion.periodo_end,
        conductor: conductor ? {
          id: conductor.id,
          nombre: `${conductor.nombre} ${conductor.apellido}`,
          cedula: conductor.numero_identificacion,
          email: conductor.email,
          telefono: conductor.telefono,
          cargo: conductor.cargo,
          salario_base: conductor.salario_base
        } : null,
        vehiculos,
        salario_devengado: Number(liquidacion.salario_devengado),
        sueldo_total: Number(liquidacion.sueldo_total),
        salud: Number(liquidacion.salud),
        pension: Number(liquidacion.pension),
        cesantias: Number(liquidacion.cesantias),
        interes_cesantias: Number(liquidacion.interes_cesantias),
        auxilio_transporte: Number(liquidacion.auxilio_transporte),
        total_bonificaciones: Number(liquidacion.total_bonificaciones),
        total_pernotes: Number(liquidacion.total_pernotes),
        total_recargos: Number(liquidacion.total_recargos),
        total_anticipos: Number(liquidacion.total_anticipos),
        total_vacaciones: Number(liquidacion.total_vacaciones),
        valor_incapacidad: Number(liquidacion.valor_incapacidad),
        ajuste_salarial: Number(liquidacion.ajuste_salarial),
        ajuste_parex: Number(liquidacion.ajuste_parex),
        total_devengado: Number(liquidacion.salario_devengado) +
          Number(liquidacion.total_bonificaciones) +
          Number(liquidacion.total_pernotes) +
          Number(liquidacion.total_recargos) +
          Number(liquidacion.auxilio_transporte) +
          Number(liquidacion.cesantias) +
          Number(liquidacion.interes_cesantias) +
          Number(liquidacion.total_vacaciones) +
          Number(liquidacion.ajuste_salarial) +
          Number(liquidacion.ajuste_parex),
        total_deducido: Number(liquidacion.salud) +
          Number(liquidacion.pension) +
          Number(liquidacion.total_anticipos),
        neto_pagado: Number(liquidacion.sueldo_total)
      }

      // Obtener firma con URL firmada para incluir en el PDF
      const firmaConUrl = {
        ...firma,
        presignedUrl: firmaUrl
      }

      return reply.send({
        success: true,
        data: {
          liquidacion: liquidacionData,
          firma: firmaConUrl
        }
      })
    } catch (error: any) {
      request.log.error({ error }, 'Error al registrar firma')
      return reply.status(500).send({ success: false, message: error.message || 'Error al registrar firma' })
    }
  })

  // ============================================
  // RUTA PÚBLICA: Obtener datos de liquidación si ya firmó
  // ============================================
  app.get('/desprendible/public/:token/datos', async (request: FastifyRequest<{
    Params: { token: string }
  }>, reply: FastifyReply) => {
    try {
      const { token } = request.params

      const liquidacion = await prisma.liquidaciones.findUnique({
        where: { share_token: token },
        include: {
          conductores: {
            select: {
              id: true,
              nombre: true,
              apellido: true,
              numero_identificacion: true,
              email: true,
              telefono: true,
              cargo: true,
              salario_base: true,
              sede_trabajo: true
            }
          },
          liquidacion_vehiculo: {
            include: {
              vehiculos: {
                select: { id: true, placa: true, marca: true, modelo: true, clase_vehiculo: true }
              }
            }
          },
          bonificaciones: true,
          pernotes: {
            include: {
              clientes: { select: { id: true, nombre: true } }
            }
          },
          recargos: {
            include: {
              clientes: { select: { id: true, nombre: true } }
            }
          },
          mantenimientos: true,
          anticipos: true,
          firmas_desprendibles: true
        }
      })

      if (!liquidacion) {
        return reply.status(404).send({ success: false, message: 'Enlace inválido' })
      }

      if (liquidacion.share_token_expires_at && new Date(liquidacion.share_token_expires_at) < new Date()) {
        return reply.status(410).send({ success: false, message: 'Este enlace ha expirado' })
      }

      // Verificar que ya haya firmado
      const firmaActiva = liquidacion.firmas_desprendibles.find(f => f.estado === 'Activa')
      if (!firmaActiva) {
        return reply.status(403).send({ success: false, message: 'Debe firmar primero para acceder al desprendible' })
      }

      const conductor = liquidacion.conductores
      const vehiculos = liquidacion.liquidacion_vehiculo.map(lv => lv.vehiculos)

      // Obtener URL firmada de la firma
      let firmaPresignedUrl = ''
      try {
        firmaPresignedUrl = await getS3SignedUrl(firmaActiva.firma_s3_key, 3600)
      } catch { /* ignorar error */ }

      const liquidacionData = {
        ...liquidacion,
        periodo_inicio: liquidacion.periodo_start,
        periodo_fin: liquidacion.periodo_end,
        conductor: conductor ? {
          id: conductor.id,
          nombre: `${conductor.nombre} ${conductor.apellido}`,
          cedula: conductor.numero_identificacion,
          email: conductor.email,
          telefono: conductor.telefono,
          cargo: conductor.cargo,
          salario_base: conductor.salario_base
        } : null,
        vehiculos,
        salario_devengado: Number(liquidacion.salario_devengado),
        sueldo_total: Number(liquidacion.sueldo_total),
        salud: Number(liquidacion.salud),
        pension: Number(liquidacion.pension),
        cesantias: Number(liquidacion.cesantias),
        interes_cesantias: Number(liquidacion.interes_cesantias),
        auxilio_transporte: Number(liquidacion.auxilio_transporte),
        total_bonificaciones: Number(liquidacion.total_bonificaciones),
        total_pernotes: Number(liquidacion.total_pernotes),
        total_recargos: Number(liquidacion.total_recargos),
        total_anticipos: Number(liquidacion.total_anticipos),
        total_vacaciones: Number(liquidacion.total_vacaciones),
        valor_incapacidad: Number(liquidacion.valor_incapacidad),
        ajuste_salarial: Number(liquidacion.ajuste_salarial),
        ajuste_parex: Number(liquidacion.ajuste_parex),
        total_devengado: Number(liquidacion.salario_devengado) +
          Number(liquidacion.total_bonificaciones) +
          Number(liquidacion.total_pernotes) +
          Number(liquidacion.total_recargos) +
          Number(liquidacion.auxilio_transporte) +
          Number(liquidacion.cesantias) +
          Number(liquidacion.interes_cesantias) +
          Number(liquidacion.total_vacaciones) +
          Number(liquidacion.ajuste_salarial) +
          Number(liquidacion.ajuste_parex),
        total_deducido: Number(liquidacion.salud) +
          Number(liquidacion.pension) +
          Number(liquidacion.total_anticipos),
        neto_pagado: Number(liquidacion.sueldo_total)
      }

      const firmaConUrl = {
        ...firmaActiva,
        presignedUrl: firmaPresignedUrl
      }

      return reply.send({
        success: true,
        data: {
          liquidacion: liquidacionData,
          firma: firmaConUrl
        }
      })
    } catch (error: any) {
      request.log.error({ error }, 'Error al obtener datos del desprendible')
      return reply.status(500).send({ success: false, message: 'Error interno del servidor' })
    }
  })
}
