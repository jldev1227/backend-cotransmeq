import { Prisma } from '@prisma/client'
import { prisma } from '../../config/prisma'
import type { Herramienta } from './asistente.types'
import { enteroEntre, fechaOpcional, textoOpcional } from './asistente.utils'

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
