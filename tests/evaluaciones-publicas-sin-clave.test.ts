/**
 * Rutas públicas de evaluaciones: `responder` y `verificar` no entregan la
 * clave ni datos personales, y `responder` hace cumplir firma, borrado lógico,
 * duplicados y límite de intentos.
 *
 * Hasta oct-2026 las dos devolvían el `Resultado` con la evaluación completa
 * (`esCorrecta`, `respuestaCorrecta`, ubicación de las palabras de la sopa) y
 * los datos de quien respondió; respondiendo una vez con datos de prueba se
 * sacaba la clave. El evento `nueva-respuesta` también la llevaba.
 *
 * Sin base: Prisma, sockets, sesión e IA van simulados. Se ejecuta suelto con
 * `npx vitest run tests/evaluaciones-publicas-sin-clave.test.ts`.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { generarSopa } from '../src/modules/evaluaciones/sopa-letras'
import { MINIMO_APROBACION, resultadoPublico } from '../src/modules/evaluaciones/evaluacion-publica'

const db = vi.hoisted(() => ({
  evaluacion: { findFirst: vi.fn(), findUnique: vi.fn() },
  resultado: { findFirst: vi.fn(), create: vi.fn() }
}))
const emitidos = vi.hoisted(() => [] as { evento: string; datos: any }[])

vi.mock('../src/config/prisma', () => ({ prisma: db }))
vi.mock('../src/sockets', () => ({
  getIo: () => ({ to: () => ({ emit: (evento: string, datos: any) => emitidos.push({ evento, datos }) }) })
}))
vi.mock('../src/middlewares/auth.middleware', () => ({ authMiddleware: async () => {} }))
vi.mock('../src/services/ai-grading.service', () => ({
  aiGradingService: { gradeTextResponse: vi.fn(async () => ({ score: 0, reasoning: '' })) }
}))

const ID = '11111111-1111-4111-8111-111111111111'
const ahora = new Date('2026-10-11T15:00:00.000Z')
const sopa = generarSopa({ palabras: ['CASCO', 'FRENO'], tamano: 8 })

function pregunta(p: Record<string, unknown>) {
  return {
    evaluacionId: ID,
    texto: '¿?',
    relacionIzq: [],
    relacionDer: [],
    respuestaCorrecta: null,
    configuracion: null,
    created_at: ahora,
    opciones: [],
    ...p
  }
}

function evaluacion(extra: Record<string, unknown> = {}) {
  return {
    id: ID,
    titulo: 'Manejo defensivo',
    descripcion: null,
    requiere_firma: false,
    created_at: ahora,
    updated_at: ahora,
    deleted_at: null,
    preguntas: [
      pregunta({
        id: 'p1',
        tipo: 'OPCION_UNICA',
        puntaje: 2,
        opciones: [
          { id: 'o1', preguntaId: 'p1', texto: 'Sí', esCorrecta: true },
          { id: 'o2', preguntaId: 'p1', texto: 'No', esCorrecta: false }
        ]
      }),
      pregunta({ id: 'p2', tipo: 'VERDADERO_FALSO', puntaje: 1, respuestaCorrecta: 1 }),
      pregunta({ id: 'p3', tipo: 'SOPA_LETRAS', puntaje: 2, configuracion: sopa }),
      pregunta({ id: 'p4', tipo: 'TEXTO', puntaje: 0 })
    ],
    ...extra
  }
}

/** Fila «guardada» que respeta el `select` como lo haría Prisma. */
function aplicarSelect(fila: Record<string, any>, select: Record<string, any>): Record<string, any> {
  const salida: Record<string, any> = {}
  for (const [k, v] of Object.entries(select)) {
    if (!v) continue
    if (typeof v === 'object' && v.select) {
      salida[k] = (fila[k] as any[]).map((h) => aplicarSelect(h, v.select))
    } else {
      salida[k] = fila[k]
    }
  }
  return salida
}

function crearResultadoSimulado() {
  db.resultado.create.mockImplementation(async ({ data, select }: any) => {
    const fila = {
      id: 'r1',
      ...data,
      firma: data.firma ?? null,
      created_at: ahora,
      respuestas: data.respuestas.create.map((r: any, i: number) => ({ id: `x${i}`, resultadoId: 'r1', ...r }))
    }
    return select ? aplicarSelect(fila, select) : fila
  })
}

