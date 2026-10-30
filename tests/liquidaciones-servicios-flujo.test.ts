/**
 * Flujo de una liquidación de servicios entrando por su servicio y su
 * controlador: crear, calcular, cambiar de estado, editar, autoguardar,
 * eliminar y restaurar.
 *
 * `soft-delete-liquidaciones.test.ts` prueba las piezas de `lib/soft-delete`
 * por separado, con filas insertadas a mano. Aquí se entra por la misma puerta
 * que la pantalla —`crear`, `actualizar`, `autoguardar`, `cambiarEstado`—,
 * porque es al juntar las piezas donde se rompen cosas que sueltas funcionan:
 * la reconciliación por `id` está probada, pero si quien la llama tira el `id`
 * por el camino, nadie se entera.
 *
 * LOS `it.fails`
 *
 * Reproducen bugs de `src/` encontrados al escribir esta suite (10-oct-2026) y
 * que no se arreglan aquí. Cada uno afirma el comportamiento CORRECTO, así que
 * hoy falla y Vitest lo cuenta como verde. El día que alguien lo arregle, el
 * caso se pondrá rojo: es la señal para quitar el `.fails` y dejarlo como
 * regresión normal.
 *
 * Sockets, avisos y push se sustituyen: el test no necesita Redis ni un
 * navegador, y los avisos de verdad irían a los aprobadores que haya sembrado
 * cualquier otra suite.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { FastifyReply, FastifyRequest } from 'fastify'

vi.mock('pdfmake/build/pdfmake', () => ({ default: {}, createPdf: () => ({}) }))
vi.mock('pdfmake/build/vfs_fonts', () => ({ default: { vfs: {} }, vfs: {} }))
vi.mock('../src/sockets', () => ({
  emitLiquidacionServicio: vi.fn(),
  emitLiquidacionServicioBorrador: vi.fn(),
  emitFacturacionLiquidacion: vi.fn(),
  emitNotificacion: vi.fn(),
  eventoMeta: (meta: Record<string, unknown>) => ({ ...meta, ts: new Date().toISOString() }),
}))
vi.mock('../src/modules/notificaciones/notificaciones.service', () => ({
  NotificacionesService: {
    obtenerUsuariosAprobadores: vi.fn(async () => []),
    crearMasivas: vi.fn(async () => undefined),
    crear: vi.fn(async (d: unknown) => d),
  },
}))
vi.mock('../src/modules/usuario-push/usuario-push.service', () => ({
  enviarPushUsuarios: vi.fn(async () => undefined),
}))

import { emitLiquidacionServicio } from '../src/sockets'
import {
  LiquidacionesServiciosService,
  type CrearLiquidacionInput,
  type FiltrosLiquidacionServicios,
} from '../src/modules/liquidaciones-servicios/liquidaciones-servicios.service'
import { LiquidacionesServiciosController } from '../src/modules/liquidaciones-servicios/liquidaciones-servicios.controller'
import { FacturacionLiquidacionesService } from '../src/modules/facturacion-liquidaciones/facturacion-liquidaciones.service'
import { totalesDeItemsActivos } from '../src/lib/soft-delete/reconciliar-items'
import {
  itemDePrueba,
  limpiarRastros,
  placaUnica,
  prismaFlujo as prisma,
  sembrarEscenario,
  type EscenarioFlujo,
} from './helpers/liquidaciones-flujo'

/** Prefijo de todo lo que siembra esta suite. */
const MARCA = 'ZZTEST-LIQFLUJO'

let esc: EscenarioFlujo

/**
 * Campos que `crear` y `actualizar` leen aunque `CrearLiquidacionInput` no los
 * declare: el servicio lleva `@ts-nocheck` y el tipo se quedó atrás.
 */
type Payload = CrearLiquidacionInput & {
  valor_pernoctes?: number
  valor_unitario_pernoctes?: number
  cantidad_pernoctes?: number
}

let secuencia = 0
/** Consecutivo único por llamada: la columna es UNIQUE global. */
function consecutivoUnico(): string {
  secuencia += 1
  return `${MARCA}-${Date.now().toString(36)}-${secuencia}`
}

function payloadBase(extra: Partial<Payload> = {}): Payload {
  return {
    cliente_id: esc.clienteId,
    consecutivo: consecutivoUnico(),
    mes: 1,
    anio: 2026,
    items: [itemDePrueba(placaUnica())],
    porcentaje_iva: 0,
    ...extra,
  }
}

function crearLiq(extra: Partial<Payload> = {}, puedeEditarSeccion06 = false) {
  return LiquidacionesServiciosService.crear(payloadBase(extra), esc.creadorId, puedeEditarSeccion06)
}

/** `listar` acotado al cliente de esta suite y sin paginar. */
function listarDelCliente(extra: Partial<FiltrosLiquidacionServicios> = {}) {
  return LiquidacionesServiciosService.listar({
    cliente_id: esc.clienteId,
    limit: 0,
    ...extra,
  })
}

/**
 * Deja la liquidación FACTURADA dentro de una factura activa escribiendo las
 * filas a mano. Aquí la factura es solo el escenario: no se arma con
 * `FacturacionLiquidacionesService.crear` para que un cambio en facturación,
 * que tiene su propia suite, no tumbe los casos de liquidaciones.
 */
async function facturar(liqId: string, total: number) {
  return prisma.$transaction(async (tx) => {
    await tx.liquidacion_servicio.update({
      where: { id: liqId },
      data: { estado: 'FACTURADA', fecha_facturacion: new Date() },
    })
    return tx.factura_liquidacion_servicio.create({
      data: {
        numero_factura: consecutivoUnico(),
        facturado_por_id: esc.adminId,
        valor_total: total,
        items: { create: [{ liquidacion_id: liqId, valor_liquidacion: total }] },
      },
      select: { id: true },
    })
  })
}

/** El `motivo` de un conflicto del autoguardado, o `undefined` si no hubo. */
async function motivoDeConflicto(promesa: Promise<unknown>): Promise<string | undefined> {
  try {
    await promesa
    return undefined
  } catch (e) {
    return (e as { conflicto?: { motivo?: string } }).conflicto?.motivo
  }
}

async function filaAuditoria(id: string, accion: 'ELIMINAR' | 'RESTAURAR') {
  const filas = await prisma.$queryRaw<{ usuario_id: string | null; motivo: string | null }[]>`
    SELECT usuario_id, motivo FROM auditoria.borrado_logico
    WHERE registro_id = ${id} AND accion = ${accion}
    ORDER BY ocurrido_en DESC LIMIT 1`
  return filas[0]
}

// ── Petición y respuesta falsas para el controlador ─────────────────────────

interface RespuestaFalsa {
  statusCode: number
  cuerpo: any
  status(codigo: number): RespuestaFalsa
  send(cuerpo: unknown): RespuestaFalsa
}

