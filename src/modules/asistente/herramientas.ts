import { prisma } from '../../config/prisma'
import {
  type Canal,
  type Herramienta,
  type UsuarioAsistente,
  puedeUsar,
} from './asistente.types'
import { conYSinTildes, variantesNombre, enteroEntre, fechaCorta, fechaOpcional, textoOpcional } from './asistente.utils'
import { MODULOS_APP, buscarModulo, descripcionModulo, moduloDeRuta } from './modulos'
import { ACCIONES } from './acciones'
import { buscarLugares } from './lugares'
import { ACCIONES_LIQUIDACIONES, HERRAMIENTAS_LIQUIDACIONES } from './liquidaciones'
import { HERRAMIENTAS_ENVIOS, HERRAMIENTAS_FORMULARIOS } from './formularios'
import { HERRAMIENTAS_RECARGOS } from './recargos'
import { HERRAMIENTAS_ASISTENCIAS } from './asistencias'
import { HERRAMIENTAS_RECORRIDOS } from './recorridos'
import { HERRAMIENTAS_ACCIONES_CORRECTIVAS } from './acciones-correctivas'
import { HERRAMIENTAS_SARLAFT } from './sarlaft'
import { HERRAMIENTAS_LIQUIDACIONES_TERCEROS } from './liquidaciones-terceros'
import { HERRAMIENTAS_BUSCADOR } from './buscador-global'
import { HERRAMIENTAS_NOMINA } from './nomina'
import { HERRAMIENTAS_USUARIOS } from './usuarios'
import { detalleServicio } from './servicio-referencia'
import { guiaInteractiva } from './guias/herramienta'

/**
 * Registro de herramientas del asistente.
 *
 * Las de este archivo son de SOLO LECTURA (las que escriben viven en
 * `acciones.ts`) y devuelven datos planos con nombres de negocio
 * (nada de `_count`, ids internos ni enums crudos): lo que el modelo recibe es
 * lo que repite. Consultan Prisma directamente con `select` en vez de pasar por
 * los servicios de cada módulo porque estos arrastran trabajo que aquí sobra
 * (URLs firmadas de fotos, estadísticas, paginación de pantalla).
 *
 * Cómo agregar una:
 *  1. Añadirla a `HERRAMIENTAS` con `nombre`, `descripcion` clara (la lee el
 *     modelo), `parametros`, `requiere` (moduleId) y, si aplica, `canales`.
 *  2. Devolver datos planos. Si debe mover la pantalla, devolver `{ navegar }`.
 *  3. Si el modelo necesita una regla de uso, agregarla al prompt
 *     (`asistente.service.ts`).
 */

const LIMITE_POR_DEFECTO = 10
const LIMITE_MAXIMO = 500

function nombreCompleto(c: { nombre?: string | null; apellido?: string | null } | null | undefined) {
  return c ? `${c.nombre ?? ''} ${c.apellido ?? ''}`.trim() : undefined
}

function etiquetaEstado(valor: string | null | undefined): string | undefined {
  return valor ? valor.replace(/_/g, ' ') : undefined
}

// ── Pantallas ─────────────────────────────────────────────────────────────

const pantallasDisponibles: Herramienta = {
  nombre: 'pantallas_disponibles',
  descripcion:
    'Lista las pantallas (módulos) de la app a las que este usuario puede entrar, con su enlace y para qué sirve cada una. Úsala para orientar («¿dónde veo…?») o antes de navegar.',
  parametros: { type: 'object', properties: {}, additionalProperties: false },
  etiqueta: 'Revisando tus pantallas',
  requiere: null,
  async ejecutar(_args, u) {
    return {
      usuario: u.nombre,
      areas: u.areas,
      pantallas: MODULOS_APP.filter((m) => u.modulos.has(m.id)).map((m) => ({
        pantalla: m.etiqueta,
        enlace: m.ruta,
        descripcion: descripcionModulo(m.id),
        acceso: u.modulos.get(m.id),
      })),
    }
  },
}