let docSeq = 0
/// Cada envío con su propio documento: el límite por documento no se cruza entre pruebas.
const cuerpo = (extra: Record<string, unknown> = {}) => ({
  nombre_completo: 'Ana Pérez',
  numero_documento: `10${++docSeq}`,
  cargo: 'Conductora',
  correo: 'ana@example.com',
  telefono: '3000000000',
  device_fingerprint: 'huella-1',
  respuestas: [
    { preguntaId: 'p1', opcionesIds: ['o1'] },
    { preguntaId: 'p2', valor_numero: 0 },
    { preguntaId: 'p3', trazos: [] }
  ],
  ...extra
})

/// Palabras de la clave que nunca deben salir por una ruta pública.
const PROHIBIDAS = ['esCorrecta', 'respuestaCorrecta', 'cuadricula', 'dFila', 'numero_documento', 'correo', 'telefono', 'firma', 'ip_address', 'user_agent', 'device_fingerprint', 'opcionesIds']

let app: FastifyInstance
let ipSeq = 0
/** Cada prueba sale por su propia IP: el límite por IP no se contamina entre pruebas. */
const otraIp = () => ({ 'cf-connecting-ip': `10.0.0.${++ipSeq}` })

beforeAll(async () => {
  const { evaluacionesRoutes } = await import('../src/modules/evaluaciones/evaluacion.routes')
  app = Fastify()
  await app.register(evaluacionesRoutes, { prefix: '/api' })
  await app.ready()
})

afterAll(async () => {
  await app?.close()
})

beforeEach(() => {
  vi.clearAllMocks()
  emitidos.length = 0
  db.evaluacion.findFirst.mockResolvedValue(evaluacion())
  db.resultado.findFirst.mockResolvedValue(null)
  crearResultadoSimulado()
})

describe('resultadoPublico', () => {
  it('solo trae el resultado, y cuenta aciertos sobre las preguntas con puntaje', () => {
    const r = resultadoPublico(
      [
        { id: 'a', puntaje: 2 },
        { id: 'b', puntaje: 2 },
        { id: 'c', puntaje: 0 }
      ],
      {
        nombre_completo: 'Ana',
        puntaje_total: 3,
        created_at: ahora,
        respuestas: [
          { preguntaId: 'a', puntaje: 2 },
          { preguntaId: 'b', puntaje: 1 },
          { preguntaId: 'c', puntaje: 0 }
        ]
      }
    )
    expect(r).toEqual({
      respondido: true,
      nombre: 'Ana',
      fecha: ahora.toISOString(),
      puntaje_total: 3,
      puntaje_maximo: 4,
      porcentaje: 75,
      aprobado: true,
      aciertos: 1,
      total_preguntas: 2
    })
  })

  it(`aprueba desde el ${MINIMO_APROBACION} %, como el PDF`, () => {
    const base = { nombre_completo: 'A', created_at: ahora, respuestas: [] }
    const preguntas = [{ id: 'a', puntaje: 10 }]
    expect(resultadoPublico(preguntas, { ...base, puntaje_total: 7 }).aprobado).toBe(true)
    expect(resultadoPublico(preguntas, { ...base, puntaje_total: 6 }).aprobado).toBe(false)
    expect(resultadoPublico([], { ...base, puntaje_total: 0 }).aprobado).toBe(false)
  })
})

