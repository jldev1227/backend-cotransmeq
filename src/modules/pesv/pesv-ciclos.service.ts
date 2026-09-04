/**
 * Ciclo anual y matriz de los 24 pasos.
 *
 * La decisión que gobierna este archivo: **un paso no llega a `CUMPLE` porque
 * alguien lo declare, sino porque sus soportes obligatorios tienen evidencia
 * aprobada y vigente.** La transición se comprueba en el servidor, no en la
 * pantalla: el módulo existe para poder demostrar cumplimiento ante un auditor,
 * y un estado que se puede poner a mano no demuestra nada.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '../../config/prisma'
import type { Area } from '../../config/permissions'
import {
  ETIQUETAS_FASE,
  PASOS_PESV,
  TOTAL_PASOS,
  pasoPorNumero,
  soportesObligatorios,
  type FasePesv,
} from './dominio/catalogo'
import { PesvError } from './dominio/errores'
import { diasEntre, fechaAYmd, hoyEnBogota } from './dominio/periodos'
import { registrarAuditoria } from './pesv-auditoria'

export type EstadoRequisito =
  | 'PENDIENTE'
  | 'EN_PROGRESO'
  | 'EN_REVISION'
  | 'CUMPLE'
  | 'NO_CUMPLE'
  | 'NO_APLICA'

/**
 * Transiciones permitidas.
 *
 * Cerrado a propósito y no un «cualquier estado a cualquier estado»: el salto
 * de `PENDIENTE` a `CUMPLE` sin pasar por revisión es exactamente lo que hacía
 * la pantalla anterior, y es lo que convertía la matriz en una lista de casillas
 * marcadas. Volver atrás sí se permite desde cualquier sitio: HSEQ tiene que
 * poder reabrir un paso cuando aparece un hallazgo.
 */
const TRANSICIONES: Record<EstadoRequisito, EstadoRequisito[]> = {
  PENDIENTE: ['EN_PROGRESO', 'EN_REVISION', 'NO_APLICA', 'NO_CUMPLE'],
  EN_PROGRESO: ['PENDIENTE', 'EN_REVISION', 'NO_CUMPLE', 'NO_APLICA'],
  EN_REVISION: ['CUMPLE', 'NO_CUMPLE', 'EN_PROGRESO', 'PENDIENTE'],
  CUMPLE: ['EN_REVISION', 'EN_PROGRESO', 'NO_CUMPLE'],
  NO_CUMPLE: ['EN_PROGRESO', 'EN_REVISION', 'PENDIENTE', 'NO_APLICA'],
  NO_APLICA: ['PENDIENTE', 'EN_PROGRESO'],
}

export interface ActorPesv {
  id: string
  nombre?: string | null
  areas: string[]
  role?: string | null
  /** Nivel resuelto por `requirePermission` sobre el módulo `pesv`. */
  nivel: 'full' | 'read' | 'limited'
}

/** Áreas que pueden aprobar o rechazar evidencia. Nadie más, ni siquiera `full`. */
export const AREAS_REVISORAS: readonly Area[] = ['hseq', 'administracion']

export function puedeRevisar(actor: ActorPesv): boolean {
  if (actor.role === 'admin') return true
  return actor.areas.some((a) => (AREAS_REVISORAS as readonly string[]).includes(a))
}

// ─────────────────────────────────────────────────────────────────────────
//  Ciclo
// ─────────────────────────────────────────────────────────────────────────

export interface DatosCiclo {
  anio: number
  nivel?: 'BASICO' | 'ESTANDAR' | 'AVANZADO'
  liderId?: string | null
  liderNombre?: string | null
  liderCargo?: string | null
  vigenciaDesde?: string | null
  vigenciaHasta?: string | null
  diasPorVencer?: number
  observaciones?: string | null
}

/**
 * Crea el ciclo y siembra los 24 pasos en `PENDIENTE`.
 *
 * Siembra con el área SUGERIDA del catálogo, no vacía: dejar los 24 sin
 * responsable obliga a HSEQ a asignarlos uno por uno antes de que el módulo
 * sirva de algo, y en la práctica eso significa que nunca se asignan. El área
 * sugerida se puede cambiar después por paso.
 *
 * Ningún paso nace cumplido. Es la diferencia entre un expediente y una
 * plantilla rellenada.
 */
