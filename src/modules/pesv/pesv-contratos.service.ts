/**
 * Contratos de transporte especial, FUEC y cobertura por servicio.
 *
 * Extractos sigue siendo el módulo operativo: expide el extracto y mantiene el
 * TXT. Lo que aporta este archivo es la estructura relacional que el TXT no
 * puede dar —integridad referencial, vigencias comparables, auditoría— y la
 * respuesta a la única pregunta que un inspector hace en carretera: *este
 * servicio, ¿está cubierto?*
 *
 * El PDF emitido es inmutable. Corregir un extracto es ANULAR el anterior y
 * expedir otro; por eso `snapshot_json` guarda todo lo impreso, y por eso
 * `anulado_at` existe en vez de un `UPDATE` sobre las fechas.
 */

import { createHash } from 'crypto'
import { prisma } from '../../config/prisma'
import { normalizarIdentificacion, normalizarPlaca, normalizarTexto, pareceNombreDePersona } from './dominio/calidad'
import { PesvError } from './dominio/errores'
import { diasEntre, fechaAYmd, hoyEnBogota } from './dominio/periodos'
import { registrarAuditoria } from './pesv-auditoria'
import type { ActorPesv } from './pesv-ciclos.service'
import { acredita, clasificarVigencia } from './pesv-documentos.service'

export type EstadoCobertura =
  | 'CUBIERTO'
  | 'SIN_CONTRATO'
  | 'SIN_FUEC'
  | 'VENCIDO'
  | 'VEHICULO_NO_COINCIDE'
  | 'CONDUCTOR_NO_COINCIDE'
  | 'DOCUMENTOS_NO_VIGENTES'
  | 'FUEC_ANULADO'

export const ETIQUETAS_COBERTURA: Record<EstadoCobertura, string> = {
  CUBIERTO: 'Cubierto',
  SIN_CONTRATO: 'Sin contrato relacionado',
  SIN_FUEC: 'Sin extracto FUEC',
  VENCIDO: 'Vigencia expirada para la fecha del servicio',
  VEHICULO_NO_COINCIDE: 'El vehículo del servicio no figura en el FUEC',
  CONDUCTOR_NO_COINCIDE: 'El conductor del servicio no figura en el FUEC',
  DOCUMENTOS_NO_VIGENTES: 'Documentos habilitantes vencidos o sin aprobar',
  FUEC_ANULADO: 'El extracto está anulado',
}

// ─────────────────────────────────────────────────────────────────────────
//  Contratos
// ─────────────────────────────────────────────────────────────────────────

export interface DatosContrato {
  numero: string
  contratanteNombre: string
  contratanteNit?: string | null
  clienteId?: string | null
  terceroId?: string | null
  objeto?: string | null
  tipoServicio?: string | null
  origen?: string | null
  destino?: string | null
  fechaInicio: string
  fechaFin: string
  cantidadVehiculos?: number | null
  claseVehiculos?: string | null
  observaciones?: string | null
}

export async function crearContrato(datos: DatosContrato, actor: ActorPesv) {
  validarRangoFechas(datos.fechaInicio, datos.fechaFin)
  const contrato = await prisma.transport_contract.create({
    data: {
      numero: datos.numero,
      contratante_nombre: datos.contratanteNombre,
      contratante_nit: datos.contratanteNit ?? null,
      cliente_id: datos.clienteId ?? null,
      tercero_id: datos.terceroId ?? null,
      objeto: datos.objeto ?? null,
      tipo_servicio: datos.tipoServicio ?? null,
      origen: datos.origen ?? null,
      destino: datos.destino ?? null,
      fecha_inicio: fecha(datos.fechaInicio),
      fecha_fin: fecha(datos.fechaFin),
      cantidad_vehiculos: datos.cantidadVehiculos ?? null,
      clase_vehiculos: datos.claseVehiculos ?? null,
      observaciones: datos.observaciones ?? null,
      source: 'MANUAL',
      creado_por_id: actor.id,
    },
  })
  await registrarAuditoria({
    entidad: 'CONTRATO',
    entidadId: contrato.id,
    accion: 'CREAR',
    actor,
    detalle: { numero: datos.numero, contratante: datos.contratanteNombre },
  })
  return contrato
}