function respuesta(): RespuestaFalsa {
  const r: RespuestaFalsa = {
    statusCode: 200,
    cuerpo: undefined,
    status(codigo) {
      r.statusCode = codigo
      return r
    },
    send(cuerpo) {
      r.cuerpo = cuerpo
      return r
    },
  }
  return r
}

/** Petición de un usuario de Administración: los casos de aquí no son de permisos. */
function peticionAdmin(partes: { params?: object; body?: unknown; query?: object }) {
  return {
    params: {},
    query: {},
    body: undefined,
    user: { id: esc.adminId, nombre: `${MARCA} admin`, area: ['administracion'], role: 'admin' },
    ...partes,
  } as unknown as FastifyRequest
}

const comoReply = (r: RespuestaFalsa) => r as unknown as FastifyReply

beforeAll(async () => {
  esc = await sembrarEscenario(MARCA)
}, 30_000)

afterAll(async () => {
  await limpiarRastros(MARCA)
  await prisma.$disconnect()
})

// ════════════════════════════════════════════════════════════════════════════
describe('Crear · cálculo de totales', () => {
  it('servicios con descuento + transporte adicional + recargos + pernoctes, e IVA sobre todo', async () => {
    /// La fórmula vive en un solo sitio (`construirItemsYTotales`) desde que
    /// estaba copiada en `crear` y `actualizar`: con dos copias, cambiar el
    /// IVA en una hacía que la liquidación valiera distinto según por dónde se
    /// guardara, y la diferencia aparecía en la factura. Este caso fija la
    /// fórmula completa con números que no se compensan entre sí.
    const placaA = placaUnica()
    const placaB = placaUnica()
    const liq = await crearLiq({
      items: [
        itemDePrueba(placaA, { cantidad: 2, valor_unitario: 150000, porcentaje_descuento: 10 }),
        itemDePrueba(placaB, { cantidad: 1.5, valor_unitario: 80000 }),
      ],
      valor_transporte_adicional: 25000,
      valor_recargos: 12345.67,
      valor_pernoctes: 60000,
      valor_unitario_pernoctes: 30000,
      cantidad_pernoctes: 2,
      porcentaje_iva: 19,
    })

    // Ítem A: 2 × 150.000 = 300.000, menos el 10 % → 270.000. Ítem B: 120.000.
    expect(liq.items.map((i) => [i.placa, Number(i.subtotal), Number(i.valor_final), i.orden])).toEqual([
      [placaA, 300000, 270000, 0],
      [placaB, 120000, 120000, 1],
    ])
    expect(Number(liq.valor_servicios)).toBe(390000)
    expect(Number(liq.valor_transporte_adicional)).toBe(25000)
    expect(Number(liq.valor_recargos)).toBe(12345.67)
    expect(Number(liq.valor_pernoctes)).toBe(60000)
    expect(liq.cantidad_pernoctes).toBe(2)
    // 390.000 + 25.000 + 12.345,67 + 60.000
    expect(Number(liq.subtotal)).toBe(487345.67)
    // 19 % de 487.345,67 = 92.595,6773 → la columna (12,2) lo redondea.
    expect(Number(liq.valor_iva)).toBe(92595.68)
    expect(Number(liq.total)).toBe(579941.35)
    /// Y el total cuadra con sus partes ya redondeadas: si alguna vez se
    /// redondearan por separado con otra regla, la factura descuadraría por
    /// un centavo y nadie sabría de dónde sale.
    expect(Number(liq.total)).toBeCloseTo(Number(liq.subtotal) + Number(liq.valor_iva), 2)

    /// La cabecera cuadra con la suma de los ítems VIVOS, que es lo que suma la
    /// factura y lo que ve el usuario en la tabla.
    const activos = await prisma.$transaction((tx) => totalesDeItemsActivos(tx, liq.id))
    expect(activos).toEqual({ subtotal: 390000, cantidad: 2 })
  })

  it('sin IVA el total es el subtotal', async () => {
    const liq = await crearLiq({
      items: [itemDePrueba(placaUnica(), { valor_unitario: 123456.78 })],
      porcentaje_iva: undefined,
    })
    expect(Number(liq.porcentaje_iva)).toBe(0)
    expect(Number(liq.valor_iva)).toBe(0)
    expect(Number(liq.total)).toBe(123456.78)
  })

  it('nace BORRADOR y CONFIRMADA, con su foto inicial en el historial', async () => {
    /// `confirmada_at` vacío es la marca del autoguardado. `crear` es el botón
    /// «Registrar», y cuando nacía sin ella el listado pintaba «Sin guardar»
    /// justo después de que el usuario pulsara Registrar.
    const liq = await crearLiq({ items: [itemDePrueba(placaUnica()), itemDePrueba(placaUnica())] })
    expect(liq.estado).toBe('BORRADOR')
    expect(liq.confirmada_at).toBeInstanceOf(Date)
    expect(liq.creado_por_id).toBe(esc.creadorId)

    const historial = await LiquidacionesServiciosService.obtenerHistorial(liq.id)
    expect(historial).toHaveLength(1)
    expect(historial[0]).toMatchObject({
      accion: 'creacion',
      estado_anterior: null,
      estado_nuevo: 'BORRADOR',
      usuario_id: esc.creadorId,
    })
    expect(historial[0].snapshot).toMatchObject({ total_items: 2, total: 200000 })
  })

  it('marca `tercero_liquidado` solo si alguna fila de terceros tiene valor', async () => {
    /// Es lo que alimenta el filtro «con terceros» del listado. Una fila de
    /// terceros vacía la añade el editor por defecto y no es una liquidación
    /// de terceros.
    const con = await crearLiq({ recargos_data: { terceroRows: [{ vr_unit: '1000', cant: '2' }] } }, true)
    const vacia = await crearLiq({ recargos_data: { terceroRows: [{ vr_unit: '', cant: '1' }] } }, true)
    expect(con.tercero_liquidado).toBe(true)
    expect(vacia.tercero_liquidado).toBe(false)
  })

  it('los terceros del servicio se enganchan al ítem por su posición de origen', async () => {
    const placas = [placaUnica(), placaUnica()]
    const liq = await crearLiq({
      items: placas.map((p) => itemDePrueba(p)),
      terceros_items: [
        {
          placa: placas[1],
          recorrido: 'R',
          fechas: '05/01/2026',
          valor_unitario: 50000,
          cantidad: 2,
          porcentaje_admin: 10,
          src_index: 1,
        },
      ],
    }, true)

    const leida = await LiquidacionesServiciosService.obtenerPorId(liq.id)
    expect(leida.terceros_items).toHaveLength(1)
    expect(leida.terceros_items[0].item_id).toBe(liq.items[1].id)
    // 2 × 50.000 = 100.000; el 10 % es administración y se liquida el resto.
    expect(leida.terceros_items[0]).toMatchObject({
      total_facturado: 100000,
      valor_admin: 10000,
      valor_liquidar: 90000,
    })
  })
})

