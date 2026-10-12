/**
 * Incidentes de punta a punta: rutas, permisos, el ciclo reporte →
 * investigación → cierre, las evidencias, las acciones correctivas que salen
 * de la investigación, los avisos y el recordatorio de los 15 días.
 *
 * Contra la base desechable, con S3 y sockets simulados: el bucket del `.env`
 * es el de producción, y un aviso emitido de verdad saldría por Web Push a un
 * navegador suscrito. Lo que se fija:
 *
 *  - permisos: leer con `incidentes` en `read`, escribir solo con `full`;
 *  - el reporte rechaza combinaciones imposibles (casi-accidente con heridos);
 *  - el aviso del reporte llega a HSEQ y administración, y a talento humano
 *    solo si hubo lesionados; quien reporta no se avisa a sí mismo;
 *  - no se cierra sin investigar ni con la investigación incompleta;
 *  - la acción creada desde la investigación nace en el módulo de acciones
 *    con la fuente «Investigación de Incidente/Accidente» y queda vinculada;
 *  - el recordatorio sale a los 15 días, una sola vez, y nunca para un cerrado;
 *  - borrar es lógico: el reporte desaparece de las lecturas.
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
import { incidentesRoutes } from '../src/modules/incidentes/incidentes.routes'
import { hoyColombia, sumarDias } from '../src/modules/incidentes/incidentes.dominio'
import { HUELLA_RECORDATORIO, recordarInvestigacionesPendientes } from '../src/jobs/incidentes-investigacion.cron'

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
const MARCA = 'zztest-incidentes'
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

const pedir = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, token: string, payload?: unknown, headers: Record<string, string> = {}) =>
  app.inject({ method, url, payload: payload as any, headers: { authorization: `Bearer ${token}`, ...headers } })

/** Cuerpo multipart a mano: `inject` no arma formularios. */
function multipartDe(campos: Record<string, string>, archivo: { nombre: string; tipo: string; contenido: Buffer }) {
  const limite = `----zz${randomUUID()}`
  const partes: Buffer[] = []
  for (const [k, v] of Object.entries(campos)) {
    partes.push(Buffer.from(`--${limite}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`))
  }
  partes.push(
    Buffer.from(`--${limite}\r\nContent-Disposition: form-data; name="archivo"; filename="${archivo.nombre}"\r\nContent-Type: ${archivo.tipo}\r\n\r\n`),
    archivo.contenido,
    Buffer.from(`\r\n--${limite}--\r\n`),
  )
  return { cuerpo: Buffer.concat(partes), tipo: `multipart/form-data; boundary=${limite}` }
}

let hseq: { id: string; token: string }
let hseq2: { id: string; token: string }
let admin: { id: string; token: string }
let talento: { id: string; token: string }
let lector: { id: string; token: string }
let ajeno: { id: string; token: string }
let vehiculoId: string
const incidentes: string[] = []

const reporte = (extra: Record<string, unknown> = {}) => ({
  tipo: 'ACCIDENTE_TRANSITO',
  fecha: HOY,
  hora: '07:45',
  lugar: `${MARCA} vía Yopal–Aguazul km 12`,
  vehiculo_id: vehiculoId,
  descripcion: 'Alcance por detrás en la glorieta; daños en el bómper delantero.',
  severidad: 'SOLO_DANOS',
  heridos: 0,
  fallecidos: 0,
  terceros: [{ nombre: 'Particular', placa: 'XYZ987', aseguradora: 'SOAT Sura' }],
  autoridad: 'Policía de Tránsito',
  numero_informe: 'IPAT-000123',
  costo_directo: 1_250_000,
  ...extra,
})

const avisosDe = (incidenteId: string, referencia_tipo = 'incidente') =>
  prisma.notificacion.findMany({ where: { referencia_id: incidenteId, referencia_tipo }, select: { usuario_id: true } })

beforeAll(async () => {
  process.env.PERMISSIONS_MODE = 'enforce'
  app = Fastify()
  await app.register(multipart as any)
  await app.register(incidentesRoutes, { prefix: '/api' })
  await app.ready()
  hseq = await crearUsuario(['hseq'])
  hseq2 = await crearUsuario(['hseq'])
  admin = await crearUsuario(['administracion'])
  talento = await crearUsuario(['talento_humano'])
  lector = await crearUsuario(['operaciones'])
  ajeno = await crearUsuario(['contabilidad'])
  vehiculoId = randomUUID()
  await prisma.vehiculos.create({
    data: { id: vehiculoId, placa: `ZZ${vehiculoId.slice(0, 4).toUpperCase()}`, marca: MARCA, clase_vehiculo: 'BUS', created_at: new Date(), updated_at: new Date() } as any,
  })
})

