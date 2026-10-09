/**
 * Sección «Mantenimiento» del panel.
 *
 * Fuentes:
 *  - Preoperacionales (HSEQ-FR-08/09): cada ítem del checklist se responde
 *    Bueno / Malo / No aplica (opción `M` = Malo) y puede traer observación en
 *    el campo `<clave>_obs`. De ahí salen las novedades por placa y los ítems
 *    que más fallan, y el `km_final` más reciente da el kilometraje.
 *  - Mantenimientos: días tipo MANTENIMIENTO del formato de recorridos
 *    (`registro_dia_laboral`), con la placa intervenida y la observación.
 *  - Documentos del vehículo (`documento`): SOAT, tecnomecánica, pólizas y
 *    tarjeta de operación con su vencimiento.
 *
 * «Estado del vehículo» = el último preoperacional de cada placa (sin acotar
 * al periodo, porque lo que importa es cómo quedó la última vez que alguien
 * lo revisó): con novedades si tiene ítems en Malo.
 */
import { Prisma } from '@prisma/client'
import { prisma } from '../../config/prisma'
import type { ContextoSeccion } from './dashboard.routes'
import { diasDelPeriodo } from './periodo'
import { CODIGOS_PREOPERACIONAL } from './seccion-hseq'

const PROXIMOS_DIAS = 30
/** Categorías de `documento` que vencen y que mantenimiento tiene que vigilar. */
const CATEGORIAS_VENCEN = ['SOAT', 'TECNOMECANICA', 'POLIZA_CONTRACTUAL', 'POLIZA_EXTRACONTRACTUAL', 'POLIZA_TODO_RIESGO', 'TARJETA_DE_OPERACION', 'CERTIFICADO_GPS', 'REVISION_PREVENTIVA']
const ETIQUETA_CATEGORIA: Record<string, string> = {
  SOAT: 'SOAT',
  TECNOMECANICA: 'Tecnomecánica',
  POLIZA_CONTRACTUAL: 'Póliza contractual',
  POLIZA_EXTRACONTRACTUAL: 'Póliza extracontractual',
  POLIZA_TODO_RIESGO: 'Póliza todo riesgo',
  TARJETA_DE_OPERACION: 'Tarjeta de operación',
  CERTIFICADO_GPS: 'Certificado GPS',
  REVISION_PREVENTIVA: 'Revisión preventiva',
}

const preopJoin = Prisma.sql`
  JOIN form_versions v ON v.id = s.version_id
  JOIN form_definitions d ON d.id = v.form_id AND d.code IN (${Prisma.join(CODIGOS_PREOPERACIONAL)})`

