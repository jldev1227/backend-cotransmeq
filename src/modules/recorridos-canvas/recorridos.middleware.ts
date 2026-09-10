import { FastifyReply, FastifyRequest } from 'fastify'
import { RecorridosPatchService } from './recorridos-patch.service'

/**
 * Exige nivel `full` en el módulo `recorridos`, SIEMPRE.
 *
 * `requirePermission` no basta aquí: su modo por defecto es `PERMISSIONS_MODE
 * =warn`, que deja pasar el rechazo y solo lo registra. Ese indulto existe
 * para módulos que llevaban meses sin permisos y que aplicar de golpe habría
 * tumbado — no es el caso de `recorridos`, que nace con la regla puesta y no
 * tiene usuarios previos a los que romper.
 *
 * Además comparte la comprobación EXACTA con el socket
 * (`RecorridosPatchService.puedeEditar`), para que la API REST y `sheet:patch`
 * no puedan quedar con reglas distintas: sería inútil bloquear el formulario
 * si la hoja de cálculo escribe igual.
 */
export async function requireRecorridosEdicion(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).user
  if (!user) return reply.status(401).send({ error: 'No autenticado' })

  const puede = await RecorridosPatchService.puedeEditar({
    id: user.id,
    area: user.area,
    role: user.role,
  })

  if (!puede) {
    return reply.status(403).send({
      error: 'Sin permiso para modificar recorridos',
      message:
        'Solo Administración y Operaciones pueden modificar recorridos. Tu acceso es de consulta.',
    })
  }
}
