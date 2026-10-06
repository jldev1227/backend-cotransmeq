import { prisma } from '../../config/prisma'
import { AccionesCorrectivasService, type CreateAccionCorrectivaInput } from '../acciones-correctivas/acciones-correctivas.service'
import type { Herramienta } from './asistente.types'
import { enteroEntre, fechaCorta, fechaOpcional, textoOpcional } from './asistente.utils'

/**
 * Acciones correctivas, preventivas y de mejora en el asistente y el MCP.
 *
 * Lecturas por Prisma; la creación pasa por `AccionesCorrectivasService.crear`,
 * el mismo del POST de la pantalla (valida el número único y arma causas y
 * seguimientos). El número de acción es texto libre en la app; si el usuario
 * no lo da se propone `AC-<año>-<n>` y se comprueba que no exista.
 */

const MODULO = 'acciones-correctivas'
const LIMITE_MAXIMO = 50
const ESTADOS = ['EN_PROCESO', 'VENCIDA', 'CUMPLIDA', 'REPLANTEADA'] as const
const TIPOS = ['CORRECTIVA', 'PREVENTIVA', 'MEJORA'] as const
const RIESGOS = ['ALTO', 'MEDIO', 'BAJO'] as const
const HALLAZGOS = ['NC Mayor', 'NC Menor', 'Observación', 'Oportunidad de Mejora', 'Servicio no conforme'] as const
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

const servicio = new AccionesCorrectivasService()
const enlace = (id: string) => `/dashboard/acciones-correctivas/${id}`
const natural = (v: string | null | undefined) => (v ? v.replace(/_/g, ' ').toLowerCase() : undefined)
const fecha = (v: Date | null | undefined) => (v ? v.toISOString().slice(0, 10) : undefined)

function enumerado<T extends readonly string[]>(valor: unknown, opciones: T): T[number] | undefined {
  if (typeof valor !== 'string') return undefined
  const v = valor.trim().toUpperCase().replace(/\s+/g, '_')
  return opciones.find((o) => o.toUpperCase() === v)
}

