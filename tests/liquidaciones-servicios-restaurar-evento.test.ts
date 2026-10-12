/**
 * Restaurar una liquidación de servicio desde la papelera avisa a los demás.
 *
 * EL FALLO QUE ORIGINA ESTO
 *
 * `PATCH /liquidaciones-servicios/:id/restaurar` emitía
 * `liquidacion-servicio-created` con lo que devolvía el servicio:
 * `{ message, relacionadas }`. Sin `id`, el listado y el canvas descartan el
 * evento en su primera línea (`if (!data?.id) return`), así que la fila no
 * reaparecía en ningún otro navegador, y la etiqueta del feed —el consecutivo—
 * llegaba `undefined`. `tsc` lo venía avisando (TS2339 sobre `consecutivo`).
 *
 * Aquí se llama al controlador de verdad contra la base desechable y se
 * captura lo que emite. Los sockets se sustituyen por un espía: lo que importa
 * es QUÉ se emite, no el transporte, que ya cubren las suites de sockets.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'

vi.mock('pdfmake/build/pdfmake', () => ({ default: {}, createPdf: () => ({}) }))
vi.mock('pdfmake/build/vfs_fonts', () => ({ default: { vfs: {} }, vfs: {} }))

const emitidos: Array<{ evento: string; data: any; meta: any }> = []
vi.mock('../src/sockets', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/sockets')>()
  return {
    ...real,
    emitLiquidacionServicio: (evento: string, data: any, meta?: any) => {
      emitidos.push({ evento, data, meta })
    },
  }
})

import { LiquidacionesServiciosController } from '../src/modules/liquidaciones-servicios/liquidaciones-servicios.controller'
import { eliminarLiquidacionServicio } from '../src/lib/soft-delete/liquidacion-servicio'

const prisma = new PrismaClient()

/** Marca para limpiar solo lo que crea esta suite. */
const MARCA = 'ZZTEST-RESTEVT'

let clienteId: string
let usuarioId: string

/** Respuesta de Fastify mínima: guarda el código y el cuerpo enviados. */
function respuesta() {
  const r = {
    codigo: 200,
    cuerpo: undefined as any,
    status(c: number) {
      r.codigo = c
      return r
    },
    send(b: any) {
      r.cuerpo = b
      return r
    },
  }
  return r
}

async function crearLiquidacion(): Promise<string> {
  const id = randomUUID()
  await prisma.liquidacion_servicio.create({
    data: {
      id,
      consecutivo: `${MARCA}-${id.slice(0, 8)}`,
      cliente_id: clienteId,
      mes: 1,
      anio: 2026,
      estado: 'BORRADOR' as any,
      subtotal: 100,
      total: 100,
      creado_por_id: usuarioId,
      actualizado_por_id: usuarioId,
    },
  })
  await prisma.liquidacion_servicio_item.create({
    data: {
      liquidacion_id: id,
      placa: 'RST001',
      fecha_inicial: new Date('2026-01-01'),
      fecha_final: new Date('2026-01-02'),
      recorrido: 'Recorrido de prueba',
      tipo_servicio: 'TRANSPORTE_DE_PERSONAL_EN_CAMIONETA' as any,
      cantidad: 1,
      valor_unitario: 100,
      subtotal: 100,
      valor_final: 100,
      orden: 0,
    },
  })
  return id
}

async function limpiar() {
  const liqs = await prisma.liquidacion_servicio.findMany({
    where: { consecutivo: { startsWith: MARCA } },
    select: { id: true },
  })
  const ids = liqs.map((l) => l.id)
  if (ids.length === 0) return
  await prisma.liquidacion_servicio_item.deleteMany({ where: { liquidacion_id: { in: ids } } })
  await prisma.liquidacion_servicio.deleteMany({ where: { id: { in: ids } } })
}

