import { FastifyRequest, FastifyReply } from 'fastify'
import { InvitacionesService } from './invitaciones.service'
import { crearInvitacionSchema, aceptarInvitacionSchema } from './invitaciones.schema'
import { EmailService } from '../../services/email.service'

export const InvitacionesController = {

  async crear(request: FastifyRequest, reply: FastifyReply) {
    const emisor = (request as any).user
    const data = crearInvitacionSchema.parse(request.body)

    const inv = await InvitacionesService.crear({
      correo: data.correo,
      area: data.area,
      cargo: data.cargo,
      invitadoPorId: emisor.id,
    })

    await EmailService.sendInvitacionEmail({
      to: inv.correo,
      invitadoPorNombre: inv.invitado_por.nombre,
      area: inv.area as string[],
      token: inv.token,
    })

    reply.status(201).send({ success: true, invitacion: inv })
  },

  async listar(_request: FastifyRequest, reply: FastifyReply) {
    const invitaciones = await InvitacionesService.listar()
    reply.send(invitaciones)
  },

  async validarToken(request: FastifyRequest, reply: FastifyReply) {
    const { token } = request.params as { token: string }
    const inv = await InvitacionesService.validarToken(token)
    if (!inv) return reply.status(404).send({ error: 'Invitación inválida o expirada.' })
    reply.send({
      correo: inv.correo,
      area: inv.area,
      cargo: inv.cargo,
      invitadoPorNombre: inv.invitado_por.nombre,
    })
  },

  async aceptar(request: FastifyRequest, reply: FastifyReply) {
    const data = aceptarInvitacionSchema.parse(request.body) as { token: string; nombre: string; password: string; telefono?: string }
    const usuario = await InvitacionesService.aceptar(data)
    reply.status(201).send({ success: true, usuario })
  },

  async revocar(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as { id: string }
    await InvitacionesService.revocar(id)
    reply.send({ success: true })
  },
}
