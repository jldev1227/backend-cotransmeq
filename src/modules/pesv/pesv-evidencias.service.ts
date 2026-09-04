/**
 * Evidencias del expediente PESV.
 *
 * Las cuatro reglas que este archivo hace cumplir, y de dónde salen:
 *
 *  1. **Adjuntar no acredita.** La evidencia nace `PENDIENTE`. Es la diferencia
 *     entre un expediente y una carpeta con archivos.
 *  2. **Solo HSEQ o Administración revisan.** El área que aporta puede
 *     aportar; aprobar es otro acto y lo hace otra gente.
 *  3. **Nadie aprueba lo suyo.** Aunque tenga permiso de revisión. Un revisor
 *     que también aporta es normal en una empresa pequeña; que se firme a sí
 *     mismo el soporte no lo es.
 *  4. **Corregir es versionar.** Una evidencia rechazada no se edita: se crea
 *     otra que la reemplaza, y las dos quedan. El historial de revisiones es
 *     inmutable.
 *
 * Un vínculo a un registro de otro módulo guarda además un SNAPSHOT legible: si
 * mañana alguien edita el envío del formulario o da de baja al conductor, lo que
 * el auditor vio tiene que seguir diciendo lo que decía.
 */

import type { Prisma } from '@prisma/client'
import { randomUUID } from 'crypto'
import { prisma } from '../../config/prisma'
import {
  getS3SignedUrl,
  getS3UploadUrl,
  headS3Object,
  sha256HexToBase64,
} from '../../config/aws'
import { DOMINIOS_FUENTE, RUTA_POR_DOMINIO, pasoPorNumero, type DominioFuente } from './dominio/catalogo'
import { PesvError } from './dominio/errores'
import { diasEntre, fechaAYmd, hoyEnBogota } from './dominio/periodos'
import { registrarAuditoria } from './pesv-auditoria'
import { claveSoporteDe, puedeRevisar, type ActorPesv } from './pesv-ciclos.service'

/** 25 MiB. Un soporte de auditoría es un PDF o una foto, no un vídeo. */
const TAMANO_MAXIMO_BYTES = 25 * 1024 * 1024

const MIMES_PERMITIDOS = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword',
  'application/vnd.ms-excel',
])

export type EstadoRevision = 'PENDIENTE' | 'APROBADO' | 'RECHAZADO'

// ─────────────────────────────────────────────────────────────────────────
//  Subida de archivos
// ─────────────────────────────────────────────────────────────────────────

export interface SolicitudPresign {
  requirementId: string
  nombreArchivo: string
  mimeType: string
  sizeBytes: number
  /** SHA-256 hexadecimal de los bytes, calculado por el cliente. */
  sha256: string
}

/**
 * Firma la URL de subida.
 *
 * El checksum se iza al query string al firmar y **no debe reenviarse como
 * cabecera**: SigV4 exige que toda cabecera `x-amz-*` esté firmada, y una que
 * no lo esté hace que S3 rechace la petición entera con un 403 que no menciona
 * la causa. Es el mismo tropiezo que documenta el módulo de formularios.
 *
 * Si una subida falla, mira el **CORS del bucket** antes que la firma: un
 * preflight rechazado hace que `fetch` lance sin llegar a AWS y en DevTools se
 * ve igual que un problema de firma.
 */
