/**
 * Sección «Talento humano» del panel.
 *
 * «Vinculado» = conductor con tipo de contrato y fecha de ingreso (así lo
 * definió talento humano), que no esté inactivo, retirado ni desvinculado.
 * Sobre ellos se revisa qué datos faltan en la ficha (documento, contacto,
 * salario, seguridad social, licencia) y se ofrece completar la seguridad
 * social con la configuración por defecto de la empresa.
 *
 * Nómina: liquidaciones en estado «Liquidado» cuyo periodo toca el periodo
 * elegido. Neto = `sueldo_total`; base prestacional = `salario_devengado +
 * total_vacaciones`, igual que el desprendible.
 */
import { Prisma } from '@prisma/client'
import { prisma } from '../../config/prisma'
import type { ContextoSeccion } from './dashboard.routes'
import { descansosRecientes, rankingDiasLaborados, DIAS_CICLO, VENTANA_DIAS } from './seccion-hseq'

const ESTADOS_FUERA = ['inactivo', 'retirado', 'desvinculado']
const LICENCIA_PROXIMOS_DIAS = 60
export const CLAVE_SEGURIDAD_SOCIAL = 'seguridad_social_defecto'

export interface SeguridadSocialDefecto {
  eps: string | null
  fondo_pension: string | null
  arl: string | null
}

/** Campos de la ficha que talento humano quiere completos, con su etiqueta. */
export const CAMPOS_FICHA: Array<{ campo: string; etiqueta: string; grupo: 'identidad' | 'contacto' | 'laboral' | 'seguridad_social' | 'licencia' }> = [
  { campo: 'numero_identificacion', etiqueta: 'cédula', grupo: 'identidad' },
  { campo: 'fecha_nacimiento', etiqueta: 'fecha de nacimiento', grupo: 'identidad' },
  { campo: 'genero', etiqueta: 'género', grupo: 'identidad' },
  { campo: 'tipo_sangre', etiqueta: 'tipo de sangre', grupo: 'identidad' },
  { campo: 'telefono', etiqueta: 'teléfono', grupo: 'contacto' },
  { campo: 'email', etiqueta: 'correo', grupo: 'contacto' },
  { campo: 'direccion', etiqueta: 'dirección', grupo: 'contacto' },
  { campo: 'salario_base', etiqueta: 'salario', grupo: 'laboral' },
  { campo: 'eps', etiqueta: 'EPS', grupo: 'seguridad_social' },
  { campo: 'fondo_pension', etiqueta: 'fondo de pensión', grupo: 'seguridad_social' },
  { campo: 'arl', etiqueta: 'ARL', grupo: 'seguridad_social' },
  { campo: 'categoria_licencia', etiqueta: 'categoría de licencia', grupo: 'licencia' },
  { campo: 'vencimiento_licencia', etiqueta: 'vencimiento de licencia', grupo: 'licencia' },
]

const vinculadoSql = Prisma.sql`c.deleted_at IS NULL AND c.oculto = false AND c.tipo_contrato IS NOT NULL AND c.tipo_contrato <> '' AND c.fecha_ingreso IS NOT NULL AND c.estado::text NOT IN (${Prisma.join(ESTADOS_FUERA)})`

export async function leerSeguridadSocialDefecto(): Promise<SeguridadSocialDefecto> {
  const fila = await prisma.configuracion_empresa.findUnique({ where: { clave: CLAVE_SEGURIDAD_SOCIAL } })
  const v = (fila?.valor ?? {}) as Partial<SeguridadSocialDefecto>
  return { eps: v.eps ?? null, fondo_pension: v.fondo_pension ?? null, arl: v.arl ?? null }
}

export async function guardarSeguridadSocialDefecto(valor: SeguridadSocialDefecto, usuarioId: string | null) {
  await prisma.configuracion_empresa.upsert({
    where: { clave: CLAVE_SEGURIDAD_SOCIAL },
    create: { clave: CLAVE_SEGURIDAD_SOCIAL, valor: valor as unknown as Prisma.InputJsonValue, actualizado_por_id: usuarioId },
    update: { valor: valor as unknown as Prisma.InputJsonValue, actualizado_por_id: usuarioId },
  })
  return valor
}