const irA: Herramienta = {
  nombre: 'ir_a',
  descripcion:
    'Lleva al usuario a una pantalla de la app. Pasa `pantalla` con el nombre del módulo («nómina», «servicios», «flota») o `ruta` con un enlace interno que haya devuelto otra herramienta (p. ej. el detalle de un servicio). La app navega sola; después confirma en una línea a dónde lo llevaste.',
  parametros: {
    type: 'object',
    properties: {
      pantalla: { type: 'string', description: 'Nombre del módulo tal como lo dice el usuario' },
      ruta: { type: 'string', description: 'Ruta interna que empieza por /dashboard, devuelta por otra herramienta' },
    },
    additionalProperties: false,
  },
  etiqueta: 'Abriendo la pantalla',
  requiere: null,
  canales: ['app'],
  async ejecutar(args, u) {
    const ruta = textoOpcional(args.ruta, 300)
    if (ruta) {
      if (!ruta.startsWith('/dashboard') || ruta.startsWith('//') || /[\s<>"']/.test(ruta)) {
        return { error: 'Solo se puede navegar a rutas internas de la app' }
      }
      const m = moduloDeRuta(ruta)
      if (!m) return { error: 'Esa ruta no corresponde a ninguna pantalla conocida' }
      if (!u.modulos.has(m.id)) return { error: `El usuario no tiene acceso a ${m.etiqueta}` }
      return { navegar: ruta, pantalla: m.etiqueta }
    }

    const texto = textoOpcional(args.pantalla, 80)
    if (!texto) return { error: 'Indica la pantalla o la ruta' }
    const m = buscarModulo(texto)
    if (!m) {
      return {
        error: `No hay ninguna pantalla llamada «${texto}»`,
        disponibles: MODULOS_APP.filter((x) => u.modulos.has(x.id)).map((x) => x.etiqueta),
      }
    }
    if (!u.modulos.has(m.id)) {
      return { error: `El usuario no tiene acceso a ${m.etiqueta}; debe pedirlo a un administrador` }
    }
    return { navegar: m.ruta, pantalla: m.etiqueta }
  },
}

// ── Conductores ───────────────────────────────────────────────────────────

/**
 * El ticket de un servicio es un MODAL del listado, no una pantalla: no tiene
 * ruta propia. El listado entiende `?ticket=<id>` y lo abre solo, así que
 * esta herramienta solo valida que el servicio exista y manda navegar ahí.
 */
const abrirTicketServicio: Herramienta = {
  nombre: 'abrir_ticket_servicio',
  descripcion:
    'Abre en pantalla el ticket (modal) de un servicio. Pasa el id del servicio, que viene en los enlaces /dashboard/servicios/<id> que devuelven las otras herramientas. La app abre el listado de Servicios con el ticket desplegado.',
  parametros: {
    type: 'object',
    properties: { servicio_id: { type: 'string', description: 'Id del servicio (UUID) o su enlace /dashboard/servicios/<id>' } },
    required: ['servicio_id'],
    additionalProperties: false,
  },
  etiqueta: 'Abriendo el ticket',
  requiere: 'servicios',
  canales: ['app'],
  async ejecutar(args) {
    const texto = textoOpcional(args.servicio_id, 300) ?? ''
    const id = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.exec(texto)?.[0]
    if (!id) return { error: 'Falta el id del servicio; búscalo primero con buscar_servicios' }
    const s = await prisma.servicio.findFirst({
      where: { id, deleted_at: null },
      select: { id: true, estado: true, fecha_realizacion: true, clientes: { select: { nombre: true } } },
    })
    if (!s) return { error: 'No existe ese servicio' }
    return {
      navegar: `/dashboard/servicios?ticket=${s.id}`,
      pantalla: 'Ticket del servicio',
      servicio: { cliente: s.clientes?.nombre, estado: s.estado, fecha_realizacion: fechaCorta(s.fecha_realizacion) },
    }
  },
}

const buscarConductores: Herramienta = {
  nombre: 'buscar_conductores',
  descripcion:
    'Busca conductores por nombre, apellido, cédula o correo, y opcionalmente por estado (activo, inactivo, suspendido, retirado, vacaciones, incapacidad, descanso, desvinculado). Devuelve datos de contacto, cargo, sede, licencia y el enlace a su ficha.',
  parametros: {
    type: 'object',
    properties: {
      texto: { type: 'string', description: 'Nombre, cédula o correo (parcial)' },
      estado: { type: 'string', description: 'Estado del conductor' },
      excluir_estados: { type: 'array', items: { type: 'string' }, description: 'Estados a dejar fuera, p. ej. ["desvinculado","retirado"]' },
      limite: { type: 'integer', minimum: 1, maximum: LIMITE_MAXIMO, description: 'Hasta 500; pide el total si el usuario quiere la lista completa' },
    },
    additionalProperties: false,
  },
  etiqueta: 'Buscando conductores',
  requiere: 'conductores',
  async ejecutar(args) {
    const texto = textoOpcional(args.texto)
    const estado = textoOpcional(args.estado, 30)?.toLowerCase().replace(/\s+/g, '_')
    const limite = enteroEntre(args.limite, 1, LIMITE_MAXIMO, LIMITE_POR_DEFECTO)

    const base: Record<string, unknown> = { deleted_at: null, oculto: false }
    if (estado) base.estado = estado
    const excluir = Array.isArray(args.excluir_estados) ? args.excluir_estados.map((e) => String(e).toLowerCase().replace(/\s+/g, '_')) : []
    if (!estado && excluir.length) base.estado = { notIn: excluir }
    const condiciones = (partes: string[]) =>
      partes.map((p) => ({
        OR: conYSinTildes(p).flatMap((x) => [
          { nombre: { contains: x, mode: 'insensitive' } },
          { apellido: { contains: x, mode: 'insensitive' } },
          { numero_identificacion: { contains: x } },
          { email: { contains: x, mode: 'insensitive' } },
        ]),
      }))

    // Con tolerancia: si el nombre completo no trae a nadie, se van soltando
    // palabras (un apellido mal escrito no debe dejar al conductor sin aparecer).
    let where = base
    let palabrasIgnoradas: string[] = []
    if (texto) {
      for (const v of variantesNombre(texto)) {
        const candidato = { ...base, AND: condiciones(v.partes) }
        if ((await prisma.conductores.count({ where: candidato as never })) > 0 || v.partes.length === 1) {
          where = candidato
          palabrasIgnoradas = v.ignoradas
          break
        }
      }
    }

    const [filas, total] = await Promise.all([
      prisma.conductores.findMany({
        where: where as never,
        select: {
          id: true,
          nombre: true,
          apellido: true,
          numero_identificacion: true,
          telefono: true,
          email: true,
          cargo: true,
          estado: true,
          sede_trabajo: true,
          categoria_licencia: true,
          vencimiento_licencia: true,
          fecha_ingreso: true,
        },
        orderBy: [{ nombre: 'asc' }, { apellido: 'asc' }],
        take: limite,
      }),
      prisma.conductores.count({ where: where as never }),
    ])

    return {
      ...(palabrasIgnoradas.length ? { nota: `No hubo coincidencias con el nombre completo; se ignoró «${palabrasIgnoradas.join(' ')}». Confirma con el usuario que es la persona correcta` } : {}),
      total,
      mostrados: filas.length,
      conductores: filas.map((c) => ({
        nombre: nombreCompleto(c),
        cedula: c.numero_identificacion,
        telefono: c.telefono,
        correo: c.email,
        cargo: c.cargo,
        estado: etiquetaEstado(c.estado),
        sede: etiquetaEstado(c.sede_trabajo),
        licencia: c.categoria_licencia,
        vence_licencia: fechaCorta(c.vencimiento_licencia),
        ingreso: fechaCorta(c.fecha_ingreso),
        enlace: `/dashboard/conductores/${c.id}`,
      })),
    }
  },
}

// ── Flota ─────────────────────────────────────────────────────────────────

const buscarVehiculos: Herramienta = {
  nombre: 'buscar_vehiculos',
  descripcion:
    'Busca vehículos de la flota por placa, marca, línea, clase o propietario, y opcionalmente por estado (disponible, programado, servicio, mantenimiento, inactivo, desvinculado). Devuelve sus datos y el conductor asignado.',
  parametros: {
    type: 'object',
    properties: {
      texto: { type: 'string', description: 'Placa, marca, línea, clase o nombre del propietario (parcial)' },
      estado: { type: 'string', description: 'Estado del vehículo' },
      limite: { type: 'integer', minimum: 1, maximum: LIMITE_MAXIMO },
    },
    additionalProperties: false,
  },
  etiqueta: 'Buscando en la flota',
  requiere: 'flota',
  async ejecutar(args) {
    const texto = textoOpcional(args.texto)
    const estado = textoOpcional(args.estado, 30)?.toLowerCase()
    const limite = enteroEntre(args.limite, 1, LIMITE_MAXIMO, LIMITE_POR_DEFECTO)

    const where: Record<string, unknown> = { deleted_at: null, oculto: false }
    if (estado) where.estado = estado
    if (texto) {
      where.OR = [
        { placa: { contains: texto.replace(/[\s-]/g, ''), mode: 'insensitive' } },
        { marca: { contains: texto, mode: 'insensitive' } },
        { linea: { contains: texto, mode: 'insensitive' } },
        { clase_vehiculo: { contains: texto, mode: 'insensitive' } },
        { propietario_nombre: { contains: texto, mode: 'insensitive' } },
      ]
    }

    const [filas, total] = await Promise.all([
      prisma.vehiculos.findMany({
        where: where as never,
        select: {
          id: true,
          placa: true,
          marca: true,
          linea: true,
          modelo: true,
          color: true,
          clase_vehiculo: true,
          estado: true,
          propietario_nombre: true,
          kilometraje: true,
          conductores: { select: { nombre: true, apellido: true, estado: true } },
        },
        orderBy: { placa: 'asc' },
        take: limite,
      }),
      prisma.vehiculos.count({ where: where as never }),
    ])

    return {
      total,
      mostrados: filas.length,
      vehiculos: filas.map((v) => ({
        placa: v.placa,
        vehiculo: [v.marca, v.linea, v.modelo].filter(Boolean).join(' '),
        clase: v.clase_vehiculo,
        color: v.color,
        estado: etiquetaEstado(v.estado),
        propietario: v.propietario_nombre,
        kilometraje: v.kilometraje,
        conductor_asignado: nombreCompleto(v.conductores),
        enlace: `/dashboard/flota?placa=${encodeURIComponent(v.placa)}`,
      })),
    }
  },
}

// ── Clientes ──────────────────────────────────────────────────────────────

const buscarClientes: Herramienta = {
  nombre: 'buscar_clientes',
  descripcion:
    'Busca clientes (empresas o personas) por nombre, NIT, representante o correo. Indica si requieren OSI y si pagan recargos, y da el enlace a su ficha.',
  parametros: {
    type: 'object',
    properties: {
      texto: { type: 'string', description: 'Nombre, NIT, representante o correo (parcial)' },
      limite: { type: 'integer', minimum: 1, maximum: LIMITE_MAXIMO },
    },
    additionalProperties: false,
  },
  etiqueta: 'Buscando clientes',
  requiere: 'clientes',
  async ejecutar(args) {
    const texto = textoOpcional(args.texto)
    const limite = enteroEntre(args.limite, 1, LIMITE_MAXIMO, LIMITE_POR_DEFECTO)

    const where: Record<string, unknown> = { deletedAt: null, oculto: false }
    if (texto) {
      where.OR = [
        { nombre: { contains: texto, mode: 'insensitive' } },
        { nit: { contains: texto, mode: 'insensitive' } },
        { representante: { contains: texto, mode: 'insensitive' } },
        { correo: { contains: texto, mode: 'insensitive' } },
      ]
    }

    const [filas, total] = await Promise.all([
      prisma.clientes.findMany({
        where: where as never,
        select: {
          id: true,
          nombre: true,
          nit: true,
          tipo: true,
          representante: true,
          telefono: true,
          correo: true,
          direccion: true,
          requiere_osi: true,
          paga_recargos: true,
        },
        orderBy: { nombre: 'asc' },
        take: limite,
      }),
      prisma.clientes.count({ where: where as never }),
    ])

    return {
      total,
      mostrados: filas.length,
      clientes: filas.map((c) => ({
        nombre: c.nombre,
        nit: c.nit,
        tipo: etiquetaEstado(c.tipo)?.toLowerCase(),
        representante: c.representante,
        telefono: c.telefono,
        correo: c.correo,
        direccion: c.direccion,
        requiere_osi: c.requiere_osi === true,
        paga_recargos: c.paga_recargos === true,
        enlace: `/dashboard/clientes/${c.id}`,
      })),
    }
  },
}

// ── Servicios ─────────────────────────────────────────────────────────────

const ESTADOS_SERVICIO = [
  'solicitado',
  'planificado',
  'en_curso',
  'pendiente',
  'realizado',
  'planilla_asignada',
  'liquidado',
  'cancelado',
] as const

const buscarServicios: Herramienta = {
  nombre: 'buscar_servicios',
  descripcion:
    'Busca servicios de transporte por cliente, conductor, placa, número de planilla, origen o destino, con filtro opcional de estado (solicitado, planificado, en curso, pendiente, realizado, planilla asignada, liquidado, cancelado) y de rango de fechas de realización. Devuelve ruta, fechas, valor, estado y el enlace al detalle.',
  parametros: {
    type: 'object',
    properties: {
      texto: { type: 'string', description: 'Cliente, conductor, placa, planilla, origen o destino (parcial)' },
      estado: { type: 'string', enum: [...ESTADOS_SERVICIO] },
      desde: { type: 'string', description: 'Fecha de realización desde, AAAA-MM-DD' },
      hasta: { type: 'string', description: 'Fecha de realización hasta, AAAA-MM-DD' },
      limite: { type: 'integer', minimum: 1, maximum: LIMITE_MAXIMO },
    },
    additionalProperties: false,
  },
  etiqueta: 'Buscando servicios',
  requiere: 'servicios',
  async ejecutar(args) {
    const texto = textoOpcional(args.texto)
    const estado = textoOpcional(args.estado, 30)?.toLowerCase().replace(/\s+/g, '_')
    const desde = fechaOpcional(args.desde)
    const hasta = fechaOpcional(args.hasta)
    const limite = enteroEntre(args.limite, 1, LIMITE_MAXIMO, LIMITE_POR_DEFECTO)

    const where: Record<string, unknown> = { deleted_at: null }
    if (estado && (ESTADOS_SERVICIO as readonly string[]).includes(estado)) where.estado = estado
    if (desde || hasta) {
      where.fecha_realizacion = {
        ...(desde ? { gte: new Date(`${desde}T00:00:00-05:00`) } : {}),
        ...(hasta ? { lte: new Date(`${hasta}T23:59:59-05:00`) } : {}),
      }
    }
    if (texto) {
      where.OR = [
        { numero_planilla: { contains: texto, mode: 'insensitive' } },
        { origen_especifico: { contains: texto, mode: 'insensitive' } },
        { destino_especifico: { contains: texto, mode: 'insensitive' } },
        { clientes: { nombre: { contains: texto, mode: 'insensitive' } } },
        { vehiculos: { placa: { contains: texto.replace(/[\s-]/g, ''), mode: 'insensitive' } } },
        { conductores: { nombre: { contains: texto, mode: 'insensitive' } } },
        { conductores: { apellido: { contains: texto, mode: 'insensitive' } } },
        { municipios_servicio_origen_idTomunicipios: { nombre_municipio: { contains: texto, mode: 'insensitive' } } },
        { municipios_servicio_destino_idTomunicipios: { nombre_municipio: { contains: texto, mode: 'insensitive' } } },
      ]
    }

    const [filas, total] = await Promise.all([
      prisma.servicio.findMany({
        where: where as never,
        select: {
          id: true,
          estado: true,
          fecha_solicitud: true,
          fecha_realizacion: true,
          fecha_finalizacion: true,
          valor: true,
          numero_planilla: true,
          origen_especifico: true,
          destino_especifico: true,
          proposito_servicio: true,
          clientes: { select: { nombre: true } },
          conductores: { select: { nombre: true, apellido: true } },
          vehiculos: { select: { placa: true } },
          municipios_servicio_origen_idTomunicipios: { select: { nombre_municipio: true } },
          municipios_servicio_destino_idTomunicipios: { select: { nombre_municipio: true } },
        },
        orderBy: [{ fecha_realizacion: 'desc' }, { created_at: 'desc' }],
        take: limite,
      }),
      prisma.servicio.count({ where: where as never }),
    ])

    return {
      total,
      mostrados: filas.length,
      servicios: filas.map((s) => ({
        cliente: s.clientes?.nombre,
        estado: etiquetaEstado(s.estado),
        fecha_realizacion: fechaCorta(s.fecha_realizacion),
        fecha_solicitud: fechaCorta(s.fecha_solicitud),
        origen: `${s.municipios_servicio_origen_idTomunicipios?.nombre_municipio ?? ''} · ${s.origen_especifico}`.trim(),
        destino: `${s.municipios_servicio_destino_idTomunicipios?.nombre_municipio ?? ''} · ${s.destino_especifico}`.trim(),
        conductor: nombreCompleto(s.conductores),
        placa: s.vehiculos?.placa,
        planilla: s.numero_planilla,
        proposito: etiquetaEstado(s.proposito_servicio),
        valor: Number(s.valor),
        enlace: `/dashboard/servicios/${s.id}`,
      })),
    }
  },
}

const resumenServicios: Herramienta = {
  nombre: 'resumen_servicios',
  descripcion:
    'Cuenta los servicios por estado en un rango de fechas de realización (por defecto el mes en curso) y suma su valor. Sirve para «¿cuántos servicios hay planificados esta semana?» o «¿cuánto se facturó en septiembre?».',
  parametros: {
    type: 'object',
    properties: {
      desde: { type: 'string', description: 'AAAA-MM-DD' },
      hasta: { type: 'string', description: 'AAAA-MM-DD' },
    },
    additionalProperties: false,
  },
  etiqueta: 'Resumiendo servicios',
  requiere: 'servicios',
  async ejecutar(args) {
    const hoy = new Date()
    const primerDia = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 1)).toISOString().slice(0, 10)
    const desde = fechaOpcional(args.desde) ?? primerDia
    const hasta = fechaOpcional(args.hasta) ?? hoy.toISOString().slice(0, 10)

    const where = {
      deleted_at: null,
      fecha_realizacion: { gte: new Date(`${desde}T00:00:00-05:00`), lte: new Date(`${hasta}T23:59:59-05:00`) },
    }
    const grupos = await prisma.servicio.groupBy({
      by: ['estado'],
      where,
      _count: { id: true },
      _sum: { valor: true },
    })
    const total = grupos.reduce((acc, g) => acc + g._count.id, 0)
    const valorTotal = grupos.reduce((acc, g) => acc + Number(g._sum.valor ?? 0), 0)
    return {
      periodo: { desde, hasta },
      total_servicios: total,
      valor_total: valorTotal,
      por_estado: grupos
        .sort((a, b) => b._count.id - a._count.id)
        .map((g) => ({ estado: etiquetaEstado(g.estado), cantidad: g._count.id, valor: Number(g._sum.valor ?? 0) })),
      enlace: '/dashboard/servicios',
    }
  },
}