// ════════════════════════════════════════════════════════════════════════════
describe('Crear · consecutivo', () => {
  /// Años reservados a esta suite: el consecutivo automático es por año y mira
  /// TODAS las liquidaciones de ese año, de cualquier cliente.
  const ANIO_SECUENCIA = 2097
  const ANIO_BORRADA = 2098

  it('sin consecutivo se genera LS-<año>-NNNN siguiendo al mayor del año', async () => {
    const a = await crearLiq({ consecutivo: undefined, anio: ANIO_SECUENCIA })
    const b = await crearLiq({ consecutivo: undefined, anio: ANIO_SECUENCIA })
    expect(a.consecutivo).toBe(`LS-${ANIO_SECUENCIA}-0001`)
    expect(b.consecutivo).toBe(`LS-${ANIO_SECUENCIA}-0002`)

    /// Uno puesto a mano más arriba manda: el siguiente automático continúa
    /// desde él y no rellena el hueco, para no reutilizar números que el
    /// cliente pudo ver en otro documento.
    await crearLiq({ consecutivo: `LS-${ANIO_SECUENCIA}-0010`, anio: ANIO_SECUENCIA })
    const c = await crearLiq({ consecutivo: undefined, anio: ANIO_SECUENCIA })
    expect(c.consecutivo).toBe(`LS-${ANIO_SECUENCIA}-0011`)
  })

  it('checkConsecutivo: ocupado, libre, y libre para la propia liquidación', async () => {
    const liq = await crearLiq()
    expect(await LiquidacionesServiciosService.checkConsecutivo(liq.consecutivo)).toEqual({
      available: false,
    })
    /// Al editar, el formulario pregunta por el consecutivo que ya tiene: no
    /// puede decirle que está ocupado por ella misma.
    expect(await LiquidacionesServiciosService.checkConsecutivo(liq.consecutivo, liq.id)).toEqual({
      available: true,
    })
    expect(await LiquidacionesServiciosService.checkConsecutivo(consecutivoUnico())).toEqual({
      available: true,
    })
  })

  it('el controlador traduce un consecutivo repetido en un 409 legible', async () => {
    /// Antes salía un 500 con el volcado entero de Prisma (2.632 caracteres
    /// con el `create()` dentro) directo al toast del usuario.
    const liq = await crearLiq()
    const r = respuesta()
    await LiquidacionesServiciosController.crear(
      peticionAdmin({ body: payloadBase({ consecutivo: liq.consecutivo }) }),
      comoReply(r),
    )
    expect(r.statusCode).toBe(409)
    expect(r.cuerpo.error).toMatch(/consecutivo ya está en uso/)
    expect(r.cuerpo.error.length).toBeLessThan(200)
  })

  describe('BUG · el consecutivo de una eliminada sigue ocupando el UNIQUE', () => {
    /// `consecutivo` es UNIQUE global (también en producción), pero
    /// `generarConsecutivo` y `checkConsecutivo` filtran `deleted_at: null`:
    /// ignoran justo la fila que bloquea el índice.
    let eliminada: { id: string; consecutivo: string }

    beforeAll(async () => {
      await crearLiq({ consecutivo: undefined, anio: ANIO_BORRADA })
      const segunda = await crearLiq({ consecutivo: undefined, anio: ANIO_BORRADA })
      expect(segunda.consecutivo).toBe(`LS-${ANIO_BORRADA}-0002`)
      await LiquidacionesServiciosService.eliminar(segunda.id, esc.adminId, 'prueba consecutivo')
      eliminada = segunda
    })

    it.fails('tras eliminar la última del año, el siguiente automático no choca', async () => {
      // Hoy genera otra vez LS-2098-0002 y `create` revienta con P2002: el
      // usuario recibe «Ese consecutivo ya está en uso» sin haber tecleado uno.
      const nueva = await crearLiq({ consecutivo: undefined, anio: ANIO_BORRADA })
      expect(nueva.consecutivo).not.toBe(eliminada.consecutivo)
    })

    it.fails('checkConsecutivo no ofrece como libre el de una eliminada', async () => {
      // Hoy responde `available: true` y el guardado posterior falla con 409.
      expect(await LiquidacionesServiciosService.checkConsecutivo(eliminada.consecutivo)).toEqual({
        available: false,
      })
    })
  })
})

