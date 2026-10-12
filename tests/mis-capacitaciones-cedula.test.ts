/**
 * «Mis capacitaciones»: la cédula que declara un usuario del dashboard.
 *
 * Firmas y resultados se casan por cédula, y la del usuario la escribe él mismo
 * en la app. Antes cualquiera podía declarar la de otro y ver su historial, sus
 * respuestas y la imagen de su firma; además la cédula se guardaba antes de
 * validar la firma. Aquí se fija que:
 *
 * - no se acepta la cédula de otra cuenta activa ni la de un conductor que no
 *   sea esa misma persona (mismo correo), y en ese caso no se escribe nada;
 * - la cédula se guarda solo DESPUÉS de que la firma quedó (o ya estaba);
 * - una cédula ya guardada no se cambia desde la app;
 * - lo que casa SOLO por cédula no devuelve firma ni respuestas al usuario,
 *   pero sí al conductor (cuya cédula pone la empresa).
 *
 * No toca la base: `prisma` es un doble en memoria y la sesión se simula.
 *
 * Es puro, pero `vitest.config.ts` carga `tests/setup.ts`, que abre Prisma y
 * limpia `respuestas_asistencia` de la base de pruebas. Para correrlo sin
 * tocarla, con una config sin `setupFiles` (ver el informe del cambio).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'

const db = vi.hoisted(() => ({
  usuario: null as any,
  otrasCuentas: [] as any[],
  conductores: [] as any[],
  formulario: null as any,
  firmas: [] as any[],
  resultados: [] as any[],
  evaluacion: null as any,
  /// Orden de las escrituras, para comprobar que la cédula va después de la firma.
  escrituras: [] as string[]
}))

/** `where` de Prisma reducido a lo que usa el servicio: igualdades y un `OR`. */
function coincide(fila: any, where: any): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k === 'OR') return (v as any[]).some((cond) => coincide(fila, cond))
    if (v && typeof v === 'object' && 'not' in (v as any)) return fila[k] !== (v as any).not
    if (v && typeof v === 'object') return true // filtros de relación (`evaluacion: { deleted_at }`)
    return fila[k] === v
  })
}

function proyectar(fila: any, select: any) {
  return Object.fromEntries(Object.entries(select).filter(([, v]) => v).map(([k]) => [k, fila[k]]))
}

function primeraReciente(filas: any[], args: any) {
  const fila = filas
    .filter((f) => coincide(f, args.where))
    .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())[0]
  return fila ? proyectar(fila, args.select) : null
}

vi.mock('../src/config/prisma', () => ({
  prisma: {
    usuarios: {
      findUnique: async () => db.usuario,
      findFirst: async ({ where }: any) =>
        db.otrasCuentas.find(
          (u) => u.id !== where.id.not && u.activo === where.activo && u.numero_documento === where.numero_documento
        ) ?? null,
      updateMany: async ({ where, data }: any) => {
        db.escrituras.push('cedula')
        const vacia = db.usuario.numero_documento === null || db.usuario.numero_documento === ''
        if (where.id !== db.usuario.id || !vacia) return { count: 0 }
        db.usuario.numero_documento = data.numero_documento
        return { count: 1 }
      }
    },
    conductores: {
      findFirst: async ({ where }: any) =>
        db.conductores.find((c) => c.numero_identificacion === where.numero_identificacion) ?? null,
      findUnique: async () => db.conductores[0] ?? null
    },
    formularios_asistencia: { findUnique: async () => db.formulario },
    respuestas_asistencia: {
      findFirst: async (args: any) => primeraReciente(db.firmas, args),
      create: async ({ data }: any) => {
        db.escrituras.push('firma')
        const fila = { ...data, id: `firma-${db.firmas.length + 1}`, created_at: new Date() }
        db.firmas.push(fila)
        return fila
      }
    },
    resultado: { findFirst: async (args: any) => primeraReciente(db.resultados, args) },
    evaluacion: { findFirst: async () => db.evaluacion }
  }
}))
vi.mock('../src/middlewares/auth.middleware', () => ({
  authMiddleware: async (request: any) => {
    request.user = { id: 'u-1' }
  }
}))
vi.mock('../src/sockets', () => ({ getIo: () => ({ emit() {}, to: () => ({ emit() {} }) }) }))
vi.mock('../src/services/ai-grading.service', () => ({ aiGradingService: {} }))

