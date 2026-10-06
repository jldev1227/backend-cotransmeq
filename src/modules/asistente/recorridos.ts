import { prisma } from '../../config/prisma'
import { guardarRegistrosMasivosSchema } from '../dias-laborados/dias-laborados-admin.schema'
import { DiasLaboradosService } from '../dias-laborados/dias-laborados.service'
import type { Herramienta } from './asistente.types'
import { enteroEntre, fechaOpcional, textoOpcional } from './asistente.utils'
import { resolverCliente, resolverConductor, resolverVehiculo } from './acciones'

/**
 * Recorridos de conductores (días laborados: LABORADO, DISPONIBLE, DESCANSO,
 * MANTENIMIENTO, con sus tramos) en el asistente y el MCP.
 *
 * Las lecturas consultan Prisma directo (el servicio firma URLs de S3 de los
 * soportes de mantenimiento, que aquí sobran). La escritura usa el MISMO zod y
 * servicio que la carga por lote de la pantalla
 * (`guardarRegistrosMasivosSchema` + `guardarRegistrosMasivos`), que REEMPLAZA
 * los días tocados: por eso la herramienta primero mira si ya hay registros en
 * esas fechas y pide `reemplazar=true` antes de pisarlos.
 */

const MODULO = 'recorridos'
const TIPOS = ['LABORADO', 'DISPONIBLE', 'DESCANSO', 'MANTENIMIENTO'] as const
type Tipo = (typeof TIPOS)[number]

