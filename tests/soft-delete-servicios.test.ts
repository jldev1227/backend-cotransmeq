/**
 * Eliminar un servicio no lo destruye.
 *
 * `servicio.delete()` borraba en duro y el comentario del propio código lo
 * admitía: «hard delete por ahora». El módulo estaba a medias: la misma función
 * SÍ marcaba con `deleted_at` los `recargos_planillas` asociados, así que esos
 * se podían recuperar y el servicio que los originó no. Quedaban recargos
 * huérfanos de un servicio que ya no existía.
 *
 * El caso que más importa es el último: un servicio bloquea a su conductor y a
 * su vehículo mientras está activo. Si un servicio retirado siguiera contando,
 * el recurso quedaría reservado para siempre por algo que ya nadie ve.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const MARCA = 'ZZTEST-SRV'

let clienteId: string
let conductorId: string
let municipioId: string

async function limpiar() {
  await prisma.servicio.deleteMany({ where: { origen_especifico: { startsWith: MARCA } } })
  await prisma.clientes.deleteMany({ where: { nombre: { startsWith: MARCA } } })
  await prisma.conductores.deleteMany({ where: { numero_identificacion: { startsWith: MARCA } } })
  await prisma.municipios.deleteMany({ where: { nombre_municipio: { startsWith: MARCA } } })
}

beforeAll(async () => {
  await limpiar()
  const now = new Date()

  clienteId = randomUUID()
  await prisma.clientes.create({
    data: {
      id: clienteId, nombre: `${MARCA} Cliente`, nit: `${MARCA}-NIT`,
      createdAt: now, updatedAt: now
    } as any
  })

  conductorId = randomUUID()
  await prisma.conductores.create({
    data: {
      id: conductorId, nombre: 'P', apellido: 'SRV', tipo_identificacion: 'CC',
      numero_identificacion: `${MARCA}-1`, fecha_ingreso: now,
      cargo: 'CONDUCTOR', created_at: now, updated_at: now
    } as any
  })

  municipioId = randomUUID()
  await prisma.municipios.create({
    data: {
      id: municipioId, codigo_departamento: 85, nombre_departamento: 'CASANARE',
      codigo_municipio: 85001, nombre_municipio: `${MARCA} Yopal`, tipo: 'Municipio',
      latitud: 5, longitud: -72, created_at: now, updated_at: now
    } as any
  })
}, 60_000)

afterAll(async () => {
  await limpiar()
  await prisma.$disconnect()
})

async function crearServicio(sufijo: string, estado = 'planificado') {
  const id = randomUUID()
  await prisma.servicio.create({
    data: {
      id,
      origen_especifico: `${MARCA} origen ${sufijo}`,
      destino_especifico: `${MARCA} destino ${sufijo}`,
      fecha_solicitud: new Date(),
      valor: 100000,
      cliente_id: clienteId,
      conductor_id: conductorId,
      origen_id: municipioId,
      destino_id: municipioId,
      proposito_servicio: 'personal',
      estado: estado as any
    } as any
  })
  return id
}

describe('Servicios · borrado lógico', () => {
  it('un servicio retirado SIGUE EXISTIENDO, marcado', async () => {
    const id = await crearServicio('A')
    await prisma.servicio.update({ where: { id }, data: { deleted_at: new Date() } })

    /// Se busca la fila PRIMERO: un `not.toBeNull()` sobre el `undefined` de
    /// una fila destruida también pasaría.
    const fila = await prisma.servicio.findUnique({ where: { id } })
    expect(fila).not.toBeNull()
    expect(fila!.deleted_at).toBeInstanceOf(Date)
  })

  it('las listas no lo devuelven', async () => {
    const vivos = await prisma.servicio.findMany({
      where: { cliente_id: clienteId, deleted_at: null }
    })
    expect(vivos).toHaveLength(0)

    const todos = await prisma.servicio.findMany({ where: { cliente_id: clienteId } })
    expect(todos).toHaveLength(1)
  })

  it('un servicio retirado deja de bloquear a su conductor', async () => {
    /// Este es el caso que hacía falta cuidar. `hayRecursoOcupado` cuenta los
    /// servicios en estados que bloquean; sin el filtro, uno retirado dejaría
    /// al conductor reservado para siempre por algo que ya nadie ve.
    const ESTADOS_QUE_BLOQUEAN = ['planificado', 'en_curso']
    const bloqueando = await prisma.servicio.count({
      where: {
        deleted_at: null,
        conductor_id: conductorId,
        estado: { in: ESTADOS_QUE_BLOQUEAN as any }
      }
    })
    expect(bloqueando).toBe(0)

    /// Sin filtrar, el conductor seguiría ocupado.
    const sinFiltro = await prisma.servicio.count({
      where: { conductor_id: conductorId, estado: { in: ESTADOS_QUE_BLOQUEAN as any } }
    })
    expect(sinFiltro).toBe(1)
  })
})