export async function firmarSubidaEvidencia(solicitud: SolicitudPresign, actor: ActorPesv) {
  if (!MIMES_PERMITIDOS.has(solicitud.mimeType)) {
    throw new PesvError(
      'ARCHIVO_TIPO_NO_PERMITIDO',
      `Tipo de archivo no admitido: ${solicitud.mimeType}. Se aceptan PDF, imágenes y documentos de Office.`,
    )
  }
  if (!Number.isInteger(solicitud.sizeBytes) || solicitud.sizeBytes <= 0 || solicitud.sizeBytes > TAMANO_MAXIMO_BYTES) {
    throw new PesvError(
      'ARCHIVO_DEMASIADO_GRANDE',
      `El archivo supera el máximo de ${Math.round(TAMANO_MAXIMO_BYTES / 1024 / 1024)} MB.`,
    )
  }
  if (!/^[0-9a-f]{64}$/.test(solicitud.sha256)) {
    throw new PesvError('DATOS_INVALIDOS', 'El SHA-256 debe venir en hexadecimal de 64 caracteres.')
  }

  const requisito = await prisma.pesv_requirement_status.findFirst({
    where: { id: solicitud.requirementId, deleted_at: null },
    select: { id: true, cycle_id: true, step_number: true },
  })
  if (!requisito) throw new PesvError('REQUISITO_NO_ENCONTRADO', 'El requisito no existe.')

  /// La clave incluye ciclo y paso para que el objeto sea localizable en el
  /// bucket sin consultar la base, y un UUID para que dos subidas del mismo
  /// archivo no se pisen.
  const extension = solicitud.nombreArchivo.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') ?? 'bin'
  const objectKey = `pesv/${requisito.cycle_id}/paso-${requisito.step_number}/${randomUUID()}.${extension}`

  const uploadUrl = await getS3UploadUrl(
    objectKey,
    solicitud.mimeType,
    solicitud.sizeBytes,
    sha256HexToBase64(solicitud.sha256),
  )

  await registrarAuditoria({
    entidad: 'EVIDENCIA',
    entidadId: null,
    accion: 'PRESIGN',
    actor,
    detalle: { requirementId: requisito.id, objectKey, sizeBytes: solicitud.sizeBytes },
  })

  return {
    objectKey,
    uploadUrl,
    /// Informativo. El cliente NO lo reenvía como cabecera; va en la URL firmada.
    checksumSha256: sha256HexToBase64(solicitud.sha256),
    expiraEnSegundos: 900,
  }
}

// ─────────────────────────────────────────────────────────────────────────
//  Alta de evidencia
// ─────────────────────────────────────────────────────────────────────────

export interface AltaEvidenciaArchivo {
  origen: 'ARCHIVO'
  requirementId: string
  soporteClave?: string | null
  titulo: string
  descripcion?: string | null
  objectKey: string
  nombreArchivo: string
  mimeType: string
  sizeBytes: number
  sha256: string
  fechaDocumento?: string | null
  vigenciaDesde?: string | null
  vigenciaHasta?: string | null
  reemplazaA?: string | null
}

export interface AltaEvidenciaRegistro {
  origen: 'REGISTRO'
  requirementId: string
  soporteClave?: string | null
  titulo: string
  descripcion?: string | null
  sourceDomain: DominioFuente
  sourceId: string
  fechaDocumento?: string | null
  vigenciaDesde?: string | null
  vigenciaHasta?: string | null
  reemplazaA?: string | null
}

export type AltaEvidencia = AltaEvidenciaArchivo | AltaEvidenciaRegistro

/**
 * Registra la evidencia una vez el archivo ya está en S3, o vincula un registro.
 *
 * En el caso `ARCHIVO` se comprueba contra S3 que el objeto existe y que su
 * tamaño coincide. La verificación va contra los bytes ALMACENADOS y no contra
 * lo que el cliente declaró dos veces: comparar el hash del cliente con el hash
 * del cliente no verifica nada.
 */
