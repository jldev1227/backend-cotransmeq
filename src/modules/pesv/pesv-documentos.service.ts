/**
 * Vigencia documental unificada.
 *
 * Dos ejes INDEPENDIENTES, y esta es la decisión central del archivo:
 *
 *   Revisión → PENDIENTE | APROBADO | RECHAZADO   (¿alguien lo validó?)
 *   Vigencia → SIN_FECHA | VIGENTE | POR_VENCER | VENCIDO  (¿sigue sirviendo?)
 *
 * Cruzarlos en un solo estado es lo que hace que un SOAT aprobado hace un año y
 * vencido ayer siga apareciendo en verde. Un documento acredita un requisito
 * solo si está APROBADO **y** VIGENTE.
 *
 * No se crea una tabla nueva: `documento` ya existe con miles de filas y su
 * `fecha_vigencia`. La migración le añadió `tipo_documento`, `fecha_vencimiento`
 * y el eje de revisión, y aquí se lee lo uno o lo otro sin invalidar lo cargado
 * antes.
 */

import { prisma } from '../../config/prisma'
import { PesvError } from './dominio/errores'
import { diasEntre, fechaAYmd, hoyEnBogota } from './dominio/periodos'
import { registrarAuditoria } from './pesv-auditoria'
import { puedeRevisar, type ActorPesv } from './pesv-ciclos.service'

export type EstadoVigencia = 'SIN_FECHA' | 'VIGENTE' | 'POR_VENCER' | 'VENCIDO'
export type EstadoRevisionDoc = 'PENDIENTE' | 'APROBADO' | 'RECHAZADO'
export type AmbitoDocumento = 'CONDUCTOR' | 'VEHICULO' | 'TERCERO' | 'CONTRATO' | 'EMPRESA'

/** Ventana por defecto cuando ni el tipo ni el ciclo la definen. */
export const DIAS_POR_VENCER_POR_DEFECTO = 30

/**
 * Clasifica la vigencia de una fecha de vencimiento.
 *
 * Puro y exportado para que se pruebe sin base: el borde del umbral —el día
 * exacto en que un documento pasa de VIGENTE a POR_VENCER— es donde fallan
 * estas cosas, y probarlo exige poder fijar «hoy».
 */
export function clasificarVigencia(
  vence: string | null,
  hoy: string,
  diasPorVencer: number = DIAS_POR_VENCER_POR_DEFECTO,
): { estado: EstadoVigencia; diasRestantes: number | null } {
  if (!vence) return { estado: 'SIN_FECHA', diasRestantes: null }
  const dias = diasEntre(hoy, vence)
  if (dias < 0) return { estado: 'VENCIDO', diasRestantes: dias }
  if (dias <= diasPorVencer) return { estado: 'POR_VENCER', diasRestantes: dias }
  return { estado: 'VIGENTE', diasRestantes: dias }
}

/**
 * ¿El documento acredita algo hoy?
 *
 * Exige las dos cosas. Un documento rechazado o vencido no acredita aunque el
 * archivo exista, que es exactamente lo que la especificación pide impedir.
 */
export function acredita(revision: EstadoRevisionDoc, vigencia: EstadoVigencia): boolean {
  if (revision !== 'APROBADO') return false
  return vigencia === 'VIGENTE' || vigencia === 'POR_VENCER' || vigencia === 'SIN_FECHA'
}

export interface ConfigTipoDocumento {
  tipo: string
  etiqueta: string
  ambito: AmbitoDocumento
  diasPorVencer: number
  obligatorio: boolean
  orden: number
}

export async function listarTiposDocumento(): Promise<ConfigTipoDocumento[]> {
  const filas = await prisma.pesv_document_type_config.findMany({
    where: { activo: true },
    orderBy: [{ orden: 'asc' }, { etiqueta: 'asc' }],
  })
  return filas.map((f) => ({
    tipo: f.tipo,
    etiqueta: f.etiqueta,
    ambito: f.ambito as AmbitoDocumento,
    diasPorVencer: f.dias_por_vencer,
    obligatorio: f.obligatorio,
    orden: f.orden,
  }))
}

