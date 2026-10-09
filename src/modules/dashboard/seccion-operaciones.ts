/**
 * Sección «Operaciones» del panel.
 *
 * Dos clases de cifras conviven aquí y la UI las separa:
 *  - las del PERIODO elegido (servicios, clientes, horas): cuentan por
 *    `fecha_realizacion`;
 *  - las de AHORA (quién está en servicio, qué falta por cerrar o por
 *    registrar): no dependen del periodo, porque son la lista de pendientes.
 *
 * Las agregaciones van en SQL (hora y día en Bogotá se resuelven en la base);
 * las listas cortas, también, para traer cliente, conductor y placa de una.
 */
import { Prisma } from '@prisma/client'
import { prisma } from '../../config/prisma'
import type { ContextoSeccion } from './dashboard.routes'
import { diasDelPeriodo, type Periodo } from './periodo'

export const SIN_CERRAR_DIAS = 7

function etiquetaEstado(e: string): string {
  const s = e.replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** `(año, mes) IN ((2026, 9), (2026, 10))` para las tablas que guardan año y mes. */
export function enMeses(col: Prisma.Sql, p: Periodo): Prisma.Sql {
  const pares = p.meses.map((m) => Prisma.sql`(${m.anio}, ${m.mes})`)
  return Prisma.sql`${col} IN (${Prisma.join(pares)})`
}

/** Media circular de horas del día: 23:00 y 01:00 promedian 00:00, no 12:00. */
export function horaPromedio(distribucion: number[]): { hora: number; minuto: number; etiqueta: string } | null {
  let x = 0
  let y = 0
  let n = 0
  distribucion.forEach((c, h) => {
    const ang = ((h + 0.5) / 24) * 2 * Math.PI
    x += Math.cos(ang) * c
    y += Math.sin(ang) * c
    n += c
  })
  if (n === 0) return null
  let ang = Math.atan2(y, x)
  if (ang < 0) ang += 2 * Math.PI
  const horas = (ang / (2 * Math.PI)) * 24
  const hora = Math.floor(horas) % 24
  const minuto = Math.round((horas - Math.floor(horas)) * 60) % 60
  return { hora, minuto, etiqueta: `${String(hora).padStart(2, '0')}:${String(minuto).padStart(2, '0')}` }
}

/** Ventana de 3 horas seguidas con más actividad. */
export function picoDe(distribucion: number[], ancho = 3): { desde: number; hasta: number; total: number } | null {
  if (distribucion.every((v) => v === 0)) return null
  let mejor = { desde: 0, hasta: ancho, total: -1 }
  for (let h = 0; h < 24; h++) {
    let total = 0
    for (let k = 0; k < ancho; k++) total += distribucion[(h + k) % 24]
    if (total > mejor.total) mejor = { desde: h, hasta: (h + ancho) % 24, total }
  }
  return mejor
}

/**
 * Cobertura por hora de las jornadas (hora_inicio..hora_fin decimales de las
 * planillas): cuántas jornadas estaban en marcha en cada hora del día.
 */
export function coberturaHoraria(jornadas: Array<{ hi: number; hf: number }>): number[] {
  const cob = new Array<number>(24).fill(0)
  for (const { hi, hf } of jornadas) {
    if (!Number.isFinite(hi) || !Number.isFinite(hf)) continue
    let ini = Math.max(0, Math.floor(hi))
    let fin = Math.ceil(hf)
    if (fin <= ini) fin += 24 // cruza medianoche
    if (fin - ini > 24) fin = ini + 24
    for (let h = ini; h < fin; h++) cob[h % 24] += 1
  }
  return cob
}

/** `'06:30'` → 6.5; `null` si no es una hora. */
function horaDecimal(hhmm: string | null): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm ?? '')
  if (!m) return null
  return Number(m[1]) + Number(m[2]) / 60
}

/**
 * Jornadas con hora de inicio y fin del periodo, para la cobertura horaria.
 *
 * Dos fuentes, porque llegan en momentos distintos: las planillas de recargos
 * las carga operaciones cuando liquida el mes, y los recorridos los registra
 * el conductor cada día. Se prefieren las planillas (son las que pagan) y,
 * si el periodo aún no tiene planillas con horas, se usan los recorridos.
 * No se mezclan para no contar dos veces la misma jornada.
 */
