/**
 * Sección «HSEQ» del panel: preoperacionales, descansos 21-9, fatiga y
 * quién está en servicio.
 *
 * Fuentes:
 *  - Preoperacionales: formularios dinámicos HSEQ-FR-08 (livianos) y
 *    HSEQ-FR-09 (buses), envíos SUBMITTED por `business_date`.
 *  - Días laborados / descansos: `registro_dia_laboral` (el formato de
 *    recorridos: LABORADO, DISPONIBLE, DESCANSO, MANTENIMIENTO).
 *  - Horas por jornada: `dias_laborales_planillas` (hora_inicio / hora_fin).
 *
 * El ciclo 21-9 (21 días de trabajo por 9 de descanso) se mide desde el
 * último DESCANSO registrado: cuántos días lleva trabajando desde entonces.
 * No se toma el calendario a secas porque un día sin registro todavía no es
 * un día trabajado ni uno descansado.
 */
import { Prisma } from '@prisma/client'
import { prisma } from '../../config/prisma'
import type { ContextoSeccion } from './dashboard.routes'
import { diasDelPeriodo, hoyBogota, type Periodo } from './periodo'
import { coberturaHoraria, enMeses, horaPromedio, jornadasDelPeriodo, picoDe } from './seccion-operaciones'

export const CODIGOS_PREOPERACIONAL = ['HSEQ-FR-08', 'HSEQ-FR-09']
/** Ciclo 21-9: a partir de aquí el conductor debería estar descansando. */
export const DIAS_CICLO = 21
const VENTANA_DIAS = 45
/** Jornadas por encima de esto cuentan como largas para el indicador de fatiga. */
const HORAS_JORNADA_LARGA = 12

type FilaRegistro = { conductor_id: string; fecha: Date; tipo: string }

export interface ControlDescanso {
  conductor_id: string
  conductor: string
  estado: 'en_descanso' | 'ok' | 'por_descansar' | 'alerta'
  dias_desde_descanso: number
  ultimo_descanso: string | null
  dias_descanso_ventana: number
  dias_laborados_ventana: number
  enlace: string
}

/**
 * Clasifica a cada conductor por su ciclo 21-9 a partir de sus registros
 * (ordenados por fecha, de la ventana reciente).
 */
export function controlDescansos(registros: FilaRegistro[], nombres: Map<string, string>): ControlDescanso[] {
  const porConductor = new Map<string, FilaRegistro[]>()
  for (const r of registros) {
    const lista = porConductor.get(r.conductor_id) ?? []
    lista.push(r)
    porConductor.set(r.conductor_id, lista)
  }
  const out: ControlDescanso[] = []
  for (const [conductor_id, lista] of porConductor) {
    lista.sort((a, b) => a.fecha.getTime() - b.fecha.getTime())
    const ultimo = lista[lista.length - 1]
    let desdeDescanso = 0
    let ultimoDescanso: Date | null = null
    for (let i = lista.length - 1; i >= 0; i--) {
      if (lista[i].tipo === 'DESCANSO') {
        ultimoDescanso = lista[i].fecha
        break
      }
      if (lista[i].tipo !== 'MANTENIMIENTO') desdeDescanso += 1
    }
    const enDescanso = ultimo.tipo === 'DESCANSO'
    const estado: ControlDescanso['estado'] = enDescanso
      ? 'en_descanso'
      : desdeDescanso >= DIAS_CICLO
        ? 'alerta'
        : desdeDescanso >= DIAS_CICLO - 3
          ? 'por_descansar'
          : 'ok'
    out.push({
      conductor_id,
      conductor: nombres.get(conductor_id) ?? 'Conductor',
      estado,
      dias_desde_descanso: enDescanso ? 0 : desdeDescanso,
      ultimo_descanso: ultimoDescanso ? ultimoDescanso.toISOString().slice(0, 10) : null,
      dias_descanso_ventana: lista.filter((r) => r.tipo === 'DESCANSO').length,
      dias_laborados_ventana: lista.filter((r) => r.tipo === 'LABORADO').length,
      enlace: `/dashboard/conductores/${conductor_id}`,
    })
  }
  const orden: Record<ControlDescanso['estado'], number> = { alerta: 0, por_descansar: 1, ok: 2, en_descanso: 3 }
  return out.sort((a, b) => orden[a.estado] - orden[b.estado] || b.dias_desde_descanso - a.dias_desde_descanso)
}