const diaUTC = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const iso = (d: Date) => d.toISOString().slice(0, 10)
const fechaDia = (d: Date) => d.toLocaleDateString('es-CO', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' })

function enteroOpcional(valor: unknown, min: number, max: number): number | undefined {
  if (valor === null || valor === undefined || valor === '') return undefined
  const n = Number(valor)
  return Number.isInteger(n) && n >= min && n <= max ? n : undefined
}

function enlaceCanvas(desde: string, hasta: string, conductorId?: string) {
  const q = new URLSearchParams({ desde, hasta })
  if (conductorId) q.set('conductor', conductorId)
  return `/dashboard/conductores/recorridos?${q.toString()}`
}

/** Rango pedido: mes/año, desde/hasta, o el mes en curso (Bogotá). */
function rango(args: Record<string, unknown>): { desde: string; hasta: string } | { error: string } {
  const desde = fechaOpcional(args.desde)
  const hasta = fechaOpcional(args.hasta)
  if (desde || hasta) {
    const d = desde ?? hasta!
    const h = hasta ?? desde!
    if (h < d) return { error: 'La fecha final es anterior a la inicial' }
    return { desde: d, hasta: h }
  }
  const hoy = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Bogota' }))
  const mes = enteroOpcional(args.mes, 1, 12) ?? hoy.getMonth() + 1
  const anio = enteroOpcional(args.anio, 2020, 2100) ?? hoy.getFullYear()
  return { desde: iso(new Date(Date.UTC(anio, mes - 1, 1))), hasta: iso(new Date(Date.UTC(anio, mes, 0))) }
}

const SELECT_DIA = {
  id: true,
  fecha: true,
  tipo: true,
  observaciones: true,
  pernocte: true,
  mantenimiento_vehiculo_placa: true,
  conductor: { select: { id: true, nombre: true, apellido: true, numero_identificacion: true } },
  segmentos: {
    where: { deleted_at: null },
    orderBy: { orden: 'asc' as const },
    select: {
      cliente_nombre: true,
      vehiculo_placa: true,
      hora_inicio: true,
      hora_fin: true,
      dias_offset_inicio: true,
      dias_offset_fin: true,
      horas_conducidas: true,
      km_inicial: true,
      km_final: true,
      pernocte: true,
      descripcion_servicio: true,
      cliente: { select: { nombre: true } },
      vehiculo: { select: { placa: true } },
    },
  },
} as const

type Dia = Awaited<ReturnType<typeof cargarDias>>[number]

async function cargarDias(desde: string, hasta: string, conductorId?: string) {
  return prisma.registro_dia_laboral.findMany({
    where: { deleted_at: null, fecha: { gte: diaUTC(desde), lte: diaUTC(hasta) }, ...(conductorId ? { conductor_id: conductorId } : {}) },
    select: SELECT_DIA,
    orderBy: [{ fecha: 'asc' }],
  })
}

function describirDia(d: Dia) {
  return {
    fecha: iso(d.fecha),
    dia: fechaDia(d.fecha),
    tipo: d.tipo.toLowerCase(),
    pernocte: d.pernocte || d.segmentos.some((s) => s.pernocte) || undefined,
    placa_mantenimiento: d.mantenimiento_vehiculo_placa || undefined,
    observaciones: d.observaciones || undefined,
    tramos: d.segmentos.map((s) => ({
      cliente: s.cliente?.nombre ?? s.cliente_nombre ?? undefined,
      placa: s.vehiculo?.placa ?? s.vehiculo_placa ?? undefined,
      horario: s.hora_inicio ? `${s.dias_offset_inicio ? `+${s.dias_offset_inicio}d ` : ''}${s.hora_inicio} – ${s.hora_fin ?? '?'}${s.dias_offset_fin ? ` (+${s.dias_offset_fin}d)` : ''}` : undefined,
      horas: Number(s.horas_conducidas) || undefined,
      km: s.km_inicial !== null && s.km_final !== null ? s.km_final - s.km_inicial : undefined,
      km_inicial: s.km_inicial ?? undefined,
      km_final: s.km_final ?? undefined,
      pernocte: s.pernocte || undefined,
      servicio: s.descripcion_servicio,
    })),
  }
}

interface Resumen {
  dias_registrados: number
  laborado: number
  disponible: number
  descanso: number
  mantenimiento: number
  horas_conducidas: number
  km_recorridos: number
  pernoctes: number
}

function resumir(dias: Dia[]): Resumen {
  const porTipo: Record<string, number> = { laborado: 0, disponible: 0, descanso: 0, mantenimiento: 0 }
  let horas = 0
  let km = 0
  let pernoctes = 0
  for (const d of dias) {
    porTipo[d.tipo.toLowerCase()] = (porTipo[d.tipo.toLowerCase()] ?? 0) + 1
    if (d.pernocte || d.segmentos.some((s) => s.pernocte)) pernoctes++
    for (const s of d.segmentos) {
      horas += Number(s.horas_conducidas) || 0
      if (s.km_inicial !== null && s.km_final !== null) km += s.km_final - s.km_inicial
    }
  }
  return {
    dias_registrados: dias.length,
    laborado: porTipo.laborado,
    disponible: porTipo.disponible,
    descanso: porTipo.descanso,
    mantenimiento: porTipo.mantenimiento,
    horas_conducidas: Math.round(horas * 10) / 10,
    km_recorridos: km,
    pernoctes,
  }
}

export const recorridosConductor: Herramienta = {
  nombre: 'recorridos_conductor',
  descripcion:
    'Trae los recorridos (días laborados) de UN conductor en un periodo: cada día con su tipo (laborado, disponible, descanso, mantenimiento) y sus tramos (cliente, placa, horario, horas conducidas, kilómetros, pernocte, descripción del servicio), más el resumen del periodo. Si no se da periodo, el mes en curso. Para comparar varios conductores usa resumen_recorridos.',
  parametros: {
    type: 'object',
    properties: {
      conductor: { type: 'string', description: 'Nombre o cédula del conductor' },
      mes: { type: 'integer', minimum: 1, maximum: 12 },
      anio: { type: 'integer', minimum: 2020, maximum: 2100 },
      desde: { type: 'string', description: 'Fecha inicial YYYY-MM-DD (alternativa a mes/año)' },
      hasta: { type: 'string', description: 'Fecha final YYYY-MM-DD, incluida' },
    },
    required: ['conductor'],
    additionalProperties: false,
  },
  etiqueta: 'Consultando los recorridos',
  requiere: MODULO,
  salidaMaxima: { lista: 70, caracteres: 40000 },
  async ejecutar(args) {
    const texto = textoOpcional(args.conductor, 80)
    if (!texto) return { error: 'Indica el conductor' }
    const r = rango(args)
    if ('error' in r) return r
    const rc = await resolverConductor(texto)
    if (rc.ok === false) return { error: rc.error, candidatos: rc.candidatos }
    const dias = await cargarDias(r.desde, r.hasta, rc.valor.id)
    return {
      conductor: `${rc.valor.nombre} ${rc.valor.apellido}`.trim(),
      cedula: rc.valor.numero_identificacion,
      periodo: `${r.desde} a ${r.hasta}`,
      resumen: resumir(dias),
      dias: dias.map(describirDia),
      enlace: enlaceCanvas(r.desde, r.hasta, rc.valor.id),
    }
  },
}

export const resumenRecorridos: Herramienta = {
  nombre: 'resumen_recorridos',
  descripcion:
    'Resume los recorridos de TODOS los conductores en un periodo (por defecto el mes en curso): por conductor, días laborados, disponibles, de descanso y de mantenimiento, horas conducidas, kilómetros y pernoctes; y los totales. Útil para «¿quién tiene más días laborados?», «¿quién no ha registrado recorridos?» o «¿cuántas horas condujo cada uno?». Puede filtrarse por cliente o placa.',
  parametros: {
    type: 'object',
    properties: {
      mes: { type: 'integer', minimum: 1, maximum: 12 },
      anio: { type: 'integer', minimum: 2020, maximum: 2100 },
      desde: { type: 'string', description: 'Fecha inicial YYYY-MM-DD (alternativa a mes/año)' },
      hasta: { type: 'string', description: 'Fecha final YYYY-MM-DD, incluida' },
      cliente: { type: 'string', description: 'Solo tramos de este cliente' },
      placa: { type: 'string', description: 'Solo tramos con esta placa' },
      limite: { type: 'integer', minimum: 1, maximum: 200 },
    },
    additionalProperties: false,
  },
  etiqueta: 'Resumiendo los recorridos',
  requiere: MODULO,
  salidaMaxima: { lista: 200, caracteres: 45000 },
  async ejecutar(args) {
    const r = rango(args)
    if ('error' in r) return r
    const cliente = textoOpcional(args.cliente, 120)?.toLowerCase()
    const placa = textoOpcional(args.placa, 20)?.replace(/[\s-]/g, '').toUpperCase()
    const limite = enteroEntre(args.limite, 1, 200, 200)

    let dias = await cargarDias(r.desde, r.hasta)
    if (cliente || placa) {
      dias = dias
        .map((d) => ({
          ...d,
          segmentos: d.segmentos.filter(
            (s) =>
              (!cliente || `${s.cliente?.nombre ?? ''} ${s.cliente_nombre ?? ''}`.toLowerCase().includes(cliente)) &&
              (!placa || `${s.vehiculo?.placa ?? ''}${s.vehiculo_placa ?? ''}`.toUpperCase().includes(placa)),
          ),
        }))
        .filter((d) => d.segmentos.length > 0)
    }

    const porConductor = new Map<string, { nombre: string; cedula: string; dias: Dia[] }>()
    for (const d of dias) {
      const c = porConductor.get(d.conductor.id) ?? { nombre: `${d.conductor.nombre} ${d.conductor.apellido}`.trim(), cedula: d.conductor.numero_identificacion, dias: [] }
      c.dias.push(d)
      porConductor.set(d.conductor.id, c)
    }
    const conductores = [...porConductor.entries()]
      .map(([id, c]) => ({ conductor: c.nombre, cedula: c.cedula, ...resumir(c.dias), enlace: enlaceCanvas(r.desde, r.hasta, id) }))
      .sort((a, b) => b.laborado - a.laborado || b.horas_conducidas - a.horas_conducidas)

    return {
      periodo: `${r.desde} a ${r.hasta}`,
      filtros: { cliente: cliente || undefined, placa: placa || undefined },
      totales: { conductores_con_registros: conductores.length, ...resumir(dias) },
      conductores: conductores.slice(0, limite),
      enlace: enlaceCanvas(r.desde, r.hasta),
    }
  },
}

export const registrarRecorridos: Herramienta = {
  nombre: 'registrar_recorridos',
  descripcion:
    'Registra recorridos (días laborados) de un conductor en un mes, por patrones: cada patrón es un tipo de día (LABORADO, DISPONIBLE, DESCANSO o MANTENIMIENTO) con las fechas en que aplica (lista YYYY-MM-DD o desde/hasta) y, para LABORADO/DISPONIBLE, el tramo: cliente, placa, hora inicio y fin (HH:MM), kilómetros, pernocte y descripción del servicio. Todas las fechas deben ser del mismo mes. Recibe nombres y resuelve ids. Reemplaza lo que ya haya en esas fechas: si existen registros avisa y no escribe salvo reemplazar=true. Antes de llamarla muestra UN resumen (conductor, mes, qué días quedan de cada tipo, con qué cliente/placa/horario) y pregunta «¿Lo registro así?»; con la confirmación pasa confirmado=true.',
  parametros: {
    type: 'object',
    properties: {
      confirmado: { type: 'boolean', description: 'true SOLO después de que el usuario confirmó el resumen' },
      conductor: { type: 'string', description: 'Nombre o cédula' },
      mes: { type: 'integer', minimum: 1, maximum: 12 },
      anio: { type: 'integer', minimum: 2020, maximum: 2100 },
      reemplazar: { type: 'boolean', description: 'true si el usuario aceptó sobrescribir los días que ya tenían registro' },
      patrones: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            tipo: { type: 'string', enum: [...TIPOS] },
            fechas: { type: 'array', items: { type: 'string' }, description: 'Fechas YYYY-MM-DD; alternativa: desde/hasta' },
            desde: { type: 'string', description: 'YYYY-MM-DD; con hasta expande todas las fechas del rango' },
            hasta: { type: 'string' },
            cliente: { type: 'string', description: 'Cliente del tramo (LABORADO/DISPONIBLE)' },
            placa: { type: 'string' },
            hora_inicio: { type: 'string', description: 'HH:MM' },
            hora_fin: { type: 'string', description: 'HH:MM, posterior a la de inicio' },
            km_inicial: { type: 'integer' },
            km_final: { type: 'integer' },
            pernocte: { type: 'boolean' },
            descripcion_servicio: { type: 'string', description: 'Qué hizo ese día (ruta, actividad). Si falta se usa el cliente' },
            observaciones: { type: 'string' },
            placa_mantenimiento: { type: 'string', description: 'Obligatoria si el tipo es MANTENIMIENTO' },
          },
          required: ['tipo'],
          additionalProperties: false,
        },
      },
    },
    required: ['confirmado', 'conductor', 'mes', 'anio', 'patrones'],
    additionalProperties: false,
  },
  etiqueta: 'Registrando los recorridos',
  requiere: MODULO,
  nivel: 'full',
  escribe: true,
  async ejecutar(args) {
    if (args.confirmado !== true) return { error: 'Falta la confirmación del usuario: muéstrale el resumen y pregúntale si lo registras' }
    const texto = textoOpcional(args.conductor, 80)
    const mes = enteroOpcional(args.mes, 1, 12)
    const anio = enteroOpcional(args.anio, 2020, 2100)
    if (!texto || !mes || !anio) return { error: 'Faltan el conductor, el mes o el año' }
    const entrada = Array.isArray(args.patrones) ? (args.patrones as Record<string, unknown>[]) : []
    if (entrada.length === 0) return { error: 'No hay patrones que registrar' }

    const rc = await resolverConductor(texto)
    if (rc.ok === false) return { creado: false, error: rc.error, candidatos: rc.candidatos }

    const problemas: string[] = []
    const prefijo = `${anio}-${String(mes).padStart(2, '0')}-`
    const cacheClientes = new Map<string, Awaited<ReturnType<typeof resolverCliente>>>()
    const cacheVehiculos = new Map<string, Awaited<ReturnType<typeof resolverVehiculo>>>()
    const patrones: Record<string, unknown>[] = []

    for (const [i, p] of entrada.entries()) {
      const tipo = typeof p.tipo === 'string' && (TIPOS as readonly string[]).includes(p.tipo.toUpperCase()) ? (p.tipo.toUpperCase() as Tipo) : undefined
      if (!tipo) {
        problemas.push(`Patrón ${i + 1}: tipo desconocido «${String(p.tipo)}»`)
        continue
      }
      const fechas = new Set<string>(Array.isArray(p.fechas) ? p.fechas.map((f) => fechaOpcional(f)).filter((f): f is string => !!f) : [])
      const desde = fechaOpcional(p.desde)
      const hasta = fechaOpcional(p.hasta)
      if (desde) {
        for (let d = diaUTC(desde); iso(d) <= (hasta ?? desde); d.setUTCDate(d.getUTCDate() + 1)) fechas.add(iso(d))
      }
      if (fechas.size === 0) problemas.push(`Patrón ${i + 1} (${tipo}): sin fechas`)
      const fuera = [...fechas].filter((f) => !f.startsWith(prefijo))
      if (fuera.length) problemas.push(`Patrón ${i + 1}: fechas fuera de ${mes}/${anio}: ${fuera.join(', ')}`)

      const patron: Record<string, unknown> = { tipo, fechas: [...fechas].sort(), observaciones: textoOpcional(p.observaciones, 500) ?? null }

      if (tipo === 'MANTENIMIENTO') {
        const placa = textoOpcional(p.placa_mantenimiento ?? p.placa, 20)
        if (!placa) problemas.push(`Patrón ${i + 1}: un mantenimiento necesita la placa`)
        else {
          const rv = cacheVehiculos.get(placa) ?? (await resolverVehiculo(placa))
          cacheVehiculos.set(placa, rv)
          if (rv.ok === false) problemas.push(`Patrón ${i + 1}: ${rv.error}`)
          else patron.mantenimiento_vehiculo_placa = rv.valor.placa
        }
      }

      if (tipo === 'LABORADO' || tipo === 'DISPONIBLE') {
        const segmento: Record<string, unknown> = { pernocte: p.pernocte === true }
        const cliente = textoOpcional(p.cliente, 120)
        if (cliente) {
          const rcl = cacheClientes.get(cliente) ?? (await resolverCliente(cliente))
          cacheClientes.set(cliente, rcl)
          if (rcl.ok === false) problemas.push(`Patrón ${i + 1}: ${rcl.error}`)
          else {
            segmento.cliente_id = rcl.valor.id
            segmento.cliente_nombre = rcl.valor.nombre
          }
        }
        const placa = textoOpcional(p.placa, 20)
        if (placa) {
          const rv = cacheVehiculos.get(placa) ?? (await resolverVehiculo(placa))
          cacheVehiculos.set(placa, rv)
          if (rv.ok === false) problemas.push(`Patrón ${i + 1}: ${rv.error}`)
          else {
            segmento.vehiculo_id = rv.valor.id
            segmento.vehiculo_placa = rv.valor.placa
          }
        }
        const hi = textoOpcional(p.hora_inicio, 5)
        const hf = textoOpcional(p.hora_fin, 5)
        if (hi) segmento.hora_inicio = hi
        if (hf) segmento.hora_fin = hf
        if (hi && hf) {
          const [a, b] = [hi, hf].map((h) => {
            const [hh, mm] = h.split(':').map(Number)
            return hh * 60 + (mm || 0)
          })
          if (b > a) segmento.horas_conducidas = Math.round(((b - a) / 60) * 10) / 10
          else problemas.push(`Patrón ${i + 1}: la hora fin ${hf} no es posterior a ${hi}`)
        }
        if (typeof p.km_inicial === 'number') segmento.km_inicial = p.km_inicial
        if (typeof p.km_final === 'number') segmento.km_final = p.km_final
        segmento.descripcion_servicio =
          textoOpcional(p.descripcion_servicio, 500) ?? (tipo === 'DISPONIBLE' ? 'Disponibilidad' : (segmento.cliente_nombre as string | undefined) ?? 'Recorrido registrado desde el asistente')
        patron.segmento = segmento
      }
      patrones.push(patron)
    }
    if (problemas.length) return { creado: false, problemas }

    const fechasTocadas = [...new Set(patrones.flatMap((p) => p.fechas as string[]))].sort()
    const existentes = await prisma.registro_dia_laboral.findMany({
      where: { conductor_id: rc.valor.id, deleted_at: null, fecha: { in: fechasTocadas.map(diaUTC) } },
      select: { fecha: true, tipo: true },
      orderBy: { fecha: 'asc' },
    })
    if (existentes.length && args.reemplazar !== true) {
      return {
        creado: false,
        ya_registrados: existentes.map((e) => ({ fecha: iso(e.fecha), tipo: e.tipo.toLowerCase() })),
        pista: 'Esas fechas ya tienen registro. Pregunta al usuario si los reemplaza (reemplazar=true) o si quita esas fechas',
      }
    }

    const parsed = guardarRegistrosMasivosSchema.safeParse({ conductor_id: rc.valor.id, mes, anio, patrones })
    if (!parsed.success) {
      return { creado: false, problemas: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) }
    }
    const resultado = await DiasLaboradosService.guardarRegistrosMasivos(parsed.data)
    const { resumen } = resultado
    return {
      creado: true,
      conductor: resumen.conductor_nombre,
      periodo: `${mes}/${anio}`,
      registrados: {
        total: resumen.total_creados,
        laborados: resumen.registros_laborado_creados,
        disponibles: resumen.registros_disponible_creados,
        descansos: resumen.registros_descanso_creados,
        mantenimiento: resumen.registros_mantenimiento_creados,
        reemplazados: existentes.length,
      },
      fechas: fechasTocadas,
      enlace: enlaceCanvas(fechasTocadas[0], fechasTocadas[fechasTocadas.length - 1], rc.valor.id),
    }
  },
}

export const HERRAMIENTAS_RECORRIDOS: readonly Herramienta[] = [recorridosConductor, resumenRecorridos, registrarRecorridos]