// ── Terceros ──────────────────────────────────────────────────────────────

const buscarTerceros: Herramienta = {
  nombre: 'buscar_terceros',
  descripcion:
    'Busca terceros (propietarios de vehículos y otros beneficiarios de pagos) por nombre o identificación.',
  parametros: {
    type: 'object',
    properties: {
      texto: { type: 'string', description: 'Nombre o identificación (parcial)' },
      limite: { type: 'integer', minimum: 1, maximum: LIMITE_MAXIMO },
    },
    additionalProperties: false,
  },
  etiqueta: 'Buscando terceros',
  requiere: 'terceros',
  async ejecutar(args) {
    const texto = textoOpcional(args.texto)
    const limite = enteroEntre(args.limite, 1, LIMITE_MAXIMO, LIMITE_POR_DEFECTO)
    const where: Record<string, unknown> = { deleted_at: null }
    if (texto) {
      where.OR = [
        { nombre_completo: { contains: texto, mode: 'insensitive' } },
        { identificacion: { contains: texto, mode: 'insensitive' } },
      ]
    }
    const [filas, total] = await Promise.all([
      prisma.terceros.findMany({
        where: where as never,
        select: { id: true, nombre_completo: true, identificacion: true, tipo_persona: true },
        orderBy: { nombre_completo: 'asc' },
        take: limite,
      }),
      prisma.terceros.count({ where: where as never }),
    ])
    return {
      total,
      mostrados: filas.length,
      terceros: filas.map((t) => ({
        nombre: t.nombre_completo,
        identificacion: t.identificacion,
        tipo: etiquetaEstado(t.tipo_persona)?.toLowerCase(),
        enlace: `/dashboard/terceros?q=${encodeURIComponent(t.identificacion ?? '')}`,
      })),
    }
  },
}

