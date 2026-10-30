import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { authMiddleware } from '../../middlewares/auth.middleware'
import { requireAdmin, requirePermission } from '../../middlewares/permissions.middleware'
import { actualizarProgramacionCronSimit } from '../../jobs/consultar-simit.cron'
import {
  guardarProgramacionSimit,
  historialSimit,
  iniciarConsultaIndividualSimit,
  iniciarConsultaSimitAhora,
  leerProgramacionSimit,
  obtenerEjecucionSimit,
} from './simit.service'
import { z } from 'zod'

const programacionSchema = z.object({
  cadaHoras: z.number().int().refine((valor) => [1, 2, 3, 4, 6, 8, 12, 24].includes(valor)),
  horaInicio: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
})
const idFichaSchema = z.string().uuid()

export async function simitRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authMiddleware)

  app.get('/simit/programacion', {
    preHandler: requirePermission('flota'),
  }, async (_request, reply) => {
    return reply.send({ success: true, data: await leerProgramacionSimit() })
  })

  app.post('/simit/vehiculos/:id/consultar', {
    preHandler: requirePermission('flota', 'full'),
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsedId = idFichaSchema.safeParse((request.params as { id: string }).id)
    if (!parsedId.success) return reply.status(400).send({ success: false, message: 'El identificador del vehículo no es válido.' })
    const consulta = await iniciarConsultaIndividualSimit('vehiculo', parsedId.data)
    if (!consulta) return reply.status(404).send({ success: false, message: 'Vehículo no encontrado.' })
    void consulta.promesa.catch(() => undefined)
    return reply.status(consulta.yaEstabaEnCurso ? 200 : 202).send({
      success: true,
      data: {
        consulta_id: consulta.consulta_id,
        estado_consulta: consulta.estado_consulta,
        yaEstabaEnCurso: consulta.yaEstabaEnCurso,
      },
    })
  })

  app.post('/simit/conductores/:id/consultar', {
    preHandler: requirePermission('conductores', 'full'),
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsedId = idFichaSchema.safeParse((request.params as { id: string }).id)
    if (!parsedId.success) return reply.status(400).send({ success: false, message: 'El identificador del conductor no es válido.' })
    const consulta = await iniciarConsultaIndividualSimit('conductor', parsedId.data)
    if (!consulta) return reply.status(404).send({ success: false, message: 'Conductor no encontrado.' })
    void consulta.promesa.catch(() => undefined)
    return reply.status(consulta.yaEstabaEnCurso ? 200 : 202).send({
      success: true,
      data: {
        consulta_id: consulta.consulta_id,
        estado_consulta: consulta.estado_consulta,
        yaEstabaEnCurso: consulta.yaEstabaEnCurso,
      },
    })
  })

  app.put('/simit/programacion', {
    preHandler: requireAdmin,
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = programacionSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ success: false, message: 'Elige una frecuencia y hora válidas.' })
    }
    const user = (request as any).user
    const programacion = await guardarProgramacionSimit(parsed.data as { cadaHoras: number; horaInicio: string }, user?.id ?? user?.sub)
    actualizarProgramacionCronSimit(programacion)
    return reply.send({ success: true, data: programacion })
  })

  app.post('/simit/ejecutar-ahora', {
    preHandler: requireAdmin,
  }, async (_request, reply) => {
    const ejecucion = iniciarConsultaSimitAhora()
    /// El lote puede tardar más que el timeout HTTP; se procesa en segundo plano y la pantalla consulta su estado.
    void ejecucion.promesa.catch(() => undefined)
    return reply.status(ejecucion.yaEstabaEnCurso ? 200 : 202).send({
      success: true,
      data: { ejecucion: ejecucion.estado, yaEstabaEnCurso: ejecucion.yaEstabaEnCurso },
    })
  })

  app.get('/simit/ejecuciones/:id', {
    preHandler: requireAdmin,
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string }
    const ejecucion = obtenerEjecucionSimit(id)
    if (!ejecucion) return reply.status(404).send({ success: false, message: 'Ejecución SIMIT no encontrada.' })
    return reply.send({ success: true, data: ejecucion })
  })

  app.get('/simit/vehiculos/:id', {
    preHandler: requirePermission('flota'),
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsedId = idFichaSchema.safeParse((request.params as { id: string }).id)
    if (!parsedId.success) return reply.status(400).send({ success: false, message: 'El identificador del vehículo no es válido.' })
    const id = parsedId.data
    const data = await historialSimit('vehiculo', id)
    if (!data) return reply.status(404).send({ success: false, message: 'Vehículo no encontrado.' })
    return reply.send({ success: true, data })
  })

  app.get('/simit/conductores/:id', {
    preHandler: requirePermission('conductores'),
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsedId = idFichaSchema.safeParse((request.params as { id: string }).id)
    if (!parsedId.success) return reply.status(400).send({ success: false, message: 'El identificador del conductor no es válido.' })
    const id = parsedId.data
    const data = await historialSimit('conductor', id)
    if (!data) return reply.status(404).send({ success: false, message: 'Conductor no encontrado.' })
    return reply.send({ success: true, data })
  })
}
