/**
 * Rutas de cartera (cuentas por cobrar).
 *
 * Módulo propio y no dentro de `facturacion-liquidaciones` a propósito: esas
 * rutas piden `liquidaciones-servicios`, y contabilidad, que es quien cobra,
 * tiene `cartera` pero no ese módulo. Leer pide `cartera` en `read`;
 * registrar o retirar abonos y corregir condiciones, en `full`.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { ZodError } from 'zod'
import { authMiddleware } from '../../middlewares/auth.middleware'
import { requirePermission } from '../../middlewares/permissions.middleware'
import { MAX_BYTES_COMPROBANTE, TIPOS_COMPROBANTE } from '../../lib/pagos/medios'
import { emitFacturacionLiquidacion, eventoMeta } from '../../sockets'
import { EVENTOS_FACTURACION_LIQUIDACIONES } from '../facturacion-liquidaciones/facturacion-liquidaciones.events'
import { FacturacionLiquidacionesService } from '../facturacion-liquidaciones/facturacion-liquidaciones.service'
import { ErrorCartera } from './cartera.condiciones'
import {
  condicionesSchema,
  eliminarAbonoSchema,
  filtrosFacturasSchema,
  registrarAbonoSchema,
  UUID,
} from './cartera.schema'
import { CarteraService } from './cartera.service'

export function responderErrorCartera(request: FastifyRequest, reply: FastifyReply, err: unknown, mensaje: string) {
  if (err instanceof ZodError) {
    const detalle = err.errors.map((e) => `${e.path.join('.') || 'campo'}: ${e.message}`)
    return reply.status(400).send({ success: false, message: err.errors[0]?.message ?? 'Datos inválidos', details: detalle })
  }
  if (err instanceof ErrorCartera) {
    return reply.status(err.statusCode).send({ success: false, message: err.message, code: err.code })
  }
  request.log.error({ err }, `[cartera] ${mensaje}`)
  return reply.status(500).send({ success: false, message: mensaje })
}

type Usuario = { id?: string; nombre?: string; name?: string }
const usuarioDe = (request: FastifyRequest) => ((request as any).user ?? {}) as Usuario

/**
 * Avisa a las pantallas de facturas (pestaña Facturas y canvas de historial)
 * de que cambió el saldo o las condiciones. Va con la factura COMPLETA: el
 * canvas fusiona el payload en su panel y una forma parcial deja huecos.
 */
async function avisarFacturaActualizada(request: FastifyRequest, facturaId: string) {
  try {
    const factura = await FacturacionLiquidacionesService.obtenerCompleta(facturaId)
    if (!factura) return
    const u = usuarioDe(request)
    emitFacturacionLiquidacion(
      EVENTOS_FACTURACION_LIQUIDACIONES.facturaActualizada,
      factura,
      eventoMeta({
        tipo: 'updated',
        scope: 'facturas',
        actor: { id: u.id ?? null, nombre: u.nombre ?? u.name ?? 'Usuario' },
        etiqueta: factura.numero_factura,
      }),
    )
  } catch (err) {
    /// El cambio ya quedó guardado: un fallo al avisar no debe convertirse en
    /// un error para quien lo hizo.
    request.log.warn({ err }, '[cartera] no se pudo emitir facturacion-updated')
  }
}

/** Lee un multipart con campos y un archivo opcional `comprobante`. */
async function leerMultipart(request: FastifyRequest, reply: FastifyReply) {
  const campos: Record<string, string> = {}
  let archivo: { buffer: Buffer; nombre: string; mimetype: string } | undefined
  for await (const parte of (request as any).parts()) {
    if (parte.type === 'file') {
      if (!TIPOS_COMPROBANTE.test(parte.mimetype)) {
        await parte.toBuffer().catch(() => undefined)
        reply.status(400).send({ success: false, message: 'El comprobante debe ser PDF o imagen' })
        return null
      }
      const buffer: Buffer = await parte.toBuffer()
      if (buffer.length > MAX_BYTES_COMPROBANTE) {
        reply.status(413).send({ success: false, message: 'El comprobante supera 10 MB' })
        return null
      }
      if (buffer.length) archivo = { buffer, nombre: parte.filename || 'comprobante', mimetype: parte.mimetype }
    } else {
      campos[parte.fieldname] = String(parte.value ?? '')
    }
  }
  return { campos, archivo }
}

