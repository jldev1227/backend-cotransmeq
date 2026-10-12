/**
 * Rutas del pago de cierres finales de terceros.
 *
 * Prefijo propio (`/liquidaciones-terceros-pagos`) para no mezclarse con las
 * rutas `/liquidaciones-terceros/:id/...` del módulo de descuentos. Leer pide
 * `liquidaciones-terceros` en `limited` (facturación y contabilidad
 * consultan; `read` las dejaría fuera porque `limited` va por debajo).
 * Subir un comprobante o completar un pago pide `full` y, como marcar
 * PAGADA, ser de Administración.
 *
 * El paso a PAGADA en sí NO está aquí: va por el cambio de estado de siempre
 * (`PATCH /liquidaciones-terceros/:id/estado` y el lote), que ahora exige el
 * objeto `pago`.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { authMiddleware } from '../../middlewares/auth.middleware'
import { requirePermission } from '../../middlewares/permissions.middleware'
import { hoyColombia, MAX_BYTES_COMPROBANTE, TIPOS_COMPROBANTE } from '../../lib/pagos/medios'
import { esAdmin } from '../liquidaciones-terceros-descuentos/cierre-estado.service'
import { ErrorPagoCierre, LiquidacionesTercerosPagosService } from './liquidaciones-terceros-pagos.service'
import { validarPagoCierre } from './pago-cierre'

const MODULO = 'liquidaciones-terceros'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function responderError(request: FastifyRequest, reply: FastifyReply, err: any, mensaje: string) {
  if (err instanceof ErrorPagoCierre) {
    return reply.status(err.statusCode).send({ success: false, message: err.message })
  }
  request.log.error({ err }, `[pagos-terceros] ${mensaje}`)
  return reply.status(500).send({ success: false, message: mensaje })
}

/// Mismo criterio que la entrada a PAGADA en `CierreEstadoService`.
function exigirAdministracion(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).user
  if (esAdmin({ id: user?.id ?? null, areas: user?.area ?? null })) return true
  reply.status(403).send({ success: false, message: 'Solo Administración registra pagos de cierres.' })
  return false
}

export async function liquidacionesTercerosPagosRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authMiddleware)
  app.addHook('preValidation', async (request, reply) => {
    const { cierreId, pagoId } = (request.params ?? {}) as { cierreId?: string; pagoId?: string }
    if ((cierreId !== undefined && !UUID.test(cierreId)) || (pagoId !== undefined && !UUID.test(pagoId))) {
      return reply.status(400).send({ success: false, message: 'Identificador inválido' })
    }
  })
  const leer = { preHandler: requirePermission(MODULO, 'limited') }
  const escribir = { preHandler: requirePermission(MODULO, 'full') }

  /// multipart con el archivo `comprobante`. Devuelve `{ s3_key, nombre }`.
  app.post('/liquidaciones-terceros-pagos/comprobante', escribir, async (request, reply) => {
    if (!exigirAdministracion(request, reply)) return reply
    try {
      let archivo: { buffer: Buffer; nombre: string; mimetype: string } | undefined
      for await (const parte of (request as any).parts()) {
        if (parte.type !== 'file') continue
        if (!TIPOS_COMPROBANTE.test(parte.mimetype)) {
          return reply.status(400).send({ success: false, message: 'El comprobante debe ser PDF o imagen' })
        }
        const buffer: Buffer = await parte.toBuffer()
        if (buffer.length > MAX_BYTES_COMPROBANTE) {
          return reply.status(413).send({ success: false, message: 'El comprobante supera 10 MB' })
        }
        archivo = { buffer, nombre: parte.filename || 'comprobante', mimetype: parte.mimetype }
      }
      if (!archivo?.buffer.length) return reply.status(400).send({ success: false, message: 'Falta el archivo' })
      const data = await LiquidacionesTercerosPagosService.subirComprobante(archivo, hoyColombia())
      return reply.status(201).send({ success: true, data })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible subir el comprobante')
    }
  })

  app.get(
    '/liquidaciones-terceros-pagos/periodo',
    leer,
    async (request: FastifyRequest<{ Querystring: { anio?: string; mes?: string } }>, reply) => {
      const anio = Number(request.query.anio)
      const mes = Number(request.query.mes)
      if (!Number.isInteger(anio) || anio < 2000 || !Number.isInteger(mes) || mes < 1 || mes > 12) {
        return reply.status(400).send({ success: false, message: 'Periodo inválido' })
      }
      try {
        return reply.send({ success: true, data: await LiquidacionesTercerosPagosService.porPeriodo(anio, mes) })
      } catch (err) {
        return responderError(request, reply, err, 'No fue posible leer los pagos del periodo')
      }
    },
  )

  app.get('/liquidaciones-terceros-pagos/:cierreId', leer, async (request: FastifyRequest<{ Params: { cierreId: string } }>, reply) => {
    try {
      return reply.send({ success: true, data: await LiquidacionesTercerosPagosService.obtener(request.params.cierreId) })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible leer el pago')
    }
  })

  /// Completa (PAGADA «sin registro») o corrige el pago de un cierre ya pagado.
  app.put('/liquidaciones-terceros-pagos/:cierreId', escribir, async (request: FastifyRequest<{ Params: { cierreId: string } }>, reply) => {
    if (!exigirAdministracion(request, reply)) return reply
    const v = validarPagoCierre(request.body)
    if (!v.pago) return reply.status(400).send({ success: false, message: v.motivo })
    try {
      const data = await LiquidacionesTercerosPagosService.completar(
        request.params.cierreId,
        v.pago,
        (request as any).user?.id ?? null,
      )
      return reply.send({ success: true, data })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible guardar el pago')
    }
  })

  app.get(
    '/liquidaciones-terceros-pagos/comprobante/:pagoId',
    leer,
    async (request: FastifyRequest<{ Params: { pagoId: string } }>, reply) => {
      try {
        return reply.send({ success: true, data: { url: await LiquidacionesTercerosPagosService.urlComprobante(request.params.pagoId) } })
      } catch (err) {
        return responderError(request, reply, err, 'No fue posible abrir el comprobante')
      }
    },
  )
}