beforeAll(async () => {
  const cliente = await prisma.clientes.findFirst({ select: { id: true } })
  const usuario = await prisma.usuarios.findFirst({ select: { id: true } })
  if (!cliente || !usuario) {
    // La base efímera puede arrancar vacía; se siembra lo mínimo.
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
    usuarioId = randomUUID()
    await prisma.usuarios.create({
      data: {
        id: usuarioId,
        nombre: `${MARCA} Usuario`,
        correo: `${MARCA.toLowerCase()}@example.test`,
        password: 'x',
        role: 'admin',
        created_at: new Date(),
        updated_at: new Date(),
      } as any,
    })
  } else {
    clienteId = cliente.id
    usuarioId = usuario.id
  }
}, 30_000)

beforeEach(async () => {
  emitidos.length = 0
  await limpiar()
})

afterAll(async () => {
  await limpiar()
  await prisma.$disconnect()
})

describe('PATCH /liquidaciones-servicios/:id/restaurar', () => {
  it('emite la liquidación restaurada (con id y consecutivo), no el resumen del servicio', async () => {
    const id = await crearLiquidacion()
    await eliminarLiquidacionServicio(id, { usuarioId, motivo: 'prueba' })

    const reply = respuesta()
    await LiquidacionesServiciosController.restaurar(
      { params: { id }, body: { motivo: 'la borré por error' }, user: { id: usuarioId, nombre: 'Prueba' } } as any,
      reply as any,
    )

    expect(reply.codigo).toBe(200)
    expect(emitidos).toHaveLength(1)
    const [{ evento, data, meta }] = emitidos
    // `created`: para quien tiene el listado abierto la fila no existe, y
    // `updated` solo parchea filas presentes.
    expect(evento).toBe('liquidacion-servicio-created')
    expect(data.id).toBe(id)
    expect(data.consecutivo).toBe(`${MARCA}-${id.slice(0, 8)}`)
    expect(data.deleted_at).toBeNull()
    // Vuelve con sus ítems: es lo que el listado usa para `total_items`.
    expect(data.items).toHaveLength(1)
    expect(meta.etiqueta).toBe(data.consecutivo)
    expect(meta.actor).toEqual({ id: usuarioId, nombre: 'Prueba' })

    // La respuesta HTTP conserva el resumen de antes y añade la liquidación.
    expect(reply.cuerpo.relacionadas.items).toBe(1)
    expect(reply.cuerpo.liquidacion.id).toBe(id)
  })

  it('deja en la auditoría quién restauró y por qué', async () => {
    const id = await crearLiquidacion()
    await eliminarLiquidacionServicio(id, { usuarioId, motivo: 'prueba' })

    await LiquidacionesServiciosController.restaurar(
      { params: { id }, body: { motivo: '  la borré por error  ' }, user: { id: usuarioId, nombre: 'Prueba' } } as any,
      respuesta() as any,
    )

    // Antes el controlador no pasaba el usuario al servicio y la fila de
    // auditoría quedaba con `usuario_id` nulo.
    // `npm run test:setup` aplica la migración que crea `auditoria.borrado_logico`.
    const filas = await prisma.$queryRawUnsafe<Array<{ usuario_id: string | null; motivo: string | null }>>(
      `SELECT usuario_id, motivo
         FROM auditoria.borrado_logico
        WHERE entidad = 'liquidacion_servicio' AND registro_id = $1 AND accion = 'RESTAURAR'`,
      id,
    )
    expect(filas).toHaveLength(1)
    expect(filas[0].usuario_id).toBe(usuarioId)
    expect(filas[0].motivo).toBe('la borré por error')
  })

  it('restaurar una que no está en la papelera es 409 y no emite nada', async () => {
    const id = await crearLiquidacion()

    const reply = respuesta()
    await LiquidacionesServiciosController.restaurar(
      { params: { id }, user: { id: usuarioId, nombre: 'Prueba' } } as any,
      reply as any,
    )

    expect(reply.codigo).toBe(409)
    expect(emitidos).toHaveLength(0)
  })

  it('una que no existe es 404', async () => {
    const reply = respuesta()
    await LiquidacionesServiciosController.restaurar(
      { params: { id: randomUUID() }, user: { id: usuarioId, nombre: 'Prueba' } } as any,
      reply as any,
    )
    expect(reply.codigo).toBe(404)
    expect(emitidos).toHaveLength(0)
  })
})