export async function actualizarContrato(id: string, datos: Partial<DatosContrato>, actor: ActorPesv) {
  const existente = await prisma.transport_contract.findFirst({ where: { id, deleted_at: null } })
  if (!existente) throw new PesvError('CONTRATO_NO_ENCONTRADO', 'El contrato no existe o fue retirado.')
  if (datos.fechaInicio && datos.fechaFin) validarRangoFechas(datos.fechaInicio, datos.fechaFin)

  const actualizado = await prisma.transport_contract.update({
    where: { id },
    data: {
      ...(datos.numero !== undefined ? { numero: datos.numero } : {}),
      ...(datos.contratanteNombre !== undefined ? { contratante_nombre: datos.contratanteNombre } : {}),
      ...(datos.contratanteNit !== undefined ? { contratante_nit: datos.contratanteNit } : {}),
      ...(datos.clienteId !== undefined ? { cliente_id: datos.clienteId } : {}),
      ...(datos.terceroId !== undefined ? { tercero_id: datos.terceroId } : {}),
      ...(datos.objeto !== undefined ? { objeto: datos.objeto } : {}),
      ...(datos.tipoServicio !== undefined ? { tipo_servicio: datos.tipoServicio } : {}),
      ...(datos.origen !== undefined ? { origen: datos.origen } : {}),
      ...(datos.destino !== undefined ? { destino: datos.destino } : {}),
      ...(datos.fechaInicio !== undefined ? { fecha_inicio: fecha(datos.fechaInicio) } : {}),
      ...(datos.fechaFin !== undefined ? { fecha_fin: fecha(datos.fechaFin) } : {}),
      ...(datos.cantidadVehiculos !== undefined ? { cantidad_vehiculos: datos.cantidadVehiculos } : {}),
      ...(datos.claseVehiculos !== undefined ? { clase_vehiculos: datos.claseVehiculos } : {}),
      ...(datos.observaciones !== undefined ? { observaciones: datos.observaciones } : {}),
    },
  })
  await registrarAuditoria({ entidad: 'CONTRATO', entidadId: id, accion: 'ACTUALIZAR', actor, detalle: { ...datos } })
  return actualizado
}

export interface FiltrosContratos {
  q?: string
  estado?: string
  clienteId?: string
  vigenteEn?: string
  limite?: number
}

