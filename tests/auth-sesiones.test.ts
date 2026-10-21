/**
 * Autenticación del equipo: sesiones revocables, tokens del portal rechazados,
 * permisos por módulo y límite de intentos del login.
 *
 * Hasta oct-2026 `authMiddleware` aceptaba cualquier JWT firmado con nuestro
 * secreto: el enlace de 30 días de un conductor abría nómina y facturación,
 * cerrar la sesión o desactivar a alguien no le quitaba el acceso, y las
 * áreas quedaban congeladas en el token. Cada caso de aquí fija uno de esos
 * huecos para que no vuelva.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import jwt from 'jsonwebtoken'
import argon2 from 'argon2'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { env } from '../src/config/env'
import { authMiddleware } from '../src/middlewares/auth.middleware'
import { permisoPorMetodo } from '../src/middlewares/permissions.middleware'
import { olvidarSesionesEnCache } from '../src/middlewares/cache-sesiones'
import { SesionesService } from '../src/modules/sesiones/sesiones.service'
import { UsuariosService } from '../src/modules/usuarios/usuarios.service'
import { authRoutes } from '../src/modules/auth/auth.routes'
import { crearLimitador } from '../src/utils/limitador'
import { registrarSesion } from './helpers/sesion-prueba'

/// pdfmake redefine `vfs` al importarse dos veces; los módulos de nómina lo
/// cargan y aquí no se genera ningún PDF.
vi.mock('pdfmake/build/pdfmake', () => ({ default: {}, createPdf: () => ({}) }))
vi.mock('pdfmake/build/vfs_fonts', () => ({ default: { vfs: {} }, vfs: {} }))

const prisma = new PrismaClient()
const MARCA = 'zztest-auth-sesiones'

let app: FastifyInstance

async function crearUsuario(
  areas: string[],
  password = 'clave-de-prueba-123',
  opciones: { role?: string; permisos_rutas?: Record<string, string> } = {}
) {
  const id = randomUUID()
  const correo = `${MARCA}-${id.slice(0, 8)}@example.test`
  await prisma.usuarios.create({
    data: {
      id,
      nombre: `Prueba ${areas.join('+') || 'sin área'}`,
      correo,
      password: await argon2.hash(password),
      role: opciones.role ?? 'admin',
      area: areas,
      permisos_rutas: opciones.permisos_rutas,
      activo: true,
      created_at: new Date(),
      updated_at: new Date()
    } as any
  })
  return { id, correo, password }
}

/** Token con la forma del de `/auth/login`; el área del token se puede falsear a propósito. */
function firmar(id: string, extra: Record<string, unknown> = {}) {
  return jwt.sign({ sub: id, role: 'admin', area: ['administracion'], ...extra }, env.JWT_SECRET, { expiresIn: '1h' })
}

async function tokenConSesion(id: string) {
  const token = firmar(id)
  await registrarSesion(id, token)
  return token
}

const get = (url: string, token?: string) =>
  app.inject({ method: 'GET', url, headers: token ? { authorization: `Bearer ${token}` } : {} })
const post = (url: string, token?: string, payload: unknown = {}) =>
  app.inject({ method: 'POST', url, payload: payload as any, headers: token ? { authorization: `Bearer ${token}` } : {} })

beforeAll(async () => {
  process.env.PERMISSIONS_MODE = 'enforce'
  app = Fastify()
  await app.register(async (a) => {
    a.addHook('onRequest', authMiddleware)
    a.get('/yo', async (req) => ({ user: (req as any).user }))
  })
  await app.register(async (a) => {
    a.addHook('onRequest', authMiddleware)
    a.addHook('preHandler', permisoPorMetodo('nomina'))
    a.get('/nomina', async () => ({ ok: true }))
    a.post('/nomina', async () => ({ ok: true }))
  })
  await app.register(async (a) => {
    a.addHook('onRequest', authMiddleware)
    a.addHook('preHandler', permisoPorMetodo('servicios', {}, { excepto: (p) => p.startsWith('/servicios-publico') }))
    a.get('/servicios', async () => ({ ok: true }))
    a.post('/servicios', async () => ({ ok: true }))
  })
  await app.register(authRoutes, { prefix: '/api' })
  await app.ready()
})

