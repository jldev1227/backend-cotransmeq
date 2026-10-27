import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { abrirBanco, esperarEvento, type Banco } from './helpers/canvas-servicios'
import { cerrarPrisma, limpiarUsuariosSembrados, sembrarUsuario, type UsuarioSembrado } from './helpers/usuarios-prueba'

vi.mock('pdfmake/build/pdfmake', () => ({ default: {}, createPdf: () => ({}) }))
vi.mock('pdfmake/build/vfs_fonts', () => ({ default: { vfs: {} }, vfs: {} }))

const prisma = new PrismaClient()
const preguntas = [
  {
    id: '33333333-3333-4333-8333-333333333333', titulo: '¿Cómo calificas el servicio?', descripcion: '',
    tipo: 'ESCALA', requerida: true, opciones: [], minimo: 1, maximo: 5
  },
  {
    id: '44444444-4444-4444-8444-444444444444', titulo: '¿Qué mejorarías?', descripcion: '',
    tipo: 'TEXTO_LARGO', requerida: false, opciones: []
  }
]

let banco: Banco
let usuario: UsuarioSembrado
let socket: Awaited<ReturnType<Banco['conectar']>>
let encuestaId: string | undefined

beforeAll(async () => {
  await limpiarUsuariosSembrados()
  usuario = await sembrarUsuario('encuestas-integracion')
  banco = await abrirBanco()
  socket = await banco.conectar(usuario as any)
}, 40_000)

afterAll(async () => {
  if (encuestaId) {
    await prisma.encuesta_respuesta.deleteMany({ where: { encuesta_id: encuestaId } })
    await prisma.encuesta.deleteMany({ where: { id: encuestaId } })
  }
  await banco?.cerrar()
  await limpiarUsuariosSembrados()
  await cerrarPrisma()
  await prisma.$disconnect()
})

describe('encuestas · formulario público a tablero en tiempo real', () => {
  it('crea y publica, recibe una respuesta, emite socket y alimenta los gráficos', async () => {
    const creada = await banco.pedir(usuario as any, 'POST', '/api/encuestas', {
      titulo: `Encuesta integración ${randomBytes(4).toString('hex')}`,
      descripcion: 'Prueba de punta a punta', mensaje_final: 'Gracias',
      nombre_modo: 'NO', correo_modo: 'NO', registrar_origen: false,
      politica_origen: 'PERMITIR', fecha_cierre: null, preguntas
    })
    expect(creada.status).toBe(201)
    encuestaId = creada.body.encuesta.id
    const token = creada.body.encuesta.token

    expect((await banco.pedir(usuario as any, 'POST', `/api/encuestas/${encuestaId}/publicar`)).status).toBe(200)
    const publica = await banco.app.inject({ method: 'GET', url: `/api/public/encuestas/${token}` })
    expect(publica.statusCode).toBe(200)
    expect(publica.json().encuesta.abierta).toBe(true)

    const evento = esperarEvento<{ encuestaId: string; respuestaId: string; occurredAt: string }>(
      socket, 'encuestas:respuesta', (data) => data.encuestaId === encuestaId, 8_000
    )
    const envio = await banco.app.inject({
      method: 'POST', url: `/api/public/encuestas/${token}/respuestas`,
      payload: { respuestas: { [preguntas[0].id]: 4, [preguntas[1].id]: 'Mejorar la puntualidad' } }
    })
    expect(envio.statusCode).toBe(201)
    expect(envio.json().mensaje).toBe('Gracias')

    const aviso = await evento
    expect(aviso.respuestaId).toBe(envio.json().id)
    expect(aviso.occurredAt).toBeTruthy()
    expect(aviso).not.toHaveProperty('respuestas')

    const resultados = await banco.pedir(usuario as any, 'GET', `/api/encuestas/${encuestaId}/resultados`)
    expect(resultados.status).toBe(200)
    expect(resultados.body.total).toBe(1)
    expect(resultados.body.analisis[0]).toMatchObject({ respondidas: 1, promedio: 4 })
    expect(resultados.body.analisis[0].opciones.find((o: any) => o.id === '4')).toMatchObject({ total: 1, porcentaje: 100 })
    expect(resultados.body.analisis[1].textos).toContain('Mejorar la puntualidad')
    expect(resultados.body.respuestas[0].respuestas[preguntas[0].id]).toBe(4)
  }, 30_000)
})