export async function carteraRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authMiddleware)
  /// Un id mal formado llegaba hasta Prisma (`::uuid`) y salía como 500.
  app.addHook('preValidation', async (request, reply) => {
    const params = (request.params ?? {}) as Record<string, string | undefined>
    for (const clave of ['id', 'abonoId']) {
      const v = params[clave]
      if (v !== undefined && !UUID.test(v)) {
        return reply.status(400).send({ success: false, message: 'Identificador inválido' })
      }
    }
  })

  const leer = { preHandler: requirePermission('cartera', 'read') }
  const escribir = { preHandler: requirePermission('cartera', 'full') }

  app.get('/cartera/resumen', leer, async (request, reply) => {
    try {
      return reply.send({ success: true, data: await CarteraService.resumen() })
    } catch (err) {
      return responderErrorCartera(request, reply, err, 'No fue posible calcular la cartera')
    }
  })

  app.get('/cartera/facturas', leer, async (request, reply) => {
    try {
      const filtros = filtrosFacturasSchema.parse(request.query ?? {})
      return reply.send({ success: true, data: await CarteraService.listarFacturas(filtros) })
    } catch (err) {
      return responderErrorCartera(request, reply, err, 'No fue posible listar las facturas')
    }
  })

  app.get('/cartera/facturas/:id', leer, async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    try {
      return reply.send({ success: true, data: await CarteraService.detalle(request.params.id) })
    } catch (err) {
      return responderErrorCartera(request, reply, err, 'No fue posible abrir la factura')
    }
  })

  app.patch(
    '/cartera/facturas/:id/condiciones',
    escribir,
    async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
      try {
        const entrada = condicionesSchema.parse(request.body ?? {})
        const data = await CarteraService.actualizarCondiciones(request.params.id, entrada)
        void avisarFacturaActualizada(request, request.params.id)
        return reply.send({ success: true, data })
      } catch (err) {
        return responderErrorCartera(request, reply, err, 'No fue posible guardar las condiciones')
      }
    },
  )

  /// JSON, o multipart con los mismos campos y el archivo `comprobante`.
  app.post('/cartera/facturas/:id/abonos', escribir, async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    try {
      let cuerpo: unknown = request.body ?? {}
      let archivo: { buffer: Buffer; nombre: string; mimetype: string } | undefined
      if ((request as any).isMultipart?.()) {
        const leido = await leerMultipart(request, reply)
        if (!leido) return reply
        cuerpo = leido.campos
        archivo = leido.archivo
      }
      const input = registrarAbonoSchema.parse(cuerpo)
      const data = await CarteraService.registrarAbono(request.params.id, input, usuarioDe(request).id ?? null, archivo)
      void avisarFacturaActualizada(request, request.params.id)
      return reply.status(201).send({ success: true, data })
    } catch (err) {
      return responderErrorCartera(request, reply, err, 'No fue posible registrar el abono')
    }
  })

  app.delete('/cartera/abonos/:abonoId', escribir, async (request: FastifyRequest<{ Params: { abonoId: string } }>, reply) => {
    try {
      const { motivo } = eliminarAbonoSchema.parse(request.body ?? {})
      const data = await CarteraService.eliminarAbono(request.params.abonoId, usuarioDe(request).id ?? null, motivo)
      void avisarFacturaActualizada(request, data.factura.id)
      return reply.send({ success: true, data })
    } catch (err) {
      return responderErrorCartera(request, reply, err, 'No fue posible retirar el abono')
    }
  })

  app.get(
    '/cartera/abonos/:abonoId/comprobante',
    leer,
    async (request: FastifyRequest<{ Params: { abonoId: string } }>, reply) => {
      try {
        return reply.send({ success: true, data: { url: await CarteraService.urlComprobante(request.params.abonoId) } })
      } catch (err) {
        return responderErrorCartera(request, reply, err, 'No fue posible abrir el comprobante')
      }
    },
  )
}
