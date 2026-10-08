import { Prisma } from '@prisma/client'
import { prisma } from '../../config/prisma'
import { emitLiquidacionServicio, eventoMeta } from '../../sockets'
import { LiquidacionesServiciosService } from '../liquidaciones-servicios/liquidaciones-servicios.service'
import { notificarLiquidacionCreada } from '../liquidaciones-servicios/liquidaciones-servicios.controller'
import type { Herramienta } from './asistente.types'
import { enteroEntre, fechaCorta, textoOpcional } from './asistente.utils'

/** Entero dentro del rango, o `undefined` si no vino o no sirve (null, texto, fuera de rango). */
function enteroOpcional(valor: unknown, min: number, max: number): number | undefined {
  if (valor === null || valor === undefined || valor === '') return undefined
  const n = Number(valor)
  return Number.isInteger(n) && n >= min && n <= max ? n : undefined
}

/**
 * Liquidaciones de servicios en el asistente.
 *
 * Dos lecturas (`buscar_liquidaciones`, `detalle_liquidacion`) con el permiso
 * del módulo en cualquier nivel —facturación, que tiene `limited`, puede
 * consultarlas— y una acción, `duplicar_liquidacion`, que exige `full` como el
 * POST de la pantalla.
 *
 * La acción crea SIEMPRE un borrador: pasa por `LiquidacionesServiciosService
 * .crear`, que es el mismo camino del botón «Registrar» y nace en BORRADOR.
 * Liquidar, aprobar o facturar no tienen herramienta a propósito: eso lo hace
 * una persona en la pantalla, con sus guardas.
 *
 * Los ítems copiados NO se vinculan a los servicios ni a las planillas de la
 * original (`servicio_id` / `recargo_planilla_id` quedan vacíos): la copia es
 * una plantilla con los mismos valores, no una segunda liquidación de los
 * mismos viajes.
 *
 * Terceros: la parte de propietarios (`terceros_items` y `terceroRows` dentro
 * de `recargos_data`) solo se copia si el usuario tiene `liquidaciones-terceros`
 * en `full`. Si no, la copia sale sin terceros y se le dice.
 */

const MODULO = 'liquidaciones-servicios'
const MODULO_TERCEROS = 'liquidaciones-terceros'
const LIMITE_POR_DEFECTO = 10
const LIMITE_MAXIMO = 500

const ESTADOS = ['BORRADOR', 'LIQUIDADA', 'APROBADA', 'FACTURADA', 'ANULADA'] as const
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
const ENLACE_FACTURAS = '/dashboard/liquidaciones-servicios?tab=facturas'

function enlaces(id: string) {
  return {
    enlace: `/dashboard/liquidaciones-servicios/${id}?mode=view`,
    enlace_editar: `/dashboard/liquidaciones-servicios/editar/${id}`,
  }
}

function etiquetaTipo(tipo: string): string {
  return tipo.replace(/_/g, ' ').toLowerCase()
}

