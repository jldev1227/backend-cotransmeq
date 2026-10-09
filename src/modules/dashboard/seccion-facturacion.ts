/**
 * Secciones «Facturación» y «Contabilidad» del panel. Comparten casi todo lo
 * de terceros, así que viven en el mismo archivo.
 *
 * Facturación:
 *  - Liquidaciones de servicios APROBADAS = pendientes de facturar y
 *    relacionar la factura; LIQUIDADAS = esperando aprobación.
 *  - Facturado en el periodo (`factura_liquidacion_servicio` por fecha de
 *    facturación, sin anuladas), mes a mes, y por cliente (factura → ítems →
 *    liquidación → cliente).
 *  - Lo pagado a terceros por tercero y por placa (`liquidacion_tercero_final`
 *    del periodo, sin anuladas), la lista completa, no solo el top.
 *
 * Contabilidad: lo de terceros sin lo de facturas, más terceros con datos
 * incompletos (sin NIT/cédula, sin teléfono ni correo).
 *
 * «Previstas para pagar»: cierres finales APROBADOS por mes. El estado que
 * sigue es FACTURADA («Marcar facturada»: ya se pagó al tercero). El enlace
 * abre el canvas de ese mes con `spotlight=estado`, que resalta el botón de
 * estado de la hoja.
 */
import { Prisma } from '@prisma/client'
import { prisma } from '../../config/prisma'
import type { ContextoSeccion } from './dashboard.routes'
import type { Periodo } from './periodo'
import { enMeses } from './seccion-operaciones'

const MESES_HISTORICO = 6

function mesesAtras(periodo: Periodo, n: number): Array<{ anio: number; mes: number }> {
  const ultimo = periodo.meses[periodo.meses.length - 1]
  const out: Array<{ anio: number; mes: number }> = []
  let { anio, mes } = ultimo
  for (let i = 0; i < n; i++) {
    out.unshift({ anio, mes })
    mes -= 1
    if (mes < 1) {
      mes = 12
      anio -= 1
    }
  }
  return out
}

/** Lo de liquidaciones de terceros que ven facturación y contabilidad. */
async function bloqueTerceros(periodo: Periodo) {
  const historico = mesesAtras(periodo, MESES_HISTORICO)
  const enHistorico = Prisma.sql`(f.anio, f.mes) IN (${Prisma.join(historico.map((m) => Prisma.sql`(${m.anio}, ${m.mes})`))})`
  const [porMes, porTercero, porPlaca, aprobadas] = await Promise.all([
    prisma.$queryRaw<Array<{ anio: number; mes: number; estado: string; n: number; valor: number }>>(Prisma.sql`
      SELECT f.anio, f.mes, f.estado, count(*)::int AS n, coalesce(sum(f.total_pagar), 0)::float AS valor
      FROM liquidacion_tercero_final f
      WHERE f.deleted_at IS NULL AND ${enHistorico}
      GROUP BY 1, 2, 3 ORDER BY 1, 2`),
    prisma.$queryRaw<Array<{ tercero_id: string | null; tercero: string; identificacion: string | null; n: number; valor: number }>>(Prisma.sql`
      SELECT t.id AS tercero_id, coalesce(t.nombre_completo, 'Sin tercero') AS tercero, t.identificacion, count(*)::int AS n, coalesce(sum(f.total_pagar), 0)::float AS valor
      FROM liquidacion_tercero_final f LEFT JOIN terceros t ON t.id = f.tercero_id
      WHERE f.deleted_at IS NULL AND f.estado <> 'ANULADA' AND ${enMeses(Prisma.sql`(f.anio, f.mes)`, periodo)}
      GROUP BY 1, 2, 3 ORDER BY 5 DESC`),
    prisma.$queryRaw<Array<{ placa: string; vehiculo_id: string | null; tercero: string | null; n: number; valor: number }>>(Prisma.sql`
      SELECT f.placa, max(f.vehiculo_id::text) AS vehiculo_id, max(t.nombre_completo) AS tercero, count(*)::int AS n, coalesce(sum(f.total_pagar), 0)::float AS valor
      FROM liquidacion_tercero_final f LEFT JOIN terceros t ON t.id = f.tercero_id
      WHERE f.deleted_at IS NULL AND f.estado <> 'ANULADA' AND ${enMeses(Prisma.sql`(f.anio, f.mes)`, periodo)}
      GROUP BY 1 ORDER BY 5 DESC`),
    prisma.$queryRaw<Array<{ anio: number; mes: number; n: number; valor: number }>>(Prisma.sql`
      SELECT f.anio, f.mes, count(*)::int AS n, coalesce(sum(f.total_pagar), 0)::float AS valor
      FROM liquidacion_tercero_final f
      WHERE f.deleted_at IS NULL AND f.estado = 'APROBADA'
      GROUP BY 1, 2 ORDER BY 1 DESC, 2 DESC LIMIT 12`),
  ])

  const mesAMes = historico.map((m) => {
    const filas = porMes.filter((r) => r.anio === m.anio && r.mes === m.mes)
    const de = (estado: string) => filas.find((r) => r.estado === estado)
    return {
      anio: m.anio,
      mes: m.mes,
      total: filas.filter((r) => r.estado !== 'ANULADA').reduce((a, r) => a + r.valor, 0),
      n: filas.filter((r) => r.estado !== 'ANULADA').reduce((a, r) => a + r.n, 0),
      borrador: de('BORRADOR')?.valor ?? 0,
      aprobada: de('APROBADA')?.valor ?? 0,
      facturada: de('FACTURADA')?.valor ?? 0,
      n_borrador: de('BORRADOR')?.n ?? 0,
      n_aprobada: de('APROBADA')?.n ?? 0,
      n_facturada: de('FACTURADA')?.n ?? 0,
    }
  })

  return {
    terceros_mes_a_mes: mesAMes,
    previstas_pagar: {
      total: aprobadas.reduce((a, r) => a + r.n, 0),
      valor: aprobadas.reduce((a, r) => a + r.valor, 0),
      por_mes: aprobadas.map((r) => ({ ...r, enlace: `/dashboard/liquidaciones-terceros/canvas?anio=${r.anio}&mes=${r.mes}&spotlight=estado` })),
    },
    ranking_terceros: porTercero.map((t) => ({ ...t, enlace: t.tercero_id ? `/dashboard/terceros/${t.tercero_id}` : null })),
    ranking_placas: porPlaca.map((p) => ({ ...p, enlace: p.vehiculo_id ? `/dashboard/flota/${p.vehiculo_id}` : null })),
  }
}

