/**
 * De la petición HTTP al evento en el cliente.
 *
 * `eventos-dominio.test.ts` prueba que los emisores mandan lo que dicen mandar.
 * Esto es lo otro: que una operación REAL —un POST, un PUT, un DELETE por la
 * API— acaba produciendo ese evento en un cliente conectado.
 *
 * Es la diferencia que dejó el módulo de Servicios sin tiempo real durante
 * meses: los emisores no existían y nadie lo notó porque no había nada que
 * cruzara las dos mitades. Un test del emisor solo habría seguido en verde.
 *
 * Levanta el servidor de verdad (Fastify + Socket.IO) y conecta un cliente
 * socket.io real, igual que `canvas-servicios-sockets.test.ts`.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { Socket } from 'socket.io-client'
import { PrismaClient } from '@prisma/client'

vi.mock('pdfmake/build/pdfmake', () => ({ default: {}, createPdf: () => ({}) }))
vi.mock('pdfmake/build/vfs_fonts', () => ({ default: { vfs: {} }, vfs: {} }))

import { abrirBanco, esperarEvento, type Banco } from './helpers/canvas-servicios'
import {
  cerrarPrisma,
  limpiarUsuariosSembrados,
  sembrarUsuario,
  type UsuarioSembrado,
} from './helpers/usuarios-prueba'

const prisma = new PrismaClient()
const MARCA = 'ZZTEST-DOMINIO'

let banco: Banco
let usuario: UsuarioSembrado
let socket: Socket
let clienteId: string
let municipioId: string

/** Datos mínimos para poder crear un servicio por la API. */
async function sembrarCatalogos() {
  const cliente = await prisma.clientes.findFirst({ select: { id: true } })
  if (cliente) {
    clienteId = cliente.id
  } else {
    clienteId = randomUUID()
    await prisma.clientes.create({
      data: {
        id: clienteId,
        nombre: `${MARCA} Cliente`,
        nit: `${MARCA}-NIT`,
        representante: 'X',
        cedula: '1',
        telefono: '1',
        direccion: 'X',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any,
    })
  }

  const municipio = await prisma.municipios.findFirst({ select: { id: true } })
  if (municipio) {
    municipioId = municipio.id
  } else {
    municipioId = randomUUID()
    await prisma.municipios.create({
      data: {
        id: municipioId,
        codigo_departamento: 85,
        nombre_departamento: 'CASANARE',
        codigo_municipio: 85001,
        nombre_municipio: `${MARCA} Yopal`,
        tipo: 'Municipio',
        latitud: 5,
        longitud: -72,
        created_at: new Date(),
        updated_at: new Date(),
      } as any,
    })
  }
}

async function limpiarServicios() {
  await prisma.servicio.deleteMany({
    where: { origen_especifico: { startsWith: MARCA } },
  })
}

beforeAll(async () => {
  await limpiarUsuariosSembrados()
  await limpiarServicios()
  usuario = await sembrarUsuario('dominio')
  await sembrarCatalogos()
  banco = await abrirBanco()
  socket = await banco.conectar(usuario as any)
}, 40_000)

afterAll(async () => {
  await limpiarServicios()
  await banco?.cerrar()
  await limpiarUsuariosSembrados()
  await cerrarPrisma()
  await prisma.$disconnect()
})

/** Cuerpo mínimo aceptado por `POST /api/servicios`. */
function cuerpoServicio(sufijo: string) {
  return {
    origen_especifico: `${MARCA} origen ${sufijo}`,
    destino_especifico: `${MARCA} destino ${sufijo}`,
    fecha_solicitud: new Date().toISOString(),
    valor: 100000,
    cliente_id: clienteId,
    origen_id: municipioId,
    destino_id: municipioId,
    proposito_servicio: 'personal',
  }
}

describe('Servicios · de la API al socket', () => {
  it('crear un servicio por HTTP emite `servicio:creado`', async () => {
    /**
     * Este es el caso que estuvo roto: el módulo no emitía NADA mientras el
     * store del frontend tenía seis listeners montados con su lógica de parche
     * escrita. La lista solo se actualizaba al recargar.
     */
    const llega = esperarEvento<any>(socket, 'servicio:creado', () => true, 8000)

    const res = await banco.pedir(usuario as any, 'POST', '/api/servicios', cuerpoServicio('A'))
    expect([200, 201]).toContain(res.status)

    const evento = await llega
    expect(evento?.id).toBeTruthy()
    expect(evento?.origen_especifico).toContain(MARCA)
  }, 20_000)

  it('cambiar el estado emite `servicio:estado-actualizado` con el estado anterior', async () => {
    const creado = await banco.pedir(usuario as any, 'POST', '/api/servicios', cuerpoServicio('B'))
    const id = creado.body?.data?.id
    expect(id).toBeTruthy()

    const llega = esperarEvento<any>(
      socket,
      'servicio:estado-actualizado',
      (d) => d?.servicio?.id === id,
      8000,
    )

    const res = await banco.pedir(usuario as any, 'PATCH', `/api/servicios/${id}/estado`, {
      estado: 'planificado',
    })
    expect([200, 201]).toContain(res.status)

    const evento = await llega
    /// El consumidor lee `data.servicio.id` y `data.estadoAnterior`; si viniera
    /// la entidad plana, el parche por id no encontraría la fila.
    expect(evento.servicio.id).toBe(id)
    expect(evento.estadoAnterior).toBe('solicitado')
  }, 20_000)

  it('eliminar emite `servicio:eliminado` con SOLO el id', async () => {
    const creado = await banco.pedir(usuario as any, 'POST', '/api/servicios', cuerpoServicio('C'))
    const id = creado.body?.data?.id

    const llega = esperarEvento<any>(
      socket,
      'servicio:eliminado',
      (d) => d?.id === id,
      8000,
    )

    await banco.pedir(usuario as any, 'DELETE', `/api/servicios/${id}`)

    const evento = await llega
    /// Solo el id: la entidad ya no existe. Un consumidor que espere la entidad
    /// completa se rompe justo aquí, y por eso la forma se fija.
    expect(evento).toEqual({ id })
  }, 20_000)
})

describe('Clientes · de la API al socket', () => {
  it('crear un cliente por HTTP emite `cliente:created`', async () => {
    /**
     * El backend emitía `cliente:oculto` y `clientes:actualizacion-masiva`
     * mientras la página escuchaba `cliente:created`. Ninguno coincidía, así
     * que dar de alta un cliente no le llegaba a nadie más.
     */
    const llega = esperarEvento<any>(socket, 'cliente:created', () => true, 8000)

    const res = await banco.pedir(usuario as any, 'POST', '/api/clientes', {
      nombre: `${MARCA} Cliente Nuevo`,
      nit: `${MARCA}-${randomUUID().slice(0, 8)}`,
      representante: 'Rep',
      cedula: '123',
      telefono: '3000000000',
      direccion: 'Calle 1',
      tipo: 'EMPRESA',
    })
    expect([200, 201]).toContain(res.status)

    const evento = await llega
    expect(evento?.nombre).toContain(MARCA)

    if (evento?.id) {
      await prisma.clientes.deleteMany({ where: { id: evento.id } })
    }
  }, 20_000)
})
