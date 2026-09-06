// Contraparte de servicio del magic link de recuperación de contraseña.
//
// El enlace lo emite y lo verifica el frontend (SvelteKit), que es quien tiene
// el secreto de firma. Aquí solo viven las dos operaciones que exigen la base
// de datos: decir si un correo corresponde a una cuenta activa y reescribir el
// hash.
//
// Las dos rutas se autentican con un secreto compartido en la cabecera
// `x-recovery-token` y NO con la sesión del usuario: quien está recuperando su
// acceso por definición no tiene sesión. Ese secreto es el único control de
// acceso, así que sin él configurado las rutas responden 503 en vez de quedar
// abiertas.
//
// El contrato lo consume `src/lib/server/recuperacion/backend.ts` del frontend.
import { FastifyReply, FastifyRequest } from 'fastify'
import { timingSafeEqual } from 'node:crypto'
import argon2 from 'argon2'
import { prisma } from '../../config/prisma'
import { env } from '../../config/env'
import { SesionesService } from '../sesiones/sesiones.service'

/** Mismas reglas que `$lib/recuperacion/password.ts` en el frontend. */
const LARGO_MINIMO = 8
/** Tope de bcrypt: más allá de 72 bytes el final se ignora en silencio. */
const LARGO_MAXIMO = 72

/**
 * Comparación en tiempo constante. Con `===` el tiempo de respuesta filtra
 * cuántos caracteres iniciales acertó quien prueba secretos.
 */