export async function actualizarTipoDocumento(
  tipo: string,
  cambios: { diasPorVencer?: number; obligatorio?: boolean; activo?: boolean; etiqueta?: string },
  actor: ActorPesv,
) {
  if (!puedeRevisar(actor)) {
    throw new PesvError(
      'PROHIBIDO',
      'Solo HSEQ o Administración pueden cambiar la configuración documental.',
    )
  }
  if (cambios.diasPorVencer != null && (cambios.diasPorVencer < 0 || cambios.diasPorVencer > 365)) {
    throw new PesvError('DATOS_INVALIDOS', 'La ventana de preaviso debe estar entre 0 y 365 días.')
  }

  const actualizado = await prisma.pesv_document_type_config.update({
    where: { tipo },
    data: {
      ...(cambios.diasPorVencer != null ? { dias_por_vencer: cambios.diasPorVencer } : {}),
      ...(cambios.obligatorio != null ? { obligatorio: cambios.obligatorio } : {}),
      ...(cambios.activo != null ? { activo: cambios.activo } : {}),
      ...(cambios.etiqueta ? { etiqueta: cambios.etiqueta } : {}),
    },
  })
  await registrarAuditoria({
    entidad: 'DOCUMENTO',
    entidadId: null,
    accion: 'CONFIGURAR_TIPO',
    actor,
    detalle: { tipo, ...cambios },
  })
  return actualizado
}

export interface FiltrosDocumentos {
  ambito?: AmbitoDocumento
  tipo?: string
  estadoVigencia?: EstadoVigencia
  estadoRevision?: EstadoRevisionDoc
  conductorId?: string
  vehiculoId?: string
  /** Fecha de corte. Por defecto, hoy en zona de negocio. */
  corte?: string
  q?: string
  limite?: number
}

export interface AlertaDocumental {
  id: string
  ambito: AmbitoDocumento
  tipo: string | null
  tipoEtiqueta: string
  numero: string | null
  emisor: string | null
  nombreArchivo: string
  titular: { tipo: string; id: string | null; etiqueta: string }
  fechaExpedicion: string | null
  fechaVencimiento: string | null
  estadoVigencia: EstadoVigencia
  diasRestantes: number | null
  estadoRevision: EstadoRevisionDoc
  acredita: boolean
  obligatorio: boolean
  enlace: string
}

/**
 * Alertas documentales, ya cruzadas con la configuración de cada tipo.
 *
 * La fecha de vencimiento sale de `fecha_vencimiento` si está informada y, si
 * no, de `fecha_vigencia`, que es lo único que tienen los documentos anteriores
 * a la normalización. Sin esa caída, todos los documentos históricos aparecerían
 * como `SIN_FECHA` y la pantalla de alertas nacería vacía.
 */