// ════════════════════════════════════════════════════════════════════════════
describe('Transiciones de estado', () => {
  it('BORRADOR → LIQUIDADA → APROBADA firma a cada responsable y deja rastro', async () => {
    const liq = await crearLiq()

    const liquidada = await LiquidacionesServiciosService.cambiarEstado(liq.id, 'LIQUIDADA', esc.creadorId)
    expect(liquidada.estado).toBe('LIQUIDADA')
    expect(liquidada.liquidado_por_id).toBe(esc.creadorId)

    const aprobada = await LiquidacionesServiciosService.cambiarEstado(liq.id, 'APROBADA', esc.adminId)
    expect(aprobada.estado).toBe('APROBADA')
    expect(aprobada.aprobado_por_id).toBe(esc.adminId)
    expect(aprobada.fecha_aprobacion).toBeInstanceOf(Date)
    /// Aprobar no reescribe quién la liquidó: son dos firmas distintas.
    expect(aprobada.liquidado_por_id).toBe(esc.creadorId)

    const historial = await LiquidacionesServiciosService.obtenerHistorial(liq.id)
    // Viene del más reciente al más antiguo.
    expect(historial.map((h) => [h.accion, h.estado_anterior, h.estado_nuevo])).toEqual([
      ['cambio_estado', 'LIQUIDADA', 'APROBADA'],
      ['cambio_estado', 'BORRADOR', 'LIQUIDADA'],
      ['creacion', null, 'BORRADOR'],
    ])
    /// La foto de cada cambio es la liquidación DESPUÉS del cambio: es lo que
    /// permite reconstruir qué se aprobó exactamente.
    expect(historial[0].snapshot).toMatchObject({ estado: 'APROBADA', total: 100000 })
  })

  it('revertir a BORRADOR borra las firmas de liquidación y aprobación', async () => {
    /// Un borrador con `aprobado_por` puesto aparecería como «aprobado por X»
    /// mientras se sigue editando, y al volver a aprobarlo nadie sabría si la
    /// firma es de esta vuelta o de la anterior.
    const liq = await crearLiq()
    await LiquidacionesServiciosService.cambiarEstado(liq.id, 'LIQUIDADA', esc.creadorId)
    await LiquidacionesServiciosService.cambiarEstado(liq.id, 'APROBADA', esc.adminId)

    const borrador = await LiquidacionesServiciosService.cambiarEstado(liq.id, 'BORRADOR', esc.adminId)
    expect(borrador.estado).toBe('BORRADOR')
    expect(borrador.liquidado_por_id).toBeNull()
    expect(borrador.aprobado_por_id).toBeNull()
    expect(borrador.fecha_aprobacion).toBeNull()
  })

  it('revertir de APROBADA a LIQUIDADA queda en el historial', async () => {
    const liq = await crearLiq()
    await LiquidacionesServiciosService.cambiarEstado(liq.id, 'LIQUIDADA', esc.creadorId)
    await LiquidacionesServiciosService.cambiarEstado(liq.id, 'APROBADA', esc.adminId)

    const r = await LiquidacionesServiciosService.cambiarEstado(liq.id, 'LIQUIDADA', esc.adminId)
    expect(r.estado).toBe('LIQUIDADA')
    const [ultimo] = await LiquidacionesServiciosService.obtenerHistorial(liq.id)
    expect([ultimo.estado_anterior, ultimo.estado_nuevo, ultimo.usuario_id]).toEqual([
      'APROBADA',
      'LIQUIDADA',
      esc.adminId,
    ])
  })

  it('anular guarda el motivo, y reactivar lo limpia', async () => {
    const liq = await crearLiq()
    const anulada = await LiquidacionesServiciosService.cambiarEstado(
      liq.id,
      'ANULADA',
      esc.adminId,
      'Servicio duplicado',
    )
    expect(anulada.estado).toBe('ANULADA')
    expect(anulada.motivo_anulacion).toBe('Servicio duplicado')
    const [ultimo] = await LiquidacionesServiciosService.obtenerHistorial(liq.id)
    expect(ultimo.motivo).toBe('Servicio duplicado')

    /// Si el motivo sobreviviera a la reactivación, la ficha seguiría
    /// mostrando «anulada por servicio duplicado» en una liquidación viva.
    const reactivada = await LiquidacionesServiciosService.cambiarEstado(liq.id, 'BORRADOR', esc.adminId)
    expect(reactivada.motivo_anulacion).toBeNull()
  })

  it('una FACTURADA con factura activa no cambia de estado por esta ruta (409)', async () => {
    /// Moverla aquí dejaría la factura sumando una liquidación que ya no está
    /// facturada. La pantalla recibe la factura para ofrecer anularla o quitar
    /// la liquidación de ella.
    const liq = await crearLiq()
    const factura = await facturar(liq.id, 100000)

    const r = respuesta()
    await LiquidacionesServiciosController.cambiarEstado(
      peticionAdmin({ params: { id: liq.id }, body: { estado: 'LIQUIDADA' } }),
      comoReply(r),
    )

    expect(r.statusCode).toBe(409)
    expect(r.cuerpo).toMatchObject({ code: 'FACTURA_ACTIVA', factura: { id: factura.id } })
    const fila = await prisma.liquidacion_servicio.findUnique({ where: { id: liq.id } })
    expect(fila?.estado).toBe('FACTURADA')
  })
})

// ════════════════════════════════════════════════════════════════════════════
/**
 * Tabla de transiciones de `estado-transiciones.ts` (oct-2026). Antes la ruta
 * escribía lo que llegara: con `full` se ponía FACTURADA sin factura, una
 * ANULADA volvía directo a APROBADA y un valor fuera del enum salía como 500.
 */
