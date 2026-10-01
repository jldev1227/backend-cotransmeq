import { createHash } from 'node:crypto'

import { prisma } from '../../config/prisma'
import distracomLocations from '../../data/distracomlocations'

/**
 * Condiciones de la vía de un servicio para la app del conductor: la misma información que muestra el
 * detalle del servicio en la web (tráfico, incidentes, peajes, paradas, Distracom y riesgos de la
 * planilla), más la ruta con sus pasos para que la guía funcione sin red si el conductor ya la consultó.
 */

type Coordenada = [number, number] // [lng, lat]

export interface PasoRuta {
  instruccion: string
  distancia_m: number
  duracion_s: number
  lng: number
  lat: number
}

export interface IncidenteVia {
  id: string
  tipo: string
  descripcion: string
  impacto: string | null
  cerrada: boolean
  vias: string[]
  lng: number
  lat: number
}

export interface PuntoVia {
  nombre: string
  lng: number
  lat: number
}

export interface ParadaVia extends PuntoVia {
  tipo: 'restaurante' | 'estacion_servicio' | 'hospedaje'
}

export interface ObraVia extends PuntoVia {
  tipo: 'obra' | 'peligro' | 'bloqueo'
}

export interface EstacionDistracom extends PuntoVia {
  direccion: string
  ciudad: string
  departamento: string
  diesel: boolean
  gasolina: boolean
  hotel: boolean
  lubricentro: boolean
}

export type EstadoTrafico = 'fluido' | 'moderado' | 'congestionado' | 'critico' | 'sin_datos'

export interface CondicionesVia {
  servicio_id: string
  /** Cambia si el servicio cambia de origen, destino o datos: la app descarta lo guardado offline. */
  clave: string
  generado_en: string
  ruta: {
    coordinates: Coordenada[]
    distancia_m: number
    duracion_s: number
    duracion_tipica_s: number | null
    pasos: PasoRuta[]
  } | null
  trafico: { estado: EstadoTrafico; retraso_pct: number | null }
  incidentes: IncidenteVia[]
  obras: ObraVia[]
  peajes: PuntoVia[]
  paradas: ParadaVia[]
  distracom: EstacionDistracom[]
  vias: { trocha: boolean; afirmado: boolean; mixto: boolean; pavimentada: boolean }
  riesgos: {
    desniveles: boolean
    deslizamientos: boolean
    sin_senalizacion: boolean
    animales: boolean
    peatones: boolean
    trafico_alto: boolean
  }
}

export class CondicionesViaError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

const OVERPASS_API = 'https://overpass-api.de/api/interpreter'
// Overpass responde 406 a peticiones sin un User-Agent que identifique la aplicación (el de fetch de Node no sirve).
const OVERPASS_USER_AGENT = 'Cotransmeq-Conductores/1.0'
const DISTRACOM_DEPARTAMENTOS = ['cundinamarca', 'bogotá', 'bogota', 'boyacá', 'boyaca', 'meta', 'casanare', 'vichada']

// Criterios del detalle del servicio en la web (src/routes/dashboard/servicios/[id]/+page.svelte).
const PEAJE_MAX_KM_RUTA = 2
const PEAJE_EXCLUIR_KM_EXTREMOS = 10
const PARADA_MAX_KM_RUTA = 3
const PARADA_EXCLUIR_KM_EXTREMOS = 15
const PARADAS_MAX = 30
const DISTRACOM_MAX_GRADOS = 0.45
const DISTRACOM_MAX = 6
// Sobre la vía: más lejos suelen ser obras de otra vía o instalaciones (p. ej. petroleras).
const OBRA_MAX_KM_RUTA = 0.3
// OSM marca un punto por carril en cada peaje: se agrupan los del mismo nombre a menos de esto.
const PEAJE_AGRUPAR_KM = 1

