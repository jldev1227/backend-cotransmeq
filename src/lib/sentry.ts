/**
 * Rastreo de errores con Sentry, OPCIONAL: solo se activa si hay `SENTRY_DSN`.
 *
 * Sin DSN este módulo no carga ni el SDK (`require` perezoso): el arranque y la
 * memoria quedan como estaban, y en desarrollo y en los tests no sale nada
 * hacia fuera. Variables (ver `.env.example`):
 *   SENTRY_DSN                  — activa el envío.
 *   SENTRY_ENVIRONMENT          — por defecto `NODE_ENV`.
 *   SENTRY_RELEASE              — p. ej. el SHA del despliegue.
 *   SENTRY_TRACES_SAMPLE_RATE   — solo si se quiere rendimiento; sin ella no
 *                                 se crean trazas (ni se carga su
 *                                 instrumentación).
 *
 * Qué se captura:
 *   - excepciones y promesas rechazadas sin atrapar (integraciones por defecto);
 *   - errores que llegan al manejador de Fastify (`onError`);
 *   - respuestas 5xx que el controlador armó a mano: casi todos atrapan su
 *     error y responden `reply.status(500).send({ error })`, así que el error
 *     nunca llega a Fastify y sin esto Sentry no vería la mayoría de fallos.
 *
 * Se importa lo primero en `server.ts` para que el SDK quede listo antes de
 * que nada más cargue.
 */
import type * as SentryTipos from '@sentry/node'
import type { FastifyInstance, FastifyRequest } from 'fastify'

const dsn = process.env.SENTRY_DSN?.trim()

let sentry: typeof SentryTipos | null = null

if (dsn) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  sentry = require('@sentry/node') as typeof SentryTipos
  const muestreo = process.env.SENTRY_TRACES_SAMPLE_RATE
  sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    release: process.env.SENTRY_RELEASE || undefined,
    /// Solo si se pide: con `tracesSampleRate` definido —aunque valga 0— el
    /// SDK carga la instrumentación de trazas de todo (http, prisma…).
    ...(muestreo ? { tracesSampleRate: Number(muestreo) } : {}),
    /// En v11 el SDK recoge por defecto cabeceras, cookies, query y CUERPOS de
    /// las peticiones. Aquí los cuerpos llevan cédulas, salarios y firmas, y
    /// las cabeceras el `Authorization` con el JWT: no sale nada de eso. El
    /// usuario se adjunta a mano (solo su id) en cada captura.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
    },
    beforeSend(evento) {
      /// Igual que en las 5xx de abajo: el mensaje de un error de Prisma trae
      /// la invocación con los datos debajo de la primera línea.
      for (const ex of evento.exception?.values ?? []) {
        if (ex.value) ex.value = ex.value.split('\n').map((l) => l.trim()).find(Boolean)?.slice(0, 300)
      }
      if (evento.request?.headers) {
        delete evento.request.headers.authorization
        delete evento.request.headers.cookie
      }
      delete evento.request?.cookies
      return evento
    },
  })
}

/** ¿Está activo? (hay DSN y el SDK se inicializó). */
export const sentryActivo = sentry !== null

const CAPTURADO = Symbol('sentry-capturado')

function usuarioDe(request: FastifyRequest): { id: string } | undefined {
  const id = (request as any).user?.id
  return id ? { id: String(id) } : undefined
}

/**
 * Engancha la captura a Fastify. Va al principio de `buildApp()`, antes de
 * registrar rutas: los hooks del contexto raíz solo se heredan en los plugins
 * que se registran después. Sin DSN no añade nada.
 */
export function instalarSentry(app: FastifyInstance): void {
  if (!sentry) return
  const s = sentry

  app.addHook('onError', async (request, reply, error) => {
    ;(request as any)[CAPTURADO] = true
    const status = reply.statusCode >= 400 ? reply.statusCode : (error as any).statusCode ?? 500
    if (status < 500) return
    s.captureException(error, {
      user: usuarioDe(request),
      tags: { metodo: request.method, ruta: request.routeOptions?.url ?? request.url },
    })
  })

  app.addHook('onSend', async (request, reply, payload) => {
    if (reply.statusCode < 500 || (request as any)[CAPTURADO]) return payload
    let mensaje = `HTTP ${reply.statusCode}`
    if (typeof payload === 'string') {
      try {
        const cuerpo = JSON.parse(payload)
        if (typeof cuerpo?.error === 'string') mensaje = cuerpo.error
        else if (typeof cuerpo?.message === 'string') mensaje = cuerpo.message
      } catch {
        // Cuerpo que no es JSON: se queda el código.
      }
    }
    /// Solo la primera línea y acotada: los errores de validación de Prisma
    /// vuelcan debajo la invocación con sus argumentos —los datos del
    /// formulario— y eso no debe salir hacia Sentry.
    mensaje =
      mensaje
        .split('\n')
        .map((l) => l.trim())
        .find(Boolean)
        ?.slice(0, 200) ?? `HTTP ${reply.statusCode}`
    const ruta = request.routeOptions?.url ?? request.url.split('?')[0]
    s.captureMessage(`${request.method} ${ruta} → ${reply.statusCode}: ${mensaje}`, {
      level: 'error',
      user: usuarioDe(request),
      tags: { metodo: request.method, ruta, status: String(reply.statusCode) },
      /// Agrupar por ruta y mensaje: el mismo fallo en mil peticiones es un
      /// solo issue, no mil.
      fingerprint: [request.method, ruta, mensaje],
    })
    return payload
  })
}

/** Error atrapado a mano (crons, colas) que conviene ver en Sentry. */
export function capturarError(error: unknown, contexto?: Record<string, unknown>): void {
  sentry?.captureException(error, contexto ? { extra: contexto } : undefined)
}

/** Vacía la cola de eventos antes de salir (lo llama el apagado ordenado). */
export async function cerrarSentry(limiteMs = 2_000): Promise<void> {
  if (!sentry) return
  await sentry.close(limiteMs)
}
