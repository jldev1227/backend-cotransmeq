/**
 * Extractos de contrato (FUEC). Permiso `extractos`: leer para consultar e
 * imprimir, `full` para emitir, anular y tocar los catálogos.
 */
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { authMiddleware } from '../../middlewares/auth.middleware'
import { requirePermission } from '../../middlewares/permissions.middleware'
import {
  ExtractosError,
  TIPOS_CATALOGO,
  aniosDisponibles,
  anularExtracto,
  eliminarCatalogo,
  eliminarContratante,
  emitirExtracto,
  guardarContratante,
  listarCatalogo,
  listarContratantes,
  listarExtractos,
  obtenerExtracto,
  opcionesFormulario,
  type ContratanteInput,
  type EmitirInput,
  type TipoCatalogo,
} from './extractos.service'

type ConId = FastifyRequest<{ Params: { id: string } }>

function responderError(request: FastifyRequest, reply: FastifyReply, err: unknown, mensaje: string) {
  if (err instanceof ExtractosError) return reply.status(err.status).send({ success: false, message: err.message, code: err.code })
  if (err instanceof z.ZodError) return reply.status(400).send({ success: false, message: err.errors[0]?.message ?? 'Datos no válidos', code: 'VALIDACION' })
  request.log.error({ err }, `[extractos] ${mensaje}`)
  return reply.status(500).send({ success: false, message: mensaje })
}

const usuarioId = (request: FastifyRequest) => (request as any).user?.id as string

const texto = (max: number) => z.string().trim().max(max)
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha YYYY-MM-DD')

const responsableSchema = z
  .object({
    nombre: texto(255).nullish(),
    cedula: texto(50).nullish(),
    telefono: texto(50).nullish(),
    direccion: texto(255).nullish(),
  })
  .nullish()

const contratanteSchema = z.object({
  id: z.string().uuid().nullish(),
  nombre: texto(255).min(2, 'Falta el nombre del contratante'),
  nit: texto(50).nullish(),
  numero_contrato: texto(40).nullish(),
  cliente_id: z.string().uuid().nullish(),
  responsable: responsableSchema,
})

const emitirSchema = z.object({
  contratante: contratanteSchema,
  contrato_numero: texto(40).nullish(),
  objeto_contrato: texto(2000).min(3, 'Falta el objeto del contrato'),
  origen_destino: texto(500).min(3, 'Falta el origen-destino'),
  convenio: texto(255).nullish(),
  vigencia_desde: fecha,
  vigencia_hasta: fecha,
  vehiculo: z.object({
    id: z.string().uuid().nullish(),
    placa: texto(20).min(5, 'Falta la placa'),
    modelo: texto(20).nullish(),
    marca: texto(100).nullish(),
    clase: texto(100).nullish(),
    numero_interno: texto(20).nullish(),
    tarjeta_operacion: texto(60).nullish(),
  }),
  conductores: z
    .array(
      z.object({
        id: z.string().uuid().nullish(),
        nombre: texto(255).min(3, 'Falta el nombre del conductor'),
        cedula: texto(50).nullish(),
        licencia_vigencia: fecha.nullish(),
      })
    )
    .min(1, 'El extracto necesita al menos un conductor')
    .max(3, 'Máximo tres conductores'),
  reemplaza_a_id: z.string().uuid().nullish(),
  actualizar_fichas: z.boolean().optional(),
})

const listarSchema = z.object({
  q: z.string().optional(),
  placa: z.string().optional(),
  contratante_id: z.string().uuid().optional(),
  estado: z.enum(['todos', 'vigentes', 'por_vencer', 'vencidos', 'anulados']).optional(),
  anio: z.coerce.number().int().min(2000).max(2100).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})