describe('POST /api/evaluaciones/:id/responder', () => {
  it('devuelve solo el resultado: ni la clave ni los datos de quien respondió', async () => {
    const res = await app.inject({ method: 'POST', url: `/api/evaluaciones/${ID}/responder`, payload: cuerpo(), headers: otraIp() })
    expect(res.statusCode).toBe(200)
    const { data } = res.json()
    expect(Object.keys(data).sort()).toEqual(
      ['aciertos', 'aprobado', 'fecha', 'nombre', 'porcentaje', 'puntaje_maximo', 'puntaje_total', 'respondido', 'total_preguntas'].sort()
    )
    expect(data).toMatchObject({ respondido: true, nombre: 'Ana Pérez', puntaje_total: 2, puntaje_maximo: 5, aciertos: 1, total_preguntas: 3, aprobado: false })
    for (const palabra of PROHIBIDAS) expect(res.body).not.toContain(palabra)
    for (const palabra of sopa.palabras) expect(res.body).not.toContain(palabra.texto)
  })

  it('el evento `nueva-respuesta` lleva la fila del panel, sin la clave ni la firma', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/evaluaciones/${ID}/responder`,
      payload: cuerpo({ firma: 'data:image/png;base64,AAAA' }),
      headers: otraIp()
    })
    expect(res.statusCode).toBe(200)
    expect(emitidos).toHaveLength(1)
    const { evento, datos } = emitidos[0]
    expect(evento).toBe('nueva-respuesta')
    expect(datos).toMatchObject({ id: 'r1', evaluacionId: ID, nombre_completo: 'Ana Pérez', puntaje_total: 2, tiene_firma: true })
    expect(datos.respuestas).toHaveLength(3)
    const texto = JSON.stringify(datos)
    for (const palabra of ['esCorrecta', 'respuestaCorrecta', 'cuadricula', 'dFila', '"evaluacion"', '"pregunta"', '"firma"', 'ip_address', 'user_agent', 'device_fingerprint']) {
      expect(texto).not.toContain(palabra)
    }
  })

  it('rechaza una evaluación eliminada (busca con deleted_at: null)', async () => {
    db.evaluacion.findFirst.mockResolvedValue(null)
    const res = await app.inject({ method: 'POST', url: `/api/evaluaciones/${ID}/responder`, payload: cuerpo(), headers: otraIp() })
    expect(res.statusCode).toBe(404)
    expect(db.evaluacion.findFirst.mock.calls[0][0].where).toEqual({ id: ID, deleted_at: null })
    expect(db.resultado.create).not.toHaveBeenCalled()
  })

  it('un id que no es uuid da 404 sin tocar la base', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/evaluaciones/no-es-uuid/responder', payload: cuerpo(), headers: otraIp() })
    expect(res.statusCode).toBe(404)
    expect(db.evaluacion.findFirst).not.toHaveBeenCalled()
  })

  it('exige la firma cuando la evaluación la requiere', async () => {
    db.evaluacion.findFirst.mockResolvedValue(evaluacion({ requiere_firma: true }))
    const sinFirma = await app.inject({ method: 'POST', url: `/api/evaluaciones/${ID}/responder`, payload: cuerpo(), headers: otraIp() })
    expect(sinFirma.statusCode).toBe(400)
    expect(sinFirma.json().code).toBe('FIRMA_REQUERIDA')
    const vacia = await app.inject({ method: 'POST', url: `/api/evaluaciones/${ID}/responder`, payload: cuerpo({ firma: '   ' }), headers: otraIp() })
    expect(vacia.statusCode).toBe(400)
    expect(db.resultado.create).not.toHaveBeenCalled()

    const conFirma = await app.inject({
      method: 'POST',
      url: `/api/evaluaciones/${ID}/responder`,
      payload: cuerpo({ firma: 'data:image/png;base64,AAAA' }),
      headers: otraIp()
    })
    expect(conFirma.statusCode).toBe(200)
  })

  it('con huella, el duplicado se busca por huella', async () => {
    db.resultado.findFirst.mockResolvedValue({ id: 'previo' })
    const res = await app.inject({ method: 'POST', url: `/api/evaluaciones/${ID}/responder`, payload: cuerpo(), headers: otraIp() })
    expect(res.statusCode).toBe(409)
    expect(res.json().code).toBe('YA_RESPONDIO')
    expect(db.resultado.findFirst.mock.calls[0][0].where).toEqual({ evaluacionId: ID, device_fingerprint: 'huella-1' })
    expect(db.resultado.create).not.toHaveBeenCalled()
  })

  it('sin huella, el duplicado se busca por documento (recortado) en la misma evaluación', async () => {
    db.resultado.findFirst.mockResolvedValue({ id: 'previo' })
    const res = await app.inject({
      method: 'POST',
      url: `/api/evaluaciones/${ID}/responder`,
      payload: cuerpo({ device_fingerprint: undefined, numero_documento: ' 2002 ' }),
      headers: otraIp()
    })
    expect(res.statusCode).toBe(409)
    expect(db.resultado.findFirst.mock.calls[0][0].where).toEqual({ evaluacionId: ID, numero_documento: '2002' })
  })

  it('sin huella y sin respuesta previa, registra', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/evaluaciones/${ID}/responder`,
      payload: cuerpo({ device_fingerprint: undefined, numero_documento: '3003' }),
      headers: otraIp()
    })
    expect(res.statusCode).toBe(200)
    expect(db.resultado.create).toHaveBeenCalledOnce()
  })

  it('limita los envíos de un mismo documento en la misma evaluación', async () => {
    const headers = otraIp()
    db.resultado.findFirst.mockResolvedValue({ id: 'previo' })
    const codigos: number[] = []
    for (let i = 0; i < 6; i++) {
      const res = await app.inject({
        method: 'POST',
        url: `/api/evaluaciones/${ID}/responder`,
        payload: cuerpo({ numero_documento: 'limite-4004', device_fingerprint: `h-${i}` }),
        headers
      })
      codigos.push(res.statusCode)
    }
    expect(codigos.slice(0, 5)).toEqual([409, 409, 409, 409, 409])
    expect(codigos[5]).toBe(429)
  })
})

