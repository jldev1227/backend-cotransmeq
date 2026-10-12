/**
 * CRUD de tarifas por cliente (`/liquidaciones-servicios/tarifas`), que usa la
 * pestaña «Tarifas» de la ficha del cliente.
 *
 * Fija lo que estaba roto antes de tener pantalla: crear no guardaba el
 * cliente (500 siempre), listar ignoraba el `cliente_id`, y una tarifa
 * desactivada bloqueaba para siempre su año. Y los permisos del módulo:
 * consultar con `limited` (facturación), escribir solo con `full`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import jwt from 'jsonwebtoken'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { env } from '../src/config/env'
import { olvidarSesionesEnCache } from '../src/middlewares/cache-sesiones'
import { registrarSesion } from './helpers/sesion-prueba'
import { liquidacionesServiciosRoutes } from '../src/modules/liquidaciones-servicios/liquidaciones-servicios.routes'

const prisma = new PrismaClient()
const MARCA = 'zztest-tarifas'
let app: FastifyInstance

async function crearUsuario(areas: string[]) {
  const id = randomUUID()
  await prisma.usuarios.create({
    data: {
      id,
      nombre: `Prueba ${areas.join('+')}`,
      correo: `${MARCA}-${id.slice(0, 8)}@example.test`,
      password: 'no-se-usa',
      role: 'usuario',
      area: areas,
      activo: true,
      created_at: new Date(),
      updated_at: new Date(),
    } as any,
  })
  const token = jwt.sign({ sub: id, id, role: 'usuario', area: areas }, env.JWT_SECRET, { expiresIn: '1h' })
  await registrarSesion(id, token)
  return { id, token }
}

const pedir = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, token: string, payload?: unknown) =>
  app.inject({ method, url, payload: payload as any, headers: { authorization: `Bearer ${token}` } })

let operaciones: { token: string }
let facturacion: { token: string }
let clienteA: string
let clienteB: string

const VALORES = { operadora: 'PAREX', valor_24h: 1_000_000, valor_12h: 700_000, valor_hora: 40_000, valor_km: 2_000, km_dia: 150, valor_pernocte: 100_000 }

beforeAll(async () => {
  process.env.PERMISSIONS_MODE = 'enforce'
  app = Fastify()
  await app.register(liquidacionesServiciosRoutes, { prefix: '/api' })
  await app.ready()
  operaciones = await crearUsuario(['operaciones'])
  facturacion = await crearUsuario(['facturacion'])
  clienteA = randomUUID()
  clienteB = randomUUID()
  for (const id of [clienteA, clienteB]) {
    await prisma.clientes.create({ data: { id, nombre: `${MARCA} ${id.slice(0, 4)}`, nit: id.slice(0, 9), createdAt: new Date(), updatedAt: new Date() } as any })
  }
})

beforeEach(() => {
  process.env.PERMISSIONS_MODE = 'enforce'
  olvidarSesionesEnCache()
})

afterAll(async () => {
  const usuarios = (await prisma.usuarios.findMany({ where: { correo: { contains: MARCA } }, select: { id: true } })).map((u) => u.id)
  await prisma.tarifas_servicios.deleteMany({ where: { cliente_id: { in: [clienteA, clienteB] } } })
  await prisma.clientes.deleteMany({ where: { id: { in: [clienteA, clienteB] } } })
  await prisma.sesiones.deleteMany({ where: { usuario_id: { in: usuarios } } })
  await prisma.usuarios.deleteMany({ where: { id: { in: usuarios } } })
  await app.close()
  await prisma.$disconnect()
})

describe('tarifas por cliente', () => {
  let tarifaId: string

  it('crea guardando el cliente y lista solo las de ese cliente', async () => {
    const r = await pedir('POST', '/api/liquidaciones-servicios/tarifas', operaciones.token, { cliente_id: clienteA, anio: 2026, ...VALORES })
    expect(r.statusCode, r.body).toBe(201)
    tarifaId = r.json().id
    expect(r.json().cliente_id).toBe(clienteA)
    await pedir('POST', '/api/liquidaciones-servicios/tarifas', operaciones.token, { cliente_id: clienteB, anio: 2026, ...VALORES })
    const lista = await pedir('GET', `/api/liquidaciones-servicios/tarifas?cliente_id=${clienteA}`, facturacion.token)
    expect(lista.statusCode).toBe(200)
    expect(lista.json().map((t: any) => t.cliente_id)).toEqual([clienteA])
  })

  it('facturación consulta pero no escribe', async () => {
    const r = await pedir('PUT', `/api/liquidaciones-servicios/tarifas/${tarifaId}`, facturacion.token, { valor_24h: 1 })
    expect(r.statusCode).toBe(403)
  })

  it('el mismo año dos veces es 409 con un mensaje legible', async () => {
    const r = await pedir('POST', '/api/liquidaciones-servicios/tarifas', operaciones.token, { cliente_id: clienteA, anio: 2026, ...VALORES })
    expect(r.statusCode).toBe(409)
    expect(r.json().error).toContain('ya tiene una tarifa')
  })

  it('valida el cuerpo: sin operadora o con 24 h en cero es 400', async () => {
    const { operadora: _o, ...sinOperadora } = VALORES
    expect((await pedir('POST', '/api/liquidaciones-servicios/tarifas', operaciones.token, { cliente_id: clienteA, anio: 2025, ...sinOperadora })).statusCode).toBe(400)
    expect((await pedir('POST', '/api/liquidaciones-servicios/tarifas', operaciones.token, { cliente_id: clienteA, anio: 2025, ...VALORES, valor_24h: 0 })).statusCode).toBe(400)
    expect((await pedir('PUT', '/api/liquidaciones-servicios/tarifas/no-es-uuid', operaciones.token, { valor_24h: 1 })).statusCode).toBe(400)
  })

  it('edita valores y operadora', async () => {
    const r = await pedir('PUT', `/api/liquidaciones-servicios/tarifas/${tarifaId}`, operaciones.token, { valor_24h: 1_100_000, operadora: 'GEOPARK' })
    expect(r.statusCode, r.body).toBe(200)
    expect(Number(r.json().valor_24h)).toBe(1_100_000)
    expect(r.json().operadora).toBe('GEOPARK')
  })

  it('desactivar la saca de la lista; crear el mismo año la reactiva con los valores nuevos', async () => {
    expect((await pedir('DELETE', `/api/liquidaciones-servicios/tarifas/${tarifaId}`, operaciones.token)).statusCode).toBe(200)
    const activas = (await pedir('GET', `/api/liquidaciones-servicios/tarifas?cliente_id=${clienteA}`, operaciones.token)).json()
    expect(activas).toHaveLength(0)
    const todas = (await pedir('GET', `/api/liquidaciones-servicios/tarifas?cliente_id=${clienteA}&incluir_inactivas=1`, operaciones.token)).json()
    expect(todas).toHaveLength(1)
    expect(todas[0].activo).toBe(false)

    const r = await pedir('POST', '/api/liquidaciones-servicios/tarifas', operaciones.token, { cliente_id: clienteA, anio: 2026, ...VALORES, valor_24h: 1_200_000 })
    expect(r.statusCode, r.body).toBe(201)
    expect(r.json().id).toBe(tarifaId)
    expect(r.json().activo).toBe(true)
    expect(Number(r.json().valor_24h)).toBe(1_200_000)
  })

  it('una tarifa inexistente es 404', async () => {
    expect((await pedir('PUT', `/api/liquidaciones-servicios/tarifas/${randomUUID()}`, operaciones.token, { valor_24h: 1 })).statusCode).toBe(404)
  })
})
