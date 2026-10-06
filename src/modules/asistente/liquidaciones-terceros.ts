import { prisma } from '../../config/prisma'
import { LiquidacionesTercerosService } from '../liquidaciones-terceros/liquidaciones-terceros.service'
import type { Herramienta } from './asistente.types'
import { enteroEntre, textoOpcional } from './asistente.utils'

/**
 * Liquidaciones de terceros (propietarios de vehículos) en el asistente y el
 * MCP. Solo lectura: usa el mismo `listarHistorial` de la pantalla, que trae
 * cada ítem de tercero con su liquidación de servicios padre y la factura
 * activa si la hay.
 */

const MODULO = 'liquidaciones-terceros'
const LIMITE_MAXIMO = 500

function enteroOpcional(valor: unknown, min: number, max: number): number | undefined {
  if (valor === null || valor === undefined || valor === '') return undefined
  const n = Number(valor)
  return Number.isInteger(n) && n >= min && n <= max ? n : undefined
}

export const buscarLiquidacionesTerceros: Herramienta = {
  nombre: 'buscar_liquidaciones_terceros',
  descripcion:
    'Busca ítems de liquidación de terceros (propietarios): por tercero, placa, cliente, consecutivo de la liquidación de servicios, periodo (mes/año) o texto. Devuelve por ítem el tercero, placa, recorrido, fechas, valor unitario, cantidad, total facturado, % y valor de administración, valor a liquidar al tercero, ingreso para la empresa, estado, y la liquidación de servicios padre (consecutivo, cliente, periodo, estado) con su factura si existe. Incluye totales del conjunto filtrado.',
  parametros: {
    type: 'object',
    properties: {
      texto: { type: 'string', description: 'Tercero, placa, recorrido o consecutivo (p. ej. IDE-058)' },
      tercero: { type: 'string', description: 'Nombre o identificación del tercero' },
      placa: { type: 'string' },
      cliente: { type: 'string', description: 'Nombre o NIT del cliente de la liquidación' },
      mes: { type: 'integer', minimum: 1, maximum: 12 },
      anio: { type: 'integer', minimum: 2020, maximum: 2100 },
      limite: { type: 'integer', minimum: 1, maximum: LIMITE_MAXIMO },
    },
    additionalProperties: false,
  },
  etiqueta: 'Buscando liquidaciones de terceros',
  requiere: MODULO,
  async ejecutar(args) {
    const texto = textoOpcional(args.texto, 120)
    const terceroTexto = textoOpcional(args.tercero, 120)
    const clienteTexto = textoOpcional(args.cliente, 120)
    const limite = enteroEntre(args.limite, 1, LIMITE_MAXIMO, 30)

    let cliente_id: string | undefined
    if (clienteTexto) {
      const clientes = await prisma.clientes.findMany({
        where: { deletedAt: null, OR: [{ nombre: { contains: clienteTexto, mode: 'insensitive' } }, { nit: { contains: clienteTexto, mode: 'insensitive' } }] },
        select: { id: true, nombre: true },
        take: 5,
      })
      if (clientes.length === 0) return { error: `No encontré el cliente «${clienteTexto}»` }
      if (clientes.length > 1) return { error: 'Hay varios clientes que coinciden; pregunta cuál', candidatos: clientes.map((c) => c.nombre) }
      cliente_id = clientes[0].id
    }

    let tercero_id: string | undefined
    if (terceroTexto) {
      const terceros = await prisma.terceros.findMany({
        where: { OR: [{ nombre_completo: { contains: terceroTexto, mode: 'insensitive' } }, { identificacion: { contains: terceroTexto } }] },
        select: { id: true, nombre_completo: true, identificacion: true },
        take: 8,
      })
      if (terceros.length === 1) tercero_id = terceros[0].id
      else if (terceros.length > 1) {
        // Varios homónimos: se deja como texto libre y el historial busca por nombre.
      }
    }

    const r = await LiquidacionesTercerosService.listarHistorial({
      page: 1,
      limit: limite,
      cliente_id,
      tercero_id,
      placa: textoOpcional(args.placa, 20)?.replace(/[\s-]/g, ''),
      mes: enteroOpcional(args.mes, 1, 12),
      anio: enteroOpcional(args.anio, 2020, 2100),
      busqueda: texto ?? (tercero_id ? undefined : terceroTexto),
    })

    type Item = (typeof r.items)[number] & {
      tercero?: { nombre_completo: string; identificacion: string | null; tipo_persona: string | null } | null
      item?: { numero_planilla: string | null } | null
      liquidacion?: {
        id: string
        consecutivo: string
        mes: number
        anio: number
        estado: string
        osi: string | null
        tercero_liquidado: boolean
        cliente: { nombre: string; nit: string | null }
        factura_items: { factura: { numero_factura: string; estado: string } }[]
      }
    }
    const items = r.items as Item[]
    const suma = (f: (i: Item) => number) => Math.round(items.reduce((s, i) => s + f(i), 0) * 100) / 100

    return {
      total: r.total,
      mostrados: items.length,
      totales_de_lo_mostrado: {
        total_facturado: suma((i) => i.total_facturado),
        valor_admin: suma((i) => i.valor_admin),
        valor_liquidar_terceros: suma((i) => i.valor_liquidar),
        ingreso_empresa: suma((i) => i.ingreso_empresa),
      },
      metadata: r.metadata,
      items: items.map((i) => ({
        tercero: i.tercero?.nombre_completo ?? 'sin tercero',
        identificacion: i.tercero?.identificacion ?? undefined,
        placa: i.placa,
        recorrido: i.recorrido,
        fechas: i.fechas,
        planilla: i.item?.numero_planilla ?? undefined,
        valor_unitario: i.valor_unitario,
        cantidad: i.cantidad,
        total_facturado: i.total_facturado,
        porcentaje_admin: i.porcentaje_admin,
        valor_admin: i.valor_admin,
        valor_liquidar: i.valor_liquidar,
        ingreso_extra_global: i.ingreso_extra_global || undefined,
        ingresos_extra_aval: i.ingresos_extra_aval || undefined,
        ingreso_empresa: i.ingreso_empresa,
        estado: String(i.estado).toLowerCase(),
        liquidacion: i.liquidacion
          ? {
              consecutivo: i.liquidacion.consecutivo,
              cliente: i.liquidacion.cliente.nombre,
              periodo: `${i.liquidacion.mes}/${i.liquidacion.anio}`,
              estado: i.liquidacion.estado.toLowerCase(),
              osi: i.liquidacion.osi ?? undefined,
              tercero_liquidado: i.liquidacion.tercero_liquidado,
              factura: i.liquidacion.factura_items[0]?.factura.numero_factura,
              enlace: `/dashboard/liquidaciones-servicios/${i.liquidacion.id}?mode=view`,
            }
          : undefined,
      })),
      enlace: '/dashboard/liquidaciones-terceros',
    }
  },
}