export async function seccionFacturacion(ctx: ContextoSeccion): Promise<Record<string, unknown>> {
  const { periodo, modulos } = ctx
  const { inicio, fin } = periodo
  const historico = mesesAtras(periodo, MESES_HISTORICO)
  const primerMes = historico[0]
  const inicioHistorico = new Date(`${primerMes.anio}-${String(primerMes.mes).padStart(2, '0')}-01T00:00:00-05:00`)

  const [porEstado, aprobadas, facturado, facturadoMes, porCliente] = await Promise.all([
    prisma.$queryRaw<Array<{ estado: string; n: number; valor: number }>>(Prisma.sql`
      SELECT l.estado::text AS estado, count(*)::int AS n, coalesce(sum(l.total), 0)::float AS valor
      FROM liquidacion_servicio l WHERE l.deleted_at IS NULL AND l.estado::text IN ('LIQUIDADA', 'APROBADA') GROUP BY 1`),
    prisma.$queryRaw<Array<{ id: string; consecutivo: string; cliente: string | null; mes: number; anio: number; total: number; fecha_aprobacion: Date | null }>>(Prisma.sql`
      SELECT l.id, l.consecutivo, e.nombre AS cliente, l.mes, l.anio, l.total::float AS total, l.fecha_aprobacion
      FROM liquidacion_servicio l JOIN empresas e ON e.id = l.cliente_id
      WHERE l.deleted_at IS NULL AND l.estado = 'APROBADA'
      ORDER BY l.fecha_aprobacion ASC NULLS LAST, l.anio, l.mes LIMIT 30`),
    prisma.$queryRaw<Array<{ n: number; valor: number; anuladas: number }>>(Prisma.sql`
      SELECT count(*) FILTER (WHERE fa.fecha_anulacion IS NULL)::int AS n, coalesce(sum(fa.valor_total) FILTER (WHERE fa.fecha_anulacion IS NULL), 0)::float AS valor,
             count(*) FILTER (WHERE fa.fecha_anulacion IS NOT NULL)::int AS anuladas
      FROM factura_liquidacion_servicio fa
      WHERE fa.deleted_at IS NULL AND fa.fecha_facturacion >= ${inicio} AND fa.fecha_facturacion < ${fin}`),
    prisma.$queryRaw<Array<{ anio: number; mes: number; n: number; valor: number }>>(Prisma.sql`
      SELECT extract(year FROM fa.fecha_facturacion AT TIME ZONE 'America/Bogota')::int AS anio, extract(month FROM fa.fecha_facturacion AT TIME ZONE 'America/Bogota')::int AS mes,
             count(*)::int AS n, coalesce(sum(fa.valor_total), 0)::float AS valor
      FROM factura_liquidacion_servicio fa
      WHERE fa.deleted_at IS NULL AND fa.fecha_anulacion IS NULL AND fa.fecha_facturacion >= ${inicioHistorico} AND fa.fecha_facturacion < ${fin}
      GROUP BY 1, 2 ORDER BY 1, 2`),
    prisma.$queryRaw<Array<{ cliente_id: string; cliente: string | null; nit: string | null; facturas: number; valor: number }>>(Prisma.sql`
      SELECT e.id AS cliente_id, e.nombre AS cliente, e.nit, count(DISTINCT fa.id)::int AS facturas, coalesce(sum(i.valor_liquidacion), 0)::float AS valor
      FROM factura_liquidacion_servicio fa
      JOIN factura_liquidacion_item i ON i.factura_id = fa.id AND i.deleted_at IS NULL
      JOIN liquidacion_servicio l ON l.id = i.liquidacion_id
      JOIN empresas e ON e.id = l.cliente_id
      WHERE fa.deleted_at IS NULL AND fa.fecha_anulacion IS NULL AND fa.fecha_facturacion >= ${inicio} AND fa.fecha_facturacion < ${fin}
      GROUP BY 1, 2, 3 ORDER BY 5 DESC`),
  ])

  const de = (estado: string) => porEstado.find((r) => r.estado === estado)
  const data: Record<string, unknown> = {
    kpis: {
      por_facturar: de('APROBADA')?.n ?? 0,
      por_facturar_valor: de('APROBADA')?.valor ?? 0,
      por_aprobar: de('LIQUIDADA')?.n ?? 0,
      por_aprobar_valor: de('LIQUIDADA')?.valor ?? 0,
      facturas: facturado[0]?.n ?? 0,
      facturado: facturado[0]?.valor ?? 0,
      facturas_anuladas: facturado[0]?.anuladas ?? 0,
    },
    por_facturar: aprobadas.map((l) => ({ ...l, fecha_aprobacion: l.fecha_aprobacion ? l.fecha_aprobacion.toISOString().slice(0, 10) : null, enlace: `/dashboard/liquidaciones-servicios/${l.id}` })),
    facturado_mes_a_mes: historico.map((m) => {
      const r = facturadoMes.find((x) => x.anio === m.anio && x.mes === m.mes)
      return { anio: m.anio, mes: m.mes, n: r?.n ?? 0, valor: r?.valor ?? 0 }
    }),
    ranking_clientes: porCliente.map((c) => ({ ...c, cliente: c.cliente ?? 'Sin nombre', enlace: `/dashboard/clientes/${c.cliente_id}` })),
  }

  if (modulos['liquidaciones-terceros']) Object.assign(data, await bloqueTerceros(periodo))
  return data
}