export async function crearCiclo(datos: DatosCiclo, actor: ActorPesv) {
  const existente = await prisma.pesv_cycle.findFirst({
    where: { anio: datos.anio, deleted_at: null },
    select: { id: true },
  })
  if (existente) {
    throw new PesvError('CICLO_YA_EXISTE', `Ya existe un ciclo PESV para ${datos.anio}.`, {
      cicloId: existente.id,
    })
  }

  const ciclo = await prisma.$transaction(async (tx) => {
    const creado = await tx.pesv_cycle.create({
      data: {
        anio: datos.anio,
        /// `AVANZADO` por decisión de dirección. No se deriva del tamaño de la
        /// operación: un mes flojo no rebaja una obligación anual.
        nivel: datos.nivel ?? 'AVANZADO',
        estado: 'ACTIVO',
        lider_id: datos.liderId ?? null,
        lider_nombre: datos.liderNombre ?? null,
        lider_cargo: datos.liderCargo ?? null,
        vigencia_desde: datos.vigenciaDesde ? new Date(`${datos.vigenciaDesde}T00:00:00Z`) : new Date(Date.UTC(datos.anio, 0, 1)),
        vigencia_hasta: datos.vigenciaHasta ? new Date(`${datos.vigenciaHasta}T00:00:00Z`) : new Date(Date.UTC(datos.anio, 11, 31)),
        dias_por_vencer: datos.diasPorVencer ?? 30,
        observaciones: datos.observaciones ?? null,
        creado_por_id: actor.id,
        actualizado_por_id: actor.id,
      },
    })

    await tx.pesv_requirement_status.createMany({
      data: PASOS_PESV.map((paso) => ({
        cycle_id: creado.id,
        step_number: paso.numero,
        estado: 'PENDIENTE' as const,
        area_responsable: paso.areaSugerida,
      })),
      skipDuplicates: true,
    })

    /// Las actividades del plan anual que ya existían para ese año se
    /// enganchan al ciclo recién creado. Es idempotente y no toca las que ya
    /// tengan ciclo: reejecutarlo no reasigna nada.
    await tx.actividades_pesv.updateMany({
      where: { anio: datos.anio, cycle_id: null, deleted_at: null },
      data: { cycle_id: creado.id },
    })

    return creado
  })

  await registrarAuditoria({
    entidad: 'CICLO',
    entidadId: ciclo.id,
    accion: 'CREAR',
    actor,
    detalle: { anio: ciclo.anio, nivel: ciclo.nivel, pasosSembrados: TOTAL_PASOS },
  })

  return ciclo
}

export async function actualizarCiclo(id: string, datos: Partial<DatosCiclo>, actor: ActorPesv) {
  const ciclo = await obtenerCicloPorId(id)
  if (ciclo.estado === 'CERRADO') {
    throw new PesvError('CICLO_CERRADO', 'El ciclo está cerrado: reábralo antes de modificarlo.')
  }

  const actualizado = await prisma.pesv_cycle.update({
    where: { id },
    data: {
      ...(datos.nivel !== undefined ? { nivel: datos.nivel } : {}),
      ...(datos.liderId !== undefined ? { lider_id: datos.liderId } : {}),
      ...(datos.liderNombre !== undefined ? { lider_nombre: datos.liderNombre } : {}),
      ...(datos.liderCargo !== undefined ? { lider_cargo: datos.liderCargo } : {}),
      ...(datos.vigenciaDesde !== undefined
        ? { vigencia_desde: datos.vigenciaDesde ? new Date(`${datos.vigenciaDesde}T00:00:00Z`) : null }
        : {}),
      ...(datos.vigenciaHasta !== undefined
        ? { vigencia_hasta: datos.vigenciaHasta ? new Date(`${datos.vigenciaHasta}T00:00:00Z`) : null }
        : {}),
      ...(datos.diasPorVencer !== undefined ? { dias_por_vencer: datos.diasPorVencer } : {}),
      ...(datos.observaciones !== undefined ? { observaciones: datos.observaciones } : {}),
      actualizado_por_id: actor.id,
    },
  })

  await registrarAuditoria({
    entidad: 'CICLO',
    entidadId: id,
    accion: 'ACTUALIZAR',
    actor,
    detalle: datos as Prisma.InputJsonValue,
  })
  return actualizado
}