beforeEach(() => {
  process.env.PERMISSIONS_MODE = 'enforce'
  olvidarSesionesEnCache()
})

afterAll(async () => {
  const usuarios = (await prisma.usuarios.findMany({ where: { correo: { contains: MARCA } }, select: { id: true } })).map((u) => u.id)
  const propios = (await prisma.pesv_incident.findMany({ where: { lugar: { contains: MARCA } }, select: { id: true } })).map((i) => i.id)
  const acciones = (await prisma.incidente_acciones.findMany({ where: { incidente_id: { in: propios } }, select: { accion_id: true } })).map((a) => a.accion_id)
  await prisma.notificacion.deleteMany({ where: { OR: [{ usuario_id: { in: usuarios } }, { referencia_id: { in: propios } }] } })
  await prisma.incidente_acciones.deleteMany({ where: { incidente_id: { in: propios } } })
  await prisma.acciones_correctivas_preventivas.deleteMany({ where: { id: { in: acciones } } })
  await prisma.incidente_evidencias.deleteMany({ where: { incidente_id: { in: propios } } })
  await prisma.pesv_incident.deleteMany({ where: { id: { in: propios } } })
  await prisma.vehiculos.deleteMany({ where: { id: vehiculoId } })
  await prisma.sesiones.deleteMany({ where: { usuario_id: { in: usuarios } } })
  await prisma.usuarios.deleteMany({ where: { id: { in: usuarios } } })
  await app.close()
  await prisma.$disconnect()
})

describe('permisos', () => {
  it('sin el módulo no entra; con `read` lee pero no reporta', async () => {
    expect((await pedir('GET', '/api/incidentes', ajeno.token)).statusCode).toBe(403)
    expect((await pedir('GET', '/api/incidentes', lector.token)).statusCode).toBe(200)
    expect((await pedir('POST', '/api/incidentes', lector.token, reporte())).statusCode).toBe(403)
  })
  it('un id mal formado es 400, no 500', async () => {
    expect((await pedir('GET', '/api/incidentes/no-es-uuid', hseq.token)).statusCode).toBe(400)
  })
})

describe('reporte', () => {
  it('rechaza un casi-accidente con lesionados', async () => {
    const r = await pedir('POST', '/api/incidentes', hseq.token, reporte({ tipo: 'CASI_ACCIDENTE', severidad: null, heridos: 2 }))
    expect(r.statusCode).toBe(422)
    expect(r.json().code).toBe('REPORTE_INCOHERENTE')
  })

  it('registra el accidente con su radicado y avisa a HSEQ y administración, no a quien reporta', async () => {
    emitidas.length = 0
    const r = await pedir('POST', '/api/incidentes', hseq.token, reporte())
    expect(r.statusCode).toBe(201)
    const d = r.json().data
    incidentes.push(d.id)
    expect(d.codigo).toMatch(/^INC-\d{4,}$/)
    expect(d).toMatchObject({ estado: 'REPORTADO', tipo: 'ACCIDENTE_TRANSITO', numero_informe: 'IPAT-000123', costo_directo: 1_250_000 })
    expect(d.terceros).toHaveLength(1)
    expect(d.plazo).toMatchObject({ limite: sumarDias(HOY, 15), vencido: false })

    const avisados = new Set((await avisosDe(d.id)).map((n) => n.usuario_id))
    expect(avisados.has(hseq2.id)).toBe(true)
    expect(avisados.has(admin.id)).toBe(true)
    expect(avisados.has(hseq.id)).toBe(false)
    expect(avisados.has(talento.id)).toBe(false)
    expect(emitidas.some((n) => n.referencia_id === d.id)).toBe(true)
  })

  it('con lesionados, talento humano también recibe el aviso', async () => {
    const r = await pedir('POST', '/api/incidentes', hseq.token, reporte({ severidad: 'LESION_LEVE', heridos: 1 }))
    expect(r.statusCode).toBe(201)
    incidentes.push(r.json().data.id)
    const avisados = new Set((await avisosDe(r.json().data.id)).map((n) => n.usuario_id))
    expect(avisados.has(talento.id)).toBe(true)
  })

  it('el listado lo encuentra por radicado y por placa, y cuenta por estado', async () => {
    const det = (await pedir('GET', `/api/incidentes/${incidentes[0]}`, lector.token)).json().data
    const porCodigo = (await pedir('GET', `/api/incidentes?q=${det.codigo}`, lector.token)).json()
    expect(porCodigo.items.map((i: any) => i.id)).toEqual([incidentes[0]])
    const porPlaca = (await pedir('GET', `/api/incidentes?q=${det.vehiculo.placa}`, lector.token)).json()
    expect(porPlaca.items.map((i: any) => i.id)).toEqual(expect.arrayContaining(incidentes))
    expect(porPlaca.resumen.REPORTADO).toBeGreaterThanOrEqual(2)
  })
})