/** Ranking de días laborados por conductor en el periodo (formato de recorridos). */
export async function rankingDiasLaborados(periodo: Periodo) {
  return prisma.$queryRaw<Array<{ conductor_id: string; conductor: string; laborados: number; disponibles: number; descansos: number }>>(Prisma.sql`
    SELECT c.id AS conductor_id, trim(c.nombre || ' ' || c.apellido) AS conductor,
           count(*) FILTER (WHERE r.tipo = 'LABORADO')::int AS laborados,
           count(*) FILTER (WHERE r.tipo = 'DISPONIBLE')::int AS disponibles,
           count(*) FILTER (WHERE r.tipo = 'DESCANSO')::int AS descansos
    FROM registro_dia_laboral r JOIN conductores c ON c.id = r.conductor_id
    WHERE r.deleted_at IS NULL AND r.fecha >= ${periodo.desde}::date AND r.fecha <= ${periodo.hasta}::date
    GROUP BY 1, 2 ORDER BY 3 DESC`)
}

/** Control 21-9 de todos los conductores con registros en la ventana reciente. */
export async function descansosRecientes(): Promise<ControlDescanso[]> {
  const ventanaDesde = new Date(Date.now() - VENTANA_DIAS * 86400000)
  const registros = await prisma.$queryRaw<Array<{ conductor_id: string; conductor: string; fecha: Date; tipo: string }>>(Prisma.sql`
    SELECT r.conductor_id, trim(c.nombre || ' ' || c.apellido) AS conductor, r.fecha, r.tipo
    FROM registro_dia_laboral r JOIN conductores c ON c.id = r.conductor_id
    WHERE r.deleted_at IS NULL AND c.deleted_at IS NULL AND r.fecha >= ${ventanaDesde}::date
    ORDER BY r.conductor_id, r.fecha`)
  const nombres = new Map<string, string>()
  for (const r of registros) nombres.set(r.conductor_id, r.conductor)
  return controlDescansos(registros, nombres)
}

export { VENTANA_DIAS }