export async function jornadasDelPeriodo(
  periodo: Periodo,
  modulos: Record<string, unknown>
): Promise<{ jornadas: Array<{ hi: number; hf: number }>; fuente: 'planillas' | 'recorridos' | null }> {
  if (modulos['recargos']) {
    const filas = await prisma.$queryRaw<Array<{ hi: number; hf: number }>>(Prisma.sql`
      SELECT d.hora_inicio::float AS hi, d.hora_fin::float AS hf
      FROM dias_laborales_planillas d JOIN recargos_planillas p ON p.id = d.recargo_planilla_id
      WHERE d.deleted_at IS NULL AND p.deleted_at IS NULL AND d.hora_inicio IS NOT NULL AND d.hora_fin IS NOT NULL
        AND ${enMeses(Prisma.sql`(p."año", p.mes)`, periodo)}`)
    if (filas.length) return { jornadas: filas, fuente: 'planillas' }
  }
  if (modulos['recorridos']) {
    const filas = await prisma.$queryRaw<Array<{ hora_inicio: string | null; hora_fin: string | null; offset_fin: number }>>(Prisma.sql`
      SELECT s.hora_inicio, s.hora_fin, coalesce(s.dias_offset_fin, 0)::int AS offset_fin
      FROM registro_dia_laboral r JOIN registro_dia_laboral_segmento s ON s.registro_dia_id = r.id AND s.deleted_at IS NULL
      WHERE r.deleted_at IS NULL AND r.fecha >= ${periodo.desde}::date AND r.fecha <= ${periodo.hasta}::date
        AND s.hora_inicio IS NOT NULL AND s.hora_fin IS NOT NULL`)
    const jornadas: Array<{ hi: number; hf: number }> = []
    for (const f of filas) {
      const hi = horaDecimal(f.hora_inicio)
      const hf = horaDecimal(f.hora_fin)
      if (hi === null || hf === null) continue
      jornadas.push({ hi, hf: hf + 24 * f.offset_fin })
    }
    if (jornadas.length) return { jornadas, fuente: 'recorridos' }
  }
  return { jornadas: [], fuente: null }
}

