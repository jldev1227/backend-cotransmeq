/**
 * Liquidaciones de nómina: `LiquidacionesService` y su controlador contra la
 * base desechable.
 *
 * `soft-delete-liquidaciones-nomina.test.ts` prueba el marcado a mano con
 * Prisma y `src/lib/nomina/**.spec.ts` la aritmética pura del canvas. Faltaba
 * el servicio de verdad: el formulario de `/dashboard/nomina/agregar|editar`,
 * el desglose de recargos y el desprendible del backend (descarga y ZIP)
 * pasan por aquí, y nada comprobaba qué guarda, qué devuelve ni qué deja de
 * leerse.
 *
 * Ojo con lo que NO hace el servicio: salud, pensión, auxilio y neto llegan
 * ya calculados desde el formulario y se guardan tal cual. Lo que sí decide
 * —y es lo que se prueba— son los interruptores que anulan una cifra, los
 * totales derivados que lee la lista, el marcado de ítems al editar, el valor
 * de los recargos desde las planillas y las líneas del desprendible.
 *
 * Los casos con `it.fails` son BUGS conocidos de `src/`: describen la regla
 * correcta y hoy fallan. Cuando se arreglen, vitest avisará de que «pasan» y
 * hay que cambiarlos a `it`.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'

vi.mock('pdfmake/build/pdfmake', () => ({ default: {}, createPdf: () => ({}) }))
vi.mock('pdfmake/build/vfs_fonts', () => ({ default: { vfs: {} }, vfs: {} }))

/// `src/sockets` arrastra las colas de BullMQ al importarse, y el servicio solo
/// lo usa para el progreso del ZIP de desprendibles. Se sustituye por un
/// emisor que apunta lo que se habría mandado a cada sala.
const emitidos = vi.hoisted(() => [] as Array<{ sala: string; evento: string; datos: any }>)
vi.mock('../src/sockets', () => {
  const io = {
    to: (sala: string) => ({
      emit: (evento: string, datos: unknown) => {
        emitidos.push({ sala, evento, datos })
      },
    }),
  }
  return { getIO: () => io, getIo: () => io }
})

import { LiquidacionesService } from '../src/modules/liquidaciones/liquidaciones.service'
import { LiquidacionesController } from '../src/modules/liquidaciones/liquidaciones.controller'
import { LAYOUT_DESPRENDIBLE } from '../src/modules/nomina-canvas/desprendible.render'

const prisma = new PrismaClient()

/** Marca para poder limpiar solo lo que crea esta suite. */
const MARCA = 'ZZTEST-NOMSRV'
const PLACA = 'ZZNS'
/// Códigos de tipo de recargo propios: `previewRecargos` resuelve el % por
/// CÓDIGO entre todos los tipos activos, así que reutilizar «HED» o «RN» haría
/// depender el resultado de lo que otra suite haya dejado en la base.
const TIPO = { HE: 'ZZNSHE', RN: 'ZZNSRN', FX: 'ZZNSFX' }

let usuarioId: string
let conductorId: string
/// Conductor exclusivo del bloque de borrado: los conteos de la lista se
/// comprueban EXACTOS, y con el conductor compartido sumarían las demás.
let conductorListaId: string
let vehiculoA: string
let vehiculoB: string
let empresaOtros: string
let empresaParex: string
let empresaGeopark: string
let planillaOrigen1: string
let planillaOrigen2: string

const ahora = () => new Date()

async function limpiar() {
  const conductores = await prisma.conductores.findMany({
    where: { numero_identificacion: { startsWith: MARCA } },
    select: { id: true },
  })
  const cIds = conductores.map((c) => c.id)
  const liqs = await prisma.liquidaciones.findMany({
    where: { conductor_id: { in: cIds } },
    select: { id: true },
  })
  const ids = liqs.map((l) => l.id)
  if (ids.length) {
    const w = { liquidacion_id: { in: ids } }
    await prisma.firmas_desprendibles.deleteMany({ where: w })
    await prisma.bonificaciones.deleteMany({ where: w })
    await prisma.mantenimientos.deleteMany({ where: w })
    await prisma.pernotes.deleteMany({ where: w })
    await prisma.recargos.deleteMany({ where: w })
    await prisma.anticipos.deleteMany({ where: w })
    await prisma.liquidacion_vehiculo.deleteMany({ where: w })
    await prisma.liquidaciones.deleteMany({ where: { id: { in: ids } } })
  }
  if (cIds.length) {
    const planillas = await prisma.recargos_planillas.findMany({
      where: { conductor_id: { in: cIds } },
      select: { id: true },
    })
    const pIds = planillas.map((p) => p.id)
    if (pIds.length) {
      const dias = await prisma.dias_laborales_planillas.findMany({
        where: { recargo_planilla_id: { in: pIds } },
        select: { id: true },
      })
      await prisma.detalles_recargos_dias.deleteMany({
        where: { dia_laboral_id: { in: dias.map((d) => d.id) } },
      })
      await prisma.dias_laborales_planillas.deleteMany({ where: { recargo_planilla_id: { in: pIds } } })
      await prisma.recargos_planillas.deleteMany({ where: { id: { in: pIds } } })
    }
  }
  await prisma.tipos_recargos.deleteMany({ where: { codigo: { in: Object.values(TIPO) } } })
  await prisma.configuraciones_salarios.deleteMany({ where: { observaciones: { startsWith: MARCA } } })
  await prisma.conductores.deleteMany({ where: { id: { in: cIds } } })
  await prisma.vehiculos.deleteMany({ where: { placa: { startsWith: PLACA } } })
  await prisma.clientes.deleteMany({ where: { nombre: { startsWith: MARCA } } })
  await prisma.usuarios.deleteMany({ where: { correo: { startsWith: 'zztest-nomsrv' } } })
}

async function crearConductor(sufijo: string, nombre: string, apellido: string) {
  const id = randomUUID()
  await prisma.conductores.create({
    data: {
      id, nombre, apellido, tipo_identificacion: 'CC',
      numero_identificacion: `${MARCA}-${sufijo}`, fecha_ingreso: ahora(),
      cargo: 'CONDUCTOR', created_at: ahora(), updated_at: ahora(),
    } as any,
  })
  return id
}

async function crearCliente(nombre: string) {
  const id = randomUUID()
  await prisma.clientes.create({
    data: {
      id, nombre: `${MARCA} ${nombre}`, nit: `${MARCA}-${nombre}`,
      representante: 'X', cedula: '1', telefono: '1', direccion: 'X',
      createdAt: ahora(), updatedAt: ahora(),
    } as any,
  })
  return id
}

async function crearPlanilla(o: {
  empresaId: string
  vehiculoId: string
  mes: number
  anio: number
  eliminada?: boolean
}) {
  const id = randomUUID()
  await prisma.recargos_planillas.create({
    data: {
      id, conductor_id: conductorId, vehiculo_id: o.vehiculoId, empresa_id: o.empresaId,
      numero_planilla: `${MARCA}-${id.slice(0, 6)}`, mes: o.mes, a_o: o.anio,
      created_at: ahora(), updated_at: ahora(), deleted_at: o.eliminada ? ahora() : null,
    } as any,
  })
  return id
}

/** Lo mínimo que manda el formulario; cada caso añade lo suyo. */
function payloadBase(extra: Record<string, unknown> = {}): any {
  return {
    conductor_id: conductorId,
    periodo_inicio: '2026-03-01',
    periodo_fin: '2026-03-31',
    dias_laborados: 30,
    salario_base: 1_423_500,
    sueldo_total: 2_500_000,
    salud: 80_000,
    pension: 80_000,
    auxilio_transporte: 200_000,
    total_anticipos: 200_000,
    ...extra,
  }
}

/** Reply de Fastify reducido a lo que usa el controlador. */
function respuesta() {
  const r: any = { statusCode: 200, cuerpo: undefined, cabeceras: {} as Record<string, string> }
  r.status = (c: number) => {
    r.statusCode = c
    return r
  }
  r.code = r.status
  r.send = (b: unknown) => {
    r.cuerpo = b
    return r
  }
  r.header = (k: string, v: string) => {
    r.cabeceras[k] = v
    return r
  }
  return r
}

