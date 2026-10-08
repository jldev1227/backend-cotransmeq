import { prisma } from '../../config/prisma'
import { personaUsuario, listarCapacitaciones } from '../conductor-portal/capacitaciones.service'
import { resumenViaticos, listarGastosEmpresa, CATEGORIAS_GASTO } from '../viaticos/viaticos-empresa.service'
import { estadoFondo } from '../viaticos/viaticos-fondo.service'
import { detalleAnticipo, listarAnticipos, listarSolicitudes } from '../viaticos/viaticos.service'
import type { Herramienta } from './asistente.types'
import { enteroEntre, fechaCorta, fechaOpcional, textoOpcional } from './asistente.utils'

/**
 * Viáticos, terceros y lo propio del usuario en el asistente (y en el MCP, que usa estas mismas
 * herramientas). Solo consultan. Cada una pide el módulo de la pantalla equivalente: viáticos
 * (administración y operaciones completo, contabilidad lectura) y terceros; las de «mis …» son de
 * cualquier usuario y solo devuelven lo suyo.
 */

const MODULO_VIATICOS = 'viaticos'
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
const enlaceAnticipo = (id: string) => `/dashboard/viaticos?anticipo=${id}`
const ENLACE_GASTOS = '/dashboard/viaticos?vista=gastos'

const CATEGORIA: Record<string, string> = {
  OFICINA: 'oficina',
  MANTENIMIENTO: 'mantenimiento de vehículo',
  CONDUCTOR: 'a un conductor',
  BANCARIO: 'bancario (4x1000, cuota de manejo)',
  OTRO: 'otro'
}
const METODO: Record<string, string> = {
  TRANSFERENCIA: 'transferencia',
  RETIRO_TARJETA: 'retiro con tarjeta',
  EFECTIVO: 'efectivo',
  DEBITO_AUTOMATICO: 'débito automático'
}

export const buscarAnticiposViaticos: Herramienta = {
  nombre: 'buscar_anticipos_viaticos',
  descripcion:
    'Lista anticipos de viáticos entregados a conductores: conductor, placa, propietario (tercero), concepto, valor, lo gastado (legalizado con facturas), el saldo y si está bajo o agotado, quién lo registró y cuándo. Filtra por texto (conductor, cédula, placa, concepto o comprobante), propietario, estado del saldo y fechas de entrega. Para ver los gastos y solicitudes de uno, detalle_anticipo_viaticos; para totales por periodo, resumen_viaticos.',
  parametros: {
    type: 'object',
    properties: {
      texto: { type: 'string', description: 'Conductor, cédula, placa, concepto o número de comprobante' },
      tercero: { type: 'string', description: 'Nombre o identificación del propietario (tercero) de la placa' },
      estado: { type: 'string', enum: ['todos', 'con_saldo', 'saldo_bajo', 'agotados'] },
      desde: { type: 'string', description: 'Fecha de entrega desde, YYYY-MM-DD' },
      hasta: { type: 'string', description: 'Fecha de entrega hasta, YYYY-MM-DD incluida' },
      limite: { type: 'integer', minimum: 1, maximum: 100 }
    },
    additionalProperties: false
  },
  etiqueta: 'Buscando anticipos de viáticos',
  requiere: MODULO_VIATICOS,
  salidaMaxima: { lista: 100, caracteres: 40000 },
  async ejecutar(args) {
    const tercero = textoOpcional(args.tercero, 120)?.toLowerCase()
    const limite = enteroEntre(args.limite, 1, 100, 25)
    const r = await listarAnticipos({
      q: textoOpcional(args.texto, 120),
      estado: typeof args.estado === 'string' ? args.estado : 'todos',
      desde: fechaOpcional(args.desde),
      hasta: fechaOpcional(args.hasta),
      limit: tercero ? 100 : limite
    })
    const filas = tercero
      ? r.data.filter((a) => `${a.tercero?.nombre ?? ''} ${a.tercero?.identificacion ?? ''}`.toLowerCase().includes(tercero)).slice(0, limite)
      : r.data
    return {
      total: tercero ? filas.length : r.meta.total,
      mostrados: filas.length,
      conteos_por_saldo: r.conteos,
      totales_del_filtro: r.totales,
      solicitudes_pendientes: r.solicitudes_pendientes,
      anticipos: filas.map((a) => ({
        fecha: a.fecha,
        conductor: a.conductor.nombre,
        placa: a.vehiculo.placa,
        propietario: a.tercero?.nombre ?? null,
        concepto: a.concepto,
        metodo: METODO[a.metodo] ?? a.metodo,
        valor: a.valor,
        gastado: a.gastado,
        saldo: a.saldo,
        porcentaje_restante: a.porcentaje_restante,
        estado: a.agotado ? 'agotado' : a.saldo_bajo ? 'saldo bajo' : 'con saldo',
        solicitud_pendiente: a.solicitud_pendiente ? a.solicitud_pendiente.valor_solicitado : undefined,
        registrado_por: a.creado_por?.nombre,
        enlace: enlaceAnticipo(a.id)
      }))
    }
  }
}