export async function crearEvidencia(alta: AltaEvidencia, actor: ActorPesv) {
  const requisito = await prisma.pesv_requirement_status.findFirst({
    where: { id: alta.requirementId, deleted_at: null },
    include: { ciclo: { select: { id: true, estado: true, anio: true } } },
  })
  if (!requisito) throw new PesvError('REQUISITO_NO_ENCONTRADO', 'El requisito no existe.')
  if (requisito.ciclo.estado === 'CERRADO') {
    throw new PesvError('CICLO_CERRADO', 'El ciclo está cerrado: no admite evidencia nueva.')
  }

  if (alta.soporteClave) {
    const paso = pasoPorNumero(requisito.step_number)
    const existe = paso?.soportes.some((s) => s.clave === alta.soporteClave)
    if (!existe) {
      throw new PesvError(
        'DATOS_INVALIDOS',
        `El paso ${requisito.step_number} no tiene un soporte llamado «${alta.soporteClave}».`,
      )
    }
  }

  let datosOrigen: Prisma.pesv_evidenceUncheckedCreateInput
  if (alta.origen === 'ARCHIVO') {
    const metadata = await headS3Object(alta.objectKey)
    if (!metadata) {
      throw new PesvError(
        'ARCHIVO_NO_SUBIDO',
        'El archivo no llegó a almacenarse. Vuelva a subirlo antes de registrar la evidencia.',
      )
    }
    if (metadata.contentLength !== alta.sizeBytes) {
      throw new PesvError('ARCHIVO_NO_SUBIDO', 'El archivo almacenado está incompleto. Vuelva a subirlo.', {
        bytesEsperados: alta.sizeBytes,
        bytesAlmacenados: metadata.contentLength,
      })
    }
    if (metadata.checksumSha256 && metadata.checksumSha256 !== sha256HexToBase64(alta.sha256)) {
      throw new PesvError(
        'ARCHIVO_HASH_NO_COINCIDE',
        'El archivo almacenado no coincide con el que se declaró. Vuelva a subirlo.',
      )
    }

    datosOrigen = {
      requirement_id: alta.requirementId,
      origen: 'ARCHIVO',
      titulo: alta.titulo,
      descripcion: componerDescripcion(alta.soporteClave, alta.descripcion),
      s3_key: alta.objectKey,
      nombre_archivo: alta.nombreArchivo,
      mime_type: alta.mimeType,
      size_bytes: alta.sizeBytes,
      sha256: alta.sha256,
      source_snapshot_json: {},
    }
  } else {
    if (!DOMINIOS_FUENTE.includes(alta.sourceDomain)) {
      throw new PesvError('DATOS_INVALIDOS', `Dominio de origen desconocido: ${alta.sourceDomain}.`)
    }
    const snapshot = await construirSnapshot(alta.sourceDomain, alta.sourceId)
    datosOrigen = {
      requirement_id: alta.requirementId,
      origen: 'REGISTRO',
      titulo: alta.titulo,
      descripcion: componerDescripcion(alta.soporteClave, alta.descripcion),
      source_domain: alta.sourceDomain,
      source_id: alta.sourceId,
      source_snapshot_json: snapshot as Prisma.InputJsonValue,
    }
  }

  const evidencia = await prisma.pesv_evidence.create({
    data: {
      ...datosOrigen,
      fecha_documento: fechaOpcional(alta.fechaDocumento),
      vigencia_desde: fechaOpcional(alta.vigenciaDesde),
      vigencia_hasta: fechaOpcional(alta.vigenciaHasta),
      /// Nace PENDIENTE SIEMPRE. No hay atajo ni siquiera para quien puede
      /// revisar: aportar y aprobar son dos actos con dos firmas.
      estado_revision: 'PENDIENTE',
      reemplaza_a_id: alta.reemplazaA ?? null,
      cargado_por_id: actor.id,
    },
  })

  /// El paso pasa a EN_REVISION en cuanto entra evidencia, si estaba antes de
  /// eso. Sin esto, HSEQ no tendría forma de saber que hay algo esperándole
  /// salvo mirando paso por paso.
  if (['PENDIENTE', 'EN_PROGRESO'].includes(requisito.estado)) {
    await prisma.pesv_requirement_status.update({
      where: { id: requisito.id },
      data: { estado: 'EN_REVISION' },
    })
  }

  await registrarAuditoria({
    entidad: 'EVIDENCIA',
    entidadId: evidencia.id,
    accion: 'APORTAR',
    actor,
    detalle: {
      requirementId: alta.requirementId,
      stepNumber: requisito.step_number,
      origen: alta.origen,
      soporte: alta.soporteClave ?? null,
    },
  })

  return evidencia
}

