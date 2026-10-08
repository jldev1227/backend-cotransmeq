import { prisma } from '../../config/prisma'
import { createServicioSchema } from '../servicios/servicios.schema'
import { ServiciosService } from '../servicios/servicios.service'
import { emitServicioCreado } from '../servicios/servicios.events'
import type { Herramienta } from './asistente.types'
import { conYSinTildes, fechaCorta, textoOpcional, variantesNombre } from './asistente.utils'
import { buscarLugares, coincidenciaExacta, coordenadasValidas, guardarLugar, type LugarFrecuente } from './lugares'
import { cargarServicio, idDeServicio, propositoDe, rutaDe, type PuntoRuta } from './servicio-referencia'

/**
 * Acciones del asistente: herramientas que ESCRIBEN.
 *
 * Reglas que comparten todas:
 *  - Piden el mismo permiso que la ruta REST equivalente (`requiere` + `nivel:
 *    'full'`), así que quien puede hacerlo en la pantalla puede pedírselo al
 *    asistente, y nadie más. Van solo por el canal de la app: el MCP sigue
 *    siendo de solo lectura.
 *  - Pasan por el MISMO esquema zod y el MISMO servicio que el controlador, y
 *    emiten los mismos eventos de socket: para el resto de la app un servicio
 *    creado desde el chat es indistinguible de uno creado en el modal.
 *  - Reciben nombres (cliente, municipio, conductor, placa) y los resuelven
 *    aquí. Si algo no existe o es ambiguo, devuelven candidatos y NO crean nada:
 *    el modelo tiene que volver a preguntar, nunca adivinar.
 *  - Exigen `confirmado: true`, que el prompt obliga a poner solo después de
 *    que el usuario aprobó el resumen. Es la segunda barrera, además del prompt.
 *  - Los lugares específicos (pozo, base, hotel) se cruzan con el historial
 *    (`lugares.ts`): si ya se visitó, el servicio hereda sus coordenadas y el
 *    nombre tal como se escribió antes; si es nuevo, no se crea hasta que el
 *    usuario decida si da coordenadas o no, y si las da se guardan para la
 *    próxima vez.
 */

function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

/** Resultado de resolver un nombre a un registro: uno, ninguno o varios. */
type Resuelto<T> = { ok: true; valor: T } | { ok: false; error: string; candidatos?: unknown[] }

function elegir<T extends { id: string }>(
  filas: T[],
  texto: string,
  exacto: (f: T) => string,
  describir: (f: T) => unknown,
  que: string,
): Resuelto<T> {
  if (filas.length === 0) return { ok: false, error: `No encontré ${que} «${texto}»` }
  if (filas.length === 1) return { ok: true, valor: filas[0] }
  const q = normalizar(texto)
  const exactos = filas.filter((f) => normalizar(exacto(f)) === q)
  if (exactos.length === 1) return { ok: true, valor: exactos[0] }
  return {
    ok: false,
    error: `Hay varios ${que} que coinciden con «${texto}»; pregunta al usuario cuál es`,
    candidatos: filas.slice(0, 8).map(describir),
  }
}

