import { prisma } from '../../config/prisma'
import type { Herramienta } from './asistente.types'
import { conYSinTildes, enteroEntre, fechaCorta, fechaOpcional, textoOpcional } from './asistente.utils'

/**
 * Nómina de conductores (liquidaciones de nómina, tabla `liquidaciones`) en el
 * asistente y el MCP. Solo lectura: el canvas de nómina es donde se liquida.
 * Sirve para que, desde el canvas, el asistente responda «¿qué falta por
 * liquidar?», «¿cuánto se pagó en el periodo?» o «¿qué devengó X?».
 */

const MODULO = 'nomina'
const LIMITE_MAXIMO = 500
const ESTADOS = ['Pendiente', 'Liquidado'] as const

const n = (v: unknown) => Math.round(Number(v ?? 0) * 100) / 100
const enlaceCanvas = (l: { id: string; periodo_start: string; periodo_end: string }) =>
  `/dashboard/nomina/canvas?inicio=${l.periodo_start}&fin=${l.periodo_end}&liquidacion=${l.id}`

export const buscarNomina: Herramienta = {
  nombre: 'buscar_nomina',
  descripcion:
    'Lista liquidaciones de nómina de conductores por periodo (inicio/fin o un mes), conductor y estado (Pendiente o Liquidado), con sus valores: días laborados, salario devengado, recargos, bonificaciones, pernoctes, auxilio de transporte, vacaciones, incapacidad, anticipos, salud, pensión y sueldo total (neto). Incluye los totales del conjunto filtrado y el enlace al canvas. Úsala para «¿qué nóminas faltan por liquidar?», «¿cuánto se pagó en el periodo del 21 de agosto al 20 de septiembre?», «¿cuánto devengó X en septiembre?».',
  parametros: {
    type: 'object',
    properties: {
      conductor: { type: 'string', description: 'Nombre o cédula' },
      estado: { type: 'string', enum: [...ESTADOS] },
      inicio: { type: 'string', description: 'Inicio del periodo YYYY-MM-DD (exacto o aproximado: se buscan periodos que empiecen ese mes)' },
      fin: { type: 'string', description: 'Fin del periodo YYYY-MM-DD' },
      mes: { type: 'integer', minimum: 1, maximum: 12, description: 'Mes en que termina el periodo, alternativa a inicio/fin' },
      anio: { type: 'integer', minimum: 2020, maximum: 2100 },
      limite: { type: 'integer', minimum: 1, maximum: LIMITE_MAXIMO, description: 'Hasta 500' },
    },
    additionalProperties: false,
  },
  etiqueta: 'Consultando la nómina',
  requiere: MODULO,
  async ejecutar(args) {
    const conductor = textoOpcional(args.conductor, 80)
    const estado = typeof args.estado === 'string' && (ESTADOS as readonly string[]).includes(args.estado) ? (args.estado as (typeof ESTADOS)[number]) : undefined
    const inicio = fechaOpcional(args.inicio)
    const fin = fechaOpcional(args.fin)
    const mes = Number(args.mes)
    const anio = Number(args.anio)
    const limite = enteroEntre(args.limite, 1, LIMITE_MAXIMO, 50)
    const contiene = (q: string) => ({ contains: q, mode: 'insensitive' as const })

    const where = {
      deleted_at: null,
      ...(estado ? { estado } : {}),
      ...(inicio ? { periodo_start: { startsWith: inicio.slice(0, 7) } } : {}),
      ...(fin ? { periodo_end: { startsWith: fin.slice(0, 7) } } : {}),
      ...(!inicio && !fin && Number.isInteger(mes) && mes >= 1 && mes <= 12
        ? { periodo_end: { startsWith: `${Number.isInteger(anio) && anio >= 2020 ? anio : new Date().getFullYear()}-${String(mes).padStart(2, '0')}` } }
        : {}),
      ...(conductor
        ? { AND: conductor.split(/\s+/).map((p) => ({ OR: conYSinTildes(p).flatMap((x) => [{ conductores: { nombre: contiene(x) } }, { conductores: { apellido: contiene(x) } }, { conductores: { numero_identificacion: { contains: x } } }]) })) }
        : {}),
    }
    const [filas, total] = await Promise.all([
      prisma.liquidaciones.findMany({
        where,
        select: {
          id: true,
          estado: true,
          periodo_start: true,
          periodo_end: true,
          dias_laborados: true,
          salario_devengado: true,
          total_recargos: true,
          total_bonificaciones: true,
          total_pernotes: true,
          auxilio_transporte: true,
          total_vacaciones: true,
          valor_incapacidad: true,
          total_anticipos: true,
          salud: true,
          pension: true,
          sueldo_total: true,
          fecha_liquidacion: true,
          observaciones: true,
          conductores: { select: { nombre: true, apellido: true, numero_identificacion: true } },
        },
        orderBy: [{ periodo_end: 'desc' }, { created_at: 'desc' }],
        take: limite,
      }),
      prisma.liquidaciones.count({ where }),
    ])
    const suma = (f: (l: (typeof filas)[number]) => unknown) => n(filas.reduce((s, l) => s + Number(f(l) ?? 0), 0))
    return {
      total,
      mostradas: filas.length,
      totales_de_lo_mostrado: {
        salario_devengado: suma((l) => l.salario_devengado),
        recargos: suma((l) => l.total_recargos),
        bonificaciones: suma((l) => l.total_bonificaciones),
        pernoctes: suma((l) => l.total_pernotes),
        sueldo_total: suma((l) => l.sueldo_total),
        pendientes: filas.filter((l) => l.estado === 'Pendiente').length,
      },
      liquidaciones: filas.map((l) => ({
        conductor: l.conductores ? `${l.conductores.nombre} ${l.conductores.apellido}`.trim() : 'sin conductor',
        cedula: l.conductores?.numero_identificacion,
        periodo: `${l.periodo_start} a ${l.periodo_end}`,
        estado: l.estado.toLowerCase(),
        dias_laborados: l.dias_laborados,
        salario_devengado: n(l.salario_devengado),
        recargos: n(l.total_recargos),
        bonificaciones: n(l.total_bonificaciones),
        pernoctes: n(l.total_pernotes),
        auxilio_transporte: n(l.auxilio_transporte),
        vacaciones: n(l.total_vacaciones) || undefined,
        incapacidad: n(l.valor_incapacidad) || undefined,
        anticipos: n(l.total_anticipos) || undefined,
        salud: n(l.salud),
        pension: n(l.pension),
        sueldo_total: n(l.sueldo_total),
        liquidada: fechaCorta(l.fecha_liquidacion),
        observaciones: l.observaciones || undefined,
        enlace: enlaceCanvas(l),
      })),
    }
  },
}

