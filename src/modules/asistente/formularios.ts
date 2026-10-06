import { Prisma } from '@prisma/client'
import { prisma } from '../../config/prisma'
import type { Herramienta } from './asistente.types'
import { enteroEntre, fechaCorta, fechaOpcional, textoOpcional } from './asistente.utils'

/**
 * Formularios dinámicos (preoperacionales, inspecciones, reportes) en el asistente.
 *
 * Una sola herramienta de lectura, `resumen_formularios`, para preguntas como
 * «¿cuántos preoperacionales se diligenciaron el fin de semana?» o «¿quién no
 * ha enviado la inspección de extintores este mes?». Antes no había ninguna y
 * el modelo improvisaba instrucciones con filtros que la pantalla no tiene.
 *
 * Detalles que importan:
 *   - El formulario se elige por nombre o código y puede casar con VARIOS: hay
 *     dos preoperacionales (FR-08 livianos, FR-09 buses). Se suman y se
 *     desglosan, y se dice cuáles se contaron.
 *   - Las fechas son de NEGOCIO (`business_date`), las mismas que usan los
 *     filtros «Desde/Hasta» del explorador de envíos; así la cifra cuadra con
 *     la pantalla del enlace.
 *   - Por defecto solo cuenta ENTREGADOS. Un borrador no es un envío y uno
 *     anulado tampoco; se pueden pedir aparte.
 *   - Los descartados (`deleted_at`) nunca cuentan, igual que en el explorador.
 *
 * Permiso: el módulo `formularios` en cualquier nivel (operaciones lo tiene en
 * lectura precisamente para consultar preoperacionales del día).
 */

const MODULO = 'formularios'
const ESTADOS = ['SUBMITTED', 'DRAFT', 'VOIDED'] as const
type Estado = (typeof ESTADOS)[number]
const ETIQUETA_ESTADO: Record<Estado, string> = {
  SUBMITTED: 'entregado',
  DRAFT: 'borrador',
  VOIDED: 'anulado',
}
const MAX_DIAS = 366

function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

/** Hoy en Bogotá como YYYY-MM-DD: la fecha de negocio se calcula en esa zona. */
function hoyBogota(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date())
}

const diaUTC = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const iso = (d: Date) => d.toISOString().slice(0, 10)

/// `business_date` es una fecha de calendario guardada a medianoche UTC.
/// `fechaCorta` formatea en hora de Bogotá y la corría al día anterior: el
/// sábado 3 salía como «2 oct». Una fecha sin hora se lee en UTC.
function fechaDia(d: Date | string): string {
  const fecha = typeof d === 'string' ? diaUTC(d) : d
  return fecha.toLocaleDateString('es-CO', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  })
}

/**
 * Formularios cuyo código o nombre contiene TODAS las palabras buscadas,
 * sin tildes. «preoperacional» casa con los dos preoperacionales; «fr-08» o
 * «hseq-fr-08» con el de livianos; «extintores» con su inspección.
 */
export async function resolverFormularios(busqueda: string | undefined) {
  const todos = await prisma.form_definition.findMany({
    where: { deleted_at: null },
    select: { id: true, code: true, name: true },
    orderBy: { code: 'asc' },
  })
  if (!busqueda) return { todos, elegidos: todos }
  const palabras = normalizar(busqueda)
    .split(/\s+/)
    .map((p) => p.replace(/^hseq-?/, ''))
    .filter((p) => p.length > 1 && !['de', 'del', 'la', 'el', 'los', 'las', 'formulario', 'formularios'].includes(p))
  /// «formularios dinámicos», «cualquier formulario», «todos»: sin un formulario
  /// concreto se cuentan TODOS. Sin esto la búsqueda quedaba en «dinamicos» y
  /// no casaba con ningún nombre.
  const GENERICAS = ['dinamico', 'dinamicos', 'todos', 'todas', 'cualquier', 'cualquiera', 'ninguno', 'alguno']
  if (palabras.length === 0 || palabras.every((p) => GENERICAS.includes(p))) return { todos, elegidos: todos }
  const elegidos = todos.filter((f) => {
    const texto = normalizar(`${f.code} ${f.name}`)
    return palabras.every((p) => texto.includes(p) || (p.endsWith('es') && texto.includes(p.slice(0, -2))) || (p.endsWith('s') && texto.includes(p.slice(0, -1))))
  })
  return { todos, elegidos }
}