export async function extractosRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authMiddleware)
  const puedeLeer = { preHandler: requirePermission('extractos', 'read') }
  const puedeEscribir = { preHandler: requirePermission('extractos', 'full') }

  app.get('/extractos', puedeLeer, async (request, reply) => {
    try {
      return reply.send({ success: true, ...(await listarExtractos(listarSchema.parse(request.query))) })
    } catch (err) {
      return responderError(request, reply, err, 'No se pudieron listar los extractos')
    }
  })

  app.get('/extractos/anios', puedeLeer, async (request, reply) => {
    try {
      return reply.send({ success: true, data: await aniosDisponibles() })
    } catch (err) {
      return responderError(request, reply, err, 'No se pudieron leer los años')
    }
  })

  /// Todo lo que el formulario de «nuevo extracto» necesita, en una sola llamada.
  app.get('/extractos/opciones', puedeLeer, async (request, reply) => {
    try {
      return reply.send({ success: true, data: await opcionesFormulario() })
    } catch (err) {
      return responderError(request, reply, err, 'No se pudieron cargar las opciones')
    }
  })

  app.get('/extractos/contratantes', puedeLeer, async (request, reply) => {
    try {
      const { q } = request.query as { q?: string }
      return reply.send({ success: true, data: await listarContratantes(q) })
    } catch (err) {
      return responderError(request, reply, err, 'No se pudieron listar los contratantes')
    }
  })

  app.post('/extractos/contratantes', puedeEscribir, async (request, reply) => {
    try {
      return reply.status(201).send({ success: true, data: await guardarContratante(null, contratanteSchema.parse(request.body) as ContratanteInput) })
    } catch (err) {
      return responderError(request, reply, err, 'No se pudo crear el contratante')
    }
  })

  app.put('/extractos/contratantes/:id', puedeEscribir, async (request: ConId, reply) => {
    try {
      return reply.send({ success: true, data: await guardarContratante(request.params.id, contratanteSchema.parse(request.body) as ContratanteInput) })
    } catch (err) {
      return responderError(request, reply, err, 'No se pudo guardar el contratante')
    }
  })

  app.delete('/extractos/contratantes/:id', puedeEscribir, async (request: ConId, reply) => {
    try {
      await eliminarContratante(request.params.id)
      return reply.send({ success: true })
    } catch (err) {
      return responderError(request, reply, err, 'No se pudo eliminar el contratante')
    }
  })

  app.get('/extractos/catalogo', puedeLeer, async (request, reply) => {
    try {
      const { tipo } = request.query as { tipo?: string }
      if (!TIPOS_CATALOGO.includes(tipo as TipoCatalogo)) throw new ExtractosError('tipo debe ser OBJETO, CONVENIO u ORIGEN_DESTINO')
      return reply.send({ success: true, data: await listarCatalogo(tipo as TipoCatalogo) })
    } catch (err) {
      return responderError(request, reply, err, 'No se pudo leer el catálogo')
    }
  })

  app.delete('/extractos/catalogo/:id', puedeEscribir, async (request: ConId, reply) => {
    try {
      await eliminarCatalogo(request.params.id)
      return reply.send({ success: true })
    } catch (err) {
      return responderError(request, reply, err, 'No se pudo eliminar la entrada')
    }
  })

  app.get('/extractos/:id', puedeLeer, async (request: ConId, reply) => {
    try {
      return reply.send({ success: true, data: await obtenerExtracto(request.params.id) })
    } catch (err) {
      return responderError(request, reply, err, 'No se pudo leer el extracto')
    }
  })

  /// Emite (y firma) un extracto. Con `reemplaza_a_id`, el anterior queda anulado.
  app.post('/extractos', puedeEscribir, async (request, reply) => {
    try {
      return reply.status(201).send({ success: true, data: await emitirExtracto(usuarioId(request), emitirSchema.parse(request.body) as EmitirInput) })
    } catch (err) {
      return responderError(request, reply, err, 'No se pudo emitir el extracto')
    }
  })

  app.post('/extractos/:id/anular', puedeEscribir, async (request: ConId, reply) => {
    try {
      const { motivo } = z.object({ motivo: z.string() }).parse(request.body)
      return reply.send({ success: true, data: await anularExtracto(usuarioId(request), request.params.id, motivo) })
    } catch (err) {
      return responderError(request, reply, err, 'No se pudo anular el extracto')
    }
  })
}