/**
 * La clave del soporte viaja al inicio de la descripción como `[clave]`.
 *
 * Ver el porqué en `claveSoporteDe`: una columna dedicada quedaría huérfana el
 * día que el catálogo renombre una clave, y aquí eso se ve como «sin soporte
 * asignado» en vez de pasar desapercibido.
 */
function componerDescripcion(clave: string | null | undefined, descripcion: string | null | undefined): string | null {
  const texto = descripcion?.trim() ?? ''
  if (!clave) return texto || null
  return `[${clave}] ${texto}`.trim()
}

function fechaOpcional(valor: string | null | undefined): Date | null {
  if (!valor) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
    throw new PesvError('DATOS_INVALIDOS', `Fecha inválida, se esperaba YYYY-MM-DD: "${valor}".`)
  }
  return new Date(`${valor}T00:00:00Z`)
}

// ─────────────────────────────────────────────────────────────────────────
//  Snapshots de registros vinculados
// ─────────────────────────────────────────────────────────────────────────

/**
 * Copia legible del registro fuente en el instante de vincularlo.
 *
 * Es lo que hace que una edición o una baja posterior no alteren lo que se
 * auditó. Guarda pocos campos y siempre los mismos: quién, qué, cuándo y una
 * etiqueta humana. No guarda el registro entero — un envío de formulario con
 * 280 respuestas dentro de un JSON de auditoría no lo lee nadie, y el enlace
 * profundo ya lleva al original.
 */
