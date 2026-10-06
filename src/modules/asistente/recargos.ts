import { prisma } from '../../config/prisma'
import { getIO } from '../../sockets'
import { createRecargoSchema } from '../recargos/recargos.schema'
import { RecargosService } from '../recargos/recargos.service'
import type { Herramienta } from './asistente.types'
import { enteroEntre, fechaCorta, textoOpcional } from './asistente.utils'
import { resolverCliente, resolverConductor, resolverVehiculo } from './acciones'
import { idDeServicio } from './servicio-referencia'

/**
 * Recargos (planillas de días laborados) en el asistente y en el MCP.
 *
 * Dos lecturas con cualquier nivel del módulo y una escritura, `crear_recargo`,
 * que pasa por el MISMO zod y servicio que el POST de la pantalla
 * (`createRecargoSchema` + `RecargosService.create`): los recargos por hora se
 * calculan allá, aquí solo se arman los días. El número de planilla, si no lo
 * da el usuario, sale de `getNextNumeroPlanilla` como en el formulario.
 */

const MODULO = 'recargos'
const LIMITE_MAXIMO = 500
const ESTADOS = ['pendiente', 'liquidada', 'facturada', 'no_esta', 'encontrada', 'borrador', 'activo', 'completado', 'liquidado', 'cancelado'] as const

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ENLACE = '/dashboard/recargos'

function enteroOpcional(valor: unknown, min: number, max: number): number | undefined {
  if (valor === null || valor === undefined || valor === '') return undefined
  const n = Number(valor)
  return Number.isInteger(n) && n >= min && n <= max ? n : undefined
}

/** «07:30» → 7.5; 7.5 → 7.5; «28» → 28 (turno que cruza medianoche). */
function hora(valor: unknown): number | undefined {
  if (typeof valor === 'number' && Number.isFinite(valor)) return valor
  if (typeof valor !== 'string') return undefined
  const m = /^(\d{1,2})(?::(\d{2}))?$/.exec(valor.trim())
  if (!m) return undefined
  return Number(m[1]) + (m[2] ? Number(m[2]) / 60 : 0)
}

const nombre = (c: { nombre: string; apellido: string } | null | undefined) => (c ? `${c.nombre} ${c.apellido}`.trim() : undefined)

const SELECT_LISTA = {
  id: true,
  numero_planilla: true,
  mes: true,
  a_o: true,
  estado: true,
  total_dias_laborados: true,
  total_horas_trabajadas: true,
  observaciones: true,
  servicio_id: true,
  created_at: true,
  conductores: { select: { nombre: true, apellido: true, numero_identificacion: true } },
  vehiculos: { select: { placa: true } },
  clientes: { select: { nombre: true } },
  _count: { select: { dias_laborales_planillas: { where: { deleted_at: null } } } },
} as const