/**
 * Abre en pantalla el desprendible de un conductor. El asistente solo sabe
 * navegar: el canvas de nómina entiende `?desprendible=<liquidacionId>`, va a
 * esa hoja y abre el mismo PDF del botón «Ver desprendible» del carril.
 */
export const abrirDesprendible: Herramienta = {
  nombre: 'abrir_desprendible',
  descripcion:
    'Abre en pantalla el desprendible de nómina de un conductor (el mismo PDF que recibe él). Busca su liquidación más reciente o la del periodo indicado y lleva al canvas de nómina con el desprendible abierto. Úsala para «muéstrame / ábreme el desprendible de Mónica». Si hay varios conductores con ese nombre devuelve candidatos.',
  parametros: {
    type: 'object',
    properties: {
      conductor: { type: 'string', description: 'Nombre o cédula del conductor' },
      mes: { type: 'integer', minimum: 1, maximum: 12, description: 'Mes en que termina el periodo, si el usuario lo dijo' },
      anio: { type: 'integer', minimum: 2020, maximum: 2100 },
    },
    required: ['conductor'],
    additionalProperties: false,
  },
  etiqueta: 'Abriendo el desprendible',
  requiere: MODULO,
  canales: ['app'],
  async ejecutar(args) {
    const texto = textoOpcional(args.conductor, 80)
    if (!texto) return { error: 'Indica el conductor' }
    const mes = Number(args.mes)
    const anio = Number(args.anio)
    const contiene = (q: string) => ({ contains: q, mode: 'insensitive' as const })
    const filas = await prisma.liquidaciones.findMany({
      where: {
        deleted_at: null,
        AND: texto.split(/\s+/).filter(Boolean).map((p) => ({
          OR: conYSinTildes(p).flatMap((x) => [{ conductores: { nombre: contiene(x) } }, { conductores: { apellido: contiene(x) } }, { conductores: { numero_identificacion: { contains: x } } }]),
        })),
        ...(Number.isInteger(mes) && mes >= 1 && mes <= 12
          ? { periodo_end: { startsWith: `${Number.isInteger(anio) && anio >= 2020 ? anio : new Date().getFullYear()}-${String(mes).padStart(2, '0')}` } }
          : {}),
      },
      select: { id: true, periodo_start: true, periodo_end: true, estado: true, conductor_id: true, conductores: { select: { nombre: true, apellido: true, numero_identificacion: true } } },
      orderBy: [{ periodo_end: 'desc' }, { created_at: 'desc' }],
      take: 20,
    })
    if (filas.length === 0) return { error: `No encontré liquidaciones de nómina de «${texto}»${mes ? ' en ese periodo' : ''}` }
    const conductores = new Map(filas.map((f) => [f.conductor_id, f]))
    if (conductores.size > 1) {
      return {
        error: 'Hay varios conductores con ese nombre; pregunta cuál',
        candidatos: [...conductores.values()].map((f) => ({ conductor: `${f.conductores?.nombre} ${f.conductores?.apellido}`.trim(), cedula: f.conductores?.numero_identificacion })),
      }
    }
    const l = filas[0]
    const q = new URLSearchParams({ inicio: l.periodo_start, fin: l.periodo_end, liquidacion: l.id, desprendible: l.id })
    return {
      navegar: `/dashboard/nomina/canvas?${q.toString()}`,
      conductor: `${l.conductores?.nombre} ${l.conductores?.apellido}`.trim(),
      periodo: `${l.periodo_start} a ${l.periodo_end}`,
      estado: l.estado.toLowerCase(),
    }
  },
}

export const HERRAMIENTAS_NOMINA: readonly Herramienta[] = [buscarNomina, abrirDesprendible]