beforeEach(() => {
  process.env.PERMISSIONS_MODE = 'enforce'
  olvidarSesionesEnCache()
})

afterAll(async () => {
  const ids = (await prisma.usuarios.findMany({ where: { correo: { contains: MARCA } }, select: { id: true } })).map((u) => u.id)
  await prisma.sesiones.deleteMany({ where: { usuario_id: { in: ids } } })
  await prisma.usuarios.deleteMany({ where: { id: { in: ids } } })
  await app.close()
  await prisma.$disconnect()
})

describe('sesión obligatoria', () => {
  it('sin token o con un token firmado pero sin sesión → 401', async () => {
    const u = await crearUsuario(['administracion'])
    expect((await get('/yo')).statusCode).toBe(401)
    expect((await get('/yo', firmar(u.id))).statusCode).toBe(401)
  })

  it('con sesión activa entra, y el área sale de la base, no del token', async () => {
    const u = await crearUsuario(['operaciones'])
    const token = await tokenConSesion(u.id) // el token dice «administracion»
    const r = await get('/yo', token)
    expect(r.statusCode).toBe(200)
    expect(r.json().user.area).toEqual(['operaciones'])
    expect((await get('/nomina', token)).statusCode).toBe(403)
  })

  it('cerrar la sesión la corta en la siguiente petición', async () => {
    const u = await crearUsuario(['administracion'])
    const token = await tokenConSesion(u.id)
    expect((await get('/yo', token)).statusCode).toBe(200)
    await SesionesService.cerrar(SesionesService.hashToken(token))
    expect((await get('/yo', token)).statusCode).toBe(401)
  })

  it('desactivar al usuario lo saca aunque su sesión estuviera en caché', async () => {
    const u = await crearUsuario(['administracion'])
    const token = await tokenConSesion(u.id)
    expect((await get('/yo', token)).statusCode).toBe(200) // queda en caché
    await UsuariosService.update(u.id, { activo: false })
    expect((await get('/yo', token)).statusCode).toBe(401)
  })

  it('quitar un área surte efecto sin volver a iniciar sesión', async () => {
    const u = await crearUsuario(['talento_humano'])
    const token = await tokenConSesion(u.id)
    expect((await get('/nomina', token)).statusCode).toBe(200)
    await UsuariosService.update(u.id, { area: ['operaciones'] })
    expect((await get('/nomina', token)).statusCode).toBe(403)
  })

  it('una sesión vencida no entra aunque siga marcada como activa', async () => {
    const u = await crearUsuario(['administracion'])
    const token = firmar(u.id)
    await registrarSesion(u.id, token)
    await prisma.sesiones.updateMany({
      where: { token_hash: SesionesService.hashToken(token) },
      data: { token_expiry: new Date(Date.now() - 1000) }
    })
    expect((await get('/yo', token)).statusCode).toBe(401)
  })
})

describe('tokens que no son del equipo', () => {
  it.each(['conductor_portal', 'conductor_dias_laborados', 'conductor_portal_print'])(
    'un token %s no abre la API del equipo, ni con sesión registrada',
    async (tipo) => {
      const u = await crearUsuario(['administracion'])
      const token = firmar(u.id, { tipo })
      await registrarSesion(u.id, token)
      const r = await get('/nomina', token)
      expect(r.statusCode).toBe(401)
    }
  )
})