export const buscarRecargos: Herramienta = {
  nombre: 'buscar_recargos',
  descripcion:
    'Busca planillas de recargos por número de planilla, conductor, placa, cliente, periodo (mes/año) o estado. Devuelve por planilla: conductor, placa, cliente, periodo, estado, días laborados, horas y valor a pagar. Para ver los días uno a uno y los recargos calculados usa detalle_recargo.',
  parametros: {
    type: 'object',
    properties: {
      texto: { type: 'string', description: 'Número de planilla, nombre o cédula del conductor, placa o cliente' },
      conductor: { type: 'string', description: 'Nombre o cédula del conductor, si se filtra solo por él' },
      placa: { type: 'string' },
      cliente: { type: 'string', description: 'Nombre o NIT del cliente' },
      mes: { type: 'integer', minimum: 1, maximum: 12 },
      anio: { type: 'integer', minimum: 2020, maximum: 2100 },
      estado: { type: 'string', enum: [...ESTADOS] },
      limite: { type: 'integer', minimum: 1, maximum: LIMITE_MAXIMO },
    },
    additionalProperties: false,
  },
  etiqueta: 'Buscando planillas de recargos',
  requiere: MODULO,
  async ejecutar(args) {
    const texto = textoOpcional(args.texto, 80)
    const conductor = textoOpcional(args.conductor, 80)
    const placa = textoOpcional(args.placa, 20)?.replace(/[\s-]/g, '')
    const cliente = textoOpcional(args.cliente, 120)
    const mes = enteroOpcional(args.mes, 1, 12)
    const anio = enteroOpcional(args.anio, 2020, 2100)
    const estado = typeof args.estado === 'string' && (ESTADOS as readonly string[]).includes(args.estado) ? args.estado : undefined
    const limite = enteroEntre(args.limite, 1, LIMITE_MAXIMO, 15)

    const contiene = (q: string) => ({ contains: q, mode: 'insensitive' as const })
    const porPersona = (q: string) =>
      q.split(/\s+/).filter(Boolean).map((p) => ({
        OR: [
          { conductores: { nombre: contiene(p) } },
          { conductores: { apellido: contiene(p) } },
          { conductores: { numero_identificacion: { contains: p } } },
        ],
      }))

    const where = {
      deleted_at: null,
      ...(mes ? { mes } : {}),
      ...(anio ? { a_o: anio } : {}),
      ...(estado ? { estado: estado as (typeof ESTADOS)[number] } : {}),
      ...(placa ? { vehiculos: { placa: contiene(placa) } } : {}),
      ...(cliente ? { clientes: { OR: [{ nombre: contiene(cliente) }, { nit: contiene(cliente) }] } } : {}),
      ...(conductor ? { AND: porPersona(conductor) } : {}),
      ...(texto
        ? {
            OR: [
              { numero_planilla: contiene(texto) },
              { vehiculos: { placa: contiene(texto.replace(/[\s-]/g, '')) } },
              { clientes: { nombre: contiene(texto) } },
              { AND: porPersona(texto) },
            ],
          }
        : {}),
    }

    const [filas, total] = await Promise.all([
      prisma.recargos_planillas.findMany({ where, select: SELECT_LISTA, orderBy: [{ a_o: 'desc' }, { mes: 'desc' }, { created_at: 'desc' }], take: limite }),
      prisma.recargos_planillas.count({ where }),
    ])
    const valores = await Promise.all(filas.map((f) => RecargosService.calcularValorAPagar(f.id).catch(() => null)))

    return {
      total,
      mostradas: filas.length,
      pantalla: ENLACE,
      planillas: filas.map((f, i) => ({
        planilla: f.numero_planilla || '(sin número)',
        conductor: nombre(f.conductores),
        cedula: f.conductores.numero_identificacion,
        placa: f.vehiculos.placa,
        cliente: f.clientes.nombre,
        periodo: `${f.mes}/${f.a_o}`,
        estado: f.estado.replace(/_/g, ' '),
        dias_laborados: f.total_dias_laborados ?? f._count.dias_laborales_planillas,
        horas_trabajadas: Number(f.total_horas_trabajadas ?? 0),
        valor_a_pagar: valores[i],
        servicio: f.servicio_id ? `/dashboard/servicios/${f.servicio_id}` : null,
        observaciones: f.observaciones || undefined,
        creada: fechaCorta(f.created_at),
        id: f.id,
      })),
    }
  },
}