export const resumenFormularios: Herramienta = {
  nombre: 'resumen_formularios',
  descripcion:
    'Cuenta y resume los envíos de formularios dinámicos (preoperacionales, inspecciones, reportes de falla, PQRSAF…) en un rango de fechas: total, desglose por formulario, por día y por estado, quién envió más y los últimos envíos con enlace. Úsala para «¿cuántos preoperacionales se hicieron…?», «¿quién envió la inspección de…?», «¿cuántos borradores quedaron…?». El formulario se busca por nombre o código y puede abarcar varios (p. ej. «preoperacional» cubre los de livianos y de buses).',
  parametros: {
    type: 'object',
    properties: {
      formulario: {
        type: 'string',
        description: 'Nombre o código del formulario tal como lo dice el usuario (p. ej. «preoperacional», «extintores», «FR-08»). Vacío = todos los formularios.',
      },
      desde: { type: 'string', description: 'Fecha inicial YYYY-MM-DD (fecha del formulario). Por defecto, hoy.' },
      hasta: { type: 'string', description: 'Fecha final YYYY-MM-DD, incluida. Por defecto, igual a desde.' },
      estado: {
        type: 'string',
        enum: [...ESTADOS, 'TODOS'],
        description: 'SUBMITTED (entregados, por defecto), DRAFT (borradores), VOIDED (anulados) o TODOS.',
      },
      conductor_o_placa: { type: 'string', description: 'Opcional: filtra por nombre o cédula del conductor o por placa.' },
      limite: { type: 'integer', minimum: 0, maximum: 20, description: 'Cuántos envíos recientes listar (por defecto 8).' },
    },
    additionalProperties: false,
  },
  etiqueta: 'Contando formularios',
  requiere: MODULO,
  async ejecutar(args) {
    const hoy = hoyBogota()
    let desde = fechaOpcional(args.desde) ?? hoy
    let hasta = fechaOpcional(args.hasta) ?? desde
    if (hasta < desde) [desde, hasta] = [hasta, desde]
    const dias = Math.round((diaUTC(hasta).getTime() - diaUTC(desde).getTime()) / 86_400_000) + 1
    if (dias > MAX_DIAS) {
      return { error: `El rango es de ${dias} días; el máximo es ${MAX_DIAS}. Pide un periodo más corto.` }
    }
    const estadoArg = typeof args.estado === 'string' ? args.estado : 'SUBMITTED'
    const estados: Estado[] = estadoArg === 'TODOS' ? [...ESTADOS] : (ESTADOS as readonly string[]).includes(estadoArg) ? [estadoArg as Estado] : ['SUBMITTED']
    const busqueda = textoOpcional(args.formulario, 120)
    const persona = textoOpcional(args.conductor_o_placa, 80)
    const limite = enteroEntre(args.limite, 0, 20, 8)

    const { todos, elegidos } = await resolverFormularios(busqueda)
    if (elegidos.length === 0) {
      return {
        total: 0,
        aviso: `Ningún formulario coincide con «${busqueda}».`,
        formularios_existentes: todos.map((f) => `${f.code} — ${f.name}`),
      }
    }
    const formIds = elegidos.map((f) => f.id)

    const where: Prisma.form_submissionWhereInput = {
      deleted_at: null,
      status: { in: estados },
      business_date: { gte: diaUTC(desde), lte: diaUTC(hasta) },
      version: { form_id: { in: formIds } },
      ...(persona
        ? {
            OR: [
              { conductor: { nombre: { contains: persona, mode: 'insensitive' } } },
              { conductor: { apellido: { contains: persona, mode: 'insensitive' } } },
              { conductor: { numero_identificacion: { contains: persona } } },
              { usuario: { nombre: { contains: persona, mode: 'insensitive' } } },
              { vehiculo: { placa: { contains: persona.replace(/[\s-]/g, ''), mode: 'insensitive' } } },
            ],
          }
        : {}),
    }

    /// Para el desglose se traen solo las columnas que se agrupan. Un rango de
    /// un año de toda la flota son unos pocos miles de filas: cabe sin SQL a
    /// mano, y el `where` es el mismo que el del listado.
    const filas = await prisma.form_submission.findMany({
      where,
      select: {
        status: true,
        business_date: true,
        version: { select: { form_id: true } },
        conductor: { select: { nombre: true, apellido: true } },
        usuario: { select: { nombre: true } },
        vehiculo: { select: { placa: true } },
      },
    })

    const porFormulario = new Map<string, number>()
    const porDia = new Map<string, number>()
    const porEstado = new Map<string, number>()
    const porPersona = new Map<string, number>()
    const placas = new Set<string>()
    for (const f of filas) {
      porFormulario.set(f.version.form_id, (porFormulario.get(f.version.form_id) ?? 0) + 1)
      const d = iso(f.business_date)
      porDia.set(d, (porDia.get(d) ?? 0) + 1)
      porEstado.set(f.status, (porEstado.get(f.status) ?? 0) + 1)
      const quien = f.conductor ? `${f.conductor.nombre} ${f.conductor.apellido}`.trim() : f.usuario?.nombre
      if (quien) porPersona.set(quien, (porPersona.get(quien) ?? 0) + 1)
      if (f.vehiculo?.placa) placas.add(f.vehiculo.placa)
    }

    const recientes =
      limite > 0
        ? await prisma.form_submission.findMany({
            where,
            select: {
              id: true,
              status: true,
              business_date: true,
              submitted_at: true,
              version: { select: { form: { select: { code: true } } } },
              conductor: { select: { nombre: true, apellido: true } },
              usuario: { select: { nombre: true } },
              vehiculo: { select: { placa: true } },
            },
            orderBy: [{ submitted_at: { sort: 'desc', nulls: 'last' } }, { started_at: 'desc' }],
            take: limite,
          })
        : []

    /// El enlace abre el explorador con los mismos filtros. `formId` solo
    /// admite uno: con varios formularios se abre sin él y se dice.
    const params = new URLSearchParams({ vista: 'envios', desde, hasta })
    if (formIds.length === 1) params.set('formId', formIds[0])
    if (estados.length === 1) params.set('estado', estados[0])
    if (persona) params.set('q', persona)

    const nombreDe = new Map(elegidos.map((f) => [f.id, `${f.code} — ${f.name}`]))
    return {
      rango: desde === hasta ? fechaDia(desde) : `${fechaDia(desde)} a ${fechaDia(hasta)}`,
      dias,
      estados_contados: estados.map((e) => ETIQUETA_ESTADO[e]),
      formularios_contados: elegidos.map((f) => `${f.code} — ${f.name}`),
      total: filas.length,
      vehiculos_distintos: placas.size,
      personas_distintas: porPersona.size,
      por_formulario: elegidos
        .map((f) => ({ formulario: nombreDe.get(f.id), envios: porFormulario.get(f.id) ?? 0 }))
        .filter((x) => x.envios > 0 || elegidos.length <= 4),
      por_dia: [...porDia.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([dia, envios]) => ({ dia: fechaDia(dia), envios })),
      por_estado: [...porEstado.entries()].map(([e, n]) => ({ estado: ETIQUETA_ESTADO[e as Estado] ?? e, envios: n })),
      quienes_mas_enviaron: [...porPersona.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([nombre, envios]) => ({ nombre, envios })),
      ultimos_envios: recientes.map((r) => ({
        formulario: r.version.form.code,
        quien: r.conductor ? `${r.conductor.nombre} ${r.conductor.apellido}`.trim() : (r.usuario?.nombre ?? '—'),
        placa: r.vehiculo?.placa ?? null,
        fecha: fechaDia(r.business_date),
        estado: ETIQUETA_ESTADO[r.status as Estado] ?? r.status,
        enlace: `/dashboard/formularios/envios/${r.id}`,
      })),
      enlace_explorador: `/dashboard/formularios?${params.toString()}`,
      ...(formIds.length > 1 ? { nota_enlace: 'El explorador filtra por un formulario a la vez: el enlace abre el rango de fechas con todos.' } : {}),
    }
  },
}