export async function listarContratos(filtros: FiltrosContratos = {}) {
  const enFecha = filtros.vigenteEn ? fecha(filtros.vigenteEn) : null
  return prisma.transport_contract.findMany({
    where: {
      deleted_at: null,
      ...(filtros.estado ? { estado: filtros.estado as never } : {}),
      ...(filtros.clienteId ? { cliente_id: filtros.clienteId } : {}),
      ...(enFecha ? { fecha_inicio: { lte: enFecha }, fecha_fin: { gte: enFecha } } : {}),
      ...(filtros.q
        ? {
            OR: [
              { numero: { contains: filtros.q, mode: 'insensitive' as const } },
              { contratante_nombre: { contains: filtros.q, mode: 'insensitive' as const } },
              { contratante_nit: { contains: filtros.q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    },
    include: {
      cliente: { select: { id: true, nombre: true, nit: true } },
      _count: { select: { extractos: true, servicios: true } },
    },
    orderBy: { fecha_inicio: 'desc' },
    take: Math.min(filtros.limite ?? 200, 1000),
  })
}

// ─────────────────────────────────────────────────────────────────────────
//  Extractos FUEC
// ─────────────────────────────────────────────────────────────────────────

export interface DatosFuec {
  consecutivo: number
  numeroCompleto?: string | null
  contratoId?: string | null
  vehiculoId?: string | null
  vehiculoPlaca?: string | null
  numeroInterno?: string | null
  tarjetaOperacion?: string | null
  origenDestino?: string | null
  vigenciaDesde: string
  vigenciaHasta: string
  responsable?: string | null
  conductores: Array<{ conductorId?: string | null; nombre: string; identificacion?: string | null; licenciaVigencia?: string | null }>
}

export async function crearFuec(datos: DatosFuec, actor: ActorPesv) {
  validarRangoFechas(datos.vigenciaDesde, datos.vigenciaHasta)

  const ocupado = await prisma.fuec_extract.findFirst({
    where: { consecutivo: datos.consecutivo, deleted_at: null, estado: { not: 'ANULADO' } },
    select: { id: true },
  })
  if (ocupado) {
    throw new PesvError(
      'CONSECUTIVO_OCUPADO',
      `El consecutivo ${datos.consecutivo} ya está en uso por un extracto vigente.`,
      { fuecId: ocupado.id },
    )
  }

  const fuec = await prisma.fuec_extract.create({
    data: {
      consecutivo: datos.consecutivo,
      numero_completo: datos.numeroCompleto ?? String(datos.consecutivo).padStart(4, '0'),
      contrato_id: datos.contratoId ?? null,
      vehiculo_id: datos.vehiculoId ?? null,
      vehiculo_placa: normalizarPlaca(datos.vehiculoPlaca) ?? datos.vehiculoPlaca ?? null,
      numero_interno: datos.numeroInterno ?? null,
      tarjeta_operacion: datos.tarjetaOperacion ?? null,
      origen_destino: datos.origenDestino ?? null,
      vigencia_desde: fecha(datos.vigenciaDesde),
      vigencia_hasta: fecha(datos.vigenciaHasta),
      estado: 'VIGENTE',
      responsable: datos.responsable ?? null,
      source: 'MANUAL',
      /// Snapshot de lo impreso. A partir de aquí, cambiar la placa del vehículo
      /// en Flota no altera lo que dice el documento que se portó.
      snapshot_json: { ...datos } as never,
      creado_por_id: actor.id,
      conductores: {
        create: datos.conductores.filter((c) => pareceNombreDePersona(c.nombre)).map((c, i) => ({
          conductor_id: c.conductorId ?? null,
          nombre: c.nombre.trim(),
          identificacion: normalizarIdentificacion(c.identificacion),
          licencia_vigencia: c.licenciaVigencia ? fecha(c.licenciaVigencia) : null,
          orden: i + 1,
        })),
      },
    },
    include: { conductores: true },
  })

  await registrarAuditoria({
    entidad: 'FUEC',
    entidadId: fuec.id,
    accion: 'EXPEDIR',
    actor,
    detalle: { consecutivo: datos.consecutivo, contratoId: datos.contratoId ?? null },
  })
  return fuec
}

/**
 * Anula un extracto.
 *
 * No borra ni edita: el documento ya se imprimió y alguien lo lleva encima. La
 * corrección es un extracto nuevo que apunta a este con `reemplaza_a_id`.
 */
export async function anularFuec(id: string, motivo: string, actor: ActorPesv) {
  const fuec = await prisma.fuec_extract.findFirst({ where: { id, deleted_at: null } })
  if (!fuec) throw new PesvError('FUEC_NO_ENCONTRADO', 'El extracto no existe o fue retirado.')
  if (fuec.estado === 'ANULADO') {
    throw new PesvError('FUEC_ANULADO', 'El extracto ya estaba anulado.')
  }
  if (!motivo?.trim()) {
    throw new PesvError('DATOS_INVALIDOS', 'Anular un extracto exige un motivo escrito.')
  }

  const anulado = await prisma.fuec_extract.update({
    where: { id },
    data: {
      estado: 'ANULADO',
      anulado_at: new Date(),
      anulado_por_id: actor.id,
      motivo_anulacion: motivo,
    },
  })
  await registrarAuditoria({ entidad: 'FUEC', entidadId: id, accion: 'ANULAR', actor, detalle: { motivo } })
  return anulado
}

export interface FiltrosFuec {
  q?: string
  estado?: string
  contratoId?: string
  vehiculoId?: string
  vigenteEn?: string
  limite?: number
}

export async function listarFuec(filtros: FiltrosFuec = {}) {
  const enFecha = filtros.vigenteEn ? fecha(filtros.vigenteEn) : null
  return prisma.fuec_extract.findMany({
    where: {
      deleted_at: null,
      ...(filtros.estado ? { estado: filtros.estado as never } : {}),
      ...(filtros.contratoId ? { contrato_id: filtros.contratoId } : {}),
      ...(filtros.vehiculoId ? { vehiculo_id: filtros.vehiculoId } : {}),
      ...(enFecha ? { vigencia_desde: { lte: enFecha }, vigencia_hasta: { gte: enFecha } } : {}),
      ...(filtros.q
        ? {
            OR: [
              { numero_completo: { contains: filtros.q, mode: 'insensitive' as const } },
              { vehiculo_placa: { contains: filtros.q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    },
    include: {
      contrato: { select: { id: true, numero: true, contratante_nombre: true, estado: true } },
      conductores: { orderBy: { orden: 'asc' } },
      vehiculo: { select: { id: true, placa: true } },
    },
    orderBy: { consecutivo: 'desc' },
    take: Math.min(filtros.limite ?? 200, 1000),
  })
}

// ─────────────────────────────────────────────────────────────────────────
//  Cobertura por servicio
// ─────────────────────────────────────────────────────────────────────────

export interface CoberturaServicio {
  servicioId: string
  fecha: string | null
  numeroPlanilla: string | null
  clienteNombre: string | null
  vehiculoPlaca: string | null
  conductorNombre: string | null
  estado: EstadoCobertura
  motivo: string
  contrato: { id: string; numero: string; contratanteNombre: string } | null
  fuec: { id: string; numeroCompleto: string; estado: string; vigenciaHasta: string | null } | null
  /// Documentos habilitantes del vehículo que hoy no acreditan.
  documentosFaltantes: string[]
  enlaceExtractos: string
  enlaceServicio: string
}

export interface FiltrosCobertura {
  desde: string
  hasta: string
  estado?: EstadoCobertura
  clienteId?: string
  vehiculoId?: string
  limite?: number
}

/**
 * Evalúa la cobertura contractual de los servicios del rango.
 *
 * Un servicio está `CUBIERTO` solo si se cumple TODO: contrato vigente para su
 * fecha, FUEC vigente ligado a ese contrato, vehículo y conductor presentes en
 * el FUEC, y documentos habilitantes vigentes. El primero que falla da el
 * estado, y el orden de comprobación va de lo más grave a lo más fino: decir
 * «el conductor no coincide» cuando ni siquiera hay contrato despistaría a
 * quien tiene que corregirlo.
 */
export async function evaluarCobertura(filtros: FiltrosCobertura): Promise<CoberturaServicio[]> {
  const hoy = hoyEnBogota()
  const desde = fecha(filtros.desde)
  const hasta = new Date(fecha(filtros.hasta).getTime() + 86_399_999)

  const servicios = await prisma.servicio.findMany({
    where: {
      deleted_at: null,
      estado: { notIn: ['cancelado'] },
      ...(filtros.clienteId ? { cliente_id: filtros.clienteId } : {}),
      ...(filtros.vehiculoId ? { vehiculo_id: filtros.vehiculoId } : {}),
      OR: [
        { fecha_realizacion: { gte: desde, lte: hasta } },
        { fecha_realizacion: null, fecha_solicitud: { gte: desde, lte: hasta } },
      ],
    },
    select: {
      id: true,
      numero_planilla: true,
      fecha_realizacion: true,
      fecha_solicitud: true,
      cliente_id: true,
      vehiculo_id: true,
      conductor_id: true,
      contrato_id: true,
      fuec_id: true,
      clientes: { select: { id: true, nombre: true, nit: true } },
      vehiculos: { select: { id: true, placa: true } },
      conductores: { select: { id: true, nombre: true, apellido: true, numero_identificacion: true } },
      contrato: { select: { id: true, numero: true, contratante_nombre: true, fecha_inicio: true, fecha_fin: true, estado: true } },
      fuec: {
        select: {
          id: true,
          numero_completo: true,
          estado: true,
          vigencia_desde: true,
          vigencia_hasta: true,
          vehiculo_id: true,
          vehiculo_placa: true,
          contrato_id: true,
          conductores: { select: { conductor_id: true, identificacion: true, nombre: true } },
        },
      },
    },
    orderBy: [{ fecha_realizacion: 'desc' }, { fecha_solicitud: 'desc' }],
    take: Math.min(filtros.limite ?? 500, 2000),
  })

  /// Los documentos habilitantes de los vehículos implicados se leen de una vez.
  /// Uno por servicio serían cientos de consultas para una pantalla.
  const vehiculoIds = Array.from(
    new Set(servicios.map((s) => s.vehiculo_id).filter((x): x is string => Boolean(x))),
  )
  const documentos = vehiculoIds.length
    ? await prisma.documento.findMany({
        where: {
          deleted_at: null,
          vehiculo_id: { in: vehiculoIds },
          tipo_documento: { in: ['SOAT', 'RTM', 'TARJETA_OPERACION'] },
        },
        select: {
          vehiculo_id: true,
          tipo_documento: true,
          estado_revision: true,
          fecha_vencimiento: true,
          fecha_vigencia: true,
        },
      })
    : []

  const habilitantesPorVehiculo = new Map<string, string[]>()
  for (const vid of vehiculoIds) {
    const suyos = documentos.filter((d) => d.vehiculo_id === vid)
    const faltantes: string[] = []
    for (const tipo of ['SOAT', 'RTM', 'TARJETA_OPERACION']) {
      const doc = suyos.find((d) => d.tipo_documento === tipo)
      if (!doc) {
        /// Ausente NO es lo mismo que vencido, y por eso se etiqueta distinto:
        /// durante la normalización habrá vehículos sin el tipo asignado
        /// todavía, y confundirlo con un vencimiento generaría alarmas falsas.
        faltantes.push(`${tipo} sin registrar`)
        continue
      }
      const vence = fechaAYmd(doc.fecha_vencimiento) ?? fechaAYmd(doc.fecha_vigencia)
      const { estado } = clasificarVigencia(vence, hoy)
      if (!acredita(doc.estado_revision as never, estado)) {
        faltantes.push(`${tipo} ${estado === 'VENCIDO' ? 'vencido' : 'sin aprobar'}`)
      }
    }
    habilitantesPorVehiculo.set(vid, faltantes)
  }

  const filas: CoberturaServicio[] = servicios.map((s) => {
    const fechaServicio = fechaAYmd(s.fecha_realizacion ?? s.fecha_solicitud)
    const faltantes = s.vehiculo_id ? (habilitantesPorVehiculo.get(s.vehiculo_id) ?? []) : []

    const base = {
      servicioId: s.id,
      fecha: fechaServicio,
      numeroPlanilla: s.numero_planilla,
      clienteNombre: s.clientes?.nombre ?? null,
      vehiculoPlaca: s.vehiculos?.placa ?? null,
      conductorNombre: s.conductores ? `${s.conductores.nombre} ${s.conductores.apellido}`.trim() : null,
      contrato: s.contrato
        ? { id: s.contrato.id, numero: s.contrato.numero, contratanteNombre: s.contrato.contratante_nombre }
        : null,
      fuec: s.fuec
        ? {
            id: s.fuec.id,
            numeroCompleto: s.fuec.numero_completo,
            estado: s.fuec.estado,
            vigenciaHasta: fechaAYmd(s.fuec.vigencia_hasta),
          }
        : null,
      documentosFaltantes: faltantes,
      enlaceExtractos: s.fuec ? `/dashboard/extractos?fuec=${s.fuec.id}` : '/dashboard/extractos',
      enlaceServicio: `/dashboard/servicios?id=${s.id}`,
    }

    const estado = clasificarCobertura(s, fechaServicio, faltantes)
    return { ...base, estado, motivo: ETIQUETAS_COBERTURA[estado] }
  })

  return filtros.estado ? filas.filter((f) => f.estado === filtros.estado) : filas
}

type ServicioParaCobertura = {
  vehiculo_id: string | null
  conductor_id: string | null
  contrato_id: string | null
  contrato: { fecha_inicio: Date; fecha_fin: Date; estado: string } | null
  fuec: {
    estado: string
    vigencia_desde: Date
    vigencia_hasta: Date
    vehiculo_id: string | null
    contrato_id: string | null
    conductores: Array<{ conductor_id: string | null }>
  } | null
}

/** Pura y exportada: es la regla que hay que poder probar caso por caso. */
export function clasificarCobertura(
  servicio: ServicioParaCobertura,
  fechaServicio: string | null,
  documentosFaltantes: string[],
): EstadoCobertura {
  if (!servicio.contrato) return 'SIN_CONTRATO'
  if (!servicio.fuec) return 'SIN_FUEC'
  if (servicio.fuec.estado === 'ANULADO') return 'FUEC_ANULADO'

  if (fechaServicio) {
    const inicio = fechaAYmd(servicio.contrato.fecha_inicio)!
    const fin = fechaAYmd(servicio.contrato.fecha_fin)!
    const fuecDesde = fechaAYmd(servicio.fuec.vigencia_desde)!
    const fuecHasta = fechaAYmd(servicio.fuec.vigencia_hasta)!
    const fueraDeContrato = diasEntre(inicio, fechaServicio) < 0 || diasEntre(fechaServicio, fin) < 0
    const fueraDeFuec = diasEntre(fuecDesde, fechaServicio) < 0 || diasEntre(fechaServicio, fuecHasta) < 0
    if (fueraDeContrato || fueraDeFuec) return 'VENCIDO'
  }

  /// El FUEC tiene que colgar del MISMO contrato. Un extracto vigente de otro
  /// contrato no cubre este servicio: sin esta comprobación bastaría con tener
  /// cualquier FUEC vivo para aparecer en verde.
  if (servicio.fuec.contrato_id && servicio.contrato_id && servicio.fuec.contrato_id !== servicio.contrato_id) {
    return 'SIN_FUEC'
  }

  if (servicio.vehiculo_id && servicio.fuec.vehiculo_id && servicio.fuec.vehiculo_id !== servicio.vehiculo_id) {
    return 'VEHICULO_NO_COINCIDE'
  }

  if (servicio.conductor_id) {
    const autorizados = servicio.fuec.conductores.map((c) => c.conductor_id).filter(Boolean)
    /// Si el FUEC no tiene ningún conductor conciliado, no se puede afirmar que
    /// el del servicio no figure: se deja pasar esta comprobación y la
    /// conciliación pendiente aparece en la bandeja del importador. Afirmar
    /// «no coincide» sobre datos sin conciliar produciría cientos de alertas
    /// falsas el primer día.
    if (autorizados.length > 0 && !autorizados.includes(servicio.conductor_id)) {
      return 'CONDUCTOR_NO_COINCIDE'
    }
  }

  if (documentosFaltantes.length > 0) return 'DOCUMENTOS_NO_VIGENTES'

  return 'CUBIERTO'
}

export function resumirCobertura(filas: CoberturaServicio[]) {
  const porEstado = {} as Record<EstadoCobertura, number>
  for (const estado of Object.keys(ETIQUETAS_COBERTURA) as EstadoCobertura[]) porEstado[estado] = 0
  for (const f of filas) porEstado[f.estado] += 1
  return {
    total: filas.length,
    cubiertos: porEstado.CUBIERTO,
    /// Todo lo que no está cubierto es un servicio que hoy no se puede
    /// demostrar. Se agrupa para la tarjeta del resumen, y el detalle sigue
    /// disponible por estado.
    sinCobertura: filas.length - porEstado.CUBIERTO,
    porEstado,
    porcentaje: filas.length > 0 ? Math.round((porEstado.CUBIERTO / filas.length) * 1000) / 10 : null,
  }
}

/** Relaciona un servicio con su contrato y su extracto. */
export async function vincularServicio(
  servicioId: string,
  vinculo: { contratoId?: string | null; fuecId?: string | null },
  actor: ActorPesv,
) {
  const servicio = await prisma.servicio.findFirst({ where: { id: servicioId, deleted_at: null }, select: { id: true } })
  if (!servicio) throw new PesvError('DATOS_INVALIDOS', 'El servicio no existe o fue retirado.')

  if (vinculo.fuecId) {
    const fuec = await prisma.fuec_extract.findFirst({
      where: { id: vinculo.fuecId, deleted_at: null },
      select: { id: true, estado: true, contrato_id: true },
    })
    if (!fuec) throw new PesvError('FUEC_NO_ENCONTRADO', 'El extracto no existe.')
    if (fuec.estado === 'ANULADO') {
      throw new PesvError('FUEC_ANULADO', 'No se puede vincular un servicio a un extracto anulado.')
    }
    if (!fuec.contrato_id && !vinculo.contratoId) {
      throw new PesvError(
        'FUEC_SIN_CONTRATO',
        'El extracto no tiene contrato asociado. Relacione primero el contrato.',
      )
    }
  }

  const actualizado = await prisma.servicio.update({
    where: { id: servicioId },
    data: {
      ...(vinculo.contratoId !== undefined ? { contrato_id: vinculo.contratoId } : {}),
      ...(vinculo.fuecId !== undefined ? { fuec_id: vinculo.fuecId } : {}),
    },
  })
  await registrarAuditoria({
    entidad: 'CONTRATO',
    entidadId: vinculo.contratoId ?? null,
    accion: 'VINCULAR_SERVICIO',
    actor,
    detalle: { servicioId, ...vinculo },
  })
  return actualizado
}

// ─────────────────────────────────────────────────────────────────────────
//  Utilidades
// ─────────────────────────────────────────────────────────────────────────

function fecha(valor: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
    throw new PesvError('DATOS_INVALIDOS', `Fecha inválida, se esperaba YYYY-MM-DD: "${valor}".`)
  }
  return new Date(`${valor}T00:00:00Z`)
}

function validarRangoFechas(desde: string, hasta: string): void {
  if (diasEntre(desde, hasta) < 0) {
    throw new PesvError('DATOS_INVALIDOS', 'La fecha final no puede ser anterior a la inicial.')
  }
}

/**
 * Huella estable de una fila del TXT.
 *
 * Es lo que hace idempotente la importación: se calcula sobre el contenido
 * NORMALIZADO, no sobre la línea cruda, para que un espacio de más o un cambio
 * de mayúsculas no produzca una huella distinta y duplique el registro.
 *
 * El consecutivo entra en la huella; el número de línea no. El archivo se
 * reordena al añadir filas por arriba, y usar la posición haría que la
 * reimportación duplicara el archivo entero.
 */
export function huellaFilaFuec(campos: {
  consecutivo: string
  contratante: string
  placa: string
  fechaInicial: string
  fechaFinal: string
}): string {
  const canonico = [
    campos.consecutivo.trim().replace(/^0+/, ''),
    normalizarTexto(campos.contratante),
    normalizarPlaca(campos.placa) ?? normalizarTexto(campos.placa),
    campos.fechaInicial.trim(),
    campos.fechaFinal.trim(),
  ].join('|')
  return createHash('sha256').update(canonico).digest('hex')
}