/**
 * Cierres finales de terceros (`liquidacion_tercero_final`): lo que al final se
 * le paga a cada propietario por placa y periodo, con costos laborales, gastos,
 * impuestos y descuentos. Es lo que se ve en el canvas de terceros.
 */
export const cierresTerceros: Herramienta = {
  nombre: 'cierres_terceros',
  descripcion:
    'Lista los cierres finales de terceros (propietarios) por periodo (mes/año), tercero, placa o estado (BORRADOR, APROBADA, ANULADA): consecutivo, tercero, placa, liquidación de servicios de origen, valor a liquidar, costos laborales, gastos operativos, impuestos, descuentos y total a pagar, con los totales del conjunto y el enlace al canvas. Úsala para «¿cuánto se le paga a X este mes?», «¿qué cierres están en borrador?», «total pagado a terceros en septiembre».',
  parametros: {
    type: 'object',
    properties: {
      tercero: { type: 'string', description: 'Nombre o identificación del propietario' },
      placa: { type: 'string' },
      estado: { type: 'string', enum: ['BORRADOR', 'APROBADA', 'ANULADA'] },
      mes: { type: 'integer', minimum: 1, maximum: 12 },
      anio: { type: 'integer', minimum: 2020, maximum: 2100 },
      limite: { type: 'integer', minimum: 1, maximum: LIMITE_MAXIMO, description: 'Hasta 500' },
    },
    additionalProperties: false,
  },
  etiqueta: 'Consultando los cierres de terceros',
  requiere: MODULO,
  async ejecutar(args) {
    const tercero = textoOpcional(args.tercero, 120)
    const placa = textoOpcional(args.placa, 20)?.replace(/[\s-]/g, '')
    const estado = typeof args.estado === 'string' && ['BORRADOR', 'APROBADA', 'ANULADA'].includes(args.estado.toUpperCase()) ? args.estado.toUpperCase() : undefined
    const mes = enteroOpcional(args.mes, 1, 12)
    const anio = enteroOpcional(args.anio, 2020, 2100)
    const limite = enteroEntre(args.limite, 1, LIMITE_MAXIMO, 50)
    const contiene = (q: string) => ({ contains: q, mode: 'insensitive' as const })
    const where = {
      deleted_at: null,
      ...(estado ? { estado } : {}),
      ...(mes ? { mes } : {}),
      ...(anio ? { anio } : {}),
      ...(placa ? { placa: contiene(placa) } : {}),
      ...(tercero ? { tercero: { OR: [{ nombre_completo: contiene(tercero) }, { identificacion: { contains: tercero } }] } } : {}),
    }
    const [filas, total] = await Promise.all([
      prisma.liquidacion_tercero_final.findMany({
        where,
        select: {
          id: true,
          consecutivo: true,
          placa: true,
          mes: true,
          anio: true,
          estado: true,
          valor_liquidar: true,
          total_costos_laborales: true,
          total_gastos_operativos: true,
          total_impuestos: true,
          total_descuentos: true,
          total_pagar: true,
          motivo_anulacion: true,
          created_at: true,
          tercero: { select: { nombre_completo: true, identificacion: true } },
          liquidacion_servicio: { select: { id: true, consecutivo: true, cliente: { select: { nombre: true } } } },
        },
        orderBy: [{ anio: 'desc' }, { mes: 'desc' }, { consecutivo: 'desc' }],
        take: limite,
      }),
      prisma.liquidacion_tercero_final.count({ where }),
    ])
    const n = (v: unknown) => Math.round(Number(v ?? 0) * 100) / 100
    const suma = (f: (x: (typeof filas)[number]) => unknown) => n(filas.reduce((s, x) => s + Number(f(x) ?? 0), 0))
    return {
      total,
      mostrados: filas.length,
      totales_de_lo_mostrado: {
        valor_liquidar: suma((x) => x.valor_liquidar),
        costos_laborales: suma((x) => x.total_costos_laborales),
        gastos_operativos: suma((x) => x.total_gastos_operativos),
        impuestos: suma((x) => x.total_impuestos),
        descuentos: suma((x) => x.total_descuentos),
        total_pagar: suma((x) => x.total_pagar),
      },
      cierres: filas.map((x) => ({
        consecutivo: x.consecutivo,
        tercero: x.tercero?.nombre_completo ?? 'sin tercero',
        identificacion: x.tercero?.identificacion ?? undefined,
        placa: x.placa,
        periodo: `${x.mes}/${x.anio}`,
        estado: x.estado.toLowerCase(),
        liquidacion_servicios: x.liquidacion_servicio.consecutivo,
        cliente: x.liquidacion_servicio.cliente.nombre,
        valor_liquidar: n(x.valor_liquidar),
        costos_laborales: n(x.total_costos_laborales),
        gastos_operativos: n(x.total_gastos_operativos),
        impuestos: n(x.total_impuestos),
        descuentos: n(x.total_descuentos),
        total_pagar: n(x.total_pagar),
        motivo_anulacion: x.motivo_anulacion ?? undefined,
        enlace: `/dashboard/liquidaciones-terceros/canvas?anio=${x.anio}&mes=${x.mes}&cierre=${x.id}`,
      })),
    }
  },
}

export const HERRAMIENTAS_LIQUIDACIONES_TERCEROS: readonly Herramienta[] = [buscarLiquidacionesTerceros, cierresTerceros]