export async function seccionOperaciones(ctx: ContextoSeccion): Promise<Record<string, unknown>> {
  const { periodo, modulos } = ctx
  const { inicio, fin } = periodo
  const rango = Prisma.sql`s.deleted_at IS NULL AND s.fecha_realizacion >= ${inicio} AND s.fecha_realizacion < ${fin}`

  const [porEstado, porDia, porHora, conductores, vehiculos, clientes, sinCerrar, sinCerrarTotal] = await Promise.all([
    prisma.$queryRaw<Array<{ estado: string; cantidad: number; valor: number }>>(Prisma.sql`
      SELECT s.estado::text AS estado, count(*)::int AS cantidad, coalesce(sum(s.valor), 0)::float AS valor
      FROM servicios s WHERE ${rango} GROUP BY 1`),
    prisma.$queryRaw<Array<{ dia: string; estado: string; n: number }>>(Prisma.sql`
      SELECT to_char(s.fecha_realizacion AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD') AS dia, s.estado::text AS estado, count(*)::int AS n
      FROM servicios s WHERE ${rango} GROUP BY 1, 2`),
    prisma.$queryRaw<Array<{ h: number; n: number }>>(Prisma.sql`
      SELECT extract(hour FROM s.fecha_realizacion AT TIME ZONE 'America/Bogota')::int AS h, count(*)::int AS n
      FROM servicios s WHERE ${rango} GROUP BY 1`),
    prisma.conductores.groupBy({ by: ['estado'], where: { deleted_at: null }, _count: { _all: true } }),
    prisma.vehiculos.groupBy({ by: ['estado'], where: { deleted_at: null }, _count: { _all: true } }),
    prisma.$queryRaw<Array<{ id: string; nombre: string | null; servicios: number; valor: number }>>(Prisma.sql`
      SELECT e.id, e.nombre, count(*)::int AS servicios, coalesce(sum(s.valor), 0)::float AS valor
      FROM servicios s JOIN empresas e ON e.id = s.cliente_id
      WHERE ${rango} AND s.estado <> 'cancelado'
      GROUP BY 1, 2 ORDER BY 3 DESC, 4 DESC LIMIT 8`),
    prisma.$queryRaw<Array<{ id: string; fecha_realizacion: Date; cliente: string | null; conductor: string | null; placa: string | null; origen: string; destino: string }>>(Prisma.sql`
      SELECT s.id, s.fecha_realizacion, e.nombre AS cliente, trim(c.nombre || ' ' || c.apellido) AS conductor, v.placa,
             s.origen_especifico AS origen, s.destino_especifico AS destino
      FROM servicios s
      LEFT JOIN empresas e ON e.id = s.cliente_id
      LEFT JOIN conductores c ON c.id = s.conductor_id
      LEFT JOIN vehiculos v ON v.id = s.vehiculo_id
      WHERE s.deleted_at IS NULL AND s.estado = 'en_curso' AND s.fecha_realizacion < now() - make_interval(days => ${SIN_CERRAR_DIAS}::int)
      ORDER BY s.fecha_realizacion ASC LIMIT 20`),
    prisma.servicio.count({ where: { deleted_at: null, estado: 'en_curso', fecha_realizacion: { lt: new Date(Date.now() - SIN_CERRAR_DIAS * 86400000) } } }),
  ])

  // ── Serie por día, sin huecos ──────────────────────────────────────────
  const porDiaMapa = new Map<string, { realizados: number; planificados: number; en_curso: number; cancelados: number; total: number }>()
  for (const d of diasDelPeriodo(periodo)) porDiaMapa.set(d, { realizados: 0, planificados: 0, en_curso: 0, cancelados: 0, total: 0 })
  for (const r of porDia) {
    const fila = porDiaMapa.get(r.dia)
    if (!fila) continue
    if (r.estado === 'realizado' || r.estado === 'liquidado' || r.estado === 'planilla_asignada') fila.realizados += r.n
    else if (r.estado === 'planificado' || r.estado === 'solicitado' || r.estado === 'pendiente') fila.planificados += r.n
    else if (r.estado === 'en_curso') fila.en_curso += r.n
    else if (r.estado === 'cancelado') fila.cancelados += r.n
    fila.total += r.n
  }

  const distribucionHoras = new Array<number>(24).fill(0)
  for (const r of porHora) distribucionHoras[r.h] = r.n

  const cuenta = (filas: Array<{ estado: string; _count: { _all: number } }>, estado: string) =>
    filas.find((f) => f.estado === estado)?._count._all ?? 0

  const data: Record<string, unknown> = {
    kpis: {
      servicios: porEstado.reduce((a, r) => a + r.cantidad, 0),
      valor: porEstado.reduce((a, r) => a + r.valor, 0),
      por_estado: porEstado
        .map((r) => ({ estado: r.estado, etiqueta: etiquetaEstado(r.estado), cantidad: r.cantidad, valor: r.valor }))
        .sort((a, b) => b.cantidad - a.cantidad),
      ahora: {
        conductores_en_servicio: cuenta(conductores, 'servicio'),
        conductores_programados: cuenta(conductores, 'programado'),
        conductores_disponibles: cuenta(conductores, 'disponible'),
        vehiculos_en_servicio: cuenta(vehiculos, 'servicio'),
        vehiculos_programados: cuenta(vehiculos, 'programado'),
        vehiculos_disponibles: cuenta(vehiculos, 'disponible'),
        vehiculos_mantenimiento: cuenta(vehiculos, 'mantenimiento'),
      },
    },
    servicios_por_dia: [...porDiaMapa.entries()].map(([fecha, v]) => ({ fecha, ...v })),
    hora_realizacion: {
      distribucion: distribucionHoras,
      promedio: horaPromedio(distribucionHoras),
      pico: picoDe(distribucionHoras),
    },
    clientes_frecuentes: clientes.map((c) => ({ ...c, nombre: c.nombre ?? 'Sin nombre', enlace: `/dashboard/clientes/${c.id}` })),
    sin_cerrar: {
      total: sinCerrarTotal,
      dias: SIN_CERRAR_DIAS,
      items: sinCerrar.map((s) => ({
        ...s,
        dias: Math.floor((Date.now() - s.fecha_realizacion.getTime()) / 86400000),
        enlace: `/dashboard/servicios/${s.id}`,
      })),
    },
  }

  // ── Widgets que leen de otros módulos ──────────────────────────────────
  if (modulos['recargos']) {
    const [planillas, planillasTotal] = await Promise.all([
      prisma.$queryRaw<Array<{ id: string; anio: number; mes: number; numero_planilla: string | null; conductor: string; placa: string; cliente: string | null }>>(Prisma.sql`
        SELECT p.id, p."año" AS anio, p.mes, p.numero_planilla, trim(c.nombre || ' ' || c.apellido) AS conductor, v.placa, e.nombre AS cliente
        FROM recargos_planillas p
        JOIN conductores c ON c.id = p.conductor_id
        JOIN vehiculos v ON v.id = p.vehiculo_id
        JOIN empresas e ON e.id = p.empresa_id
        WHERE p.deleted_at IS NULL AND p.estado = 'pendiente' AND ${enMeses(Prisma.sql`(p."año", p.mes)`, periodo)}
          AND NOT EXISTS (SELECT 1 FROM dias_laborales_planillas d WHERE d.recargo_planilla_id = p.id AND d.deleted_at IS NULL)
        ORDER BY p."año" DESC, p.mes DESC, c.nombre LIMIT 50`),
      prisma.$queryRaw<Array<{ n: number }>>(Prisma.sql`
        SELECT count(*)::int AS n FROM recargos_planillas p
        WHERE p.deleted_at IS NULL AND p.estado = 'pendiente' AND ${enMeses(Prisma.sql`(p."año", p.mes)`, periodo)}
          AND NOT EXISTS (SELECT 1 FROM dias_laborales_planillas d WHERE d.recargo_planilla_id = p.id AND d.deleted_at IS NULL)`),
    ])
    data.planillas_sin_dias = {
      total: planillasTotal[0]?.n ?? 0,
      items: planillas.map((p) => ({ ...p, enlace: `/dashboard/recargos?planilla=${p.id}` })),
    }
  }

  if (modulos['recargos'] || modulos['recorridos']) {
    const { jornadas, fuente } = await jornadasDelPeriodo(periodo, modulos)
    const cobertura = coberturaHoraria(jornadas)
    data.horas_laboradas = { jornadas: jornadas.length, fuente, cobertura, pico: picoDe(cobertura) }
  }

  if (modulos['liquidaciones-servicios']) {
    const PENDIENTES = ['BORRADOR', 'LIQUIDADA', 'APROBADA']
    const [porEstadoLiq, ultimas] = await Promise.all([
      prisma.$queryRaw<Array<{ estado: string; cantidad: number; valor: number }>>(Prisma.sql`
        SELECT l.estado::text AS estado, count(*)::int AS cantidad, coalesce(sum(l.total), 0)::float AS valor
        FROM liquidacion_servicio l WHERE l.deleted_at IS NULL AND l.estado::text IN (${Prisma.join(PENDIENTES)}) GROUP BY 1`),
      prisma.$queryRaw<Array<{ id: string; consecutivo: string; estado: string; total: number; mes: number; anio: number; cliente: string | null; updated_at: Date }>>(Prisma.sql`
        SELECT l.id, l.consecutivo, l.estado::text AS estado, l.total::float AS total, l.mes, l.anio, e.nombre AS cliente, l.updated_at
        FROM liquidacion_servicio l JOIN empresas e ON e.id = l.cliente_id
        WHERE l.deleted_at IS NULL AND l.estado::text IN (${Prisma.join(PENDIENTES)})
        ORDER BY l.updated_at DESC LIMIT 8`),
    ])
    data.liquidaciones_pendientes = {
      por_estado: PENDIENTES.map((e) => {
        const r = porEstadoLiq.find((x) => x.estado === e)
        return { estado: e, cantidad: r?.cantidad ?? 0, valor: r?.valor ?? 0 }
      }),
      ultimas: ultimas.map((l) => ({ ...l, enlace: `/dashboard/liquidaciones-servicios/${l.id}` })),
    }
  }

  return data
}
