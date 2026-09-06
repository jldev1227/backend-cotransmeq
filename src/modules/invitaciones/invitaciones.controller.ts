import { FastifyRequest, FastifyReply } from 'fastify'
import { InvitacionesService, InvitacionError } from './invitaciones.service'
import { crearInvitacionSchema, aceptarInvitacionSchema } from './invitaciones.schema'
import { EmailService } from '../../services/email.service'

/**
 * Mapa de códigos de negocio a HTTP.
 *
 * Ninguno de estos casos es un fallo del servidor: son condiciones normales
 * que el frontend sabe pintar. Sin este mapa todos salían como 500 y la
 * pantalla mostraba «Internal server error».
 */
const ESTADO_POR_CODIGO: Record<InvitacionError['codigo'], number> = {
  CORREO_YA_REGISTRADO: 409,
  CORREO_DUPLICADO: 409,
  TOKEN_INVALIDO: 410,
}

/**
 * Traduce cualquier error a una respuesta con significado.
 *
 * @returns `true` si ya respondió, `false` si el error no era de negocio y hay
 *          que dejarlo escalar al log.
 */
function responderError(error: any, reply: FastifyReply): boolean {
  if (error instanceof InvitacionError) {
    reply.status(ESTADO_POR_CODIGO[error.codigo]).send({ error: error.message })
    return true
  }

  // Zod: los datos no encajan con el esquema.
  if (error?.issues) {
    reply.status(400).send({
      error: 'Datos inválidos',
      details: error.issues,
    })
    return true
  }

  // Índice único de `correo`: la carrera que el chequeo previo no alcanza.
  if (error?.code === 'P2002') {
    reply.status(409).send({ error: 'Ya existe una cuenta registrada con ese correo.' })
    return true
  }

  return false
}

export const InvitacionesController = {

  async crear(request: FastifyRequest, reply: FastifyReply) {
    try {
      const emisor = (request as any).user
      const data = crearInvitacionSchema.parse(request.body)

      const inv = await InvitacionesService.crear({
        correo: data.correo,
        area: data.area,
        cargo: data.cargo,
        invitadoPorId: emisor.id,
      })

      // El correo se manda después de crear la fila, y su fallo NO tumba la
      // invitación: ya existe en base y el administrador puede reenviarla. Lo
      // que sí hace es avisar, para que nadie se quede esperando un correo que
      // nunca salió.
      let correoEnviado = true
      try {
        await EmailService.sendInvitacionEmail({
          to: inv.correo,
          invitadoPorNombre: inv.invitado_por.nombre,
          area: inv.area as string[],
          token: inv.token,
        })
      } catch (err: any) {
        correoEnviado = false
        request.log.error({ err }, 'No se pudo enviar el correo de invitación')
      }

      return reply.status(201).send({ success: true, correoEnviado, invitacion: inv })
    } catch (err: any) {
      if (responderError(err, reply)) return
      request.log.error({ err }, 'Error creando invitación')
      return reply.status(500).send({ error: 'No se pudo crear la invitación.' })
    }
  },

  async listar(_request: FastifyRequest, reply: FastifyReply) {
    const invitaciones = await InvitacionesService.listar()
    reply.send(invitaciones)
  },

  async validarToken(request: FastifyRequest, reply: FastifyReply) {
    const { token } = request.params as { token: string }
    try {
      const inv = await InvitacionesService.validarToken(token)
      if (!inv) {
        return reply.status(404).send({ error: 'Invitación inválida o expirada.' })
      }
      return reply.send({
        correo: inv.correo,
        area: inv.area,
        cargo: inv.cargo,
        invitadoPorNombre: inv.invitado_por.nombre,
      })
    } catch (err: any) {
      request.log.error({ err }, 'Error validando invitación')
      return reply.status(500).send({ error: 'No se pudo validar la invitación.' })
    }
  },

  async aceptar(request: FastifyRequest, reply: FastifyReply) {
    try {
      const data = aceptarInvitacionSchema.parse(request.body) as {
        token: string
        nombre: string
        password: string
        telefono?: string
      }
      const usuario = await InvitacionesService.aceptar(data)
      return reply.status(201).send({ success: true, usuario })
    } catch (err: any) {
      if (responderError(err, reply)) return
      request.log.error({ err }, 'Error aceptando invitación')
      return reply.status(500).send({ error: 'No se pudo completar el registro.' })
    }
  },

  async revocar(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string }
      await InvitacionesService.revocar(id)
      return reply.send({ success: true })
    } catch (err: any) {
      if (err?.code === 'P2025') {
        return reply.status(404).send({ error: 'La invitación ya no existe.' })
      }
      request.log.error({ err }, 'Error revocando invitación')
      return reply.status(500).send({ error: 'No se pudo revocar la invitación.' })
    }
  },
}