function secretoCoincide(recibido: string, esperado: string): boolean {
  const a = Buffer.from(recibido, 'utf-8')
  const b = Buffer.from(esperado, 'utf-8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/**
 * @returns `true` si la petición puede continuar. Si no, ya respondió.
 */
function autorizar(request: FastifyRequest, reply: FastifyReply): boolean {
  const esperado = env.PASSWORD_RECOVERY_SERVICE_TOKEN?.trim()
  if (!esperado) {
    console.error(
      '[recuperacion] PASSWORD_RECOVERY_SERVICE_TOKEN no configurado en el backend: ' +
        'la ruta queda deshabilitada.'
    )
    reply.status(503).send({ error: 'La recuperación de contraseña no está habilitada.' })
    return false
  }

  const recibido = String((request.headers['x-recovery-token'] as string) ?? '')
  if (!recibido || !secretoCoincide(recibido, esperado)) {
    console.warn('[recuperacion] Cabecera x-recovery-token ausente o incorrecta')
    reply.status(401).send({ error: 'No autorizado.' })
    return false
  }

  return true
}

function normalizarCorreo(valor: unknown): string {
  return String(valor ?? '')
    .trim()
    .toLowerCase()
}

/** @returns El motivo del rechazo, o `null` si la contraseña sirve. */
function validarPassword(password: string): string | null {
  if (!password) return 'Escribe una contraseña nueva.'
  if (password.length < LARGO_MINIMO) {
    return `La contraseña debe tener al menos ${LARGO_MINIMO} caracteres.`
  }
  if (password.length > LARGO_MAXIMO) {
    return `La contraseña no puede superar los ${LARGO_MAXIMO} caracteres.`
  }
  if (!/[a-zA-ZáéíóúñÁÉÍÓÚÑ]/.test(password) || !/\d/.test(password)) {
    return 'La contraseña debe combinar al menos una letra y un número.'
  }
  return null
}

export const RecuperacionController = {
  /**
   * ¿El correo corresponde a una cuenta activa?
   *
   * Responde con la verdad porque quien pregunta es el propio frontend con el
   * secreto de servicio, no el navegador. Es la ruta pública `/api/auth/
   * recuperar-password` la que se encarga de no filtrar nada al usuario final:
   * conteste lo que conteste esto, allí la respuesta es siempre la misma.
   */
  async lookup(request: FastifyRequest, reply: FastifyReply) {
    if (!autorizar(request, reply)) return

    const correo = normalizarCorreo((request.body as any)?.correo)
    if (!correo) {
      return reply.status(400).send({ error: 'Falta el correo.' })
    }

    try {
      const usuario = await prisma.usuarios.findUnique({
        where: { correo },
        select: { nombre: true, activo: true }
      })

      // Una cuenta desactivada se trata como inexistente: no debe poder
      // recuperar el acceso, y decir «existe pero está inactiva» es más
      // información de la que el flujo necesita.
      if (!usuario || usuario.activo === false) {
        return reply.send({ existe: false })
      }

      return reply.send({ existe: true, nombre: usuario.nombre ?? null })
    } catch (error: any) {
      console.error('[recuperacion] lookup falló:', error?.message ?? error)
      return reply.status(500).send({ error: 'No se pudo consultar la cuenta.' })
    }
  },

  /**
   * Escribe la contraseña nueva.
   *
   * El uso único del enlace se garantiza aquí y no en el frontend: su memoria
   * de `jti` consumidos solo cubre la instancia que atendió la petición, y en
   * producción hay varias. El criterio es `emitidoEn > usuario.updated_at`, es
   * decir, el enlace tiene que ser posterior al último cambio de la cuenta. Al
   * aplicar el cambio `updated_at` pasa a ser ahora, así que el mismo enlace
   * (y cualquier otro anterior que siguiera vivo) deja de valer.
   *
   * Esto no necesita tabla nueva —la base de estos repos se toca a mano, no
   * con `migrate dev`— y de paso da gratis el comportamiento correcto: cambiar
   * la contraseña invalida todos los enlaces pendientes.
   */
  async aplicar(request: FastifyRequest, reply: FastifyReply) {
    if (!autorizar(request, reply)) return

    const cuerpo = (request.body ?? {}) as any
    const correo = normalizarCorreo(cuerpo.correo)
    const password = String(cuerpo.password ?? '')
    const tokenId = String(cuerpo.tokenId ?? '')
    const emitidoEn = new Date(String(cuerpo.emitidoEn ?? ''))

    if (!correo || !tokenId || Number.isNaN(emitidoEn.getTime())) {
      return reply.status(400).send({ error: 'Petición incompleta.' })
    }

    const problema = validarPassword(password)
    if (problema) return reply.status(400).send({ error: problema })

    try {
      const usuario = await prisma.usuarios.findUnique({
        where: { correo },
        select: { id: true, activo: true, updated_at: true }
      })

      if (!usuario || usuario.activo === false) {
        // 4xx: el frontend muestra este mensaje tal cual.
        return reply
          .status(409)
          .send({ error: 'Esta cuenta no puede restablecer su contraseña. Comunícate con soporte.' })
      }

      if (usuario.updated_at && emitidoEn.getTime() <= usuario.updated_at.getTime()) {
        console.warn(
          `[recuperacion] Enlace caducado por cambio posterior (tokenId ${tokenId}, ` +
            `emitido ${emitidoEn.toISOString()}, cuenta actualizada ${usuario.updated_at.toISOString()})`
        )
        return reply.status(409).send({
          error:
            'Este enlace ya se utilizó para cambiar la contraseña. Solicita uno nuevo si necesitas volver a cambiarla.'
        })
      }

      const hash = await argon2.hash(password)

      await prisma.usuarios.update({
        where: { id: usuario.id },
        data: { password: hash, updated_at: new Date() }
      })

      // Restablecer la contraseña normalmente significa que alguien perdió el
      // control de la cuenta. Dejar vivas las sesiones abiertas dejaría dentro
      // justo a quien se quiere echar.
      try {
        await SesionesService.cerrarTodas(usuario.id)
      } catch (error: any) {
        // El cambio ya está guardado; que no se puedan cerrar las sesiones no
        // debe convertirse en un fallo para el usuario, pero sí queda en el log.
        console.error('[recuperacion] No se pudieron cerrar las sesiones:', error?.message ?? error)
      }

      console.info(`[recuperacion] Contraseña restablecida para ${correo} (tokenId ${tokenId})`)
      return reply.send({ ok: true })
    } catch (error: any) {
      console.error('[recuperacion] aplicar falló:', error?.message ?? error)
      return reply.status(500).send({ error: 'No se pudo guardar la contraseña.' })
    }
  }
}