describe('evidencias', () => {
  it('sube la evidencia a `incidentes/<id>/evidencias/` y la sirve por URL firmada', async () => {
    const { cuerpo, tipo } = multipartDe({ descripcion: 'Foto del bómper' }, { nombre: 'foto.jpg', tipo: 'image/jpeg', contenido: Buffer.from('jpeg-de-prueba') })
    const r = await pedir('POST', `/api/incidentes/${incidentes[0]}/evidencias`, hseq.token, cuerpo, { 'content-type': tipo })
    expect(r.statusCode).toBe(201)
    expect(subidas.at(-1)).toMatch(new RegExp(`^incidentes/${incidentes[0]}/evidencias/[0-9a-f-]+\\.jpg$`))
    const evId = r.json().data.id
    const url = (await pedir('GET', `/api/incidentes/${incidentes[0]}/evidencias/${evId}/url`, lector.token)).json().data.url
    expect(url).toContain(`incidentes/${incidentes[0]}/evidencias/`)
  })

  it('rechaza lo que no es PDF ni imagen', async () => {
    const { cuerpo, tipo } = multipartDe({}, { nombre: 'x.exe', tipo: 'application/octet-stream', contenido: Buffer.from('MZ') })
    expect((await pedir('POST', `/api/incidentes/${incidentes[0]}/evidencias`, hseq.token, cuerpo, { 'content-type': tipo })).statusCode).toBe(400)
  })
})