export async function resolverCliente(texto: string) {
  // El modelo a veces manda el cliente tal como lo mostró: «FEPCO SERVICIOS
  // S.A.S — NIT 860.528.871». Se prueba el texto entero, luego solo el nombre
  // (antes del guion o del paréntesis) y, si trae un NIT, por sus dígitos
  // (en la base el NIT puede llevar puntos o el dígito de verificación).
  const nombre = texto.split(/\s+[—–-]\s+|\s*\(/)[0].trim()
  const digitos = texto.replace(/\D/g, '')
  const variantes = [...new Set([texto.trim(), nombre.replace(/^nit\s*/i, '')].filter(Boolean))]
  let filas: { id: string; nombre: string | null; nit: string | null }[] = []
  for (const v of variantes) {
    filas = await prisma.clientes.findMany({
      where: {
        deletedAt: null,
        OR: [{ nombre: { contains: v, mode: 'insensitive' } }, { nit: { contains: v, mode: 'insensitive' } }],
      },
      select: { id: true, nombre: true, nit: true },
      take: 10,
    })
    if (filas.length) break
  }
  if (digitos.length >= 6) {
    const porNit = (await prisma.clientes.findMany({ where: { deletedAt: null, nit: { not: null } }, select: { id: true, nombre: true, nit: true } })).filter((c) =>
      (c.nit ?? '').replace(/\D/g, '').startsWith(digitos),
    )
    if (porNit.length === 1) return { ok: true as const, valor: porNit[0] }
    if (filas.length === 0) filas = porNit
  }
  return elegir(filas, nombre, (f) => f.nombre ?? '', (f) => ({ cliente: f.nombre, nit: f.nit }), 'clientes')
}

export async function resolverMunicipio(nombre: string, departamento?: string) {
  const filas = await prisma.municipios.findMany({
    where: {
      nombre_municipio: { contains: nombre, mode: 'insensitive' },
      ...(departamento ? { nombre_departamento: { contains: departamento, mode: 'insensitive' } } : {}),
    },
    select: { id: true, nombre_municipio: true, nombre_departamento: true },
    orderBy: [{ nombre_municipio: 'asc' }, { nombre_departamento: 'asc' }],
    take: 10,
  })
  return elegir(
    filas,
    nombre,
    (f) => f.nombre_municipio,
    (f) => ({ municipio: f.nombre_municipio, departamento: f.nombre_departamento }),
    'municipios',
  )
}

export async function resolverConductor(texto: string) {
  // Misma tolerancia que buscar_conductores: si el nombre completo no trae a
  // nadie, se sueltan palabras. Con menos palabras es más fácil que haya
  // varios: `elegir` devuelve candidatos y el modelo pregunta.
  let filas: { id: string; nombre: string; apellido: string; numero_identificacion: string; estado: unknown }[] = []
  for (const v of variantesNombre(texto)) {
    filas = await prisma.conductores.findMany({
      where: {
        deleted_at: null,
        AND: v.partes.map((p) => ({
          OR: conYSinTildes(p).flatMap((x) => [
            { nombre: { contains: x, mode: 'insensitive' as const } },
            { apellido: { contains: x, mode: 'insensitive' as const } },
            { numero_identificacion: { contains: x } },
          ]),
        })),
      },
      select: { id: true, nombre: true, apellido: true, numero_identificacion: true, estado: true },
      take: 10,
    })
    if (filas.length) break
  }
  return elegir(
    filas,
    texto,
    (f) => `${f.nombre} ${f.apellido}`,
    (f) => ({ conductor: `${f.nombre} ${f.apellido}`, cedula: f.numero_identificacion, estado: f.estado }),
    'conductores',
  )
}

export async function resolverVehiculo(placa: string) {
  const limpia = placa.replace(/[\s-]/g, '').toUpperCase()
  const filas = await prisma.vehiculos.findMany({
    where: { deleted_at: null, placa: { contains: limpia, mode: 'insensitive' } },
    select: { id: true, placa: true, estado: true, marca: true, linea: true },
    take: 10,
  })
  return elegir(filas, limpia, (f) => f.placa, (f) => ({ placa: f.placa, estado: f.estado }), 'vehículos')
}

/** «2026-10-05 06:00» o «2026-10-05T06:00», en hora de Colombia. */
function fechaColombia(valor: unknown): Date | undefined {
  if (typeof valor !== 'string') return undefined
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(valor.trim())
  if (!m) return undefined
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00-05:00`)
  return Number.isNaN(d.getTime()) ? undefined : d
}

function fechaHora(d: Date): string {
  return d.toLocaleString('es-CO', {
    timeZone: 'America/Bogota',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/// Conductor y vehículo que se pueden asignar sin avisar. Cualquier otro estado
/// (`servicio`, `mantenimiento`, `vacaciones`…) exige que el usuario lo confirme.
const CONDUCTOR_LIBRE = new Set(['disponible', 'activo'])
const VEHICULO_LIBRE = new Set(['disponible'])

/** Campos de UN servicio; los comparten `crear_servicio` y `crear_servicios`. */
const PROPIEDADES_SERVICIO = {
  cliente: { type: 'string', description: 'Nombre o NIT del cliente' },
  origen_municipio: { type: 'string', description: 'Municipio de origen (p. ej. Yopal)' },
  origen_departamento: { type: 'string', description: 'Departamento del origen, si el municipio se repite' },
  origen_especifico: { type: 'string', description: 'Punto exacto de origen (base, hotel, dirección)' },
  destino_municipio: { type: 'string', description: 'Municipio de destino' },
  destino_departamento: { type: 'string', description: 'Departamento del destino, si el municipio se repite' },
  destino_especifico: { type: 'string', description: 'Punto exacto de destino' },
  fecha_realizacion: {
    type: 'string',
    description: 'Fecha y hora de realización en hora de Colombia, formato AAAA-MM-DD HH:mm',
  },
  conductor: { type: 'string', description: 'Nombre o cédula del conductor (opcional)' },
  placa: { type: 'string', description: 'Placa del vehículo (opcional)' },
  proposito: {
    type: 'string',
    enum: ['personal', 'personal y herramienta'],
    description: 'Qué se transporta; por defecto personal',
  },
  observaciones: { type: 'string', description: 'Observaciones o descripción del servicio' },
  origen_latitud: { type: 'number', description: 'Latitud del punto de origen, si el usuario la dio' },
  origen_longitud: { type: 'number' },
  destino_latitud: { type: 'number', description: 'Latitud del punto de destino, si el usuario la dio' },
  destino_longitud: { type: 'number' },
  servicio_referencia: {
    type: 'string',
    description:
      'Id o enlace de un servicio existente que el usuario da como modelo («igual a este», «la misma ruta invertida de este»). El servidor copia de él la ruta exacta (municipios, puntos y coordenadas) y, si no se indican, el cliente y el propósito. No pases origen ni destino cuando uses esto.',
  },
  invertir_ruta: {
    type: 'boolean',
    description: 'Con servicio_referencia: true si el usuario pidió la ruta invertida (el destino de la referencia pasa a ser el origen y viceversa).',
  },
  sin_coordenadas: {
    type: 'boolean',
    description: 'Ya no hace falta: un lugar nuevo se crea sin coordenadas y la respuesta lo avisa.',
  },
  forzar_recursos_ocupados: {
    type: 'boolean',
    description: 'true solo si el usuario aceptó asignar un conductor o vehículo que no está disponible',
  },
  
} as const

/// Cliente, origen y destino son obligatorios, pero pueden venir de
/// `servicio_referencia`: por eso el esquema solo exige la fecha y el resto lo
/// valida `prepararServicio`. Exigirlos en el esquema obligaba al modelo a
/// escribir una ruta aunque la fuera a copiar el servidor, y la escribía mal.
const OBLIGATORIOS_SERVICIO = ['fecha_realizacion'] as const

const DESCRIPCION_REGLAS =
  'Los puntos exactos se cruzan con el historial: si ya se visitaron, el servicio hereda sus coordenadas; si son nuevos se crean sin coordenadas y la respuesta lo avisa (no preguntes por coordenadas antes). Si el usuario da un servicio como modelo («igual a este», «la ruta invertida de este»), pasa servicio_referencia (y invertir_ruta) en vez de escribir origen y destino. Si el conductor o el vehículo no están disponibles, no crea nada hasta que el usuario lo autorice (forzar_recursos_ocupados=true). Tarifa, planilla y recargos se dejan para después del servicio.'

export const crearServicio: Herramienta = {
  nombre: 'crear_servicio',
  descripcion:
    'Programa (crea) UN servicio de transporte: cliente, municipio de origen y destino, punto exacto de origen/destino, fecha y hora de realización, y opcionalmente conductor, placa, propósito y observaciones. Para varios servicios a la vez usa crear_servicios. Antes de llamarla muestra al usuario el resumen completo y espera su confirmación; pasa confirmado=true solo entonces. ' +
    DESCRIPCION_REGLAS,
  parametros: {
    type: 'object',
    properties: {
      confirmado: {
        type: 'boolean',
        description: 'true SOLO después de que el usuario confirmó el resumen del servicio',
      },
      ...PROPIEDADES_SERVICIO,
    },
    required: ['confirmado', ...OBLIGATORIOS_SERVICIO],
    additionalProperties: false,
  },
  etiqueta: 'Creando el servicio',
  requiere: 'servicios',
  nivel: 'full',
  escribe: true,
  async ejecutar(args, usuario) {
    if (args.confirmado !== true) {
      return { error: 'Falta la confirmación del usuario: muéstrale el resumen y pregúntale si lo creas' }
    }
    const preparado = await prepararServicio(args)
    if (preparado.ok === false) return preparado.respuesta
    const creado = await materializarServicio(preparado.listo, usuario.id)
    return preparado.listo.avisos.length ? { ...creado, avisos: preparado.listo.avisos } : creado
  },
}

const MAX_SERVICIOS_LOTE = 20

/**
 * Varios servicios en una sola orden («regístrame 3 servicios de X el 5, 6 y
 * 7…»). Primero se resuelven TODOS; si alguno tiene un problema (nombre
 * ambiguo, lugar nuevo, recurso ocupado) no se crea ninguno y se devuelven los
 * problemas con la posición de cada uno, para que el modelo pregunte una sola
 * vez. Cuando todos están limpios se crean en el orden dado, uno tras otro,
 * cada uno con su evento de socket.
 */
export const crearServicios: Herramienta = {
  nombre: 'crear_servicios',
  descripcion:
    `Programa (crea) VARIOS servicios de transporte de una vez, en el orden dado (hasta ${MAX_SERVICIOS_LOTE}). Cada elemento lleva los mismos campos que crear_servicio; repite en cada uno los datos comunes (cliente, origen, destino). Antes de llamarla muestra al usuario una tabla con todos los servicios y espera UNA confirmación; pasa confirmado=true solo entonces. Si algún servicio tiene un problema no se crea ninguno: la respuesta trae los problemas con la posición (1, 2, 3…) de cada uno. ` +
    DESCRIPCION_REGLAS,
  parametros: {
    type: 'object',
    properties: {
      confirmado: {
        type: 'boolean',
        description: 'true SOLO después de que el usuario confirmó la tabla con todos los servicios',
      },
      servicios: {
        type: 'array',
        minItems: 1,
        maxItems: MAX_SERVICIOS_LOTE,
        description: 'Los servicios a crear, en orden',
        items: {
          type: 'object',
          properties: PROPIEDADES_SERVICIO,
          required: [...OBLIGATORIOS_SERVICIO],
          additionalProperties: false,
        },
      },
    },
    required: ['confirmado', 'servicios'],
    additionalProperties: false,
  },
  etiqueta: 'Creando los servicios',
  requiere: 'servicios',
  nivel: 'full',
  escribe: true,
  async ejecutar(args, usuario) {
    if (args.confirmado !== true) {
      return { error: 'Falta la confirmación del usuario: muéstrale la tabla con todos los servicios y pregúntale si los creas' }
    }
    const lista = Array.isArray(args.servicios) ? args.servicios : []
    if (lista.length === 0) return { error: 'No llegó ningún servicio' }
    if (lista.length > MAX_SERVICIOS_LOTE) {
      return { error: `Son demasiados servicios para una sola orden (máximo ${MAX_SERVICIOS_LOTE}); divídelos en varias` }
    }

    // Fase 1: resolver todos. Un solo problema frena el lote entero.
    const preparados = await Promise.all(
      lista.map((item) => prepararServicio(item && typeof item === 'object' ? (item as Record<string, unknown>) : {})),
    )
    const conProblemas = preparados
      .map((p, i) => (p.ok === true ? null : { posicion: i + 1, ...p.respuesta }))
      .filter((p): p is NonNullable<typeof p> => p !== null)
    if (conProblemas.length) {
      return {
        creados: 0,
        total: lista.length,
        problemas: conProblemas,
        pista: 'No se creó ninguno. Resuelve con el usuario cada problema (indicando a qué servicio corresponde por su posición) y vuelve a llamar con el lote completo',
      }
    }

    // Fase 2: crear en orden. Si uno falla, los anteriores ya existen y se dice.
    const creados: unknown[] = []
    for (const [i, p] of preparados.entries()) {
      if (p.ok === false) continue
      try {
        creados.push({
          posicion: i + 1,
          ...(await materializarServicio(p.listo, usuario.id)),
          ...(p.listo.avisos.length ? { avisos: p.listo.avisos } : {}),
        })
      } catch (e) {
        return {
          creados: creados.length,
          total: lista.length,
          servicios: creados,
          error: `El servicio ${i + 1} falló al guardarse: ${(e as Error).message}. Los ${creados.length} anteriores sí quedaron creados; los siguientes no se intentaron`,
        }
      }
    }
    return {
      creados: creados.length,
      total: lista.length,
      servicios: creados,
      pendiente: 'Tarifa, número de planilla y recargos se registran después de cada servicio',
    }
  },
}

/** Todo lo que hace falta para crear un servicio, ya resuelto y validado. */
interface ServicioListo {
  data: ReturnType<typeof createServicioSchema.parse>
  fecha: Date
  ahora: Date
  estado: string
  proposito: string
  cliente: { id: string; nombre: string | null }
  origenMun: { id: string; nombre_municipio: string; nombre_departamento: string }
  destinoMun: { id: string; nombre_municipio: string; nombre_departamento: string }
  conductor: { id: string; nombre: string; apellido: string } | null
  vehiculo: { id: string; placa: string } | null
  origen: LugarResuelto
  destino: LugarResuelto
  ocupados: string[]
  avisos: string[]
}

type Preparado = { ok: true; listo: ServicioListo } | { ok: false; respuesta: Record<string, unknown> }

/**
 * Fase 1 de una creación: resuelve nombres, disponibilidad y lugares. No
 * escribe nada. Si algo impide crear, devuelve la respuesta que el modelo debe
 * ver (candidatos, lugares nuevos, recursos ocupados).
 */
async function prepararServicio(argsModelo: Record<string, unknown>): Promise<Preparado> {
  /// Servicio de referencia: la ruta sale de la base, no del modelo. Cliente
  /// y propósito solo si el modelo no los dio.
  let args = argsModelo
  let rutaRef: { origen: PuntoRuta; destino: PuntoRuta } | null = null
  if (argsModelo.servicio_referencia !== undefined && argsModelo.servicio_referencia !== null && argsModelo.servicio_referencia !== '') {
    const id = idDeServicio(argsModelo.servicio_referencia)
    const ref = id ? await cargarServicio(id) : null
    if (!ref) {
      return { ok: false, respuesta: { creado: false, error: 'No encontré el servicio de referencia; pide su enlace o id completo' } }
    }
    rutaRef = rutaDe(ref, argsModelo.invertir_ruta === true)
    args = {
      ...argsModelo,
      cliente: textoOpcional(argsModelo.cliente) ?? ref.clientes.nit ?? ref.clientes.nombre,
      proposito: argsModelo.proposito ?? propositoDe(ref),
      origen_municipio: rutaRef.origen.municipio,
      origen_departamento: rutaRef.origen.departamento,
      destino_municipio: rutaRef.destino.municipio,
      destino_departamento: rutaRef.destino.departamento,
    }
  }
  const cliente = textoOpcional(args.cliente)
  const origenMun = textoOpcional(args.origen_municipio)
  const destinoMun = textoOpcional(args.destino_municipio)
  const fecha = fechaColombia(args.fecha_realizacion)
  if (!cliente || !origenMun || !destinoMun) return { ok: false, respuesta: { error: 'Faltan cliente, origen o destino' } }
  if (!fecha) return { ok: false, respuesta: { error: 'La fecha de realización debe venir como AAAA-MM-DD HH:mm' } }

  const [rCliente, rOrigen, rDestino] = await Promise.all([
    resolverCliente(cliente),
    resolverMunicipio(origenMun, textoOpcional(args.origen_departamento, 60)),
    resolverMunicipio(destinoMun, textoOpcional(args.destino_departamento, 60)),
  ])
  const conductorTexto = textoOpcional(args.conductor)
  const placaTexto = textoOpcional(args.placa, 12)
  const rConductor = conductorTexto ? await resolverConductor(conductorTexto) : null
  const rVehiculo = placaTexto ? await resolverVehiculo(placaTexto) : null

  const problemas = [rCliente, rOrigen, rDestino, rConductor, rVehiculo].filter(
    (r): r is Extract<Resuelto<unknown>, { ok: false }> => r !== null && !r.ok,
  )
  if (problemas.length) {
    return {
      ok: false,
      respuesta: { creado: false, problemas: problemas.map((p) => ({ error: p.error, candidatos: p.candidatos })) },
    }
  }

  const conductor = rConductor && rConductor.ok ? rConductor.valor : null
  const vehiculo = rVehiculo && rVehiculo.ok ? rVehiculo.valor : null

  const ocupados: string[] = []
  if (conductor && !CONDUCTOR_LIBRE.has(String(conductor.estado))) {
    ocupados.push(`El conductor ${conductor.nombre} ${conductor.apellido} está en estado «${conductor.estado}»`)
  }
  if (vehiculo && !VEHICULO_LIBRE.has(String(vehiculo.estado))) {
    ocupados.push(`El vehículo ${vehiculo.placa} está en estado «${vehiculo.estado}»`)
  }
  if (ocupados.length && args.forzar_recursos_ocupados !== true) {
    return {
      ok: false,
      respuesta: {
        creado: false,
        error: 'Recursos no disponibles; no se creó el servicio',
        detalle: ocupados,
        pista: 'Pregunta al usuario si lo asigna igual, elige otro conductor/vehículo o lo deja sin asignar. Si lo asigna igual, vuelve a llamar con forzar_recursos_ocupados=true',
      },
    }
  }

  if (!rCliente.ok || !rOrigen.ok || !rDestino.ok) return { ok: false, respuesta: { error: 'No se pudo resolver el servicio' } }

  // Lugares específicos: historial primero; coordenadas del usuario si las dio;
  // si el lugar es nuevo y nadie decidió, se devuelve la pregunta sin crear.
  const [origen, destino] = rutaRef
    ? await Promise.all([
        deReferencia('origen', rutaRef.origen, rOrigen.valor.id),
        deReferencia('destino', rutaRef.destino, rDestino.valor.id),
      ])
    : await Promise.all([
        resolverLugar('origen', textoOpcional(args.origen_especifico, 255), rOrigen.valor.id, args.origen_latitud, args.origen_longitud),
        resolverLugar('destino', textoOpcional(args.destino_especifico, 255), rDestino.valor.id, args.destino_latitud, args.destino_longitud),
      ])
  const candidatosLugar = [origen, destino].filter((l) => l.candidatos?.length)
  if (candidatosLugar.length) {
    return {
      ok: false,
      respuesta: {
        creado: false,
        lugares_parecidos: candidatosLugar.map((l) => ({ campo: l.campo, texto: l.nombre, candidatos: l.candidatos })),
        pista: 'Pregunta al usuario si se refiere a uno de esos lugares (ya tienen coordenadas) o si es uno nuevo; con la respuesta vuelve a llamar usando el nombre exacto elegido',
      },
    }
  }
  /// Un lugar nuevo ya NO frena la creación. Antes se devolvía la pregunta de
  /// las coordenadas incluso después de que el usuario dijera «créalo»: era
  /// una ronda más para un dato opcional que casi nadie tiene a mano.
  const avisos = [origen, destino]
    .filter((l) => l.nombre && !l.coords)
    .map((l) => `El ${l.campo} «${l.nombre}» quedó sin coordenadas (lugar nuevo); se pueden agregar después en el servicio.`)

  // Mismo criterio que el modal de la app: con conductor y vehículo el
  // servicio nace planificado (o en curso si la fecha ya pasó); si falta
  // alguno, queda solicitado.
  const ahora = new Date()
  const estado = conductor && vehiculo ? (fecha < ahora ? 'en_curso' : 'planificado') : 'solicitado'
  const proposito = args.proposito === 'personal y herramienta' ? 'personal y herramienta' : 'personal'

  const data = createServicioSchema.parse({
    cliente_id: rCliente.valor.id,
    origen_id: rOrigen.valor.id,
    destino_id: rDestino.valor.id,
    origen_especifico: origen.nombre ?? '',
    destino_especifico: destino.nombre ?? '',
    origen_latitud: origen.coords?.lat,
    origen_longitud: origen.coords?.lng,
    destino_latitud: destino.coords?.lat,
    destino_longitud: destino.coords?.lng,
    conductor_id: conductor?.id,
    vehiculo_id: vehiculo?.id,
    proposito_servicio: proposito,
    fecha_solicitud: ahora.toISOString(),
    fecha_realizacion: fecha.toISOString(),
    estado,
    observaciones: textoOpcional(args.observaciones, 2000),
  })

  return {
    ok: true,
    listo: {
      data,
      fecha,
      ahora,
      estado,
      proposito,
      cliente: rCliente.valor,
      origenMun: rOrigen.valor,
      destinoMun: rDestino.valor,
      conductor,
      vehiculo,
      origen,
      destino,
      ocupados,
      avisos,
    },
  }
}

/** Fase 2: guarda el servicio, avisa por socket y guarda los lugares nuevos. */
async function materializarServicio(s: ServicioListo, usuarioId: string) {
  const servicio = await ServiciosService.create(s.data, usuarioId)
  // Mismo evento que el controlador REST: todos los conectados ven el servicio
  // nuevo en su lista sin recargar.
  emitServicioCreado(servicio)

  // Lugares nuevos con coordenadas dadas por el usuario: quedan guardados.
  const lugaresGuardados: string[] = []
  for (const l of [s.origen, s.destino]) {
    if (l.nombre && l.coords && l.fuente === 'usuario') {
      const municipio = l.campo === 'origen' ? s.origenMun.id : s.destinoMun.id
      if (await guardarLugar(l.nombre, l.coords, municipio, usuarioId)) lugaresGuardados.push(l.nombre)
    }
  }

  return {
    creado: true,
    servicio: {
      cliente: s.cliente.nombre,
      origen: `${s.origenMun.nombre_municipio} (${s.origenMun.nombre_departamento})${s.data.origen_especifico ? ` · ${s.data.origen_especifico}` : ''}`,
      destino: `${s.destinoMun.nombre_municipio} (${s.destinoMun.nombre_departamento})${s.data.destino_especifico ? ` · ${s.data.destino_especifico}` : ''}`,
      fecha_realizacion: fechaHora(s.fecha),
      fecha_solicitud: fechaCorta(s.ahora),
      conductor: s.conductor ? `${s.conductor.nombre} ${s.conductor.apellido}` : 'sin asignar',
      placa: s.vehiculo?.placa ?? 'sin asignar',
      proposito: s.proposito,
      estado: s.estado.replace('_', ' '),
      observaciones: s.data.observaciones,
      enlace: `/dashboard/servicios/${(servicio as { id: string }).id}`,
    },
    lugares: [s.origen, s.destino]
      .filter((l) => l.nombre)
      .map((l) => ({
        campo: l.campo,
        nombre: l.nombre,
        coordenadas: l.coords ? `${l.coords.lat}, ${l.coords.lng}` : 'sin coordenadas',
        origen_coordenadas:
          l.fuente === 'historial' ? `del historial (${l.veces} servicios)` : l.fuente === 'guardado' ? 'lugar guardado' : l.fuente === 'usuario' ? 'dadas por el usuario' : 'ninguna',
      })),
    lugares_guardados_para_el_futuro: lugaresGuardados,
    advertencias: s.ocupados,
    pendiente: 'Tarifa, número de planilla y recargos se registran después del servicio',
  }
}

interface LugarResuelto {
  campo: 'origen' | 'destino'
  nombre: string | undefined
  coords: { lat: number; lng: number } | null
  fuente: 'historial' | 'guardado' | 'usuario' | 'ninguna'
  veces?: number
  candidatos?: { lugar: string; veces: number; coordenadas: boolean }[]
}

/**
 * Resuelve un punto específico:
 *  1. coordenadas dadas por el usuario → se usan tal cual (fuente `usuario`);
 *  2. coincidencia exacta en lugares guardados o en el historial → nombre
 *     canónico y sus coordenadas;
 *  3. coincidencias parciales → candidatos para que el modelo pregunte;
 *  4. nada → lugar nuevo, sin coordenadas.
 */
async function resolverLugar(
  campo: 'origen' | 'destino',
  nombre: string | undefined,
  municipioId: string,
  lat: unknown,
  lng: unknown,
): Promise<LugarResuelto> {
  if (!nombre) return { campo, nombre, coords: null, fuente: 'ninguna' }

  const dadas = lat !== undefined && lng !== undefined ? coordenadasValidas(lat, lng) : null
  if (dadas) return { campo, nombre, coords: dadas, fuente: 'usuario' }

  const lugares = await buscarLugares(nombre, municipioId)
  const exacto = coincidenciaExacta(lugares, nombre)
  if (exacto) return deLugar(campo, exacto)

  if (lugares.length) {
    return {
      campo,
      nombre,
      coords: null,
      fuente: 'ninguna',
      candidatos: lugares.slice(0, 5).map((l) => ({ lugar: l.nombre, veces: l.veces, coordenadas: l.latitud !== null })),
    }
  }
  return { campo, nombre, coords: null, fuente: 'ninguna' }
}

/**
 * Punto copiado de un servicio de referencia (no se vuelve a guardar). Si la
 * referencia no traía coordenadas se buscan en el historial, pero solo por
 * coincidencia EXACTA del nombre: con un parecido se arriesgaría a pegarle al
 * servicio las coordenadas de otro sitio.
 */
async function deReferencia(campo: 'origen' | 'destino', p: PuntoRuta, municipioId: string): Promise<LugarResuelto> {
  if (p.coords || !p.especifico) {
    return { campo, nombre: p.especifico, coords: p.coords, fuente: p.coords ? 'historial' : 'ninguna' }
  }
  const exacto = coincidenciaExacta(await buscarLugares(p.especifico, municipioId), p.especifico)
  return exacto ? deLugar(campo, exacto) : { campo, nombre: p.especifico, coords: null, fuente: 'ninguna' }
}

function deLugar(campo: 'origen' | 'destino', l: LugarFrecuente): LugarResuelto {
  const coords = l.latitud !== null && l.longitud !== null ? coordenadasValidas(l.latitud, l.longitud) : null
  return {
    campo,
    nombre: l.nombre,
    coords,
    fuente: coords ? (l.fuente === 'guardado' ? 'guardado' : 'historial') : 'ninguna',
    veces: l.veces,
  }
}

export const ACCIONES: readonly Herramienta[] = [crearServicio, crearServicios]