export async function seccionHseq(ctx: ContextoSeccion): Promise<Record<string, unknown>> {
  const { periodo, modulos } = ctx
  const { inicio, fin } = periodo
  const hoy = hoyBogota()
  const ventanaDesde = new Date(Date.now() - VENTANA_DIAS * 86400000)
  const preop = Prisma.sql`
    JOIN form_versions v ON v.id = s.version_id
    JOIN form_definitions d ON d.id = v.form_id AND d.code IN (${Prisma.join(CODIGOS_PREOPERACIONAL)})`
  const enviosPeriodo = Prisma.sql`s.deleted_at IS NULL AND s.status = 'SUBMITTED' AND s.business_date >= ${periodo.desde}::date AND s.business_date <= ${periodo.hasta}::date`

  const [
    conductoresEstado,
    enServicio,
    sinPreopHoy,
    preopPorDia,
    preopPorHora,
    rankingFormularios,
    diasLaborados,
    registrosVentana,
    sueno,
  ] = await Promise.all([
    prisma.conductores.groupBy({ by: ['estado'], where: { deleted_at: null }, _count: { _all: true } }),
    prisma.$queryRaw<Array<{ id: string; conductor: string; cliente: string | null; placa: string | null; servicio_id: string | null; fecha_realizacion: Date | null; preop_hoy: boolean }>>(Prisma.sql`
      SELECT c.id, trim(c.nombre || ' ' || c.apellido) AS conductor, e.nombre AS cliente, v.placa, sv.id AS servicio_id, sv.fecha_realizacion,
             EXISTS (
               SELECT 1 FROM form_submissions s ${preop}
               WHERE s.deleted_at IS NULL AND s.status = 'SUBMITTED' AND s.conductor_id = c.id AND s.business_date = ${hoy}::date
             ) AS preop_hoy
      FROM conductores c
      LEFT JOIN LATERAL (
        SELECT s2.id, s2.cliente_id, s2.vehiculo_id, s2.fecha_realizacion FROM servicios s2
        WHERE s2.conductor_id = c.id AND s2.deleted_at IS NULL AND s2.estado = 'en_curso'
        ORDER BY s2.fecha_realizacion DESC NULLS LAST LIMIT 1
      ) sv ON true
      LEFT JOIN empresas e ON e.id = sv.cliente_id
      LEFT JOIN vehiculos v ON v.id = sv.vehiculo_id
      WHERE c.deleted_at IS NULL AND c.estado = 'servicio'
      ORDER BY preop_hoy ASC, conductor`),
    prisma.$queryRaw<Array<{ n: number }>>(Prisma.sql`
      SELECT count(*)::int AS n FROM conductores c
      WHERE c.deleted_at IS NULL AND c.estado = 'servicio' AND NOT EXISTS (
        SELECT 1 FROM form_submissions s ${preop}
        WHERE s.deleted_at IS NULL AND s.status = 'SUBMITTED' AND s.conductor_id = c.id AND s.business_date = ${hoy}::date)`),
    prisma.$queryRaw<Array<{ dia: string; n: number; conductores: number }>>(Prisma.sql`
      SELECT to_char(s.business_date, 'YYYY-MM-DD') AS dia, count(*)::int AS n, count(DISTINCT s.conductor_id)::int AS conductores
      FROM form_submissions s ${preop} WHERE ${enviosPeriodo} GROUP BY 1`),
    prisma.$queryRaw<Array<{ h: number; n: number }>>(Prisma.sql`
      SELECT extract(hour FROM s.submitted_at AT TIME ZONE 'America/Bogota')::int AS h, count(*)::int AS n
      FROM form_submissions s ${preop} WHERE ${enviosPeriodo} AND s.submitted_at IS NOT NULL GROUP BY 1`),
    prisma.$queryRaw<Array<{ conductor_id: string; conductor: string; total: number; formularios: string }>>(Prisma.sql`
      SELECT c.id AS conductor_id, trim(c.nombre || ' ' || c.apellido) AS conductor, count(*)::int AS total,
             string_agg(DISTINCT d.code, ', ' ORDER BY d.code) AS formularios
      FROM form_submissions s
      JOIN form_versions v ON v.id = s.version_id
      JOIN form_definitions d ON d.id = v.form_id
      JOIN conductores c ON c.id = s.conductor_id
      WHERE ${enviosPeriodo}
      GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 10`),
    prisma.$queryRaw<Array<{ conductor_id: string; conductor: string; laborados: number; disponibles: number; descansos: number }>>(Prisma.sql`
      SELECT c.id AS conductor_id, trim(c.nombre || ' ' || c.apellido) AS conductor,
             count(*) FILTER (WHERE r.tipo = 'LABORADO')::int AS laborados,
             count(*) FILTER (WHERE r.tipo = 'DISPONIBLE')::int AS disponibles,
             count(*) FILTER (WHERE r.tipo = 'DESCANSO')::int AS descansos
      FROM registro_dia_laboral r JOIN conductores c ON c.id = r.conductor_id
      WHERE r.deleted_at IS NULL AND r.fecha >= ${periodo.desde}::date AND r.fecha <= ${periodo.hasta}::date
      GROUP BY 1, 2 ORDER BY 3 DESC`),
    prisma.$queryRaw<Array<{ conductor_id: string; conductor: string; fecha: Date; tipo: string }>>(Prisma.sql`
      SELECT r.conductor_id, trim(c.nombre || ' ' || c.apellido) AS conductor, r.fecha, r.tipo
      FROM registro_dia_laboral r JOIN conductores c ON c.id = r.conductor_id
      WHERE r.deleted_at IS NULL AND c.deleted_at IS NULL AND r.fecha >= ${ventanaDesde}::date
      ORDER BY r.conductor_id, r.fecha`),
    prisma.$queryRaw<Array<{ conductor_id: string; promedio: number | null; cortas: number; total: number }>>(Prisma.sql`
      SELECT s.conductor_id, avg(a.value_decimal)::float AS promedio,
             count(*) FILTER (WHERE a.value_decimal < 6)::int AS cortas, count(*)::int AS total
      FROM form_answers a
      JOIN form_fields f ON f.id = a.field_id AND f.key = 'horas_sueno'
      JOIN form_submissions s ON s.id = a.submission_id ${preop}
      WHERE ${enviosPeriodo} AND s.conductor_id IS NOT NULL AND a.value_decimal IS NOT NULL
      GROUP BY 1`),
  ])

  // ── Preoperacionales por día, sin huecos ──────────────────────────────
  const porDia = new Map<string, { n: number; conductores: number }>()
  for (const d of diasDelPeriodo(periodo)) porDia.set(d, { n: 0, conductores: 0 })
  for (const r of preopPorDia) porDia.set(r.dia, { n: r.n, conductores: r.conductores })
  const distribucionHoras = new Array<number>(24).fill(0)
  for (const r of preopPorHora) distribucionHoras[r.h] = r.n

  const cuenta = (estado: string) => conductoresEstado.find((f) => f.estado === estado)?._count._all ?? 0

  const nombres = new Map<string, string>()
  for (const r of registrosVentana) nombres.set(r.conductor_id, r.conductor)
  const descansos = controlDescansos(registrosVentana, nombres)

  const data: Record<string, unknown> = {
    kpis: {
      conductores_en_servicio: cuenta('servicio'),
      conductores_disponibles: cuenta('disponible'),
      conductores_programados: cuenta('programado'),
      conductores_descanso: cuenta('descanso'),
      preoperacionales: preopPorDia.reduce((a, r) => a + r.n, 0),
      sin_preoperacional_hoy: sinPreopHoy[0]?.n ?? 0,
      dias_laborados: diasLaborados.reduce((a, r) => a + r.laborados, 0),
      alertas_descanso: descansos.filter((d) => d.estado === 'alerta').length,
    },
    hoy,
    en_servicio: enServicio.map((c) => ({ ...c, enlace: `/dashboard/conductores/${c.id}`, enlace_servicio: c.servicio_id ? `/dashboard/servicios/${c.servicio_id}` : null })),
    preoperacionales: {
      por_dia: [...porDia.entries()].map(([fecha, v]) => ({ fecha, ...v })),
      por_hora: distribucionHoras,
      promedio_hora: horaPromedio(distribucionHoras),
      pico: picoDe(distribucionHoras),
    },
    ranking_formularios: rankingFormularios.map((r) => ({ ...r, enlace: `/dashboard/conductores/${r.conductor_id}` })),
    dias_laborados: diasLaborados.slice(0, 10).map((r) => ({ ...r, enlace: `/dashboard/conductores/${r.conductor_id}` })),
    descansos: {
      ciclo: DIAS_CICLO,
      ventana_dias: VENTANA_DIAS,
      resumen: {
        alerta: descansos.filter((d) => d.estado === 'alerta').length,
        por_descansar: descansos.filter((d) => d.estado === 'por_descansar').length,
        ok: descansos.filter((d) => d.estado === 'ok').length,
        en_descanso: descansos.filter((d) => d.estado === 'en_descanso').length,
      },
      items: descansos.slice(0, 30),
    },
  }

  // ── Fatiga: horas por jornada (planillas) + sueño reportado (preoperacional) ──
  if (modulos['recargos']) {
    const jornadas = await prisma.$queryRaw<Array<{ conductor_id: string; conductor: string; dias: number; horas: number; promedio: number; largas: number; maxima: number }>>(Prisma.sql`
      SELECT p.conductor_id, trim(c.nombre || ' ' || c.apellido) AS conductor, count(*)::int AS dias,
             coalesce(sum(d.total_horas), 0)::float AS horas, coalesce(avg(d.total_horas), 0)::float AS promedio,
             count(*) FILTER (WHERE d.total_horas > ${HORAS_JORNADA_LARGA})::int AS largas, coalesce(max(d.total_horas), 0)::float AS maxima
      FROM dias_laborales_planillas d
      JOIN recargos_planillas p ON p.id = d.recargo_planilla_id
      JOIN conductores c ON c.id = p.conductor_id
      WHERE d.deleted_at IS NULL AND p.deleted_at IS NULL AND ${enMeses(Prisma.sql`(p."año", p.mes)`, periodo)}
      GROUP BY 1, 2`)
    const suenoPor = new Map(sueno.map((s) => [s.conductor_id, s]))
    const fatiga = jornadas
      .map((j) => {
        const s = suenoPor.get(j.conductor_id)
        const descanso = descansos.find((d) => d.conductor_id === j.conductor_id)
        /// Puntaje simple y explicable: horas promedio por jornada, jornadas
        /// largas, racha sin descanso y sueño corto reportado. No pretende ser
        /// clínico: ordena a quién mirar primero.
        const puntaje =
          j.promedio * 2 +
          j.largas * 3 +
          (descanso ? Math.min(descanso.dias_desde_descanso, 30) : 0) +
          (s ? s.cortas * 2 : 0)
        /// Una jornada de 12 h es la normal en la operación: lo que pesa es
        /// pasarse de ella muchos días o acumular racha sin descanso.
        const sinDescanso = descanso?.estado === 'alerta'
        const riesgo: 'alto' | 'medio' | 'bajo' =
          j.largas >= 10 || j.promedio >= 13 || (sinDescanso && j.promedio >= 10)
            ? 'alto'
            : j.largas >= 4 || j.promedio >= 11 || sinDescanso
              ? 'medio'
              : 'bajo'
        return {
          ...j,
          sueno_promedio: s?.promedio ?? null,
          sueno_cortas: s?.cortas ?? 0,
          dias_desde_descanso: descanso?.dias_desde_descanso ?? null,
          riesgo,
          puntaje,
          enlace: `/dashboard/conductores/${j.conductor_id}`,
        }
      })
      .sort((a, b) => b.puntaje - a.puntaje)
    data.fatiga = {
      umbral_jornada_larga: HORAS_JORNADA_LARGA,
      resumen: { alto: fatiga.filter((f) => f.riesgo === 'alto').length, medio: fatiga.filter((f) => f.riesgo === 'medio').length, bajo: fatiga.filter((f) => f.riesgo === 'bajo').length },
      items: fatiga.slice(0, 12),
    }
  }

  if (modulos['recargos'] || modulos['recorridos']) {
    const { jornadas: horasRaw, fuente } = await jornadasDelPeriodo(periodo, modulos)
    const cobertura = coberturaHoraria(horasRaw)
    data.horas_laboradas = { jornadas: horasRaw.length, fuente, cobertura, pico: picoDe(cobertura) }
  }

  if (modulos['servicios']) {
    const porHora = await prisma.$queryRaw<Array<{ h: number; n: number }>>(Prisma.sql`
      SELECT extract(hour FROM s.fecha_realizacion AT TIME ZONE 'America/Bogota')::int AS h, count(*)::int AS n
      FROM servicios s WHERE s.deleted_at IS NULL AND s.fecha_realizacion >= ${inicio} AND s.fecha_realizacion < ${fin} GROUP BY 1`)
    const dist = new Array<number>(24).fill(0)
    for (const r of porHora) dist[r.h] = r.n
    data.hora_realizacion = { distribucion: dist, promedio: horaPromedio(dist), pico: picoDe(dist) }
  }

  return data
}