export const detalleAnticipoViaticos: Herramienta = {
  nombre: 'detalle_anticipo_viaticos',
  descripcion:
    'Trae un anticipo de viáticos completo por su enlace o id: conductor, placa, propietario, cómo se entregó, saldo, cada gasto que el conductor reportó (valor, fecha, descripción, si está anulado y por qué) y sus solicitudes de más dinero (estado, valor, quién las resolvió). Úsala para «¿en qué gastó X el anticipo?», «¿por qué está agotado?».',
  parametros: {
    type: 'object',
    properties: { anticipo: { type: 'string', description: 'Enlace o id del anticipo (sale en buscar_anticipos_viaticos)' } },
    required: ['anticipo'],
    additionalProperties: false
  },
  etiqueta: 'Abriendo el anticipo',
  requiere: MODULO_VIATICOS,
  salidaMaxima: { lista: 80, caracteres: 30000 },
  async ejecutar(args) {
    const id = String(args.anticipo ?? '').match(UUID)?.[0]
    if (!id) return { error: 'Indica el enlace del anticipo (búscalo con buscar_anticipos_viaticos).' }
    const a = await detalleAnticipo(id)
    return {
      fecha: a.fecha,
      conductor: a.conductor.nombre,
      cedula: a.conductor.numero_identificacion,
      placa: a.vehiculo.placa,
      propietario: a.tercero?.nombre ?? null,
      concepto: a.concepto,
      metodo: METODO[a.metodo] ?? a.metodo,
      entidad: a.entidad,
      numero_comprobante: a.numero_comprobante,
      tarjeta_o_cuenta: a.tarjeta_cuenta,
      tiene_comprobante: Boolean(a.comprobante),
      valor: a.valor,
      gastado: a.gastado,
      saldo: a.saldo,
      porcentaje_restante: a.porcentaje_restante,
      estado: a.agotado ? 'agotado' : a.saldo_bajo ? 'saldo bajo' : 'con saldo',
      registrado_por: a.creado_por?.nombre,
      gastos: a.gastos.map((g) => ({
        fecha: g.fecha,
        valor: g.valor,
        descripcion: g.descripcion,
        facturas: g.adjuntos.length,
        anulado: g.anulado ? { por: g.anulado_por?.nombre, motivo: g.motivo_anulacion } : undefined
      })),
      solicitudes: a.solicitudes.map((s) => ({
        fecha: fechaCorta(s.created_at),
        valor_solicitado: s.valor_solicitado,
        estado: s.estado.toLowerCase(),
        observaciones: s.observaciones,
        motivo_rechazo: s.motivo_rechazo,
        resuelta_por: s.resuelta_por?.nombre
      })),
      enlace: enlaceAnticipo(a.id)
    }
  }
}