describe('investigación y cierre', () => {
  const investigacion = {
    fecha_investigacion: HOY,
    equipo_investigador: [{ nombre: 'Coordinadora HSEQ', cargo: 'SST' }, { nombre: 'Representante COPASST', cargo: 'COPASST' }],
    actos_inseguros: 'No guardó la distancia de seguimiento',
    condiciones_inseguras: 'Vía húmeda',
    factores_personales: 'Fatiga',
    factores_trabajo: 'Turno de 11 horas',
    analisis_porques: ['Frenó tarde', 'Iba cansado', 'Turno largo'],
    causas_identificadas: 'Programación de turnos sin descanso suficiente',
    lecciones_aprendidas: 'Revisar la programación antes de asignar rutas largas',
  }

  it('no se cierra un reporte sin iniciar la investigación', async () => {
    const r = await pedir('POST', `/api/incidentes/${incidentes[0]}/estado`, hseq.token, { accion: 'cerrar', fecha_cierre: HOY, responsable_cierre: 'X' })
    expect(r.statusCode).toBe(409)
  })

  it('iniciar la investigación la pasa a EN_INVESTIGACION y propone la fecha de hoy', async () => {
    const r = await pedir('POST', `/api/incidentes/${incidentes[0]}/estado`, hseq.token, { accion: 'iniciar_investigacion' })
    expect(r.statusCode).toBe(200)
    expect(r.json().data).toMatchObject({ estado: 'EN_INVESTIGACION', investigacion: { fecha_investigacion: HOY } })
    expect((await pedir('POST', `/api/incidentes/${incidentes[0]}/estado`, hseq.token, { accion: 'iniciar_investigacion' })).statusCode).toBe(409)
  })

  it('cerrar con la investigación incompleta devuelve lo que falta', async () => {
    const r = await pedir('POST', `/api/incidentes/${incidentes[0]}/estado`, hseq.token, { accion: 'cerrar' })
    expect(r.statusCode).toBe(422)
    expect(r.json().details).toEqual(expect.arrayContaining(['Equipo investigador (al menos una persona)', 'Fecha de cierre', 'Responsable del cierre']))
  })

  it('guarda la investigación', async () => {
    const r = await pedir('PUT', `/api/incidentes/${incidentes[0]}/investigacion`, hseq.token, investigacion)
    expect(r.statusCode).toBe(200)
    expect(r.json().data.investigacion).toMatchObject({ equipo_investigador: investigacion.equipo_investigador, analisis_porques: investigacion.analisis_porques })
  })

  it('crea una acción correctiva en su módulo, con la fuente de la investigación, y la vincula', async () => {
    const r = await pedir('POST', `/api/incidentes/${incidentes[0]}/acciones`, hseq.token, {
      descripcion_hallazgo: 'Programación de turnos sin descanso suficiente entre jornadas',
      tipo_accion_ejecutar: 'CORRECTIVA',
      plan_accion: 'Ajustar la programación para garantizar 8 horas de descanso',
      responsable_ejecucion: 'Jefe de operaciones',
      fecha_limite_implementacion: sumarDias(HOY, 30),
    })
    expect(r.statusCode).toBe(201)
    const vinculadas = r.json().data.acciones_vinculadas
    expect(vinculadas).toHaveLength(1)
    expect(vinculadas[0]).toMatchObject({ creada_desde_incidente: true, numero: expect.stringMatching(/^AC-\d{4}-\d{3,}$/) })
    const accion = await prisma.acciones_correctivas_preventivas.findUniqueOrThrow({ where: { id: vinculadas[0].id }, include: { causas: true } })
    expect(accion.fuente_genero_hallazgo).toBe('Investigación de Incidente/Accidente')
    expect(accion.causas[0]).toMatchObject({ es_causa_raiz: true, descripcion_plan_accion: 'Ajustar la programación para garantizar 8 horas de descanso' })
  })

  it('vincula una acción existente, una sola vez aunque se pida dos', async () => {
    const otra = await prisma.acciones_correctivas_preventivas.create({
      data: { accion_numero: `${MARCA}-${randomUUID().slice(0, 6)}`, descripcion_hallazgo: 'Acción previa', updated_at: new Date() } as any,
    })
    const encontradas = (await pedir('GET', `/api/incidentes/${incidentes[0]}/acciones/buscar?q=${MARCA}`, hseq.token)).json().data
    expect(encontradas.map((a: any) => a.id)).toContain(otra.id)
    await pedir('POST', `/api/incidentes/${incidentes[0]}/acciones/vincular`, hseq.token, { accion_id: otra.id })
    const r = await pedir('POST', `/api/incidentes/${incidentes[0]}/acciones/vincular`, hseq.token, { accion_id: otra.id })
    expect(r.json().data.acciones_vinculadas).toHaveLength(2)
    /// Ya vinculada, deja de ofrecerse en la búsqueda.
    const despues = (await pedir('GET', `/api/incidentes/${incidentes[0]}/acciones/buscar?q=${MARCA}`, hseq.token)).json().data
    expect(despues.map((a: any) => a.id)).not.toContain(otra.id)
  })

  it('cierra con fecha y responsable; cerrado no se edita; reabrir borra el cierre', async () => {
    const cerrado = await pedir('POST', `/api/incidentes/${incidentes[0]}/estado`, hseq.token, {
      accion: 'cerrar',
      fecha_cierre: HOY,
      responsable_cierre: 'Coordinadora HSEQ',
      observaciones_cierre: 'Acciones en seguimiento',
    })
    expect(cerrado.statusCode).toBe(200)
    expect(cerrado.json().data).toMatchObject({
      estado: 'CERRADO',
      investigacion: { realizada: true },
      cierre: { fecha_cierre: HOY, responsable_cierre: 'Coordinadora HSEQ', cerrado_por: { id: hseq.id } },
      plazo: { vencido: false, dias_restantes: null },
    })
    expect((await pedir('PUT', `/api/incidentes/${incidentes[0]}`, hseq.token, reporte())).statusCode).toBe(409)
    expect((await pedir('PUT', `/api/incidentes/${incidentes[0]}/investigacion`, hseq.token, investigacion)).statusCode).toBe(409)

    const reabierto = await pedir('POST', `/api/incidentes/${incidentes[0]}/estado`, hseq.token, { accion: 'reabrir' })
    expect(reabierto.json().data).toMatchObject({ estado: 'EN_INVESTIGACION', investigacion: { realizada: false }, cierre: { fecha_cierre: null, cerrado_por: null } })
    /// La investigación se conserva al reabrir: solo se borra el cierre.
    expect(reabierto.json().data.investigacion.causas_identificadas).toBe(investigacion.causas_identificadas)
  })
})