export async function cerrarCiclo(id: string, actor: ActorPesv) {
  const ciclo = await obtenerCicloPorId(id)
  const cerrado = await prisma.pesv_cycle.update({
    where: { id: ciclo.id },
    data: { estado: 'CERRADO', cerrado_at: new Date(), actualizado_por_id: actor.id },
  })
  await registrarAuditoria({ entidad: 'CICLO', entidadId: id, accion: 'CERRAR', actor, detalle: {} })
  return cerrado
}

export async function obtenerCicloPorId(id: string) {
  const ciclo = await prisma.pesv_cycle.findFirst({ where: { id, deleted_at: null } })
  if (!ciclo) throw new PesvError('CICLO_NO_ENCONTRADO', 'El ciclo PESV no existe o fue retirado.')
  return ciclo
}

/**
 * El ciclo del año, o `null`.
 *
 * Devuelve `null` en vez de crearlo al vuelo: sembrar un ciclo es un acto con
 * autoría y fecha, y hacerlo como efecto colateral de abrir una pantalla dejaría
 * ciclos creados por quien pasó por ahí. El panel muestra el estado «sin ciclo»
 * con el botón para crearlo.
 */
export async function obtenerCicloDelAnio(anio: number) {
  return prisma.pesv_cycle.findFirst({ where: { anio, deleted_at: null } })
}

export async function listarCiclos() {
  return prisma.pesv_cycle.findMany({
    where: { deleted_at: null },
    orderBy: { anio: 'desc' },
    include: { lider: { select: { id: true, nombre: true, correo: true } } },
  })
}

// ─────────────────────────────────────────────────────────────────────────
//  Matriz de los 24 pasos
// ─────────────────────────────────────────────────────────────────────────

export interface FiltrosMatriz {
  fase?: FasePesv
  estado?: EstadoRequisito
  area?: string
  responsableId?: string
  /** Texto libre sobre nombre y descripción del paso. */
  q?: string
}

export interface SoporteEvaluado {
  clave: string
  etiqueta: string
  obligatorio: boolean
  dominios: string[]
  /** Evidencias aprobadas y vigentes que lo sostienen. */
  aprobadas: number
  pendientes: number
  rechazadas: number
  vencidas: number
  /** `true` si el soporte está satisfecho para efectos de `CUMPLE`. */
  satisfecho: boolean
}

export interface FilaMatriz {
  stepNumber: number
  fase: FasePesv
  faseEtiqueta: string
  nombre: string
  descripcion: string
  estado: EstadoRequisito
  areaResponsable: string | null
  responsable: { id: string; nombre: string } | null
  fechaLimite: string | null
  /** Días hasta la fecha límite. Negativo si ya pasó. */
  diasParaVencer: number | null
  vencido: boolean
  justificacion: string | null
  notas: string | null
  indicadores: string[]
  soportes: SoporteEvaluado[]
  evidencias: { total: number; aprobadas: number; pendientes: number; rechazadas: number; vencidas: number }
  /** `true` si podría declararse CUMPLE ahora mismo. */
  puedeCumplir: boolean
  /** Por qué no puede, cuando `puedeCumplir` es falso. */
  bloqueos: string[]
  requirementId: string
}

type EvidenciaFila = {
  id: string
  requirement_id: string
  titulo: string
  estado_revision: 'PENDIENTE' | 'APROBADO' | 'RECHAZADO'
  vigencia_hasta: Date | null
  descripcion: string | null
}

/**
 * ¿Esta evidencia sostiene un soporte hoy?
 *
 * Dos ejes independientes, como manda la especificación: aprobación y vigencia.
 * Un documento aprobado hace ocho meses y vencido ayer NO acredita nada, y ese
 * es justo el caso que un panel de conteos no distingue.
 */
function evidenciaVigente(ev: EvidenciaFila, hoy: string): boolean {
  if (ev.estado_revision !== 'APROBADO') return false
  const hasta = fechaAYmd(ev.vigencia_hasta)
  if (!hasta) return true // sin vigencia declarada, no caduca
  return diasEntre(hoy, hasta) >= 0
}