export const buscarGastosViaticos: Herramienta = {
  nombre: 'buscar_gastos_viaticos',
  descripcion:
    'Lista los gastos directos pagados con viáticos que NO son anticipos: oficina, mantenimientos, dinero a un conductor y cobros del banco (4x1000, cuota de manejo). Por gasto: categoría, descripción, a quién se pagó, valor, fecha, cómo se pagó, quién lo asume (la empresa o el propietario de la placa, con su nombre), placa y conductor de referencia. Filtra por texto, categoría, quién lo asume y fechas; devuelve también el total filtrado.',
  parametros: {
    type: 'object',
    properties: {
      texto: { type: 'string', description: 'Descripción, proveedor, placa, conductor o propietario' },
      categoria: { type: 'string', enum: [...CATEGORIAS_GASTO] },
      asume: { type: 'string', enum: ['EMPRESA', 'TERCERO'], description: 'EMPRESA = los reconoce la empresa; TERCERO = se le cargan al propietario de la placa' },
      desde: { type: 'string', description: 'YYYY-MM-DD' },
      hasta: { type: 'string', description: 'YYYY-MM-DD incluida' },
      limite: { type: 'integer', minimum: 1, maximum: 100 }
    },
    additionalProperties: false
  },
  etiqueta: 'Buscando gastos de viáticos',
  requiere: MODULO_VIATICOS,
  salidaMaxima: { lista: 100, caracteres: 40000 },
  async ejecutar(args) {
    const r = await listarGastosEmpresa({
      q: textoOpcional(args.texto, 120),
      categoria: typeof args.categoria === 'string' ? args.categoria : undefined,
      asume: args.asume === 'EMPRESA' || args.asume === 'TERCERO' ? args.asume : undefined,
      desde: fechaOpcional(args.desde),
      hasta: fechaOpcional(args.hasta),
      limit: enteroEntre(args.limite, 1, 100, 25)
    })
    return {
      total: r.meta.total,
      mostrados: r.data.length,
      valor_total_filtrado: r.total_valor,
      gastos: r.data.map((g) => ({
        fecha: g.fecha,
        categoria: CATEGORIA[g.categoria] ?? g.categoria,
        descripcion: g.descripcion,
        pagado_a: g.beneficiario,
        valor: g.valor,
        metodo: METODO[g.metodo] ?? g.metodo,
        asume: g.asume === 'TERCERO' ? `el propietario${g.tercero ? ` (${g.tercero.nombre})` : ''}` : 'la empresa',
        placa: g.vehiculo?.placa ?? null,
        conductor: g.conductor?.nombre ?? null,
        registrado_por: g.creado_por?.nombre
      })),
      enlace: ENLACE_GASTOS
    }
  }
}

export const solicitudesViaticos: Herramienta = {
  nombre: 'solicitudes_viaticos',
  descripcion:
    'Solicitudes de más dinero que los conductores hacen desde la app sobre un anticipo: conductor, placa, valor pedido, observaciones, estado (pendiente, aprobada, rechazada), saldo del anticipo de origen y quién la resolvió. Por defecto solo las pendientes.',
  parametros: {
    type: 'object',
    properties: { estado: { type: 'string', enum: ['PENDIENTE', 'APROBADA', 'RECHAZADA', 'todas'] } },
    additionalProperties: false
  },
  etiqueta: 'Revisando solicitudes de viáticos',
  requiere: MODULO_VIATICOS,
  async ejecutar(args) {
    const filas = await listarSolicitudes({ estado: typeof args.estado === 'string' ? args.estado : 'PENDIENTE' })
    return {
      total: filas.length,
      solicitudes: filas.map((s) => ({
        fecha: fechaCorta(s.created_at),
        conductor: s.conductor.nombre,
        placa: s.vehiculo.placa,
        valor_solicitado: s.valor_solicitado,
        observaciones: s.observaciones,
        estado: s.estado.toLowerCase(),
        motivo_rechazo: s.motivo_rechazo,
        resuelta_por: s.resuelta_por?.nombre,
        anticipo_origen: { concepto: s.anticipo_origen.concepto, saldo: s.anticipo_origen.saldo, valor: s.anticipo_origen.valor },
        enlace: enlaceAnticipo(s.anticipo_origen.id)
      }))
    }
  }
}