export async function listarDocumentos(filtros: FiltrosDocumentos = {}): Promise<AlertaDocumental[]> {
  const hoy = filtros.corte ?? hoyEnBogota()
  const tipos = await listarTiposDocumento()
  const porTipo = new Map(tipos.map((t) => [t.tipo, t]))

  const documentos = await prisma.documento.findMany({
    where: {
      deleted_at: null,
      estado: { not: 'ELIMINADO' },
      ...(filtros.tipo ? { tipo_documento: filtros.tipo } : {}),
      ...(filtros.estadoRevision ? { estado_revision: filtros.estadoRevision } : {}),
      ...(filtros.conductorId ? { conductor_id: filtros.conductorId } : {}),
      ...(filtros.vehiculoId ? { vehiculo_id: filtros.vehiculoId } : {}),
    },
    select: {
      id: true,
      categoria: true,
      nombre_original: true,
      tipo_documento: true,
      numero: true,
      emisor: true,
      fecha_expedicion: true,
      fecha_vencimiento: true,
      fecha_vigencia: true,
      estado_revision: true,
      conductor_id: true,
      vehiculo_id: true,
      tercero_id: true,
      contrato_id: true,
      vehiculos: { select: { id: true, placa: true } },
    },
    take: Math.min(filtros.limite ?? 1000, 5000),
    orderBy: { fecha_vencimiento: 'asc' },
  })

  /// Los conductores se resuelven en UNA consulta y no por documento:
  /// `documento.conductor_id` no tiene relación en Prisma (la columna arrastra
  /// huérfanos y una FK nueva no se puede crear sin depurarlos), así que el
  /// join se hace aquí a mano.
  const conductorIds = Array.from(
    new Set(documentos.map((d) => d.conductor_id).filter((x): x is string => Boolean(x))),
  )
  const conductores = conductorIds.length
    ? await prisma.conductores.findMany({
        where: { id: { in: conductorIds } },
        select: { id: true, nombre: true, apellido: true, numero_identificacion: true },
      })
    : []
  const porConductor = new Map(conductores.map((c) => [c.id, c]))

  const alertas: AlertaDocumental[] = documentos.map((d) => {
    const config = d.tipo_documento ? porTipo.get(d.tipo_documento) : undefined
    const vence = fechaAYmd(d.fecha_vencimiento) ?? fechaAYmd(d.fecha_vigencia)
    const { estado, diasRestantes } = clasificarVigencia(
      vence,
      hoy,
      config?.diasPorVencer ?? DIAS_POR_VENCER_POR_DEFECTO,
    )
    const revision = d.estado_revision as EstadoRevisionDoc

    const ambito: AmbitoDocumento = config?.ambito
      ?? (d.conductor_id ? 'CONDUCTOR' : d.vehiculo_id ? 'VEHICULO' : d.tercero_id ? 'TERCERO' : d.contrato_id ? 'CONTRATO' : 'EMPRESA')

    const conductor = d.conductor_id ? porConductor.get(d.conductor_id) : undefined
    const titular = conductor
      ? {
          tipo: 'CONDUCTOR',
          id: conductor.id,
          etiqueta: `${conductor.nombre} ${conductor.apellido}`.trim(),
        }
      : d.vehiculos
        ? { tipo: 'VEHICULO', id: d.vehiculos.id, etiqueta: d.vehiculos.placa }
        : { tipo: ambito, id: d.tercero_id ?? d.contrato_id ?? null, etiqueta: '—' }

    return {
      id: d.id,
      ambito,
      tipo: d.tipo_documento,
      /// Sin tipo normalizado se muestra la `categoria` histórica. Es texto
      /// libre y por eso no sirve para configurar umbrales, pero es lo que
      /// permite reconocer el documento mientras se normaliza.
      tipoEtiqueta: config?.etiqueta ?? d.tipo_documento ?? d.categoria,
      numero: d.numero,
      emisor: d.emisor,
      nombreArchivo: d.nombre_original,
      titular,
      fechaExpedicion: fechaAYmd(d.fecha_expedicion),
      fechaVencimiento: vence,
      estadoVigencia: estado,
      diasRestantes,
      estadoRevision: revision,
      acredita: acredita(revision, estado),
      obligatorio: config?.obligatorio ?? false,
      enlace:
        titular.tipo === 'CONDUCTOR' && titular.id
          ? `/dashboard/conductores?id=${titular.id}`
          : titular.tipo === 'VEHICULO' && titular.id
            ? `/dashboard/flota?id=${titular.id}`
            : '/dashboard/flota',
    }
  })

  return aplicarFiltrosDocumentos(alertas, filtros)
}

function aplicarFiltrosDocumentos(alertas: AlertaDocumental[], filtros: FiltrosDocumentos): AlertaDocumental[] {
  const q = filtros.q?.trim().toLowerCase()
  return alertas.filter((a) => {
    if (filtros.ambito && a.ambito !== filtros.ambito) return false
    if (filtros.estadoVigencia && a.estadoVigencia !== filtros.estadoVigencia) return false
    if (q) {
      const heno = `${a.tipoEtiqueta} ${a.numero ?? ''} ${a.nombreArchivo} ${a.titular.etiqueta}`.toLowerCase()
      if (!q.split(/\s+/).every((p) => heno.includes(p))) return false
    }
    return true
  })
}