export const buscarAccionesCorrectivas: Herramienta = {
  nombre: 'buscar_acciones_correctivas',
  descripcion:
    'Busca acciones correctivas, preventivas y de mejora por texto (número, hallazgo, proceso, sede, responsable), estado global (en proceso, vencida, cumplida, replanteada), tipo, valoración de riesgo o fecha del hallazgo. Devuelve por acción el número, hallazgo, tipo, riesgo, estado, responsable, causas con su plan y fecha límite, y el enlace. Para todo el detalle usa detalle_accion_correctiva; para cifras globales, estadisticas_acciones_correctivas.',
  parametros: {
    type: 'object',
    properties: {
      texto: { type: 'string' },
      estado: { type: 'string', enum: [...ESTADOS] },
      tipo: { type: 'string', enum: [...TIPOS] },
      riesgo: { type: 'string', enum: [...RIESGOS] },
      desde: { type: 'string', description: 'Fecha de identificación del hallazgo desde, YYYY-MM-DD' },
      hasta: { type: 'string', description: 'Hasta, YYYY-MM-DD incluida' },
      vencidas: { type: 'boolean', description: 'true: solo acciones con alguna causa cuya fecha límite ya pasó y no está cumplida' },
      limite: { type: 'integer', minimum: 1, maximum: LIMITE_MAXIMO },
    },
    additionalProperties: false,
  },
  etiqueta: 'Buscando acciones correctivas',
  requiere: MODULO,
  salidaMaxima: { lista: LIMITE_MAXIMO, caracteres: 40000 },
  async ejecutar(args) {
    const texto = textoOpcional(args.texto, 120)
    const estado = enumerado(args.estado, ESTADOS)
    const tipo = enumerado(args.tipo, TIPOS)
    const riesgo = enumerado(args.riesgo, RIESGOS)
    const desde = fechaOpcional(args.desde)
    const hasta = fechaOpcional(args.hasta)
    const limite = enteroEntre(args.limite, 1, LIMITE_MAXIMO, 15)
    const contiene = (q: string) => ({ contains: q, mode: 'insensitive' as const })
    const hoy = new Date()

    const where = {
      deleted_at: null,
      ...(estado ? { estado_global: estado } : {}),
      ...(tipo ? { tipo_accion_ejecutar: tipo } : {}),
      ...(riesgo ? { valoracion_riesgo: riesgo } : {}),
      ...(desde || hasta
        ? { fecha_identificacion_hallazgo: { ...(desde ? { gte: new Date(`${desde}T00:00:00.000Z`) } : {}), ...(hasta ? { lte: new Date(`${hasta}T23:59:59.999Z`) } : {}) } }
        : {}),
      ...(args.vencidas === true
        ? { causas: { some: { fecha_limite_implementacion: { lt: hoy }, NOT: { estado_seguimiento: { in: ['Cumplida', 'Cerrada'] } } } } }
        : {}),
      ...(texto
        ? {
            OR: [
              { accion_numero: contiene(texto) },
              { descripcion_hallazgo: contiene(texto) },
              { proceso_origen_hallazgo: contiene(texto) },
              { lugar_sede: contiene(texto) },
              { responsable_correccion: contiene(texto) },
              { fuente_genero_hallazgo: contiene(texto) },
              { causas: { some: { OR: [{ analisis_causa: contiene(texto) }, { responsable_ejecucion: contiene(texto) }] } } },
            ],
          }
        : {}),
    }

    const [filas, total] = await Promise.all([
      prisma.acciones_correctivas_preventivas.findMany({
        where,
        select: {
          id: true,
          accion_numero: true,
          descripcion_hallazgo: true,
          tipo_hallazgo_detectado: true,
          tipo_accion_ejecutar: true,
          valoracion_riesgo: true,
          estado_global: true,
          estado_aprobacion: true,
          proceso_origen_hallazgo: true,
          lugar_sede: true,
          fecha_identificacion_hallazgo: true,
          responsable_correccion: true,
          fecha_cierre_definitivo: true,
          evaluacion_cierre_eficaz: true,
          causas: {
            orderBy: { orden: 'asc' },
            select: { orden: true, analisis_causa: true, es_causa_raiz: true, descripcion_plan_accion: true, fecha_limite_implementacion: true, responsable_ejecucion: true, estado_seguimiento: true },
          },
          registrado_por: { select: { nombre: true } },
        },
        orderBy: { created_at: 'desc' },
        take: limite,
      }),
      prisma.acciones_correctivas_preventivas.count({ where }),
    ])

    return {
      total,
      mostradas: filas.length,
      acciones: filas.map((a) => ({
        numero: a.accion_numero,
        hallazgo: a.descripcion_hallazgo,
        tipo_hallazgo: a.tipo_hallazgo_detectado,
        tipo_accion: natural(a.tipo_accion_ejecutar),
        riesgo: natural(a.valoracion_riesgo),
        estado: natural(a.estado_global),
        aprobacion: natural(a.estado_aprobacion),
        proceso: a.proceso_origen_hallazgo,
        sede: a.lugar_sede,
        fecha_hallazgo: fecha(a.fecha_identificacion_hallazgo),
        responsable: a.responsable_correccion,
        registrada_por: a.registrado_por?.nombre,
        cierre: a.fecha_cierre_definitivo ? { fecha: fecha(a.fecha_cierre_definitivo), eficaz: a.evaluacion_cierre_eficaz } : undefined,
        causas: a.causas.map((c) => ({
          n: c.orden,
          causa: c.analisis_causa,
          raiz: c.es_causa_raiz || undefined,
          plan: c.descripcion_plan_accion,
          fecha_limite: fecha(c.fecha_limite_implementacion),
          vencida: c.fecha_limite_implementacion && c.fecha_limite_implementacion < hoy && !['Cumplida', 'Cerrada'].includes(c.estado_seguimiento ?? '') ? true : undefined,
          responsable: c.responsable_ejecucion,
          estado: c.estado_seguimiento,
        })),
        enlace: enlace(a.id),
      })),
    }
  },
}

