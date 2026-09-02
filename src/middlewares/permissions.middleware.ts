import { FastifyReply, FastifyRequest } from 'fastify'
import { checkAccess, type AccessLevel } from '../config/permissions'
import { obtenerPermisosRutas } from '../services/permisos-rutas.service'

/**
 * Modo de aplicación de permisos, por variable de entorno.
 *
 *   enforce → rechaza con 403 (comportamiento normal)
 *   warn    → NO rechaza; registra en consola quién habría sido rechazado
 *
 * El modo `warn` existe porque aplicar `requirePermission` de golpe a un
 * módulo que hasta ahora no lo tenía puede tumbar a roles reales que
 * llevaban meses usándolo. `facturacion` y `contabilidad` solo tienen
 * `limited` sobre liquidaciones de terceros: cualquier escritura suya
 * pasaría a 403 sin aviso. Se despliega en `warn`, se leen los logs unos
 * días, se corrige el mapa de permisos y solo entonces se pasa a
 * `enforce`.
 *
 * Mismo patrón que `SOCKET_AUTH_MODE` en `sockets/auth.ts`.
 */
export type PermissionsMode = 'enforce' | 'warn'

export function permissionsMode(): PermissionsMode {
  // Se lee de `process.env` y no de `config/env`, para que los tests puedan
  // alternarlo sin reimportar el módulo de configuración. El default aquí
  // debe coincidir con el de `env.ts`.
  return process.env.PERMISSIONS_MODE === 'enforce' ? 'enforce' : 'warn'
}

/** Un rechazo que el modo `warn` dejó pasar. Útil para tests y auditoría. */
export interface RechazoPermiso {
  moduleId: string
  requiredLevel: AccessLevel
  actualLevel: AccessLevel | null
  userId: string | null
  areas: string[]
  method: string
  url: string
}

const rechazosVistos: RechazoPermiso[] = []

/** Rechazos acumulados en modo `warn` (tope de 500, se descartan los viejos). */
export function rechazosPermisosRegistrados(): readonly RechazoPermiso[] {
  return rechazosVistos
}

function registrarRechazo(r: RechazoPermiso) {
  rechazosVistos.push(r)
  if (rechazosVistos.length > 500) rechazosVistos.shift()
  console.warn(
    `[permisos:warn] ${r.method} ${r.url} — usuario ${r.userId ?? 'anónimo'} ` +
      `(áreas: ${r.areas.join(',') || 'ninguna'}) tiene nivel "${r.actualLevel ?? 'ninguno'}" ` +
      `y se requiere "${r.requiredLevel}" en "${r.moduleId}". PASA por PERMISSIONS_MODE=warn.`,
  )
}

/**
 * Middleware factory que verifica permisos por módulo
 * @param moduleId - ID del módulo (ej: 'servicios', 'recargos')
 * @param requiredLevel - Nivel mínimo requerido ('full' | 'read' | 'limited'). Default: 'read'
 *
 * La falta de autenticación se rechaza SIEMPRE, también en modo `warn`:
 * lo que se está estrenando es la granularidad por área, no el login.
 */
export function requirePermission(moduleId: string, requiredLevel: AccessLevel = 'read') {
  return async function (request: FastifyRequest, reply: FastifyReply) {
    const user = (request as any).user

    if (!user) {
      return reply.status(401).send({ error: 'No autenticado' })
    }

    const modo = permissionsMode()
    const areas: string[] = !user.area ? [] : Array.isArray(user.area) ? user.area : [user.area]

    /// Lista blanca por usuario. Si la tiene, sustituye por completo a las
    /// reglas por área (ver `checkAccess`); si no, esto es `null` y todo se
    /// comporta como antes.
    const rutasOverride = await obtenerPermisosRutas(user.id)
    ;(request as any).permisosRutas = rutasOverride

    const { allowed, level } = checkAccess(user.role, user.area, moduleId, rutasOverride)

    const denegar = (payload: { error: string; message: string }) => {
      /// `PERMISSIONS_MODE=warn` sólo indulta las reglas por ÁREA, que llevan
      /// meses sin aplicarse y podrían tumbar a usuarios reales al activarse.
      /// Una lista blanca en `permisos_rutas` es lo contrario: un recorte que
      /// un administrador acaba de escribir para esa persona en concreto. Si
      /// `warn` también la dejara pasar, la pantalla de permisos mentiría —
      /// diría «restringido» y el usuario entraría igual. Por eso se aplica
      /// siempre, en los dos modos.
      if (modo === 'warn' && !rutasOverride) {
        registrarRechazo({
          moduleId,
          requiredLevel,
          actualLevel: level,
          userId: user.id ?? null,
          areas,
          method: request.method,
          url: request.url,
        })
        ;(request as any).accessLevel = level ?? 'full'
        return
      }
      return reply.status(403).send(payload)
    }

    if (!allowed) {
      return denegar({
        error: 'Sin permisos',
        message: `No tienes acceso al módulo "${moduleId}". Contacta al administrador.`
      })
    }

    // Verificar nivel de acceso
    const levelHierarchy: AccessLevel[] = ['limited', 'read', 'full']
    const userLevelIndex = levelHierarchy.indexOf(level!)
    const requiredLevelIndex = levelHierarchy.indexOf(requiredLevel)

    if (userLevelIndex < requiredLevelIndex) {
      return denegar({
        error: 'Nivel de acceso insuficiente',
        message: `Tu nivel de acceso "${level}" no es suficiente. Se requiere "${requiredLevel}".`
      })
    }

    // Adjuntar el nivel de acceso al request para uso posterior
    ;(request as any).accessLevel = level
  }
}

/**
 * Middleware que requiere acceso al módulo de sesiones (área administracion)
 */
export async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).user
  if (!user) {
    return reply.status(401).send({ error: 'No autenticado' })
  }
  const rutasOverride = await obtenerPermisosRutas(user.id)
  const { allowed } = checkAccess(user.role, user.area, 'sesiones', rutasOverride)
  if (!allowed) {
    return reply.status(403).send({ error: 'Sin permisos para esta acción' })
  }
}
