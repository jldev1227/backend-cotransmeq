/**
 * Mantenimiento de flota de punta a punta: rutas, permisos, el ciclo de una
 * orden que mueve su plan, los costos, el aviso diario y el aviso inmediato
 * de un preoperacional con ítems en «Malo».
 *
 * Contra la base desechable, con S3 y sockets simulados: el bucket del `.env`
 * es el de producción, y un aviso emitido de verdad saldría por Web Push a un
 * navegador suscrito. Lo que se fija:
 *
 *  - permisos: leer con `mantenimiento` en `read`, escribir solo con `full`;
 *  - un plan se aplica a varios vehículos a la vez y no se duplica al
 *    reaplicarlo;
 *  - cerrar una preventiva deja el plan apuntando a ella y recalcula el
 *    próximo; cerrar y anular son terminales;
 *  - una orden cerrada suma al costo del periodo; una anulada no;
 *  - el cron avisa una vez por plan y estado, y no repite;
 *  - el preoperacional con «Malo» avisa a mantenimiento una sola vez.
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
import { mantenimientoRoutes } from '../src/modules/mantenimiento/mantenimiento.routes'
import { hoyColombia } from '../src/modules/mantenimiento/mantenimiento.service'
import { sumarDias, sumarMeses } from '../src/modules/mantenimiento/calculo'
import { avisarPlanesMantenimiento } from '../src/jobs/mantenimiento-planes.cron'
import { avisarNovedadesPreoperacional, textoAvisoMalo } from '../src/modules/mantenimiento/aviso-preoperacional'
import { seccionMantenimiento } from '../src/modules/dashboard/seccion-mantenimiento'
import { resolverPeriodo } from '../src/modules/dashboard/periodo'
import { getAccessibleModules } from '../src/config/permissions'

const { subidas, emitidas } = vi.hoisted(() => ({ subidas: [] as string[], emitidas: [] as any[] }))
vi.mock('../src/config/aws', () => ({
  uploadToS3: vi.fn(async (key: string) => {
    subidas.push(key)
    return key
  }),
  getS3SignedUrl: vi.fn(async (key: string) => `https://firmada.test/${key}`),
}))
vi.mock('../src/sockets', () => ({ emitNotificacion: vi.fn((n: any) => emitidas.push(n)) }))

const prisma = new PrismaClient()
const MARCA = 'zztest-mantenimiento'
const HOY = hoyColombia()
let app: FastifyInstance

async function crearUsuario(areas: string[], role = 'usuario') {
  const id = randomUUID()
  await prisma.usuarios.create({
    data: {
      id,
      nombre: `Prueba ${areas.join('+')}`,
      correo: `${MARCA}-${id.slice(0, 8)}@example.test`,
      password: 'no-se-usa',
      role,
      area: areas,
      activo: true,
      created_at: new Date(),
      updated_at: new Date(),
    } as any,
  })
  const token = jwt.sign({ sub: id, id, role, area: areas }, env.JWT_SECRET, { expiresIn: '1h' })
  await registrarSesion(id, token)
  return { id, token }
}

async function crearVehiculo(kilometraje: number) {
  const id = randomUUID()
  await prisma.vehiculos.create({
    data: { id, placa: `ZZ${id.slice(0, 6).toUpperCase()}`, marca: MARCA, clase_vehiculo: 'BUS', kilometraje, created_at: new Date(), updated_at: new Date() } as any,
  })
  return id
}

const pedir = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, token: string, payload?: unknown) =>
  app.inject({ method, url, payload: payload as any, headers: { authorization: `Bearer ${token}` } })

let mant: { id: string; token: string }
let lector: { id: string; token: string }
let ajeno: { id: string; token: string }
let vehiculoA: string
let vehiculoB: string
let planA: string
let planB: string
let ordenA: string

beforeAll(async () => {
  process.env.PERMISSIONS_MODE = 'enforce'
  app = Fastify()
  await app.register(multipart as any)
  await app.register(mantenimientoRoutes, { prefix: '/api' })
  await app.ready()
  mant = await crearUsuario(['mantenimiento'])
  lector = await crearUsuario(['operaciones'])
  ajeno = await crearUsuario(['contabilidad'])
  vehiculoA = await crearVehiculo(14_700)
  vehiculoB = await crearVehiculo(20_500)
})

beforeEach(() => {
  process.env.PERMISSIONS_MODE = 'enforce'
  olvidarSesionesEnCache()
})

afterAll(async () => {
  const usuarios = (await prisma.usuarios.findMany({ where: { correo: { contains: MARCA } }, select: { id: true } })).map((u) => u.id)
  const vehiculos = [vehiculoA, vehiculoB]
  await prisma.notificacion.deleteMany({ where: { usuario_id: { in: usuarios } } })
  await prisma.vehicle_maintenance_attachment.deleteMany({ where: { evento: { vehiculo_id: { in: vehiculos } } } })
  await prisma.vehicle_maintenance_event.deleteMany({ where: { vehiculo_id: { in: vehiculos } } })
  await prisma.vehicle_maintenance_plan.deleteMany({ where: { vehiculo_id: { in: vehiculos } } })
  const defs = (await prisma.form_definition.findMany({ where: { slug: { startsWith: MARCA } }, select: { id: true } })).map((d) => d.id)
  if (defs.length) {
    const subs = (await prisma.form_submission.findMany({ where: { version: { form_id: { in: defs } } }, select: { id: true } })).map((s) => s.id)
    await prisma.form_answer.deleteMany({ where: { submission_id: { in: subs } } })
    await prisma.form_submission.deleteMany({ where: { id: { in: subs } } })
    await prisma.form_assignment.deleteMany({ where: { version: { form_id: { in: defs } } } })
    await prisma.form_definition.deleteMany({ where: { id: { in: defs } } })
  }
  await prisma.vehiculos.deleteMany({ where: { id: { in: vehiculos } } })
  await prisma.sesiones.deleteMany({ where: { usuario_id: { in: usuarios } } })
  await prisma.usuarios.deleteMany({ where: { id: { in: usuarios } } })
  await app.close()
  await prisma.$disconnect()
})

describe('permisos', () => {
  it('sin el módulo no entra; con `read` lee pero no escribe', async () => {
    expect((await pedir('GET', '/api/mantenimiento/resumen', ajeno.token)).statusCode).toBe(403)
    expect((await pedir('GET', '/api/mantenimiento/resumen', lector.token)).statusCode).toBe(200)
    const r = await pedir('POST', '/api/mantenimiento/planes', lector.token, {})
    expect(r.statusCode).toBe(403)
  })
  it('un id mal formado es 400, no 500', async () => {
    expect((await pedir('GET', '/api/mantenimiento/ordenes/no-es-uuid', mant.token)).statusCode).toBe(400)
  })
})

describe('planes', () => {
  it('se aplica un plan a varios vehículos a la vez, cada uno con su punto de partida', async () => {
    const r = await pedir('POST', '/api/mantenimiento/planes', mant.token, {
      categoria: 'CAMBIO_ACEITE',
      nombre: 'Cambio de aceite',
      periodicidad_km: 5000,
      periodicidad_meses: 3,
      vehiculos: [
        { vehiculo_id: vehiculoA, ultima_ejecucion_km: 10_000, ultima_ejecucion_fecha: sumarDias(HOY, -10) },
        { vehiculo_id: vehiculoB, ultima_ejecucion_km: 18_000, ultima_ejecucion_fecha: sumarDias(HOY, -100) },
      ],
    })
    expect(r.statusCode).toBe(201)
    expect(r.json().data.creados).toBe(2)

    const lista = (await pedir('GET', `/api/mantenimiento/planes?q=${MARCA}`, lector.token)).json().data
    const a = lista.items.find((p: any) => p.vehiculo.id === vehiculoA)
    const b = lista.items.find((p: any) => p.vehiculo.id === vehiculoB)
    planA = a.id
    planB = b.id
    /// A: 14.700 de 15.000 → faltan 300 km, dentro del umbral de 500.
    expect(a).toMatchObject({ proximo_km: 15_000, km_restantes: 300, estado: 'proximo', motivo: 'km', proxima_fecha: sumarMeses(sumarDias(HOY, -10), 3) })
    /// B: la fecha (hace 100 días + 3 meses) ya pasó aunque le falten km.
    expect(b).toMatchObject({ proximo_km: 23_000, estado: 'vencido', motivo: 'fecha' })
    /// Vencido antes que próximo.
    expect(lista.items.findIndex((p: any) => p.id === planB)).toBeLessThan(lista.items.findIndex((p: any) => p.id === planA))
    expect(lista.conteos).toMatchObject({ vencido: 1, proximo: 1 })
  })

  it('reaplicarlo no se lo duplica a quien ya lo tenía', async () => {
    const r = await pedir('POST', '/api/mantenimiento/planes', mant.token, {
      categoria: 'CAMBIO_ACEITE',
      nombre: 'cambio de ACEITE',
      periodicidad_km: 5000,
      vehiculos: [{ vehiculo_id: vehiculoA }],
    })
    expect(r.json().data).toMatchObject({ creados: 0, omitidos: [{ vehiculo_id: vehiculoA, motivo: 'Ya tiene este plan' }] })
  })

  it('sin periodicidad no hay plan', async () => {
    const r = await pedir('POST', '/api/mantenimiento/planes', mant.token, { categoria: 'FRENOS', nombre: 'Frenos', vehiculos: [{ vehiculo_id: vehiculoA }] })
    expect(r.statusCode).toBe(422)
  })
})

describe('órdenes de trabajo', () => {
  it('abrir una preventiva calcula los costos y no deja abrir otra para el mismo plan', async () => {
    const r = await pedir('POST', '/api/mantenimiento/ordenes', mant.token, {
      tipo: 'PREVENTIVO',
      plan_id: planA,
      descripcion: 'Cambio de aceite y filtro',
      fecha: HOY,
      km: 14_700,
      taller: 'Lubricentro El Llano',
      repuestos: [
        { descripcion: 'Aceite 15W40 (galón)', cantidad: 4, valor_unitario: 45_000.5 },
        { descripcion: 'Filtro de aceite', cantidad: '1', valor_unitario: '38000' },
      ],
      costo_mano_obra: '60000',
    })
    expect(r.statusCode).toBe(201)
    const o = r.json().data
    ordenA = o.id
    expect(o).toMatchObject({ estado: 'PROGRAMADO', tipo: 'PREVENTIVO', costo_repuestos: 218_002, costo_mano_obra: 60_000, costo: 278_002 })
    expect(o.vehiculo.id).toBe(vehiculoA)
    expect(o.consecutivo).toBeGreaterThan(0)

    const otra = await pedir('POST', '/api/mantenimiento/ordenes', mant.token, { tipo: 'PREVENTIVO', plan_id: planA, descripcion: 'Doble clic' })
    expect(otra.statusCode).toBe(409)
    expect(otra.json().code).toBe('ORDEN_ABIERTA_EXISTE')
    /// La lista de planes ofrece la orden abierta en vez de «crear orden».
    const plan = (await pedir('GET', `/api/mantenimiento/planes/${planA}`, lector.token)).json().data
    expect(plan.orden_abierta).toMatchObject({ id: ordenA, estado: 'PROGRAMADO' })
  })

  it('adjuntos: sube a S3 bajo la carpeta del vehículo, firma la URL y borra en lógico', async () => {
    const limite = `----limite${randomUUID()}`
    const payload = Buffer.concat([
      Buffer.from(`--${limite}\r\nContent-Disposition: form-data; name="tipo"\r\n\r\nFACTURA\r\n`),
      Buffer.from(`--${limite}\r\nContent-Disposition: form-data; name="archivo"; filename="factura.pdf"\r\nContent-Type: application/pdf\r\n\r\n`),
      Buffer.from('%PDF-1.4\n%%EOF\n'),
      Buffer.from(`\r\n--${limite}--\r\n`),
    ])
    const r = await app.inject({
      method: 'POST',
      url: `/api/mantenimiento/ordenes/${ordenA}/adjuntos`,
      payload,
      headers: { 'content-type': `multipart/form-data; boundary=${limite}`, authorization: `Bearer ${mant.token}` },
    })
    expect(r.statusCode).toBe(201)
    const adj = r.json().data
    expect(adj).toMatchObject({ tipo: 'FACTURA', nombre: 'factura.pdf' })
    expect(subidas.at(-1)).toMatch(new RegExp(`^vehiculos/${vehiculoA}/mantenimiento/${ordenA}/[0-9a-f-]+\\.pdf$`))
    const url = await pedir('GET', `/api/mantenimiento/ordenes/${ordenA}/adjuntos/${adj.id}/url`, lector.token)
    expect(url.json().data.url).toContain('https://firmada.test/vehiculos/')
    expect((await pedir('DELETE', `/api/mantenimiento/ordenes/${ordenA}/adjuntos/${adj.id}`, mant.token)).statusCode).toBe(200)
    const det = (await pedir('GET', `/api/mantenimiento/ordenes/${ordenA}`, mant.token)).json().data
    expect(det.adjuntos_detalle).toHaveLength(0)
    expect(await prisma.vehicle_maintenance_attachment.count({ where: { id: adj.id } })).toBe(1)
  })

  it('en curso → cerrada: el plan apunta a la orden y recalcula el próximo', async () => {
    expect((await pedir('POST', `/api/mantenimiento/ordenes/${ordenA}/estado`, mant.token, { estado: 'EN_CURSO' })).json().data.estado).toBe('EN_CURSO')
    const futura = await pedir('POST', `/api/mantenimiento/ordenes/${ordenA}/estado`, mant.token, { estado: 'EJECUTADO', fecha_ejecucion: sumarDias(HOY, 2), km_ejecucion: 14_800 })
    expect(futura.statusCode).toBe(422)

    const r = await pedir('POST', `/api/mantenimiento/ordenes/${ordenA}/estado`, mant.token, { estado: 'EJECUTADO', fecha_ejecucion: HOY, km_ejecucion: 14_800 })
    expect(r.statusCode).toBe(200)
    expect(r.json().data).toMatchObject({ estado: 'EJECUTADO', fecha_ejecucion: HOY, km_ejecucion: 14_800 })

    const plan = (await pedir('GET', `/api/mantenimiento/planes/${planA}`, mant.token)).json().data
    expect(plan).toMatchObject({
      ultima_ejecucion_km: 14_800,
      ultima_ejecucion_fecha: HOY,
      proximo_km: 19_800,
      proxima_fecha: sumarMeses(HOY, 3),
      ultimo_evento_id: ordenA,
      estado: 'al_dia',
      orden_abierta: null,
    })

    const otraVez = await pedir('POST', `/api/mantenimiento/ordenes/${ordenA}/estado`, mant.token, { estado: 'EJECUTADO' })
    expect(otraVez.statusCode).toBe(409)
    expect(otraVez.json().code).toBe('TRANSICION_INVALIDA')
  })

  it('una cerrada solo admite corregir costos y factura', async () => {
    const r = await pedir('PATCH', `/api/mantenimiento/ordenes/${ordenA}`, mant.token, { numero_factura: 'FE-1234', costo_mano_obra: 70_000, km: 1 })
    expect(r.json().data).toMatchObject({ numero_factura: 'FE-1234', costo_mano_obra: 70_000, costo: 288_002, km: 14_700 })
  })

  it('anular pide motivo, y una anulada no suma al costo', async () => {
    const c = (await pedir('POST', '/api/mantenimiento/ordenes', mant.token, { tipo: 'CORRECTIVO', vehiculo_id: vehiculoB, descripcion: 'Ruido en la suspensión', costo_mano_obra: 999 })).json().data
    expect((await pedir('POST', `/api/mantenimiento/ordenes/${c.id}/estado`, mant.token, { estado: 'CANCELADO' })).statusCode).toBe(422)
    const r = await pedir('POST', `/api/mantenimiento/ordenes/${c.id}/estado`, mant.token, { estado: 'CANCELADO', motivo: 'Era el mismo reporte de ayer' })
    expect(r.json().data).toMatchObject({ estado: 'CANCELADO', motivo_anulacion: 'Era el mismo reporte de ayer' })

    const costos = (await pedir('GET', `/api/mantenimiento/costos?desde=${HOY.slice(0, 7)}-01&hasta=${HOY}`, lector.token)).json().data
    const fila = costos.por_vehiculo.find((v: any) => v.vehiculo_id === vehiculoA)
    expect(fila).toMatchObject({ ordenes: 1, preventivas: 1, repuestos: 218_002, mano_obra: 70_000, total: 288_002 })
    expect(costos.por_vehiculo.find((v: any) => v.vehiculo_id === vehiculoB)).toBeUndefined()

    const ficha = (await pedir('GET', `/api/mantenimiento/vehiculos/${vehiculoA}`, lector.token)).json().data
    expect(ficha.costos.anio_actual).toEqual({ total: 288_002, ordenes: 1 })
    expect(ficha.planes).toHaveLength(1)

    const abiertas = (await pedir('GET', `/api/mantenimiento/ordenes?estado=abiertas&vehiculo_id=${vehiculoB}`, lector.token)).json().data
    expect(abiertas.total).toBe(0)
    expect(abiertas.conteos.CANCELADO).toBe(1)
  })
})

describe('avisos', () => {
  it('el cron avisa una vez por plan y estado, a mantenimiento y administración', async () => {
    emitidas.length = 0
    await avisarPlanesMantenimiento()
    const mias = await prisma.notificacion.findMany({ where: { usuario_id: mant.id, referencia_id: planB } })
    expect(mias).toHaveLength(1)
    expect(mias[0].referencia_tipo).toMatch(/^mant:vencido:23000:\d{4}-\d{2}-\d{2}$/)
    expect(mias[0].titulo).toContain('Mantenimiento vencido: Cambio de aceite')
    /// El plan A quedó al día al cerrar su orden: no avisa.
    expect(await prisma.notificacion.count({ where: { referencia_id: planA } })).toBe(0)
    /// Operaciones no está entre los destinatarios.
    expect(await prisma.notificacion.count({ where: { usuario_id: lector.id } })).toBe(0)
    expect(emitidas.some((n) => n.usuario_id === mant.id)).toBe(true)

    await avisarPlanesMantenimiento()
    expect(await prisma.notificacion.count({ where: { usuario_id: mant.id, referencia_id: planB } })).toBe(1)
  })

  it('un preoperacional con ítems en «Malo» avisa a mantenimiento una sola vez', async () => {
    const autor = mant.id
    const def = await prisma.form_definition.create({ data: { code: 'HSEQ-FR-08', slug: `${MARCA}-preop`, name: 'Preoperacional livianos', created_by_id: autor } as any })
    const ver = await prisma.form_version.create({ data: { form_id: def.id, version_number: 1, title: 'Preoperacional', status: 'PUBLISHED', created_by_id: autor } as any })
    const sec = await prisma.form_section.create({ data: { version_id: ver.id, key: 'frenos', title: 'Frenos', sort_order: 1 } as any })
    const campo = await prisma.form_field.create({ data: { version_id: ver.id, section_id: sec.id, key: 'frenos', type: 'single_choice', label: 'Frenos (pastillas y líquido)', sort_order: 1 } as any })
    const obs = await prisma.form_field.create({ data: { version_id: ver.id, section_id: sec.id, key: 'frenos_obs', type: 'text', label: 'Observación', sort_order: 2 } as any })
    const luces = await prisma.form_field.create({ data: { version_id: ver.id, section_id: sec.id, key: 'luces', type: 'single_choice', label: 'Luces', sort_order: 3 } as any })
    const malo = await prisma.form_field_option.create({ data: { field_id: campo.id, value: 'M', label: 'Malo', sort_order: 2 } as any })
    const bueno = await prisma.form_field_option.create({ data: { field_id: luces.id, value: 'B', label: 'Bueno', sort_order: 1 } as any })
    const asig = await prisma.form_assignment.create({ data: { version_id: ver.id, name: 'Preoperacional', created_by_id: autor } as any })
    const envio = await prisma.form_submission.create({
      data: { client_submission_id: randomUUID(), assignment_id: asig.id, version_id: ver.id, business_date: new Date(`${HOY}T00:00:00Z`), status: 'SUBMITTED', vehicle_id: vehiculoB, usuario_id: autor, submitted_at: new Date() } as any,
    })
    const r1 = await prisma.form_answer.create({ data: { submission_id: envio.id, field_id: campo.id } as any })
    await prisma.form_answer_option.create({ data: { answer_id: r1.id, option_id: malo.id } })
    await prisma.form_answer.create({ data: { submission_id: envio.id, field_id: obs.id, value_text: 'Pastillas gastadas' } as any })
    const r3 = await prisma.form_answer.create({ data: { submission_id: envio.id, field_id: luces.id } as any })
    await prisma.form_answer_option.create({ data: { answer_id: r3.id, option_id: bueno.id } })

    const primero = await avisarNovedadesPreoperacional(envio.id)
    expect(primero.items).toBe(1)
    expect(primero.avisos).toBeGreaterThanOrEqual(1)
    const aviso = await prisma.notificacion.findFirst({ where: { usuario_id: mant.id, referencia_id: envio.id } })
    expect(aviso).toMatchObject({ referencia_tipo: 'preop_malo' })
    expect(aviso?.titulo).toContain('1 ítem en Malo')
    expect(aviso?.mensaje).toContain('Frenos («Pastillas gastadas»)')
    /// Solo mantenimiento: ni administración ni operaciones reciben este.
    expect(await prisma.notificacion.count({ where: { usuario_id: lector.id, referencia_id: envio.id } })).toBe(0)

    expect((await avisarNovedadesPreoperacional(envio.id)).avisos).toBe(0)

    /// Mantenimiento lo abre por su módulo, sin el permiso de `formularios`.
    const det = await pedir('GET', `/api/mantenimiento/preoperacionales/${envio.id}`, mant.token)
    expect(det.statusCode).toBe(200)
    expect(det.json().data).toMatchObject({ vehiculo: { id: vehiculoB }, items: [{ key: 'frenos', label: 'Frenos', observacion: 'Pastillas gastadas' }] })
  })

  it('la sección del panel: planes por atender y sin enlaces a `formularios` para quien no lo tiene', async () => {
    const periodo = resolverPeriodo({ desde: `${HOY.slice(0, 7)}-01`, hasta: HOY })
    const comoMantenimiento = (await seccionMantenimiento({
      periodo,
      modulos: getAccessibleModules(['mantenimiento'], null, mant.id),
      user: { id: mant.id, role: 'usuario', area: ['mantenimiento'] },
    })) as any
    expect(comoMantenimiento.planes.items.some((p: any) => p.id === planB && p.estado === 'vencido')).toBe(true)
    expect(comoMantenimiento.planes.items.find((p: any) => p.id === planB).enlace).toBe(`/dashboard/mantenimiento?plan=${planB}`)
    expect(comoMantenimiento.enlaces.envios).toBeNull()
    const suyo = comoMantenimiento.estado_vehiculos.find((v: any) => v.vehiculo_id === vehiculoB)
    expect(suyo.enlace).toBe(`/dashboard/flota?vehiculo=${vehiculoB}&tab=mantenimiento`)
    expect(suyo.enlace_preoperacional).toMatch(/^\/dashboard\/mantenimiento\?preoperacional=/)

    const comoAdmin = (await seccionMantenimiento({
      periodo,
      modulos: getAccessibleModules(['administracion'], null, 'x'),
      user: { id: 'x', role: 'admin', area: ['administracion'] },
    })) as any
    expect(comoAdmin.enlaces.envios).toBe('/dashboard/formularios?vista=envios')
    expect(comoAdmin.estado_vehiculos.find((v: any) => v.vehiculo_id === vehiculoB).enlace_preoperacional).toMatch(/^\/dashboard\/formularios\/envios\//)
  })

  it('el texto resume los ítems y corta a los cuatro primeros', () => {
    const items = ['A', 'B', 'C', 'D', 'E', 'F'].map((l) => ({ key: l, label: l, observacion: null }))
    const t = textoAvisoMalo({ placa: 'ABC123', conductor: 'Ana Pérez', fecha: '2026-10-10', items })
    expect(t.titulo).toBe('🔧 6 ítems en Malo · ABC123')
    expect(t.mensaje).toContain('A, B, C, D y 2 más')
  })
})
