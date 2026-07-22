// @ts-nocheck
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { prisma } from '../../config/prisma'
import { uploadToS3, getS3SignedUrl } from '../../config/aws'
import { randomUUID, randomBytes } from 'crypto'
import { LiquidacionesService } from '../liquidaciones/liquidaciones.service'

/**
 * Rutas públicas para firma de desprendibles de nómina.
 * El conductor accede con un token único, firma, y luego puede ver su PDF.
 * 
 * Flujo:
 * 1. Admin genera token → POST /api/desprendible-firma/generar (autenticado)
 * 2. Conductor abre enlace → GET /api/desprendible-firma/:token (público)
 * 3. Conductor firma → POST /api/desprendible-firma/:token/firmar (público)
 * 4. Conductor ve datos → GET /api/desprendible-firma/:token/datos (público, solo si firmó)
 */
export async function desprendibleFirmaRoutes(app: FastifyInstance) {

  // ================================================================
  // GET /api/desprendible-firma/:token — Validar token (público)
  // ================================================================
  app.get('/desprendible-firma/:token', async (
    request: FastifyRequest<{ Params: { token: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const { token } = request.params

      const firma = await prisma.firmas_desprendibles.findUnique({
        where: { token },
        include: {
          conductores: {
            select: {
              id: true,
              nombre: true,
              apellido: true,
              numero_identificacion: true
            }
          },
          liquidaciones: {
            select: {
              id: true,
              periodo_start: true,
              periodo_end: true
            }
          }
        }
      })

      if (!firma) {
        return reply.status(404).send({ success: false, message: 'Enlace inválido o no existe.' })
      }

      if (firma.expires_at && new Date(firma.expires_at) < new Date()) {
        return reply.status(410).send({ success: false, message: 'Este enlace ha expirado.' })
      }

      // Determinar si ya firmó (firma_url tiene valor real, no placeholder)
      const yaFirmo = firma.firma_url !== '' && firma.firma_url !== 'pending'

      return reply.send({
        success: true,
        data: {
          id: firma.id,
          token: firma.token,
          ya_firmo: yaFirmo,
          expires_at: firma.expires_at,
          conductor: firma.conductores ? {
            nombre: `${firma.conductores.nombre} ${firma.conductores.apellido}`,
            numero_identificacion: firma.conductores.numero_identificacion
          } : null,
          liquidacion: firma.liquidaciones ? {
            id: firma.liquidaciones.id,
            periodo_inicio: firma.liquidaciones.periodo_start,
            periodo_fin: firma.liquidaciones.periodo_end
          } : null
        }
      })
    } catch (error: any) {
      request.log.error({ error }, 'Error validando token de desprendible')
      return reply.status(500).send({ success: false, message: 'Error interno del servidor' })
    }
  })

  // ================================================================
  // POST /api/desprendible-firma/:token/firmar — Registrar firma (público)
  // ================================================================
  app.post('/desprendible-firma/:token/firmar', async (
    request: FastifyRequest<{ Params: { token: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const { token } = request.params
      const data = await request.file()
      if (!data) {
        return reply.status(400).send({ success: false, message: 'Debe proporcionar la imagen de la firma.' })
      }

      const firma = await prisma.firmas_desprendibles.findUnique({ where: { token } })
      if (!firma) {
        return reply.status(404).send({ success: false, message: 'Enlace inválido.' })
      }
      if (firma.expires_at && new Date(firma.expires_at) < new Date()) {
        return reply.status(410).send({ success: false, message: 'Este enlace ha expirado.' })
      }

      // Ya firmó?
      const yaFirmo = firma.firma_url !== '' && firma.firma_url !== 'pending'
      if (yaFirmo) {
        return reply.status(409).send({ success: false, message: 'Este desprendible ya fue firmado.' })
      }

      const buffer = await data.toBuffer()
      const firmaId = randomUUID()
      const s3Key = `firmas_desprendibles/${firma.liquidacion_id}/${firma.conductor_id}/${firmaId}.png`
      await uploadToS3(s3Key, buffer, data.mimetype || 'image/png')
      const firmaUrl = await getS3SignedUrl(s3Key, 3600 * 24 * 365) // 1 year presigned

      const ipAddress = (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || request.ip || '0.0.0.0'
      const userAgent = request.headers['user-agent'] || ''
      const now = new Date()

      await prisma.firmas_desprendibles.update({
        where: { token },
        data: {
          firma_url: firmaUrl,
          firma_s3_key: s3Key,
          ip_address: ipAddress,
          user_agent: userAgent,
          fecha_firma: now,
          updated_at: now
        }
      })

      return reply.send({
        success: true,
        message: 'Firma registrada exitosamente.',
        data: {
          firma_url: firmaUrl,
          s3_key: s3Key
        }
      })
    } catch (error: any) {
      request.log.error({ error }, 'Error registrando firma de desprendible')
      return reply.status(500).send({ success: false, message: error.message || 'Error al registrar firma' })
    }
  })

  // ================================================================
  // GET /api/desprendible-firma/:token/datos — Obtener liquidación completa (público, solo si firmó)
  // ================================================================
  app.get('/desprendible-firma/:token/datos', async (
    request: FastifyRequest<{ Params: { token: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const { token } = request.params

      const firma = await prisma.firmas_desprendibles.findUnique({ where: { token } })
      if (!firma) {
        return reply.status(404).send({ success: false, message: 'Enlace inválido.' })
      }

      const yaFirmo = firma.firma_url !== '' && firma.firma_url !== 'pending'
      if (!yaFirmo) {
        return reply.status(403).send({ success: false, message: 'Debe firmar primero para ver el desprendible.' })
      }

      // Obtener liquidación completa usando el service existente
      const liquidacion = await LiquidacionesService.obtenerPorId(firma.liquidacion_id)

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

      // Generar presigned URL de la firma
      let firmaPresigned = ''
      try {
        if (firma.firma_s3_key) {
          firmaPresigned = await getS3SignedUrl(firma.firma_s3_key, 3600)
        }
      } catch {}

      // Buscar firmas de prima: otras liquidaciones del mismo conductor
      // cuyo periodo_end caiga en el mismo mes/año (±1 mes de tolerancia)
      let firmasPrima: any[] = []
      try {
        if (firma.conductor_id && liquidacion.periodo_fin) {
          // Parsear periodo_fin (formato YYYY-MM-DD o string)
          const periodoFin = new Date(
            liquidacion.periodo_fin +
              (liquidacion.periodo_fin.length === 10 ? 'T00:00:00' : '')
          )
          if (!isNaN(periodoFin.getTime())) {
            const baseYear = periodoFin.getFullYear()
            const baseMonth = periodoFin.getMonth() + 1 // 1-12

            // Calcular meses candidatos (mes actual, mes anterior, mes siguiente)
            const candidatos: Array<{ anio: number; mes: number }> = []
            for (let offset = -1; offset <= 1; offset++) {
              const d = new Date(baseYear, baseMonth - 1 + offset, 1)
              candidatos.push({ anio: d.getFullYear(), mes: d.getMonth() + 1 })
            }

            // Buscar firmas de liquidaciones del mismo conductor en esos meses
            const otrasFirmas = await prisma.firmas_desprendibles.findMany({
              where: {
                conductor_id: firma.conductor_id,
                id: { not: firma.id }, // Excluir la firma actual
                liquidaciones: {
                  periodo_end: { not: null }
                }
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

            // Filtrar por mes/año y generar presigned URLs
            for (const otra of otrasFirmas) {
              if (!otra.liquidaciones?.periodo_end) continue
              const yaFirmoOtra = otra.firma_url !== '' && otra.firma_url !== 'pending'
              if (!yaFirmoOtra || !otra.firma_s3_key) continue

              const otraFecha = new Date(
                otra.liquidaciones.periodo_end +
                  (otra.liquidaciones.periodo_end.length === 10 ? 'T00:00:00' : '')
              )
              if (isNaN(otraFecha.getTime())) continue

              const match = candidatos.some(
                (c) => c.anio === otraFecha.getFullYear() && c.mes === otraFecha.getMonth() + 1
              )
              if (!match) continue

              try {
                const presignedUrl = await getS3SignedUrl(otra.firma_s3_key, 3600)
                firmasPrima.push({
                  id: otra.id,
                  liquidacion_id: otra.liquidacion_id,
                  firma_s3_key: otra.firma_s3_key,
                  fecha_firma: otra.fecha_firma,
                  periodo_inicio: otra.liquidaciones.periodo_start,
                  periodo_fin: otra.liquidaciones.periodo_end,
                  presignedUrl
                })
              } catch {}
            }
          }
        }
      } catch (e) {
        // Si falla la búsqueda de firmasPrima, no bloquear
        request.log.warn({ error: e }, 'No se pudieron cargar firmas de prima')
      }

      return reply.send({
        success: true,
        data: {
          liquidacion,
          recargos: recargosData,
          firma: {
            presignedUrl: firmaPresigned,
            fecha_firma: firma.fecha_firma
          },
          firmasPrima
        }
      })
    } catch (error: any) {
      request.log.error({ error }, 'Error obteniendo datos de desprendible')
      return reply.status(500).send({ success: false, message: error.message || 'Error interno' })
    }
  })

  // ================================================================
  // POST /api/desprendible-firma/generar — Generar tokens para liquidaciones (autenticado)
  // Se llama desde el admin para generar el link que se envía al conductor
  // ================================================================
  app.post('/desprendible-firma/generar', async (
    request: FastifyRequest<{ Body: { liquidacion_ids: string[], expires_days?: number } }>,
    reply: FastifyReply
  ) => {
    try {
      const { liquidacion_ids, expires_days = 365 } = request.body as any

      if (!liquidacion_ids || !Array.isArray(liquidacion_ids) || liquidacion_ids.length === 0) {
        return reply.status(400).send({ success: false, message: 'Debe proporcionar al menos un ID de liquidación.' })
      }

      const results: any[] = []

      for (const liquidacion_id of liquidacion_ids) {
        // Obtener liquidación para saber el conductor
        const liq = await prisma.liquidaciones.findUnique({
          where: { id: liquidacion_id },
          select: { id: true, conductor_id: true }
        })

        if (!liq || !liq.conductor_id) {
          results.push({ liquidacion_id, error: 'Liquidación no encontrada o sin conductor' })
          continue
        }

        // Verificar si ya existe un registro para esta combinación
        const existente = await prisma.firmas_desprendibles.findUnique({
          where: {
            liquidacion_id_conductor_id: {
              liquidacion_id: liq.id,
              conductor_id: liq.conductor_id
            }
          }
        })

        const token = randomBytes(32).toString('hex') // 64 chars hex
        const expires_at = new Date()
        expires_at.setDate(expires_at.getDate() + expires_days)
        const now = new Date()

        if (existente) {
          // Actualizar con nuevo token
          await prisma.firmas_desprendibles.update({
            where: { id: existente.id },
            data: {
              token,
              expires_at,
              // Si ya estaba firmado, resetear para que pueda firmar de nuevo
              firma_url: existente.firma_url && existente.firma_url !== 'pending' ? existente.firma_url : 'pending',
              updated_at: now
            }
          })
          results.push({
            liquidacion_id,
            conductor_id: liq.conductor_id,
            token,
            expires_at,
            updated: true
          })
        } else {
          // Crear nuevo registro
          await prisma.firmas_desprendibles.create({
            data: {
              id: randomUUID(),
              liquidacion_id: liq.id,
              conductor_id: liq.conductor_id,
              firma_url: 'pending',
              firma_s3_key: '',
              fecha_firma: now,
              token,
              expires_at,
              created_at: now,
              updated_at: now
            }
          })
          results.push({
            liquidacion_id,
            conductor_id: liq.conductor_id,
            token,
            expires_at,
            created: true
          })
        }
      }

      return reply.send({ success: true, data: results })
    } catch (error: any) {
      request.log.error({ error }, 'Error generando tokens de desprendible')
      return reply.status(500).send({ success: false, message: error.message || 'Error al generar tokens' })
    }
  })
}

export default desprendibleFirmaRoutes