/** Conteos para las tarjetas del resumen. */
export function resumirDocumentos(alertas: AlertaDocumental[]) {
  const contar = (pred: (a: AlertaDocumental) => boolean) => alertas.filter(pred).length
  return {
    total: alertas.length,
    vencidos: contar((a) => a.estadoVigencia === 'VENCIDO'),
    porVencer: contar((a) => a.estadoVigencia === 'POR_VENCER'),
    vigentes: contar((a) => a.estadoVigencia === 'VIGENTE'),
    sinFecha: contar((a) => a.estadoVigencia === 'SIN_FECHA'),
    pendientesRevision: contar((a) => a.estadoRevision === 'PENDIENTE'),
    rechazados: contar((a) => a.estadoRevision === 'RECHAZADO'),
    /// El número que de verdad importa: obligatorios que HOY no acreditan nada.
    obligatoriosSinAcreditar: contar((a) => a.obligatorio && !a.acredita),
  }
}

export interface NormalizacionDocumento {
  tipoDocumento?: string | null
  numero?: string | null
  emisor?: string | null
  fechaExpedicion?: string | null
  fechaVencimiento?: string | null
  terceroId?: string | null
  contratoId?: string | null
}

/** Completa los campos normalizados de un documento ya cargado. */
export async function normalizarDocumento(id: string, datos: NormalizacionDocumento, actor: ActorPesv) {
  const doc = await prisma.documento.findFirst({ where: { id, deleted_at: null }, select: { id: true } })
  if (!doc) throw new PesvError('DATOS_INVALIDOS', 'El documento no existe o fue retirado.')

  const fecha = (v: string | null | undefined) => {
    if (v === undefined) return undefined
    if (v === null || v === '') return null
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      throw new PesvError('DATOS_INVALIDOS', `Fecha inválida, se esperaba YYYY-MM-DD: "${v}".`)
    }
    return new Date(`${v}T00:00:00Z`)
  }

  const actualizado = await prisma.documento.update({
    where: { id },
    data: {
      ...(datos.tipoDocumento !== undefined ? { tipo_documento: datos.tipoDocumento } : {}),
      ...(datos.numero !== undefined ? { numero: datos.numero } : {}),
      ...(datos.emisor !== undefined ? { emisor: datos.emisor } : {}),
      ...(datos.fechaExpedicion !== undefined ? { fecha_expedicion: fecha(datos.fechaExpedicion) } : {}),
      ...(datos.fechaVencimiento !== undefined ? { fecha_vencimiento: fecha(datos.fechaVencimiento) } : {}),
      ...(datos.terceroId !== undefined ? { tercero_id: datos.terceroId } : {}),
      ...(datos.contratoId !== undefined ? { contrato_id: datos.contratoId } : {}),
      updated_at: new Date(),
    },
  })

  await registrarAuditoria({
    entidad: 'DOCUMENTO',
    entidadId: id,
    accion: 'NORMALIZAR',
    actor,
    detalle: { ...datos },
  })
  return actualizado
}

/** Aprueba o rechaza un documento. Mismas reglas que la evidencia PESV. */
export async function revisarDocumento(
  id: string,
  decision: { decision: EstadoRevisionDoc; observacion?: string | null },
  actor: ActorPesv,
) {
  if (!puedeRevisar(actor)) {
    throw new PesvError(
      'REVISION_NO_AUTORIZADA',
      'Solo HSEQ o Administración pueden aprobar o rechazar documentos.',
    )
  }
  if (decision.decision === 'RECHAZADO' && !decision.observacion?.trim()) {
    throw new PesvError('DATOS_INVALIDOS', 'Un rechazo exige una observación.')
  }

  const actualizado = await prisma.documento.update({
    where: { id },
    data: {
      estado_revision: decision.decision,
      revisado_por_id: actor.id,
      revisado_at: new Date(),
      observacion_revision: decision.observacion ?? null,
      updated_at: new Date(),
    },
  })

  await registrarAuditoria({
    entidad: 'DOCUMENTO',
    entidadId: id,
    accion: `REVISAR_${decision.decision}`,
    actor,
    detalle: { observacion: decision.observacion ?? null },
  })
  return actualizado
}