/** Inicio del día en Bogotá (UTC-5, sin horario de verano) como instante. */
const inicioBogota = (dia: string) => new Date(`${dia}T00:00:00-05:00`)
function primeroDeMesBogota(): string {
  return `${hoyBogota().slice(0, 8)}01`
}

/**
 * Cruce conductores × servicios × formularios.
 *
 * Responde «¿qué conductores tuvieron servicios pero no enviaron el
 * preoperacional?» en una sola llamada. Antes el modelo intentaba cruzarlo con
 * `buscar_servicios`, que devuelve 25 por llamada y no pagina: con 311
 * servicios no podía terminar y acababa inventando progreso.
 *
 * Tres consultas agrupadas, sin traer filas sueltas:
 *   1. servicios no cancelados del rango agrupados por conductor (la fecha del
 *      servicio es la de realización; si no la tiene, la de solicitud);
 *   2. envíos ENTREGADOS del formulario agrupados por conductor (fecha de negocio);
 *   3. los datos de los conductores que salieron en (1).
 */
export const cumplimientoFormularios: Herramienta = {
  nombre: 'cumplimiento_formularios',
  descripcion:
    'Cruza los conductores que tuvieron servicios en un rango de fechas con los formularios que enviaron (por defecto el preoperacional). Devuelve quiénes tuvieron servicios y NO enviaron ninguno, o la cobertura de todos (servicios vs envíos). Úsala para «¿qué conductores no han hecho el preoperacional y sí tienen servicios?», «¿quién tiene menos preoperacionales que servicios?». Hace todo el cruce en una sola llamada: no hace falta buscar servicios aparte.',
  parametros: {
    type: 'object',
    properties: {
      formulario: {
        type: 'string',
        description:
          'Nombre o código del formulario. Por defecto «preoperacional» (cubre los de livianos y de buses). Usa «todos» si el usuario habla de formularios en general («formularios dinámicos», «ningún formulario»): cuenta un envío de cualquier formulario.',
      },
      desde: { type: 'string', description: 'YYYY-MM-DD. Por defecto, el primero del mes en curso.' },
      hasta: { type: 'string', description: 'YYYY-MM-DD, incluido. Por defecto, hoy.' },
      min_servicios: { type: 'integer', minimum: 1, maximum: 100, description: 'Servicios mínimos en el rango para contar al conductor (por defecto 1).' },
      modo: {
        type: 'string',
        enum: ['sin_envios', 'cobertura'],
        description: 'sin_envios (por defecto): solo quienes no enviaron ninguno. cobertura: todos, con servicios y envíos, de menor a mayor cobertura.',
      },
      excluir_desvinculados: {
        type: 'boolean',
        description:
          'SOLO si el usuario lo pide expresamente («sin los retirados», «solo los que siguen trabajando»): quita a los inactivos, retirados, suspendidos y desvinculados. Por defecto false: cuenta a todos los que tuvieron servicios, en cualquier estado.',
      },
    },
    additionalProperties: false,
  },
  etiqueta: 'Cruzando servicios y formularios',
  requiere: MODULO,
  salidaMaxima: { lista: 150, caracteres: 45000 },
  async ejecutar(args) {
    const hoy = hoyBogota()
    let desde = fechaOpcional(args.desde) ?? primeroDeMesBogota()
    let hasta = fechaOpcional(args.hasta) ?? hoy
    if (hasta < desde) [desde, hasta] = [hasta, desde]
    const dias = Math.round((diaUTC(hasta).getTime() - diaUTC(desde).getTime()) / 86_400_000) + 1
    if (dias > MAX_DIAS) return { error: `El rango es de ${dias} días; el máximo es ${MAX_DIAS}.` }
    const minServicios = enteroEntre(args.min_servicios, 1, 100, 1)
    const modo = args.modo === 'cobertura' ? 'cobertura' : 'sin_envios'
    /// No hay un estado «activo» que sirva de filtro: quien trabaja aparece como
    /// disponible, programado o en servicio, y filtrar por `activo` dejaba fuera
    /// a 51 de 61 conductores. Se excluye a quien ya no trabaja, no al revés.
    const excluirDesvinculados = args.excluir_desvinculados === true

    const { todos, elegidos } = await resolverFormularios(textoOpcional(args.formulario, 120) ?? 'preoperacional')
    if (elegidos.length === 0) {
      return { aviso: 'Ningún formulario coincide.', formularios_existentes: todos.map((f) => `${f.code} — ${f.name}`) }
    }

    const ini = inicioBogota(desde)
    const finExclusivo = new Date(inicioBogota(hasta).getTime() + 86_400_000)
    const [servicios, envios] = await Promise.all([
      prisma.servicio.groupBy({
        by: ['conductor_id'],
        where: {
          deleted_at: null,
          conductor_id: { not: null },
          estado: { not: 'cancelado' },
          OR: [
            { fecha_realizacion: { gte: ini, lt: finExclusivo } },
            { fecha_realizacion: null, fecha_solicitud: { gte: ini, lt: finExclusivo } },
          ],
        },
        _count: { _all: true },
        _max: { fecha_realizacion: true, fecha_solicitud: true },
      }),
      prisma.form_submission.groupBy({
        by: ['conductor_id'],
        where: {
          deleted_at: null,
          status: 'SUBMITTED',
          conductor_id: { not: null },
          business_date: { gte: diaUTC(desde), lte: diaUTC(hasta) },
          version: { form_id: { in: elegidos.map((f) => f.id) } },
        },
        _count: { _all: true },
        _max: { business_date: true },
      }),
    ])

    const enviosPor = new Map(envios.map((e) => [e.conductor_id!, e]))
    const candidatos = servicios.filter((s) => s._count._all >= minServicios)
    const conductores = await prisma.conductores.findMany({
      where: {
        id: { in: candidatos.map((c) => c.conductor_id!) },
        ...(excluirDesvinculados ? { estado: { notIn: ['inactivo', 'retirado', 'suspendido', 'desvinculado'] } } : {}),
      },
      select: { id: true, nombre: true, apellido: true, numero_identificacion: true, estado: true },
    })
    const datos = new Map(conductores.map((c) => [c.id, c]))

    const filas = candidatos
      .filter((s) => datos.has(s.conductor_id!))
      .map((s) => {
        const c = datos.get(s.conductor_id!)!
        const e = enviosPor.get(s.conductor_id!)
        const ultimo = s._max.fecha_realizacion ?? s._max.fecha_solicitud
        /// Filas compactas: con 50-150 conductores el resultado tiene que caber
        /// entero en el contexto del modelo.
        return {
          nombre: `${c.nombre} ${c.apellido}`.trim(),
          cc: c.numero_identificacion,
          estado: String(c.estado).replace(/_/g, ' '),
          servicios: s._count._all,
          envios: e?._count._all ?? 0,
          ultimo_servicio: ultimo ? ultimo.toLocaleDateString('es-CO', { timeZone: 'America/Bogota', day: 'numeric', month: 'short' }) : undefined,
          enlace: `/dashboard/conductores/${c.id}`,
        }
      })

    const sinEnvios = filas.filter((f) => f.envios === 0).sort((a, b) => b.servicios - a.servicios)
    const cobertura = [...filas].sort((a, b) => a.envios / a.servicios - b.envios / b.servicios || b.servicios - a.servicios)
    const LIMITE = 150
    const lista = modo === 'sin_envios' ? sinEnvios : cobertura

    return {
      rango: `${fechaDia(desde)} a ${fechaDia(hasta)}`,
      formularios_contados: elegidos.map((f) => `${f.code} — ${f.name}`),
      criterio: `conductores con al menos ${minServicios} servicio(s) no cancelado(s) en el rango${excluirDesvinculados ? ', sin inactivos, retirados, suspendidos ni desvinculados' : ', en cualquier estado'}; envíos entregados del formulario en el mismo rango`,
      conductores_con_servicios: filas.length,
      con_al_menos_un_envio: filas.length - sinEnvios.length,
      sin_ningun_envio: sinEnvios.length,
      envios_de_conductores_sin_servicios_en_rango: envios.filter((e) => !servicios.some((s) => s.conductor_id === e.conductor_id)).length,
      modo,
      conductores: lista.slice(0, LIMITE),
      ...(lista.length > LIMITE ? { nota: `Se muestran ${LIMITE} de ${lista.length}.` } : {}),
    }
  },
}