// ── Municipios ────────────────────────────────────────────────────────────

const buscarMunicipios: Herramienta = {
  nombre: 'buscar_municipios',
  descripcion:
    'Busca municipios por nombre (y opcionalmente departamento) para resolver origen y destino de un servicio. Úsala cuando un nombre pueda repetirse en varios departamentos (Villanueva, Puerto…).',
  parametros: {
    type: 'object',
    properties: {
      nombre: { type: 'string' },
      departamento: { type: 'string' },
    },
    required: ['nombre'],
    additionalProperties: false,
  },
  etiqueta: 'Buscando municipios',
  requiere: null,
  async ejecutar(args) {
    const nombre = textoOpcional(args.nombre, 60)
    const departamento = textoOpcional(args.departamento, 60)
    if (!nombre) return { error: 'Indica el nombre del municipio' }
    const filas = await prisma.municipios.findMany({
      where: {
        nombre_municipio: { contains: nombre, mode: 'insensitive' },
        ...(departamento ? { nombre_departamento: { contains: departamento, mode: 'insensitive' } } : {}),
      },
      select: { nombre_municipio: true, nombre_departamento: true },
      orderBy: [{ nombre_municipio: 'asc' }, { nombre_departamento: 'asc' }],
      take: 15,
    })
    return { municipios: filas.map((m) => ({ municipio: m.nombre_municipio, departamento: m.nombre_departamento })) }
  },
}

