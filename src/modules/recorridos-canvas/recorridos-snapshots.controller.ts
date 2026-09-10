import { FastifyReply, FastifyRequest } from 'fastify'
import { RecorridosSnapshotsService } from './recorridos-snapshots.service'

function periodo(request: FastifyRequest) {
  const q = request.query as Record<string, string | undefined>
  const anio = Number(q.anio)
  const mes = Number(q.mes)
  if (!Number.isInteger(anio) || anio < 2000 || anio > 2100) throw new Error('anio inválido')
  if (!Number.isInteger(mes) || mes < 1 || mes > 12) throw new Error('mes inválido')
  return { anio, mes }
}

export class RecorridosSnapshotsController {
  static async listar(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { anio, mes } = periodo(request)
      return reply.send(await RecorridosSnapshotsService.listar(anio, mes))
    } catch (e: any) {
      return reply.status(400).send({ error: e.message })
    }
  }

  static async capturar(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { anio, mes } = periodo(request)
      const usuarioId = (request as any).user?.id ?? null
      const snap = await RecorridosSnapshotsService.capturar({
        anio,
        mes,
        origen: 'manual',
        usuarioId,
      })
      // `null` no es error: es «no hacía falta capturar».
      if (!snap) return reply.send({ sinCambios: true })
      return reply.status(201).send(snap)
    } catch (e: any) {
      request.log.error({ err: e }, 'recorridos-snapshots: fallo capturando')
      return reply.status(400).send({ error: e.message })
    }
  }

  static async obtener(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as { id: string }
    const snap = await RecorridosSnapshotsService.obtener(id)
    if (!snap) return reply.status(404).send({ error: 'Snapshot no encontrado' })
    return reply.send(snap)
  }

  static async diff(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as { id: string }
    const { vs } = request.query as { vs?: string }
    try {
      return reply.send(await RecorridosSnapshotsService.diff(id, vs ?? null))
    } catch (e: any) {
      return reply.status(404).send({ error: e.message })
    }
  }

  static async revertir(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as { id: string }
    const user = (request as any).user
    try {
      const r = await RecorridosSnapshotsService.revertir({
        id,
        usuarioId: user?.id ?? null,
        actor: { id: user?.id ?? 'desconocido', name: user?.correo ?? 'desconocido' },
      })
      return reply.send(r)
    } catch (e: any) {
      request.log.error({ err: e }, 'recorridos-snapshots: fallo revirtiendo')
      const codigo = /no encontrad/i.test(e.message ?? '') ? 404 : 400
      return reply.status(codigo).send({ error: e.message })
    }
  }

  /**
   * Disparador del cron. Sin `authMiddleware`, protegido por secreto de
   * cabecera igual que los demás crons del proyecto.
   */
  static async cronHora(request: FastifyRequest, reply: FastifyReply) {
    if (request.headers['x-cron-secret'] !== process.env.CRON_SECRET) {
      return reply.status(403).send({ error: 'Prohibido' })
    }
    return reply.send(await RecorridosSnapshotsService.capturarHorario())
  }
}