export const HERRAMIENTAS_FORMULARIOS: readonly Herramienta[] = [resumenFormularios, cumplimientoFormularios]

/* ────────────────── envíos y respuestas por campo ────────────────── */

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
const enlaceEnvio = (id: string) => `/dashboard/formularios/envios/${id}`

/** Valor legible de una respuesta: opción (etiqueta), número, texto, fecha… */
function valorDe(a: {
  value_text: string | null
  value_decimal: unknown
  value_boolean: boolean | null
  value_date: Date | null
  value_datetime: Date | null
  value_json: unknown
  options: { option: { value: string; label: string } }[]
}): string | number | boolean | null {
  if (a.options.length) return a.options.map((o) => o.option.label).join(', ')
  if (a.value_text !== null) return a.value_text
  if (a.value_decimal !== null && a.value_decimal !== undefined) return Number(a.value_decimal)
  if (a.value_boolean !== null) return a.value_boolean
  if (a.value_date) return iso(a.value_date)
  if (a.value_datetime) return a.value_datetime.toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'short', timeStyle: 'short' })
  if (a.value_json !== null && a.value_json !== undefined) return JSON.stringify(a.value_json)
  return null
}

/** Rango de fechas de negocio: por defecto el mes en curso. */
function rangoFechas(args: Record<string, unknown>): { desde: string; hasta: string } | { error: string } {
  const desde = fechaOpcional(args.desde) ?? primeroDeMesBogota()
  const hasta = fechaOpcional(args.hasta) ?? hoyBogota()
  if (hasta < desde) return { error: 'La fecha final es anterior a la inicial' }
  return { desde, hasta }
}