// ── Lugares específicos ───────────────────────────────────────────────────

const buscarLugaresHerramienta: Herramienta = {
  nombre: 'buscar_lugares',
  descripcion:
    'Busca puntos específicos ya visitados (pozos, bases, campamentos, hoteles, direcciones) por nombre, con cuántas veces se usaron y si tienen coordenadas. Úsala antes de programar un servicio para reconocer el lugar exacto que menciona el usuario y escribirlo igual que en el historial; si no aparece, es un lugar nuevo.',
  parametros: {
    type: 'object',
    properties: {
      texto: { type: 'string', description: 'Nombre del lugar o parte (p. ej. «jacana», «base fepco»)' },
      municipio: { type: 'string', description: 'Municipio para acotar, si se sabe' },
    },
    required: ['texto'],
    additionalProperties: false,
  },
  etiqueta: 'Buscando lugares frecuentes',
  requiere: 'servicios',
  async ejecutar(args) {
    const texto = textoOpcional(args.texto, 120)
    if (!texto) return { error: 'Indica el nombre del lugar' }
    const municipio = textoOpcional(args.municipio, 60)
    let municipioId: string | undefined
    if (municipio) {
      const m = await prisma.municipios.findFirst({
        where: { nombre_municipio: { contains: municipio, mode: 'insensitive' } },
        select: { id: true },
      })
      municipioId = m?.id
    }
    const lugares = await buscarLugares(texto, municipioId, 10)
    return {
      total: lugares.length,
      lugares: lugares.map((l) => ({
        lugar: l.nombre,
        veces_usado: l.veces,
        coordenadas: l.latitud !== null ? `${l.latitud!.toFixed(5)}, ${l.longitud!.toFixed(5)}` : 'sin coordenadas',
        fuente: l.fuente === 'guardado' ? 'lugar guardado' : 'historial de servicios',
      })),
    }
  },
}