export const saldoViaticosArea: Herramienta = {
  nombre: 'saldo_viaticos_operaciones',
  descripcion:
    'Saldo del área de operaciones para entregar anticipos y pagar gastos (un solo saldo compartido): cuánto queda, cuánto había tras el último desembolso y quién lo registró, si está en el 15 % o menos, y los últimos movimientos (desembolsos, anticipos, gastos, correcciones) con quién los hizo.',
  parametros: { type: 'object', properties: {}, additionalProperties: false },
  etiqueta: 'Consultando el saldo de operaciones',
  requiere: MODULO_VIATICOS,
  salidaMaxima: { lista: 40, caracteres: 20000 },
  async ejecutar(_args, usuario) {
    const f = await estadoFondo(usuario.id)
    return {
      saldo: f.saldo,
      base_ultima_recarga: f.base_ultima_recarga,
      porcentaje_restante: f.porcentaje_restante,
      saldo_bajo: f.saldo_bajo,
      ultimo_desembolso: f.ultima_recarga ? { valor: f.ultima_recarga.valor, fecha: fechaCorta(f.ultima_recarga.fecha), registro: f.ultima_recarga.por } : null,
      tus_anticipos_descuentan_del_saldo: f.requiere_fondo,
      movimientos: f.movimientos.map((m) => ({
        fecha: fechaCorta(m.fecha),
        tipo: { RECARGA: 'saldo recibido', ANTICIPO: 'anticipo', GASTO_EMPRESA: 'gasto', AJUSTE: 'corrección', REVERSO: 'devolución' }[m.tipo] ?? m.tipo,
        valor: m.valor,
        por: m.registrado_por,
        detalle: m.anticipo ? `${m.anticipo.conductor} · ${m.anticipo.placa}` : m.gasto_empresa ? m.gasto_empresa.descripcion : (m.observaciones ?? undefined)
      })),
      enlace: '/dashboard/viaticos'
    }
  }
}

export const resumenViaticosHerramienta: Herramienta = {
  nombre: 'resumen_viaticos',
  descripcion:
    'Totales de viáticos en un rango de fechas, por día, semana o mes: cuánto se entregó en anticipos, cuánto legalizaron los conductores, gastos de la empresa y gastos a cargo de terceros, lo que hoy está en manos de los conductores, gastos por categoría, conductores y placas con más anticipos y el saldo de operaciones. Úsala para «¿cuánto se ha dado en viáticos este mes?», «¿cuánto se va en 4x1000?», «¿quién recibe más anticipos?». Si no dicen periodo, el mes en curso.',
  parametros: {
    type: 'object',
    properties: {
      desde: { type: 'string', description: 'YYYY-MM-DD' },
      hasta: { type: 'string', description: 'YYYY-MM-DD incluida' },
      agrupar: { type: 'string', enum: ['dia', 'semana', 'mes'], description: 'Por defecto semana' }
    },
    additionalProperties: false
  },
  etiqueta: 'Sumando viáticos',
  requiere: MODULO_VIATICOS,
  salidaMaxima: { lista: 60, caracteres: 30000 },
  async ejecutar(args) {
    const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })
    const desde = fechaOpcional(args.desde) ?? `${hoy.slice(0, 8)}01`
    const hasta = fechaOpcional(args.hasta) ?? hoy
    const agrupar = args.agrupar === 'dia' || args.agrupar === 'mes' ? args.agrupar : 'semana'
    const r = await resumenViaticos({ desde, hasta, agrupar })
    return {
      ...r,
      por_categoria: r.por_categoria.filter((c) => c.valor).map((c) => ({ ...c, categoria: CATEGORIA[c.categoria] ?? c.categoria })),
      enlace: '/dashboard/viaticos'
    }
  }
}