const SELECT_ENVIO = {
  id: true,
  status: true,
  business_date: true,
  submitted_at: true,
  conductor: { select: { nombre: true, apellido: true, numero_identificacion: true } },
  usuario: { select: { nombre: true } },
  vehiculo: { select: { placa: true } },
  service_id: true,
  version: { select: { title: true, form: { select: { code: true, name: true } } } },
  _count: { select: { answers: true, attachments: true } },
} as const

export const buscarEnviosFormulario: Herramienta = {
  nombre: 'buscar_envios_formulario',
  descripcion:
    'Lista envíos concretos de formularios dinámicos (uno por fila) filtrando por formulario, rango de fechas, conductor o placa y estado. Devuelve fecha, formulario, quién lo diligenció, placa y el enlace de cada envío. Para contar o agrupar usa resumen_formularios; para leer las respuestas de un envío usa detalle_envio_formulario; para un campo concreto a lo largo de muchos envíos usa respuestas_campo_formulario.',
  parametros: {
    type: 'object',
    properties: {
      formulario: { type: 'string', description: 'Nombre o código del formulario (vacío = todos)' },
      desde: { type: 'string', description: 'YYYY-MM-DD (fecha del formulario). Por defecto, el 1.º del mes' },
      hasta: { type: 'string', description: 'YYYY-MM-DD, incluida. Por defecto, hoy' },
      conductor_o_placa: { type: 'string', description: 'Nombre, cédula o placa' },
      estado: { type: 'string', enum: [...ESTADOS, 'TODOS'], description: 'Por defecto SUBMITTED' },
      limite: { type: 'integer', minimum: 1, maximum: 500, description: 'Hasta 500; sube el tope si el usuario quiere la lista completa' },
    },
    additionalProperties: false,
  },
  etiqueta: 'Buscando envíos',
  requiere: MODULO,
  salidaMaxima: { lista: 100, caracteres: 40000 },
  async ejecutar(args) {
    const r = rangoFechas(args)
    if ('error' in r) return r
    const { elegidos } = await resolverFormularios(textoOpcional(args.formulario, 120))
    if (elegidos.length === 0) return { error: `No hay ningún formulario que coincida con «${String(args.formulario)}»` }
    const estado = typeof args.estado === 'string' && [...ESTADOS, 'TODOS'].includes(args.estado) ? args.estado : 'SUBMITTED'
    const quien = textoOpcional(args.conductor_o_placa, 80)
    const limite = enteroEntre(args.limite, 1, 500, 30)
    const contiene = (q: string) => ({ contains: q, mode: 'insensitive' as const })

    const where: Prisma.form_submissionWhereInput = {
      deleted_at: null,
      version: { form_id: { in: elegidos.map((f) => f.id) } },
      business_date: { gte: diaUTC(r.desde), lte: diaUTC(r.hasta) },
      ...(estado === 'TODOS' ? {} : { status: estado }),
      ...(quien
        ? {
            OR: [
              { vehiculo: { placa: contiene(quien.replace(/[\s-]/g, '')) } },
              { conductor: { numero_identificacion: { contains: quien } } },
              { AND: quien.split(/\s+/).map((p) => ({ OR: [{ conductor: { nombre: contiene(p) } }, { conductor: { apellido: contiene(p) } }, { usuario: { nombre: contiene(p) } }] })) },
            ],
          }
        : {}),
    }
    const [filas, total] = await Promise.all([
      prisma.form_submission.findMany({ where, select: SELECT_ENVIO, orderBy: [{ business_date: 'desc' }, { submitted_at: 'desc' }], take: limite }),
      prisma.form_submission.count({ where }),
    ])
    return {
      rango: `${r.desde} a ${r.hasta}`,
      formularios_incluidos: elegidos.map((f) => `${f.code} ${f.name}`),
      total,
      mostrados: filas.length,
      envios: filas.map((s) => ({
        fecha: fechaDia(s.business_date),
        formulario: `${s.version.form.code} ${s.version.form.name}`,
        quien: s.conductor ? `${s.conductor.nombre} ${s.conductor.apellido}`.trim() : s.usuario?.nombre,
        cedula: s.conductor?.numero_identificacion,
        placa: s.vehiculo?.placa,
        estado: ETIQUETA_ESTADO[s.status as Estado] ?? s.status.toLowerCase(),
        enviado: s.submitted_at?.toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'short', timeStyle: 'short' }),
        respuestas: s._count.answers,
        adjuntos: s._count.attachments || undefined,
        servicio: s.service_id ? `/dashboard/servicios/${s.service_id}` : undefined,
        enlace: enlaceEnvio(s.id),
      })),
    }
  },
}