describe('Transiciones de estado · tabla y validación', () => {
  /** Usuario de Operaciones: tiene `full` en el módulo pero no es Administración. */
  function peticionOperaciones(partes: { params?: object; body?: unknown }) {
    return {
      params: {},
      query: {},
      body: undefined,
      user: { id: esc.creadorId, nombre: `${MARCA} operaciones`, area: ['operaciones'], role: 'usuario' },
      ...partes,
    } as unknown as FastifyRequest
  }

  async function estadoDe(id: string) {
    return (await prisma.liquidacion_servicio.findUnique({ where: { id }, select: { estado: true } }))?.estado
  }

  it('un estado fuera del enum es 400 y no toca la fila', async () => {
    const liq = await crearLiq()
    const r = respuesta()
    await LiquidacionesServiciosController.cambiarEstado(
      peticionAdmin({ params: { id: liq.id }, body: { estado: 'PAGADA' } }),
      comoReply(r),
    )
    expect(r.statusCode).toBe(400)
    expect(r.cuerpo).toMatchObject({ code: 'ESTADO_INVALIDO' })
    expect(await estadoDe(liq.id)).toBe('BORRADOR')
  })

  it('FACTURADA no es destino de esta ruta, ni para Administración (409)', async () => {
    /// La pone la facturación al meterla en una factura. Por aquí quedaba una
    /// «facturada» sin factura que ninguna pantalla sabía deshacer.
    const liq = await crearLiq()
    await LiquidacionesServiciosService.cambiarEstado(liq.id, 'LIQUIDADA', esc.creadorId)
    await LiquidacionesServiciosService.cambiarEstado(liq.id, 'APROBADA', esc.adminId)

    const r = respuesta()
    await LiquidacionesServiciosController.cambiarEstado(
      peticionAdmin({ params: { id: liq.id }, body: { estado: 'FACTURADA' } }),
      comoReply(r),
    )
    expect(r.statusCode).toBe(409)
    expect(r.cuerpo).toMatchObject({ code: 'TRANSICION_INVALIDA' })
    const fila = await prisma.liquidacion_servicio.findUnique({ where: { id: liq.id } })
    expect(fila?.estado).toBe('APROBADA')
    expect(fila?.fecha_facturacion).toBeNull()
  })

  it('BORRADOR no salta a APROBADA: hay que liquidar antes', async () => {
    const liq = await crearLiq()
    await expect(
      LiquidacionesServiciosService.cambiarEstado(liq.id, 'APROBADA', esc.adminId),
    ).rejects.toMatchObject({ codigo: 'TRANSICION_INVALIDA', statusCode: 409 })
    expect(await estadoDe(liq.id)).toBe('BORRADOR')
  })

  it('una ANULADA solo se reactiva a BORRADOR', async () => {
    const liq = await crearLiq()
    await LiquidacionesServiciosService.cambiarEstado(liq.id, 'ANULADA', esc.adminId, 'Duplicada')

    for (const destino of ['APROBADA', 'LIQUIDADA'] as const) {
      await expect(
        LiquidacionesServiciosService.cambiarEstado(liq.id, destino, esc.adminId),
      ).rejects.toMatchObject({ codigo: 'TRANSICION_INVALIDA', statusCode: 409 })
    }
    expect(await estadoDe(liq.id)).toBe('ANULADA')

    const reactivada = await LiquidacionesServiciosService.cambiarEstado(liq.id, 'BORRADOR', esc.adminId)
    expect(reactivada.estado).toBe('BORRADOR')
  })

  it('reactivar una ANULADA es de Administración (403)', async () => {
    const liq = await crearLiq()
    await LiquidacionesServiciosService.cambiarEstado(liq.id, 'ANULADA', esc.adminId, 'Duplicada')

    const r = respuesta()
    await LiquidacionesServiciosController.cambiarEstado(
      peticionOperaciones({ params: { id: liq.id }, body: { estado: 'BORRADOR' } }),
      comoReply(r),
    )
    expect(r.statusCode).toBe(403)
    expect(await estadoDe(liq.id)).toBe('ANULADA')
  })

  it('Operaciones liquida y devuelve a borrador, pero no aprueba (403)', async () => {
    const liq = await crearLiq()
    const liquidar = respuesta()
    await LiquidacionesServiciosController.cambiarEstado(
      peticionOperaciones({ params: { id: liq.id }, body: { estado: 'LIQUIDADA' } }),
      comoReply(liquidar),
    )
    expect(liquidar.statusCode, JSON.stringify(liquidar.cuerpo)).toBe(200)

    const aprobar = respuesta()
    await LiquidacionesServiciosController.cambiarEstado(
      peticionOperaciones({ params: { id: liq.id }, body: { estado: 'APROBADA' } }),
      comoReply(aprobar),
    )
    expect(aprobar.statusCode).toBe(403)

    const devolver = respuesta()
    await LiquidacionesServiciosController.cambiarEstado(
      peticionOperaciones({ params: { id: liq.id }, body: { estado: 'BORRADOR' } }),
      comoReply(devolver),
    )
    expect(devolver.statusCode, JSON.stringify(devolver.cuerpo)).toBe(200)
    expect(await estadoDe(liq.id)).toBe('BORRADOR')
  })

  it('anular sin motivo es 400 FALTA_MOTIVO', async () => {
    const liq = await crearLiq()
    await expect(
      LiquidacionesServiciosService.cambiarEstado(liq.id, 'ANULADA', esc.adminId, '   '),
    ).rejects.toMatchObject({ codigo: 'FALTA_MOTIVO', statusCode: 400 })

    const r = respuesta()
    await LiquidacionesServiciosController.cambiarEstado(
      peticionAdmin({ params: { id: liq.id }, body: { estado: 'ANULADA' } }),
      comoReply(r),
    )
    expect(r.statusCode).toBe(400)
    expect(r.cuerpo).toMatchObject({ code: 'FALTA_MOTIVO' })
    expect(await estadoDe(liq.id)).toBe('BORRADOR')
  })

  it('pedir el estado que ya tiene es 409 y no deja otra fila en el historial', async () => {
    const liq = await crearLiq()
    await LiquidacionesServiciosService.cambiarEstado(liq.id, 'LIQUIDADA', esc.creadorId)
    const antes = (await LiquidacionesServiciosService.obtenerHistorial(liq.id)).length

    await expect(
      LiquidacionesServiciosService.cambiarEstado(liq.id, 'LIQUIDADA', esc.creadorId),
    ).rejects.toMatchObject({ codigo: 'TRANSICION_INVALIDA', statusCode: 409 })
    expect((await LiquidacionesServiciosService.obtenerHistorial(liq.id)).length).toBe(antes)
  })

  it('FACTURADA sin factura activa solo vuelve a APROBADA', async () => {
    /// Una factura anulada deja la liquidación FACTURADA sin factura viva: el
    /// «Devolver a aprobada» de la lista es la salida, y la única.
    const liq = await crearLiq()
    await prisma.liquidacion_servicio.update({
      where: { id: liq.id },
      data: { estado: 'FACTURADA', fecha_facturacion: new Date() },
    })

    const aBorrador = respuesta()
    await LiquidacionesServiciosController.cambiarEstado(
      peticionAdmin({ params: { id: liq.id }, body: { estado: 'BORRADOR' } }),
      comoReply(aBorrador),
    )
    expect(aBorrador.statusCode).toBe(409)
    expect(aBorrador.cuerpo).toMatchObject({ code: 'TRANSICION_INVALIDA' })

    const aAprobada = respuesta()
    await LiquidacionesServiciosController.cambiarEstado(
      peticionAdmin({ params: { id: liq.id }, body: { estado: 'APROBADA' } }),
      comoReply(aAprobada),
    )
    expect(aAprobada.statusCode, JSON.stringify(aAprobada.cuerpo)).toBe(200)
    expect(await estadoDe(liq.id)).toBe('APROBADA')
  })

  it('una liquidación en la papelera no cambia de estado (404)', async () => {
    const liq = await crearLiq()
    await LiquidacionesServiciosService.eliminar(liq.id, esc.adminId)

    const r = respuesta()
    await LiquidacionesServiciosController.cambiarEstado(
      peticionAdmin({ params: { id: liq.id }, body: { estado: 'LIQUIDADA' } }),
      comoReply(r),
    )
    expect(r.statusCode).toBe(404)
    await expect(
      LiquidacionesServiciosService.cambiarEstado(liq.id, 'LIQUIDADA', esc.adminId),
    ).rejects.toMatchObject({ codigo: 'LIQUIDACION_NO_ENCONTRADA', statusCode: 404 })
    expect(await estadoDe(liq.id)).toBe('BORRADOR')
  })
})

