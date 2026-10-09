/**
 * Rutas del panel para viáticos. Leer exige `read` sobre `viaticos`; crear,
 * editar, anular y resolver solicitudes, `full` (administración y operaciones).
 * La lógica vive en `viaticos.service.ts`.
 */

import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import { authMiddleware } from '../../middlewares/auth.middleware'
import { requirePermission } from '../../middlewares/permissions.middleware'
import { leerComprobante } from './viaticos-comprobante.service'
import { ajustarSaldo, crearTerceroDePlaca, cerrarCorte, consolidadoFondo, editarMovimiento, estadoFondo, registrarRecarga, terceroDePlaca } from './viaticos-fondo.service'
import { actualizarGastoEmpresa, crearGastoEmpresa, listarGastosEmpresa, resumenViaticos, retirarGastoEmpresa } from './viaticos-empresa.service'
import {
  actualizarAnticipo,
  anularGasto,
  crearAnticipo,
  detalleAnticipo,
  detalleSolicitud,
  firmarSubidaComprobante,
  listarAnticipos,
  listarSolicitudes,
  parsear,
  rechazarSolicitud,
  retirarAnticipo,
  ViaticosError
} from './viaticos.service'
import { z } from 'zod'

type ConId = FastifyRequest<{ Params: { id: string } }>

function responderError(request: FastifyRequest, reply: FastifyReply, err: unknown, mensaje: string) {
  if (err instanceof ViaticosError) {
    return reply.status(err.status).send({ success: false, message: err.message, code: err.code })
  }
  request.log.error({ err }, `[viaticos] ${mensaje}`)
  return reply.status(500).send({ success: false, message: mensaje })
}

const usuarioId = (request: FastifyRequest) => (request as any).user?.id as string

const leerSchema = z.object({
  key: z.string().min(1).max(300),
  mime_type: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
})

