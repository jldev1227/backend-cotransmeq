import { FastifyReply, FastifyRequest } from 'fastify'
import { checkAccess, type AccessLevel } from '../config/permissions'
import { obtenerPermisosRutas } from '../services/permisos-rutas.service'

/**
 * Modo de aplicación de permisos, por variable de entorno.
 *
 *   enforce → rechaza con 403. Es el default desde oct-2026.
 *   warn    → NO rechaza; registra en consola quién habría sido rechazado.
 *             Solo como salida de emergencia, puesto a mano en el .env.
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
  return process.env.PERMISSIONS_MODE === 'warn' ? 'warn' : 'enforce'
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
 * Guarda de un archivo de rutas entero, por método: `lectura` para GET/HEAD y
 * `escritura` para lo demás.
 *
 * Se registra con `app.addHook('preHandler', permisoPorMetodo('nomina'))` en
 * plugins que ya autentican con `app.addHook('onRequest', authMiddleware)`. Va
 * a nivel de plugin y no ruta por ruta porque así quedaron los huecos de
 * oct-2026: nómina, primas, facturación y liquidaciones solo pedían sesión, y
 * cualquier usuario del equipo —o un conductor con su enlace— podía leerlas y
 * borrarlas. Una ruta nueva en el archivo nace protegida.
 *
 * `excepto` deja fuera rutas concretas del plugin (las públicas que comparten
 * archivo); recibe el patrón de la ruta (`/public/asistencias/:token`), no la
 * URL, y el método (el registro público de visitantes es `POST /inducciones`,
 * mismo patrón que el listado privado).
 */
export function permisoPorMetodo(
  moduleId: string,
  niveles: { lectura?: AccessLevel; escritura?: AccessLevel } = {},
  opciones: { excepto?: (patron: string, metodo: string) => boolean } = {}
) {
  const leer = requirePermission(moduleId, niveles.lectura ?? 'read')
  const escribir = requirePermission(moduleId, niveles.escritura ?? 'full')
  return async function (this: { prefix?: string } | undefined, request: FastifyRequest, reply: FastifyReply) {
    /// `routeOptions.url` trae el prefijo con que se registró el plugin (`/api`);
    /// se quita para que `excepto` compare contra la ruta tal como se escribe
    /// en el archivo. `this` es la instancia del plugin donde vive el hook.
    const completo = request.routeOptions?.url ?? request.url
    const prefijo = this?.prefix ?? ''
    const patron = prefijo && completo.startsWith(prefijo) ? completo.slice(prefijo.length) || '/' : completo
    if (opciones.excepto?.(patron, request.method)) return
    const esLectura = request.method === 'GET' || request.method === 'HEAD'
    return (esLectura ? leer : escribir)(request, reply)
  }
}

/**
 * Pasa si el usuario tiene AL MENOS UNO de los permisos dados.
 *
 * Para rutas que sirven a dos pantallas de módulos distintos: el PDF del canvas
 * se exporta desde el canvas de recorridos (`recorridos`, que lee casi todo el
 * equipo) y desde el de cierres de terceros (`liquidaciones-terceros`). Pedir
 * solo uno de los dos rompía la otra pantalla.
 */
export function requireAlgunPermiso(...permisos: Array<[moduleId: string, nivel: AccessLevel]>) {
  const guardas = permisos.map(([m, n]) => requirePermission(m, n))
  return async function (request: FastifyRequest, reply: FastifyReply) {
    const user = (request as any).user
    if (!user) return reply.status(401).send({ error: 'No autenticado' })
    const rutasOverride = await obtenerPermisosRutas(user.id)
    const jerarquia: AccessLevel[] = ['limited', 'read', 'full']
    const alguno = permisos.some(([m, n]) => {
      const { allowed, level } = checkAccess(user.role, user.area, m, rutasOverride)
      return allowed && jerarquia.indexOf(level!) >= jerarquia.indexOf(n)
    })
    if (alguno) return
    /// Sin ninguno: se delega en la primera guarda, que sabe responder 403 (o
    /// dejar pasar con aviso en modo `warn`) con el mismo formato de siempre.
    return guardas[0](request, reply)
  }
}

/**
 * Middleware que requiere nivel `full` en el módulo de sesiones (área
 * administracion). Protege la gestión de usuarios, sesiones e invitaciones.
 *
 * Hasta oct-2026 bastaba con tener acceso, de cualquier nivel: un
 * `{"sesiones": "read"}` en la lista blanca de alguien le daba poder para
 * cambiar áreas, rol y permisos de cualquiera, los suyos incluidos.
 */
export async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).user
  if (!user) {
    return reply.status(401).send({ error: 'No autenticado' })
  }
  const rutasOverride = await obtenerPermisosRutas(user.id)
  const { allowed, level } = checkAccess(user.role, user.area, 'sesiones', rutasOverride)
  if (!allowed || level !== 'full') {
    return reply.status(403).send({ error: 'Sin permisos para esta acción' })
  }
}