export const detalleEnvioFormulario: Herramienta = {
  nombre: 'detalle_envio_formulario',
  descripcion:
    'Trae un envío de formulario dinámico completo por su id o enlace: quién, cuándo, placa y TODAS sus respuestas con la pregunta en lenguaje natural (agrupadas por sección, con el valor elegido o escrito), más cuántos adjuntos tiene. Úsala para leer un preoperacional, una inspección o un reporte concreto.',
  parametros: {
    type: 'object',
    properties: { envio: { type: 'string', description: 'Id o enlace del envío (/dashboard/formularios/envios/<id>)' } },
    required: ['envio'],
    additionalProperties: false,
  },
  etiqueta: 'Abriendo el envío',
  requiere: MODULO,
  salidaMaxima: { lista: 200, caracteres: 45000 },
  async ejecutar(args) {
    const id = textoOpcional(args.envio, 300)?.match(UUID)?.[0]?.toLowerCase()
    if (!id) return { error: 'Indica el id o el enlace del envío' }
    const s = await prisma.form_submission.findFirst({
      where: { id, deleted_at: null },
      select: {
        ...SELECT_ENVIO,
        void_reason: true,
        voided_at: true,
        context_json: true,
        answers: {
          orderBy: [{ row_index: 'asc' }, { created_at: 'asc' }],
          select: {
            row_index: true,
            value_text: true,
            value_decimal: true,
            value_boolean: true,
            value_date: true,
            value_datetime: true,
            value_json: true,
            options: { select: { option: { select: { value: true, label: true } } } },
            field: { select: { key: true, label: true, type: true, sort_order: true, section: { select: { title: true, sort_order: true } } } },
          },
        },
      },
    })
    if (!s) return { error: 'No existe ese envío (o fue descartado)' }

    const secciones = new Map<string, { orden: number; respuestas: { pregunta: string; respuesta: unknown; fila?: number }[] }>()
    for (const a of s.answers) {
      if (a.field.type === 'INFO' || a.field.type === 'SIGNATURE' || a.field.type === 'PHOTO') continue
      const valor = valorDe(a)
      if (valor === null || valor === '') continue
      const titulo = a.field.section?.title ?? 'General'
      const sec = secciones.get(titulo) ?? { orden: a.field.section?.sort_order ?? 0, respuestas: [] }
      sec.respuestas.push({ pregunta: a.field.label, respuesta: valor, ...(a.row_index !== null ? { fila: a.row_index + 1 } : {}) })
      secciones.set(titulo, sec)
    }
    const malas = s.answers.filter((a) => a.options.some((o) => /^(m|malo|mal|nc|no cumple|r|regular)$/i.test(o.option.value) || /malo|no cumple|regular/i.test(o.option.label)))

    return {
      formulario: `${s.version.form.code} ${s.version.form.name}`,
      fecha: fechaDia(s.business_date),
      estado: ETIQUETA_ESTADO[s.status as Estado] ?? s.status.toLowerCase(),
      quien: s.conductor ? `${s.conductor.nombre} ${s.conductor.apellido}`.trim() : s.usuario?.nombre,
      cedula: s.conductor?.numero_identificacion,
      placa: s.vehiculo?.placa,
      enviado: s.submitted_at?.toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'short', timeStyle: 'short' }),
      anulado: s.voided_at ? { fecha: fechaCorta(s.voided_at), motivo: s.void_reason } : undefined,
      servicio: s.service_id ? `/dashboard/servicios/${s.service_id}` : undefined,
      adjuntos: s._count.attachments,
      hallazgos: malas.length ? malas.map((a) => `${a.field.label}: ${a.options.map((o) => o.option.label).join(', ')}`) : undefined,
      secciones: [...secciones.entries()].sort((a, b) => a[1].orden - b[1].orden).map(([seccion, v]) => ({ seccion, respuestas: v.respuestas })),
      enlace: enlaceEnvio(s.id),
    }
  },
}