import { misCapacitacionesRoutes } from '../src/modules/mis-capacitaciones/mis-capacitaciones.routes'
import {
  esPropia,
  obtenerAsistencia,
  personaConductor
} from '../src/modules/conductor-portal/capacitaciones.service'

const FIRMA = 'data:image/png;base64,AAAA'
const FIRMA_AJENA = 'data:image/png;base64,AJENA'

async function app() {
  const a = Fastify()
  await a.register(misCapacitacionesRoutes)
  return a
}

async function firmar(body: unknown) {
  const a = await app()
  const res = await a.inject({ method: 'POST', url: '/mis-capacitaciones/asistencias/tok-1', payload: body as any })
  await a.close()
  return res
}

beforeEach(() => {
  db.usuario = {
    id: 'u-1',
    nombre: 'Laura Admin',
    correo: 'laura@empresa.test',
    telefono: '300',
    cargo: 'Analista',
    area: [],
    numero_documento: null,
    fecha_ingreso: null,
    created_at: new Date('2026-01-01')
  }
  db.otrasCuentas = []
  db.conductores = []
  db.formulario = {
    id: 'form-1',
    token: 'tok-1',
    activo: true,
    deleted_at: null,
    tematica: 'Manejo defensivo',
    objetivo: '',
    fecha: new Date('2026-10-10T00:00:00.000Z'),
    hora_inicio: '08:00',
    hora_finalizacion: '09:00',
    tipo_evento: 'CAPACITACION',
    tipo_evento_otro: null,
    lugar_sede: 'Yopal',
    nombre_instructor: 'Instructor'
  }
  db.firmas = []
  db.resultados = []
  db.evaluacion = null
  db.escrituras = []
})

