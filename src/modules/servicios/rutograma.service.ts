import { prisma } from '../../config/prisma'
import { getS3SignedUrl } from '../../config/aws'
import distracomLocations from '../../data/distracomlocations'
import { pdfFromHtml } from '../../services/pdf.service'
import { buildFontsCss } from '../liquidaciones-terceros-pdf/fonts'
import {
  renderRutogramaHtml,
  type DatosRutograma,
  type FirmaRutograma,
  type PuntoRuta,
  type TramoVia,
} from './rutograma.template'

/**
 * Rutograma de un servicio.
 *
 * Este servicio REÚNE los datos (servicio y relaciones, ruta por carretera
 * con Mapbox, peajes y paradas con Overpass, estaciones Distracom del JSON
 * local, firmas de Operaciones y HSEQ) y los entrega a la plantilla HTML de
 * `rutograma.template.ts`, que Chromium convierte en PDF con `pdfFromHtml`.
 *
 * Antes dibujaba el PDF con pdfkit coordenada a coordenada; la maquetación
 * vive ahora en la plantilla, con el mismo lenguaje visual que el
 * desprendible de nómina.
 */

interface PeajeInfo {
  nombre: string
  lat: number
  lon: number
}

interface DistracomEstacion {
  nombre: string
  direccion: string
  ciudad: string
  departamento: string
  lat: number
  lon: number
  diesel: boolean
  gasolina: boolean
  hotel: boolean
  lubricentro: boolean
}

interface ParadaSeguraInfo {
  nombre: string
  tipo: 'restaurante' | 'estacion_servicio' | 'hospedaje'
  lat: number
  lon: number
}

interface RutaCalculada {
  geometry: any
  distance: number
  duration: number
  tramos: TramoVia[]
}

interface Coordenadas {
  lat: number
  lng: number
}

/** Color del trazado y del pin de origen en el mapa: el naranja de marca. */
const COLOR_RUTA = 'ea580c'

const EMPRESA = {
  nombre: 'COOPERATIVA DE TRANSPORTADORES DEL META Y CASANARE',
  nit: '892099216-1',
}

const FORMATO = { codigo: 'HSEG-FR-23', version: '1' }

/** Velocidad máxima recomendada que figura en el formato. */
const VELOCIDAD_SEGURA_KMH = 80

const PROPOSITO_LABELS: Record<string, string> = {
  personal: 'Personal',
  personal_y_herramienta: 'Personal y herramienta',
  'personal y herramienta': 'Personal y herramienta',
}

const ESTADO_LABELS: Record<string, string> = {
  solicitado: 'Solicitado',
  planificado: 'Planificado',
  en_curso: 'En curso',
  pendiente: 'Pendiente',
  realizado: 'Realizado',
  planilla_asignada: 'Planilla asignada',
  liquidado: 'Liquidado',
  cancelado: 'Cancelado',
}