/**
 * Asocia una evidencia al soporte que dice cubrir.
 *
 * La clave del soporte viaja al principio de la descripción como
 * `[clave] resto`. Es feo y es deliberado: la alternativa era una columna
 * `soporte_clave` en `pesv_evidence`, y esa columna quedaría huérfana el día
 * que el catálogo renombre una clave, sin que nada avisara. Aquí, una clave que
 * ya no existe simplemente deja de casar y la evidencia aparece como «sin
 * soporte asignado», que es visible.
 */
export function claveSoporteDe(descripcion: string | null | undefined): string | null {
  if (!descripcion) return null
  const m = /^\[([a-z0-9_]+)\]/i.exec(descripcion.trim())
  return m ? m[1] : null
}

function evaluarSoportes(
  stepNumber: number,
  evidencias: EvidenciaFila[],
  hoy: string,
): { soportes: SoporteEvaluado[]; bloqueos: string[] } {
  const paso = pasoPorNumero(stepNumber)
  if (!paso) return { soportes: [], bloqueos: [] }

  const soportes: SoporteEvaluado[] = paso.soportes.map((s) => {
    const suyas = evidencias.filter((e) => claveSoporteDe(e.descripcion) === s.clave)
    const aprobadas = suyas.filter((e) => evidenciaVigente(e, hoy)).length
    const vencidas = suyas.filter(
      (e) => e.estado_revision === 'APROBADO' && !evidenciaVigente(e, hoy),
    ).length
    return {
      clave: s.clave,
      etiqueta: s.etiqueta,
      obligatorio: s.obligatorio,
      dominios: [...(s.dominios ?? [])],
      aprobadas,
      pendientes: suyas.filter((e) => e.estado_revision === 'PENDIENTE').length,
      rechazadas: suyas.filter((e) => e.estado_revision === 'RECHAZADO').length,
      vencidas,
      satisfecho: aprobadas > 0,
    }
  })

  const bloqueos = soportes
    .filter((s) => s.obligatorio && !s.satisfecho)
    .map((s) => {
      if (s.vencidas > 0) return `«${s.etiqueta}»: la evidencia aprobada está vencida.`
      if (s.pendientes > 0) return `«${s.etiqueta}»: hay evidencia pendiente de revisión de HSEQ.`
      if (s.rechazadas > 0) return `«${s.etiqueta}»: la evidencia aportada fue rechazada.`
      return `«${s.etiqueta}»: no hay evidencia aportada.`
    })

  return { soportes, bloqueos }
}