// Peajes, paradas, Distracom y obras cambian poco; tráfico e incidentes, cada pocos minutos.
const TTL_ESTATICO_MS = 24 * 60 * 60 * 1000
const TTL_TRAFICO_MS = 5 * 60 * 1000

type CacheEntrada<T> = { expira: number; valor: T }
const cacheEstatico = new Map<string, CacheEntrada<Pick<CondicionesVia, 'peajes' | 'paradas' | 'distracom' | 'obras'>>>()
const cacheTrafico = new Map<string, CacheEntrada<Pick<CondicionesVia, 'ruta' | 'trafico' | 'incidentes'>>>()

function leerCache<T>(cache: Map<string, CacheEntrada<T>>, clave: string): T | null {
  const entrada = cache.get(clave)
  if (!entrada) return null
  if (entrada.expira < Date.now()) {
    cache.delete(clave)
    return null
  }
  return entrada.valor
}

function mapboxToken(): string {
  return process.env.VITE_MAPBOX_ACCESS_TOKEN || process.env.MAPBOX_ACCESS_TOKEN || ''
}

// ─── Geometría ────────────────────────────────────────────────────────

function kmEntre(a: Coordenada, b: Coordenada): number {
  const rad = (v: number) => (v * Math.PI) / 180
  const dLat = rad(b[1] - a[1])
  const dLng = rad(b[0] - a[0])
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

/** Distancia en km de un punto al tramo a-b (plano local, suficiente para tramos cortos). */
function kmAlTramo(p: Coordenada, a: Coordenada, b: Coordenada): number {
  const kmLng = 111.32 * Math.cos((p[1] * Math.PI) / 180)
  const kmLat = 110.54
  const ax = (a[0] - p[0]) * kmLng
  const ay = (a[1] - p[1]) * kmLat
  const bx = (b[0] - p[0]) * kmLng
  const by = (b[1] - p[1]) * kmLat
  const dx = bx - ax
  const dy = by - ay
  const largo2 = dx * dx + dy * dy
  const t = largo2 > 0 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / largo2)) : 0
  return Math.hypot(ax + t * dx, ay + t * dy)
}

function kmALaRuta(p: Coordenada, ruta: Coordenada[]): number {
  let minimo = Number.POSITIVE_INFINITY
  for (let i = 1; i < ruta.length; i += 1) {
    minimo = Math.min(minimo, kmAlTramo(p, ruta[i - 1], ruta[i]))
  }
  return minimo
}

function cajaDeRuta(ruta: Coordenada[], margenGrados: number) {
  const lngs = ruta.map((c) => c[0])
  const lats = ruta.map((c) => c[1])
  return {
    sur: Math.min(...lats) - margenGrados,
    oeste: Math.min(...lngs) - margenGrados,
    norte: Math.max(...lats) + margenGrados,
    este: Math.max(...lngs) + margenGrados
  }
}

// ─── Fuentes externas ─────────────────────────────────────────────────

interface RutaDirections {
  distance: number
  duration: number
  geometry: { coordinates: Coordenada[] }
  legs: Array<{
    steps?: Array<{ distance: number; duration: number; maneuver: { instruction: string; location: Coordenada } }>
    incidents?: Array<{
      id?: string
      type?: string
      description?: string
      impact?: string
      road_is_closed?: boolean
      affected_road_names?: string[]
      geometry_index_start?: number
      geometry_index_end?: number
    }>
  }>
}

async function directions(perfil: 'driving' | 'driving-traffic', origen: Coordenada, destino: Coordenada, completo: boolean) {
  const params = new URLSearchParams({ access_token: mapboxToken(), language: 'es', alternatives: 'false' })
  if (completo) {
    params.set('geometries', 'geojson')
    params.set('overview', 'full')
    params.set('steps', 'true')
    params.set('annotations', 'congestion')
  } else {
    params.set('overview', 'false')
  }
  const url = `https://api.mapbox.com/directions/v5/mapbox/${perfil}/${origen.join(',')};${destino.join(',')}?${params}`
  const response = await fetch(url, { signal: AbortSignal.timeout(12000) })
  if (!response.ok) throw new Error(`Mapbox Directions ${perfil}: HTTP ${response.status}`)
  const data = (await response.json()) as { routes?: RutaDirections[] }
  const ruta = data.routes?.[0]
  if (!ruta) throw new Error(`Mapbox Directions ${perfil}: sin ruta`)
  return ruta
}