export async function seccionContabilidad(ctx: ContextoSeccion): Promise<Record<string, unknown>> {
  const { periodo, modulos } = ctx
  const [resumen, incompletos] = await Promise.all([
    prisma.$queryRaw<Array<{ total: number; sin_identificacion: number; sin_contacto: number; sin_ambos: number }>>(Prisma.sql`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE t.identificacion IS NULL OR trim(t.identificacion) = '')::int AS sin_identificacion,
             count(*) FILTER (WHERE (t.telefono IS NULL OR trim(t.telefono) = '') AND (t.correo IS NULL OR trim(t.correo) = ''))::int AS sin_contacto,
             count(*) FILTER (WHERE (t.identificacion IS NULL OR trim(t.identificacion) = '') AND (t.telefono IS NULL OR trim(t.telefono) = '') AND (t.correo IS NULL OR trim(t.correo) = ''))::int AS sin_ambos
      FROM terceros t WHERE t.deleted_at IS NULL AND t.activo = true`),
    prisma.$queryRaw<Array<{ id: string; nombre: string; identificacion: string | null; telefono: string | null; correo: string | null; liquidaciones: number }>>(Prisma.sql`
      SELECT t.id, t.nombre_completo AS nombre, t.identificacion, t.telefono, t.correo,
             (SELECT count(*)::int FROM liquidacion_tercero_final f WHERE f.tercero_id = t.id AND f.deleted_at IS NULL) AS liquidaciones
      FROM terceros t
      WHERE t.deleted_at IS NULL AND t.activo = true AND (
        t.identificacion IS NULL OR trim(t.identificacion) = ''
        OR ((t.telefono IS NULL OR trim(t.telefono) = '') AND (t.correo IS NULL OR trim(t.correo) = '')))
      ORDER BY liquidaciones DESC, t.nombre_completo LIMIT 40`),
  ])
  const r = resumen[0]
  const data: Record<string, unknown> = {
    kpis: { terceros: r?.total ?? 0, sin_identificacion: r?.sin_identificacion ?? 0, sin_contacto: r?.sin_contacto ?? 0, sin_ambos: r?.sin_ambos ?? 0 },
    terceros_incompletos: incompletos.map((t) => ({
      ...t,
      faltan: [
        ...(!t.identificacion?.trim() ? ['NIT o cédula'] : []),
        ...(!t.telefono?.trim() && !t.correo?.trim() ? ['teléfono y correo'] : []),
      ],
      enlace: `/dashboard/terceros/${t.id}`,
    })),
  }
  if (modulos['liquidaciones-terceros']) Object.assign(data, await bloqueTerceros(periodo))
  return data
}