// ════════════════════════════════════════════════════════════════════════════
describe('Editar', () => {
  it('recalcula la cabecera con los ítems que llegan y deja foto de la edición', async () => {
    const liq = await crearLiq({
      items: [itemDePrueba(placaUnica()), itemDePrueba(placaUnica())],
      porcentaje_iva: 19,
    })
    const placa = placaUnica()

    await LiquidacionesServiciosService.actualizar(
      liq.id,
      payloadBase({
        consecutivo: liq.consecutivo,
        items: [itemDePrueba(placa, { cantidad: 3, valor_unitario: 50000 })],
        porcentaje_iva: 19,
      }),
      esc.adminId,
    )

    const leida = await LiquidacionesServiciosService.obtenerPorId(liq.id)
    expect(leida.items.map((i) => i.placa)).toEqual([placa])
    expect(leida.valor_servicios).toBe(150000)
    expect(leida.valor_iva).toBe(28500)
    expect(leida.total).toBe(178500)
    expect(leida.actualizado_por_id).toBe(esc.adminId)

    const [ultimo] = await LiquidacionesServiciosService.obtenerHistorial(liq.id)
    expect(ultimo.accion).toBe('edicion')
    /// La foto se toma DESPUÉS de reconciliar y solo con ítems vivos: antes
    /// guardaba como «versión» las filas que el usuario acababa de quitar.
    expect(ultimo.snapshot).toMatchObject({ total_items: 1, total: 178500 })
  })

  it('no se edita una eliminada: hay que restaurarla primero (409)', async () => {
    /// Guardar sobre una eliminada creaba ítems ACTIVOS bajo una cabecera que
    /// nadie ve, y esos ítems no se restauraban nunca.
    const liq = await crearLiq()
    await LiquidacionesServiciosService.eliminar(liq.id, esc.adminId)

    await expect(
      LiquidacionesServiciosService.actualizar(
        liq.id,
        payloadBase({ consecutivo: liq.consecutivo, items: [itemDePrueba(placaUnica())] }),
        esc.adminId,
      ),
    ).rejects.toMatchObject({ codigo: 'LIQUIDACION_ELIMINADA', statusCode: 409 })

    expect(
      await prisma.liquidacion_servicio_item.count({ where: { liquidacion_id: liq.id, deleted_at: null } }),
    ).toBe(0)
  })

  it('editar una FACTURADA recalcula su factura y lo devuelve para avisar', async () => {
    /// El pivote guarda el valor con que se facturó; sin recalcular, la
    /// factura seguiría sumando el valor viejo aunque la liquidación cambió.
    const liq = await crearLiq()
    const factura = await facturar(liq.id, 100000)

    const r = respuesta()
    await LiquidacionesServiciosController.actualizar(
      peticionAdmin({
        params: { id: liq.id },
        body: payloadBase({
          consecutivo: liq.consecutivo,
          items: [itemDePrueba(placaUnica(), { valor_unitario: 140000 })],
        }),
      }),
      comoReply(r),
    )

    expect(r.statusCode, JSON.stringify(r.cuerpo)).toBe(200)
    expect(r.cuerpo.factura_recalculada).toMatchObject({
      factura_id: factura.id,
      valor_anterior: 100000,
      valor_nuevo: 140000,
    })
    const leida = await FacturacionLiquidacionesService.obtenerPorId(factura.id)
    expect(leida.valor_total).toBe(140000)
  })

  it('editar conserva el id de los ítems que siguen', async () => {
    // Regresión (arreglado el 11-oct-2026): `construirItemsYTotales` ponía
    // `id: randomUUID()` a cada ítem y descartaba el `id` y el `client_key`
    // del editor, así que `reconciliarItems` no emparejaba nunca y cada
    // guardado recreaba todos los ítems.
    const liq = await crearLiq({ items: [itemDePrueba(placaUnica()), itemDePrueba(placaUnica())] })
    const antes = liq.items.map((i) => ({ id: i.id, placa: i.placa }))

    await LiquidacionesServiciosService.actualizar(
      liq.id,
      payloadBase({
        consecutivo: liq.consecutivo,
        items: antes.map((i) => itemDePrueba(i.placa, { id: i.id })),
      }),
      esc.adminId,
    )

    const despues = await LiquidacionesServiciosService.obtenerPorId(liq.id)
    expect(despues.items.map((i) => i.id)).toEqual(antes.map((i) => i.id))
  })

  it('la respuesta de `actualizar` trae los ítems guardados, no los de antes', async () => {
    // Regresión (arreglado el 11-oct-2026): los ítems del valor de retorno se
    // leían en el `update` de la cabecera, ANTES de reconciliar, y con ellos se
    // enganchaban los terceros (`item_id`) a ítems recién marcados.
    const liq = await crearLiq({ items: [itemDePrueba(placaUnica()), itemDePrueba(placaUnica())] })
    const placa = placaUnica()

    const r = await LiquidacionesServiciosService.actualizar(
      liq.id,
      payloadBase({ consecutivo: liq.consecutivo, items: [itemDePrueba(placa)] }),
      esc.adminId,
    )

    expect(r.items.map((i) => i.placa)).toEqual([placa])
  })
})

// ════════════════════════════════════════════════════════════════════════════
describe('Autoguardado', () => {
  it('nace sin confirmar y solo la ven su autor y Administración', async () => {
    /// Sin esto el listado y el canvas de todos se llenarían de liquidaciones a
    /// medio escribir en cuanto alguien abre el formulario.
    const clave = randomUUID()
    const r = await LiquidacionesServiciosService.autoguardar(
      { ...payloadBase(), cliente_key: clave },
      esc.creadorId,
    )
    expect(r).toMatchObject({ creada: true, estado: 'BORRADOR', version: 1 })
    const fila = await prisma.liquidacion_servicio.findUnique({ where: { id: r.id! } })
    expect(fila?.confirmada_at).toBeNull()

    const ids = async (f: Partial<FiltrosLiquidacionServicios>) =>
      (await listarDelCliente(f)).liquidaciones.map((l) => l.id)

    expect(await ids({})).not.toContain(r.id)
    expect(await ids({ incluir_no_confirmadas: 'true', usuario_id: esc.creadorId })).toContain(r.id)
    /// Pedirlas no basta: otro usuario sin el permiso no ve las ajenas.
    expect(await ids({ incluir_no_confirmadas: 'true', usuario_id: esc.adminId })).not.toContain(r.id)
    expect(
      await ids({
        incluir_no_confirmadas: 'true',
        usuario_id: esc.adminId,
        puede_ver_no_confirmadas_ajenas: true,
      }),
    ).toContain(r.id)
  })

  it('es idempotente por cliente_key: dos altas en vuelo no crean dos liquidaciones', async () => {
    const clave = randomUUID()
    const base = { ...payloadBase(), cliente_key: clave }
    const a = await LiquidacionesServiciosService.autoguardar(base, esc.creadorId)
    /// La segunda petición salió antes de conocer el id de la primera.
    const b = await LiquidacionesServiciosService.autoguardar(base, esc.creadorId)

    expect(b.id).toBe(a.id)
    expect(b.creada).toBe(false)
    expect(await prisma.liquidacion_servicio.count({ where: { cliente_key: clave } })).toBe(1)
  })

  it('rechaza con el motivo concreto: versión vieja, ya no es borrador, o borrada', async () => {
    /// Un 409 genérico no le dice al editor si recargar, avisar de que la
    /// liquidación avanzó, o rendirse porque la borraron.
    const a = await LiquidacionesServiciosService.autoguardar(payloadBase(), esc.creadorId)
    const id = a.id!
    const siguiente = (base_version: number) =>
      LiquidacionesServiciosService.autoguardar(
        { ...payloadBase(), borrador_id: id, base_version },
        esc.creadorId,
      )

    const ok = await siguiente(1)
    expect(ok.version).toBe(2)
    expect(await motivoDeConflicto(siguiente(1))).toBe('version')

    await LiquidacionesServiciosService.cambiarEstado(id, 'LIQUIDADA', esc.creadorId)
    expect(await motivoDeConflicto(siguiente(2))).toBe('estado')

    await LiquidacionesServiciosService.cambiarEstado(id, 'BORRADOR', esc.creadorId)
    await LiquidacionesServiciosService.eliminar(id, esc.creadorId)
    expect(await motivoDeConflicto(siguiente(2))).toBe('borrada')
  })

  it('el primer PUT sobre un borrador autoguardado lo confirma y se anuncia como nuevo', async () => {
    /// Para todos los demás la liquidación nace en ese momento: un feed que
    /// dijera «actualizó» hablaría de algo que nunca vieron aparecer.
    const a = await LiquidacionesServiciosService.autoguardar(payloadBase(), esc.creadorId)
    vi.mocked(emitLiquidacionServicio).mockClear()

    const r = respuesta()
    await LiquidacionesServiciosController.actualizar(
      peticionAdmin({ params: { id: a.id }, body: payloadBase({ consecutivo: a.consecutivo }) }),
      comoReply(r),
    )

    expect(r.statusCode, JSON.stringify(r.cuerpo)).toBe(200)
    const fila = await prisma.liquidacion_servicio.findUnique({ where: { id: a.id! } })
    expect(fila?.confirmada_at).toBeInstanceOf(Date)
    expect(vi.mocked(emitLiquidacionServicio).mock.calls[0]?.[0]).toBe('liquidacion-servicio-created')
  })

  it.fails('BUG · un autoguardado sin ítems no toca la cabecera', async () => {
    // La guardia `rechazarVaciadoTotal` rechaza la reconciliación, pero la
    // cabecera ya se actualizó en una transacción ANTERIOR (totales a 0 y
    // `version + 1`). Queda una liquidación con ítems vivos y total 0: el
    // descuadre que la guardia venía a impedir.
    const a = await LiquidacionesServiciosService.autoguardar(
      payloadBase({ items: [itemDePrueba(placaUnica(), { valor_unitario: 200000 })] }),
      esc.creadorId,
    )

    await expect(
      LiquidacionesServiciosService.autoguardar(
        { ...payloadBase({ items: [] }), borrador_id: a.id, base_version: a.version },
        esc.creadorId,
      ),
    ).rejects.toThrow(/sin ítems/)

    const fila = await prisma.liquidacion_servicio.findUnique({ where: { id: a.id! } })
    expect(Number(fila?.total)).toBe(200000)
    expect(fila?.version).toBe(a.version)
  })
})