function peticion(o: { body?: any; params?: any; query?: any; method?: string } = {}): any {
  return {
    body: o.body ?? {},
    params: o.params ?? {},
    query: o.query ?? {},
    method: o.method ?? 'GET',
    user: { id: usuarioId },
    log: { error: () => {}, warn: () => {}, info: () => {} },
  }
}

const vivos = <T extends { deleted_at: Date | null }>(filas: T[]) => filas.filter((f) => f.deleted_at === null)

beforeAll(async () => {
  await limpiar()
  /// `actualizar` vuelca un bloque de depuración por cada guardado y el
  /// preview otro por planilla. No dicen nada que el test no compruebe.
  vi.spyOn(console, 'log').mockImplementation(() => {})

  usuarioId = randomUUID()
  await prisma.usuarios.create({
    data: {
      id: usuarioId, nombre: 'Tester Nómina', correo: `zztest-nomsrv-${usuarioId.slice(0, 8)}@example.test`,
      password: 'no-se-usa-en-tests', role: 'admin', created_at: ahora(), updated_at: ahora(),
    } as any,
  })
  conductorId = await crearConductor('1', 'Ana', 'Nómina')
  conductorListaId = await crearConductor('2', 'Luis', 'Lista')

  vehiculoA = randomUUID()
  vehiculoB = randomUUID()
  for (const [id, placa] of [[vehiculoA, `${PLACA}01`], [vehiculoB, `${PLACA}02`]]) {
    await prisma.vehiculos.create({
      data: { id, placa, clase_vehiculo: 'CAMIONETA', created_at: ahora(), updated_at: ahora() } as any,
    })
  }

  empresaOtros = await crearCliente('OTROS SA')
  empresaParex = await crearCliente('PAREX RESOURCES')
  empresaGeopark = await crearCliente('GEOPARK COLOMBIA')

  planillaOrigen1 = await crearPlanilla({ empresaId: empresaParex, vehiculoId: vehiculoA, mes: 3, anio: 2026 })
  planillaOrigen2 = await crearPlanilla({ empresaId: empresaParex, vehiculoId: vehiculoA, mes: 3, anio: 2026 })
}, 60_000)

afterAll(async () => {
  vi.restoreAllMocks()
  await limpiar()
  await prisma.$disconnect()
})

