/**
 * Asistencias y evaluaciones de capacitación para los usuarios del dashboard, desde la app de
 * gestión. Mismo servicio que la app del conductor (`conductor-portal/capacitaciones.service.ts`):
 * cambia solo de dónde salen los datos de quien firma.
 *
 * - `GET  /mis-capacitaciones`: asistencias por firmar, evaluaciones por responder e historial.
 * - `GET|POST /mis-capacitaciones/asistencias/:token`: ver y firmar una asistencia.
 * - `GET|POST /mis-capacitaciones/evaluaciones/:id`: ver y responder una evaluación.
 *
 * Los usuarios no tenían cédula: si falta, el POST la recibe en `numero_documento`. Como firmas y
 * resultados se casan por cédula, una cédula ajena le abría el historial de otra persona; por eso
 * (ver `cedulaDeclarada`):
 * - solo se acepta si ninguna otra cuenta activa la tiene y no es la de un conductor que no sea
 *   esta persona (mismo correo);
 * - una vez guardada no se cambia desde aquí (el body se ignora): corregirla es cosa de un
 *   administrador;
 * - se escribe en el perfil DESPUÉS de firmar o responder, no antes: un POST que falla por otra
 *   razón (lista inactiva, firma vacía, respuestas inválidas) no deja la cédula puesta;
 * - aun así es autodeclarada: el servicio no devuelve la imagen de firma ni las respuestas de las
 *   filas que casan solo por cédula (`esPropia` en `capacitaciones.service.ts`).
 */

import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import { prisma } from '../../config/prisma'
import { authMiddleware } from '../../middlewares/auth.middleware'
import {
  CapacitacionesError,
  firmarAsistencia,
  listarCapacitaciones,
  obtenerAsistencia,
  obtenerEvaluacion,
  personaUsuario,
  responderEvaluacion,
  type Persona
} from '../conductor-portal/capacitaciones.service'

function responderError(request: FastifyRequest, reply: FastifyReply, err: unknown, mensaje: string) {
  if (err instanceof CapacitacionesError) {
    return reply.status(err.status).send({ success: false, message: err.message })
  }
  request.log.error({ err }, `[mis-capacitaciones] ${mensaje}`)
  return reply.status(500).send({ success: false, message: mensaje })
}

const meta = (request: FastifyRequest) => ({
  ip: request.ip || 'unknown',
  userAgent: request.headers['user-agent'] || 'unknown'
})

const usuarioId = (request: FastifyRequest) => (request as any).user.id as string

/**
 * Valida la cédula que declara un usuario que aún no la tiene, SIN escribirla.
 * Devuelve los dígitos, o `null` si no mandó nada (el servicio responde 422).
 */
export async function cedulaDeclarada(usuario: { id: string; correo: string }, valor: unknown): Promise<string | null> {
  const documento = String(valor ?? '').replace(/\D/g, '')
  if (!documento) return null
  if (documento.length < 5 || documento.length > 15) {
    throw new CapacitacionesError('Revisa tu número de cédula', 400)
  }
  /// Otra cuenta activa con esa cédula: o es un error de digitación o alguien quiere ver lo
  /// de otra persona. En los dos casos lo resuelve un administrador, no la app.
  const otraCuenta = await prisma.usuarios.findFirst({
    where: { id: { not: usuario.id }, activo: true, numero_documento: documento },
    select: { id: true }
  })
  if (otraCuenta) {
    throw new CapacitacionesError('Esa cédula ya está registrada en otra cuenta. Pide a un administrador que revise tu perfil.', 409)
  }
  /// La cédula de un conductor solo la puede declarar ese mismo conductor (mismo correo):
  /// sus firmas y evaluaciones del portal llevan esa cédula. Borrados incluidos: su
  /// historial sigue ahí.
  const conductor = await prisma.conductores.findFirst({
    where: { numero_identificacion: documento },
    select: { email: true }
  })
  const mismoCorreo =
    !!conductor?.email && conductor.email.trim().toLowerCase() === usuario.correo.trim().toLowerCase()
  if (conductor && !mismoCorreo) {
    throw new CapacitacionesError('Esa cédula pertenece a otra persona registrada. Pide a un administrador que revise tu perfil.', 409)
  }
  return documento
}