/** Completa EPS, fondo y ARL de los vinculados que no los tienen. Devuelve cuántos cambiaron. */
export async function aplicarSeguridadSocialDefecto(valor: SeguridadSocialDefecto) {
  const resultado = { eps: 0, fondo_pension: 0, arl: 0 }
  for (const campo of ['eps', 'fondo_pension', 'arl'] as const) {
    const v = valor[campo]?.trim()
    if (!v) continue
    const col = Prisma.raw(campo)
    const r = await prisma.$executeRaw(Prisma.sql`
      UPDATE conductores c SET ${col} = ${v}, updated_at = now()
      WHERE ${vinculadoSql} AND (c.${col} IS NULL OR c.${col} = '')`)
    resultado[campo] = Number(r)
  }
  return resultado
}

export async function seccionTalentoHumano(ctx: ContextoSeccion): Promise<Record<string, unknown>> {
  const { periodo, modulos } = ctx

  const [vinculados, sinContrato, defecto, diasLaborados, descansos] = await Promise.all([
    prisma.$queryRaw<Array<Record<string, unknown> & { id: string; conductor: string; tipo_contrato: string; fecha_ingreso: Date; estado: string; vencimiento_licencia: Date | null; categoria_licencia: string | null }>>(Prisma.sql`
      SELECT c.id, trim(c.nombre || ' ' || c.apellido) AS conductor, c.tipo_contrato, c.fecha_ingreso, c.estado::text AS estado,
             c.numero_identificacion, c.fecha_nacimiento, c.genero, c.tipo_sangre, c.telefono, c.email, c.direccion,
             c.salario_base, c.eps, c.fondo_pension, c.arl, c.categoria_licencia, c.vencimiento_licencia
      FROM conductores c WHERE ${vinculadoSql} ORDER BY c.nombre, c.apellido`),
    prisma.$queryRaw<Array<{ id: string; conductor: string; estado: string; fecha_ingreso: Date | null }>>(Prisma.sql`
      SELECT c.id, trim(c.nombre || ' ' || c.apellido) AS conductor, c.estado::text AS estado, c.fecha_ingreso
      FROM conductores c
      WHERE c.deleted_at IS NULL AND c.oculto = false AND c.estado::text IN ('activo', 'disponible', 'programado', 'servicio', 'descanso')
        AND (c.tipo_contrato IS NULL OR c.tipo_contrato = '' OR c.fecha_ingreso IS NULL)
      ORDER BY c.nombre, c.apellido`),
    leerSeguridadSocialDefecto(),
    rankingDiasLaborados(periodo),
    descansosRecientes(),
  ])

  // ── Pendientes por diligenciar ──
  const hoyMs = Date.now()
  const pendientes = vinculados
    .map((c) => {
      const faltan = CAMPOS_FICHA.filter(({ campo }) => {
        const v = c[campo]
        if (v === null || v === undefined) return true
        if (typeof v === 'string' && v.trim() === '') return true
        if (campo === 'salario_base' && Number(v) <= 0) return true
        return false
      })
      return { id: c.id, conductor: c.conductor, tipo_contrato: c.tipo_contrato, faltan: faltan.map((f) => f.etiqueta), grupos: [...new Set(faltan.map((f) => f.grupo))], enlace: `/dashboard/conductores/${c.id}` }
    })
    .filter((c) => c.faltan.length > 0)
    .sort((a, b) => b.faltan.length - a.faltan.length)
  const faltanPorCampo = CAMPOS_FICHA.map((f) => ({
    campo: f.campo,
    etiqueta: f.etiqueta,
    grupo: f.grupo,
    n: vinculados.filter((c) => {
      const v = c[f.campo]
      return v === null || v === undefined || (typeof v === 'string' && v.trim() === '') || (f.campo === 'salario_base' && Number(v) <= 0)
    }).length,
  })).filter((f) => f.n > 0).sort((a, b) => b.n - a.n)

  const porContrato = new Map<string, number>()
  for (const c of vinculados) porContrato.set(c.tipo_contrato, (porContrato.get(c.tipo_contrato) ?? 0) + 1)

  // ── Licencias ──
  const licencias = vinculados
    .filter((c) => c.vencimiento_licencia)
    .map((c) => ({ id: c.id, conductor: c.conductor, categoria: c.categoria_licencia, vence: c.vencimiento_licencia!.toISOString().slice(0, 10), dias: Math.floor((c.vencimiento_licencia!.getTime() - hoyMs) / 86400000), enlace: `/dashboard/conductores/${c.id}` }))
    .filter((l) => l.dias <= LICENCIA_PROXIMOS_DIAS)
    .sort((a, b) => a.dias - b.dias)

  const sinSeguridad = {
    eps: vinculados.filter((c) => !c.eps).length,
    fondo_pension: vinculados.filter((c) => !c.fondo_pension).length,
    arl: vinculados.filter((c) => !c.arl).length,
  }

  const data: Record<string, unknown> = {
    kpis: {
      vinculados: vinculados.length,
      por_contrato: [...porContrato.entries()].map(([tipo, n]) => ({ tipo, n })).sort((a, b) => b.n - a.n),
      con_pendientes: pendientes.length,
      activos_sin_contrato: sinContrato.length,
      licencias_vencidas: licencias.filter((l) => l.dias < 0).length,
      licencias_proximas: licencias.filter((l) => l.dias >= 0).length,
      alertas_descanso: descansos.filter((d) => d.estado === 'alerta').length,
    },
    pendientes: { items: pendientes.slice(0, 25), por_campo: faltanPorCampo },
    sin_contrato: sinContrato.slice(0, 15).map((c) => ({ ...c, fecha_ingreso: c.fecha_ingreso ? c.fecha_ingreso.toISOString().slice(0, 10) : null, enlace: `/dashboard/conductores/${c.id}` })),
    licencias: { proximos_dias: LICENCIA_PROXIMOS_DIAS, items: licencias.slice(0, 20) },
    seguridad_social: { defecto: defecto, sin_dato: sinSeguridad, puede_editar: modulos['conductores'] === 'full' },
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
      items: descansos.slice(0, 20),
    },
  }

  // ── Nómina (solo con acceso al módulo) ──
  if (modulos['nomina']) {
    const liqPeriodo = Prisma.sql`l.deleted_at IS NULL AND l.estado = 'Liquidado' AND l.periodo_start <= ${periodo.hasta} AND l.periodo_end >= ${periodo.desde}`
    const [totales, mejorPagados, historico] = await Promise.all([
      prisma.$queryRaw<Array<{ n: number; neto: number; salud: number; pension: number; base: number; recargos: number; bonificaciones: number; dias: number }>>(Prisma.sql`
        SELECT count(*)::int AS n, coalesce(sum(l.sueldo_total), 0)::float AS neto, coalesce(sum(l.salud), 0)::float AS salud, coalesce(sum(l.pension), 0)::float AS pension,
               coalesce(sum(l.salario_devengado + l.total_vacaciones), 0)::float AS base, coalesce(sum(l.total_recargos), 0)::float AS recargos,
               coalesce(sum(l.total_bonificaciones), 0)::float AS bonificaciones, coalesce(sum(l.dias_laborados), 0)::int AS dias
        FROM liquidaciones l WHERE ${liqPeriodo}`),
      prisma.$queryRaw<Array<{ conductor_id: string; conductor: string; neto: number; base: number; dias: number; liquidaciones: number }>>(Prisma.sql`
        SELECT c.id AS conductor_id, trim(c.nombre || ' ' || c.apellido) AS conductor, sum(l.sueldo_total)::float AS neto,
               sum(l.salario_devengado + l.total_vacaciones)::float AS base, sum(l.dias_laborados)::int AS dias, count(*)::int AS liquidaciones
        FROM liquidaciones l JOIN conductores c ON c.id = l.conductor_id
        WHERE ${liqPeriodo} GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 12`),
      // Periodos con al menos tres liquidaciones: los cortes sueltos de una
      // sola persona (incapacidades, retiros) no son «un mes de nómina».
      prisma.$queryRaw<Array<{ periodo_start: string; periodo_end: string; n: number; neto: number; salud_pension: number; base: number }>>(Prisma.sql`
        SELECT l.periodo_start, max(l.periodo_end) AS periodo_end, count(*)::int AS n, coalesce(sum(l.sueldo_total), 0)::float AS neto,
               coalesce(sum(l.salud + l.pension), 0)::float AS salud_pension, coalesce(sum(l.salario_devengado + l.total_vacaciones), 0)::float AS base
        FROM liquidaciones l WHERE l.deleted_at IS NULL AND l.estado = 'Liquidado' AND l.periodo_start <= ${periodo.hasta}
        GROUP BY 1 HAVING count(*) >= 3 ORDER BY 1 DESC LIMIT 6`),
    ])
    const t = totales[0]
    data.nomina = {
      periodo: { liquidaciones: t?.n ?? 0, neto: t?.neto ?? 0, salud: t?.salud ?? 0, pension: t?.pension ?? 0, base_prestacional: t?.base ?? 0, recargos: t?.recargos ?? 0, bonificaciones: t?.bonificaciones ?? 0, dias: t?.dias ?? 0 },
      mejor_pagados: mejorPagados.map((m) => ({ ...m, enlace: `/dashboard/conductores/${m.conductor_id}` })),
      historico: historico.reverse(),
    }
  }

  return data
}