describe('permisos por método', () => {
  it('lectura con `read`, escritura con `full`', async () => {
    // hseq tiene `read` en servicios: lee, pero no escribe.
    const u = await crearUsuario(['hseq'])
    const token = await tokenConSesion(u.id)
    expect((await get('/servicios', token)).statusCode).toBe(200)
    expect((await post('/servicios', token)).statusCode).toBe(403)
  })

  it('un área sin el módulo no lee ni escribe', async () => {
    const u = await crearUsuario(['mantenimiento'])
    const token = await tokenConSesion(u.id)
    expect((await get('/nomina', token)).statusCode).toBe(403)
    expect((await post('/nomina', token)).statusCode).toBe(403)
  })

  it('con PERMISSIONS_MODE=warn deja pasar (salida de emergencia)', async () => {
    process.env.PERMISSIONS_MODE = 'warn'
    const u = await crearUsuario(['mantenimiento'])
    const token = await tokenConSesion(u.id)
    expect((await get('/nomina', token)).statusCode).toBe(200)
  })
})

describe('login', () => {
  it('crea una sesión que el middleware acepta, y logout la cierra', async () => {
    const u = await crearUsuario(['administracion'])
    const login = await post('/api/auth/login', undefined, { correo: u.correo, password: u.password })
    expect(login.statusCode).toBe(200)
    const token = login.json().token as string
    expect((await get('/yo', token)).statusCode).toBe(200)
    expect((await post('/api/auth/logout', token)).statusCode).toBe(200)
    expect((await get('/yo', token)).statusCode).toBe(401)
  })

  it('recorta espacios y convierte el correo a minúsculas antes de buscar', async () => {
    const u = await crearUsuario(['administracion'])
    const login = await post('/api/auth/login', undefined, {
      correo: `  ${u.correo.toUpperCase()}  `,
      password: u.password
    })
    expect(login.statusCode).toBe(200)
    expect(login.json().user.correo).toBe(u.correo)
  })

  it('tras cinco contraseñas erradas responde 429, incluso con la correcta', async () => {
    const u = await crearUsuario(['administracion'])
    for (let i = 0; i < 5; i++) {
      const r = await post('/api/auth/login', undefined, { correo: u.correo, password: 'contrasena-errada' })
      expect(r.statusCode).toBe(401)
    }
    const bloqueado = await post('/api/auth/login', undefined, { correo: u.correo, password: u.password })
    expect(bloqueado.statusCode).toBe(429)
    expect(Number(bloqueado.headers['retry-after'])).toBeGreaterThan(0)
  })

  it('un login correcto reinicia el contador del correo', async () => {
    const u = await crearUsuario(['administracion'])
    for (let i = 0; i < 4; i++) await post('/api/auth/login', undefined, { correo: u.correo, password: 'contrasena-errada' })
    expect((await post('/api/auth/login', undefined, { correo: u.correo, password: u.password })).statusCode).toBe(200)
    for (let i = 0; i < 4; i++) {
      expect((await post('/api/auth/login', undefined, { correo: u.correo, password: 'contrasena-errada' })).statusCode).toBe(401)
    }
  })
})

describe('limitador', () => {
  it('cuenta por clave y libera al vencer la ventana', async () => {
    const l = crearLimitador({ max: 2, ventanaMs: 50 })
    expect(l.consumir('a')).toBe(0)
    expect(l.consumir('a')).toBe(0)
    expect(l.consumir('a')).toBeGreaterThan(0)
    expect(l.consumir('b')).toBe(0)
    await new Promise((r) => setTimeout(r, 60))
    expect(l.consumir('a')).toBe(0)
  })
})

/**
 * Las guardas puestas en los módulos reales, registrados con el prefijo `/api`
 * como en `app.ts`: el prefijo cambia el patrón de ruta que ven las excepciones.
 */