export const detalleTercero: Herramienta = {
  nombre: 'detalle_tercero',
  descripcion:
    'Ficha de un tercero (propietario de vehículos) por nombre o identificación: datos de contacto, las placas que tiene a su nombre y, si el usuario puede ver viáticos, los anticipos entregados para sus placas y los gastos que se le cargaron (asumidos por él) con sus totales. Para lo que se le liquida o paga usa buscar_liquidaciones_terceros y cierres_terceros.',
  parametros: {
    type: 'object',
    properties: { tercero: { type: 'string', description: 'Nombre o identificación (cédula o NIT)' } },
    required: ['tercero'],
    additionalProperties: false
  },
  etiqueta: 'Abriendo el tercero',
  requiere: 'terceros',
  salidaMaxima: { lista: 60, caracteres: 30000 },
  async ejecutar(args, usuario) {
    const texto = textoOpcional(args.tercero, 120)
    if (!texto) return { error: 'Indica el nombre o la identificación del tercero.' }
    const digitos = texto.replace(/\D/g, '')
    const candidatos = await prisma.terceros.findMany({
      where: {
        deleted_at: null,
        OR: [
          { nombre_completo: { contains: texto, mode: 'insensitive' } },
          ...(digitos.length >= 5 ? [{ identificacion: { contains: digitos } }] : [])
        ]
      },
      select: { id: true, nombre_completo: true, identificacion: true, telefono: true, correo: true, direccion: true, tipo_persona: true, activo: true },
      take: 6
    })
    if (!candidatos.length) return { error: `No hay terceros que coincidan con «${texto}».` }
    if (candidatos.length > 1 && !candidatos.some((c) => c.identificacion === digitos)) {
      return {
        varios: true,
        pista: 'Pregunta cuál es o vuelve a llamar con la identificación',
        candidatos: candidatos.map((c) => ({ nombre: c.nombre_completo, identificacion: c.identificacion }))
      }
    }
    const t = candidatos.find((c) => c.identificacion === digitos) ?? candidatos[0]
    const ids = [t.identificacion, t.identificacion?.replace(/\D/g, '')].filter((x): x is string => Boolean(x))
    const vehiculos = await prisma.vehiculos.findMany({
      where: {
        deleted_at: null,
        OR: [
          ...ids.map((i) => ({ propietario_identificacion: { contains: i } })),
          { propietario_nombre: { equals: t.nombre_completo, mode: 'insensitive' as const } }
        ]
      },
      select: { placa: true, marca: true, linea: true, modelo: true, estado: true },
      orderBy: { placa: 'asc' }
    })
    const verViaticos = usuario.modulos.has(MODULO_VIATICOS)
    let viaticos: unknown = 'El usuario no tiene acceso a viáticos'
    if (verViaticos) {
      const [anticipos, gastos] = await Promise.all([
        prisma.viatico_anticipo.findMany({
          where: { deleted_at: null, tercero_id: t.id },
          select: { fecha: true, valor: true, concepto: true, vehiculo: { select: { placa: true } }, conductor: { select: { nombre: true, apellido: true } } },
          orderBy: { fecha: 'desc' },
          take: 30
        }),
        prisma.viatico_gasto_empresa.findMany({
          where: { deleted_at: null, asume: 'TERCERO', tercero_id: t.id },
          select: { fecha: true, valor: true, descripcion: true, categoria: true, vehiculo: { select: { placa: true } } },
          orderBy: { fecha: 'desc' },
          take: 30
        })
      ])
      const suma = (xs: { valor: unknown }[]) => Math.round(xs.reduce((s, x) => s + Number(x.valor), 0))
      viaticos = {
        anticipos: { cantidad: anticipos.length, total: suma(anticipos), ultimos: anticipos.slice(0, 10).map((a) => ({ fecha: a.fecha.toISOString().slice(0, 10), placa: a.vehiculo.placa, conductor: `${a.conductor.nombre} ${a.conductor.apellido}`.trim(), concepto: a.concepto, valor: Number(a.valor) })) },
        gastos_a_su_cargo: { cantidad: gastos.length, total: suma(gastos), ultimos: gastos.slice(0, 10).map((g) => ({ fecha: g.fecha.toISOString().slice(0, 10), placa: g.vehiculo?.placa, categoria: CATEGORIA[g.categoria] ?? g.categoria, descripcion: g.descripcion, valor: Number(g.valor) })) }
      }
    }
    return {
      nombre: t.nombre_completo,
      identificacion: t.identificacion,
      tipo: t.tipo_persona.toLowerCase(),
      activo: t.activo,
      telefono: t.telefono,
      correo: t.correo,
      direccion: t.direccion,
      placas: vehiculos.map((v) => ({ placa: v.placa, vehiculo: [v.marca, v.linea, v.modelo].filter(Boolean).join(' '), estado: String(v.estado ?? '').toLowerCase() })),
      viaticos,
      enlace: `/dashboard/terceros?q=${encodeURIComponent(t.identificacion ?? t.nombre_completo)}`
    }
  }
}