// ── Registro ──────────────────────────────────────────────────────────────

export const HERRAMIENTAS: readonly Herramienta[] = [
  pantallasDisponibles,
  irA,
  guiaInteractiva,
  abrirTicketServicio,
  buscarConductores,
  buscarVehiculos,
  buscarClientes,
  buscarServicios,
  detalleServicio,
  resumenServicios,
  buscarTerceros,
  buscarMunicipios,
  buscarLugaresHerramienta,
  ...HERRAMIENTAS_LIQUIDACIONES,
  ...HERRAMIENTAS_FORMULARIOS,
  ...HERRAMIENTAS_ENVIOS,
  ...HERRAMIENTAS_RECARGOS,
  ...HERRAMIENTAS_ASISTENCIAS,
  ...HERRAMIENTAS_RECORRIDOS,
  ...HERRAMIENTAS_ACCIONES_CORRECTIVAS,
  ...HERRAMIENTAS_SARLAFT,
  ...HERRAMIENTAS_LIQUIDACIONES_TERCEROS,
  ...HERRAMIENTAS_NOMINA,
  ...HERRAMIENTAS_USUARIOS,
  ...HERRAMIENTAS_BUSCADOR,
  // Acciones (escriben): mismo permiso `full` que la ruta REST; en MCP van marcadas como no-solo-lectura.
  ...ACCIONES,
  ...ACCIONES_LIQUIDACIONES,
]

export function herramientasDisponibles(usuario: UsuarioAsistente, canal: Canal): Herramienta[] {
  return HERRAMIENTAS.filter((h) => puedeUsar(h, usuario, canal))
}

export function buscarHerramienta(nombre: string): Herramienta | undefined {
  return HERRAMIENTAS.find((h) => h.nombre === nombre)
}