async function overpass<T>(consulta: string, timeoutMs: number): Promise<T[]> {
  const response = await fetch(OVERPASS_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': OVERPASS_USER_AGENT },
    body: `data=${encodeURIComponent(consulta)}`,
    signal: AbortSignal.timeout(timeoutMs)
  })
  if (!response.ok) throw new Error(`Overpass: HTTP ${response.status}`)
  const data = (await response.json()) as { elements?: T[] }
  return data.elements ?? []
}

type ElementoOsm = { lat: number; lon: number; tags?: Record<string, string> }

function estadoPorRetraso(retrasoPct: number): EstadoTrafico {
  if (retrasoPct < 10) return 'fluido'
  if (retrasoPct < 30) return 'moderado'
  if (retrasoPct < 60) return 'congestionado'
  return 'critico'
}

async function rutaYTrafico(origen: Coordenada, destino: Coordenada): Promise<Pick<CondicionesVia, 'ruta' | 'trafico' | 'incidentes'>> {
  const [conTrafico, tipica] = await Promise.allSettled([
    directions('driving-traffic', origen, destino, true),
    directions('driving', origen, destino, false)
  ])
  if (conTrafico.status === 'rejected') {
    return { ruta: null, trafico: { estado: 'sin_datos', retraso_pct: null }, incidentes: [] }
  }
  const ruta = conTrafico.value
  const coordinates = ruta.geometry.coordinates
  const duracionTipica = tipica.status === 'fulfilled' ? tipica.value.duration : null
  const retrasoPct = duracionTipica && duracionTipica > 0
    ? Math.max(0, Math.round(((ruta.duration - duracionTipica) / duracionTipica) * 100))
    : null

  const incidentes: IncidenteVia[] = ruta.legs.flatMap((leg) => (leg.incidents ?? []).map((incidente, indice) => {
    // Igual que la web: el incidente se ubica en el punto medio del tramo afectado.
    const inicio = incidente.geometry_index_start ?? 0
    const fin = incidente.geometry_index_end ?? inicio
    const punto = coordinates[Math.min(coordinates.length - 1, Math.round((inicio + fin) / 2))] ?? coordinates[0]
    return {
      id: incidente.id ?? `incidente-${indice}`,
      tipo: incidente.type ?? 'incidente',
      descripcion: incidente.description ?? '',
      impacto: incidente.impact ?? null,
      cerrada: incidente.road_is_closed === true,
      vias: incidente.affected_road_names ?? [],
      lng: punto[0],
      lat: punto[1]
    }
  }))

  return {
    ruta: {
      coordinates,
      distancia_m: ruta.distance,
      duracion_s: ruta.duration,
      duracion_tipica_s: duracionTipica,
      pasos: ruta.legs.flatMap((leg) => (leg.steps ?? []).map((paso) => ({
        instruccion: paso.maneuver.instruction,
        distancia_m: paso.distance,
        duracion_s: paso.duration,
        lng: paso.maneuver.location[0],
        lat: paso.maneuver.location[1]
      })))
    },
    trafico: { estado: retrasoPct == null ? 'sin_datos' : estadoPorRetraso(retrasoPct), retraso_pct: retrasoPct },
    incidentes
  }
}