describe('GET /api/evaluaciones/:id/verificar', () => {
  it('si ya respondió, devuelve solo el resultado y no pide a la base datos personales', async () => {
    db.resultado.findFirst.mockResolvedValue({
      nombre_completo: 'Ana Pérez',
      puntaje_total: 5,
      created_at: ahora,
      respuestas: [
        { preguntaId: 'p1', puntaje: 2 },
        { preguntaId: 'p2', puntaje: 1 },
        { preguntaId: 'p3', puntaje: 2 }
      ]
    })
    const res = await app.inject({ method: 'GET', url: `/api/evaluaciones/${ID}/verificar?device_fingerprint=huella-1`, headers: otraIp() })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual({
      respondido: true,
      nombre: 'Ana Pérez',
      fecha: ahora.toISOString(),
      puntaje_total: 5,
      puntaje_maximo: 5,
      porcentaje: 100,
      aprobado: true,
      aciertos: 3,
      total_preguntas: 3
    })
    const consulta = db.resultado.findFirst.mock.calls[0][0]
    expect(consulta.where).toEqual({ evaluacionId: ID, device_fingerprint: 'huella-1' })
    expect(consulta.include).toBeUndefined()
    expect(Object.keys(consulta.select).sort()).toEqual(['created_at', 'nombre_completo', 'puntaje_total', 'respuestas'])
  })

  it('si no respondió, data es null', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/evaluaciones/${ID}/verificar?device_fingerprint=otra`, headers: otraIp() })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ success: true, data: null })
  })

  it('400 sin huella; 404 con un id que no es uuid o una evaluación eliminada', async () => {
    expect((await app.inject({ method: 'GET', url: `/api/evaluaciones/${ID}/verificar`, headers: otraIp() })).statusCode).toBe(400)
    expect((await app.inject({ method: 'GET', url: '/api/evaluaciones/x/verificar?device_fingerprint=h', headers: otraIp() })).statusCode).toBe(404)
    db.evaluacion.findFirst.mockResolvedValue(null)
    expect((await app.inject({ method: 'GET', url: `/api/evaluaciones/${ID}/verificar?device_fingerprint=h`, headers: otraIp() })).statusCode).toBe(404)
  })

  it('limita las consultas por IP', async () => {
    const headers = otraIp()
    let ultima = 0
    for (let i = 0; i < 121; i++) {
      ultima = (await app.inject({ method: 'GET', url: `/api/evaluaciones/${ID}/verificar?device_fingerprint=h${i}`, headers })).statusCode
    }
    expect(ultima).toBe(429)
    // Otra IP no se ve afectada
    expect((await app.inject({ method: 'GET', url: `/api/evaluaciones/${ID}/verificar?device_fingerprint=h`, headers: otraIp() })).statusCode).toBe(200)
  })
})