// ════════════════════════════════════════════════════════════════════════════
describe('Borrado lógico · eliminar', () => {
  it('marca la liquidación y TODAS las lecturas la excluyen; la papelera la muestra', async () => {
    const liq = await crearLiq({
      items: [itemDePrueba(placaUnica()), itemDePrueba(placaUnica()), itemDePrueba(placaUnica())],
    })
    const statsAntes = await LiquidacionesServiciosService.estadisticas()

    const r = await LiquidacionesServiciosService.eliminar(liq.id, esc.adminId, 'cliente equivocado')
    expect(r.relacionadas).toMatchObject({ items: 3 })

    await expect(LiquidacionesServiciosService.obtenerPorId(liq.id)).rejects.toThrow(/no encontrada/)

    const listado = await listarDelCliente()
    expect(listado.liquidaciones.map((l) => l.id)).not.toContain(liq.id)
    expect(listado.metadata.consecutivos).not.toContain(liq.consecutivo)
    expect((await listarDelCliente({ busqueda: liq.consecutivo })).total).toBe(0)

    /// Las tarjetas de estadísticas no tenían `where`: contaban las borradas.
    const statsDespues = await LiquidacionesServiciosService.estadisticas()
    expect(statsAntes.total - statsDespues.total).toBe(1)
    // Tres ítems de 100.000 sin IVA.
    expect(statsAntes.monto_total - statsDespues.monto_total).toBeCloseTo(300000, 2)

    const papelera = await LiquidacionesServiciosService.listarEliminadas({ busqueda: liq.consecutivo })
    expect(papelera.liquidaciones.map((l) => l.id)).toEqual([liq.id])
    expect(papelera.liquidaciones[0].total_items).toBe(3)

    /// Queda registrado quién y por qué.
    expect(await filaAuditoria(liq.id, 'ELIMINAR')).toEqual({
      usuario_id: esc.adminId,
      motivo: 'cliente equivocado',
    })
  })

  it('no se elimina dos veces (la fecha original es el dato)', async () => {
    const liq = await crearLiq()
    await LiquidacionesServiciosService.eliminar(liq.id, esc.adminId)
    const marcada = await prisma.liquidacion_servicio.findUnique({ where: { id: liq.id } })

    await expect(LiquidacionesServiciosService.eliminar(liq.id, esc.adminId)).rejects.toThrow(
      /ya fue eliminada/,
    )
    const igual = await prisma.liquidacion_servicio.findUnique({ where: { id: liq.id } })
    expect(igual?.deleted_at).toEqual(marcada?.deleted_at)
  })

  it('no se elimina con una factura activa: hay que anularla primero', async () => {
    const liq = await crearLiq()
    await facturar(liq.id, 100000)

    await expect(LiquidacionesServiciosService.eliminar(liq.id, esc.adminId)).rejects.toThrow(
      /facturas activas/,
    )
    const fila = await prisma.liquidacion_servicio.findUnique({ where: { id: liq.id } })
    expect(fila?.deleted_at).toBeNull()
  })

  it.fails('BUG · la papelera muestra las placas de la liquidación eliminada', async () => {
    // `listarEliminadas` incluye `items: { where: { deleted_at: null } }`,
    // pero al eliminar se marcan TODOS los ítems: `placas` sale siempre vacío
    // en la papelera. Además `_count.items` no filtra, así que `total_items`
    // cuenta también las copias muertas de cada edición.
    const placa = placaUnica()
    const liq = await crearLiq({ items: [itemDePrueba(placa)] })
    await LiquidacionesServiciosService.eliminar(liq.id, esc.adminId)

    const papelera = await LiquidacionesServiciosService.listarEliminadas({ busqueda: liq.consecutivo })
    expect(papelera.liquidaciones[0].placas).toEqual([placa])
  })
})