/**
 * La persona que firma. Si aún no tiene cédula y el cuerpo la trae, la valida y la usa para esta
 * operación; `guardar` la escribe en el perfil y se llama solo cuando la operación terminó.
 */
async function personaParaResponder(request: FastifyRequest) {
  const persona = await personaUsuario(usuarioId(request))
  /// Ya tiene cédula: lo que traiga el body se ignora. No se cambia desde la app.
  if (persona.numero_documento) return { persona, guardar: async () => {} }
  const documento = await cedulaDeclarada(
    { id: usuarioId(request), correo: persona.correo },
    (request.body as { numero_documento?: unknown } | null)?.numero_documento
  )
  if (!documento) return { persona, guardar: async () => {} }
  return {
    persona: { ...persona, numero_documento: documento },
    guardar: async () => {
      /// Solo si sigue vacía: dos POST seguidos no deben pisar una cédula ya guardada.
      /// Sin tocar `updated_at`: de ahí sale el uso único del enlace de recuperación de contraseña.
      await prisma.usuarios.updateMany({
        where: { id: usuarioId(request), OR: [{ numero_documento: null }, { numero_documento: '' }] },
        data: { numero_documento: documento }
      })
    }
  }
}

/**
 * Ejecuta la firma o la respuesta y, si salió bien, guarda la cédula declarada. También si ya
 * estaba registrada (409 `YA_REGISTRADA`): la cédula pasó la validación y es lo que casa lo que
 * firmó en la web pública; sin guardarla, la app seguiría mostrándola como pendiente.
 */
async function conCedula<T>(request: FastifyRequest, operacion: (persona: Persona) => Promise<T>): Promise<T> {
  const { persona, guardar } = await personaParaResponder(request)
  /// La firma o la respuesta ya quedaron: si falla guardar la cédula, se avisa en el log y la
  /// app la vuelve a pedir la próxima vez, pero no se responde error por algo que sí se hizo.
  const guardarSinFallar = () =>
    guardar().catch((err) => request.log.error({ err }, '[mis-capacitaciones] No se pudo guardar la cédula'))
  try {
    const resultado = await operacion(persona)
    await guardarSinFallar()
    return resultado
  } catch (err) {
    if (err instanceof CapacitacionesError && err.codigo === 'YA_REGISTRADA') await guardarSinFallar()
    throw err
  }
}

const tokenParams = { type: 'object', required: ['token'], properties: { token: { type: 'string' } } }
const idParams = { type: 'object', required: ['id'], properties: { id: { type: 'string' } } }

export async function misCapacitacionesRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authMiddleware)

  app.get('/mis-capacitaciones', async (request, reply) => {
    try {
      return reply.send({ success: true, data: await listarCapacitaciones(await personaUsuario(usuarioId(request))) })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible consultar las capacitaciones')
    }
  })

  app.get<{ Params: { token: string } }>('/mis-capacitaciones/asistencias/:token', { schema: { params: tokenParams } }, async (request, reply) => {
    try {
      const data = await obtenerAsistencia(request.params.token, await personaUsuario(usuarioId(request)))
      return reply.send({ success: true, data })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible consultar la asistencia')
    }
  })

  app.post<{ Params: { token: string } }>('/mis-capacitaciones/asistencias/:token', { schema: { params: tokenParams } }, async (request, reply) => {
    try {
      const data = await conCedula(request, (persona) => firmarAsistencia(request.params.token, persona, request.body, meta(request)))
      return reply.status(201).send({ success: true, data })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible registrar la asistencia')
    }
  })

  app.get<{ Params: { id: string } }>('/mis-capacitaciones/evaluaciones/:id', { schema: { params: idParams } }, async (request, reply) => {
    try {
      const data = await obtenerEvaluacion(request.params.id, await personaUsuario(usuarioId(request)))
      return reply.send({ success: true, data })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible consultar la evaluación')
    }
  })

  app.post<{ Params: { id: string } }>('/mis-capacitaciones/evaluaciones/:id', { schema: { params: idParams } }, async (request, reply) => {
    try {
      const data = await conCedula(request, (persona) => responderEvaluacion(request.params.id, persona, request.body, meta(request)))
      return reply.status(201).send({ success: true, data })
    } catch (err) {
      return responderError(request, reply, err, 'No fue posible registrar la evaluación')
    }
  })
}
