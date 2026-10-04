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
const LIMITE_MAXIMO = 25

const ESTADOS = ['BORRADOR', 'LIQUIDADA', 'APROBADA', 'FACTURADA', 'ANULADA'] as const

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

export const buscarLiquidaciones: Herramienta = {
  nombre: 'buscar_liquidaciones',
  descripcion:
    'Busca liquidaciones de servicios por consecutivo, cliente, placa, periodo (mes/año) o estado. Devuelve cabecera y totales; para ver los ítems y recargos de una, usa detalle_liquidacion.',
  parametros: {
    type: 'object',
    properties: {
      texto: { type: 'string', description: 'Consecutivo (p. ej. IDE-058), nombre o NIT del cliente, placa, OSI u operadora' },
      cliente: { type: 'string', description: 'Nombre del cliente, si se quiere filtrar solo por él' },
      mes: { type: 'integer', minimum: 1, maximum: 12 },
      anio: { type: 'integer', minimum: 2020, maximum: 2100 },
      estado: { type: 'string', enum: [...ESTADOS] },
      limite: { type: 'integer', minimum: 1, maximum: LIMITE_MAXIMO },
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
    const limite = enteroEntre(args.limite, 1, LIMITE_MAXIMO, LIMITE_POR_DEFECTO)

    const contiene = (q: string) => ({ contains: q.replace(/^#+/, '').trim(), mode: 'insensitive' as const })
    const where = {
      deleted_at: null,
      confirmada_at: { not: null },
      ...(estado ? { estado: estado as (typeof ESTADOS)[number] } : {}),
      ...(mes ? { mes } : {}),
      ...(anio ? { anio } : {}),
      ...(cliente ? { cliente: { nombre: contiene(cliente) } } : {}),
      ...(texto
        ? {
            OR: [
              { consecutivo: contiene(texto) },
              { cliente: { nombre: contiene(texto) } },
              { cliente: { nit: contiene(texto) } },
              { osi: contiene(texto) },
              { operadora: contiene(texto) },
              { items: { some: { deleted_at: null, placa: contiene(texto) } } },
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
    'Trae una liquidación de servicios completa por su consecutivo: cabecera, cada ítem (placa, fechas, recorrido, tipo, cantidad, valor), recargos y terceros. Úsala antes de duplicar una, para mostrarle al usuario qué se va a copiar.',
  parametros: {
    type: 'object',
    properties: { consecutivo: { type: 'string', description: 'Consecutivo exacto, p. ej. IDE-058' } },
    required: ['consecutivo'],
    additionalProperties: false,
  },
  etiqueta: 'Abriendo la liquidación',
  requiere: MODULO,
  async ejecutar(args) {
    const consecutivo = textoOpcional(args.consecutivo, 50)
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
  canales: ['app'],
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

/* ────────────────────────── apoyo ────────────────────────── */

async function cargarPorConsecutivo(consecutivo: string) {
  return prisma.liquidacion_servicio.findFirst({
    where: { consecutivo: { equals: consecutivo.trim(), mode: 'insensitive' }, deleted_at: null, confirmada_at: { not: null } },
    include: {
      cliente: { select: { id: true, nombre: true, nit: true } },
      creado_por: { select: { nombre: true } },
      liquidado_por: { select: { nombre: true } },
      items: { where: { deleted_at: null }, orderBy: { orden: 'asc' } },
      terceros_items: {
        where: { deleted_at: null },
        orderBy: { orden: 'asc' },
        include: { tercero: { select: { nombre_completo: true } } },
      },
    },
  })
}

type LiquidacionCargada = NonNullable<Awaited<ReturnType<typeof cargarPorConsecutivo>>>

function describir(l: LiquidacionCargada) {
  const recargos = l.recargos_data as { rows?: unknown[]; terceroRows?: unknown[] } | null
  return {
    consecutivo: l.consecutivo,
    estado: l.estado.toLowerCase(),
    cliente: l.cliente.nombre,
    nit: l.cliente.nit,
    periodo: `${l.mes}/${l.anio}`,
    fecha: fechaCorta(l.fecha_liquidacion),
    osi: l.osi,
    operadora: l.operadora,
    observaciones: l.observaciones,
    creada_por: l.creado_por?.nombre,
    liquidada_por: l.liquidado_por?.nombre,
    totales: {
      valor_servicios: Number(l.valor_servicios),
      valor_recargos: Number(l.valor_recargos),
      valor_transporte_adicional: Number(l.valor_transporte_adicional),
      valor_pernoctes: Number(l.valor_pernoctes),
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
      descuento_pct: Number(i.porcentaje_descuento),
      valor_final: Number(i.valor_final),
      planilla: i.numero_planilla,
    })),
    recargos: {
      filas: Array.isArray(recargos?.rows) ? recargos.rows.length : 0,
      valor_total: Number(l.valor_recargos),
    },
    terceros: l.terceros_items.map((t) => ({
      tercero: t.tercero?.nombre_completo ?? 'sin tercero',
      placa: t.placa,
      valor_unitario: Number(t.valor_unitario),
      cantidad: Number(t.cantidad),
      porcentaje_admin: Number(t.porcentaje_admin),
      valor_liquidar: Number(t.valor_liquidar),
    })),
    ...enlaces(l.id),
  }
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

export const HERRAMIENTAS_LIQUIDACIONES: readonly Herramienta[] = [buscarLiquidaciones, detalleLiquidacion]
export const ACCIONES_LIQUIDACIONES: readonly Herramienta[] = [duplicarLiquidacion]