describe('declarar la cédula al firmar', () => {
  it('rechaza la cédula de otra cuenta activa y no escribe nada', async () => {
    db.otrasCuentas = [{ id: 'u-2', activo: true, numero_documento: '1111111' }]

    const res = await firmar({ firma: FIRMA, numero_documento: '1.111.111' })

    expect(res.statusCode).toBe(409)
    expect(res.json().message).toMatch(/otra cuenta/)
    expect(db.escrituras).toEqual([])
    expect(db.usuario.numero_documento).toBeNull()
  })

  it('una cuenta desactivada con esa cédula no la bloquea', async () => {
    db.otrasCuentas = [{ id: 'u-2', activo: false, numero_documento: '1111111' }]

    const res = await firmar({ firma: FIRMA, numero_documento: '1111111' })

    expect(res.statusCode).toBe(201)
    expect(db.usuario.numero_documento).toBe('1111111')
  })

  it('rechaza la cédula de un conductor con otro correo', async () => {
    db.conductores = [{ numero_identificacion: '2222222', email: 'pedro@conductores.test' }]

    const res = await firmar({ firma: FIRMA, numero_documento: '2222222' })

    expect(res.statusCode).toBe(409)
    expect(db.escrituras).toEqual([])
  })

  it('rechaza la cédula de un conductor sin correo', async () => {
    db.conductores = [{ numero_identificacion: '2222222', email: null }]

    const res = await firmar({ firma: FIRMA, numero_documento: '2222222' })

    expect(res.statusCode).toBe(409)
    expect(db.escrituras).toEqual([])
  })

  it('acepta la cédula de un conductor que es la misma persona (mismo correo)', async () => {
    db.conductores = [{ numero_identificacion: '2222222', email: 'LAURA@empresa.test' }]

    const res = await firmar({ firma: FIRMA, numero_documento: '2222222' })

    expect(res.statusCode).toBe(201)
    expect(db.usuario.numero_documento).toBe('2222222')
  })

  it('no guarda la cédula si la firma no pasa la validación', async () => {
    const res = await firmar({ firma: 'no-es-imagen', numero_documento: '3333333' })

    expect(res.statusCode).toBe(400)
    expect(db.escrituras).toEqual([])
    expect(db.usuario.numero_documento).toBeNull()
  })

  it('no guarda la cédula si la lista está inactiva', async () => {
    db.formulario.activo = false

    const res = await firmar({ firma: FIRMA, numero_documento: '3333333' })

    expect(res.statusCode).toBe(403)
    expect(db.escrituras).toEqual([])
  })

  it('guarda la cédula después de la firma, no antes', async () => {
    const res = await firmar({ firma: FIRMA, numero_documento: '3333333' })

    expect(res.statusCode).toBe(201)
    expect(db.escrituras).toEqual(['firma', 'cedula'])
    expect(db.firmas[0].numero_documento).toBe('3333333')
    expect(db.firmas[0].device_fingerprint).toBe('app-usuario:u-1')
    expect(db.usuario.numero_documento).toBe('3333333')
  })

  it('si ya firmó en la web con esa cédula, responde 409 pero deja la cédula guardada', async () => {
    db.firmas = [{
      formulario_id: 'form-1', numero_documento: '3333333', device_fingerprint: 'web-xyz',
      firma: FIRMA, created_at: new Date('2026-10-10T10:00:00Z')
    }]

    const res = await firmar({ firma: FIRMA, numero_documento: '3333333' })

    expect(res.statusCode).toBe(409)
    expect(db.escrituras).toEqual(['cedula'])
    expect(db.usuario.numero_documento).toBe('3333333')
  })

  it('con cédula ya guardada, la del body se ignora', async () => {
    db.usuario.numero_documento = '4444444'

    const res = await firmar({ firma: FIRMA, numero_documento: '9999999' })

    expect(res.statusCode).toBe(201)
    expect(db.escrituras).toEqual(['firma'])
    expect(db.firmas[0].numero_documento).toBe('4444444')
    expect(db.usuario.numero_documento).toBe('4444444')
  })

  it('valida el largo antes de consultar nada', async () => {
    const res = await firmar({ firma: FIRMA, numero_documento: '12' })

    expect(res.statusCode).toBe(400)
    expect(db.escrituras).toEqual([])
  })
})