export const camposFormulario: Herramienta = {
  nombre: 'campos_formulario',
  descripcion:
    'Lista las preguntas (campos) de un formulario dinámico con su clave, tipo y opciones de respuesta, por sección. Úsala antes de respuestas_campo_formulario cuando no sepas cómo se llama exactamente el campo que el usuario quiere analizar.',
  parametros: {
    type: 'object',
    properties: { formulario: { type: 'string', description: 'Nombre o código del formulario' } },
    required: ['formulario'],
    additionalProperties: false,
  },
  etiqueta: 'Leyendo la estructura del formulario',
  requiere: MODULO,
  salidaMaxima: { lista: 250, caracteres: 45000 },
  async ejecutar(args) {
    const { elegidos } = await resolverFormularios(textoOpcional(args.formulario, 120))
    if (elegidos.length === 0) return { error: 'No hay ningún formulario que coincida' }
    if (elegidos.length > 3) return { error: 'Coinciden demasiados formularios; precisa cuál', formularios: elegidos.map((f) => `${f.code} ${f.name}`) }
    const salida = []
    for (const f of elegidos) {
      const version = await prisma.form_version.findFirst({
        where: { form_id: f.id, status: 'PUBLISHED' },
        orderBy: { version_number: 'desc' },
        select: {
          version_number: true,
          sections: { orderBy: { sort_order: 'asc' }, select: { id: true, title: true } },
          fields: {
            orderBy: { sort_order: 'asc' },
            where: { type: { notIn: ['INFO'] } },
            select: { key: true, label: true, type: true, required: true, section_id: true, parent_field_id: true, options: { orderBy: { sort_order: 'asc' }, select: { value: true, label: true } } },
          },
        },
      })
      if (!version) continue
      salida.push({
        formulario: `${f.code} ${f.name}`,
        version: version.version_number,
        secciones: version.sections.map((s) => ({
          seccion: s.title,
          campos: version.fields
            .filter((c) => c.section_id === s.id)
            .map((c) => ({
              clave: c.key,
              pregunta: c.label,
              tipo: c.type.toLowerCase().replace(/_/g, ' '),
              obligatorio: c.required || undefined,
              dentro_de_grupo: c.parent_field_id ? true : undefined,
              opciones: c.options.length ? c.options.map((o) => o.label) : undefined,
            })),
        })),
      })
    }
    return { formularios: salida }
  },
}