function soloFecha(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * Formas en que puede estar guardado un consecutivo: hay registros «FEPCO - 3424» (con espacios)
 * junto a «FEPCO-3450». Quien pregunta escribe cualquiera de las dos, y comparar el texto exacto
 * hacía decir «no existe» de una liquidación que sí está.
 */
function variantesConsecutivo(texto: string): string[] {
  const limpio = texto.replace(/^#+/, '').trim()
  const m = limpio.match(/^([A-Za-zÑñ]+)\s*-\s*([0-9.]+)$/)
  if (!m) return [limpio]
  const [, prefijo, numero] = m
  return [...new Set([limpio, `${prefijo}-${numero}`, `${prefijo} - ${numero}`, `${prefijo} -${numero}`, `${prefijo}- ${numero}`])]
}

/** Sin tildes y en mayúsculas, como están escritos los recorridos. */
function sinTildes(texto: string): string {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
}

type EstadoLiq = (typeof ESTADOS)[number]
function estadosDe(valor: unknown): EstadoLiq[] {
  if (!Array.isArray(valor)) return []
  return valor.map((v) => String(v).toUpperCase()).filter((v): v is EstadoLiq => (ESTADOS as readonly string[]).includes(v))
}
const PENDIENTES_DE_FACTURAR: EstadoLiq[] = ['BORRADOR', 'LIQUIDADA', 'APROBADA']

/**
 * Totales de liquidaciones sin tope de filas: la pregunta «¿cuánto falta
 * facturar de Sertecpet?» se responde con un `groupBy`, no sumando a mano una
 * lista de 25. Antes el modelo sumaba la página que veía y pedía permiso para
 * «traer las 198».
 */
export const resumenLiquidaciones: Herramienta = {
  nombre: 'resumen_liquidaciones',
  descripcion:
    'Totales de liquidaciones de servicios SIN tope de filas: cuántas hay y cuánto suman (servicios, recargos, subtotal, IVA, total) filtrando por cliente, estado(s), periodo o rango de meses, agrupado por estado, cliente, periodo u operadora. Úsala para «¿cuánto falta facturar de X?» (pendientes = borrador + liquidada + aprobada; pasa pendientes_de_facturar=true), «¿cuánto se liquidó en septiembre?», «¿cuántas liquidaciones hay por estado?», «total histórico por cliente». Nunca sumes a mano los resultados de buscar_liquidaciones.',
  parametros: {
    type: 'object',
    properties: {
      cliente: { type: 'string', description: 'Nombre o NIT del cliente (parcial)' },
      estados: { type: 'array', items: { type: 'string', enum: [...ESTADOS] }, description: 'Estados a incluir; vacío = todos menos anuladas' },
      pendientes_de_facturar: { type: 'boolean', description: 'true = solo BORRADOR, LIQUIDADA y APROBADA (lo que aún no se ha facturado)' },
      incluir_anuladas: { type: 'boolean' },
      mes: { type: 'integer', minimum: 1, maximum: 12 },
      anio: { type: 'integer', minimum: 2020, maximum: 2100 },
      desde_mes: { type: 'string', description: 'YYYY-MM inicial de un rango de periodos' },
      hasta_mes: { type: 'string', description: 'YYYY-MM final, incluido' },
      agrupar_por: { type: 'string', enum: ['estado', 'cliente', 'periodo', 'operadora', 'ninguno'], description: 'Por defecto estado' },
      operadora: { type: 'string' },
    },
    additionalProperties: false,
  },
  etiqueta: 'Sumando liquidaciones',
  requiere: MODULO,
  salidaMaxima: { lista: 500, caracteres: 60000 },
  async ejecutar(args) {
    const cliente = textoOpcional(args.cliente, 120)
    const operadora = textoOpcional(args.operadora, 120)
    const mes = enteroOpcional(args.mes, 1, 12)
    const anio = enteroOpcional(args.anio, 2020, 2100)
    const contiene = (q: string) => ({ contains: q.replace(/^#+/, '').trim(), mode: 'insensitive' as const })
    let estados = args.pendientes_de_facturar === true ? PENDIENTES_DE_FACTURAR : estadosDe(args.estados)
    if (estados.length === 0) estados = ESTADOS.filter((e) => e !== 'ANULADA' || args.incluir_anuladas === true)
    const agrupar = typeof args.agrupar_por === 'string' && ['estado', 'cliente', 'periodo', 'operadora', 'ninguno'].includes(args.agrupar_por) ? args.agrupar_por : 'estado'

    const periodo = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}$/.test(v) ? { anio: Number(v.slice(0, 4)), mes: Number(v.slice(5, 7)) } : undefined)
    const d = periodo(args.desde_mes)
    const h = periodo(args.hasta_mes)
    const rangoPeriodos =
      d || h
        ? {
            OR: [] as Prisma.liquidacion_servicioWhereInput[],
            AND: [
              ...(d ? [{ OR: [{ anio: { gt: d.anio } }, { anio: d.anio, mes: { gte: d.mes } }] }] : []),
              ...(h ? [{ OR: [{ anio: { lt: h.anio } }, { anio: h.anio, mes: { lte: h.mes } }] }] : []),
            ],
          }
        : {}
    if ('OR' in rangoPeriodos) delete (rangoPeriodos as { OR?: unknown }).OR

    const where: Prisma.liquidacion_servicioWhereInput = {
      deleted_at: null,
      confirmada_at: { not: null },
      estado: { in: estados },
      ...(mes ? { mes } : {}),
      ...(anio ? { anio } : {}),
      ...(cliente ? { cliente: { OR: [{ nombre: contiene(cliente) }, { nit: contiene(cliente) }] } } : {}),
      ...(operadora ? { operadora: contiene(operadora) } : {}),
      ...rangoPeriodos,
    }

    const sumas = { valor_servicios: true, valor_recargos: true, valor_pernoctes: true, subtotal: true, valor_iva: true, total: true } as const
    const n = (v: unknown) => Math.round(Number(v ?? 0) * 100) / 100
    const totales = (g: { _count: { _all: number }; _sum: Record<string, unknown> }) => ({
      liquidaciones: g._count._all,
      valor_servicios: n(g._sum.valor_servicios),
      valor_recargos: n(g._sum.valor_recargos),
      valor_pernoctes: n(g._sum.valor_pernoctes),
      subtotal: n(g._sum.subtotal),
      valor_iva: n(g._sum.valor_iva),
      total: n(g._sum.total),
    })

    const general = await prisma.liquidacion_servicio.aggregate({ where, _count: { _all: true }, _sum: sumas })
    let grupos: unknown[] = []
    if (agrupar === 'estado') {
      const g = await prisma.liquidacion_servicio.groupBy({ by: ['estado'], where, _count: { _all: true }, _sum: sumas })
      grupos = g.map((x) => ({ estado: x.estado.toLowerCase(), ...totales(x) })).sort((a, b) => b.total - a.total)
    } else if (agrupar === 'periodo') {
      const g = await prisma.liquidacion_servicio.groupBy({ by: ['anio', 'mes'], where, _count: { _all: true }, _sum: sumas, orderBy: [{ anio: 'desc' }, { mes: 'desc' }] })
      grupos = g.map((x) => ({ periodo: `${x.mes}/${x.anio}`, ...totales(x) }))
    } else if (agrupar === 'operadora') {
      const g = await prisma.liquidacion_servicio.groupBy({ by: ['operadora'], where, _count: { _all: true }, _sum: sumas })
      grupos = g.map((x) => ({ operadora: x.operadora ?? 'sin operadora', ...totales(x) })).sort((a, b) => b.total - a.total)
    } else if (agrupar === 'cliente') {
      const g = await prisma.liquidacion_servicio.groupBy({ by: ['cliente_id'], where, _count: { _all: true }, _sum: sumas })
      const clientes = await prisma.clientes.findMany({ where: { id: { in: g.map((x) => x.cliente_id) } }, select: { id: true, nombre: true, nit: true } })
      const nombre = new Map(clientes.map((c) => [c.id, c]))
      grupos = g.map((x) => ({ cliente: nombre.get(x.cliente_id)?.nombre ?? '?', nit: nombre.get(x.cliente_id)?.nit, ...totales(x) })).sort((a, b) => b.total - a.total)
    }

    return {
      filtros: {
        cliente: cliente ?? 'todos',
        estados: estados.map((e) => e.toLowerCase()),
        periodo: mes || anio ? `${mes ?? '*'}/${anio ?? '*'}` : d || h ? `${args.desde_mes ?? '…'} a ${args.hasta_mes ?? '…'}` : 'histórico completo',
        operadora,
      },
      totales: totales(general as never),
      ...(agrupar !== 'ninguno' ? { agrupado_por: agrupar, grupos } : {}),
      enlace: '/dashboard/liquidaciones-servicios',
    }
  },
}

export const buscarLiquidaciones: Herramienta = {
  nombre: 'buscar_liquidaciones',
  descripcion:
    'Lista liquidaciones de servicios por consecutivo, cliente, placa, número de factura, texto del RECORRIDO de sus ítems (p. ej. «campechana», «yopal»), periodo (mes/año) o estado(s). Devuelve cabecera, totales y la factura activa de cada una; para ver ítems, recorridos, recargos, terceros, facturas e historial de una, usa detalle_liquidacion. Para TOTALES (cuánto falta facturar, cuánto se liquidó por cliente o por mes, cuántas hay por estado) usa resumen_liquidaciones, que suma sobre todas sin tope. Para cuánto se cobra o se paga al tercero por un recorrido usa tarifas_recorrido, no esta.',
  parametros: {
    type: 'object',
    properties: {
      texto: { type: 'string', description: 'Consecutivo (p. ej. IDE-058), nombre o NIT del cliente, placa, OSI, operadora o parte del recorrido de un ítem (lugar, pozo, municipio)' },
      cliente: { type: 'string', description: 'Nombre del cliente, si se quiere filtrar solo por él' },
      mes: { type: 'integer', minimum: 1, maximum: 12 },
      anio: { type: 'integer', minimum: 2020, maximum: 2100 },
      estado: { type: 'string', enum: [...ESTADOS] },
      factura: { type: 'string', description: 'Número de factura, para ver qué liquidaciones agrupa' },
      estados: { type: 'array', items: { type: 'string', enum: [...ESTADOS] }, description: 'Varios estados a la vez, p. ej. ["BORRADOR","LIQUIDADA","APROBADA"] = pendientes de facturar' },
      limite: { type: 'integer', minimum: 1, maximum: LIMITE_MAXIMO, description: 'Hasta 500. Si el usuario quiere TODAS, pide el total que devolvió la búsqueda anterior' },
    },
    additionalProperties: false,
  },
  etiqueta: 'Buscando liquidaciones',
  requiere: MODULO,
  async ejecutar(args) {
    const texto = textoOpcional(args.texto, 80)
    const cliente = textoOpcional(args.cliente, 120)
    const mes = enteroOpcional(args.mes, 1, 12)
    const anio = enteroOpcional(args.anio, 2020, 2100)
    const estado = typeof args.estado === 'string' && (ESTADOS as readonly string[]).includes(args.estado) ? args.estado : undefined
    const estados = estadosDe(args.estados)
    const factura = textoOpcional(args.factura, 50)
    const limite = enteroEntre(args.limite, 1, LIMITE_MAXIMO, LIMITE_POR_DEFECTO)

    const contiene = (q: string) => ({ contains: q.replace(/^#+/, '').trim(), mode: 'insensitive' as const })
    const where = {
      deleted_at: null,
      confirmada_at: { not: null },
      ...(estados.length ? { estado: { in: estados } } : estado ? { estado: estado as (typeof ESTADOS)[number] } : {}),
      ...(mes ? { mes } : {}),
      ...(anio ? { anio } : {}),
      ...(cliente ? { cliente: { nombre: contiene(cliente) } } : {}),
      ...(factura ? { factura_items: { some: { deleted_at: null, factura: { numero_factura: contiene(factura), deleted_at: null } } } } : {}),
      ...(texto
        ? {
            OR: [
              ...variantesConsecutivo(texto).map((v) => ({ consecutivo: contiene(v) })),
              { cliente: { nombre: contiene(texto) } },
              { cliente: { nit: contiene(texto) } },
              { osi: contiene(texto) },
              { operadora: contiene(texto) },
              { items: { some: { deleted_at: null, placa: contiene(texto) } } },
              { items: { some: { deleted_at: null, numero_planilla: contiene(texto) } } },
              { items: { some: { deleted_at: null, recorrido: contiene(texto) } } },
              { terceros_items: { some: { deleted_at: null, recorrido: contiene(texto) } } },
              { factura_items: { some: { deleted_at: null, factura: { numero_factura: contiene(texto) } } } },
            ],
          }
        : {}),
    }

    const [filas, total] = await Promise.all([
      prisma.liquidacion_servicio.findMany({
        where,
        select: {
          id: true,
          consecutivo: true,
          estado: true,
          mes: true,
          anio: true,
          total: true,
          valor_servicios: true,
          valor_recargos: true,
          osi: true,
          operadora: true,
          fecha_liquidacion: true,
          tercero_liquidado: true,
          cliente: { select: { nombre: true } },
          creado_por: { select: { nombre: true } },
          _count: { select: { items: { where: { deleted_at: null } } } },
          factura_items: { where: { deleted_at: null, factura: { deleted_at: null } }, select: { factura: { select: { numero_factura: true, estado: true } } } },
        },
        orderBy: [{ anio: 'desc' }, { mes: 'desc' }, { consecutivo: 'desc' }],
        take: limite,
      }),
      prisma.liquidacion_servicio.count({ where }),
    ])

    return {
      total,
      mostradas: filas.length,
      liquidaciones: filas.map((l) => ({
        consecutivo: l.consecutivo,
        cliente: l.cliente.nombre,
        periodo: `${l.mes}/${l.anio}`,
        estado: l.estado.toLowerCase(),
        total: Number(l.total),
        valor_servicios: Number(l.valor_servicios),
        valor_recargos: Number(l.valor_recargos),
        items: l._count.items,
        osi: l.osi,
        operadora: l.operadora,
        con_terceros: l.tercero_liquidado,
        factura: l.factura_items.find((f) => f.factura.estado === 'ACTIVA')?.factura.numero_factura ?? null,
        facturas_anuladas: l.factura_items.filter((f) => f.factura.estado !== 'ACTIVA').map((f) => f.factura.numero_factura),
        fecha: fechaCorta(l.fecha_liquidacion),
        creada_por: l.creado_por?.nombre,
        ...enlaces(l.id),
      })),
    }
  },
}

export const detalleLiquidacion: Herramienta = {
  nombre: 'detalle_liquidacion',
  descripcion:
    'Trae una liquidación de servicios COMPLETA por su consecutivo, id o enlace: cabecera y totales, cada ítem (placa, fechas, recorrido, tipo de servicio, cantidad, valor, descuento, recargos y pernoctes del ítem, planilla y enlace al servicio), las filas de recargos, los terceros (propietarios) con sus valores, las facturas que la incluyen (número, fecha, estado), quién la creó, liquidó y aprobó, y el historial de cambios de estado. Úsala para cualquier pregunta sobre una liquidación concreta y antes de duplicarla.',
  parametros: {
    type: 'object',
    properties: {
      liquidacion: { type: 'string', description: 'Consecutivo (p. ej. IDE-058), id o enlace de la liquidación' },
      consecutivo: { type: 'string', description: 'Alias de liquidacion' },
    },
    additionalProperties: false,
  },
  etiqueta: 'Abriendo la liquidación',
  requiere: MODULO,
  salidaMaxima: { lista: 80, caracteres: 45000 },
  async ejecutar(args) {
    const consecutivo = textoOpcional(args.liquidacion, 300) ?? textoOpcional(args.consecutivo, 300)
    if (!consecutivo) return { error: 'Falta el consecutivo' }
    const l = await cargarPorConsecutivo(consecutivo)
    if (!l) return { error: `No existe la liquidación «${consecutivo}»` }
    return describir(l)
  },
}

export const duplicarLiquidacion: Herramienta = {
  nombre: 'duplicar_liquidacion',
  descripcion:
    'Crea EN BORRADOR una liquidación de servicios copiando otra: mismo cliente, periodo, ítems con sus valores, IVA, pernoctes, OSI, operadora, observaciones, recargos y terceros (estos últimos solo si el usuario tiene permiso de liquidaciones de terceros). El consecutivo nuevo lo da el usuario; si solo da el número (059) se usa el prefijo de la original (IDE-059). Se pueden cambiar mes, año, observaciones y OSI; todo lo demás se copia igual. Antes de llamarla muestra con detalle_liquidacion qué se copiará, resume y pregunta «¿La creo así?»; pasa confirmado=true solo cuando el usuario diga que sí. La copia nace en borrador siempre: liquidarla, aprobarla o facturarla se hace en la pantalla.',
  parametros: {
    type: 'object',
    properties: {
      confirmado: { type: 'boolean', description: 'true SOLO después de que el usuario confirmó el resumen' },
      consecutivo_origen: { type: 'string', description: 'Consecutivo de la liquidación a copiar, p. ej. IDE-058' },
      consecutivo_nuevo: { type: 'string', description: 'Consecutivo de la copia: completo (IDE-059) o solo el número (059)' },
      mes: { type: 'integer', minimum: 1, maximum: 12, description: 'Solo si el usuario pidió cambiar el mes' },
      anio: { type: 'integer', minimum: 2020, maximum: 2100, description: 'Solo si el usuario pidió cambiar el año' },
      observaciones: { type: 'string', description: 'Solo si el usuario pidió otras observaciones' },
      osi: { type: 'string', description: 'Solo si el usuario pidió otra OSI' },
    },
    required: ['confirmado', 'consecutivo_origen', 'consecutivo_nuevo'],
    additionalProperties: false,
  },
  etiqueta: 'Creando la liquidación en borrador',
  requiere: MODULO,
  nivel: 'full',
  escribe: true,
  async ejecutar(args, usuario) {
    if (args.confirmado !== true) {
      return { error: 'Falta la confirmación del usuario: muéstrale qué se va a copiar y pregúntale si la creas' }
    }
    const origenTexto = textoOpcional(args.consecutivo_origen, 50)
    const nuevoTexto = textoOpcional(args.consecutivo_nuevo, 50)
    if (!origenTexto || !nuevoTexto) return { error: 'Faltan el consecutivo de origen o el nuevo' }

    const origen = await cargarPorConsecutivo(origenTexto)
    if (!origen) return { creado: false, error: `No existe la liquidación «${origenTexto}»` }
    if (origen.items.length === 0) return { creado: false, error: `La liquidación ${origen.consecutivo} no tiene ítems que copiar` }

    const consecutivo = consecutivoNuevo(origen.consecutivo, nuevoTexto)
    const ocupado = await prisma.liquidacion_servicio.findFirst({
      where: { consecutivo: { equals: consecutivo, mode: 'insensitive' }, deleted_at: null },
      select: { id: true, estado: true },
    })
    if (ocupado) {
      return {
        creado: false,
        error: `Ya existe una liquidación con el consecutivo ${consecutivo} (estado ${ocupado.estado.toLowerCase()})`,
        pista: 'Pregunta al usuario qué consecutivo usar',
      }
    }

    const mes = enteroOpcional(args.mes, 1, 12) ?? origen.mes
    const anio = enteroOpcional(args.anio, 2020, 2100) ?? origen.anio
    const puedeTerceros = usuario.modulos.get(MODULO_TERCEROS) === 'full'
    const tieneTerceros = origen.terceros_items.length > 0 || hayTerceroRows(origen.recargos_data)
    const copiarTerceros = puedeTerceros && tieneTerceros

    const recargosData = clonarRecargos(origen.recargos_data, copiarTerceros)

    const data = {
      cliente_id: origen.cliente_id,
      consecutivo,
      mes,
      anio,
      items: origen.items.map((i) => ({
        placa: i.placa,
        fecha_inicial: soloFecha(i.fecha_inicial),
        fecha_final: soloFecha(i.fecha_final),
        recorrido: i.recorrido,
        tipo_servicio: i.tipo_servicio,
        cantidad: Number(i.cantidad),
        valor_unitario: Number(i.valor_unitario),
        porcentaje_descuento: Number(i.porcentaje_descuento),
        numero_planilla: i.numero_planilla ?? undefined,
        cantidad_pernoctes: i.cantidad_pernoctes,
        valor_pernocte_unitario: Number(i.valor_pernocte_unitario),
        tercero_id: copiarTerceros ? i.tercero_id : null,
      })),
      porcentaje_iva: Number(origen.porcentaje_iva),
      observaciones: textoOpcional(args.observaciones, 2000) ?? origen.observaciones ?? undefined,
      osi: textoOpcional(args.osi, 100) ?? origen.osi ?? undefined,
      operadora: origen.operadora ?? undefined,
      operadora_id: origen.operadora_id ?? undefined,
      valor_transporte_adicional: Number(origen.valor_transporte_adicional),
      valor_recargos: Number(origen.valor_recargos),
      valor_pernoctes: Number(origen.valor_pernoctes),
      valor_unitario_pernoctes: Number(origen.valor_unitario_pernoctes),
      cantidad_pernoctes: origen.cantidad_pernoctes,
      recargos_data: recargosData,
      terceros_items: copiarTerceros
        ? origen.terceros_items.map((t, i) => ({
            tercero_id: t.tercero_id,
            placa: t.placa,
            recorrido: t.recorrido,
            fechas: t.fechas,
            valor_unitario: Number(t.valor_unitario),
            cantidad: Number(t.cantidad),
            porcentaje_admin: Number(t.porcentaje_admin),
            ingreso_extra_global: Number(t.ingreso_extra_global),
            ingresos_extra_aval: Number(t.ingresos_extra_aval),
            ingreso_empresa: Number(t.ingreso_empresa),
            src_index: t.src_index ?? i,
          }))
        : [],
    }

    // Mismo servicio que el POST de «Registrar»: nace en BORRADOR, con
    // snapshot de historial, y se avisa por socket y notificación igual.
    const creada = await LiquidacionesServiciosService.crear(data as never, usuario.id)
    emitLiquidacionServicio(
      'liquidacion-servicio-created',
      creada,
      eventoMeta({
        tipo: 'created',
        scope: 'liquidaciones',
        actor: { id: usuario.id, nombre: usuario.nombre },
        etiqueta: creada.consecutivo,
      }),
    )
    await notificarLiquidacionCreada(creada, usuario.id, usuario.nombre)

    const advertencias: string[] = []
    if (tieneTerceros && !puedeTerceros) {
      advertencias.push(
        'La original tiene liquidación de terceros, pero el usuario no tiene permiso de liquidaciones de terceros: la copia salió SIN terceros',
      )
    }
    if (mes !== origen.mes || anio !== origen.anio) {
      advertencias.push('Las fechas de los ítems se copiaron tal cual; si cambió el periodo, hay que ajustarlas en el editor')
    }

    return {
      creado: true,
      liquidacion: {
        consecutivo: creada.consecutivo,
        estado: 'borrador',
        cliente: creada.cliente?.nombre,
        periodo: `${mes}/${anio}`,
        items: creada.items.length,
        valor_servicios: Number(creada.valor_servicios),
        valor_recargos: Number(creada.valor_recargos),
        subtotal: Number(creada.subtotal),
        iva: Number(creada.valor_iva),
        total: Number(creada.total),
        terceros_copiados: copiarTerceros ? data.terceros_items.length : 0,
        copiada_de: origen.consecutivo,
        ...enlaces(creada.id),
      },
      advertencias,
      pendiente: 'Queda en borrador: revisarla y liquidarla se hace desde el editor',
    }
  },
}

/**
 * «¿Cuánto se cobra y cuánto se le paga al tercero por Yopal–Campechana?». Responde desde los
 * ítems liquidados que contienen ese recorrido, con lo cobrado al cliente y, cruzado por ítem,
 * la fila del tercero (base, % de administración y lo que se le liquida).
 *
 * Antes no había cómo: el modelo buscaba servicios, tomaba «la liquidación más reciente del
 * cliente» aunque fuera de otra ruta y daba totales de liquidaciones completas como si fueran la
 * tarifa del tramo. Aquí cada fila es un ítem y el resumen agrupa por tramo, porque «Campechana»
 * aparece en rutas con tarifas distintas (desde Yopal o desde Paz de Ariporo).
 */
export const tarifasRecorrido: Herramienta = {
  nombre: 'tarifas_recorrido',
  descripcion:
    'Tarifas de un RECORRIDO según las liquidaciones de servicios: cuánto se cobró al cliente por ítem y cuánto se le pagó al tercero (propietario) por ese mismo ítem, con el % de administración y el margen de la empresa. Busca en el recorrido de los ítems (todas las palabras deben aparecer, sin importar tildes ni el orden de los puntos). Devuelve un resumen por tramo (valor más frecuente, mínimo, máximo y el último cobrado y pagado) y las filas más recientes con su liquidación. Úsala para «¿cuánto se cobra / se paga por X?», «¿cuál es la tarifa de A a B?», «¿qué liquidaciones tienen el recorrido X?». Filtra por cliente, placa o fechas si el usuario los da.',
  parametros: {
    type: 'object',
    properties: {
      recorrido: { type: 'string', description: 'Lugar o tramo tal como lo dice el usuario: «campechana», «yopal campechana», «paz de ariporo - pozo campechana»' },
      cliente: { type: 'string', description: 'Nombre o NIT del cliente (parcial)' },
      placa: { type: 'string' },
      desde: { type: 'string', description: 'Fecha del ítem desde, YYYY-MM-DD' },
      hasta: { type: 'string', description: 'Fecha del ítem hasta, YYYY-MM-DD incluida' },
      incluir_anuladas: { type: 'boolean' },
      limite: { type: 'integer', minimum: 1, maximum: 200, description: 'Filas de detalle (por defecto 30). El resumen por tramo usa todas las coincidencias' },
    },
    required: ['recorrido'],
    additionalProperties: false,
  },
  etiqueta: 'Consultando tarifas del recorrido',
  requiere: MODULO,
  salidaMaxima: { lista: 200, caracteres: 45000 },
  async ejecutar(args, usuario) {
    const recorrido = textoOpcional(args.recorrido, 200)
    if (!recorrido) return { error: 'Falta el recorrido' }
    const cliente = textoOpcional(args.cliente, 120)
    const placa = textoOpcional(args.placa, 20)
    const desde = typeof args.desde === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args.desde) ? args.desde : undefined
    const hasta = typeof args.hasta === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args.hasta) ? args.hasta : undefined
    const limite = enteroEntre(args.limite, 1, 200, 30)
    /// Lo que se paga a los propietarios es del módulo de terceros: sin él, solo lo cobrado.
    const verTerceros = usuario.modulos.has(MODULO_TERCEROS)

    const palabras = [...new Set(sinTildes(recorrido).split(/[\s\-–—,/()]+/).filter((p) => p.length >= 3))]
    if (!palabras.length) return { error: 'Escribe al menos un lugar del recorrido (3 letras o más)' }
    const contiene = (q: string) => ({ contains: q, mode: 'insensitive' as const })

    const where: Prisma.liquidacion_servicio_itemWhereInput = {
      deleted_at: null,
      AND: palabras.map((p) => ({ recorrido: contiene(p) })),
      ...(placa ? { placa: contiene(placa.toUpperCase()) } : {}),
      ...(desde || hasta ? { fecha_inicial: { ...(desde ? { gte: new Date(`${desde}T00:00:00Z`) } : {}), ...(hasta ? { lte: new Date(`${hasta}T00:00:00Z`) } : {}) } } : {}),
      liquidacion: {
        deleted_at: null,
        confirmada_at: { not: null },
        ...(args.incluir_anuladas === true ? {} : { estado: { not: 'ANULADA' } }),
        ...(cliente ? { cliente: { OR: [{ nombre: contiene(cliente) }, { nit: contiene(cliente) }] } } : {}),
      },
    }

    const [items, total] = await Promise.all([
      prisma.liquidacion_servicio_item.findMany({
        where,
        select: {
          id: true,
          liquidacion_id: true,
          placa: true,
          fecha_inicial: true,
          recorrido: true,
          tipo_servicio: true,
          cantidad: true,
          valor_unitario: true,
          valor_final: true,
          liquidacion: { select: { id: true, consecutivo: true, estado: true, cliente: { select: { nombre: true } } } },
        },
        orderBy: [{ fecha_inicial: 'desc' }],
        take: 500,
      }),
      prisma.liquidacion_servicio_item.count({ where }),
    ])

    // Fila del tercero de cada ítem: por `item_id`; las viejas no lo tienen y se cruzan por
    // liquidación, placa y recorrido.
    const terceros = verTerceros && items.length
      ? await prisma.liquidacion_tercero.findMany({
          where: { deleted_at: null, liquidacion_id: { in: [...new Set(items.map((i) => i.liquidacion_id))] } },
          select: { item_id: true, liquidacion_id: true, placa: true, recorrido: true, valor_unitario: true, cantidad: true, porcentaje_admin: true, valor_liquidar: true, tercero: { select: { nombre_completo: true } } },
        })
      : []
    const porItem = new Map(terceros.filter((t) => t.item_id).map((t) => [t.item_id!, t]))
    const llave = (liq: string, placaT: string, rec: string) => `${liq}|${placaT.toUpperCase()}|${sinTildes(rec).replace(/\s+/g, ' ').trim()}`
    const porLlave = new Map(terceros.map((t) => [llave(t.liquidacion_id, t.placa, t.recorrido), t]))

    const n = (v: unknown) => Math.round(Number(v ?? 0) * 100) / 100
    const filas = items.map((i) => {
      const t = porItem.get(i.id) ?? porLlave.get(llave(i.liquidacion_id, i.placa, i.recorrido))
      const cantidad = Number(i.cantidad) || 1
      const cobradoUnitario = n(i.valor_unitario)
      const pagadoUnitario = t ? n(Number(t.valor_liquidar) / (Number(t.cantidad) || 1)) : undefined
      return {
        tramo: tramoDe(i.recorrido),
        fila: {
          fecha: soloFecha(i.fecha_inicial),
          liquidacion: i.liquidacion.consecutivo,
          estado: i.liquidacion.estado.toLowerCase(),
          cliente: i.liquidacion.cliente.nombre,
          placa: i.placa,
          recorrido: i.recorrido,
          tipo: etiquetaTipo(String(i.tipo_servicio)),
          cantidad,
          cobrado_cliente_unitario: cobradoUnitario,
          cobrado_cliente_total: n(i.valor_final),
          ...(verTerceros
            ? t
              ? {
                  tercero: t.tercero?.nombre_completo ?? undefined,
                  base_tercero_unitaria: n(t.valor_unitario),
                  porcentaje_admin: n(t.porcentaje_admin),
                  pagado_tercero_unitario: pagadoUnitario,
                  pagado_tercero_total: n(t.valor_liquidar),
                  margen_empresa_unitario: pagadoUnitario !== undefined ? n(cobradoUnitario - pagadoUnitario) : undefined,
                }
              : { tercero: 'sin fila de tercero (vehículo propio o no se liquidó a tercero)' }
            : {}),
          enlace: enlaces(i.liquidacion.id).enlace,
        },
      }
    })

    // Resumen por tramo: «Campechana» sale en rutas con tarifas distintas.
    const grupos = new Map<string, typeof filas>()
    for (const f of filas) grupos.set(f.tramo, [...(grupos.get(f.tramo) ?? []), f])
    const tramos = [...grupos.entries()]
      .map(([tramo, gs]) => {
        const cobrados = gs.map((g) => g.fila.cobrado_cliente_unitario)
        const pagados = gs.map((g) => (g.fila as { pagado_tercero_unitario?: number }).pagado_tercero_unitario).filter((v): v is number => v !== undefined)
        return {
          tramo,
          items: gs.length,
          recorridos_escritos: [...new Set(gs.map((g) => g.fila.recorrido))].slice(0, 5),
          cobrado_cliente_unitario: estadistica(cobrados),
          ...(verTerceros ? { pagado_tercero_unitario: pagados.length ? estadistica(pagados) : 'sin filas de tercero' } : {}),
          ultima: { fecha: gs[0].fila.fecha, liquidacion: gs[0].fila.liquidacion },
        }
      })
      .sort((a, b) => b.items - a.items)

    return {
      buscado: palabras.join(' + '),
      coincidencias: total,
      ...(total > items.length ? { nota: `El resumen usa los ${items.length} ítems más recientes de ${total}` } : {}),
      ...(verTerceros ? {} : { terceros: 'El usuario no tiene acceso a liquidaciones de terceros: solo se muestra lo cobrado al cliente' }),
      como_leer: 'cobrado_cliente = valor del ítem en la liquidación (lo que paga el cliente). base_tercero = lo que factura el propietario; pagado_tercero = base menos el % de administración (lo que se le liquida). margen_empresa = cobrado − pagado.',
      tramos,
      filas: filas.slice(0, limite).map((f) => f.fila),
    }
  },
}

/** Tramo comparable: sin tildes, paréntesis ni «POZO», con los puntos ordenados (ida y vuelta valen igual). */
function tramoDe(recorrido: string): string {
  const puntos = sinTildes(recorrido)
    .replace(/\([^)]*\)?/g, ' ')
    .split(/\s*-\s*/)
    .map((p) => p.replace(/\bPOZO\b/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  return [...new Set(puntos)].sort().join(' ↔ ')
}

function estadistica(valores: number[]) {
  if (!valores.length) return undefined
  const conteo = new Map<number, number>()
  for (const v of valores) conteo.set(v, (conteo.get(v) ?? 0) + 1)
  const [masFrecuente, veces] = [...conteo.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]
  return { mas_frecuente: masFrecuente, veces, minimo: Math.min(...valores), maximo: Math.max(...valores), ultimo: valores[0] }
}

/* ────────────────────────── apoyo ────────────────────────── */

/** Acepta el consecutivo («IDE-058»), el id o un enlace /dashboard/liquidaciones-servicios/<id>. */
async function cargarPorConsecutivo(texto: string) {
  const id = texto.match(UUID)?.[0]?.toLowerCase()
  return prisma.liquidacion_servicio.findFirst({
    where: {
      ...(id ? { id } : { OR: variantesConsecutivo(texto).map((v) => ({ consecutivo: { equals: v, mode: 'insensitive' as const } })) }),
      deleted_at: null,
      confirmada_at: { not: null },
    },
    include: {
      cliente: { select: { id: true, nombre: true, nit: true } },
      creado_por: { select: { nombre: true } },
      liquidado_por: { select: { nombre: true } },
      aprobado_por: { select: { nombre: true } },
      items: { where: { deleted_at: null }, orderBy: { orden: 'asc' }, include: { tercero: { select: { nombre_completo: true } } } },
      terceros_items: {
        where: { deleted_at: null },
        orderBy: { orden: 'asc' },
        include: { tercero: { select: { nombre_completo: true, identificacion: true } } },
      },
      factura_items: {
        where: { deleted_at: null, factura: { deleted_at: null } },
        include: { factura: { select: { numero_factura: true, estado: true, fecha_facturacion: true, valor_total: true, motivo_anulacion: true, facturado_por: { select: { nombre: true } } } } },
      },
      historial_estados: { orderBy: { created_at: 'asc' }, include: { usuario: { select: { nombre: true } } } },
    },
  })
}

type LiquidacionCargada = NonNullable<Awaited<ReturnType<typeof cargarPorConsecutivo>>>

function describir(l: LiquidacionCargada) {
  const recargos = l.recargos_data as { rows?: unknown[]; terceroRows?: unknown[] } | null
  const facturas = l.factura_items.map((fi) => ({
    numero: fi.factura.numero_factura,
    estado: fi.factura.estado.toLowerCase(),
    fecha: fechaCorta(fi.factura.fecha_facturacion),
    valor_total_factura: Number(fi.factura.valor_total),
    valor_de_esta_liquidacion: Number(fi.valor_liquidacion),
    facturada_por: fi.factura.facturado_por?.nombre,
    motivo_anulacion: fi.factura.motivo_anulacion ?? undefined,
    enlace: ENLACE_FACTURAS,
  }))
  return {
    consecutivo: l.consecutivo,
    estado: l.estado.toLowerCase(),
    cliente: l.cliente.nombre,
    nit: l.cliente.nit,
    periodo: `${l.mes}/${l.anio}`,
    fecha: fechaCorta(l.fecha_liquidacion),
    fecha_aprobacion: fechaCorta(l.fecha_aprobacion),
    fecha_facturacion: fechaCorta(l.fecha_facturacion),
    osi: l.osi,
    operadora: l.operadora,
    observaciones: l.observaciones,
    motivo_anulacion: l.motivo_anulacion ?? undefined,
    con_terceros: l.tercero_liquidado,
    creada_por: l.creado_por?.nombre,
    liquidada_por: l.liquidado_por?.nombre,
    aprobada_por: l.aprobado_por?.nombre,
    factura: facturas.find((f) => f.estado === 'activa')?.numero ?? null,
    facturas,
    totales: {
      valor_servicios: Number(l.valor_servicios),
      valor_recargos: Number(l.valor_recargos),
      valor_transporte_adicional: Number(l.valor_transporte_adicional),
      valor_administracion_ta: Number(l.valor_administracion_ta),
      valor_pernoctes: Number(l.valor_pernoctes),
      cantidad_pernoctes: l.cantidad_pernoctes,
      subtotal: Number(l.subtotal),
      porcentaje_iva: Number(l.porcentaje_iva),
      valor_iva: Number(l.valor_iva),
      total: Number(l.total),
    },
    items: l.items.map((i) => ({
      placa: i.placa,
      fecha_inicial: soloFecha(i.fecha_inicial),
      fecha_final: soloFecha(i.fecha_final),
      recorrido: i.recorrido,
      tipo: etiquetaTipo(String(i.tipo_servicio)),
      cantidad: Number(i.cantidad),
      valor_unitario: Number(i.valor_unitario),
      subtotal: Number(i.subtotal),
      descuento_pct: Number(i.porcentaje_descuento),
      valor_final: Number(i.valor_final),
      recargos: Number(i.valor_recargos_total) || undefined,
      pernoctes: i.cantidad_pernoctes || undefined,
      valor_pernoctes: Number(i.valor_pernoctes_total) || undefined,
      planilla: i.numero_planilla,
      tercero: i.tercero?.nombre_completo,
      servicio: i.servicio_id ? `/dashboard/servicios/${i.servicio_id}` : undefined,
      recargos_detalle: i.recargos_detalle ?? undefined,
    })),
    recargos: {
      filas: Array.isArray(recargos?.rows) ? recargos.rows.length : 0,
      valor_total: Number(l.valor_recargos),
      detalle: Array.isArray(recargos?.rows) ? recargos.rows : undefined,
    },
    terceros: l.terceros_items.map((t) => ({
      tercero: t.tercero?.nombre_completo ?? 'sin tercero',
      identificacion: t.tercero?.identificacion ?? undefined,
      placa: t.placa,
      recorrido: t.recorrido,
      fechas: t.fechas,
      valor_unitario: Number(t.valor_unitario),
      cantidad: Number(t.cantidad),
      total_facturado: Number(t.total_facturado),
      porcentaje_admin: Number(t.porcentaje_admin),
      valor_admin: Number(t.valor_admin),
      valor_liquidar: Number(t.valor_liquidar),
      ingreso_empresa: Number(t.ingreso_empresa),
      estado: String(t.estado).toLowerCase(),
    })),
    historial: l.historial_estados.map((h) => ({
      fecha: h.created_at.toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'short', timeStyle: 'short' }),
      de: h.estado_anterior?.toLowerCase() ?? undefined,
      a: h.estado_nuevo.toLowerCase(),
      accion: h.accion ?? undefined,
      por: h.usuario.nombre,
      motivo: h.motivo ?? undefined,
    })),
    ...enlaces(l.id),
  }
}

export const buscarFacturas: Herramienta = {
  nombre: 'buscar_facturas',
  descripcion:
    'Busca facturas de liquidaciones de servicios por número, estado (activa o anulada), cliente o fecha de facturación. Devuelve por factura: número, fecha, estado, valor total, quién la emitió o anuló, observaciones y las liquidaciones que agrupa (consecutivo, cliente, periodo, valor). Para saber qué factura tiene una liquidación concreta basta detalle_liquidacion.',
  parametros: {
    type: 'object',
    properties: {
      texto: { type: 'string', description: 'Número de factura, consecutivo de liquidación o nombre del cliente' },
      estado: { type: 'string', enum: ['ACTIVA', 'ANULADA'] },
      desde: { type: 'string', description: 'Fecha de facturación desde, YYYY-MM-DD' },
      hasta: { type: 'string', description: 'Hasta, YYYY-MM-DD incluida' },
      limite: { type: 'integer', minimum: 1, maximum: LIMITE_MAXIMO },
    },
    additionalProperties: false,
  },
  etiqueta: 'Buscando facturas',
  requiere: MODULO,
  async ejecutar(args) {
    const texto = textoOpcional(args.texto, 80)
    const estado = args.estado === 'ACTIVA' || args.estado === 'ANULADA' ? args.estado : undefined
    const desde = typeof args.desde === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args.desde) ? args.desde : undefined
    const hasta = typeof args.hasta === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args.hasta) ? args.hasta : undefined
    const limite = enteroEntre(args.limite, 1, LIMITE_MAXIMO, LIMITE_POR_DEFECTO)
    const contiene = (q: string) => ({ contains: q.replace(/^#+/, '').trim(), mode: 'insensitive' as const })
    const where: Prisma.factura_liquidacion_servicioWhereInput = {
      deleted_at: null,
      ...(estado ? { estado } : {}),
      ...(desde || hasta
        ? { fecha_facturacion: { ...(desde ? { gte: new Date(`${desde}T00:00:00-05:00`) } : {}), ...(hasta ? { lte: new Date(`${hasta}T23:59:59.999-05:00`) } : {}) } }
        : {}),
      ...(texto
        ? {
            OR: [
              { numero_factura: contiene(texto) },
              { items: { some: { deleted_at: null, liquidacion: { OR: [{ consecutivo: contiene(texto) }, { cliente: { nombre: contiene(texto) } }, { cliente: { nit: contiene(texto) } }] } } } },
            ],
          }
        : {}),
    }
    const [filas, total] = await Promise.all([
      prisma.factura_liquidacion_servicio.findMany({
        where,
        include: {
          facturado_por: { select: { nombre: true } },
          anulado_por: { select: { nombre: true } },
          items: {
            where: { deleted_at: null },
            include: { liquidacion: { select: { id: true, consecutivo: true, mes: true, anio: true, estado: true, total: true, cliente: { select: { nombre: true } } } } },
          },
        },
        orderBy: { fecha_facturacion: 'desc' },
        take: limite,
      }),
      prisma.factura_liquidacion_servicio.count({ where }),
    ])
    return {
      total,
      mostradas: filas.length,
      facturas: filas.map((f) => ({
        numero: f.numero_factura,
        fecha: fechaCorta(f.fecha_facturacion),
        estado: f.estado.toLowerCase(),
        valor_total: Number(f.valor_total),
        facturada_por: f.facturado_por.nombre,
        observaciones: f.observaciones ?? undefined,
        anulada: f.estado === 'ANULADA' ? { fecha: fechaCorta(f.fecha_anulacion), por: f.anulado_por?.nombre, motivo: f.motivo_anulacion } : undefined,
        clientes: [...new Set(f.items.map((i) => i.liquidacion.cliente.nombre))],
        liquidaciones: f.items.map((i) => ({
          consecutivo: i.liquidacion.consecutivo,
          cliente: i.liquidacion.cliente.nombre,
          periodo: `${i.liquidacion.mes}/${i.liquidacion.anio}`,
          estado: i.liquidacion.estado.toLowerCase(),
          valor: Number(i.valor_liquidacion),
          ...enlaces(i.liquidacion.id),
        })),
        enlace: ENLACE_FACTURAS,
      })),
    }
  },
}

/** «059» con origen «IDE-058» → «IDE-059»; «IDE-059» o «FS-3380» se respetan. */
function consecutivoNuevo(origen: string, pedido: string): string {
  const limpio = pedido.trim().toUpperCase()
  if (!/^[0-9.]+$/.test(limpio)) return limpio
  const sep = origen.lastIndexOf('-')
  if (sep < 0) return limpio
  return `${origen.slice(0, sep + 1)}${limpio}`
}

function hayTerceroRows(recargos: unknown): boolean {
  const r = recargos as { terceroRows?: unknown } | null
  return Array.isArray(r?.terceroRows) && r.terceroRows.length > 0
}

/** Copia profunda de `recargos_data`; sin permiso de terceros, sin `terceroRows`. */
function clonarRecargos(recargos: unknown, conTerceros: boolean): unknown {
  if (!recargos || typeof recargos !== 'object') return recargos ?? undefined
  const copia = JSON.parse(JSON.stringify(recargos)) as Record<string, unknown>
  if (!conTerceros) copia.terceroRows = []
  return copia
}

export const HERRAMIENTAS_LIQUIDACIONES: readonly Herramienta[] = [buscarLiquidaciones, resumenLiquidaciones, detalleLiquidacion, tarifasRecorrido, buscarFacturas]
export const ACCIONES_LIQUIDACIONES: readonly Herramienta[] = [duplicarLiquidacion]