export async function construirSnapshot(dominio: DominioFuente, id: string): Promise<Record<string, unknown>> {
  const base = {
    dominio,
    registroId: id,
    capturadoAt: new Date().toISOString(),
    enlace: `${RUTA_POR_DOMINIO[dominio]}${RUTA_POR_DOMINIO[dominio].includes('?') ? '&' : '?'}id=${id}`,
  }

  switch (dominio) {
    case 'FORM_SUBMISSION': {
      const s = await prisma.form_submission.findUnique({
        where: { id },
        select: {
          id: true,
          status: true,
          business_date: true,
          submitted_at: true,
          version: { select: { title: true, version_number: true, form: { select: { code: true, name: true } } } },
          conductor: { select: { nombre: true, apellido: true, numero_identificacion: true } },
          usuario: { select: { nombre: true } },
          vehiculo: { select: { placa: true } },
        },
      })
      if (!s) return { ...base, ausente: true }
      return {
        ...base,
        etiqueta: `${s.version.form.code} — ${s.version.title} (v${s.version.version_number})`,
        estado: s.status,
        fechaNegocio: fechaAYmd(s.business_date),
        entregadoAt: s.submitted_at?.toISOString() ?? null,
        autor: s.conductor
          ? `${s.conductor.nombre} ${s.conductor.apellido} (${s.conductor.numero_identificacion ?? 's/n'})`
          : (s.usuario?.nombre ?? null),
        vehiculo: s.vehiculo?.placa ?? null,
      }
    }
    case 'ASISTENCIA': {
      const a = await prisma.formularios_asistencia.findUnique({
        where: { id },
        select: {
          tematica: true,
          fecha: true,
          tipo_evento: true,
          nombre_instructor: true,
          _count: { select: { respuestas: true } },
        },
      })
      if (!a) return { ...base, ausente: true }
      return {
        ...base,
        etiqueta: a.tematica,
        fecha: fechaAYmd(a.fecha),
        tipoEvento: a.tipo_evento,
        instructor: a.nombre_instructor,
        asistentes: a._count.respuestas,
      }
    }
    case 'ACCION_CORRECTIVA': {
      const ac = await prisma.acciones_correctivas_preventivas.findUnique({
        where: { id },
        select: {
          accion_numero: true,
          descripcion_hallazgo: true,
          estado_global: true,
          fecha_identificacion_hallazgo: true,
          fecha_cierre_definitivo: true,
          evaluacion_cierre_eficaz: true,
        },
      })
      if (!ac) return { ...base, ausente: true }
      return {
        ...base,
        etiqueta: `${ac.accion_numero} — ${(ac.descripcion_hallazgo ?? '').slice(0, 120)}`,
        estado: ac.estado_global,
        identificado: fechaAYmd(ac.fecha_identificacion_hallazgo),
        cerrado: fechaAYmd(ac.fecha_cierre_definitivo),
        eficacia: ac.evaluacion_cierre_eficaz,
      }
    }
    case 'ACTIVIDAD_PESV': {
      const act = await prisma.actividades_pesv.findUnique({
        where: { id },
        select: { numero: true, actividad: true, estado: true, fecha_limite: true, fecha_ejecucion: true },
      })
      if (!act) return { ...base, ausente: true }
      return {
        ...base,
        etiqueta: `#${act.numero} — ${act.actividad.slice(0, 120)}`,
        estado: act.estado,
        fechaLimite: fechaAYmd(act.fecha_limite),
        fechaEjecucion: fechaAYmd(act.fecha_ejecucion),
      }
    }
    case 'DOCUMENTO': {
      const d = await prisma.documento.findUnique({
        where: { id },
        select: {
          nombre_original: true,
          categoria: true,
          tipo_documento: true,
          numero: true,
          fecha_vencimiento: true,
          fecha_vigencia: true,
          estado_revision: true,
        },
      })
      if (!d) return { ...base, ausente: true }
      return {
        ...base,
        etiqueta: d.nombre_original,
        categoria: d.categoria,
        tipo: d.tipo_documento,
        numero: d.numero,
        vence: fechaAYmd(d.fecha_vencimiento) ?? fechaAYmd(d.fecha_vigencia),
        revision: d.estado_revision,
      }
    }
    case 'SINIESTRO': {
      const s = await prisma.pesv_incident.findUnique({
        where: { id },
        select: { fecha: true, severidad: true, tipo_evento: true, lugar: true, investigacion_realizada: true },
      })
      if (!s) return { ...base, ausente: true }
      return {
        ...base,
        etiqueta: `${s.severidad} — ${s.tipo_evento ?? 'sin tipificar'}`,
        fecha: fechaAYmd(s.fecha),
        lugar: s.lugar,
        investigado: s.investigacion_realizada,
      }
    }
    case 'MANTENIMIENTO': {
      const m = await prisma.vehicle_maintenance_event.findUnique({
        where: { id },
        select: {
          descripcion: true,
          tipo: true,
          estado: true,
          fecha_programada: true,
          fecha_ejecucion: true,
          vehiculo: { select: { placa: true } },
        },
      })
      if (!m) return { ...base, ausente: true }
      return {
        ...base,
        etiqueta: `${m.vehiculo.placa} — ${m.descripcion.slice(0, 120)}`,
        tipo: m.tipo,
        estado: m.estado,
        programado: fechaAYmd(m.fecha_programada),
        ejecutado: fechaAYmd(m.fecha_ejecucion),
      }
    }
    case 'CONTRATO': {
      const c = await prisma.transport_contract.findUnique({
        where: { id },
        select: { numero: true, contratante_nombre: true, fecha_inicio: true, fecha_fin: true, estado: true },
      })
      if (!c) return { ...base, ausente: true }
      return {
        ...base,
        etiqueta: `${c.numero} — ${c.contratante_nombre}`,
        vigencia: `${fechaAYmd(c.fecha_inicio)} a ${fechaAYmd(c.fecha_fin)}`,
        estado: c.estado,
      }
    }
    case 'FUEC': {
      const f = await prisma.fuec_extract.findUnique({
        where: { id },
        select: {
          numero_completo: true,
          vehiculo_placa: true,
          vigencia_desde: true,
          vigencia_hasta: true,
          estado: true,
        },
      })
      if (!f) return { ...base, ausente: true }
      return {
        ...base,
        etiqueta: `${f.numero_completo} — ${f.vehiculo_placa ?? 's/placa'}`,
        vigencia: `${fechaAYmd(f.vigencia_desde)} a ${fechaAYmd(f.vigencia_hasta)}`,
        estado: f.estado,
      }
    }
    case 'SERVICIO': {
      const s = await prisma.servicio.findUnique({
        where: { id },
        select: {
          numero_planilla: true,
          fecha_realizacion: true,
          fecha_solicitud: true,
          estado: true,
          clientes: { select: { nombre: true } },
          vehiculos: { select: { placa: true } },
        },
      })
      if (!s) return { ...base, ausente: true }
      return {
        ...base,
        etiqueta: `Planilla ${s.numero_planilla ?? 's/n'} — ${s.clientes.nombre ?? ''}`,
        fecha: fechaAYmd(s.fecha_realizacion ?? s.fecha_solicitud),
        estado: s.estado,
        vehiculo: s.vehiculos?.placa ?? null,
      }
    }
    case 'RIESGO': {
      const r = await prisma.pesv_risk.findUnique({
        where: { id },
        select: { codigo: true, peligro: true, nivel_inicial: true, nivel_final: true },
      })
      if (!r) return { ...base, ausente: true }
      return {
        ...base,
        etiqueta: `${r.codigo ?? ''} ${r.peligro}`.trim(),
        nivelInicial: r.nivel_inicial,
        nivelFinal: r.nivel_final,
      }
    }
    case 'META': {
      const m = await prisma.pesv_goal.findUnique({
        where: { id },
        select: { nombre: true, indicador_codigo: true, valor_meta: true, lograda: true },
      })
      if (!m) return { ...base, ausente: true }
      return {
        ...base,
        etiqueta: m.nombre,
        indicador: m.indicador_codigo,
        meta: m.valor_meta == null ? null : Number(m.valor_meta),
        lograda: m.lograda,
      }
    }
    case 'PROGRAMA': {
      const p = await prisma.pesv_program.findUnique({
        where: { id },
        select: { nombre: true, tipo: true, activo: true, _count: { select: { vehiculos: true } } },
      })
      if (!p) return { ...base, ausente: true }
      return { ...base, etiqueta: p.nombre, tipo: p.tipo, activo: p.activo, vehiculosCubiertos: p._count.vehiculos }
    }
    case 'FORMACION': {
      const f = await prisma.pesv_training_plan.findUnique({
        where: { id },
        select: { tema: true, tipo: true, ejecutado: true, fecha_planificada: true, fecha_ejecucion: true },
      })
      if (!f) return { ...base, ausente: true }
      return {
        ...base,
        etiqueta: f.tema,
        tipo: f.tipo,
        ejecutado: f.ejecutado,
        planificada: fechaAYmd(f.fecha_planificada),
        ejecucion: fechaAYmd(f.fecha_ejecucion),
      }
    }
    case 'EVALUACION': {
      const e = await prisma.evaluacion.findUnique({
        where: { id },
        select: { titulo: true, _count: { select: { resultados: true } } },
      })
      if (!e) return { ...base, ausente: true }
      return { ...base, etiqueta: e.titulo, resultados: e._count.resultados }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
//  Revisión
// ─────────────────────────────────────────────────────────────────────────

export interface DecisionRevision {
  decision: 'APROBADO' | 'RECHAZADO'
  observacion?: string | null
}

/**
 * Aprueba o rechaza. Escribe la decisión en la evidencia y una línea inmutable
 * en el historial.
 *
 * La autoaprobación se rechaza con su propio código (`AUTOAPROBACION_PROHIBIDA`)
 * y no con un 403 genérico: quien la intenta SÍ tiene permiso de revisión, y un
 * mensaje de «sin permisos» llevaría a que alguien le ampliara el rol para
 * arreglar algo que no es un problema de rol.
 *
 * Rechazar NO borra ni oculta: la evidencia sigue en el expediente, deja de
 * sumar, y la corrección entra como una versión nueva.
 */
export async function revisarEvidencia(evidenceId: string, decision: DecisionRevision, actor: ActorPesv) {
  if (!puedeRevisar(actor)) {
    throw new PesvError(
      'REVISION_NO_AUTORIZADA',
      'Solo las áreas de HSEQ o Administración pueden aprobar o rechazar evidencia.',
    )
  }

  const evidencia = await prisma.pesv_evidence.findFirst({
    where: { id: evidenceId, deleted_at: null },
    include: { requisito: { include: { ciclo: { select: { estado: true } } } } },
  })
  if (!evidencia) throw new PesvError('EVIDENCIA_NO_ENCONTRADA', 'La evidencia no existe o fue retirada.')
  if (evidencia.requisito.ciclo.estado === 'CERRADO') {
    throw new PesvError('CICLO_CERRADO', 'El ciclo está cerrado: reábralo para revisar su evidencia.')
  }

  if (evidencia.cargado_por_id && evidencia.cargado_por_id === actor.id) {
    throw new PesvError(
      'AUTOAPROBACION_PROHIBIDA',
      'No puede aprobar ni rechazar una evidencia que usted mismo aportó. Debe revisarla otra persona de HSEQ o Administración.',
    )
  }

  if (decision.decision === 'RECHAZADO' && !decision.observacion?.trim()) {
    throw new PesvError(
      'DATOS_INVALIDOS',
      'Un rechazo exige una observación: quien aportó la evidencia tiene que saber qué corregir.',
    )
  }

  const [actualizada] = await prisma.$transaction([
    prisma.pesv_evidence.update({
      where: { id: evidenceId },
      data: {
        estado_revision: decision.decision,
        revisado_por_id: actor.id,
        revisado_at: new Date(),
        observacion_revision: decision.observacion ?? null,
      },
    }),
    prisma.pesv_evidence_review.create({
      data: {
        evidence_id: evidenceId,
        decision: decision.decision,
        observacion: decision.observacion ?? null,
        revisor_id: actor.id,
        revisor_nombre: actor.nombre ?? null,
      },
    }),
  ])

  await registrarAuditoria({
    entidad: 'EVIDENCIA',
    entidadId: evidenceId,
    accion: `REVISAR_${decision.decision}`,
    actor,
    detalle: {
      requirementId: evidencia.requirement_id,
      stepNumber: evidencia.requisito.step_number,
      observacion: decision.observacion ?? null,
    },
  })

  return actualizada
}

/**
 * Retira una evidencia (borrado lógico).
 *
 * Las revisiones NO se tocan: son la evidencia de que alguien decidió, y
 * `pesv_evidence_review` no tiene `deleted_at` justamente por eso.
 */
export async function retirarEvidencia(evidenceId: string, actor: ActorPesv) {
  const evidencia = await prisma.pesv_evidence.findFirst({
    where: { id: evidenceId, deleted_at: null },
    select: { id: true, cargado_por_id: true, requirement_id: true, estado_revision: true },
  })
  if (!evidencia) throw new PesvError('EVIDENCIA_NO_ENCONTRADA', 'La evidencia no existe o ya fue retirada.')

  /// Quien la aportó puede retirarla mientras siga pendiente. Una vez revisada,
  /// solo HSEQ: retirar una evidencia ya aprobada cambia el cumplimiento de un
  /// paso, y eso no lo decide el área que la subió.
  const esAutor = evidencia.cargado_por_id === actor.id
  const puede = puedeRevisar(actor) || (esAutor && evidencia.estado_revision === 'PENDIENTE')
  if (!puede) {
    throw new PesvError(
      'PROHIBIDO',
      'Solo HSEQ o Administración pueden retirar una evidencia ya revisada.',
    )
  }

  const retirada = await prisma.pesv_evidence.update({
    where: { id: evidenceId },
    data: { deleted_at: new Date() },
  })

  await registrarAuditoria({
    entidad: 'EVIDENCIA',
    entidadId: evidenceId,
    accion: 'RETIRAR',
    actor,
    detalle: { requirementId: evidencia.requirement_id, estadoAlRetirar: evidencia.estado_revision },
  })

  return retirada
}

// ─────────────────────────────────────────────────────────────────────────
//  Consultas
// ─────────────────────────────────────────────────────────────────────────

export interface FiltrosBandeja {
  cicloId: string
  estado?: EstadoRevision
  stepNumber?: number
  area?: string
  /** Solo lo aportado por este usuario. Es «mis pendientes». */
  cargadoPorId?: string
  limite?: number
}

/**
 * Bandeja de revisión.
 *
 * Ordenada por antigüedad ascendente a propósito: lo que lleva más tiempo
 * esperando sale primero. Con orden descendente, una evidencia aportada en
 * enero se hunde bajo las de esta semana y no la revisa nadie.
 */
export async function bandejaEvidencias(filtros: FiltrosBandeja) {
  const hoy = hoyEnBogota()
  const evidencias = await prisma.pesv_evidence.findMany({
    where: {
      deleted_at: null,
      requisito: {
        cycle_id: filtros.cicloId,
        deleted_at: null,
        ...(filtros.stepNumber ? { step_number: filtros.stepNumber } : {}),
        ...(filtros.area ? { area_responsable: filtros.area } : {}),
      },
      ...(filtros.estado ? { estado_revision: filtros.estado } : {}),
      ...(filtros.cargadoPorId ? { cargado_por_id: filtros.cargadoPorId } : {}),
    },
    include: {
      requisito: { select: { id: true, step_number: true, area_responsable: true, estado: true } },
      cargado_por: { select: { id: true, nombre: true } },
      revisado_por: { select: { id: true, nombre: true } },
    },
    orderBy: { created_at: 'asc' },
    take: Math.min(filtros.limite ?? 200, 500),
  })

  return evidencias.map((e) => {
    const hasta = fechaAYmd(e.vigencia_hasta)
    const dias = hasta ? diasEntre(hoy, hasta) : null
    const paso = pasoPorNumero(e.requisito.step_number)
    return {
      id: e.id,
      titulo: e.titulo,
      descripcion: e.descripcion,
      soporteClave: claveSoporteDe(e.descripcion),
      origen: e.origen,
      stepNumber: e.requisito.step_number,
      pasoNombre: paso?.nombre ?? `Paso ${e.requisito.step_number}`,
      areaResponsable: e.requisito.area_responsable,
      estadoRevision: e.estado_revision,
      sourceDomain: e.source_domain,
      sourceId: e.source_id,
      snapshot: e.source_snapshot_json,
      nombreArchivo: e.nombre_archivo,
      vigenciaHasta: hasta,
      diasParaVencer: dias,
      vencida: e.estado_revision === 'APROBADO' && dias != null && dias < 0,
      cargadoPor: e.cargado_por ? { id: e.cargado_por.id, nombre: e.cargado_por.nombre } : null,
      revisadoPor: e.revisado_por ? { id: e.revisado_por.id, nombre: e.revisado_por.nombre } : null,
      revisadoAt: e.revisado_at?.toISOString() ?? null,
      observacionRevision: e.observacion_revision,
      createdAt: e.created_at.toISOString(),
      /// El actor no puede revisar lo suyo. Se resuelve aquí y viaja al cliente
      /// para que la UI no ofrezca un botón que la API va a rechazar.
      esPropia: false as boolean,
    }
  })
}

/** URL firmada de descarga. Corta: es para abrir el archivo, no para compartirlo. */
export async function urlDeDescarga(evidenceId: string, actor: ActorPesv) {
  const evidencia = await prisma.pesv_evidence.findFirst({
    where: { id: evidenceId, deleted_at: null },
    select: { id: true, s3_key: true, nombre_archivo: true },
  })
  if (!evidencia) throw new PesvError('EVIDENCIA_NO_ENCONTRADA', 'La evidencia no existe o fue retirada.')
  if (!evidencia.s3_key) {
    throw new PesvError('DATOS_INVALIDOS', 'Esta evidencia es un vínculo a un registro, no un archivo.')
  }

  await registrarAuditoria({
    entidad: 'EVIDENCIA',
    entidadId: evidenceId,
    accion: 'DESCARGAR',
    actor,
    detalle: { nombreArchivo: evidencia.nombre_archivo },
  })

  return { url: await getS3SignedUrl(evidencia.s3_key, 300), nombreArchivo: evidencia.nombre_archivo }
}