describe('lo que casa solo por cédula no se muestra en detalle', () => {
  it('asistencia: un usuario no recibe la firma de una fila ajena que casa por cédula', async () => {
    db.usuario.numero_documento = '5555555'
    db.firmas = [{
      formulario_id: 'form-1', numero_documento: '5555555', device_fingerprint: 'portal-conductor:c-9',
      firma: FIRMA_AJENA, created_at: new Date('2026-10-10T10:00:00Z')
    }]

    const a = await app()
    const res = await a.inject({ method: 'GET', url: '/mis-capacitaciones/asistencias/tok-1' })
    await a.close()

    expect(res.statusCode).toBe(200)
    const data = res.json().data
    expect(data.firmada_en).not.toBeNull()
    expect(data.firma).toBeNull()
    expect(JSON.stringify(data)).not.toContain('AJENA')
  })

  it('asistencia: prefiere la firma propia aunque haya una más reciente por cédula', async () => {
    db.usuario.numero_documento = '5555555'
    db.firmas = [
      { formulario_id: 'form-1', numero_documento: '5555555', device_fingerprint: 'app-usuario:u-1', firma: FIRMA, created_at: new Date('2026-10-10T09:00:00Z') },
      { formulario_id: 'form-1', numero_documento: '5555555', device_fingerprint: 'web-abc', firma: FIRMA_AJENA, created_at: new Date('2026-10-10T11:00:00Z') }
    ]

    const a = await app()
    const res = await a.inject({ method: 'GET', url: '/mis-capacitaciones/asistencias/tok-1' })
    await a.close()

    expect(res.json().data.firma).toBe(FIRMA)
  })

  it('asistencia: el conductor sí ve la firma que casa por su cédula (la pone la empresa)', async () => {
    db.conductores = [{
      id: 'c-1', nombre: 'Pedro', apellido: 'Ruiz', numero_identificacion: '6666666',
      cargo: 'CONDUCTOR', telefono: '', email: 'pedro@x.test', fecha_ingreso: null
    }]
    db.firmas = [{
      formulario_id: 'form-1', numero_documento: '6666666', device_fingerprint: 'web-abc',
      firma: FIRMA, created_at: new Date('2026-10-10T10:00:00Z')
    }]

    const data = await obtenerAsistencia('tok-1', await personaConductor('c-1'))

    expect(data.firma).toBe(FIRMA)
  })

  it('evaluación: un usuario no recibe las respuestas de un resultado ajeno que casa por cédula', async () => {
    db.usuario.numero_documento = '5555555'
    db.evaluacion = {
      id: '0b9c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d',
      titulo: 'Evaluación', descripcion: '', requiere_firma: false,
      preguntas: [{
        id: 'p1', texto: '¿?', tipo: 'OPCION_MULTIPLE', puntaje: 10,
        opciones: [{ id: 'o1', texto: 'Sí' }], relacionIzq: [], relacionDer: [], configuracion: null,
        created_at: new Date('2026-10-01')
      }]
    }
    db.resultados = [{
      evaluacionId: db.evaluacion.id, numero_documento: '5555555', device_fingerprint: 'web-abc',
      puntaje_total: 10, created_at: new Date('2026-10-10T10:00:00Z'),
      respuestas: [{ preguntaId: 'p1', valor_texto: 'SECRETO', valor_numero: null, opcionesIds: ['o1'], relacion: null, puntaje: 10 }]
    }]

    const a = await app()
    const res = await a.inject({ method: 'GET', url: `/mis-capacitaciones/evaluaciones/${db.evaluacion.id}` })
    await a.close()

    expect(res.statusCode).toBe(200)
    const resultado = res.json().data.resultado
    expect(resultado).not.toBeNull()
    expect(resultado.respuestas).toEqual([])
    expect(res.body).not.toContain('SECRETO')
  })

  it('evaluación: con su propia huella sí recibe sus respuestas', async () => {
    db.usuario.numero_documento = '5555555'
    db.evaluacion = {
      id: '0b9c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d',
      titulo: 'Evaluación', descripcion: '', requiere_firma: false,
      preguntas: [{
        id: 'p1', texto: '¿?', tipo: 'OPCION_MULTIPLE', puntaje: 10,
        opciones: [{ id: 'o1', texto: 'Sí' }], relacionIzq: [], relacionDer: [], configuracion: null,
        created_at: new Date('2026-10-01')
      }]
    }
    db.resultados = [{
      evaluacionId: db.evaluacion.id, numero_documento: '5555555', device_fingerprint: 'app-usuario:u-1',
      puntaje_total: 10, created_at: new Date('2026-10-10T10:00:00Z'),
      respuestas: [{ preguntaId: 'p1', valor_texto: null, valor_numero: null, opcionesIds: ['o1'], relacion: null, puntaje: 10 }]
    }]

    const a = await app()
    const res = await a.inject({ method: 'GET', url: `/mis-capacitaciones/evaluaciones/${db.evaluacion.id}` })
    await a.close()

    expect(res.json().data.resultado.respuestas).toHaveLength(1)
  })

  it('esPropia: verificada siempre; no verificada, solo con su huella', () => {
    expect(esPropia({ huella: 'h', documento_verificado: true }, 'otra')).toBe(true)
    expect(esPropia({ huella: 'h', documento_verificado: false }, 'h')).toBe(true)
    expect(esPropia({ huella: 'h', documento_verificado: false }, 'otra')).toBe(false)
    expect(esPropia({ huella: 'h', documento_verificado: false }, null)).toBe(false)
  })
})