export const misNotificaciones: Herramienta = {
  nombre: 'mis_notificaciones',
  descripcion:
    'Las notificaciones recientes del usuario (las de la campana): liquidaciones enviadas, aprobadas o devueltas, servicios nuevos, preoperacionales, días laborados, saldo de anticipos bajo, acciones correctivas… con fecha y si ya las leyó. Úsala para «¿qué me ha llegado?», «¿me aprobaron la liquidación?».',
  parametros: {
    type: 'object',
    properties: {
      solo_sin_leer: { type: 'boolean' },
      limite: { type: 'integer', minimum: 1, maximum: 50 }
    },
    additionalProperties: false
  },
  etiqueta: 'Revisando tus notificaciones',
  requiere: null,
  async ejecutar(args, usuario) {
    const where = { usuario_id: usuario.id, ...(args.solo_sin_leer === true ? { leida: false } : {}) }
    const [filas, sinLeer] = await Promise.all([
      prisma.notificacion.findMany({ where, orderBy: { created_at: 'desc' }, take: enteroEntre(args.limite, 1, 50, 15) }),
      prisma.notificacion.count({ where: { usuario_id: usuario.id, leida: false } })
    ])
    return {
      sin_leer: sinLeer,
      notificaciones: filas.map((n) => ({
        fecha: n.created_at.toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'short', timeStyle: 'short' }),
        titulo: n.titulo,
        mensaje: n.mensaje,
        leida: n.leida
      }))
    }
  }
}

export const misCapacitaciones: Herramienta = {
  nombre: 'mis_capacitaciones',
  descripcion:
    'Las capacitaciones del propio usuario: asistencias abiertas que le faltan firmar desde su fecha de ingreso, evaluaciones por responder y su historial (firmadas y respondidas con puntaje). Se firman desde la app de gestión (Capacitaciones). Para las listas de asistencia de todos usa buscar_asistencias.',
  parametros: { type: 'object', properties: {}, additionalProperties: false },
  etiqueta: 'Revisando tus capacitaciones',
  requiere: null,
  salidaMaxima: { lista: 100, caracteres: 30000 },
  async ejecutar(_args, usuario) {
    const r = await listarCapacitaciones(await personaUsuario(usuario.id))
    return {
      asistencias_por_firmar: r.asistencias_pendientes.map((a) => ({ fecha: a.fecha, tematica: a.tematica, instructor: a.nombre_instructor, lugar: a.lugar_sede })),
      evaluaciones_por_responder: r.evaluaciones_pendientes.map((e) => ({ titulo: e.titulo, preguntas: e.preguntas, requiere_firma: e.requiere_firma })),
      asistencias_firmadas: r.asistencias_firmadas.length,
      evaluaciones_respondidas: r.evaluaciones_respondidas.map((e) => ({ titulo: e.titulo, puntaje: `${e.puntaje_total} de ${e.puntaje_maximo}`, fecha: fechaCorta(e.respondida_en) }))
    }
  }
}

export const HERRAMIENTAS_VIATICOS: readonly Herramienta[] = [
  buscarAnticiposViaticos,
  detalleAnticipoViaticos,
  buscarGastosViaticos,
  solicitudesViaticos,
  saldoViaticosArea,
  resumenViaticosHerramienta,
  detalleTercero,
  misNotificaciones,
  misCapacitaciones
]