async function peajes(ruta: Coordenada[]): Promise<PuntoVia[]> {
  const caja = cajaDeRuta(ruta, 0.05)
  const bbox = `${caja.sur},${caja.oeste},${caja.norte},${caja.este}`
  const elementos = await overpass<ElementoOsm>(
    `[out:json][timeout:15];(node["barrier"="toll_booth"](${bbox});node["amenity"="toll_booth"](${bbox}););out body;`,
    15000
  )
  const origen = ruta[0]
  const destino = ruta[ruta.length - 1]
  const cercanos = elementos
    .map((el) => ({ nombre: el.tags?.name || 'Peaje', lng: el.lon, lat: el.lat }))
    .filter((p) => {
      const punto: Coordenada = [p.lng, p.lat]
      return kmALaRuta(punto, ruta) <= PEAJE_MAX_KM_RUTA
        && kmEntre(punto, origen) > PEAJE_EXCLUIR_KM_EXTREMOS
        && kmEntre(punto, destino) > PEAJE_EXCLUIR_KM_EXTREMOS
    })
  const unicos: PuntoVia[] = []
  for (const peaje of cercanos) {
    const repetido = unicos.some((u) => u.nombre === peaje.nombre && kmEntre([u.lng, u.lat], [peaje.lng, peaje.lat]) < PEAJE_AGRUPAR_KM)
    if (!repetido) unicos.push(peaje)
  }
  return unicos
}

async function paradas(ruta: Coordenada[]): Promise<ParadaVia[]> {
  const caja = cajaDeRuta(ruta, 0.04)
  const bbox = `${caja.sur},${caja.oeste},${caja.norte},${caja.este}`
  const elementos = await overpass<ElementoOsm>(
    `[out:json][timeout:20];(node["amenity"="restaurant"](${bbox});node["amenity"="fuel"](${bbox});node["tourism"="hotel"](${bbox});node["tourism"="hostel"](${bbox});node["tourism"="guest_house"](${bbox}););out body;`,
    20000
  )
  const origen = ruta[0]
  const destino = ruta[ruta.length - 1]
  return elementos
    .map((el): ParadaVia => {
      const tipo: ParadaVia['tipo'] = el.tags?.amenity === 'fuel'
        ? 'estacion_servicio'
        : el.tags?.tourism ? 'hospedaje' : 'restaurante'
      const generico = tipo === 'restaurante' ? 'Restaurante' : tipo === 'estacion_servicio' ? 'Estación de servicio' : 'Hospedaje'
      return { tipo, nombre: el.tags?.name || generico, lng: el.lon, lat: el.lat }
    })
    .filter((p) => {
      const punto: Coordenada = [p.lng, p.lat]
      return kmALaRuta(punto, ruta) <= PARADA_MAX_KM_RUTA
        && kmEntre(punto, origen) > PARADA_EXCLUIR_KM_EXTREMOS
        && kmEntre(punto, destino) > PARADA_EXCLUIR_KM_EXTREMOS
    })
    .slice(0, PARADAS_MAX)
}

async function obras(ruta: Coordenada[]): Promise<ObraVia[]> {
  const caja = cajaDeRuta(ruta, 0.02)
  const bbox = `${caja.sur},${caja.oeste},${caja.norte},${caja.este}`
  const elementos = await overpass<ElementoOsm & { geometry?: Array<{ lat: number; lon: number }> }>(
    // Solo obras en vías de tránsito. Sin node["construction"] ni construction=service (la web sí los
    // consulta): en los Llanos traen sobre todo instalaciones y vías de servicio petroleras.
    `[out:json][timeout:20];(way["highway"="construction"]["construction"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|road)(_link)?$"](${bbox});node["hazard"](${bbox});node["barrier"="block"](${bbox});node["barrier"="jersey_barrier"](${bbox}););out geom tags;`,
    20000
  )
  return elementos
    .map((el): ObraVia | null => {
      // Un tramo en obra se ubica en su punto más cercano a la ruta; un nodo, en sí mismo.
      const puntos: Coordenada[] = el.geometry?.length
        ? el.geometry.map((g) => [g.lon, g.lat] as Coordenada)
        : el.lat != null && el.lon != null ? [[el.lon, el.lat]] : []
      if (!puntos.length) return null
      const [punto, km] = puntos
        .map((c) => [c, kmALaRuta(c, ruta)] as const)
        .reduce((mejor, actual) => (actual[1] < mejor[1] ? actual : mejor))
      if (km > OBRA_MAX_KM_RUTA) return null
      const tipo: ObraVia['tipo'] = el.tags?.hazard ? 'peligro' : el.tags?.barrier ? 'bloqueo' : 'obra'
      const generico = tipo === 'peligro' ? 'Peligro en la vía' : tipo === 'bloqueo' ? 'Bloqueo' : 'Obra en la vía'
      return { tipo, nombre: el.tags?.name || el.tags?.hazard || generico, lng: punto[0], lat: punto[1] }
    })
    .filter((o): o is ObraVia => o != null)
}