describe('recordatorio de los 15 días', () => {
  it('avisa una sola vez por incidente sin cerrar con 15 días, y nunca antes ni a uno cerrado', async () => {
    const vencido = (await pedir('POST', '/api/incidentes', hseq.token, reporte({ fecha: sumarDias(HOY, -15) }))).json().data.id
    const aTiempo = (await pedir('POST', '/api/incidentes', hseq.token, reporte({ fecha: sumarDias(HOY, -14) }))).json().data.id
    incidentes.push(vencido, aTiempo)

    const simulado = await recordarInvestigacionesPendientes({ hoy: HOY, dryRun: true })
    const delVencido = simulado.detalle.filter((d) => d.incidente_id === vencido).map((d) => d.usuario_id)
    expect(delVencido).toEqual(expect.arrayContaining([hseq.id, hseq2.id, admin.id]))
    expect(delVencido).not.toContain(talento.id) // solo daños: talento humano no entra
    expect(simulado.detalle.some((d) => d.incidente_id === aTiempo)).toBe(false)
    expect(simulado.detalle.find((d) => d.incidente_id === vencido)?.titulo).toMatch(/^Hoy vence la investigación · INC-/)
    /// El simulacro no escribe nada.
    expect(await avisosDe(vencido, HUELLA_RECORDATORIO)).toHaveLength(0)

    await recordarInvestigacionesPendientes({ hoy: HOY })
    const tras1 = await avisosDe(vencido, HUELLA_RECORDATORIO)
    expect(tras1.map((n) => n.usuario_id)).toEqual(expect.arrayContaining([hseq.id, hseq2.id, admin.id]))

    const segunda = await recordarInvestigacionesPendientes({ hoy: HOY })
    expect(segunda.detalle.filter((d) => d.incidente_id === vencido)).toHaveLength(0)
    expect(await avisosDe(vencido, HUELLA_RECORDATORIO)).toHaveLength(tras1.length)

    /// Un día después el que estaba a tiempo cumple sus 15 días.
    const manana = await recordarInvestigacionesPendientes({ hoy: sumarDias(HOY, 1), dryRun: true })
    expect(manana.detalle.some((d) => d.incidente_id === aTiempo)).toBe(true)
  })

  it('un incidente cerrado no recibe recordatorio aunque lleve meses', async () => {
    const id = (await pedir('POST', '/api/incidentes', hseq.token, reporte({ fecha: sumarDias(HOY, -60) }))).json().data.id
    incidentes.push(id)
    await prisma.pesv_incident.update({ where: { id }, data: { estado: 'CERRADO' } })
    const r = await recordarInvestigacionesPendientes({ hoy: HOY, dryRun: true })
    expect(r.detalle.some((d) => d.incidente_id === id)).toBe(false)
  })
})

describe('indicadores y borrado', () => {
  it('cuenta los eventos del periodo y los días sin accidentes', async () => {
    const r = await pedir('GET', '/api/incidentes/indicadores?meses=3', lector.token)
    expect(r.statusCode).toBe(200)
    const d = r.json().data
    expect(d.serie).toHaveLength(3)
    expect(d.totales.accidentes).toBeGreaterThanOrEqual(4)
    expect(d.dias_sin_accidentes).toBe(0)
    expect(d.por_100k_km).toBeNull()
  })

  it('eliminar es lógico: el reporte sale de las lecturas pero la fila queda', async () => {
    const id = incidentes[1]
    expect((await pedir('DELETE', `/api/incidentes/${id}`, hseq.token)).statusCode).toBe(200)
    expect((await pedir('GET', `/api/incidentes/${id}`, lector.token)).statusCode).toBe(404)
    const lista = (await pedir('GET', `/api/incidentes?q=${MARCA}`, lector.token)).json()
    expect(lista.items.map((i: any) => i.id)).not.toContain(id)
    expect((await prisma.pesv_incident.findUnique({ where: { id } }))?.deleted_at).not.toBeNull()
  })
})