/** La matriz completa del ciclo, ya cruzada con sus evidencias. */
export async function obtenerMatriz(cicloId: string, filtros: FiltrosMatriz = {}): Promise<FilaMatriz[]> {
  const hoy = hoyEnBogota()

  const [requisitos, evidencias] = await Promise.all([
    prisma.pesv_requirement_status.findMany({
      where: { cycle_id: cicloId, deleted_at: null },
      include: { responsable: { select: { id: true, nombre: true } } },
      orderBy: { step_number: 'asc' },
    }),
    prisma.pesv_evidence.findMany({
      where: { deleted_at: null, requisito: { cycle_id: cicloId, deleted_at: null } },
      select: {
        id: true,
        requirement_id: true,
        titulo: true,
        descripcion: true,
        estado_revision: true,
        vigencia_hasta: true,
      },
    }),
  ])

  const porRequisito = new Map<string, EvidenciaFila[]>()
  for (const e of evidencias) {
    const lista = porRequisito.get(e.requirement_id) ?? []
    lista.push(e as EvidenciaFila)
    porRequisito.set(e.requirement_id, lista)
  }

  const filas: FilaMatriz[] = requisitos.map((r) => {
    const paso = pasoPorNumero(r.step_number)!
    const suyas = porRequisito.get(r.id) ?? []
    const { soportes, bloqueos } = evaluarSoportes(r.step_number, suyas, hoy)
    const fechaLimite = fechaAYmd(r.fecha_limite)
    const dias = fechaLimite ? diasEntre(hoy, fechaLimite) : null

    return {
      requirementId: r.id,
      stepNumber: r.step_number,
      fase: paso.fase,
      faseEtiqueta: ETIQUETAS_FASE[paso.fase],
      nombre: paso.nombre,
      descripcion: paso.descripcion,
      estado: r.estado as EstadoRequisito,
      areaResponsable: r.area_responsable,
      responsable: r.responsable ? { id: r.responsable.id, nombre: r.responsable.nombre } : null,
      fechaLimite,
      diasParaVencer: dias,
      /// Un paso ya cumplido o no aplicable no se marca como vencido aunque su
      /// fecha haya pasado: la alarma es para lo que sigue abierto.
      vencido: dias != null && dias < 0 && !['CUMPLE', 'NO_APLICA'].includes(r.estado),
      justificacion: r.justificacion,
      notas: r.notas,
      indicadores: [...(paso.indicadores ?? [])],
      soportes,
      evidencias: {
        total: suyas.length,
        aprobadas: suyas.filter((e) => evidenciaVigente(e, hoy)).length,
        pendientes: suyas.filter((e) => e.estado_revision === 'PENDIENTE').length,
        rechazadas: suyas.filter((e) => e.estado_revision === 'RECHAZADO').length,
        vencidas: suyas.filter((e) => e.estado_revision === 'APROBADO' && !evidenciaVigente(e, hoy)).length,
      },
      puedeCumplir: bloqueos.length === 0,
      bloqueos,
    }
  })

  return aplicarFiltros(filas, filtros)
}

function aplicarFiltros(filas: FilaMatriz[], filtros: FiltrosMatriz): FilaMatriz[] {
  const q = filtros.q?.trim().toLowerCase()
  return filas.filter((f) => {
    if (filtros.fase && f.fase !== filtros.fase) return false
    if (filtros.estado && f.estado !== filtros.estado) return false
    if (filtros.area && f.areaResponsable !== filtros.area) return false
    if (filtros.responsableId && f.responsable?.id !== filtros.responsableId) return false
    if (q) {
      const heno = `${f.stepNumber} ${f.nombre} ${f.descripcion}`.toLowerCase()
      if (!q.split(/\s+/).every((palabra) => heno.includes(palabra))) return false
    }
    return true
  })
}

/** Resumen de avance del ciclo, por estado y por fase. */
export function resumirMatriz(filas: FilaMatriz[]) {
  const porEstado: Record<EstadoRequisito, number> = {
    PENDIENTE: 0,
    EN_PROGRESO: 0,
    EN_REVISION: 0,
    CUMPLE: 0,
    NO_CUMPLE: 0,
    NO_APLICA: 0,
  }
  for (const f of filas) porEstado[f.estado] += 1

  /**
   * Avance global.
   *
   * `NO_APLICA` sale del denominador: un paso justificadamente inaplicable no
   * puede contar como incumplimiento. Solo `CUMPLE` suma — `EN_REVISION` no da
   * crédito parcial, porque un porcentaje que sube al adjuntar un archivo es
   * exactamente el cumplimiento ficticio que hay que evitar.
   */
  const aplicables = filas.length - porEstado.NO_APLICA
  const avance = aplicables > 0 ? Math.round((porEstado.CUMPLE / aplicables) * 1000) / 10 : null

  const porFase = (['PLANIFICACION', 'IMPLEMENTACION', 'SEGUIMIENTO', 'MEJORA'] as FasePesv[]).map((fase) => {
    const deLaFase = filas.filter((f) => f.fase === fase)
    const noAplica = deLaFase.filter((f) => f.estado === 'NO_APLICA').length
    const cumple = deLaFase.filter((f) => f.estado === 'CUMPLE').length
    const base = deLaFase.length - noAplica
    return {
      fase,
      etiqueta: ETIQUETAS_FASE[fase],
      total: deLaFase.length,
      cumple,
      avance: base > 0 ? Math.round((cumple / base) * 1000) / 10 : null,
    }
  })

  return {
    totalPasos: filas.length,
    porEstado,
    aplicables,
    avance,
    porFase,
    vencidos: filas.filter((f) => f.vencido).length,
    bloqueados: filas.filter((f) => !f.puedeCumplir && f.estado === 'EN_REVISION').length,
  }
}