// ════════════════════════════════════════════════════════════════════════════
describe('Borrado lógico · ítems retirados en una edición', () => {
  /// Las cuatro formas de lectura de AGENTS.md: consulta directa, include
  /// a-muchos, `_count` y filtro por relación. Un ítem quitado al editar sigue
  /// en la tabla, marcado; si alguna lectura no filtra, reaparece en pantalla
  /// o en un filtro.
  let liqId: string
  let consecutivo: string
  const vivas = [placaUnica(), placaUnica()]
  const retirada = placaUnica()

  beforeAll(async () => {
    const liq = await crearLiq({ items: [...vivas, retirada].map((p) => itemDePrueba(p)) })
    liqId = liq.id
    consecutivo = liq.consecutivo
    await LiquidacionesServiciosService.actualizar(
      liq.id,
      payloadBase({ consecutivo, items: vivas.map((p) => itemDePrueba(p)) }),
      esc.adminId,
    )
    /// El retirado sigue existiendo, marcado: sin esto los casos de abajo
    /// pasarían también si se hubiera borrado de verdad.
    const marcadas = await prisma.liquidacion_servicio_item.count({
      where: { liquidacion_id: liqId, placa: retirada, deleted_at: { not: null } },
    })
    expect(marcadas).toBe(1)
  })

  it('consulta directa: la ficha no lo trae', async () => {
    const leida = await LiquidacionesServiciosService.obtenerPorId(liqId)
    expect(leida.items.map((i) => i.placa)).toEqual(vivas)
  })

  it('include y _count: el listado no lo cuenta ni lo pinta', async () => {
    const fila = (await listarDelCliente()).liquidaciones.find((l) => l.id === liqId)
    expect(fila?.total_items).toBe(2)
    /// `placas` sale de un include sin `orderBy`: se compara sin orden.
    expect([...(fila?.placas ?? [])].sort()).toEqual([...vivas].sort())

    const conItems = (await listarDelCliente({ include_items: 'true' })).liquidaciones.find(
      (l) => l.id === liqId,
    )
    expect(conItems?.items?.map((i: { placa: string }) => i.placa)).toEqual(vivas)
  })

  it('filtro por relación: ni el desplegable ni la búsqueda lo encuentran', async () => {
    const listado = await listarDelCliente()
    expect(listado.metadata.placas).not.toContain(retirada)
    expect((await listarDelCliente({ placas: retirada })).total).toBe(0)
    expect((await listarDelCliente({ busqueda: retirada })).total).toBe(0)
    // Control: la viva sí se encuentra por las mismas vías.
    expect((await listarDelCliente({ placas: vivas[0] })).total).toBe(1)
    expect((await listarDelCliente({ busqueda: vivas[0] })).total).toBe(1)
  })

  it.fails('BUG · el filtro `placa` (SQL crudo) tampoco lo encuentra', async () => {
    // `listar` resuelve `filtros.placa` con un `$queryRaw` sobre
    // `liquidacion_servicio_item` SIN `deleted_at IS NULL`: la liquidación
    // sale al filtrar por la placa de un ítem que ya no tiene.
    expect((await listarDelCliente({ placa: retirada })).total).toBe(0)
  })
})

// ════════════════════════════════════════════════════════════════════════════
describe('Borrado lógico · restaurar', () => {
  it('vuelve con sus ítems, sus totales y su rastro de auditoría', async () => {
    const liq = await crearLiq({
      items: [itemDePrueba(placaUnica()), itemDePrueba(placaUnica()), itemDePrueba(placaUnica())],
      porcentaje_iva: 19,
    })
    const antes = await LiquidacionesServiciosService.obtenerPorId(liq.id)
    await LiquidacionesServiciosService.eliminar(liq.id, esc.adminId)

    const r = await LiquidacionesServiciosService.restaurar(liq.id, esc.adminId, 'era la buena')
    expect(r.relacionadas).toMatchObject({ items: 3 })

    const despues = await LiquidacionesServiciosService.obtenerPorId(liq.id)
    expect(despues.items.map((i) => i.id)).toEqual(antes.items.map((i) => i.id))
    expect(despues.total).toBe(antes.total)
    expect(despues.total).toBe(357000)
    expect((await listarDelCliente()).liquidaciones.map((l) => l.id)).toContain(liq.id)

    expect(await filaAuditoria(liq.id, 'RESTAURAR')).toEqual({
      usuario_id: esc.adminId,
      motivo: 'era la buena',
    })
  })

  it('solo se restaura lo que está en la papelera', async () => {
    const liq = await crearLiq()
    await expect(LiquidacionesServiciosService.restaurar(liq.id, esc.adminId)).rejects.toThrow(
      /no está eliminada/,
    )
    await expect(
      LiquidacionesServiciosService.restaurar(randomUUID(), esc.adminId),
    ).rejects.toThrow(/no encontrada/)
  })

  describe('BUG · restaurar revive también lo que se retiró ANTES de eliminar', () => {
    // `restaurarLiquidacionServicio` (src/lib/soft-delete/liquidacion-servicio.ts)
    // pone `deleted_at = NULL` a TODO lo marcado de la liquidación, sin mirar
    // la fecha. Pero lo marcado incluye lo que el usuario quitó al editar y
    // las versiones viejas de terceros que `LiquidacionesTercerosService.guardar`
    // marca en cada guardado. Como `eliminar` marca todo con el mismo
    // instante, bastaría restaurar lo que tiene `deleted_at` igual al de la
    // cabecera.

    it.fails('un ítem quitado al editar no vuelve', async () => {
      const vivas = [placaUnica(), placaUnica()]
      const liq = await crearLiq({ items: [...vivas, placaUnica()].map((p) => itemDePrueba(p)) })
      await LiquidacionesServiciosService.actualizar(
        liq.id,
        payloadBase({ consecutivo: liq.consecutivo, items: vivas.map((p) => itemDePrueba(p)) }),
        esc.adminId,
      )
      await LiquidacionesServiciosService.eliminar(liq.id, esc.adminId)
      await LiquidacionesServiciosService.restaurar(liq.id, esc.adminId)

      // Hoy vuelven 5: los 3 originales (marcados por la edición, ver el bug
      // de los ids) y los 2 de la edición. La cabecera dice 200.000 y los
      // ítems suman 500.000.
      const leida = await LiquidacionesServiciosService.obtenerPorId(liq.id)
      expect(leida.items.map((i) => i.placa)).toEqual(vivas)
    })

    it.fails('las versiones viejas de los terceros no vuelven duplicadas', async () => {
      const placa = placaUnica()
      const tercero = {
        placa,
        recorrido: 'R',
        fechas: '05/01/2026',
        valor_unitario: 50000,
        cantidad: 1,
        porcentaje_admin: 10,
        src_index: 0,
      }
      const liq = await crearLiq({ items: [itemDePrueba(placa)], terceros_items: [tercero] })
      await LiquidacionesServiciosService.actualizar(
        liq.id,
        payloadBase({
          consecutivo: liq.consecutivo,
          items: [itemDePrueba(placa)],
          terceros_items: [tercero],
        }),
        esc.adminId,
      )
      await LiquidacionesServiciosService.eliminar(liq.id, esc.adminId)
      await LiquidacionesServiciosService.restaurar(liq.id, esc.adminId)

      // Hoy salen 2: la versión de `crear` y la de `actualizar`. En dinero,
      // el tercero cobraría dos veces el mismo servicio.
      const leida = await LiquidacionesServiciosService.obtenerPorId(liq.id)
      expect(leida.terceros_items).toHaveLength(1)
    })
  })
})