function estacionesDistracom(ruta: Coordenada[]): EstacionDistracom[] {
  const caja = cajaDeRuta(ruta, 0.5)
  const estaciones: EstacionDistracom[] = []
  for (const raw of distracomLocations as any[]) {
    const departamento = String(raw.Departamento || '').toLowerCase().trim()
    const lat = Number(raw.Latitud)
    const lng = Number(raw.Longitud)
    if (!DISTRACOM_DEPARTAMENTOS.includes(departamento)) continue
    if (lat < caja.sur || lat > caja.norte || lng < caja.oeste || lng > caja.este) continue
    const cercana = ruta.some((c) => Math.abs(lat - c[1]) < DISTRACOM_MAX_GRADOS && Math.abs(lng - c[0]) < DISTRACOM_MAX_GRADOS)
    if (!cercana) continue
    const servicios: string[] = (raw.Servicios || []).map((s: any) => String(s.Nombre || '').toLowerCase())
    estaciones.push({
      nombre: raw.NombreEstacion || 'Estación Distracom',
      direccion: raw.Direccion || '',
      ciudad: raw.Ciudad || '',
      departamento: raw.Departamento || '',
      lng,
      lat,
      diesel: (raw.DIESEL ?? 0) > 0,
      gasolina: (raw.CORRIENTE ?? 0) > 0 || (raw.PREMIUM ?? 0) > 0,
      hotel: raw.Hotel === true,
      lubricentro: servicios.some((s) => s.includes('lubricentro'))
    })
  }
  // Las más cercanas a la ruta primero.
  return estaciones
    .map((e) => ({ e, km: kmALaRuta([e.lng, e.lat], ruta) }))
    .sort((a, b) => a.km - b.km)
    .slice(0, DISTRACOM_MAX)
    .map(({ e }) => e)
}

async function sinFallar<T>(etiqueta: string, tarea: () => Promise<T>, vacio: T): Promise<{ valor: T; fallo: boolean }> {
  try {
    return { valor: await tarea(), fallo: false }
  } catch (error: any) {
    console.warn(`[CondicionesVia] ${etiqueta}: ${error?.message ?? error}`)
    return { valor: vacio, fallo: true }
  }
}

// ─── Servicio ─────────────────────────────────────────────────────────

