/**
 * Combustible de punta a punta: rutas, permisos, el rendimiento que devuelve
 * la API, las validaciones que rechazan un tanqueo, el comprobante y el CSV.
 *
 * Contra la base desechable, con S3 simulado: el bucket del `.env` es el de
 * producción. Lo que se fija:
 *
 *  - permisos: leer con `combustible` en `read`, escribir solo con `full`;
 *  - el rendimiento se mide de lleno a lleno y los parciales suman al tramo;
 *  - odómetro que retrocede (o que supera al siguiente), galones o valor en
 *    cero y el doble registro se rechazan con su código;
 *  - editar recalcula y eliminar es lógico (la fila sigue en la base).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import multipart from '@fastify/multipart'
import jwt from 'jsonwebtoken'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { env } from '../src/config/env'
import { olvidarSesionesEnCache } from '../src/middlewares/cache-sesiones'
import { registrarSesion } from './helpers/sesion-prueba'
import { combustibleRoutes } from '../src/modules/combustible/combustible.routes'

const { subidas } = vi.hoisted(() => ({ subidas: [] as string[] }))
vi.mock('../src/config/aws', () => ({
  uploadToS3: vi.fn(async (key: string) => {
    subidas.push(key)
    return key
  }),
  getS3SignedUrl: vi.fn(async (key: string) => `https://firmada.test/${key}`),
}))

const prisma = new PrismaClient()
const MARCA = 'zztest-combustible'
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

let operaciones: { id: string; token: string }
let contabilidad: { id: string; token: string }
let facturacion: { id: string; token: string }
let vehiculo: string
let conductor: string
const ids: string[] = []

const tanqueo = (extra: Record<string, unknown>) => ({
  vehiculo_id: vehiculo,
  conductor_id: conductor,
  tipo_combustible: 'DIESEL',
  estacion: 'EDS Prueba',
  medio_pago: 'TARJETA',
  ...extra,
})

beforeAll(async () => {
  process.env.PERMISSIONS_MODE = 'enforce'
  app = Fastify()
  await app.register(multipart as any)
  await app.register(combustibleRoutes, { prefix: '/api' })
  await app.ready()
  operaciones = await crearUsuario(['operaciones'])
  contabilidad = await crearUsuario(['contabilidad'])
  facturacion = await crearUsuario(['facturacion'])
  vehiculo = randomUUID()
  await prisma.vehiculos.create({
    data: { id: vehiculo, placa: `ZZ${vehiculo.slice(0, 6).toUpperCase()}`, marca: MARCA, clase_vehiculo: 'CAMIONETA', combustible: 'DIESEL', kilometraje: 9_900, created_at: new Date(), updated_at: new Date() } as any,
  })
  conductor = randomUUID()
  await prisma.conductores.create({
    data: { id: conductor, nombre: 'Conductor', apellido: MARCA, tipo_identificacion: 'CC', created_at: new Date(), updated_at: new Date() } as any,
  })
})

beforeEach(() => {
  process.env.PERMISSIONS_MODE = 'enforce'
  olvidarSesionesEnCache()
})

afterAll(async () => {
  const usuarios = (await prisma.usuarios.findMany({ where: { correo: { contains: MARCA } }, select: { id: true } })).map((u) => u.id)
  await prisma.combustible_tanqueo.deleteMany({ where: { vehiculo_id: vehiculo } })
  await prisma.conductores.deleteMany({ where: { id: conductor } })
  await prisma.vehiculos.deleteMany({ where: { id: vehiculo } })
  await prisma.sesiones.deleteMany({ where: { usuario_id: { in: usuarios } } })
  await prisma.usuarios.deleteMany({ where: { id: { in: usuarios } } })
  await app.close()
  await prisma.$disconnect()
})

describe('permisos', () => {
  it('sin el módulo no entra; con `read` lee pero no escribe', async () => {
    expect((await pedir('GET', '/api/combustible/tanqueos', facturacion.token)).statusCode).toBe(403)
    expect((await pedir('GET', '/api/combustible/tanqueos', contabilidad.token)).statusCode).toBe(200)
    const r = await pedir('POST', '/api/combustible/tanqueos', contabilidad.token, tanqueo({ fecha_hora: '2026-09-01T08:00', kilometraje: 10_000, galones: 40, valor_total: 640_000, tanque_lleno: true }))
    expect(r.statusCode).toBe(403)
  })
  it('un id mal formado es 400, no 500', async () => {
    expect((await pedir('DELETE', '/api/combustible/tanqueos/no-es-uuid', operaciones.token)).statusCode).toBe(400)
  })
})

describe('registrar y medir', () => {
  it('lleno, parcial y lleno: el tramo suma los galones del parcial', async () => {
    const pasos = [
      { fecha_hora: '2026-09-01T08:00', kilometraje: 10_000, galones: 40, valor_total: 640_000, tanque_lleno: true },
      { fecha_hora: '2026-09-03T12:30', kilometraje: 10_200, galones: 8, valor_total: 128_000, tanque_lleno: false },
      { fecha_hora: '2026-09-05T18:15', kilometraje: 10_600, galones: 22, valor_total: 352_000, tanque_lleno: true },
    ]
    for (const p of pasos) {
      const r = await pedir('POST', '/api/combustible/tanqueos', operaciones.token, tanqueo(p))
      expect(r.statusCode, r.body).toBe(201)
      ids.push(r.json().data.id)
    }
    const ultimo = (await pedir('GET', `/api/combustible/tanqueos?vehiculo_id=${vehiculo}`, contabilidad.token)).json()
    expect(ultimo.meta.total).toBe(3)
    const [lleno2, parcial, lleno1] = ultimo.data
    expect(lleno1.rendimiento.estado).toBe('inicio')
    expect(parcial.rendimiento.estado).toBe('parcial')
    expect(lleno2.rendimiento.estado).toBe('medido')
    expect(lleno2.rendimiento.km_recorridos).toBe(600)
    expect(lleno2.rendimiento.galones_tramo).toBe(30)
    expect(lleno2.rendimiento.rendimiento).toBeCloseTo(20)
    expect(lleno2.precio_galon).toBeCloseTo(16_000)
    expect(lleno2.conductor.nombre).toContain(MARCA)
    /// La hora local entra en Bogotá: 18:15 en Colombia son las 23:15 UTC.
    expect(lleno2.fecha_hora).toBe('2026-09-05T23:15:00.000Z')
    expect(ultimo.resumen).toMatchObject({ tanqueos: 3, galones: 70, gasto: 1_120_000, km_recorridos: 600, alertas: 0 })
    expect(ultimo.resumen.rendimiento).toBeCloseTo(20)
  })

  it('rechaza el odómetro que retrocede', async () => {
    const r = await pedir('POST', '/api/combustible/tanqueos', operaciones.token, tanqueo({ fecha_hora: '2026-09-06T08:00', kilometraje: 10_500, galones: 10, valor_total: 160_000, tanque_lleno: false }))
    expect(r.statusCode).toBe(409)
    expect(r.json().code).toBe('KM_RETROCEDE')
  })

  it('rechaza el registrado tarde que supera al siguiente', async () => {
    const r = await pedir('POST', '/api/combustible/tanqueos', operaciones.token, tanqueo({ fecha_hora: '2026-09-04T08:00', kilometraje: 10_700, galones: 5, valor_total: 80_000, tanque_lleno: false }))
    expect(r.statusCode).toBe(409)
    expect(r.json().code).toBe('KM_SUPERA_SIGUIENTE')
  })

  it('rechaza galones o valor en cero', async () => {
    for (const malo of [{ galones: 0, valor_total: 100_000 }, { galones: 10, valor_total: 0 }]) {
      const r = await pedir('POST', '/api/combustible/tanqueos', operaciones.token, tanqueo({ fecha_hora: '2026-09-07T08:00', kilometraje: 10_900, tanque_lleno: true, ...malo }))
      expect(r.statusCode).toBe(400)
    }
  })

  it('rechaza el mismo vehículo a la misma hora (doble registro)', async () => {
    const r = await pedir('POST', '/api/combustible/tanqueos', operaciones.token, tanqueo({ fecha_hora: '2026-09-05T18:15', kilometraje: 10_600, galones: 22, valor_total: 352_000, tanque_lleno: true }))
    expect(r.statusCode).toBe(409)
    expect(r.json().code).toBe('TANQUEO_DUPLICADO')
  })

  it('el contexto da el tanqueo anterior, el siguiente y el km de la ficha', async () => {
    const r = await pedir('GET', `/api/combustible/vehiculos/${vehiculo}/contexto?fecha_hora=2026-09-04T08:00`, operaciones.token)
    expect(r.statusCode).toBe(200)
    const d = r.json().data
    expect(d.anterior.kilometraje).toBe(10_200)
    expect(d.siguiente.kilometraje).toBe(10_600)
    expect(d.vehiculo.kilometraje_ficha).toBe(9_900)
    expect(d.vehiculo.combustible).toBe('DIESEL')
  })
})

describe('editar, comprobante, rendimiento por vehículo y CSV', () => {
  it('editar el odómetro recalcula el rendimiento', async () => {
    const r = await pedir('PUT', `/api/combustible/tanqueos/${ids[2]}`, operaciones.token, tanqueo({ fecha_hora: '2026-09-05T18:15', kilometraje: 10_900, galones: 22, valor_total: 352_000, tanque_lleno: true }))
    expect(r.statusCode, r.body).toBe(200)
    expect(r.json().data.rendimiento.rendimiento).toBeCloseTo(30)
  })

  it('sube el comprobante a S3 bajo el vehículo y el tanqueo, y firma su URL', async () => {
    const limite = '----zz' + Date.now()
    const cuerpo = Buffer.concat([
      Buffer.from(`--${limite}\r\nContent-Disposition: form-data; name="archivo"; filename="factura.pdf"\r\nContent-Type: application/pdf\r\n\r\n`),
      Buffer.from('%PDF-1.4 prueba'),
      Buffer.from(`\r\n--${limite}--\r\n`),
    ])
    const r = await app.inject({
      method: 'POST',
      url: `/api/combustible/tanqueos/${ids[2]}/comprobante`,
      payload: cuerpo,
      headers: { authorization: `Bearer ${operaciones.token}`, 'content-type': `multipart/form-data; boundary=${limite}` },
    })
    expect(r.statusCode, r.body).toBe(200)
    expect(r.json().data.comprobante.nombre).toBe('factura.pdf')
    expect(subidas.at(-1)).toMatch(new RegExp(`^combustible/${vehiculo}/${ids[2]}/[0-9a-f-]+\\.pdf$`))
    const url = await pedir('GET', `/api/combustible/tanqueos/${ids[2]}/comprobante/url`, contabilidad.token)
    expect(url.json().data.url).toContain('https://firmada.test/combustible/')
  })

  it('rendimiento por vehículo en el periodo', async () => {
    const r = await pedir('GET', `/api/combustible/rendimiento?desde=2026-09-01&hasta=2026-09-30&vehiculo_id=${vehiculo}`, contabilidad.token)
    expect(r.statusCode).toBe(200)
    const [v] = r.json().vehiculos
    expect(v.tanqueos).toBe(3)
    expect(v.km_recorridos).toBe(900)
    expect(v.rendimiento).toBeCloseTo(30)
    expect(v.costo_km).toBeCloseTo(480_000 / 900)
  })

  it('exporta CSV con BOM, punto y coma y coma decimal', async () => {
    const r = await pedir('GET', `/api/combustible/tanqueos/exportar?vehiculo_id=${vehiculo}`, contabilidad.token)
    expect(r.statusCode).toBe(200)
    expect(r.headers['content-type']).toContain('text/csv')
    const lineas = r.body.split('\r\n')
    expect(lineas[0].startsWith('﻿"Fecha";"Hora";"Placa"')).toBe(true)
    expect(lineas).toHaveLength(4)
    expect(lineas[1]).toContain('"30,00"')
  })

  it('eliminar es lógico: sale de la lista y la fila queda marcada', async () => {
    const r = await pedir('DELETE', `/api/combustible/tanqueos/${ids[1]}`, operaciones.token)
    expect(r.statusCode).toBe(200)
    const lista = (await pedir('GET', `/api/combustible/tanqueos?vehiculo_id=${vehiculo}`, operaciones.token)).json()
    expect(lista.meta.total).toBe(2)
    const fila = await prisma.combustible_tanqueo.findUnique({ where: { id: ids[1] } })
    expect(fila?.deleted_at).not.toBeNull()
    /// Sin el parcial, el tramo vuelve a ser solo el lleno final: 900 km / 22 gal.
    expect(lista.data[0].rendimiento.rendimiento).toBeCloseTo(900 / 22)
  })
})
