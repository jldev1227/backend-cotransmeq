import { prisma } from '../../config/prisma'
import { createServicioSchema } from '../servicios/servicios.schema'
import { ServiciosService } from '../servicios/servicios.service'
import { emitServicioCreado } from '../servicios/servicios.events'
import type { Herramienta } from './asistente.types'
import { fechaCorta, textoOpcional } from './asistente.utils'
import { buscarLugares, coincidenciaExacta, coordenadasValidas, guardarLugar, type LugarFrecuente } from './lugares'

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

async function resolverCliente(texto: string) {
  const filas = await prisma.clientes.findMany({
    where: {
      deletedAt: null,
      oculto: false,
      OR: [{ nombre: { contains: texto, mode: 'insensitive' } }, { nit: { contains: texto, mode: 'insensitive' } }],
    },
    select: { id: true, nombre: true, nit: true },
    take: 10,
  })
  return elegir(filas, texto, (f) => f.nombre ?? '', (f) => ({ cliente: f.nombre, nit: f.nit }), 'clientes')
}

async function resolverMunicipio(nombre: string, departamento?: string) {
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

async function resolverConductor(texto: string) {
  const partes = texto.split(/\s+/).filter(Boolean)
  const filas = await prisma.conductores.findMany({
    where: {
      deleted_at: null,
      oculto: false,
      AND: partes.map((p) => ({
        OR: [
          { nombre: { contains: p, mode: 'insensitive' as const } },
          { apellido: { contains: p, mode: 'insensitive' as const } },
          { numero_identificacion: { contains: p } },
        ],
      })),
    },
    select: { id: true, nombre: true, apellido: true, numero_identificacion: true, estado: true },
    take: 10,
  })
  return elegir(
    filas,
    texto,
    (f) => `${f.nombre} ${f.apellido}`,
    (f) => ({ conductor: `${f.nombre} ${f.apellido}`, cedula: f.numero_identificacion, estado: f.estado }),
    'conductores',
  )
}

async function resolverVehiculo(placa: string) {
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

export const crearServicio: Herramienta = {
  nombre: 'crear_servicio',
  descripcion:
    'Programa (crea) un servicio de transporte: cliente, municipio de origen y destino, punto exacto de origen/destino, fecha y hora de realización, y opcionalmente conductor, placa, propósito y observaciones. Antes de llamarla muestra al usuario el resumen completo y espera su confirmación; pasa confirmado=true solo entonces. Los puntos exactos se cruzan con el historial: si ya se visitaron, el servicio hereda sus coordenadas; si son nuevos, la herramienta devuelve lugares_nuevos y debes preguntar al usuario si quiere dar latitud/longitud o crearlo sin coordenadas (sin_coordenadas=true). Si el conductor o el vehículo no están disponibles, no crea nada hasta que el usuario lo autorice (forzar_recursos_ocupados=true). Tarifa, planilla y recargos se dejan para después del servicio.',
  parametros: {
    type: 'object',
    properties: {
      confirmado: {
        type: 'boolean',
        description: 'true SOLO después de que el usuario confirmó el resumen del servicio',
      },
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
      sin_coordenadas: {
        type: 'boolean',
        description: 'true solo si el usuario dijo que no tiene o no quiere dar coordenadas para un lugar nuevo',
      },
      forzar_recursos_ocupados: {
        type: 'boolean',
        description: 'true solo si el usuario aceptó asignar un conductor o vehículo que no está disponible',
      },
    },
    required: ['confirmado', 'cliente', 'origen_municipio', 'destino_municipio', 'fecha_realizacion'],
    additionalProperties: false,
  },
  etiqueta: 'Creando el servicio',
  requiere: 'servicios',
  nivel: 'full',
  escribe: true,
  canales: ['app'],
  async ejecutar(args, usuario) {
    if (args.confirmado !== true) {
      return { error: 'Falta la confirmación del usuario: muéstrale el resumen y pregúntale si lo creas' }
    }

    const cliente = textoOpcional(args.cliente)
    const origenMun = textoOpcional(args.origen_municipio)
    const destinoMun = textoOpcional(args.destino_municipio)
    const fecha = fechaColombia(args.fecha_realizacion)
    if (!cliente || !origenMun || !destinoMun) return { error: 'Faltan cliente, origen o destino' }
    if (!fecha) return { error: 'La fecha de realización debe venir como AAAA-MM-DD HH:mm' }

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
      return { creado: false, problemas: problemas.map((p) => ({ error: p.error, candidatos: p.candidatos })) }
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
        creado: false,
        error: 'Recursos no disponibles; no se creó el servicio',
        detalle: ocupados,
        pista: 'Pregunta al usuario si lo asigna igual, elige otro conductor/vehículo o lo deja sin asignar. Si lo asigna igual, vuelve a llamar con forzar_recursos_ocupados=true',
      }
    }

    if (!rCliente.ok || !rOrigen.ok || !rDestino.ok) return { error: 'No se pudo resolver el servicio' }

    // Lugares específicos: historial primero; coordenadas del usuario si las dio;
    // si el lugar es nuevo y nadie decidió, se devuelve la pregunta sin crear.
    const [origen, destino] = await Promise.all([
      resolverLugar('origen', textoOpcional(args.origen_especifico, 255), rOrigen.valor.id, args.origen_latitud, args.origen_longitud),
      resolverLugar('destino', textoOpcional(args.destino_especifico, 255), rDestino.valor.id, args.destino_latitud, args.destino_longitud),
    ])
    const candidatosLugar = [origen, destino].filter((l) => l.candidatos?.length)
    if (candidatosLugar.length) {
      return {
        creado: false,
        lugares_parecidos: candidatosLugar.map((l) => ({ campo: l.campo, texto: l.nombre, candidatos: l.candidatos })),
        pista: 'Pregunta al usuario si se refiere a uno de esos lugares (ya tienen coordenadas) o si es uno nuevo; con la respuesta vuelve a llamar usando el nombre exacto elegido',
      }
    }
    const nuevos = [origen, destino].filter((l) => l.nombre && !l.coords)
    if (nuevos.length && args.sin_coordenadas !== true) {
      return {
        creado: false,
        lugares_nuevos: nuevos.map((l) => ({ campo: l.campo, texto: l.nombre })),
        pista: 'Son lugares que no se habían visitado. Pregunta al usuario si quiere dar sus coordenadas (latitud y longitud) para guardarlas y aprovecharlas en futuros servicios, o crearlo sin coordenadas. Con la respuesta vuelve a llamar con origen_latitud/origen_longitud (o destino_*) o con sin_coordenadas=true',
      }
    }

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

    const servicio = await ServiciosService.create(data, usuario.id)
    // Mismo evento que el controlador REST: todos los conectados ven el servicio
    // nuevo en su lista sin recargar.
    emitServicioCreado(servicio)

    // Lugares nuevos con coordenadas dadas por el usuario: quedan guardados.
    const lugaresGuardados: string[] = []
    for (const l of [origen, destino]) {
      if (l.nombre && l.coords && l.fuente === 'usuario') {
        const municipio = l.campo === 'origen' ? rOrigen.valor.id : rDestino.valor.id
        if (await guardarLugar(l.nombre, l.coords, municipio, usuario.id)) lugaresGuardados.push(l.nombre)
      }
    }

    return {
      creado: true,
      servicio: {
        cliente: rCliente.valor.nombre,
        origen: `${rOrigen.valor.nombre_municipio} (${rOrigen.valor.nombre_departamento})${data.origen_especifico ? ` · ${data.origen_especifico}` : ''}`,
        destino: `${rDestino.valor.nombre_municipio} (${rDestino.valor.nombre_departamento})${data.destino_especifico ? ` · ${data.destino_especifico}` : ''}`,
        fecha_realizacion: fechaHora(fecha),
        fecha_solicitud: fechaCorta(ahora),
        conductor: conductor ? `${conductor.nombre} ${conductor.apellido}` : 'sin asignar',
        placa: vehiculo?.placa ?? 'sin asignar',
        proposito,
        estado: estado.replace('_', ' '),
        observaciones: data.observaciones,
        enlace: `/dashboard/servicios/${(servicio as { id: string }).id}`,
      },
      lugares: [origen, destino]
        .filter((l) => l.nombre)
        .map((l) => ({
          campo: l.campo,
          nombre: l.nombre,
          coordenadas: l.coords ? `${l.coords.lat}, ${l.coords.lng}` : 'sin coordenadas',
          origen_coordenadas:
            l.fuente === 'historial' ? `del historial (${l.veces} servicios)` : l.fuente === 'guardado' ? 'lugar guardado' : l.fuente === 'usuario' ? 'dadas por el usuario' : 'ninguna',
        })),
      lugares_guardados_para_el_futuro: lugaresGuardados,
      advertencias: ocupados,
      pendiente: 'Tarifa, número de planilla y recargos se registran después del servicio',
    }
  },
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

export const ACCIONES: readonly Herramienta[] = [crearServicio]