export const respuestasCampoFormulario: Herramienta = {
  nombre: 'respuestas_campo_formulario',
  descripcion:
    'Indicador sobre UN campo (pregunta) de un formulario dinámico a lo largo de muchos envíos en un rango de fechas: cuenta cuántas veces se eligió cada opción (o sí/no), y para campos numéricos da suma, promedio, mínimo y máximo. Puede agrupar por día, por conductor o por placa, y listar quién respondió un valor concreto («¿qué vehículos tuvieron frenos en Malo?»). El campo se busca por su clave o por el texto de la pregunta (usa campos_formulario si no casa). Por defecto solo envíos entregados del mes en curso.',
  parametros: {
    type: 'object',
    properties: {
      formulario: { type: 'string', description: 'Nombre o código del formulario' },
      campo: { type: 'string', description: 'Clave o texto de la pregunta (p. ej. «frenos», «kilometraje», «estado_llantas»)' },
      desde: { type: 'string', description: 'YYYY-MM-DD; por defecto el 1.º del mes' },
      hasta: { type: 'string', description: 'YYYY-MM-DD, incluida; por defecto hoy' },
      agrupar_por: { type: 'string', enum: ['dia', 'conductor', 'placa', 'ninguno'], description: 'Por defecto ninguno (solo el total)' },
      valor: { type: 'string', description: 'Si se indica, lista los envíos cuya respuesta fue este valor (opción o texto, parcial)' },
      conductor_o_placa: { type: 'string', description: 'Limitar a un conductor o una placa' },
      limite: { type: 'integer', minimum: 1, maximum: 500, description: 'Tope de filas en listas y agrupaciones (hasta 500)' },
    },
    required: ['formulario', 'campo'],
    additionalProperties: false,
  },
  etiqueta: 'Calculando el indicador',
  requiere: MODULO,
  salidaMaxima: { lista: 200, caracteres: 45000 },
  async ejecutar(args) {
    const r = rangoFechas(args)
    if ('error' in r) return r
    const campoTexto = textoOpcional(args.campo, 120)
    if (!campoTexto) return { error: 'Indica el campo' }
    const { elegidos } = await resolverFormularios(textoOpcional(args.formulario, 120))
    if (elegidos.length === 0) return { error: 'No hay ningún formulario que coincida' }
    const limite = enteroEntre(args.limite, 1, 500, 50)
    const agrupar = typeof args.agrupar_por === 'string' && ['dia', 'conductor', 'placa'].includes(args.agrupar_por) ? args.agrupar_por : undefined
    const valorBuscado = textoOpcional(args.valor, 80)?.toLowerCase()
    const quien = textoOpcional(args.conductor_o_placa, 80)

    /// El campo puede existir en varias versiones del formulario (misma
    /// clave, distinto id): se toman todos los ids que casan.
    const q = normalizar(campoTexto)
    const campos = await prisma.form_field.findMany({
      where: { version: { form_id: { in: elegidos.map((f) => f.id) } }, type: { notIn: ['INFO', 'SIGNATURE', 'PHOTO', 'REPEATABLE_GROUP'] } },
      select: { id: true, key: true, label: true, type: true, version: { select: { form: { select: { code: true } } } } },
    })
    let elegidosCampo = campos.filter((c) => normalizar(c.key) === q || normalizar(c.label) === q)
    if (elegidosCampo.length === 0) elegidosCampo = campos.filter((c) => normalizar(c.key).includes(q) || normalizar(c.label).includes(q))
    if (elegidosCampo.length === 0) return { error: `Ningún campo de ${elegidos.map((f) => f.code).join(', ')} se llama «${campoTexto}»`, pista: 'Usa campos_formulario para ver las preguntas' }
    const claves = new Set(elegidosCampo.map((c) => c.key))
    if (claves.size > 1) {
      return {
        error: 'Varios campos coinciden; indica cuál',
        campos: [...new Map(elegidosCampo.map((c) => [c.key, { clave: c.key, pregunta: c.label, formulario: c.version.form.code }])).values()],
      }
    }
    const campo = elegidosCampo[0]
    const contiene = (t: string) => ({ contains: t, mode: 'insensitive' as const })

    const filas = await prisma.form_answer.findMany({
      where: {
        field_id: { in: elegidosCampo.map((c) => c.id) },
        submission: {
          deleted_at: null,
          status: 'SUBMITTED',
          business_date: { gte: diaUTC(r.desde), lte: diaUTC(r.hasta) },
          ...(quien
            ? {
                OR: [
                  { vehiculo: { placa: contiene(quien.replace(/[\s-]/g, '')) } },
                  { conductor: { numero_identificacion: { contains: quien } } },
                  { AND: quien.split(/\s+/).map((p) => ({ OR: [{ conductor: { nombre: contiene(p) } }, { conductor: { apellido: contiene(p) } }] })) },
                ],
              }
            : {}),
        },
      },
      select: {
        value_text: true,
        value_decimal: true,
        value_boolean: true,
        value_date: true,
        value_datetime: true,
        value_json: true,
        options: { select: { option: { select: { value: true, label: true } } } },
        submission: {
          select: { id: true, business_date: true, conductor: { select: { nombre: true, apellido: true, numero_identificacion: true } }, usuario: { select: { nombre: true } }, vehiculo: { select: { placa: true } } },
        },
      },
      take: 20000,
    })

    const quienDe = (s: (typeof filas)[number]['submission']) => (s.conductor ? `${s.conductor.nombre} ${s.conductor.apellido}`.trim() : s.usuario?.nombre ?? 'desconocido')
    const claveGrupo = (s: (typeof filas)[number]['submission']) => (agrupar === 'dia' ? iso(s.business_date) : agrupar === 'placa' ? s.vehiculo?.placa ?? 'sin placa' : quienDe(s))

    const numerico = ['INTEGER', 'DECIMAL'].includes(campo.type)
    const conteo = new Map<string, number>()
    const grupos = new Map<string, Map<string, number>>()
    const numeros: number[] = []
    const numerosPorGrupo = new Map<string, number[]>()
    const coincidencias: { fecha: string; quien: string; placa?: string; respuesta: unknown; enlace: string }[] = []

    for (const a of filas) {
      const v = valorDe(a)
      if (v === null || v === '') continue
      const etiqueta = String(v)
      if (numerico && typeof v === 'number') {
        numeros.push(v)
        if (agrupar) {
          const g = claveGrupo(a.submission)
          numerosPorGrupo.set(g, [...(numerosPorGrupo.get(g) ?? []), v])
        }
      } else {
        conteo.set(etiqueta, (conteo.get(etiqueta) ?? 0) + 1)
        if (agrupar) {
          const g = claveGrupo(a.submission)
          const m = grupos.get(g) ?? new Map<string, number>()
          m.set(etiqueta, (m.get(etiqueta) ?? 0) + 1)
          grupos.set(g, m)
        }
      }
      if (valorBuscado && etiqueta.toLowerCase().includes(valorBuscado) && coincidencias.length < limite) {
        coincidencias.push({ fecha: iso(a.submission.business_date), quien: quienDe(a.submission), placa: a.submission.vehiculo?.placa, respuesta: v, enlace: enlaceEnvio(a.submission.id) })
      }
    }

    const estadisticas = (xs: number[]) =>
      xs.length
        ? { n: xs.length, suma: Math.round(xs.reduce((s, x) => s + x, 0) * 100) / 100, promedio: Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 100) / 100, minimo: Math.min(...xs), maximo: Math.max(...xs) }
        : { n: 0 }

    return {
      formulario: elegidos.map((f) => `${f.code} ${f.name}`),
      campo: { clave: campo.key, pregunta: campo.label, tipo: campo.type.toLowerCase().replace(/_/g, ' ') },
      rango: `${r.desde} a ${r.hasta}`,
      respuestas_consideradas: filas.length,
      ...(numerico
        ? { estadisticas: estadisticas(numeros) }
        : {
            por_valor: [...conteo.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([valor, veces]) => ({ valor, veces, porcentaje: filas.length ? Math.round((veces / filas.length) * 1000) / 10 : 0 })),
          }),
      ...(agrupar
        ? {
            agrupado_por: agrupar,
            grupos: numerico
              ? [...numerosPorGrupo.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, limite).map(([grupo, xs]) => ({ grupo, ...estadisticas(xs) }))
              : [...grupos.entries()]
                  .sort((a, b) => [...b[1].values()].reduce((s, x) => s + x, 0) - [...a[1].values()].reduce((s, x) => s + x, 0))
                  .slice(0, limite)
                  .map(([grupo, m]) => ({ grupo, total: [...m.values()].reduce((s, x) => s + x, 0), ...Object.fromEntries(m) })),
          }
        : {}),
      ...(valorBuscado ? { valor_buscado: valorBuscado, coincidencias } : {}),
      enlace_explorador: `/dashboard/formularios?vista=envios&desde=${r.desde}&hasta=${r.hasta}${elegidos.length === 1 ? `&formId=${elegidos[0].id}` : ''}`,
    }
  },
}

export const HERRAMIENTAS_ENVIOS: readonly Herramienta[] = [buscarEnviosFormulario, detalleEnvioFormulario, camposFormulario, respuestasCampoFormulario]
