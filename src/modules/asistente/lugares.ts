import { Prisma } from '@prisma/client'
import { prisma } from '../../config/prisma'

/**
 * Lugares específicos (pozo, campamento, base, hotel…) con coordenadas.
 *
 * Dos fuentes, en este orden:
 *  1. `custom_places`: lugares guardados a propósito, con coordenadas exactas.
 *  2. El HISTORIAL de servicios: `origen_especifico` / `destino_especifico` con
 *     sus `*_latitud` / `*_longitud`. Es la fuente grande (≈60 % de los
 *     servicios traen coordenadas) y la que convierte «Pozo Jacana» en un lugar
 *     conocido sin que nadie lo haya dado de alta.
 *
 * Cuando el asistente crea un servicio en un lugar nuevo y el usuario da las
 * coordenadas, se guarda también en `custom_places` (`guardarLugar`), así la
 * próxima vez sale por la fuente 1 y el modal de la app lo encuentra igual.
 */
export interface LugarFrecuente {
  nombre: string
  veces: number
  latitud: number | null
  longitud: number | null
  fuente: 'guardado' | 'historial'
  categoria?: string | null
}

export function normalizarLugar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Busca lugares cuyo nombre contenga `texto`. Si se pasa `municipioId`, el
 * historial se limita a servicios con ese municipio en el mismo lado (origen o
 * destino); si con el filtro no sale nada, se repite sin él, porque un pozo se
 * escribe igual aunque alguien haya puesto otro municipio.
 */
export async function buscarLugares(texto: string, municipioId?: string, limite = 8): Promise<LugarFrecuente[]> {
  const q = texto.trim()
  if (!q) return []

  const guardados = await prisma.custom_places.findMany({
    where: { activo: true, deleted_at: null, nombre: { contains: q, mode: 'insensitive' } },
    select: { nombre: true, categoria: true, latitud: true, longitud: true, veces_usado: true },
    orderBy: [{ veces_usado: 'desc' }, { nombre: 'asc' }],
    take: limite,
  })

  let historial = await historialLugares(q, municipioId, limite)
  if (historial.length === 0 && municipioId) historial = await historialLugares(q, undefined, limite)

  const salida: LugarFrecuente[] = guardados.map((g) => ({
    nombre: g.nombre,
    veces: g.veces_usado,
    latitud: Number(g.latitud),
    longitud: Number(g.longitud),
    fuente: 'guardado',
    categoria: g.categoria,
  }))
  const vistos = new Set(salida.map((s) => normalizarLugar(s.nombre)))
  for (const h of historial) {
    if (vistos.has(normalizarLugar(h.nombre))) continue
    vistos.add(normalizarLugar(h.nombre))
    salida.push(h)
  }
  return salida.slice(0, limite)
}

async function historialLugares(q: string, municipioId: string | undefined, limite: number): Promise<LugarFrecuente[]> {
  const patron = `%${q.replace(/[%_]/g, '')}%`
  const filas = await prisma.$queryRaw<
    { nombre: string; veces: number; latitud: number | null; longitud: number | null; con_coords: number }[]
  >(Prisma.sql`
    SELECT min(nombre) AS nombre,
           count(*)::int AS veces,
           avg(lat)::float AS latitud,
           avg(lng)::float AS longitud,
           count(lat)::int AS con_coords
    FROM (
      SELECT origen_especifico AS nombre, origen_latitud AS lat, origen_longitud AS lng
      FROM servicios
      WHERE deleted_at IS NULL AND origen_especifico <> '' AND origen_especifico ILIKE ${patron}
        AND (${municipioId ?? null}::uuid IS NULL OR origen_id = ${municipioId ?? null}::uuid)
      UNION ALL
      SELECT destino_especifico, destino_latitud, destino_longitud
      FROM servicios
      WHERE deleted_at IS NULL AND destino_especifico <> '' AND destino_especifico ILIKE ${patron}
        AND (${municipioId ?? null}::uuid IS NULL OR destino_id = ${municipioId ?? null}::uuid)
    ) t
    GROUP BY lower(trim(nombre))
    ORDER BY veces DESC, nombre ASC
    LIMIT ${limite}
  `)
  return filas.map((f) => ({
    nombre: f.nombre,
    veces: f.veces,
    latitud: f.con_coords > 0 ? f.latitud : null,
    longitud: f.con_coords > 0 ? f.longitud : null,
    fuente: 'historial',
  }))
}

/** Un lugar cuyo nombre normalizado es exactamente `texto`, si existe. */
export function coincidenciaExacta(lugares: LugarFrecuente[], texto: string): LugarFrecuente | undefined {
  const q = normalizarLugar(texto)
  return lugares.find((l) => normalizarLugar(l.nombre) === q)
}

export function coordenadasValidas(lat: unknown, lng: unknown): { lat: number; lng: number } | null {
  const la = Number(lat)
  const lo = Number(lng)
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return null
  if (la < -90 || la > 90 || lo < -180 || lo > 180) return null
  return { lat: Number(la.toFixed(6)), lng: Number(lo.toFixed(6)) }
}

/**
 * Guarda un lugar nuevo con coordenadas para que lo encuentren el asistente y
 * el modal la próxima vez. Si ya hay uno con ese nombre, no duplica.
 */
export async function guardarLugar(
  nombre: string,
  coords: { lat: number; lng: number },
  municipioId: string | undefined,
  usuarioId: string,
): Promise<boolean> {
  const existente = await prisma.custom_places.findFirst({
    where: { deleted_at: null, nombre: { equals: nombre.trim(), mode: 'insensitive' } },
    select: { id: true },
  })
  if (existente) return false
  await prisma.custom_places.create({
    data: {
      nombre: nombre.trim(),
      latitud: coords.lat,
      longitud: coords.lng,
      municipio_id: municipioId,
      creado_por_id: usuarioId,
      veces_usado: 1,
    },
  })
  return true
}