export const detalleRecargo: Herramienta = {
  nombre: 'detalle_recargo',
  descripcion:
    'Trae una planilla de recargos completa por su número (o id): cabecera, el servicio asociado y cada día laborado con hora de inicio y fin, total de horas, si fue festivo o domingo, pernocte, disponibilidad y los recargos calculados por tipo (horas y valor). Si hay varias planillas con el mismo número devuelve la lista para elegir.',
  parametros: {
    type: 'object',
    properties: {
      planilla: { type: 'string', description: 'Número de planilla (p. ej. 2974) o id' },
      conductor: { type: 'string', description: 'Para desempatar si el número se repite' },
      mes: { type: 'integer', minimum: 1, maximum: 12 },
      anio: { type: 'integer', minimum: 2020, maximum: 2100 },
    },
    required: ['planilla'],
    additionalProperties: false,
  },
  etiqueta: 'Abriendo la planilla',
  requiere: MODULO,
  salidaMaxima: { lista: 40, caracteres: 30000 },
  async ejecutar(args) {
    const texto = textoOpcional(args.planilla, 60)
    if (!texto) return { error: 'Falta el número de planilla' }
    const mes = enteroOpcional(args.mes, 1, 12)
    const anio = enteroOpcional(args.anio, 2020, 2100)
    const conductor = textoOpcional(args.conductor, 80)

    const where = UUID.test(texto)
      ? { id: texto.toLowerCase(), deleted_at: null }
      : {
          deleted_at: null,
          numero_planilla: { equals: texto.replace(/^#+/, '').trim(), mode: 'insensitive' as const },
          ...(mes ? { mes } : {}),
          ...(anio ? { a_o: anio } : {}),
          ...(conductor
            ? { OR: conductor.split(/\s+/).map((p) => ({ conductores: { OR: [{ nombre: { contains: p, mode: 'insensitive' as const } }, { apellido: { contains: p, mode: 'insensitive' as const } }] } })) }
            : {}),
        }
    const candidatas = await prisma.recargos_planillas.findMany({ where, select: SELECT_LISTA, take: 6, orderBy: { created_at: 'desc' } })
    if (candidatas.length === 0) return { error: `No existe una planilla «${texto}»` }
    if (candidatas.length > 1) {
      return {
        error: 'Hay varias planillas con ese número; indica conductor o periodo',
        candidatas: candidatas.map((f) => ({ planilla: f.numero_planilla, conductor: nombre(f.conductores), placa: f.vehiculos.placa, periodo: `${f.mes}/${f.a_o}`, cliente: f.clientes.nombre })),
      }
    }

    const r = await prisma.recargos_planillas.findFirst({
      where: { id: candidatas[0].id },
      include: {
        conductores: { select: { nombre: true, apellido: true, numero_identificacion: true } },
        vehiculos: { select: { placa: true, marca: true, linea: true } },
        clientes: { select: { nombre: true, nit: true } },
        servicio: {
          select: {
            id: true,
            estado: true,
            fecha_realizacion: true,
            origen_especifico: true,
            destino_especifico: true,
            municipios_servicio_origen_idTomunicipios: { select: { nombre_municipio: true } },
            municipios_servicio_destino_idTomunicipios: { select: { nombre_municipio: true } },
          },
        },
        dias_laborales_planillas: {
          where: { deleted_at: null },
          orderBy: { dia: 'asc' },
          include: {
            detalles_recargos_dias: {
              where: { deleted_at: null, activo: true },
              include: { tipos_recargos: { select: { codigo: true, nombre: true, porcentaje: true } } },
            },
          },
        },
        users_recargos_planillas_creado_por_idTousers: { select: { nombre: true } },
      },
    })
    if (!r) return { error: 'La planilla ya no existe' }

    const valorAPagar = await RecargosService.calcularValorAPagar(r.id).catch(() => null)
    const porTipo = new Map<string, { horas: number; valor: number }>()
    const dias = r.dias_laborales_planillas.map((d) => {
      const recargos = d.detalles_recargos_dias.map((x) => {
        const clave = x.tipos_recargos.nombre
        const acumulado = porTipo.get(clave) ?? { horas: 0, valor: 0 }
        acumulado.horas += Number(x.horas)
        acumulado.valor += Number(x.valor_calculado ?? 0)
        porTipo.set(clave, acumulado)
        return { tipo: clave, codigo: x.tipos_recargos.codigo, horas: Number(x.horas), valor: Number(x.valor_calculado ?? 0) }
      })
      return {
        dia: d.dia,
        hora_inicio: d.hora_inicio === null ? null : Number(d.hora_inicio),
        hora_fin: d.hora_fin === null ? null : Number(d.hora_fin),
        total_horas: Number(d.total_horas),
        horas_ordinarias: d.horas_ordinarias === null ? undefined : Number(d.horas_ordinarias),
        festivo: d.es_festivo,
        domingo: d.es_domingo,
        pernocte: d.pernocte,
        disponibilidad: d.disponibilidad,
        continua_siguiente_dia: d.continua_siguiente_dia || undefined,
        km_inicial: d.kilometraje_inicial === null ? undefined : Number(d.kilometraje_inicial),
        km_final: d.kilometraje_final === null ? undefined : Number(d.kilometraje_final),
        observaciones: d.observaciones || undefined,
        recargos,
      }
    })

    const s = r.servicio
    return {
      planilla: r.numero_planilla,
      estado: r.estado.replace(/_/g, ' '),
      periodo: `${r.mes}/${r.a_o}`,
      conductor: nombre(r.conductores),
      cedula: r.conductores.numero_identificacion,
      placa: r.vehiculos.placa,
      vehiculo: `${r.vehiculos.marca ?? ''} ${r.vehiculos.linea ?? ''}`.trim() || undefined,
      cliente: r.clientes.nombre,
      nit: r.clientes.nit,
      servicio: s
        ? {
            ruta: `${s.origen_especifico || s.municipios_servicio_origen_idTomunicipios.nombre_municipio} → ${s.destino_especifico || s.municipios_servicio_destino_idTomunicipios.nombre_municipio}`,
            estado: String(s.estado).replace(/_/g, ' '),
            fecha_realizacion: fechaCorta(s.fecha_realizacion),
            enlace: `/dashboard/servicios/${s.id}`,
          }
        : null,
      totales: {
        dias_laborados: r.total_dias_laborados ?? dias.length,
        horas_trabajadas: Number(r.total_horas_trabajadas ?? 0),
        horas_ordinarias: Number(r.total_horas_ordinarias ?? 0),
        valor_a_pagar: valorAPagar,
        recargos_por_tipo: [...porTipo.entries()].map(([tipo, v]) => ({ tipo, horas: v.horas, valor: v.valor })),
        pernoctes: dias.filter((d) => d.pernocte).length,
        festivos_o_domingos: dias.filter((d) => d.festivo || d.domingo).length,
      },
      observaciones: r.observaciones || undefined,
      creada_por: r.users_recargos_planillas_creado_por_idTousers?.nombre,
      creada: fechaCorta(r.created_at),
      dias,
      pantalla: ENLACE,
      id: r.id,
    }
  },
}

export const crearRecargo: Herramienta = {
  nombre: 'crear_recargo',
  descripcion:
    'Crea una planilla de recargos (días laborados) para un conductor, una placa y un cliente en un mes. Recibe nombres y resuelve los ids. Cada día lleva hora de inicio y fin (en horas: 6, 18.5 o «07:30»; un turno que pasa de medianoche termina después de 24, p. ej. 20 → 28); los recargos por hora, el domingo y los totales los calcula el servidor. Si el usuario no da número de planilla se asigna el siguiente. Antes de llamarla muestra UN resumen (conductor, placa, cliente, periodo, tabla de días con horas) y pregunta «¿La creo así?»; con la confirmación pasa confirmado=true. Si ya existe una planilla del mismo conductor, placa, cliente y periodo la herramienta avisa y no crea, salvo permitir_repetida=true.',
  parametros: {
    type: 'object',
    properties: {
      confirmado: { type: 'boolean', description: 'true SOLO después de que el usuario confirmó el resumen' },
      conductor: { type: 'string', description: 'Nombre o cédula del conductor' },
      placa: { type: 'string' },
      cliente: { type: 'string', description: 'Nombre o NIT del cliente (empresa). Si se pasa servicio y no cliente, se toma del servicio' },
      mes: { type: 'integer', minimum: 1, maximum: 12 },
      anio: { type: 'integer', minimum: 2020, maximum: 2100 },
      numero_planilla: { type: 'string', description: 'Solo si el usuario lo dio; si no, se asigna el siguiente' },
      servicio: { type: 'string', description: 'Id o enlace del servicio al que pertenece la planilla, si lo hay' },
      observaciones: { type: 'string' },
      permitir_repetida: { type: 'boolean', description: 'true si el usuario aceptó crearla aunque ya exista otra del mismo conductor, placa, cliente y periodo' },
      dias: {
        type: 'array',
        description: 'Un elemento por día laborado',
        items: {
          type: 'object',
          properties: {
            dia: { type: 'integer', minimum: 1, maximum: 31 },
            hora_inicio: { type: ['number', 'string'], description: 'Horas (6, 7.5) o «HH:MM»' },
            hora_fin: { type: ['number', 'string'], description: 'Horas; mayor que la de inicio (puede pasar de 24)' },
            es_festivo: { type: 'boolean', description: 'true si el usuario dijo que es festivo (el domingo se detecta solo)' },
            pernocte: { type: 'boolean' },
            disponibilidad: { type: 'boolean' },
            kilometraje_inicial: { type: 'number' },
            kilometraje_final: { type: 'number' },
            observaciones: { type: 'string' },
          },
          required: ['dia', 'hora_inicio', 'hora_fin'],
          additionalProperties: false,
        },
      },
    },
    required: ['confirmado', 'conductor', 'placa', 'mes', 'anio', 'dias'],
    additionalProperties: false,
  },
  etiqueta: 'Creando la planilla de recargos',
  requiere: MODULO,
  nivel: 'full',
  escribe: true,
  async ejecutar(args, usuario) {
    if (args.confirmado !== true) return { error: 'Falta la confirmación del usuario: muéstrale el resumen y pregúntale si la creas' }
    const mes = enteroOpcional(args.mes, 1, 12)
    const anio = enteroOpcional(args.anio, 2020, 2100)
    if (!mes || !anio) return { error: 'Faltan el mes y el año de la planilla' }

    const diasEntrada = Array.isArray(args.dias) ? (args.dias as Record<string, unknown>[]) : []
    if (diasEntrada.length === 0) return { error: 'La planilla necesita al menos un día laborado' }
    const diasDelMes = new Date(Date.UTC(anio, mes, 0)).getUTCDate()
    const problemas: string[] = []
    const dias = diasEntrada.map((d) => {
      const dia = enteroOpcional(d.dia, 1, 31)
      const inicio = hora(d.hora_inicio)
      const fin = hora(d.hora_fin)
      if (!dia || dia > diasDelMes) problemas.push(`El día ${String(d.dia)} no existe en ${mes}/${anio}`)
      if (inicio === undefined || fin === undefined) problemas.push(`Día ${String(d.dia)}: faltan las horas de inicio o fin`)
      else if (fin <= inicio) problemas.push(`Día ${dia}: la hora fin (${fin}) debe ser mayor que la de inicio (${inicio}); si pasa de medianoche escribe la hora fin sumando 24 (20 → 28)`)
      const fecha = dia ? new Date(Date.UTC(anio, mes - 1, dia)) : null
      return {
        dia: dia ?? 0,
        hora_inicio: inicio ?? 0,
        hora_fin: fin ?? 0,
        total_horas: inicio !== undefined && fin !== undefined && fin > inicio ? Math.round((fin - inicio) * 100) / 100 : 0,
        es_festivo: d.es_festivo === true,
        es_domingo: fecha ? fecha.getUTCDay() === 0 : false,
        pernocte: d.pernocte === true,
        disponibilidad: d.disponibilidad === true,
        continua_siguiente_dia: (fin ?? 0) > 24,
        kilometraje_inicial: typeof d.kilometraje_inicial === 'number' ? d.kilometraje_inicial : null,
        kilometraje_final: typeof d.kilometraje_final === 'number' ? d.kilometraje_final : null,
        observaciones: textoOpcional(d.observaciones, 300) ?? null,
      }
    })
    if (problemas.length) return { creado: false, problemas }

    const servicioId = idDeServicio(args.servicio)
    const servicio = servicioId
      ? await prisma.servicio.findFirst({ where: { id: servicioId, deleted_at: null }, select: { id: true, cliente_id: true, clientes: { select: { nombre: true } } } })
      : null
    if (servicioId && !servicio) return { creado: false, error: 'No existe el servicio indicado' }

    const conductorTexto = textoOpcional(args.conductor, 80)
    const placaTexto = textoOpcional(args.placa, 20)
    const clienteTexto = textoOpcional(args.cliente, 120)
    if (!conductorTexto || !placaTexto) return { error: 'Faltan el conductor o la placa' }
    if (!clienteTexto && !servicio) return { error: 'Falta el cliente (o un servicio del que tomarlo)' }

    const [rc, rv, rcl] = await Promise.all([
      resolverConductor(conductorTexto),
      resolverVehiculo(placaTexto),
      clienteTexto ? resolverCliente(clienteTexto) : Promise.resolve(null),
    ])
    const fallos = [rc, rv, rcl].filter((r): r is { ok: false; error: string; candidatos?: unknown[] } => !!r && !r.ok)
    if (fallos.length) return { creado: false, problemas: fallos.map((f) => f.error), candidatos: fallos.flatMap((f) => f.candidatos ?? []) }
    if (!rc.ok || !rv.ok) return { creado: false, error: 'No se pudo resolver el conductor o la placa' }
    const empresaId = rcl && rcl.ok ? rcl.valor.id : servicio!.cliente_id

    const repetida = await prisma.recargos_planillas.findFirst({
      where: { deleted_at: null, conductor_id: rc.valor.id, vehiculo_id: rv.valor.id, empresa_id: empresaId, mes, a_o: anio },
      select: { numero_planilla: true, estado: true, total_dias_laborados: true },
    })
    if (repetida && args.permitir_repetida !== true) {
      return {
        creado: false,
        ya_existe: { planilla: repetida.numero_planilla, estado: repetida.estado, dias: repetida.total_dias_laborados },
        pista: 'Ya hay una planilla de ese conductor, placa, cliente y periodo. Pregunta al usuario si crea otra de todas formas (permitir_repetida=true) o si quiere revisar la existente',
      }
    }

    const numeroPlanilla = textoOpcional(args.numero_planilla, 50) ?? (await RecargosService.getNextNumeroPlanilla())
    const data = createRecargoSchema.parse({
      conductor_id: rc.valor.id,
      vehiculo_id: rv.valor.id,
      empresa_id: empresaId,
      numero_planilla: numeroPlanilla,
      mes,
      año: anio,
      observaciones: textoOpcional(args.observaciones, 2000) ?? null,
      dias_laborales: dias,
      servicio_id: servicio?.id ?? null,
    })

    // El tercer argumento (actor del historial de la planilla) solo existe en
    // uno de los dos repos gemelos; el otro lo ignora. El cast mantiene el
    // archivo idéntico en ambos.
    const crear = RecargosService.create as (d: typeof data, userId?: string, actor?: unknown) => ReturnType<typeof RecargosService.create>
    const creada = await crear(data, usuario.id, { userId: usuario.id, motivo: 'Creada desde el asistente' })
    const valorPagar = await RecargosService.calcularValorAPagar(creada.id).catch(() => null)
    try {
      getIO()?.emit('recargo-creado', { recargoId: creada.id, recargo: creada, valor_pagar: valorPagar })
    } catch {
      // el socket es opcional
    }

    return {
      creado: true,
      planilla: {
        numero: creada.numero_planilla,
        conductor: `${rc.valor.nombre} ${rc.valor.apellido}`.trim(),
        placa: rv.valor.placa,
        cliente: rcl && rcl.ok ? rcl.valor.nombre : servicio?.clientes?.nombre,
        periodo: `${mes}/${anio}`,
        dias: dias.length,
        horas: dias.reduce((s, d) => s + d.total_horas, 0),
        valor_a_pagar: valorPagar,
        estado: 'pendiente',
        pantalla: ENLACE,
      },
      pendiente: 'Adjuntar la planilla escaneada y liquidarla se hace en la pantalla de Recargos',
    }
  },
}

export const HERRAMIENTAS_RECARGOS: readonly Herramienta[] = [buscarRecargos, detalleRecargo, crearRecargo]