export async function condicionesViaDelServicio(servicioId: string, conductorId: string): Promise<CondicionesVia> {
  const servicio = await prisma.servicio.findFirst({
    where: { id: servicioId, conductor_id: conductorId, deleted_at: null },
    select: {
      id: true,
      updated_at: true,
      origen_latitud: true,
      origen_longitud: true,
      destino_latitud: true,
      destino_longitud: true,
      municipios_servicio_origen_idTomunicipios: { select: { latitud: true, longitud: true } },
      municipios_servicio_destino_idTomunicipios: { select: { latitud: true, longitud: true } },
      recargos_planillas: { take: 1, orderBy: { created_at: 'desc' } }
    }
  })
  if (!servicio) throw new CondicionesViaError('Servicio no encontrado', 404)

  // Igual que el rutograma: coordenadas del servicio y, si faltan, las del municipio.
  const municipioOrigen = servicio.municipios_servicio_origen_idTomunicipios
  const municipioDestino = servicio.municipios_servicio_destino_idTomunicipios
  const numero = (v: unknown) => (v == null ? null : Number(v))
  const origenLat = numero(servicio.origen_latitud) ?? numero(municipioOrigen?.latitud)
  const origenLng = numero(servicio.origen_longitud) ?? numero(municipioOrigen?.longitud)
  const destinoLat = numero(servicio.destino_latitud) ?? numero(municipioDestino?.latitud)
  const destinoLng = numero(servicio.destino_longitud) ?? numero(municipioDestino?.longitud)
  if (origenLat == null || origenLng == null || destinoLat == null || destinoLng == null) {
    throw new CondicionesViaError('El servicio no tiene origen y destino georreferenciados', 422)
  }
  const origen: Coordenada = [origenLng, origenLat]
  const destino: Coordenada = [destinoLng, destinoLat]

  const planilla = servicio.recargos_planillas[0] as any
  const clave = createHash('sha256')
    .update(JSON.stringify([origen, destino, servicio.updated_at?.toISOString() ?? '', planilla?.updated_at ?? null]))
    .digest('hex')
    .slice(0, 16)
  const claveRuta = `${origen.join(',')};${destino.join(',')}`

  let dinamico = leerCache(cacheTrafico, claveRuta)
  if (!dinamico) {
    dinamico = await rutaYTrafico(origen, destino)
    if (dinamico.ruta) cacheTrafico.set(claveRuta, { expira: Date.now() + TTL_TRAFICO_MS, valor: dinamico })
  }

  let estatico = leerCache(cacheEstatico, claveRuta)
  const coordenadas = dinamico.ruta?.coordinates
  if (!estatico && coordenadas && coordenadas.length >= 2) {
    // Overpass rechaza consultas en paralelo desde la misma IP: van una tras otra.
    const listaPeajes = await sinFallar('peajes', () => peajes(coordenadas), [] as PuntoVia[])
    const listaParadas = await sinFallar('paradas', () => paradas(coordenadas), [] as ParadaVia[])
    const listaObras = await sinFallar('obras', () => obras(coordenadas), [] as ObraVia[])
    estatico = {
      peajes: listaPeajes.valor,
      paradas: listaParadas.valor,
      obras: listaObras.valor,
      distracom: estacionesDistracom(coordenadas)
    }
    // Si Overpass falló, se reintenta pronto en vez de guardar listas vacías todo el día.
    const alguno = listaPeajes.fallo || listaParadas.fallo || listaObras.fallo
    cacheEstatico.set(claveRuta, { expira: Date.now() + (alguno ? TTL_TRAFICO_MS : TTL_ESTATICO_MS), valor: estatico })
  }

  return {
    servicio_id: servicio.id,
    clave,
    generado_en: new Date().toISOString(),
    ...dinamico,
    peajes: estatico?.peajes ?? [],
    paradas: estatico?.paradas ?? [],
    obras: estatico?.obras ?? [],
    distracom: estatico?.distracom ?? [],
    vias: {
      trocha: planilla?.via_trocha ?? false,
      afirmado: planilla?.via_afirmado ?? false,
      mixto: planilla?.via_mixto ?? false,
      pavimentada: planilla?.via_pavimentada ?? false
    },
    riesgos: {
      desniveles: planilla?.riesgo_desniveles ?? false,
      deslizamientos: planilla?.riesgo_deslizamientos ?? false,
      sin_senalizacion: planilla?.riesgo_sin_senalizacion ?? false,
      animales: planilla?.riesgo_animales ?? false,
      peatones: planilla?.riesgo_peatones ?? false,
      trafico_alto: planilla?.riesgo_trafico_alto ?? false
    }
  }
}