// ═══════════════════════════════════════════════════════════════════════════
describe('Crear: la liquidación nace con sus hijos y con las cifras del formulario', () => {
  it('guarda vehículos, bonos, mantenimientos, pernotes, recargos y anticipos, y los devuelve legibles', async () => {
    const liq: any = await LiquidacionesService.crear(
      payloadBase({
        vehiculos: [vehiculoA],
        detalles_vehiculos: [
          {
            vehiculo: { value: vehiculoA },
            bonos: [{ name: 'Bono alimentación', values: [{ mes: '2026-03', quantity: 4 }], value: 25_000 }],
            mantenimientos: [{ values: [{ mes: '2026-03', quantity: 1 }], value: 50_000 }],
            pernotes: [{ empresa_id: empresaOtros, cantidad: 2, valor: 60_000, fechas: ['2026-03-10', '2026-03-11'] }],
            recargos: [{ empresa_id: empresaParex, valor: 120_000, mes: '2026-03' }],
          },
        ],
        anticipos: [{ valor: 200_000, fecha: '2026-03-15', concepto: 'Adelanto quincena' }],
      }),
      usuarioId,
    )

    expect(liq.estado).toBe('Pendiente')
    expect(liq.creado_por?.id).toBe(usuarioId)
    /// El frontend lee `periodo_inicio/fin`; la tabla guarda `periodo_start/end`.
    expect(liq.periodo_inicio).toBe('2026-03-01')
    expect(liq.periodo_fin).toBe('2026-03-31')
    expect(liq.conductor).toMatchObject({ id: conductorId, nombre: 'Ana Nómina', cedula: `${MARCA}-1` })
    expect(liq.vehiculos.map((v: any) => v.placa)).toEqual([`${PLACA}01`])

    expect(liq.bonificaciones).toHaveLength(1)
    expect(Number(liq.bonificaciones[0].value)).toBe(25_000)
    expect(JSON.parse(liq.bonificaciones[0].values)).toEqual([{ mes: '2026-03', quantity: 4 }])
    expect(liq.mantenimientos).toHaveLength(1)
    /// `fechas` se guarda como texto JSON; el frontend espera un arreglo.
    expect(liq.pernotes).toHaveLength(1)
    expect(liq.pernotes[0]).toMatchObject({ fechas: ['2026-03-10', '2026-03-11'], valor: 60_000, cantidad: 2 })
    expect(liq.recargos).toHaveLength(1)
    expect(liq.recargos[0]).toMatchObject({ es_automatico: false, es_override: false, mes: '2026-03' })
    expect(liq.anticipos).toHaveLength(1)
    expect(liq.anticipos[0].concepto).toBe('Adelanto quincena')

    /// Los Decimal salen como número: la lista y el desprendible suman con
    /// ellos, y un Decimal concatenado con `+` da texto, no un total.
    for (const campo of ['sueldo_total', 'salud', 'pension', 'auxilio_transporte', 'total_anticipos']) {
      expect(typeof liq[campo]).toBe('number')
    }
  })

  it('el devengado y el deducido de la lista se derivan del neto guardado', async () => {
    /// `sueldo_total` ya es el NETO (bruto − deducciones). La lista reconstruye
    /// el devengado sumándole salud, pensión y anticipos; si alguno faltara, el
    /// «total devengado» saldría por debajo de lo que de verdad se pagó.
    const liq: any = await LiquidacionesService.crear(payloadBase(), usuarioId)
    expect(liq.neto_pagado).toBe(2_500_000)
    expect(liq.total_deducido).toBe(80_000 + 80_000 + 200_000)
    expect(liq.total_devengado).toBe(2_500_000 + 80_000 + 80_000 + 200_000)
  })

  it('los interruptores anulan la cifra aunque el formulario la mande', async () => {
    /// «No descontar salud/pensión» y «descontar transporte» son decisiones de
    /// la persona que liquida: el valor calculado puede seguir viajando en el
    /// payload, y guardarlo cobraría una deducción que se decidió no hacer.
    const liq: any = await LiquidacionesService.crear(
      payloadBase({
        no_descontar_salud: true,
        no_descontar_pension: true,
        descontar_transporte: true,
        /// Sin su interruptor, el importe del ajuste no se guarda: es el
        /// círculo que describe el schema (el importe solo vale con el
        /// interruptor puesto).
        ajuste_parex: false,
        ajuste_parex_valor: 90_000,
        ajuste_geopark: false,
        ajuste_geopark_valor: 70_000,
      }),
      usuarioId,
    )
    expect(liq.salud).toBe(0)
    expect(liq.pension).toBe(0)
    expect(liq.auxilio_transporte).toBe(0)
    expect(liq.ajuste_parex).toBe(0)
    expect(liq.ajuste_geopark).toBe(0)
  })

  it('el ajuste PAREX se guarda con su interruptor o con «recargos completos»', async () => {
    const conInterruptor: any = await LiquidacionesService.crear(
      payloadBase({ ajuste_parex: true, ajuste_parex_valor: 90_000, ajuste_geopark: true, ajuste_geopark_valor: 70_000 }),
      usuarioId,
    )
    expect(conInterruptor.ajuste_parex).toBe(90_000)
    expect(conInterruptor.ajuste_geopark).toBe(70_000)

    const completos: any = await LiquidacionesService.crear(
      payloadBase({ ajuste_parex_recargos_completos: true, ajuste_parex_valor: 45_000 }),
      usuarioId,
    )
    expect(completos.ajuste_parex).toBe(45_000)
    expect(completos.ajuste_parex_recargos_completos).toBe(true)
  })

  it('solo «Liquidado» se respeta como estado inicial; cualquier otro nace Pendiente', async () => {
    const liquidada: any = await LiquidacionesService.crear(payloadBase({ estado: 'Liquidado' }), usuarioId)
    expect(liquidada.estado).toBe('Liquidado')
    /// El enum solo tiene dos valores; un estado del flujo nuevo («APROBADA»)
    /// mandado aquí reventaría el insert si se pasara tal cual.
    const otro: any = await LiquidacionesService.crear(payloadBase({ estado: 'APROBADA' }), usuarioId)
    expect(otro.estado).toBe('Pendiente')
    const sinEstado: any = await LiquidacionesService.crear(payloadBase(), usuarioId)
    expect(sinEstado.estado).toBe('Pendiente')
  })

  it('«días a la base prestacional» distingue vacío de cero', async () => {
    /// null = «sin decidir» y vale por el ajuste entero; 0 = no cotiza. Un `||`
    /// en vez de `??` convertiría el 0 en null y cotizaría lo que no debía.
    const vacio: any = await LiquidacionesService.crear(payloadBase(), usuarioId)
    expect(vacio.dias_ajuste_deducciones).toBeNull()
    const cero: any = await LiquidacionesService.crear(payloadBase({ dias_ajuste_deducciones: 0 }), usuarioId)
    expect(cero.dias_ajuste_deducciones).toBe(0)
  })

  it('un pernote o recargo sin empresa no se guarda, y el pernote con contenido deja aviso', async () => {
    /// `empresa_id` es obligatorio en las dos tablas. El frontend ya valida,
    /// pero si se cuela uno el guardado no puede caerse entero por él; el
    /// aviso existe para que el pernote perdido no pase en silencio.
    const avisos = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const liq: any = await LiquidacionesService.crear(
      payloadBase({
        detalles_vehiculos: [
          {
            vehiculo: { value: vehiculoA },
            pernotes: [{ empresa_id: '', cantidad: 1, valor: 60_000, fechas: ['2026-03-12'] }],
            recargos: [{ empresa_id: null, valor: 50_000, mes: '2026-03' }],
          },
        ],
      }),
      usuarioId,
    )
    expect(liq.pernotes).toHaveLength(0)
    expect(liq.recargos).toHaveLength(0)
    expect(avisos.mock.calls.some((c) => String(c[0]).includes('Pernote omitido'))).toBe(true)
    avisos.mockRestore()
  })

  it('un recargo manual con planilla de origen queda marcado como override', async () => {
    /// El override es lo que permite «revertir» después y que el automático
    /// vuelva a contar; sin la marca, el manual y el automático se sumarían.
    const liq: any = await LiquidacionesService.crear(
      payloadBase({
        detalles_vehiculos: [
          {
            vehiculo: { value: vehiculoA },
            recargos: [{ empresa_id: empresaParex, valor: 99_000, mes: '2026-03', origen_planilla_id: planillaOrigen1 }],
          },
        ],
      }),
      usuarioId,
    )
    expect(liq.recargos).toHaveLength(1)
    expect(liq.recargos[0]).toMatchObject({ es_override: true, origen_planilla_id: planillaOrigen1, es_automatico: false })
  })

  /// Regresión: en transmeralda `crear` no procesaba `recargos_preview` —solo
  /// `actualizar`—, aunque el formulario de «Agregar» lo manda igual que el de
  /// «Editar». La liquidación nacía con `total_recargos` contando los
  /// automáticos pero sin sus filas, y el desprendible del backend
  /// (`datosDesprendible`, que suma filas) los omitía. Cotransmeq ya tenía el
  /// bloque; se portó (11-oct-2026).
  it('guarda los recargos automáticos que el formulario incluyó del preview', async () => {
    const liq: any = await LiquidacionesService.crear(
      payloadBase({
        total_recargos: 300_000,
        recargos_preview: [
          {
            key: 'k1', vehiculo_id: vehiculoA, empresa_id: empresaParex, mes: '2026-03', emisor: 'TM',
            valor: 300_000, origen_planilla_id: planillaOrigen1, numero_planilla: 'P-1',
          },
        ],
      }),
      usuarioId,
    )
    const automaticos = liq.recargos.filter((r: any) => r.es_automatico)
    expect(automaticos).toHaveLength(1)
    expect(Number(automaticos[0].valor)).toBe(300_000)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('Actualizar: lo que no llega se conserva y lo que se reemplaza se marca', () => {
  it('un guardado parcial conserva las cifras que no trae y registra quién editó', async () => {
    const liq: any = await LiquidacionesService.crear(payloadBase({ cesantias: 118_000, observaciones: 'v1' }), usuarioId)
    const editada: any = await LiquidacionesService.actualizar(liq.id, { observaciones: 'v2' }, usuarioId)
    expect(editada.observaciones).toBe('v2')
    expect(editada.sueldo_total).toBe(2_500_000)
    expect(editada.salud).toBe(80_000)
    expect(editada.pension).toBe(80_000)
    expect(editada.cesantias).toBe(118_000)
    expect(editada.dias_laborados).toBe(30)
    expect(editada.conductor.id).toBe(conductorId)
    expect(editada.actualizado_por?.id).toBe(usuarioId)
  })

  it('los interruptores también mandan al editar', async () => {
    const liq: any = await LiquidacionesService.crear(payloadBase(), usuarioId)
    const editada: any = await LiquidacionesService.actualizar(
      liq.id,
      { no_descontar_salud: true, salud: 80_000, descontar_transporte: true, auxilio_transporte: 200_000 },
      usuarioId,
    )
    expect(editada.salud).toBe(0)
    expect(editada.auxilio_transporte).toBe(0)
    expect(editada.pension).toBe(80_000)
  })

  it('el estado va de Pendiente a Liquidado y vuelve; un valor desconocido no lo cambia', async () => {
    const liq: any = await LiquidacionesService.crear(payloadBase(), usuarioId)
    expect((await LiquidacionesService.actualizar(liq.id, { estado: 'Liquidado' }, usuarioId)).estado).toBe('Liquidado')
    /// Un estado que el enum no conoce no puede tumbar el guardado ni
    /// devolverla a Pendiente sin querer: se queda como estaba.
    expect((await LiquidacionesService.actualizar(liq.id, { estado: 'PAGADA' }, usuarioId)).estado).toBe('Liquidado')
    expect((await LiquidacionesService.actualizar(liq.id, { estado: 'Pendiente' }, usuarioId)).estado).toBe('Pendiente')
  })

  it('reemplazar los detalles MARCA la versión anterior y solo se lee la nueva', async () => {
    const liq: any = await LiquidacionesService.crear(
      payloadBase({
        total_bonificaciones: 100_000,
        detalles_vehiculos: [
          {
            vehiculo: { value: vehiculoA },
            bonos: [{ name: 'Bono', values: [{ mes: '2026-03', quantity: 4 }], value: 25_000 }],
            mantenimientos: [{ values: [], value: 10_000 }],
            pernotes: [{ empresa_id: empresaOtros, cantidad: 1, valor: 60_000, fechas: ['2026-03-02'] }],
            recargos: [{ empresa_id: empresaOtros, valor: 40_000, mes: '2026-03' }],
          },
        ],
      }),
      usuarioId,
    )

    const editada: any = await LiquidacionesService.actualizar(
      liq.id,
      {
        total_bonificaciones: 150_000,
        total_pernotes: 120_000,
        detalles_vehiculos: [
          {
            vehiculo: { value: vehiculoA },
            bonos: [{ name: 'Bono', values: [{ mes: '2026-03', quantity: 6 }], value: 25_000 }],
            pernotes: [{ empresa_id: empresaOtros, cantidad: 2, valor: 60_000, fechas: ['2026-03-02', '2026-03-03'] }],
          },
        ],
      },
      usuarioId,
    )

    /// Lo que devuelve la API es solo la versión vigente…
    expect(editada.bonificaciones).toHaveLength(1)
    expect(JSON.parse(editada.bonificaciones[0].values)[0].quantity).toBe(6)
    expect(editada.pernotes).toHaveLength(1)
    expect(editada.pernotes[0].cantidad).toBe(2)
    expect(editada.mantenimientos).toHaveLength(0)
    expect(editada.recargos).toHaveLength(0)
    expect(editada.total_bonificaciones).toBe(150_000)
    expect(editada.total_pernotes).toBe(120_000)
    /// …y un total que no llega se pone a cero: los detalles se acaban de
    /// reemplazar enteros y el total viejo ya no describe nada.
    expect(editada.total_recargos).toBe(0)

    /// …pero la anterior sigue en la tabla, marcada, para poder comparar.
    const bonos = await prisma.bonificaciones.findMany({ where: { liquidacion_id: liq.id } })
    expect(bonos).toHaveLength(2)
    expect(vivos(bonos)).toHaveLength(1)
    const recargos = await prisma.recargos.findMany({ where: { liquidacion_id: liq.id } })
    expect(recargos).toHaveLength(1)
    expect(recargos[0].deleted_at).toBeInstanceOf(Date)
  })

  it('anticipos: [] retira todos; si no llegan, no se tocan', async () => {
    const liq: any = await LiquidacionesService.crear(
      payloadBase({ anticipos: [{ valor: 200_000, fecha: '2026-03-15' }] }),
      usuarioId,
    )
    const sinTocar: any = await LiquidacionesService.actualizar(liq.id, { observaciones: 'x' }, usuarioId)
    expect(sinTocar.anticipos).toHaveLength(1)

    const vaciados: any = await LiquidacionesService.actualizar(liq.id, { conductor_id: conductorId, anticipos: [] }, usuarioId)
    expect(vaciados.anticipos).toHaveLength(0)
    const enTabla = await prisma.anticipos.findMany({ where: { liquidacion_id: liq.id } })
    expect(enTabla).toHaveLength(1)
    expect(enTabla[0].deleted_at).toBeInstanceOf(Date)
  })

  it('cambiar de vehículo retira el anterior y solo se lee el nuevo', async () => {
    const liq: any = await LiquidacionesService.crear(payloadBase({ vehiculos: [vehiculoA] }), usuarioId)
    const editada: any = await LiquidacionesService.actualizar(liq.id, { vehiculos: [vehiculoB] }, usuarioId)
    expect(editada.vehiculos.map((v: any) => v.id)).toEqual([vehiculoB])
    const filas = await prisma.liquidacion_vehiculo.findMany({ where: { liquidacion_id: liq.id } })
    expect(filas).toHaveLength(2)
    expect(vivos(filas).map((f) => f.vehiculo_id)).toEqual([vehiculoB])
  })

  /// BUG: `liquidacion_vehiculo` tiene clave primaria (liquidacion_id,
  /// vehiculo_id). `actualizar` marca la fila y luego hace `createMany` con la
  /// MISMA clave → P2002. El formulario de edición siempre manda `vehiculos`,
  /// así que guardar sin cambiar de vehículo falla. Y como no hay
  /// transacción, la liquidación queda ya editada y SIN vehículos vivos.
  /// Es el patrón de «tachar y reinsertar» que se arregló en los pivotes de
  /// terceros el 1-oct-2026 (borrar de verdad lo que vuelve, marcar lo que sale).
  it.fails('guardar de nuevo con el MISMO vehículo no revienta ni lo pierde', async () => {
    const liq: any = await LiquidacionesService.crear(payloadBase({ vehiculos: [vehiculoA] }), usuarioId)
    try {
      await LiquidacionesService.actualizar(liq.id, { vehiculos: [vehiculoA] }, usuarioId)
    } finally {
      const leida: any = await LiquidacionesService.obtenerPorId(liq.id)
      expect(leida.vehiculos.map((v: any) => v.id)).toEqual([vehiculoA])
    }
  })

  it('recargos del preview: un grupo repetido crea UN recargo y los excluidos no entran', async () => {
    /// El frontend manda una entrada por planilla que compone el grupo, todas
    /// con el MISMO `valor` (el total del grupo). Sin deduplicar por clave, un
    /// grupo de tres planillas pagaba el triple.
    const liq: any = await LiquidacionesService.crear(payloadBase(), usuarioId)
    const grupo = {
      key: 'k1', vehiculo_id: vehiculoA, empresa_id: empresaParex, mes: '2026-03', emisor: 'TM',
      valor: 300_000, numero_planilla: 'P-1',
    }
    const editada: any = await LiquidacionesService.actualizar(
      liq.id,
      {
        total_recargos: 300_000,
        detalles_vehiculos: [],
        recargos_preview: [
          { ...grupo, origen_planilla_id: planillaOrigen1 },
          { ...grupo, origen_planilla_id: planillaOrigen2 },
          { ...grupo, origen_planilla_id: planillaOrigen2 },
          { ...grupo, empresa_id: empresaGeopark, valor: 55_000, incluir: false },
        ],
      },
      usuarioId,
    )
    const automaticos = editada.recargos.filter((r: any) => r.es_automatico)
    expect(automaticos).toHaveLength(1)
    expect(Number(automaticos[0].valor)).toBe(300_000)
    expect(automaticos[0].origen_planilla_id).toBe(planillaOrigen1)
    expect(automaticos[0].clientes.id).toBe(empresaParex)
  })

  /// BUG: el segundo guardado con recargos del preview los PIERDE. `actualizar`
  /// marca primero todos los recargos (también los automáticos) y después hace
  /// `upsert` por (liquidacion_id, origen_planilla_id) —o `findFirst` sin
  /// `deleted_at` en el camino sin origen—: encuentra la fila RECIÉN MARCADA,
  /// la actualiza sin tocar `deleted_at` y el automático queda archivado. La
  /// liquidación conserva `total_recargos` pero ya no tiene la fila, y el
  /// desprendible del backend deja de mostrar ese recargo.
  ///
  /// Así falla en esta base, que tiene el único COMPLETO además del parcial
  /// (`db push` lo recrea desde el `@@unique`). En la base de tm solo queda el
  /// PARCIAL, y el `upsert` de Prisma es un `INSERT … ON CONFLICT
  /// (liquidacion_id, origen_planilla_id)` que Postgres no puede casar con un
  /// índice parcial: allí revienta ya en el primer guardado, a medias y sin
  /// transacción.
  it.fails('guardar dos veces con el mismo grupo del preview deja UN automático vivo con el valor nuevo', async () => {
    const liq: any = await LiquidacionesService.crear(payloadBase(), usuarioId)
    const grupo = {
      key: 'k1', vehiculo_id: vehiculoA, empresa_id: empresaParex, mes: '2026-03', emisor: 'TM',
      origen_planilla_id: planillaOrigen1, numero_planilla: 'P-1',
    }
    await LiquidacionesService.actualizar(
      liq.id, { detalles_vehiculos: [], recargos_preview: [{ ...grupo, valor: 300_000 }] }, usuarioId,
    )
    const segunda: any = await LiquidacionesService.actualizar(
      liq.id, { detalles_vehiculos: [], recargos_preview: [{ ...grupo, valor: 350_000 }] }, usuarioId,
    )
    const automaticos = segunda.recargos.filter((r: any) => r.es_automatico)
    expect(automaticos).toHaveLength(1)
    expect(Number(automaticos[0].valor)).toBe(350_000)
  })

  /// BUG: mismo caso por el camino sin `origen_planilla_id` (`findFirst` +
  /// `update`): el automático también queda archivado tras el segundo guardado.
  it.fails('lo mismo sin planilla de origen: el segundo guardado no archiva el automático', async () => {
    const liq: any = await LiquidacionesService.crear(payloadBase(), usuarioId)
    const grupo = { key: 'k2', vehiculo_id: vehiculoB, empresa_id: empresaOtros, mes: '2026-03', emisor: 'TM' }
    await LiquidacionesService.actualizar(
      liq.id, { detalles_vehiculos: [], recargos_preview: [{ ...grupo, valor: 80_000 }] }, usuarioId,
    )
    const segunda: any = await LiquidacionesService.actualizar(
      liq.id, { detalles_vehiculos: [], recargos_preview: [{ ...grupo, valor: 90_000 }] }, usuarioId,
    )
    const automaticos = segunda.recargos.filter((r: any) => r.es_automatico)
    expect(automaticos).toHaveLength(1)
    expect(Number(automaticos[0].valor)).toBe(90_000)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('Eliminar: se marca la madre, las lecturas la ignoran y restaurar la devuelve entera', () => {
  let pendienteId: string
  let liquidadaId: string

  beforeAll(async () => {
    const pendiente: any = await LiquidacionesService.crear(
      payloadBase({ conductor_id: conductorListaId, sueldo_total: 1_000_000 }),
      usuarioId,
    )
    pendienteId = pendiente.id
    const liquidada: any = await LiquidacionesService.crear(
      payloadBase({
        conductor_id: conductorListaId,
        periodo_inicio: '2026-04-01',
        periodo_fin: '2026-04-30',
        sueldo_total: 2_000_000,
        estado: 'Liquidado',
        vehiculos: [vehiculoA],
        detalles_vehiculos: [
          {
            vehiculo: { value: vehiculoA },
            bonos: [{ name: 'Bono', values: [{ mes: '2026-04', quantity: 2 }], value: 25_000 }],
            pernotes: [{ empresa_id: empresaOtros, cantidad: 1, valor: 60_000, fechas: ['2026-04-02'] }],
            recargos: [{ empresa_id: empresaParex, valor: 70_000, mes: '2026-04' }],
          },
        ],
        anticipos: [{ valor: 100_000, fecha: '2026-04-10' }],
      }),
      usuarioId,
    )
    liquidadaId = liquidada.id
    await prisma.liquidaciones.update({ where: { id: liquidadaId }, data: { desprendible_visible: true } })
    /// La firma del conductor: la evidencia que el borrado nunca puede llevarse.
    await prisma.firmas_desprendibles.create({
      data: {
        id: randomUUID(), liquidacion_id: liquidadaId, conductor_id: conductorListaId,
        firma_url: 'https://ejemplo/firma.png', firma_s3_key: `${MARCA}/firma.png`,
        fecha_firma: ahora(), created_at: ahora(), updated_at: ahora(),
      } as any,
    })
  })

  it('antes de eliminar, la lista y sus contadores la cuentan', async () => {
    const r = await LiquidacionesService.obtenerTodas({ conductor_id: conductorListaId })
    expect(r.liquidaciones.map((l: any) => l.id).sort()).toEqual([pendienteId, liquidadaId].sort())
    expect(r.stats).toMatchObject({
      totalRegistros: 2, totalPendientes: 1, montoTotal: 3_000_000, totalVisibles: 1, totalFirmados: 1,
    })
  })

  it('eliminar marca la madre y no toca hijos ni firma', async () => {
    const r = await LiquidacionesService.eliminar(liquidadaId)
    expect(r.success).toBe(true)
    const fila = await prisma.liquidaciones.findUnique({ where: { id: liquidadaId } })
    expect(fila!.deleted_at).toBeInstanceOf(Date)
    expect(await prisma.firmas_desprendibles.count({ where: { liquidacion_id: liquidadaId } })).toBe(1)
    for (const tabla of ['bonificaciones', 'pernotes', 'recargos', 'anticipos', 'liquidacion_vehiculo'] as const) {
      const hijos = await (prisma[tabla] as any).findMany({ where: { liquidacion_id: liquidadaId } })
      expect(hijos.length, tabla).toBe(1)
      expect(hijos[0].deleted_at, tabla).toBeNull()
    }
  })

  it('la consulta directa la trata como inexistente', async () => {
    await expect(LiquidacionesService.obtenerPorId(liquidadaId)).rejects.toThrow('Liquidación no encontrada')
  })

  it('la lista, los conteos, el monto total y los «firmados» ya no la cuentan', async () => {
    /// Las seis consultas de `obtenerTodas` comparten un `where`. Si una se
    /// quedara sin filtro, el monto total de la nómina sumaría una liquidación
    /// retirada: en una tabla de dinero eso no es un fallo visual.
    const r = await LiquidacionesService.obtenerTodas({ conductor_id: conductorListaId })
    expect(r.liquidaciones.map((l: any) => l.id)).toEqual([pendienteId])
    expect(r.stats).toMatchObject({
      totalRegistros: 1, totalPendientes: 1, montoTotal: 1_000_000, totalVisibles: 0, totalFirmados: 0,
    })
    expect(r.pagination.total).toBe(1)
  })

  it('ni la búsqueda por cédula ni el filtro por mes de nómina la devuelven', async () => {
    const porCedula = await LiquidacionesService.obtenerTodas({ search: `${MARCA}-2` })
    expect(porCedula.liquidaciones.map((l: any) => l.id)).toEqual([pendienteId])
    const porMes = await LiquidacionesService.obtenerTodas({ conductor_id: conductorListaId, nomina_month: '2026-04' })
    expect(porMes.liquidaciones).toHaveLength(0)
  })

  it('no se puede editar ni eliminar otra vez, y el desprendible no se genera', async () => {
    /// Borrarla dos veces debe dar error, no un «eliminada correctamente» sobre nada.
    await expect(LiquidacionesService.eliminar(liquidadaId)).rejects.toThrow('Liquidación no encontrada')
    await expect(LiquidacionesService.actualizar(liquidadaId, { observaciones: 'x' }, usuarioId)).rejects.toThrow(
      'Liquidación no encontrada',
    )
    const fila = await prisma.liquidaciones.findUnique({ where: { id: liquidadaId } })
    expect(fila!.observaciones).toBeNull()
    await expect(LiquidacionesService.datosDesprendible(liquidadaId)).rejects.toThrow('no encontrada')
  })

  it('el ZIP de solo eliminadas falla con un error claro y avisa por el socket', async () => {
    /// «O sale entero o sale un error que se entiende»: un ZIP vacío que
    /// parece válido es peor que un error.
    emitidos.length = 0
    await expect(LiquidacionesService.generatePayslipsZip([liquidadaId], 'sock-1')).rejects.toThrow(
      'No se pudo generar ningún desprendible',
    )
    const eventos = emitidos.filter((e) => e.sala === 'sock-1').map((e) => e.evento)
    expect(eventos).toEqual(['progress:start', 'progress:error', 'progress:update'])
  })

  it('restaurar la devuelve con TODOS sus ítems y su firma', async () => {
    /// No hay endpoint de restaurar nómina: se hace quitando la marca. El
    /// incidente que originó el borrado lógico fue una liquidación que volvió
    /// VACÍA porque la cascada se había llevado sus ítems.
    await prisma.liquidaciones.update({ where: { id: liquidadaId }, data: { deleted_at: null } })
    const viva: any = await LiquidacionesService.obtenerPorId(liquidadaId)
    expect(viva.vehiculos.map((v: any) => v.id)).toEqual([vehiculoA])
    expect(viva.bonificaciones).toHaveLength(1)
    expect(viva.pernotes).toHaveLength(1)
    expect(viva.recargos).toHaveLength(1)
    expect(viva.anticipos).toHaveLength(1)
    expect(viva.firmas_desprendibles).toHaveLength(1)
    expect(viva.sueldo_total).toBe(2_000_000)
    const r = await LiquidacionesService.obtenerTodas({ conductor_id: conductorListaId })
    expect(r.stats.montoTotal).toBe(3_000_000)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('Desprendible: las líneas salen de lo guardado', () => {
  let liqId: string

  beforeAll(async () => {
    const liq: any = await LiquidacionesService.crear(
      payloadBase({
        periodo_inicio: '2026-05-01',
        periodo_fin: '2026-05-31',
        salario_base: 1_423_500,
        auxilio_transporte: 200_000,
        salud: 56_940,
        pension: 56_940,
        total_anticipos: 150_000,
        ajuste_valor: 150_000,
        dias_laborados_villanueva: 20,
        disponibilidad: 90_000,
        conceptos_adicionales: [
          { valor: 35_000, nombre: 'Reintegro dotación' },
          { valor: -20_000, nombre: 'Descuento celular' },
          { valor: 0, nombre: 'Sin importe' },
        ],
        detalles_vehiculos: [
          {
            vehiculo: { value: vehiculoA },
            bonos: [
              {
                name: 'Bono alimentación',
                values: [{ mes: '2026-05', quantity: 3 }, { mes: '2026-05', quantity: 2 }],
                value: 25_000,
              },
            ],
            pernotes: [{ empresa_id: empresaOtros, cantidad: 2, valor: 60_000, fechas: ['2026-05-02', '2026-05-03'] }],
            recargos: [
              { empresa_id: empresaParex, valor: 100_000, mes: '2026-05' },
              { empresa_id: empresaOtros, valor: 40_000, mes: '2026-05' },
              { empresa_id: empresaGeopark, valor: 70_000, mes: '2026-05' },
            ],
          },
        ],
        anticipos: [
          { valor: 100_000, fecha: '2026-05-10' },
          { valor: 50_000, fecha: '2026-05-20' },
        ],
      }),
      usuarioId,
    )
    liqId = liq.id
    /// Un automático desmarcado y un recargo y un anticipo ya retirados: los
    /// tres existen en la tabla y ninguno puede llegar al papel.
    await prisma.recargos.create({
      data: {
        id: randomUUID(), empresa_id: empresaOtros, valor: 999_999, es_automatico: true, incluir: false,
        mes: '2026-05', liquidacion_id: liqId, created_at: ahora(), updated_at: ahora(),
      } as any,
    })
    await prisma.recargos.create({
      data: {
        id: randomUUID(), empresa_id: empresaParex, valor: 888_888, mes: '2026-05', liquidacion_id: liqId,
        deleted_at: ahora(), created_at: ahora(), updated_at: ahora(),
      } as any,
    })
    await prisma.anticipos.create({
      data: {
        id: randomUUID(), valor: 70_000, fecha: new Date('2026-05-25'), liquidacion_id: liqId,
        conductor_id: conductorId, deleted_at: ahora(), created_at: ahora(), updated_at: ahora(),
      } as any,
    })
  })

  it('devengos: básicos, bonos por cantidad, pernotes, recargos por bloque y novedades', async () => {
    /// La maquetación nueva reduce los recargos a tres bloques (OTROS, PAREX,
    /// GEOPARK); es la que usa la suite porque `.env.test` no fija otra.
    expect(LAYOUT_DESPRENDIBLE).toBe('nuevo')
    const d = await LiquidacionesService.datosDesprendible(liqId)

    expect(d.devengos).toEqual([
      { concepto: 'SALARIO DEVENGADO', cantidad: 30, valor: 1_423_500, grupo: 'basico' },
      { concepto: 'AUXILIO DE TRANSPORTE', cantidad: 30, valor: 200_000, grupo: 'basico' },
      /// El bono de nivelación cuenta los días de Villanueva, no los laborados.
      { concepto: 'BONO NIVELACION DE SALARIO', cantidad: 20, valor: 150_000, grupo: 'basico' },
      /// Cantidad = suma de `quantity` de todos los meses; valor = cantidad × unitario.
      { concepto: 'BONO ALIMENTACIÓN', cantidad: 5, valor: 125_000, grupo: 'adicional' },
      { concepto: 'PERNOTES', cantidad: 2, valor: 120_000, grupo: 'adicional' },
      /// Ni el automático desmarcado (999.999) ni el retirado (888.888) entran.
      { concepto: 'RECARGOS OTROS', cantidad: null, valor: 40_000, grupo: 'adicional' },
      { concepto: 'RECARGOS PAREX', cantidad: null, valor: 100_000, grupo: 'adicional' },
      { concepto: 'RECARGOS GEOPARK', cantidad: null, valor: 70_000, grupo: 'adicional' },
      { concepto: 'DISPONIBILIDAD MES', cantidad: null, valor: 90_000, grupo: 'adicional' },
      { concepto: 'REINTEGRO DOTACIÓN', cantidad: null, valor: 35_000, grupo: 'novedad' },
      /// Un concepto en negativo ES la deducción pactada: no se descarta.
      { concepto: 'DESCUENTO CELULAR', cantidad: null, valor: -20_000, grupo: 'novedad' },
    ])
  })

  it('deducciones: salud, pensión y la suma de los anticipos VIVOS', async () => {
    const d = await LiquidacionesService.datosDesprendible(liqId)
    expect(d.deducciones).toEqual([
      { concepto: 'SALUD', cantidad: null, valor: 56_940 },
      { concepto: 'PENSION', cantidad: null, valor: 56_940 },
      /// 100.000 + 50.000; el retirado de 70.000 no se descuenta otra vez.
      { concepto: 'ANTICIPOS', cantidad: null, valor: 150_000 },
    ])
  })

  it('la base prestacional es salario + vacaciones, y la cabecera es la de la empresa', async () => {
    const d = await LiquidacionesService.datosDesprendible(liqId)
    expect(d.basePrestacional).toBe(1_423_500)
    expect(d.empleado).toMatchObject({ nombre: 'Ana Nómina', cedula: `${MARCA}-1`, cargo: 'CONDUCTOR' })
    expect(d.empresa).toEqual({ nombre: 'SERVICIOS Y TRANSPORTES COTRANSMEQ S.A.S.', nit: '901983227' })
    expect(d.firmaUrl).toBeNull()
  })

  /// Regresión (arreglado el 11-oct-2026): los conceptos adicionales guardan
  /// el rótulo en `observaciones` («AJUSTE A NETO PACTADO», «BONO ADICIONAL -
  /// NO SALARIAL»); `nombre` no existe en los datos. `datosDesprendible` leía
  /// `c.nombre` e imprimía «CONCEPTO ADICIONAL» en todos.
  it('un concepto adicional con la forma real de los datos conserva su rótulo', async () => {
    const liq: any = await LiquidacionesService.crear(
      payloadBase({ conceptos_adicionales: [{ valor: 180_000, observaciones: 'AJUSTE A NETO PACTADO' }] }),
      usuarioId,
    )
    const d = await LiquidacionesService.datosDesprendible(liq.id)
    expect(d.devengos.map((l) => l.concepto)).toContain('AJUSTE A NETO PACTADO')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('Revertir el override de un recargo', () => {
  it('el override revertido deja de leerse', async () => {
    const liq: any = await LiquidacionesService.crear(
      payloadBase({
        detalles_vehiculos: [
          {
            vehiculo: { value: vehiculoA },
            recargos: [{ empresa_id: empresaParex, valor: 250_000, mes: '2026-03', origen_planilla_id: planillaOrigen1 }],
          },
        ],
      }),
      usuarioId,
    )
    const manualId = liq.recargos[0].id
    const resultado: any = await LiquidacionesService.revertirOverrideRecargo(liq.id, manualId)
    expect(resultado.recargos.map((r: any) => r.id)).not.toContain(manualId)
  })

  /// BUG: el override y el automático que sustituye comparten
  /// `origen_planilla_id`, y el único (liquidacion_id, origen_planilla_id)
  /// —parcial en la base de tm, completo además en la de cq y en la de
  /// pruebas— cuenta también al manual. El formulario manda los dos a la vez
  /// (descuenta él el automático del total), pero en `actualizar` el `upsert`
  /// del preview choca con el manual recién creado y lo PISA: el valor que
  /// tecleó la persona desaparece y queda un automático marcado como override.
  /// Por eso `revertirOverrideRecargo` nunca encuentra un automático vivo que
  /// reactivar.
  it.fails('un override convive con el automático que sustituye', async () => {
    const liq: any = await LiquidacionesService.crear(payloadBase(), usuarioId)
    const editada: any = await LiquidacionesService.actualizar(
      liq.id,
      {
        detalles_vehiculos: [
          {
            vehiculo: { value: vehiculoA },
            recargos: [{ empresa_id: empresaParex, valor: 250_000, mes: '2026-03', origen_planilla_id: planillaOrigen1 }],
          },
        ],
        recargos_preview: [
          {
            key: 'k1', vehiculo_id: vehiculoA, empresa_id: empresaParex, mes: '2026-03', emisor: 'TM',
            valor: 300_000, origen_planilla_id: planillaOrigen1,
          },
        ],
      },
      usuarioId,
    )
    const manual = editada.recargos.filter((r: any) => !r.es_automatico)
    const automatico = editada.recargos.filter((r: any) => r.es_automatico)
    expect(manual.map((r: any) => [r.es_override, Number(r.valor)])).toEqual([[true, 250_000]])
    expect(automatico.map((r: any) => Number(r.valor))).toEqual([300_000])
  })

  it('rechaza un recargo que no es override o que es de otra liquidación, sin tocar nada', async () => {
    const liq: any = await LiquidacionesService.crear(
      payloadBase({
        detalles_vehiculos: [
          { vehiculo: { value: vehiculoA }, recargos: [{ empresa_id: empresaOtros, valor: 40_000, mes: '2026-03' }] },
        ],
      }),
      usuarioId,
    )
    const otra: any = await LiquidacionesService.crear(payloadBase(), usuarioId)
    const recargoId = liq.recargos[0].id

    await expect(LiquidacionesService.revertirOverrideRecargo(liq.id, recargoId)).rejects.toThrow('no es un override')
    /// Desde la liquidación equivocada no se puede borrar el recargo de otra.
    await expect(LiquidacionesService.revertirOverrideRecargo(otra.id, recargoId)).rejects.toThrow('no pertenece')
    await expect(LiquidacionesService.revertirOverrideRecargo(liq.id, randomUUID())).rejects.toThrow('no encontrado')
    expect(await prisma.recargos.count({ where: { id: recargoId, deleted_at: null } })).toBe(1)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('Preview de recargos: cada día se valora con la tarifa vigente ESE día', () => {
  /// Julio de 2031: un mes que no usa ninguna otra suite, para que la config
  /// BASE que se siembra (empresa_id NULL) no le cambie la tarifa a nadie.
  let planillaA: string
  let planillaB: string
  let preview: any

  beforeAll(async () => {
    const vig = (s: string) => new Date(`${s}T00:00:00Z`)
    const fin = (s: string) => new Date(`${s}T23:59:59Z`)
    const config = async (o: { empresa: string | null; salario: number; horas: number; desde: Date; hasta: Date }) =>
      prisma.configuraciones_salarios.create({
        data: {
          id: randomUUID(), empresa_id: o.empresa, salario_basico: o.salario, horas_mensuales_base: o.horas,
          /// Valor hora guardado a propósito absurdo: el preview debe calcularlo
          /// de salario ÷ horas con toda la precisión, como el Excel, y no usar
          /// este valor ya redondeado.
          valor_hora_trabajador: 1,
          vigencia_desde: o.desde, vigencia_hasta: o.hasta, activo: true,
          observaciones: `${MARCA} preview`, created_at: ahora(), updated_at: ahora(),
        } as any,
      })
    /// La tarifa de la empresa cambia el 15 (sube el salario y bajan las horas
    /// base 220→210, como el corte real de jul-2026). La base solo la usa la
    /// empresa que no tiene tarifa propia.
    await config({ empresa: empresaOtros, salario: 1_400_000, horas: 220, desde: vig('2031-07-01'), hasta: fin('2031-07-14') })
    await config({ empresa: empresaOtros, salario: 1_500_000, horas: 210, desde: vig('2031-07-15'), hasta: fin('2031-12-31') })
    await config({ empresa: null, salario: 1_000_000, horas: 200, desde: vig('2031-07-01'), hasta: fin('2031-07-31') })

    const tipo = async (o: {
      codigo: string; pct: number; extra?: boolean; adicional?: boolean; desde: Date; hasta?: Date | null
    }) => {
      const id = randomUUID()
      await prisma.tipos_recargos.create({
        data: {
          id, codigo: o.codigo, nombre: `${MARCA} ${o.codigo} ${o.pct}`, categoria: 'RECARGOS', porcentaje: o.pct,
          es_hora_extra: !!o.extra, adicional: !!o.adicional, activo: true,
          vigencia_desde: o.desde, vigencia_hasta: o.hasta ?? null, created_at: ahora(), updated_at: ahora(),
        } as any,
      })
      return id
    }
    const he = await tipo({ codigo: TIPO.HE, pct: 25, extra: true, desde: vig('2031-01-01') })
    const rn = await tipo({ codigo: TIPO.RN, pct: 35, desde: vig('2031-01-01') })
    /// Dos vigencias del mismo código: 75 % hasta el 14 y 80 % desde el 15.
    const fx75 = await tipo({ codigo: TIPO.FX, pct: 75, adicional: true, desde: vig('2031-01-01'), hasta: fin('2031-07-14') })
    await tipo({ codigo: TIPO.FX, pct: 80, adicional: true, desde: vig('2031-07-15') })

    const dia = async (
      planilla: string,
      n: number,
      horas: number,
      detalles: Array<{ tipo: string; horas: number; activo?: boolean }>,
      extra: Record<string, unknown> = {},
    ) => {
      const id = randomUUID()
      await prisma.dias_laborales_planillas.create({
        data: {
          id, recargo_planilla_id: planilla, dia: n, hora_inicio: 6, hora_fin: 6 + horas, total_horas: horas,
          created_at: ahora(), updated_at: ahora(), ...extra,
        } as any,
      })
      for (const d of detalles) {
        await prisma.detalles_recargos_dias.create({
          data: {
            id: randomUUID(), dia_laboral_id: id, tipo_recargo_id: d.tipo, horas: d.horas,
            activo: d.activo ?? true, created_at: ahora(), updated_at: ahora(),
          } as any,
        })
      }
    }

    planillaA = await crearPlanilla({ empresaId: empresaOtros, vehiculoId: vehiculoA, mes: 7, anio: 2031 })
    /// Día 3: HE y RN puros, más un detalle INACTIVO que no puede sumar.
    await dia(planillaA, 3, 10, [{ tipo: he, horas: 2 }, { tipo: rn, horas: 3 }, { tipo: rn, horas: 9, activo: false }])
    await dia(planillaA, 10, 10, [{ tipo: fx75, horas: 2 }])
    /// Día 20: el detalle quedó apuntando al tipo del 75 % (es el snapshot de
    /// cuando se creó), pero ese día ya rige el 80 %.
    await dia(planillaA, 20, 8, [{ tipo: fx75, horas: 4 }, { tipo: he, horas: 1 }], { es_festivo: true })
    /// Disponibilidad: no es día trabajado ni genera recargos aunque tenga detalle.
    await dia(planillaA, 25, 12, [{ tipo: he, horas: 5 }], { disponibilidad: true })
    /// Fuera del periodo consultado (1–28).
    await dia(planillaA, 29, 10, [{ tipo: he, horas: 3 }])
    /// Día retirado.
    await dia(planillaA, 5, 10, [{ tipo: he, horas: 9 }], { deleted_at: ahora() })

    planillaB = await crearPlanilla({ empresaId: empresaParex, vehiculoId: vehiculoB, mes: 7, anio: 2031 })
    await dia(planillaB, 10, 9, [{ tipo: rn, horas: 2 }])

    /// Una planilla retirada entera no aporta nada.
    const retirada = await crearPlanilla({ empresaId: empresaOtros, vehiculoId: vehiculoA, mes: 7, anio: 2031, eliminada: true })
    await dia(retirada, 12, 10, [{ tipo: he, horas: 8 }])

    preview = await LiquidacionesService.previewRecargos(conductorId, '2031-07-01', '2031-07-28')
  })

  it('solo entran las planillas vivas del periodo', () => {
    expect(preview.planillas.map((p: any) => p.planilla_id).sort()).toEqual([planillaA, planillaB].sort())
  })

  it('cada día usa la tarifa de su fecha, con el valor hora a plena precisión', () => {
    const a = preview.planillas.find((p: any) => p.planilla_id === planillaA)
    const porDia = Object.fromEntries(a.dias.map((d: any) => [d.dia, d]))
    /// El 29 está fuera del periodo y el 5 está retirado.
    expect(Object.keys(porDia).map(Number)).toEqual([3, 10, 20, 25])

    /// Antes del 15: 1.400.000 / 220 = 6.363,6363… la hora.
    ///   HE 25 % es tarifa completa: 2 h × 6.363,63 × 1,25 = 15.909,09 → 15.909
    ///   RN 35 % es recargo puro:    3 h × 6.363,63 × 0,35 =  6.681,82 →  6.682
    expect(porDia[3].recargos.map((r: any) => [r.tipo_codigo, r.porcentaje, r.valor_total])).toEqual([
      [TIPO.HE, 25, 15_909],
      [TIPO.RN, 35, 6_682],
    ])
    expect(porDia[3].total_valor_dia).toBe(15_909 + 6_682)
    ///   FX adicional al 75 %, tarifa completa: 2 h × 6.363,63 × 1,75 = 22.272,73 → 22.273
    expect(porDia[10].recargos.map((r: any) => [r.porcentaje, r.valor_total])).toEqual([[75, 22_273]])

    /// Desde el 15: 1.500.000 / 210 = 7.142,857… la hora y FX ya al 80 %.
    ///   FX: 4 h × 7.142,857 × 1,80 = 51.428,57 → 51.429
    ///   HE: 1 h × 7.142,857 × 1,25 =  8.928,57 →  8.929
    expect(porDia[20].recargos.map((r: any) => [r.tipo_codigo, r.porcentaje, r.valor_total])).toEqual([
      [TIPO.FX, 80, 51_429],
      [TIPO.HE, 25, 8_929],
    ])
    expect(porDia[20].tipo_dia).toBe('Festivo')

    expect(porDia[25].disponibilidad).toBe(true)
    expect(porDia[25].recargos).toEqual([])
    expect(porDia[25].total_valor_dia).toBe(0)

    expect(a.total_valor).toBe(15_909 + 6_682 + 22_273 + 51_429 + 8_929)
    expect(a.total_dias).toBe(3)
    expect(a.total_horas).toBe(28)
    /// La config que se muestra para la planilla es la de su primer día
    /// visible, y su valor hora sale de salario ÷ horas (no del guardado).
    expect(a.configuracion_salarial).toMatchObject({ salario_basico: 1_400_000, horas_mensuales_base: 220, valor_hora_trabajador: 6_364 })
  })

  it('la empresa sin tarifa propia se valora con la base', () => {
    /// 1.000.000 / 200 = 5.000 la hora; RN 35 % puro: 2 h × 1.750 = 3.500.
    const b = preview.planillas.find((p: any) => p.planilla_id === planillaB)
    expect(b.total_valor).toBe(3_500)
    expect(b.dias[0].recargos[0]).toMatchObject({ valor_hora_base: 5_000, valor_total: 3_500 })
  })

  it('el resumen suma las dos planillas y separa un mismo código por porcentaje', () => {
    expect(preview.resumen).toMatchObject({
      total_planillas: 2,
      total_dias_trabajados: 4,
      total_horas_trabajadas: 37,
      total_recargos: 105_222 + 3_500,
      total_general: 105_222 + 3_500,
    })
    /// Una planilla que cruza el cambio de tarifa saca el FX en DOS filas (75 %
    /// y 80 %): mezclarlas mostraba un solo % engañoso con el total de ambos.
    expect(
      preview.resumen_tipos.map((t: any) => [t.codigo, t.porcentaje, t.totalHoras, t.valorTotal]),
    ).toEqual([
      [TIPO.HE, 25, 3, 15_909 + 8_929],
      [TIPO.RN, 35, 5, 6_682 + 3_500],
      [TIPO.FX, 75, 2, 22_273],
      [TIPO.FX, 80, 4, 51_429],
    ])
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('Controlador: validación de entrada y códigos HTTP', () => {
  it('crear exige conductor y periodo (400) y no escribe nada', async () => {
    const antes = await prisma.liquidaciones.count({ where: { conductor_id: conductorId } })
    const r1 = respuesta()
    await LiquidacionesController.crear(peticion({ body: { periodo_inicio: '2026-03-01', periodo_fin: '2026-03-31' } }), r1)
    expect(r1.statusCode).toBe(400)
    expect(r1.cuerpo.message).toBe('El conductor es requerido')

    const r2 = respuesta()
    await LiquidacionesController.crear(peticion({ body: { conductor_id: conductorId, periodo_inicio: '2026-03-01' } }), r2)
    expect(r2.statusCode).toBe(400)
    expect(r2.cuerpo.message).toBe('Las fechas del período son requeridas')

    expect(await prisma.liquidaciones.count({ where: { conductor_id: conductorId } })).toBe(antes)
  })

  it('crear responde 201 con la liquidación y el autor sale del token, no del cuerpo', async () => {
    const r = respuesta()
    await LiquidacionesController.crear(peticion({ body: payloadBase({ creado_por_id: randomUUID() }) }), r)
    expect(r.statusCode).toBe(201)
    expect(r.cuerpo.success).toBe(true)
    expect(r.cuerpo.data.creado_por.id).toBe(usuarioId)
  })

  it('leer, editar y eliminar algo que no existe (o que se retiró) es 404', async () => {
    const liq: any = await LiquidacionesService.crear(payloadBase(), usuarioId)
    const r1 = respuesta()
    await LiquidacionesController.eliminar(peticion({ params: { id: liq.id } }), r1)
    expect(r1.statusCode).toBe(200)

    const r2 = respuesta()
    await LiquidacionesController.obtenerPorId(peticion({ params: { id: liq.id } }), r2)
    expect(r2.statusCode).toBe(404)
    const r3 = respuesta()
    await LiquidacionesController.actualizar(peticion({ params: { id: liq.id }, body: { observaciones: 'x' } }), r3)
    expect(r3.statusCode).toBe(404)
    const r4 = respuesta()
    await LiquidacionesController.eliminar(peticion({ params: { id: liq.id } }), r4)
    expect(r4.statusCode).toBe(404)
  })

  it('la lista convierte la paginación de la query y devuelve stats', async () => {
    const r = respuesta()
    await LiquidacionesController.obtenerTodas(
      peticion({ query: { conductor_id: conductorListaId, page: '1', limit: '1', sortBy: 'monto', sortOrder: 'asc' } }),
      r,
    )
    expect(r.statusCode).toBe(200)
    expect(r.cuerpo.data).toHaveLength(1)
    expect(r.cuerpo.pagination).toMatchObject({ page: 1, limit: 1, total: 2, totalPages: 2, hasNext: true, hasPrev: false })
    /// Orden por monto ascendente: primero la de 1.000.000.
    expect(r.cuerpo.data[0].sueldo_total).toBe(1_000_000)
  })

  it('revertir override: 400 si no es override, 404 si el recargo no existe', async () => {
    const liq: any = await LiquidacionesService.crear(
      payloadBase({
        detalles_vehiculos: [
          { vehiculo: { value: vehiculoA }, recargos: [{ empresa_id: empresaOtros, valor: 40_000, mes: '2026-03' }] },
        ],
      }),
      usuarioId,
    )
    const r1 = respuesta()
    await LiquidacionesController.revertirOverrideRecargo(
      peticion({ params: { id: liq.id, recargoId: liq.recargos[0].id } }), r1,
    )
    expect(r1.statusCode).toBe(400)
    const r2 = respuesta()
    await LiquidacionesController.revertirOverrideRecargo(peticion({ params: { id: liq.id, recargoId: randomUUID() } }), r2)
    expect(r2.statusCode).toBe(404)
  })

  it('el preview de recargos exige conductor y periodo', async () => {
    const r = respuesta()
    await LiquidacionesController.previewRecargos(peticion({ query: { conductor_id: conductorId } }), r)
    expect(r.statusCode).toBe(400)
  })

  it('el ZIP exige una lista de IDs', async () => {
    const r = respuesta()
    await LiquidacionesController.generatePayslipsZip(peticion({ method: 'POST', body: { liquidationIds: [] } }), r)
    expect(r.statusCode).toBe(400)
  })

  /// Regresión (arreglado el 11-oct-2026): el `catch` de `generatePayslipsZip`
  /// usaba `socketId`, declarado con `const` DENTRO del `try`. Cualquier fallo
  /// del ZIP (p. ej. todas las liquidaciones retiradas) terminaba en
  /// `ReferenceError` en vez de en el 500 con mensaje, y el `progress:error`
  /// final nunca se emitía. El `// @ts-nocheck` del archivo lo escondía.
  it('si el ZIP falla responde 500 con el motivo', async () => {
    const r = respuesta()
    await LiquidacionesController.generatePayslipsZip(
      peticion({ method: 'POST', body: { liquidationIds: [randomUUID()], socketId: 'sock-2' } }),
      r,
    )
    expect(r.statusCode).toBe(500)
    expect(r.cuerpo.error).toContain('No se pudo generar ningún desprendible')
  })
})
