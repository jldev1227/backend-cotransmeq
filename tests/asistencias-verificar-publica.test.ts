/**
 * `GET /api/public/asistencias/:token/verificar` solo dice si este dispositivo
 * firmó, a nombre de quién y cuándo.
 *
 * Hasta oct-2026, sin sesión y con el token del QR más una huella que genera el
 * propio cliente, devolvía documento, teléfono, cargo, la firma en base64, IP y
 * user agent, sin límite de intentos.
 *
 * Sin base: Prisma, sockets y sesión van simulados. Se ejecuta suelto con
 * `npx vitest run tests/asistencias-verificar-publica.test.ts`.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { confirmacionPublica } from '../src/modules/asistencias/asistencia-publica'

const db = vi.hoisted(() => ({
  formularios_asistencia: { findUnique: vi.fn() },
  respuestas_asistencia: { findUnique: vi.fn() }
}))

vi.mock('../src/config/prisma', () => ({ prisma: db }))
vi.mock('../src/sockets', () => ({ getIo: () => ({ emit: () => {} }) }))
vi.mock('../src/middlewares/auth.middleware', () => ({ authMiddleware: async () => {} }))

const TOKEN = 'a'.repeat(64)
const ahora = new Date('2026-10-11T15:00:00.000Z')

const formulario = {
  id: '22222222-2222-4222-8222-222222222222',
  token: TOKEN,
  tematica: 'Charla de seguridad',
  objetivo: null,
  fecha: ahora,
  hora_inicio: '08:00',
  hora_finalizacion: '09:00',
  duracion_minutos: 60,
  tipo_evento: 'charla',
  tipo_evento_otro: null,
  lugar_sede: 'Sede',
  nombre_instructor: 'Instructor',
  activo: true,
  created_at: ahora,
  deleted_at: null
}

/// La fila completa, como la devuelve Prisma: todo esto existía en la respuesta.
const firmaGuardada = {
  id: '33333333-3333-4333-8333-333333333333',
  formulario_id: formulario.id,
  nombre_completo: 'Ana Pérez',
  numero_documento: '1001',
  cargo: 'Conductora',
  numero_telefono: '3000000000',
  pertenece_comite: null,
  nombre_comite: null,
  firma: 'data:image/png;base64,AAAA',
  ip_address: '181.0.0.1',
  user_agent: 'Mozilla/5.0',
  device_fingerprint: 'huella-1',
  created_at: ahora
}

let app: FastifyInstance
let ipSeq = 0
const otraIp = () => ({ 'cf-connecting-ip': `10.1.0.${++ipSeq}` })
const url = (huella?: string) =>
  `/api/public/asistencias/${TOKEN}/verificar${huella ? `?device_fingerprint=${huella}` : ''}`

beforeAll(async () => {
  const { asistenciasRoutes } = await import('../src/modules/asistencias/asistencias.routes')
  app = Fastify()
  await app.register(asistenciasRoutes, { prefix: '/api' })
  await app.ready()
})

afterAll(async () => {
  await app?.close()
})

beforeEach(() => {
  vi.clearAllMocks()
  db.formularios_asistencia.findUnique.mockResolvedValue(formulario)
  db.respuestas_asistencia.findUnique.mockResolvedValue(null)
})

describe('confirmacionPublica', () => {
  it('sin firma no dice nada; con firma, solo nombre y fecha', () => {
    expect(confirmacionPublica(null)).toEqual({ respondido: false, nombre: null, fecha: null })
    expect(confirmacionPublica(firmaGuardada)).toEqual({
      respondido: true,
      nombre: 'Ana Pérez',
      fecha: ahora.toISOString()
    })
  })
})

describe('GET /api/public/asistencias/:token/verificar', () => {
  it('con firma previa responde solo respondido, nombre y fecha', async () => {
    db.respuestas_asistencia.findUnique.mockResolvedValue(firmaGuardada)
    const res = await app.inject({ method: 'GET', url: url('huella-1'), headers: otraIp() })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      success: true,
      data: { respondido: true, nombre: 'Ana Pérez', fecha: ahora.toISOString() }
    })
    for (const dato of ['1001', '3000000000', 'Conductora', 'base64', '181.0.0.1', 'Mozilla', 'huella-1', firmaGuardada.id]) {
      expect(res.body).not.toContain(dato)
    }
  })

  it('sin firma previa', async () => {
    const res = await app.inject({ method: 'GET', url: url('otra'), headers: otraIp() })
    expect(res.json()).toEqual({ success: true, data: { respondido: false, nombre: null, fecha: null } })
  })

  it('400 sin huella y 404 con un token desconocido', async () => {
    expect((await app.inject({ method: 'GET', url: url(), headers: otraIp() })).statusCode).toBe(400)
    db.formularios_asistencia.findUnique.mockResolvedValue(null)
    expect((await app.inject({ method: 'GET', url: url('h'), headers: otraIp() })).statusCode).toBe(404)
  })

  it('limita las consultas por IP', async () => {
    const headers = otraIp()
    let ultima = 0
    for (let i = 0; i < 121; i++) {
      ultima = (await app.inject({ method: 'GET', url: url(`h${i}`), headers })).statusCode
    }
    expect(ultima).toBe(429)
    expect((await app.inject({ method: 'GET', url: url('h'), headers: otraIp() })).statusCode).toBe(200)
  })
})