function humanizar(valor: string | null | undefined, mapa: Record<string, string>): string {
  if (!valor) return '—'
  if (mapa[valor]) return mapa[valor]
  const texto = valor.replace(/_/g, ' ').trim()
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

const FECHA_HORA = new Intl.DateTimeFormat('es-CO', {
  timeZone: 'America/Bogota',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

function fechaHora(valor: Date | null | undefined): string {
  if (!valor) return '—'
  return FECHA_HORA.format(valor).replace(',', '')
}

export class RutogramaService {
  private readonly OVERPASS_API = 'https://overpass-api.de/api/interpreter'
  private readonly MAPBOX_TOKEN = process.env.VITE_MAPBOX_ACCESS_TOKEN || process.env.MAPBOX_ACCESS_TOKEN || ''
  private readonly DISTRACOM_ICON_URL = process.env.DISTRACOM_ICON_URL
    ?? 'https://transmeralda.s3.us-east-2.amazonaws.com/assets/Surtidor.png'
  private readonly DISTRACOM_DEPARTAMENTOS = [
    'cundinamarca',
    'bogotá', 'bogota',
    'boyacá', 'boyaca',
    'meta',
    'casanare',
    'vichada',
  ]

  constructor() {
    if (!this.MAPBOX_TOKEN) {
      console.warn('⚠️  [RutogramaService] MAPBOX_ACCESS_TOKEN no configurado')
    }
  }

  /**
   * Genera el rutograma en PDF de un servicio.
   */
  async generarRutograma(servicioId: string): Promise<Buffer> {
    console.log(`[RutogramaService] Generando rutograma para servicio ${servicioId}`)

    /// Un servicio retirado no genera rutograma.
    const servicio = await prisma.servicio.findFirst({
      where: { id: servicioId, deleted_at: null },
      include: {
        municipios_servicio_origen_idTomunicipios: true,
        municipios_servicio_destino_idTomunicipios: true,
        clientes: true,
        conductores: true,
        vehiculos: true,
        recargos_planillas: {
          take: 1,
          orderBy: { created_at: 'desc' }
        }
      }
    })

    if (!servicio) {
      throw new Error('Servicio no encontrado')
    }

    const origenMun = servicio.municipios_servicio_origen_idTomunicipios
    const destinoMun = servicio.municipios_servicio_destino_idTomunicipios

    // Coordenadas efectivas: las del servicio y, si no las tiene, las del
    // municipio. `Number()` convierte el Decimal de Prisma a número nativo.
    const origen = this.coordenadas(servicio.origen_latitud, servicio.origen_longitud, origenMun)
    const destino = this.coordenadas(servicio.destino_latitud, servicio.destino_longitud, destinoMun)

    // Ruta por carretera (distancia, duración, geometría y tramos por vía).
    let ruta: RutaCalculada | null = null
    if (this.MAPBOX_TOKEN && origen && destino) {
      try {
        ruta = await this.calcularRuta([origen.lng, origen.lat], [destino.lng, destino.lat])
      } catch (error) {
        console.warn('[RutogramaService] No se pudo calcular ruta con Mapbox:', error)
      }
    }

    // Puntos de interés a lo largo de la ruta.
    let peajes: PeajeInfo[] = []
    let paradasSeguras: ParadaSeguraInfo[] = []
    let distracomEstaciones: DistracomEstacion[] = []
    if (ruta?.geometry) {
      const [p, s] = await Promise.all([
        this.obtenerPeajes(ruta.geometry),
        this.obtenerParadasSeguras(ruta.geometry),
      ])
      peajes = p
      paradasSeguras = s
      try {
        distracomEstaciones = this.obtenerEstacionesDistracom(ruta.geometry)
      } catch (error) {
        console.warn('[RutogramaService] No se pudieron obtener estaciones Distracom:', error)
      }
      console.log(`[RutogramaService] Peajes: ${peajes.length} · Paradas: ${paradasSeguras.length} · Distracom: ${distracomEstaciones.length}`)
    }

    // Condiciones de la vía y riesgos, de la planilla más reciente.
    const planilla = servicio.recargos_planillas[0]
    const vias = [
      { label: 'Trocha', marcado: planilla?.via_trocha ?? false },
      { label: 'Destapada / afirmado', marcado: planilla?.via_afirmado ?? false },
      { label: 'Mixto', marcado: planilla?.via_mixto ?? false },
      { label: 'Pavimentada', marcado: planilla?.via_pavimentada ?? false },
    ]
    const riesgos = [
      { label: 'Desniveles / pendientes fuertes', marcado: planilla?.riesgo_desniveles ?? false },
      { label: 'Deslizamientos / derrumbes', marcado: planilla?.riesgo_deslizamientos ?? false },
      { label: 'Sin señalización vial', marcado: planilla?.riesgo_sin_senalizacion ?? false },
      { label: 'Presencia de animales', marcado: planilla?.riesgo_animales ?? false },
      { label: 'Paso peatonal / zonas pobladas', marcado: planilla?.riesgo_peatones ?? false },
      { label: 'Tráfico alto / congestión', marcado: planilla?.riesgo_trafico_alto ?? false },
    ]

    // Mapa, icono Distracom y firmas en paralelo: son tres descargas
    // independientes.
    const [mapaDataUrl, firmas] = await Promise.all([
      this.fetchMapImage(origen, destino, ruta?.geometry ?? null, peajes, paradasSeguras, distracomEstaciones),
      this.obtenerFirmas(),
    ])

    const puntos: PuntoRuta[] = [
      {
        marca: 'A',
        tipo: 'Origen',
        nombre: `${origenMun.nombre_municipio} (${origenMun.nombre_departamento})`,
        detalle: servicio.origen_especifico || '',
        lat: origen?.lat ?? 0,
        lng: origen?.lng ?? 0,
      },
      {
        marca: 'B',
        tipo: 'Destino',
        nombre: `${destinoMun.nombre_municipio} (${destinoMun.nombre_departamento})`,
        detalle: servicio.destino_especifico || '',
        lat: destino?.lat ?? 0,
        lng: destino?.lng ?? 0,
      },
      ...peajes.map((p): PuntoRuta => ({ marca: 'P', tipo: 'Peaje', nombre: p.nombre, detalle: '', lat: p.lat, lng: p.lon })),
      ...paradasSeguras.map((p): PuntoRuta => ({
        marca: p.tipo === 'restaurante' ? 'R' : p.tipo === 'estacion_servicio' ? 'S' : 'H',
        tipo: p.tipo === 'restaurante' ? 'Restaurante' : p.tipo === 'estacion_servicio' ? 'Estación de servicio' : 'Hospedaje',
        nombre: p.nombre,
        detalle: '',
        lat: p.lat,
        lng: p.lon,
      })),
      ...distracomEstaciones.map((e): PuntoRuta => ({
        marca: 'D',
        tipo: 'Distracom',
        nombre: e.nombre,
        detalle: [
          [e.direccion, e.ciudad].filter(Boolean).join(', '),
          [e.diesel && 'Diésel', e.gasolina && 'Gasolina', e.hotel && 'Hotel', e.lubricentro && 'Lubricentro']
            .filter(Boolean)
            .join(' · '),
        ].filter(Boolean).join(' — '),
        lat: e.lat,
        lng: e.lon,
      })),
    ]

    const datos: DatosRutograma = {
      empresa: EMPRESA,
      formato: FORMATO,
      emitidoEl: fechaHora(new Date()),
      servicio: {
        id: servicio.id,
        numeroRuta: `RUTA-${servicio.id.substring(0, 8).toUpperCase()}`,
        estado: humanizar(servicio.estado, ESTADO_LABELS),
        proposito: humanizar(servicio.proposito_servicio, PROPOSITO_LABELS),
        fechaSolicitud: fechaHora(servicio.fecha_solicitud),
        fechaRealizacion: fechaHora(servicio.fecha_realizacion),
        fechaFinalizacion: fechaHora(servicio.fecha_finalizacion),
        numeroPlanilla: servicio.numero_planilla || planilla?.numero_planilla || '—',
        observaciones: servicio.observaciones || '',
      },
      cliente: {
        nombre: servicio.clientes?.nombre || 'N/A',
        nit: servicio.clientes?.nit || '',
      },
      conductor: servicio.conductores
        ? {
            nombre: `${servicio.conductores.nombre} ${servicio.conductores.apellido}`.trim(),
            cedula: servicio.conductores.numero_identificacion || '—',
            telefono: servicio.conductores.telefono || '',
          }
        : null,
      vehiculo: servicio.vehiculos
        ? {
            placa: servicio.vehiculos.placa,
            descripcion: [servicio.vehiculos.marca, servicio.vehiculos.linea, servicio.vehiculos.modelo]
              .filter(Boolean)
              .join(' '),
            clase: servicio.vehiculos.clase_vehiculo || '',
          }
        : null,
      origen: {
        municipio: origenMun.nombre_municipio,
        departamento: origenMun.nombre_departamento,
        direccion: servicio.origen_especifico || '',
        lat: origen?.lat ?? null,
        lng: origen?.lng ?? null,
      },
      destino: {
        municipio: destinoMun.nombre_municipio,
        departamento: destinoMun.nombre_departamento,
        direccion: servicio.destino_especifico || '',
        lat: destino?.lat ?? null,
        lng: destino?.lng ?? null,
      },
      ruta: {
        distanciaKm: ruta ? ruta.distance / 1000 : 0,
        duracionHoras: ruta ? ruta.duration / 3600 : 0,
        velocidadSegura: VELOCIDAD_SEGURA_KMH,
        mapaDataUrl,
        tramos: ruta?.tramos ?? [],
      },
      puntos,
      vias,
      riesgos,
      firmas,
    }

    const html = renderRutogramaHtml(datos, { prelude: buildFontsCss() })
    return pdfFromHtml({
      html,
      landscape: false,
      format: 'Letter',
      marginMm: 0,
      // El `@page` de la plantilla manda, igual que en el desprendible.
      preferCSSPageSize: true,
    })
  }

  // ─── DATOS DEL SERVICIO ──────────────────────────────────────

  private coordenadas(
    lat: number | null,
    lng: number | null,
    municipio: { latitud: unknown; longitud: unknown } | null,
  ): Coordenadas | null {
    if (lat != null && lng != null) return { lat: Number(lat), lng: Number(lng) }
    if (municipio?.latitud != null && municipio?.longitud != null) {
      return { lat: Number(municipio.latitud), lng: Number(municipio.longitud) }
    }
    return null
  }

  /**
   * Firmas del Jefe de Operaciones y de la Coordinadora HSEQ, como data-URL
   * para incrustarlas en el HTML.
   */
  private async obtenerFirmas(): Promise<FirmaRutograma[]> {
    const firmantes = await prisma.usuarios.findMany({
      where: {
        cargo: { in: ['Jefe de Operaciones', 'Coordinadora HSEQ'] },
        firma_url: { not: null }
      },
      select: { nombre: true, cargo: true, firma_url: true }
    })

    return Promise.all(
      firmantes.map(async (firmante): Promise<FirmaRutograma> => {
        let imagenDataUrl: string | null = null
        if (firmante.firma_url) {
          try {
            const signedUrl = await getS3SignedUrl(firmante.firma_url)
            const response = await fetch(signedUrl)
            if (response.ok) {
              const tipo = response.headers.get('content-type') || 'image/png'
              const buffer = Buffer.from(await response.arrayBuffer())
              imagenDataUrl = `data:${tipo};base64,${buffer.toString('base64')}`
            }
          } catch (err) {
            console.warn(`[RutogramaService] No se pudo descargar firma de ${firmante.nombre}:`, err)
          }
        }
        return { nombre: firmante.nombre, cargo: firmante.cargo || '', imagenDataUrl }
      }),
    )
  }

  // ─── DISTRACOM STATIONS ──────────────────────────────────────

  /**
   * Filtra estaciones Distracom del JSON local:
   * 1. Solo departamentos permitidos (Cundinamarca, Bogotá, Boyacá, Meta, Casanare, Vichada)
   * 2. Solo las que estén a menos de ~50 km de algún punto de la ruta
   */
  private obtenerEstacionesDistracom(geometry: any): DistracomEstacion[] {
    const coords: number[][] = geometry.coordinates

    // Bounding box de la ruta + buffer ~0.5 grados (~55 km)
    const lats = coords.map((c) => c[1])
    const lngs = coords.map((c) => c[0])
    const bbox = {
      minLat: Math.min(...lats) - 0.5,
      maxLat: Math.max(...lats) + 0.5,
      minLng: Math.min(...lngs) - 0.5,
      maxLng: Math.max(...lngs) + 0.5,
    }

    const estaciones: DistracomEstacion[] = []

    for (const raw of distracomLocations as any[]) {
      const depto = (raw.Departamento || '').toLowerCase().trim()
      const lat: number = Number(raw.Latitud)
      const lon: number = Number(raw.Longitud)

      // 1. Filtrar por departamento permitido
      if (!this.DISTRACOM_DEPARTAMENTOS.includes(depto)) continue

      // 2. Filtrar por bounding box (barato)
      if (lat < bbox.minLat || lat > bbox.maxLat || lon < bbox.minLng || lon > bbox.maxLng) continue

      // 3. Verificar proximidad real (~50 km ≈ 0.45 grados)
      const cercana = coords.some((c) => {
        const dLat = Math.abs(lat - c[1])
        const dLng = Math.abs(lon - c[0])
        return dLat < 0.45 && dLng < 0.45
      })
      if (!cercana) continue

      const servicios: string[] = (raw.Servicios || []).map((s: any) => s.Nombre?.toLowerCase() || '')

      estaciones.push({
        nombre: raw.NombreEstacion || 'Estación Distracom',
        direccion: raw.Direccion || '',
        ciudad: raw.Ciudad || '',
        departamento: raw.Departamento || '',
        lat,
        lon,
        diesel: (raw.DIESEL ?? 0) > 0,
        gasolina: (raw.CORRIENTE ?? 0) > 0 || (raw.PREMIUM ?? 0) > 0,
        hotel: raw.Hotel === true,
        lubricentro: servicios.some((s) => s.includes('lubricentro')),
      })
    }

    return estaciones.slice(0, 6)
  }

  // ─── API HELPERS ──────────────────────────────────────────────

  private async calcularRuta(
    origen: [number, number],
    destino: [number, number]
  ): Promise<RutaCalculada> {
    // `steps=true` trae los tramos de la ruta con el nombre de cada vía, que
    // es lo que alimenta la tabla «Vías principales».
    const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${origen[0]},${origen[1]};${destino[0]},${destino[1]}?access_token=${this.MAPBOX_TOKEN}&geometries=geojson&overview=full&steps=true&language=es`

    const response = await fetch(url)
    if (!response.ok) throw new Error(`Mapbox error: ${response.status}`)

    const data = await response.json() as {
      routes?: Array<{
        geometry: any
        distance: number
        duration: number
        legs?: Array<{ steps?: Array<{ name?: string; ref?: string; distance?: number }> }>
      }>
    }
    const route = data.routes?.[0]
    if (!route) throw new Error('No se encontró ruta')

    return {
      geometry: route.geometry,
      distance: route.distance,
      duration: route.duration,
      tramos: this.resumirTramos(route.legs?.flatMap((l) => l.steps ?? []) ?? []),
    }
  }

  /**
   * Agrupa los pasos de Mapbox por vía, en orden de recorrido, fusionando los
   * consecutivos que van por la misma. Las carreteras nacionales suelen venir
   * sin `name` y con `ref` («65»), y buena parte del recorrido rural llega sin
   * ninguno de los dos: esos tramos se conservan como «Vía sin nombre» para
   * que la suma de la tabla se parezca a la distancia total. Se omiten los
   * menores de 500 m y se devuelven como mucho diez para que quepan en la
   * tarjeta.
   */
  private resumirTramos(steps: Array<{ name?: string; ref?: string; distance?: number }>): TramoVia[] {
    const tramos: TramoVia[] = []
    for (const step of steps) {
      const nombre = (step.name || '').trim()
      const ref = (step.ref || '').trim()
      const via = nombre && ref && !nombre.includes(ref)
        ? `${nombre} (${ref})`
        : nombre || (ref ? `Vía ${ref}` : 'Vía sin nombre')
      const distanciaKm = (step.distance || 0) / 1000
      const ultimo = tramos[tramos.length - 1]
      if (ultimo && ultimo.via === via) {
        ultimo.distanciaKm += distanciaKm
      } else {
        tramos.push({ via, distanciaKm })
      }
    }
    return tramos.filter((t) => t.distanciaKm >= 0.5).slice(0, 10)
  }

  private async obtenerPeajes(geometry: any): Promise<PeajeInfo[]> {
    try {
      const coords = geometry.coordinates
      const lats = coords.map((c: number[]) => c[1])
      const lngs = coords.map((c: number[]) => c[0])
      const bbox = [
        Math.min(...lats),
        Math.min(...lngs),
        Math.max(...lats),
        Math.max(...lngs),
      ]

      const query = `
        [out:json];
        (
          node["barrier"="toll_booth"](${bbox[0]},${bbox[1]},${bbox[2]},${bbox[3]});
          node["amenity"="toll_booth"](${bbox[0]},${bbox[1]},${bbox[2]},${bbox[3]});
        );
        out body;
      `

      const response = await fetch(this.OVERPASS_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(10000),
      })

      if (!response.ok) return []
      const data = await response.json() as { elements?: any[] }

      return (data.elements || []).map((el: any) => ({
        nombre: el.tags?.name || 'Peaje sin nombre',
        lat: el.lat,
        lon: el.lon,
      }))
    } catch (error: any) {
      console.warn('[RutogramaService] Error obteniendo peajes:', error.message)
      return []
    }
  }

  /**
   * Obtiene restaurantes, estaciones de servicio y hospedajes cercanos a la ruta
   */
  private async obtenerParadasSeguras(geometry: any): Promise<ParadaSeguraInfo[]> {
    try {
      const coords = geometry.coordinates
      const lats = coords.map((c: number[]) => c[1])
      const lngs = coords.map((c: number[]) => c[0])
      // Buffer de 0.02 grados (~2km) alrededor de la ruta
      const bbox = [
        Math.min(...lats) - 0.02,
        Math.min(...lngs) - 0.02,
        Math.max(...lats) + 0.02,
        Math.max(...lngs) + 0.02,
      ]

      const query = `
        [out:json][timeout:15];
        (
          node["amenity"="restaurant"](${bbox[0]},${bbox[1]},${bbox[2]},${bbox[3]});
          node["amenity"="fuel"](${bbox[0]},${bbox[1]},${bbox[2]},${bbox[3]});
          node["tourism"="hotel"](${bbox[0]},${bbox[1]},${bbox[2]},${bbox[3]});
          node["tourism"="hostel"](${bbox[0]},${bbox[1]},${bbox[2]},${bbox[3]});
          node["tourism"="guest_house"](${bbox[0]},${bbox[1]},${bbox[2]},${bbox[3]});
        );
        out body;
      `

      const response = await fetch(this.OVERPASS_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(15000),
      })

      if (!response.ok) return []
      const data = await response.json() as { elements?: any[] }

      const paradas: ParadaSeguraInfo[] = (data.elements || []).map((el: any) => {
        let tipo: ParadaSeguraInfo['tipo'] = 'restaurante'
        if (el.tags?.amenity === 'fuel') tipo = 'estacion_servicio'
        if (el.tags?.tourism === 'hotel' || el.tags?.tourism === 'hostel' || el.tags?.tourism === 'guest_house') tipo = 'hospedaje'

        return {
          nombre: el.tags?.name || (tipo === 'restaurante' ? 'Restaurante' : tipo === 'estacion_servicio' ? 'Estación de servicio' : 'Hospedaje'),
          tipo,
          lat: el.lat,
          lon: el.lon,
        }
      })

      // Filtrar solo los que están cerca de la ruta (dentro de ~3km de algún punto)
      const paradasCercanas = paradas.filter(p => {
        return coords.some((c: number[]) => {
          const dLat = Math.abs(p.lat - c[1])
          const dLng = Math.abs(p.lon - c[0])
          return dLat < 0.03 && dLng < 0.03 // ~3km
        })
      })

      // Limitar a máximo 8 para no saturar el mapa
      return paradasCercanas.slice(0, 8)
    } catch (error: any) {
      console.warn('[RutogramaService] Error obteniendo paradas seguras:', error.message)
      return []
    }
  }

  // ─── MAP IMAGE GENERATION ────────────────────────────────────

  /**
   * Encode an array of [lng, lat] coordinates into a Google Encoded Polyline (precision 5)
   */
  private encodePolyline(coordinates: number[][]): string {
    let output = ''
    let prevLat = 0
    let prevLng = 0

    for (const coord of coordinates) {
      const lat = Math.round(coord[1] * 1e5)
      const lng = Math.round(coord[0] * 1e5)

      output += this.encodeSignedNumber(lat - prevLat)
      output += this.encodeSignedNumber(lng - prevLng)

      prevLat = lat
      prevLng = lng
    }

    return output
  }

  private encodeSignedNumber(num: number): string {
    let sgn_num = num << 1
    if (num < 0) sgn_num = ~sgn_num
    return this.encodeNumber(sgn_num)
  }

  private encodeNumber(num: number): string {
    let encoded = ''
    while (num >= 0x20) {
      encoded += String.fromCharCode((0x20 | (num & 0x1f)) + 63)
      num >>= 5
    }
    encoded += String.fromCharCode(num + 63)
    return encoded
  }

  /**
   * Simplify coordinates by keeping every Nth point to stay under URL limit
   */
  private simplifyCoords(coordinates: number[][], maxPoints: number = 200): number[][] {
    if (coordinates.length <= maxPoints) return coordinates
    const step = Math.ceil(coordinates.length / maxPoints)
    const simplified: number[][] = []
    for (let i = 0; i < coordinates.length; i += step) {
      simplified.push(coordinates[i])
    }
    // Always include the last point
    const last = coordinates[coordinates.length - 1]
    if (simplified[simplified.length - 1] !== last) {
      simplified.push(last)
    }
    return simplified
  }

  /**
   * Mapa estático de Mapbox con el trazado y los marcadores, como data-URL
   * lista para un `<img>`:
   * - A (verde de marca) origen, B (rojo) destino
   * - Peajes (naranja)
   * - Restaurantes (azul), estaciones de servicio (morado), hospedajes (verde azulado)
   * - Estaciones Distracom (icono propio)
   */
  private async fetchMapImage(
    origen: Coordenadas | null,
    destino: Coordenadas | null,
    routeGeometry: any | null,
    peajes: PeajeInfo[],
    paradasSeguras: ParadaSeguraInfo[],
    distracomEstaciones: DistracomEstacion[],
  ): Promise<string | null> {
    if (!this.MAPBOX_TOKEN) {
      console.warn('[RutogramaService] No Mapbox token, skipping map image')
      return null
    }

    if (!origen || !destino) {
      console.warn('[RutogramaService] Missing coordinates, skipping map image')
      return null
    }

    try {
      const markerA = `pin-l-a+${COLOR_RUTA}(${origen.lng.toFixed(5)},${origen.lat.toFixed(5)})`
      const markerB = `pin-l-b+d32f2f(${destino.lng.toFixed(5)},${destino.lat.toFixed(5)})`

      const peajeMarkers = peajes.slice(0, 5).map(p =>
        `pin-s-p+f59e0b(${p.lon.toFixed(5)},${p.lat.toFixed(5)})`
      )

      const paradaMarkers = paradasSeguras.slice(0, 8).map(p => {
        const color = p.tipo === 'restaurante' ? '2196f3' : p.tipo === 'estacion_servicio' ? '9c27b0' : '009688'
        const letter = p.tipo === 'restaurante' ? 'r' : p.tipo === 'estacion_servicio' ? 's' : 'h'
        return `pin-s-${letter}+${color}(${p.lon.toFixed(5)},${p.lat.toFixed(5)})`
      })

      // Distracom: icono PNG público desde S3
      const distracomIconEncoded = encodeURIComponent(this.DISTRACOM_ICON_URL)
      const distracomMarkers = distracomEstaciones.slice(0, 6).map(e =>
        `url-${distracomIconEncoded}(${e.lon.toFixed(5)},${e.lat.toFixed(5)})`
      )

      const construirUrl = (maxPuntos: number, marcadores: string[]): string => {
        let overlays = marcadores.join(',')
        if (routeGeometry?.coordinates) {
          const simplified = this.simplifyCoords(routeGeometry.coordinates, maxPuntos)
          const encoded = encodeURIComponent(this.encodePolyline(simplified))
          overlays = `path-5+${COLOR_RUTA}-0.85(${encoded}),${overlays}`
        }
        return `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/${overlays}/auto/1280x640@2x?padding=50,50,50,50&logo=false&attribution=false&access_token=${this.MAPBOX_TOKEN}`
      }

      let url = construirUrl(100, [...peajeMarkers, ...paradaMarkers, ...distracomMarkers, markerA, markerB])

      // Mapbox limita la URL a ~8192 caracteres: si se pasa, se simplifica el
      // trazado y se dejan solo peajes y Distracom.
      if (url.length > 8000) {
        console.warn(`[RutogramaService] URL del mapa demasiado larga (${url.length}), simplificando...`)
        url = construirUrl(60, [...peajeMarkers.slice(0, 3), ...distracomMarkers.slice(0, 3), markerA, markerB])
      }

      const response = await fetch(url)
      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Mapbox Static API error ${response.status}: ${errorText}`)
      }

      const buffer = Buffer.from(await response.arrayBuffer())
      console.log(`[RutogramaService] Map image fetched: ${(buffer.length / 1024).toFixed(0)} KB`)
      return `data:image/png;base64,${buffer.toString('base64')}`
    } catch (error) {
      console.warn('[RutogramaService] Error fetching map image:', error)
      return null
    }
  }
}