export const detalleAccionCorrectiva: Herramienta = {
  nombre: 'detalle_accion_correctiva',
  descripcion:
    'Trae una acción correctiva completa por su número, id o enlace: hallazgo, corrección inmediata, causas con sus seguimientos, ciclos de eficacia, evidencias, aprobaciones y cierre.',
  parametros: {
    type: 'object',
    properties: { accion: { type: 'string', description: 'Número de la acción, id o enlace' } },
    required: ['accion'],
    additionalProperties: false,
  },
  etiqueta: 'Abriendo la acción correctiva',
  requiere: MODULO,
  salidaMaxima: { lista: 40, caracteres: 40000 },
  async ejecutar(args) {
    const texto = textoOpcional(args.accion, 200)
    if (!texto) return { error: 'Indica el número de la acción' }
    const id = texto.match(UUID)?.[0]?.toLowerCase()
    const a = id
      ? await prisma.acciones_correctivas_preventivas.findFirst({ where: { id, deleted_at: null }, select: { id: true } })
      : await prisma.acciones_correctivas_preventivas.findFirst({ where: { accion_numero: { equals: texto, mode: 'insensitive' }, deleted_at: null }, select: { id: true } })
    if (!a) {
      const parecidas = id
        ? []
        : await prisma.acciones_correctivas_preventivas.findMany({
            where: { accion_numero: { contains: texto, mode: 'insensitive' }, deleted_at: null },
            select: { id: true, accion_numero: true, descripcion_hallazgo: true },
            take: 6,
          })
      return {
        error: `No existe la acción «${texto}»`,
        ...(parecidas.length ? { parecidas: parecidas.map((p) => ({ numero: p.accion_numero, hallazgo: p.descripcion_hallazgo, enlace: enlace(p.id) })) } : {}),
      }
    }
    const x = (await servicio.obtenerPorId(a.id)) as Record<string, any>
    const quitar = new Set(['id', 'accion_correctiva_id', 'causa_id', 'creado_por_id', 'registrado_por_id', 'usuarios', 'deleted_at', 'updated_at', 'sugerencia_ia', 'pesv_cycle_id', 'pesv_step_number', 'pesv_ciclo', 'pesv_siniestros', 'evaluaciones_eficacia'])
    const limpiar = (v: unknown): unknown => {
      if (Array.isArray(v)) return v.map(limpiar)
      if (v instanceof Date) return v.toISOString().slice(0, 10)
      if (v && typeof v === 'object') {
        return Object.fromEntries(
          Object.entries(v as Record<string, unknown>)
            .filter(([k, val]) => !quitar.has(k) && val !== null && val !== undefined && val !== '')
            .map(([k, val]) => [k, limpiar(val)]),
        )
      }
      return v
    }
    return {
      ...(limpiar(x) as Record<string, unknown>),
      registrada_por: x.registrado_por?.nombre,
      creada: fechaCorta(x.created_at),
      enlace: enlace(x.id),
    }
  },
}

export const estadisticasAccionesCorrectivas: Herramienta = {
  nombre: 'estadisticas_acciones_correctivas',
  descripcion: 'Cifras globales de acciones correctivas: cuántas hay por estado, tipo, riesgo y origen, cuántas vencidas y cerradas. Para listas concretas usa buscar_acciones_correctivas.',
  parametros: { type: 'object', properties: {}, additionalProperties: false },
  etiqueta: 'Calculando estadísticas',
  requiere: MODULO,
  async ejecutar() {
    return { ...(await servicio.obtenerEstadisticas()), enlace: '/dashboard/acciones-correctivas' }
  },
}