describe('guardas en los módulos reales', () => {
  let real: FastifyInstance

  beforeAll(async () => {
    const { liquidacionesRoutes } = await import('../src/modules/liquidaciones/liquidaciones.routes')
    const { evaluacionesRoutes } = await import('../src/modules/evaluaciones/evaluacion.routes')
    const { documentosRoutes } = await import('../src/modules/documentos/documentos.routes')
    const { operadorasRoutes } = await import('../src/modules/operadoras/operadoras.routes')
    const { induccionesRoutes } = await import('../src/modules/inducciones/inducciones.routes')
    const { usuariosRoutes } = await import('../src/modules/usuarios/usuarios.routes')
    const { formulariosSarlaftRoutes } = await import('../src/modules/formularios-sarlaft/formularios-sarlaft.routes')
    const { liquidacionesSnapshotsRoutes } = await import('../src/modules/liquidaciones-terceros-snapshots/liquidaciones-terceros-snapshots.routes')
    const { conductoresRoutes } = await import('../src/modules/conductores/conductores.routes')
    const { conductorPortalRoutes } = await import('../src/modules/conductor-portal/conductor-portal.routes')
    real = Fastify()
    for (const plugin of [
      liquidacionesRoutes,
      evaluacionesRoutes,
      documentosRoutes,
      operadorasRoutes,
      induccionesRoutes,
      usuariosRoutes,
      formulariosSarlaftRoutes,
      liquidacionesSnapshotsRoutes,
      conductoresRoutes,
      conductorPortalRoutes,
    ]) {
      await real.register(plugin as any, { prefix: '/api' })
    }
    await real.ready()
  })
  afterAll(async () => {
    await real.close()
  })

  const pedir = (
    method: 'GET' | 'POST' | 'PUT',
    url: string,
    token?: string,
    payload?: unknown,
    cabeceras: Record<string, string> = {}
  ) =>
    real.inject({
      method,
      url,
      payload: payload as any,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...cabeceras }
    })

  async function crearConductor() {
    const id = randomUUID()
    await prisma.conductores.create({
      data: {
        id,
        nombre: 'PRUEBA',
        apellido: MARCA.toUpperCase(),
        tipo_identificacion: 'CC',
        numero_identificacion: `9${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 90 + 10)}`,
        created_at: new Date(),
        updated_at: new Date()
      } as any
    })
    conductoresCreados.push(id)
    return id
  }
  const conductoresCreados: string[] = []

  it('nómina: operaciones no entra, pero la valoración de recargos sí', async () => {
    const u = await crearUsuario(['operaciones'])
    const token = await tokenConSesion(u.id)
    expect((await pedir('GET', '/api/liquidaciones', token)).statusCode).toBe(403)
    expect((await pedir('GET', '/api/liquidaciones/preview-recargos', token)).statusCode).not.toBe(403)
  })

  it('evaluaciones: mantenimiento no entra, la página pública sigue abierta', async () => {
    const u = await crearUsuario(['mantenimiento'])
    const token = await tokenConSesion(u.id)
    expect((await pedir('GET', '/api/evaluaciones', token)).statusCode).toBe(403)
    const id = randomUUID()
    expect([401, 403]).not.toContain((await pedir('GET', `/api/public/evaluaciones/${id}`)).statusCode)
    expect([401, 403]).not.toContain((await pedir('GET', `/api/evaluaciones/${id}/verificar`)).statusCode)
  })

  it('documentos: solo planillas y solo con recargos', async () => {
    const hseq = await tokenConSesion((await crearUsuario(['hseq'])).id)
    const mant = await tokenConSesion((await crearUsuario(['mantenimiento'])).id)
    expect((await pedir('GET', '/api/documentos/url-firma?key=firmas/x.png', hseq)).statusCode).toBe(403)
    expect((await pedir('GET', '/api/documentos/url-firma?key=planillas/x.pdf', mant)).statusCode).toBe(403)
  })

  it('operadoras: cualquiera lee, solo liquidaciones-servicios escribe', async () => {
    const token = await tokenConSesion((await crearUsuario(['mantenimiento'])).id)
    expect((await pedir('GET', '/api/operadoras', token)).statusCode).not.toBe(403)
    expect((await pedir('POST', '/api/operadoras', token, { nombre: 'X' })).statusCode).toBe(403)
  })

  it('inducciones: el registro del visitante es público, la gestión no', async () => {
    expect([401, 403]).not.toContain((await pedir('POST', '/api/inducciones', undefined, {})).statusCode)
    const token = await tokenConSesion((await crearUsuario(['mantenimiento'])).id)
    expect((await pedir('GET', '/api/inducciones', token)).statusCode).toBe(403)
  })

  it('usuarios: `sesiones` con nivel de lectura en la lista blanca no administra', async () => {
    const lector = await crearUsuario(['operaciones'], undefined, { role: 'usuario', permisos_rutas: { sesiones: 'read' } })
    const admin = await crearUsuario(['administracion'], undefined, { role: 'usuario' })
    expect((await pedir('GET', '/api/usuarios', await tokenConSesion(lector.id))).statusCode).toBe(403)
    expect((await pedir('GET', '/api/usuarios', await tokenConSesion(admin.id))).statusCode).not.toBe(403)
  })

  it('sarlaft: el panel pide el módulo, no solo sesión', async () => {
    const mant = await tokenConSesion((await crearUsuario(['mantenimiento'])).id)
    const th = await tokenConSesion((await crearUsuario(['talento_humano'])).id)
    expect((await pedir('GET', '/api/formularios-sarlaft', mant)).statusCode).toBe(403)
    expect((await pedir('GET', '/api/formularios-sarlaft', th)).statusCode).not.toBe(403)
  })

  it('cron de snapshots de cierres: no pide sesión, pide el secreto', async () => {
    const previo = process.env.CRON_SECRET
    process.env.CRON_SECRET = 'secreto-de-prueba-cron'
    try {
      const url = '/api/liquidaciones-terceros-snapshots/cron-hora'
      expect((await pedir('POST', url)).statusCode).toBe(403)
      expect((await pedir('POST', url, undefined, {}, { 'x-cron-secret': 'otro' })).statusCode).toBe(403)
      /// Las demás rutas del archivo siguen pidiendo sesión.
      expect((await pedir('GET', `/api/liquidaciones-terceros/${randomUUID()}/snapshots`)).statusCode).toBe(401)
    } finally {
      process.env.CRON_SECRET = previo
    }
  })

  it('conductores: el PUT no escribe contraseña, permisos ni `oculto`', async () => {
    const id = await crearConductor()
    const token = await tokenConSesion((await crearUsuario(['mantenimiento'])).id)
    const r = await pedir('PUT', `/api/conductores/${id}`, token, {
      nombre: 'Cambiado',
      password: '$argon2id$v=19$m=65536,t=3,p=4$falso',
      permisos: { google_play_review: true },
      oculto: true
    })
    expect(r.statusCode).toBe(200)
    const fila = await prisma.conductores.findUnique({ where: { id }, select: { nombre: true, password: true, permisos: true, oculto: true } })
    expect(fila?.nombre).toBe('CAMBIADO')
    expect(fila?.password).toBeNull()
    expect((fila?.permisos as any)?.google_play_review).toBeUndefined()
    expect(fila?.oculto).toBe(false)
  })

  it('portal: un token revocado deja de abrir el portal', async () => {
    const { emitirTokenPortal, olvidarTokensPortalEnCache } = await import('../src/modules/conductor-portal/portal-token.service')
    const id = await crearConductor()
    const token = await emitirTokenPortal({ id, numero_identificacion: '1', nombre: 'PRUEBA', apellido: 'X' })
    expect((await pedir('GET', '/api/conductor-portal/desprendibles', token)).statusCode).toBe(200)

    await prisma.conductor_token.deleteMany({ where: { token } })
    olvidarTokensPortalEnCache()
    expect((await pedir('GET', '/api/conductor-portal/desprendibles', token)).statusCode).toBe(401)
  })

  afterAll(async () => {
    await prisma.conductor_token.deleteMany({ where: { conductor_id: { in: conductoresCreados } } })
    await prisma.conductores.deleteMany({ where: { id: { in: conductoresCreados } } })
  })
})