export async function viaticosRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authMiddleware)
  const puedeLeer = { preHandler: requirePermission('viaticos', 'read') }
  const puedeEscribir = { preHandler: requirePermission('viaticos', 'full') }

  app.get('/viaticos/anticipos', puedeLeer, async (request, reply) => {
    try {
      return reply.send({ success: true, ...(await listarAnticipos(request.query)) })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible listar los anticipos')
    }
  })

  app.get('/viaticos/anticipos/:id', puedeLeer, async (request: ConId, reply) => {
    try {
      return reply.send({ success: true, data: await detalleAnticipo(request.params.id) })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible cargar el anticipo')
    }
  })

  app.post('/viaticos/anticipos', puedeEscribir, async (request, reply) => {
    try {
      return reply.status(201).send({ success: true, data: await crearAnticipo(usuarioId(request), request.body) })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible registrar el anticipo')
    }
  })

  app.put('/viaticos/anticipos/:id', puedeEscribir, async (request: ConId, reply) => {
    try {
      return reply.send({ success: true, data: await actualizarAnticipo(usuarioId(request), request.params.id, request.body) })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible actualizar el anticipo')
    }
  })

  app.delete('/viaticos/anticipos/:id', puedeEscribir, async (request: ConId, reply) => {
    try {
      return reply.send({ success: true, data: await retirarAnticipo(usuarioId(request), request.params.id) })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible eliminar el anticipo')
    }
  })

  app.post('/viaticos/comprobantes/presign', puedeEscribir, async (request, reply) => {
    try {
      return reply.send({ success: true, data: await firmarSubidaComprobante(usuarioId(request), request.body) })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible preparar la subida del comprobante')
    }
  })

  app.post('/viaticos/comprobantes/leer', puedeEscribir, async (request, reply) => {
    try {
      const input = parsear(leerSchema, request.body)
      if (!input.key.startsWith('viaticos/comprobantes/') || input.key.includes('..')) {
        throw new ViaticosError('El comprobante no es válido.', 400, 'COMPROBANTE_INVALIDO')
      }
      return reply.send({ success: true, data: await leerComprobante(input.key, input.mime_type) })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible leer el comprobante')
    }
  })

  app.post('/viaticos/gastos/:id/anular', puedeEscribir, async (request: ConId, reply) => {
    try {
      return reply.send({ success: true, data: await anularGasto(usuarioId(request), request.params.id, request.body) })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible anular el gasto')
    }
  })

  app.get('/viaticos/solicitudes', puedeLeer, async (request, reply) => {
    try {
      return reply.send({ success: true, data: await listarSolicitudes(request.query) })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible listar las solicitudes')
    }
  })

  app.get('/viaticos/solicitudes/:id', puedeLeer, async (request: ConId, reply) => {
    try {
      return reply.send({ success: true, data: await detalleSolicitud(request.params.id) })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible cargar la solicitud')
    }
  })

  app.post('/viaticos/solicitudes/:id/rechazar', puedeEscribir, async (request: ConId, reply) => {
    try {
      return reply.send({ success: true, data: await rechazarSolicitud(usuarioId(request), request.params.id, request.body) })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible rechazar la solicitud')
    }
  })

  // ── Fondo de anticipos del área de operaciones (ver viaticos-fondo.service.ts) ──

  app.get('/viaticos/fondo', puedeLeer, async (request, reply) => {
    try {
      return reply.send({ success: true, data: await estadoFondo(usuarioId(request)) })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible consultar el saldo para anticipos')
    }
  })

  app.get('/viaticos/fondo/consolidado', puedeLeer, async (request, reply) => {
    try {
      const q = request.query as { desde?: unknown; hasta?: unknown }
      return reply.send({ success: true, data: await consolidadoFondo(q.desde, q.hasta) })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible armar el consolidado del saldo')
    }
  })

  app.post('/viaticos/fondo/recargas', puedeEscribir, async (request, reply) => {
    try {
      return reply.status(201).send({ success: true, data: await registrarRecarga(usuarioId(request), request.body) })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible registrar el saldo')
    }
  })

  app.post('/viaticos/fondo/ajustes', puedeEscribir, async (request, reply) => {
    try {
      return reply.status(201).send({ success: true, data: await ajustarSaldo(usuarioId(request), request.body) })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible corregir el saldo')
    }
  })

  app.post('/viaticos/fondo/cierres', puedeEscribir, async (request, reply) => {
    try {
      return reply.status(201).send({ success: true, data: await cerrarCorte(usuarioId(request), request.body ?? {}) })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible cerrar el corte')
    }
  })

  app.patch('/viaticos/fondo/movimientos/:id', puedeEscribir, async (request: ConId, reply) => {
    try {
      return reply.send({ success: true, data: await editarMovimiento(usuarioId(request), request.params.id, request.body) })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible editar el movimiento')
    }
  })

  // ── Tercero (propietario) de una placa ──

  app.get('/viaticos/vehiculos/:id/tercero', puedeLeer, async (request: ConId, reply) => {
    try {
      return reply.send({ success: true, data: await terceroDePlaca(request.params.id) })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible consultar el propietario de la placa')
    }
  })

  app.post('/viaticos/vehiculos/:id/tercero', puedeEscribir, async (request: ConId, reply) => {
    try {
      return reply.status(201).send({ success: true, data: await crearTerceroDePlaca(request.params.id, request.body) })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible crear el tercero')
    }
  })

  // ── Tablero y gastos que asume la empresa (ver viaticos-empresa.service.ts) ──

  app.get('/viaticos/resumen', puedeLeer, async (request, reply) => {
    try {
      return reply.send({ success: true, data: await resumenViaticos(request.query) })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible calcular el resumen de viáticos')
    }
  })

  app.get('/viaticos/gastos-empresa', puedeLeer, async (request, reply) => {
    try {
      return reply.send({ success: true, ...(await listarGastosEmpresa(request.query)) })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible listar los gastos de la empresa')
    }
  })

  app.post('/viaticos/gastos-empresa', puedeEscribir, async (request, reply) => {
    try {
      return reply.status(201).send({ success: true, data: await crearGastoEmpresa(usuarioId(request), request.body) })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible registrar el gasto')
    }
  })

  app.put('/viaticos/gastos-empresa/:id', puedeEscribir, async (request: ConId, reply) => {
    try {
      return reply.send({ success: true, data: await actualizarGastoEmpresa(usuarioId(request), request.params.id, request.body) })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible actualizar el gasto')
    }
  })

  app.delete('/viaticos/gastos-empresa/:id', puedeEscribir, async (request: ConId, reply) => {
    try {
      return reply.send({ success: true, data: await retirarGastoEmpresa(usuarioId(request), request.params.id) })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible eliminar el gasto')
    }
  })
}