export const crearAccionCorrectiva: Herramienta = {
  nombre: 'crear_accion_correctiva',
  descripcion:
    'Crea una acción correctiva, preventiva o de mejora a partir de un hallazgo. Mínimo: descripción del hallazgo; lo demás es opcional y se asume (tipo de acción CORRECTIVA, fecha del hallazgo hoy, número AC-<año>-<n> si no lo dan). Puede llevar la corrección inmediata y las causas con su plan de acción, fecha límite y responsable. Antes de llamarla muestra UN resumen y pregunta «¿La creo así?»; con la confirmación pasa confirmado=true. Nace en proceso y sin aprobación: aprobarla, hacer seguimientos y cerrarla se hace en la pantalla.',
  parametros: {
    type: 'object',
    properties: {
      confirmado: { type: 'boolean', description: 'true SOLO después de que el usuario confirmó el resumen' },
      descripcion_hallazgo: { type: 'string' },
      accion_numero: { type: 'string', description: 'Solo si el usuario lo dio' },
      fecha_identificacion_hallazgo: { type: 'string', description: 'YYYY-MM-DD; por defecto hoy' },
      tipo_hallazgo_detectado: { type: 'string', enum: [...HALLAZGOS] },
      tipo_accion_ejecutar: { type: 'string', enum: [...TIPOS], description: 'Por defecto CORRECTIVA' },
      valoracion_riesgo: { type: 'string', enum: [...RIESGOS] },
      proceso_origen_hallazgo: { type: 'string', description: 'Proceso donde se detectó (operaciones, HSEQ, mantenimiento…)' },
      fuente_genero_hallazgo: { type: 'string', description: 'Auditoría interna, inspección, queja del cliente, accidente…' },
      lugar_sede: { type: 'string' },
      componente_elemento_referencia: { type: 'string' },
      marco_legal_normativo: { type: 'string' },
      aplica_correccion_inmediata: { type: 'boolean' },
      correccion_solucion_inmediata: { type: 'string' },
      responsable_correccion: { type: 'string' },
      fecha_implementacion: { type: 'string', description: 'YYYY-MM-DD de la corrección inmediata' },
      fecha_limite_evaluacion_eficacia: { type: 'string', description: 'YYYY-MM-DD' },
      causas: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            analisis_causa: { type: 'string' },
            es_causa_raiz: { type: 'boolean' },
            descripcion_plan_accion: { type: 'string' },
            fecha_limite_implementacion: { type: 'string', description: 'YYYY-MM-DD' },
            responsable_ejecucion: { type: 'string' },
          },
          required: ['analisis_causa'],
          additionalProperties: false,
        },
      },
    },
    required: ['confirmado', 'descripcion_hallazgo'],
    additionalProperties: false,
  },
  etiqueta: 'Creando la acción correctiva',
  requiere: MODULO,
  nivel: 'full',
  escribe: true,
  async ejecutar(args, usuario) {
    if (args.confirmado !== true) return { error: 'Falta la confirmación del usuario: muéstrale el resumen y pregúntale si la creas' }
    const hallazgo = textoOpcional(args.descripcion_hallazgo, 5000)
    if (!hallazgo) return { error: 'Falta la descripción del hallazgo' }

    const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })
    let numero = textoOpcional(args.accion_numero, 100)
    if (numero) {
      const ocupado = await prisma.acciones_correctivas_preventivas.findUnique({ where: { accion_numero: numero }, select: { id: true } })
      if (ocupado) return { creado: false, error: `Ya existe una acción con el número ${numero}`, pista: 'Pregunta al usuario otro número o déjalo vacío para asignar uno' }
    } else {
      const anio = hoy.slice(0, 4)
      const cuantas = await prisma.acciones_correctivas_preventivas.count({ where: { accion_numero: { startsWith: `AC-${anio}-` } } })
      for (let n = cuantas + 1; ; n++) {
        const candidato = `AC-${anio}-${String(n).padStart(3, '0')}`
        if (!(await prisma.acciones_correctivas_preventivas.findUnique({ where: { accion_numero: candidato }, select: { id: true } }))) {
          numero = candidato
          break
        }
      }
    }

    const causasEntrada = Array.isArray(args.causas) ? (args.causas as Record<string, unknown>[]) : []
    const causas = causasEntrada
      .map((c, i) => ({
        orden: i + 1,
        analisis_causa: textoOpcional(c.analisis_causa, 3000) ?? '',
        es_causa_raiz: c.es_causa_raiz === true,
        descripcion_plan_accion: textoOpcional(c.descripcion_plan_accion, 3000),
        fecha_limite_implementacion: fechaOpcional(c.fecha_limite_implementacion),
        responsable_ejecucion: textoOpcional(c.responsable_ejecucion, 255),
        estado_seguimiento: 'En Proceso' as const,
      }))
      .filter((c) => c.analisis_causa)

    const data: CreateAccionCorrectivaInput = {
      accion_numero: numero!,
      descripcion_hallazgo: hallazgo,
      fecha_identificacion_hallazgo: fechaOpcional(args.fecha_identificacion_hallazgo) ?? hoy,
      tipo_hallazgo_detectado: enumerado(args.tipo_hallazgo_detectado, HALLAZGOS) ?? textoOpcional(args.tipo_hallazgo_detectado, 100),
      tipo_accion_ejecutar: enumerado(args.tipo_accion_ejecutar, TIPOS) ?? 'CORRECTIVA',
      valoracion_riesgo: enumerado(args.valoracion_riesgo, RIESGOS),
      proceso_origen_hallazgo: textoOpcional(args.proceso_origen_hallazgo, 255),
      fuente_genero_hallazgo: textoOpcional(args.fuente_genero_hallazgo, 255),
      lugar_sede: textoOpcional(args.lugar_sede, 255),
      componente_elemento_referencia: textoOpcional(args.componente_elemento_referencia, 500),
      marco_legal_normativo: textoOpcional(args.marco_legal_normativo, 1000),
      aplica_correccion_inmediata: typeof args.aplica_correccion_inmediata === 'boolean' ? args.aplica_correccion_inmediata : !!textoOpcional(args.correccion_solucion_inmediata),
      correccion_solucion_inmediata: textoOpcional(args.correccion_solucion_inmediata, 3000),
      responsable_correccion: textoOpcional(args.responsable_correccion, 255),
      fecha_implementacion: fechaOpcional(args.fecha_implementacion),
      fecha_limite_evaluacion_eficacia: fechaOpcional(args.fecha_limite_evaluacion_eficacia),
      causas,
      creado_por_id: usuario.id,
    }

    const creada = await servicio.crear(data)
    return {
      creado: true,
      accion: {
        numero: creada.accion_numero,
        hallazgo: creada.descripcion_hallazgo,
        tipo_accion: natural(creada.tipo_accion_ejecutar),
        riesgo: natural(creada.valoracion_riesgo),
        estado: natural(creada.estado_global),
        causas: creada.causas.length,
        enlace: enlace(creada.id),
      },
      pendiente: 'Queda en proceso: aprobarla, registrar seguimientos y cerrarla se hace en la pantalla',
    }
  },
}

export const HERRAMIENTAS_ACCIONES_CORRECTIVAS: readonly Herramienta[] = [buscarAccionesCorrectivas, detalleAccionCorrectiva, estadisticasAccionesCorrectivas, crearAccionCorrectiva]