export async function seccionMantenimiento(ctx: ContextoSeccion): Promise<Record<string, unknown>> {
  const { periodo } = ctx
  const enviosPeriodo = Prisma.sql`s.deleted_at IS NULL AND s.status = 'SUBMITTED' AND s.business_date >= ${periodo.desde}::date AND s.business_date <= ${periodo.hasta}::date`

  const [vehiculosEstado, itemsMalos, malosPorPlaca, novedades, mantenimientos, mantPorDia, kilometraje, vencimientos, preopPeriodo] = await Promise.all([
    prisma.vehiculos.groupBy({ by: ['estado'], where: { deleted_at: null }, _count: { _all: true } }),
    // Ítems que más salen en Malo en el periodo
    prisma.$queryRaw<Array<{ key: string; label: string; n: number; placas: number }>>(Prisma.sql`
      SELECT f.key, min(f.label) AS label, count(*)::int AS n, count(DISTINCT s.vehicle_id)::int AS placas
      FROM form_answers a
      JOIN form_answer_options ao ON ao.answer_id = a.id
      JOIN form_field_options o ON o.id = ao.option_id AND o.value = 'M'
      JOIN form_fields f ON f.id = a.field_id
      JOIN form_submissions s ON s.id = a.submission_id ${preopJoin}
      WHERE ${enviosPeriodo}
      GROUP BY 1 ORDER BY 3 DESC LIMIT 12`),
    // Placas con más novedades en el periodo
    prisma.$queryRaw<Array<{ vehiculo_id: string; placa: string; n: number; preoperacionales: number }>>(Prisma.sql`
      SELECT s.vehicle_id AS vehiculo_id, ve.placa, count(*)::int AS n, count(DISTINCT s.id)::int AS preoperacionales
      FROM form_answers a
      JOIN form_answer_options ao ON ao.answer_id = a.id
      JOIN form_field_options o ON o.id = ao.option_id AND o.value = 'M'
      JOIN form_submissions s ON s.id = a.submission_id ${preopJoin}
      JOIN vehiculos ve ON ve.id = s.vehicle_id
      WHERE ${enviosPeriodo}
      GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 10`),
    // Estado actual: último preoperacional de cada placa y sus ítems en Malo (con observación)
    prisma.$queryRaw<Array<{ vehiculo_id: string; placa: string; submission_id: string; business_date: Date; conductor: string | null; key: string; label: string; observacion: string | null }>>(Prisma.sql`
      WITH ultimo AS (
        SELECT DISTINCT ON (s.vehicle_id) s.vehicle_id, s.id, s.business_date, s.conductor_id, s.version_id
        FROM form_submissions s ${preopJoin}
        WHERE s.deleted_at IS NULL AND s.status = 'SUBMITTED' AND s.vehicle_id IS NOT NULL
        ORDER BY s.vehicle_id, s.business_date DESC, s.submitted_at DESC
      )
      SELECT u.vehicle_id AS vehiculo_id, ve.placa, u.id AS submission_id, u.business_date,
             trim(c.nombre || ' ' || c.apellido) AS conductor, f.key, f.label,
             (SELECT a2.value_text FROM form_answers a2 JOIN form_fields f2 ON f2.id = a2.field_id
               WHERE a2.submission_id = u.id AND f2.key = f.key || '_obs' LIMIT 1) AS observacion
      FROM ultimo u
      JOIN vehiculos ve ON ve.id = u.vehicle_id AND ve.deleted_at IS NULL
      LEFT JOIN conductores c ON c.id = u.conductor_id
      JOIN form_answers a ON a.submission_id = u.id
      JOIN form_answer_options ao ON ao.answer_id = a.id
      JOIN form_field_options o ON o.id = ao.option_id AND o.value = 'M'
      JOIN form_fields f ON f.id = a.field_id
      ORDER BY u.business_date DESC, ve.placa, f.sort_order`),
    // Mantenimientos del periodo (formato de recorridos)
    prisma.$queryRaw<Array<{ id: string; fecha: Date; placa: string | null; vehiculo_id: string | null; conductor: string; observaciones: string | null }>>(Prisma.sql`
      SELECT r.id, r.fecha, coalesce(r.mantenimiento_vehiculo_placa, ve.placa) AS placa, r.mantenimiento_vehiculo_id AS vehiculo_id,
             trim(c.nombre || ' ' || c.apellido) AS conductor, r.observaciones
      FROM registro_dia_laboral r
      JOIN conductores c ON c.id = r.conductor_id
      LEFT JOIN vehiculos ve ON ve.id = r.mantenimiento_vehiculo_id
      WHERE r.deleted_at IS NULL AND r.tipo = 'MANTENIMIENTO' AND r.fecha >= ${periodo.desde}::date AND r.fecha <= ${periodo.hasta}::date
      ORDER BY r.fecha DESC`),
    prisma.$queryRaw<Array<{ dia: string; n: number }>>(Prisma.sql`
      SELECT to_char(r.fecha, 'YYYY-MM-DD') AS dia, count(*)::int AS n
      FROM registro_dia_laboral r
      WHERE r.deleted_at IS NULL AND r.tipo = 'MANTENIMIENTO' AND r.fecha >= ${periodo.desde}::date AND r.fecha <= ${periodo.hasta}::date
      GROUP BY 1`),
    // Kilometraje: último km_final reportado en un preoperacional por placa; si no, el de la ficha
    prisma.$queryRaw<Array<{ vehiculo_id: string; placa: string; km: number; fecha: Date | null; fuente: string }>>(Prisma.sql`
      WITH preop AS (
        SELECT DISTINCT ON (s.vehicle_id) s.vehicle_id, a.value_decimal::float AS km, s.business_date
        FROM form_answers a
        JOIN form_fields f ON f.id = a.field_id AND f.key = 'km_final'
        JOIN form_submissions s ON s.id = a.submission_id ${preopJoin}
        WHERE s.deleted_at IS NULL AND s.status = 'SUBMITTED' AND s.vehicle_id IS NOT NULL AND a.value_decimal IS NOT NULL AND a.value_decimal > 0
        ORDER BY s.vehicle_id, s.business_date DESC, s.submitted_at DESC
      )
      SELECT ve.id AS vehiculo_id, ve.placa, coalesce(p.km, ve.kilometraje)::float AS km, p.business_date AS fecha,
             CASE WHEN p.km IS NOT NULL THEN 'preoperacional' ELSE 'ficha' END AS fuente
      FROM vehiculos ve LEFT JOIN preop p ON p.vehicle_id = ve.id
      WHERE ve.deleted_at IS NULL AND coalesce(p.km, ve.kilometraje) IS NOT NULL AND coalesce(p.km, ve.kilometraje) > 0
      ORDER BY 3 DESC LIMIT 12`),
    // Vencimientos de documentos del vehículo
    // Un documento por placa y categoría: el de vencimiento más lejano. Las
    // renovaciones se cargan como filas nuevas y las viejas quedan «vigentes»,
    // así que sin esto cada SOAT renovado contaría también como vencido.
    prisma.$queryRaw<Array<{ id: string; vehiculo_id: string; placa: string; categoria: string; vence: Date; dias: number }>>(Prisma.sql`
      WITH ultimo AS (
        SELECT DISTINCT ON (doc.vehiculo_id, doc.categoria) doc.id, doc.vehiculo_id, doc.categoria,
               coalesce(doc.fecha_vencimiento, doc.fecha_vigencia::date) AS vence
        FROM documento doc
        WHERE doc.deleted_at IS NULL AND doc.estado = 'vigente' AND doc.vehiculo_id IS NOT NULL
          AND doc.categoria IN (${Prisma.join(CATEGORIAS_VENCEN)})
          AND coalesce(doc.fecha_vencimiento, doc.fecha_vigencia::date) IS NOT NULL
        ORDER BY doc.vehiculo_id, doc.categoria, coalesce(doc.fecha_vencimiento, doc.fecha_vigencia::date) DESC
      )
      SELECT u.id, ve.id AS vehiculo_id, ve.placa, u.categoria, u.vence, (u.vence - current_date)::int AS dias
      FROM ultimo u JOIN vehiculos ve ON ve.id = u.vehiculo_id AND ve.deleted_at IS NULL AND ve.oculto = false
      WHERE u.vence <= current_date + ${PROXIMOS_DIAS}::int
      ORDER BY u.vence ASC, ve.placa`),
    prisma.$queryRaw<Array<{ n: number; placas: number }>>(Prisma.sql`
      SELECT count(*)::int AS n, count(DISTINCT s.vehicle_id)::int AS placas FROM form_submissions s ${preopJoin} WHERE ${enviosPeriodo}`),
  ])

  // ── Estado por vehículo: agrupar los ítems en Malo del último preoperacional ──
  const porVehiculo = new Map<string, { vehiculo_id: string; placa: string; submission_id: string; fecha: string; conductor: string | null; items: Array<{ key: string; label: string; observacion: string | null }> }>()
  for (const r of novedades) {
    const v = porVehiculo.get(r.vehiculo_id) ?? {
      vehiculo_id: r.vehiculo_id,
      placa: r.placa,
      submission_id: r.submission_id,
      fecha: r.business_date.toISOString().slice(0, 10),
      conductor: r.conductor,
      items: [],
    }
    v.items.push({ key: r.key, label: r.label.replace(/\s*\(.*$/, ''), observacion: r.observacion })
    porVehiculo.set(r.vehiculo_id, v)
  }
  const conNovedades = [...porVehiculo.values()].sort((a, b) => b.items.length - a.items.length || (a.fecha < b.fecha ? 1 : -1))

  // ── Vencimientos: vencidos vs próximos, por categoría ──
  const vencidos = vencimientos.filter((d) => d.dias < 0)
  const proximos = vencimientos.filter((d) => d.dias >= 0)
  const porCategoria = CATEGORIAS_VENCEN.map((c) => ({
    categoria: c,
    etiqueta: ETIQUETA_CATEGORIA[c] ?? c,
    vencidos: vencidos.filter((d) => d.categoria === c).length,
    proximos: proximos.filter((d) => d.categoria === c).length,
  })).filter((c) => c.vencidos || c.proximos)

  // ── Mantenimientos por placa y por día ──
  const mantPorPlaca = new Map<string, { placa: string; vehiculo_id: string | null; n: number }>()
  for (const m of mantenimientos) {
    const placa = m.placa ?? 'Sin placa'
    const e = mantPorPlaca.get(placa) ?? { placa, vehiculo_id: m.vehiculo_id, n: 0 }
    e.n += 1
    mantPorPlaca.set(placa, e)
  }
  const mantDia = new Map<string, number>()
  for (const d of diasDelPeriodo(periodo)) mantDia.set(d, 0)
  for (const r of mantPorDia) mantDia.set(r.dia, r.n)

  // ── Placa más propensa: novedades en preoperacionales + mantenimientos del periodo ──
  const propension = new Map<string, { placa: string; vehiculo_id: string | null; novedades: number; mantenimientos: number }>()
  for (const p of malosPorPlaca) propension.set(p.placa, { placa: p.placa, vehiculo_id: p.vehiculo_id, novedades: p.n, mantenimientos: 0 })
  for (const [placa, m] of mantPorPlaca) {
    const e = propension.get(placa) ?? { placa, vehiculo_id: m.vehiculo_id, novedades: 0, mantenimientos: 0 }
    e.mantenimientos = m.n
    propension.set(placa, e)
  }
  const propensas = [...propension.values()]
    .map((p) => ({ ...p, puntaje: p.novedades + p.mantenimientos * 3, enlace: p.vehiculo_id ? `/dashboard/flota/${p.vehiculo_id}` : null }))
    .sort((a, b) => b.puntaje - a.puntaje)
    .slice(0, 10)

  const cuenta = (estado: string) => vehiculosEstado.find((f) => f.estado === estado)?._count._all ?? 0

  return {
    kpis: {
      vehiculos_en_servicio: cuenta('servicio'),
      vehiculos_disponibles: cuenta('disponible'),
      vehiculos_mantenimiento: cuenta('mantenimiento'),
      preoperacionales: preopPeriodo[0]?.n ?? 0,
      placas_revisadas: preopPeriodo[0]?.placas ?? 0,
      con_novedades: conNovedades.length,
      mantenimientos: mantenimientos.length,
      documentos_vencidos: vencidos.length,
      documentos_proximos: proximos.length,
    },
    estado_vehiculos: conNovedades.slice(0, 20).map((v) => ({ ...v, enlace: `/dashboard/flota/${v.vehiculo_id}`, enlace_preoperacional: `/dashboard/formularios/envios/${v.submission_id}` })),
    items_malos: itemsMalos.map((i) => ({ ...i, label: i.label.replace(/\s*\(.*$/, '') })),
    placas_con_novedades: malosPorPlaca.map((p) => ({ ...p, enlace: `/dashboard/flota/${p.vehiculo_id}` })),
    propensas,
    mantenimientos: {
      total: mantenimientos.length,
      por_placa: [...mantPorPlaca.values()].sort((a, b) => b.n - a.n).map((m) => ({ ...m, enlace: m.vehiculo_id ? `/dashboard/flota/${m.vehiculo_id}` : null })),
      por_dia: [...mantDia.entries()].map(([fecha, n]) => ({ fecha, n })),
      ultimos: mantenimientos.slice(0, 10).map((m) => ({ ...m, fecha: m.fecha.toISOString().slice(0, 10), enlace: m.vehiculo_id ? `/dashboard/flota/${m.vehiculo_id}` : null })),
    },
    kilometraje: kilometraje.map((k) => ({ ...k, fecha: k.fecha ? k.fecha.toISOString().slice(0, 10) : null, enlace: `/dashboard/flota/${k.vehiculo_id}` })),
    vencimientos: {
      proximos_dias: PROXIMOS_DIAS,
      por_categoria: porCategoria,
      items: vencimientos.slice(0, 30).map((d) => ({ ...d, etiqueta: ETIQUETA_CATEGORIA[d.categoria] ?? d.categoria, vence: d.vence.toISOString().slice(0, 10), enlace: `/dashboard/flota/${d.vehiculo_id}` })),
    },
  }
}
