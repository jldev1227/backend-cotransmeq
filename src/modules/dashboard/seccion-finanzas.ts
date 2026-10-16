/**
 * Rentabilidad operativa orientativa para el panel.
 *
 * Cada fuente conserva su base de fechas: ventas y cierres por mes de servicio,
 * nómina por cruce del corte, y egresos por fecha del movimiento. El margen se
 * marca parcial si el usuario no puede consultar todas las fuentes de costo.
 */
import { Prisma } from '@prisma/client'
import { prisma } from '../../config/prisma'
import type { ContextoSeccion } from './dashboard.routes'
import { enMeses } from './seccion-operaciones'

type FuenteCosto = {
  id: string
  etiqueta: string
  valor: number | null
  cantidad: number | null
  enlace: string | null
  incluida_en_margen: boolean
}

/** Monta ingresos, costos observables y cobertura sin convertir una fuente sin acceso en cero. */
export async function resumenFinanciero(ctx: ContextoSeccion, facturado: number, terceros: boolean) {
  const { periodo, modulos } = ctx
  const fuentesRequeridas = ['liquidaciones-terceros', 'nomina', 'viaticos', 'combustible', 'mantenimiento']
  const [ingresosRows, tercerosRows, nominaRows, viaticosRows, combustibleRows, mantenimientoRows, carteraRows] = await Promise.all([
    prisma.$queryRaw<Array<{ cantidad: number; valor: number }>>(Prisma.sql`
      SELECT count(*)::int AS cantidad, coalesce(sum(l.total), 0)::float AS valor
      FROM liquidacion_servicio l
      WHERE l.deleted_at IS NULL AND l.estado::text NOT IN ('BORRADOR', 'ANULADA')
        AND ${enMeses(Prisma.sql`(l.anio, l.mes)`, periodo)}`),
    terceros
      ? prisma.$queryRaw<Array<{ cantidad: number; valor: number }>>(Prisma.sql`
          SELECT count(*)::int AS cantidad, coalesce(sum(f.total_pagar), 0)::float AS valor
          FROM liquidacion_tercero_final f
          WHERE f.deleted_at IS NULL AND f.estado IN ('APROBADA', 'PAGADA', 'FACTURADA')
            AND ${enMeses(Prisma.sql`(f.anio, f.mes)`, periodo)}`)
      : Promise.resolve([]),
    modulos['nomina']
      ? prisma.$queryRaw<Array<{ cantidad: number; neto: number; salud: number; pension: number }>>(Prisma.sql`
          SELECT count(*)::int AS cantidad, coalesce(sum(l.sueldo_total), 0)::float AS neto,
                 coalesce(sum(l.salud), 0)::float AS salud, coalesce(sum(l.pension), 0)::float AS pension
          FROM liquidaciones l
          WHERE l.deleted_at IS NULL AND l.estado = 'Liquidado'
            AND l.periodo_start <= ${periodo.hasta} AND l.periodo_end >= ${periodo.desde}`)
      : Promise.resolve([]),
    modulos['viaticos']
      ? prisma.$queryRaw<Array<{ tipo: string; cantidad: number; valor: number }>>(Prisma.sql`
          SELECT 'legalizados' AS tipo, count(*)::int AS cantidad, coalesce(sum(g.valor), 0)::float AS valor
          FROM viatico_gasto g JOIN viatico_anticipo a ON a.id = g.anticipo_id
          WHERE g.anulado_at IS NULL AND a.deleted_at IS NULL
            AND g.fecha >= ${periodo.desde}::date AND g.fecha <= ${periodo.hasta}::date
          UNION ALL
          SELECT 'empresa:' || g.categoria AS tipo, count(*)::int AS cantidad, coalesce(sum(g.valor), 0)::float AS valor
          FROM viatico_gasto_empresa g
          WHERE g.deleted_at IS NULL AND g.asume = 'EMPRESA'
            AND g.fecha >= ${periodo.desde}::date AND g.fecha <= ${periodo.hasta}::date
          GROUP BY g.categoria`)
      : Promise.resolve([]),
    modulos['combustible']
      ? prisma.$queryRaw<Array<{ cantidad: number; valor: number }>>(Prisma.sql`
          SELECT count(*)::int AS cantidad, coalesce(sum(t.valor_total), 0)::float AS valor
          FROM combustible_tanqueos t
          WHERE t.deleted_at IS NULL AND t.fecha_hora >= ${periodo.inicio} AND t.fecha_hora < ${periodo.fin}`)
      : Promise.resolve([]),
    modulos['mantenimiento']
      ? prisma.$queryRaw<Array<{ cantidad: number; valor: number }>>(Prisma.sql`
          SELECT count(*)::int AS cantidad, coalesce(sum(e.costo), 0)::float AS valor
          FROM vehicle_maintenance_event e
          WHERE e.deleted_at IS NULL AND e.estado = 'EJECUTADO'
            AND e.fecha_ejecucion >= ${periodo.desde}::date AND e.fecha_ejecucion <= ${periodo.hasta}::date`)
      : Promise.resolve([]),
    modulos['cartera']
      ? prisma.$queryRaw<Array<{ abiertas: number; saldo: number; vencidas: number; saldo_vencido: number }>>(Prisma.sql`
          WITH saldos AS (
            SELECT f.id, f.fecha_vencimiento,
              greatest(f.valor_total - coalesce(sum(a.valor + a.retefuente + a.reteica + a.reteiva + a.otros_descuentos), 0), 0)::float AS saldo
            FROM factura_liquidacion_servicio f
            LEFT JOIN factura_liquidacion_abono a ON a.factura_id = f.id AND a.deleted_at IS NULL
            WHERE f.deleted_at IS NULL AND f.fecha_anulacion IS NULL
              AND f.fecha_facturacion >= ${periodo.inicio} AND f.fecha_facturacion < ${periodo.fin}
            GROUP BY f.id
          )
          SELECT count(*) FILTER (WHERE saldo > 0)::int AS abiertas,
                 coalesce(sum(saldo), 0)::float AS saldo,
                 count(*) FILTER (WHERE saldo > 0 AND fecha_vencimiento < current_date)::int AS vencidas,
                 coalesce(sum(saldo) FILTER (WHERE saldo > 0 AND fecha_vencimiento < current_date), 0)::float AS saldo_vencido
          FROM saldos`)
      : Promise.resolve([]),
  ])

  const ingreso = ingresosRows[0] ?? { cantidad: 0, valor: 0 }
  const cierreTerceros = tercerosRows[0] ?? { cantidad: 0, valor: 0 }
  const nomina = nominaRows[0] ?? { cantidad: 0, neto: 0, salud: 0, pension: 0 }
  const combustible = combustibleRows[0] ?? { cantidad: 0, valor: 0 }
  const mantenimiento = mantenimientoRows[0] ?? { cantidad: 0, valor: 0 }
  const gastos = new Map(viaticosRows.map((g) => [g.tipo, g]))
  const gasto = (clave: string) => gastos.get(clave)?.valor ?? 0
  const cantidadGasto = (clave: string) => gastos.get(clave)?.cantidad ?? 0

  /// MANTENIMIENTO se muestra, pero no se suma aquí: puede ser el mismo pago ya
  /// registrado en la orden ejecutada. CONDUCTOR se excluye para no duplicar nómina.
  const gastosEmpresaIncluidos = ['OFICINA', 'BANCARIO', 'OTRO', 'PROFESIONAL']
    .reduce((suma, categoria) => suma + gasto(`empresa:${categoria}`), 0)
  const costosConocidos = cierreTerceros.valor + nomina.neto + gasto('legalizados') + gastosEmpresaIncluidos + combustible.valor + mantenimiento.valor
  const disponibles = {
    terceros: Boolean(modulos['liquidaciones-terceros']),
    nomina: Boolean(modulos['nomina']),
    viaticos: Boolean(modulos['viaticos']),
    combustible: Boolean(modulos['combustible']),
    mantenimiento: Boolean(modulos['mantenimiento']),
  }
  const coberturaCompleta = fuentesRequeridas.every((modulo) => Boolean(modulos[modulo]))
  const margen = ingreso.valor - costosConocidos
  const fuentes: FuenteCosto[] = [
    { id: 'terceros', etiqueta: 'Pagos liquidados a terceros', valor: disponibles.terceros ? cierreTerceros.valor : null, cantidad: disponibles.terceros ? cierreTerceros.cantidad : null, enlace: '/dashboard/liquidaciones-terceros', incluida_en_margen: true },
    { id: 'nomina', etiqueta: 'Nómina neta liquidada', valor: disponibles.nomina ? nomina.neto : null, cantidad: disponibles.nomina ? nomina.cantidad : null, enlace: '/dashboard/nomina', incluida_en_margen: true },
    { id: 'viaticos', etiqueta: 'Viáticos legalizados', valor: disponibles.viaticos ? gasto('legalizados') : null, cantidad: disponibles.viaticos ? cantidadGasto('legalizados') : null, enlace: '/dashboard/viaticos', incluida_en_margen: true },
    { id: 'profesionales', etiqueta: 'Servicios profesionales', valor: disponibles.viaticos ? gasto('empresa:PROFESIONAL') : null, cantidad: disponibles.viaticos ? cantidadGasto('empresa:PROFESIONAL') : null, enlace: '/dashboard/viaticos', incluida_en_margen: true },
    { id: 'gastos_empresa', etiqueta: 'Otros gastos de empresa', valor: disponibles.viaticos ? gastosEmpresaIncluidos - gasto('empresa:PROFESIONAL') : null, cantidad: disponibles.viaticos ? ['OFICINA', 'BANCARIO', 'OTRO'].reduce((suma, c) => suma + cantidadGasto(`empresa:${c}`), 0) : null, enlace: '/dashboard/viaticos', incluida_en_margen: true },
    { id: 'combustible', etiqueta: 'Combustible', valor: disponibles.combustible ? combustible.valor : null, cantidad: disponibles.combustible ? combustible.cantidad : null, enlace: '/dashboard/combustible', incluida_en_margen: true },
    { id: 'mantenimiento', etiqueta: 'Mantenimiento ejecutado', valor: disponibles.mantenimiento ? mantenimiento.valor : null, cantidad: disponibles.mantenimiento ? mantenimiento.cantidad : null, enlace: '/dashboard/mantenimiento', incluida_en_margen: true },
    { id: 'mantenimiento_viaticos', etiqueta: 'Gastos marcados como mantenimiento (posible cruce con órdenes)', valor: disponibles.viaticos ? gasto('empresa:MANTENIMIENTO') : null, cantidad: disponibles.viaticos ? cantidadGasto('empresa:MANTENIMIENTO') : null, enlace: '/dashboard/viaticos', incluida_en_margen: false },
    { id: 'conductor_viaticos', etiqueta: 'Pagos directos a conductores', valor: disponibles.viaticos ? gasto('empresa:CONDUCTOR') : null, cantidad: disponibles.viaticos ? cantidadGasto('empresa:CONDUCTOR') : null, enlace: '/dashboard/viaticos', incluida_en_margen: false },
  ]
  const cartera = carteraRows[0] ?? { abiertas: 0, saldo: 0, vencidas: 0, saldo_vencido: 0 }

  return {
    ingresos: {
      liquidado: ingreso.valor,
      liquidaciones: ingreso.cantidad,
      facturado,
      brecha_facturacion: Math.max(ingreso.valor - facturado, 0),
      cartera: modulos['cartera'] ? cartera : null,
    },
    costos: {
      identificados: costosConocidos,
      fuentes,
      cobertura_completa: coberturaCompleta,
      nomina_salud_pension_retenida: disponibles.nomina ? nomina.salud + nomina.pension : null,
    },
    margen: {
      valor: margen,
      porcentaje: ingreso.valor > 0 ? (margen / ingreso.valor) * 100 : null,
      parcial: !coberturaCompleta,
    },
    periodo_liquidaciones: 'mes_servicio',
  }
}