// ─────────────────────────────────────────────────────────────────────────
//  Actualización de un requisito
// ─────────────────────────────────────────────────────────────────────────

export interface CambioRequisito {
  estado?: EstadoRequisito
  areaResponsable?: string | null
  responsableId?: string | null
  fechaLimite?: string | null
  justificacion?: string | null
  notas?: string | null
}

/**
 * Cambia responsable, plazo, notas y —si procede— estado del paso.
 *
 * Tres reglas que el servidor aplica siempre:
 *
 *  1. La transición tiene que estar en la tabla. Un salto directo a `CUMPLE`
 *     desde `PENDIENTE` se rechaza aunque quien llame sea administrador.
 *  2. `CUMPLE` exige todos los soportes obligatorios con evidencia aprobada y
 *     vigente. Si no, `EVIDENCIA_OBLIGATORIA_PENDIENTE` con el detalle de qué
 *     falta, para que el mensaje sea accionable.
 *  3. `NO_APLICA` y `NO_CUMPLE` exigen justificación escrita. Una excepción sin
 *     motivo es un hueco en el expediente, no una exención.
 */
export async function actualizarRequisito(
  cicloId: string,
  stepNumber: number,
  cambio: CambioRequisito,
  actor: ActorPesv,
) {
  if (!Number.isInteger(stepNumber) || stepNumber < 1 || stepNumber > TOTAL_PASOS) {
    throw new PesvError('PASO_FUERA_DE_RANGO', `El paso debe estar entre 1 y ${TOTAL_PASOS}.`)
  }

  const ciclo = await obtenerCicloPorId(cicloId)
  if (ciclo.estado === 'CERRADO') {
    throw new PesvError('CICLO_CERRADO', 'El ciclo está cerrado: reábralo antes de modificar sus pasos.')
  }

  const requisito = await prisma.pesv_requirement_status.findFirst({
    where: { cycle_id: cicloId, step_number: stepNumber, deleted_at: null },
  })
  if (!requisito) {
    throw new PesvError('REQUISITO_NO_ENCONTRADO', `El paso ${stepNumber} no existe en este ciclo.`)
  }

  const estadoActual = requisito.estado as EstadoRequisito
  const nuevoEstado = cambio.estado

  if (nuevoEstado && nuevoEstado !== estadoActual) {
    if (!TRANSICIONES[estadoActual].includes(nuevoEstado)) {
      throw new PesvError(
        'TRANSICION_NO_PERMITIDA',
        `No se puede pasar de «${estadoActual}» a «${nuevoEstado}». Transiciones válidas: ${TRANSICIONES[estadoActual].join(', ')}.`,
      )
    }

    if ((nuevoEstado === 'NO_APLICA' || nuevoEstado === 'NO_CUMPLE') && !textoUtil(cambio.justificacion) && !textoUtil(requisito.justificacion)) {
      throw new PesvError(
        'JUSTIFICACION_REQUERIDA',
        `Declarar un paso como «${nuevoEstado}» exige una justificación escrita.`,
      )
    }

    if (nuevoEstado === 'CUMPLE') {
      if (!puedeRevisar(actor)) {
        throw new PesvError(
          'REVISION_NO_AUTORIZADA',
          'Solo HSEQ o Administración pueden declarar un paso como cumplido.',
        )
      }
      const bloqueos = await bloqueosDe(requisito.id, stepNumber)
      if (bloqueos.length > 0) {
        throw new PesvError(
          'EVIDENCIA_OBLIGATORIA_PENDIENTE',
          'El paso no puede declararse cumplido: hay soportes obligatorios sin evidencia aprobada y vigente.',
          { bloqueos },
        )
      }
    }
  }

  const actualizado = await prisma.pesv_requirement_status.update({
    where: { id: requisito.id },
    data: {
      ...(nuevoEstado ? { estado: nuevoEstado } : {}),
      ...(cambio.areaResponsable !== undefined ? { area_responsable: cambio.areaResponsable } : {}),
      ...(cambio.responsableId !== undefined ? { responsable_id: cambio.responsableId } : {}),
      ...(cambio.fechaLimite !== undefined
        ? { fecha_limite: cambio.fechaLimite ? new Date(`${cambio.fechaLimite}T00:00:00Z`) : null }
        : {}),
      ...(cambio.justificacion !== undefined ? { justificacion: cambio.justificacion } : {}),
      ...(cambio.notas !== undefined ? { notas: cambio.notas } : {}),
      ...(nuevoEstado === 'CUMPLE' ? { completado_at: new Date() } : {}),
      ...(nuevoEstado && nuevoEstado !== 'CUMPLE' ? { completado_at: null } : {}),
      actualizado_por_id: actor.id,
    },
  })

  await registrarAuditoria({
    entidad: 'REQUISITO',
    entidadId: requisito.id,
    accion: nuevoEstado && nuevoEstado !== estadoActual ? `TRANSICION_${estadoActual}_A_${nuevoEstado}` : 'ACTUALIZAR',
    actor,
    detalle: { cicloId, stepNumber, ...cambio } as Prisma.InputJsonValue,
  })

  return actualizado
}

function textoUtil(v: string | null | undefined): boolean {
  return typeof v === 'string' && v.trim().length >= 5
}

async function bloqueosDe(requirementId: string, stepNumber: number): Promise<string[]> {
  const obligatorios = soportesObligatorios(stepNumber)
  if (obligatorios.length === 0) return []

  const evidencias = await prisma.pesv_evidence.findMany({
    where: { requirement_id: requirementId, deleted_at: null },
    select: {
      id: true,
      requirement_id: true,
      titulo: true,
      descripcion: true,
      estado_revision: true,
      vigencia_hasta: true,
    },
  })
  return evaluarSoportes(stepNumber, evidencias as EvidenciaFila[], hoyEnBogota()).bloqueos
}

/** Detalle de un paso: su fila de matriz más sus evidencias con historial. */
export async function detalleRequisito(cicloId: string, stepNumber: number) {
  const filas = await obtenerMatriz(cicloId)
  const fila = filas.find((f) => f.stepNumber === stepNumber)
  if (!fila) throw new PesvError('REQUISITO_NO_ENCONTRADO', `El paso ${stepNumber} no existe en este ciclo.`)

  const evidencias = await prisma.pesv_evidence.findMany({
    where: { requirement_id: fila.requirementId, deleted_at: null },
    include: {
      cargado_por: { select: { id: true, nombre: true } },
      revisado_por: { select: { id: true, nombre: true } },
      revisiones: {
        orderBy: { created_at: 'desc' },
        include: { revisor: { select: { id: true, nombre: true } } },
      },
    },
    orderBy: { created_at: 'desc' },
  })

  return { ...fila, evidenciasDetalle: evidencias }
}

/**
 * Expediente completo del ciclo: la matriz con las evidencias de cada paso.
 *
 * Construye la matriz UNA vez y le pega sus evidencias en una sola consulta.
 * La alternativa —llamar a `detalleRequisito` veinticuatro veces— recorría la
 * matriz entera en cada llamada: veinticuatro veces el mismo trabajo para el
 * mismo resultado, y sobre un ciclo con cientos de evidencias eso se nota.
 */
export async function expedienteDeCiclo(cicloId: string) {
  const filas = await obtenerMatriz(cicloId)

  const evidencias = await prisma.pesv_evidence.findMany({
    where: { deleted_at: null, requisito: { cycle_id: cicloId, deleted_at: null } },
    include: {
      cargado_por: { select: { id: true, nombre: true } },
      revisado_por: { select: { id: true, nombre: true } },
      revisiones: {
        orderBy: { created_at: 'desc' },
        include: { revisor: { select: { id: true, nombre: true } } },
      },
    },
    orderBy: { created_at: 'desc' },
  })

  const porRequisito = new Map<string, typeof evidencias>()
  for (const e of evidencias) {
    const lista = porRequisito.get(e.requirement_id) ?? []
    lista.push(e)
    porRequisito.set(e.requirement_id, lista)
  }

  return {
    filas,
    pasos: filas.map((f) => ({ ...f, evidenciasDetalle: porRequisito.get(f.requirementId) ?? [] })),
  }
}
