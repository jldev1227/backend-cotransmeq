import PDFDocument from 'pdfkit'
import * as path from 'path'
import * as fs from 'fs'
import { prisma } from '../../config/prisma'

interface FirmaData {
  nombre: string
  cargo: string
  imageBuffer: Buffer | null
}

interface RutogramaData {
  servicioId: string
  numeroRuta: string
  fecha: string
  origen: {
    municipio: string
    departamento: string
    especifico: string
    lat: number
    lng: number
  }
  destino: {
    municipio: string
    departamento: string
    especifico: string
    lat: number
    lng: number
  }
  distanciaKm: number
  duracionHoras: number
  velocidadSegura: number
  rutaAlterna: string
  observaciones: string
  cliente: string
  conductor: string
  vehiculo: string
  placa: string
  peajes: PeajeInfo[]
  paradasSeguras: ParadaSeguraInfo[]
  vias: ViasInfo
  riesgos: RiesgosInfo
  routeGeometry: any | null
}

interface PeajeInfo {
  nombre: string
  lat: number
  lon: number
}

interface ParadaSeguraInfo {
  nombre: string
  tipo: 'restaurante' | 'estacion_servicio' | 'hospedaje'
  lat: number
  lon: number
}

interface ViasInfo {
  trocha: boolean
  afirmado: boolean
  mixto: boolean
  pavimentada: boolean
}

interface RiesgosInfo {
  desniveles: boolean
  deslizamientos: boolean
  sinSenalizacion: boolean
  animales: boolean
  peatones: boolean
  traficoAlto: boolean
}

// Colores corporativos Cotransmeq (naranja)
const COLORS = {
  primary: '#c2410c',       // Naranja oscuro
  primaryLight: '#fff7ed',  // Naranja muy claro para fondos
  accent: '#ea580c',        // Naranja medio
  headerBg: '#c2410c',      // Fondo header
  headerText: '#ffffff',    // Texto header
  cellBorder: '#999999',
  black: '#000000',
  white: '#ffffff',
  lightGray: '#f2f2f2',
  mediumGray: '#cccccc',
  darkGray: '#333333',
  checkOrange: '#ea580c',
  sectionBg: '#fff7ed',
}

export class RutogramaService {
  private readonly OVERPASS_API = 'https://overpass-api.de/api/interpreter'
  private readonly MAPBOX_TOKEN = process.env.VITE_MAPBOX_ACCESS_TOKEN || process.env.MAPBOX_ACCESS_TOKEN || ''

  constructor() {
    if (!this.MAPBOX_TOKEN) {
      console.warn('⚠️  [RutogramaService] MAPBOX_ACCESS_TOKEN no configurado')
    } else {
      console.log(`✅ [RutogramaService] Token Mapbox cargado: ${this.MAPBOX_TOKEN.substring(0, 10)}...`)
    }
  }

  /**
   * Genera un rutograma en PDF para un servicio
   */
  async generarRutograma(servicioId: string): Promise<Buffer> {
    console.log(`[RutogramaService] Generando rutograma para servicio ${servicioId}`)

    // 1. Obtener datos del servicio con relaciones
    const servicio = await prisma.servicio.findUnique({
      where: { id: servicioId },
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

    // 2. Calcular ruta con Mapbox (distancia y duración)
    let distanciaKm = 0
    let duracionHoras = 0
    let routeGeometry: any = null

    if (this.MAPBOX_TOKEN && servicio.origen_longitud && servicio.origen_latitud && servicio.destino_longitud && servicio.destino_latitud) {
      try {
        const routeData = await this.calcularRuta(
          [servicio.origen_longitud, servicio.origen_latitud],
          [servicio.destino_longitud, servicio.destino_latitud]
        )
        distanciaKm = routeData.distance / 1000
        duracionHoras = routeData.duration / 3600
        routeGeometry = routeData.geometry
      } catch (error) {
        console.warn('[RutogramaService] No se pudo calcular ruta con Mapbox:', error)
      }
    }

    // 3. Obtener peajes cercanos a la ruta
    let peajes: PeajeInfo[] = []
    let paradasSeguras: ParadaSeguraInfo[] = []
    if (routeGeometry) {
      try {
        peajes = await this.obtenerPeajes(routeGeometry)
      } catch (error) {
        console.warn('[RutogramaService] No se pudieron obtener peajes:', error)
      }
      try {
        paradasSeguras = await this.obtenerParadasSeguras(routeGeometry)
      } catch (error) {
        console.warn('[RutogramaService] No se pudieron obtener paradas seguras:', error)
      }
      console.log(`[RutogramaService] 📍 Peajes encontrados: ${peajes.length}`)
      peajes.forEach(p => console.log(`  🟠 ${p.nombre} → lat: ${p.lat}, lon: ${p.lon}`))
      console.log(`[RutogramaService] 📍 Paradas seguras encontradas: ${paradasSeguras.length}`)
      paradasSeguras.forEach(p => console.log(`  🔵 [${p.tipo}] ${p.nombre} → lat: ${p.lat}, lon: ${p.lon}`))
    }

    // 4. Extraer info de vías y riesgos de recargos_planillas
    const planilla = servicio.recargos_planillas[0]
    const vias: ViasInfo = {
      trocha: planilla?.via_trocha ?? false,
      afirmado: planilla?.via_afirmado ?? false,
      mixto: planilla?.via_mixto ?? false,
      pavimentada: planilla?.via_pavimentada ?? false,
    }
    const riesgos: RiesgosInfo = {
      desniveles: planilla?.riesgo_desniveles ?? false,
      deslizamientos: planilla?.riesgo_deslizamientos ?? false,
      sinSenalizacion: planilla?.riesgo_sin_senalizacion ?? false,
      animales: planilla?.riesgo_animales ?? false,
      peatones: planilla?.riesgo_peatones ?? false,
      traficoAlto: planilla?.riesgo_trafico_alto ?? false,
    }

    const origenMun = servicio.municipios_servicio_origen_idTomunicipios
    const destinoMun = servicio.municipios_servicio_destino_idTomunicipios

    // 5. Firmas (el esquema Cotransmeq no tiene cargo/firma_url en usuarios,
    //    se dejan recuadros vacíos para firma manual)
    const firmas: FirmaData[] = [
      { nombre: '', cargo: 'Jefe de Operaciones', imageBuffer: null },
      { nombre: '', cargo: 'Coordinadora HSEQ', imageBuffer: null },
    ]

    // 6. Generar PDF
    const pdfBuffer = await this.generarPDF({
      servicioId: servicio.id,
      numeroRuta: `RUTA-${servicio.id.substring(0, 8).toUpperCase()}`,
      fecha: new Date().toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' }),
      origen: {
        municipio: origenMun.nombre_municipio,
        departamento: origenMun.nombre_departamento,
        especifico: servicio.origen_especifico || '',
        lat: servicio.origen_latitud || 0,
        lng: servicio.origen_longitud || 0,
      },
      destino: {
        municipio: destinoMun.nombre_municipio,
        departamento: destinoMun.nombre_departamento,
        especifico: servicio.destino_especifico || '',
        lat: servicio.destino_latitud || 0,
        lng: servicio.destino_longitud || 0,
      },
      distanciaKm,
      duracionHoras,
      velocidadSegura: 80,
      rutaAlterna: '',
      observaciones: servicio.observaciones || '',
      cliente: servicio.clientes?.nombre || 'N/A',
      conductor: servicio.conductores
        ? `${servicio.conductores.nombre} ${servicio.conductores.apellido}`
        : 'No asignado',
      vehiculo: servicio.vehiculos
        ? `${servicio.vehiculos.marca} ${servicio.vehiculos.modelo}`
        : 'No asignado',
      placa: servicio.vehiculos?.placa || 'N/A',
      peajes,
      paradasSeguras,
      vias,
      riesgos,
      routeGeometry: routeGeometry || null,
    }, firmas)

    return pdfBuffer
  }

  // ─── API HELPERS ──────────────────────────────────────────────

  private async calcularRuta(
    origen: [number, number],
    destino: [number, number]
  ): Promise<{ geometry: any; distance: number; duration: number }> {
    const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${origen[0]},${origen[1]};${destino[0]},${destino[1]}?access_token=${this.MAPBOX_TOKEN}&geometries=geojson&overview=full&language=es`

    const response = await fetch(url)
    if (!response.ok) throw new Error(`Mapbox error: ${response.status}`)

    const data = await response.json() as { routes?: Array<{ geometry: any; distance: number; duration: number }> }
    const route = data.routes?.[0]
    if (!route) throw new Error('No se encontró ruta')

    return {
      geometry: route.geometry,
      distance: route.distance,
      duration: route.duration,
    }
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
      console.log(`[RutogramaService] Paradas seguras encontradas: ${paradasCercanas.length} (de ${paradas.length} totales)`)
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
   * Fetch a static map image from Mapbox with markers:
   * - A (orange) origin, B (red) destination
   * - Peajes (yellow markers)
   * - Restaurantes (blue), Estaciones de servicio (purple), Hospedajes (teal)
   */
  private async fetchMapImage(data: RutogramaData): Promise<Buffer | null> {
    if (!this.MAPBOX_TOKEN) {
      console.warn('[RutogramaService] No Mapbox token, skipping map image')
      return null
    }

    if (!data.origen.lat || !data.origen.lng || !data.destino.lat || !data.destino.lng) {
      console.warn('[RutogramaService] Missing coordinates, skipping map image')
      return null
    }

    try {
      // Markers: A (orange) for origin, B (red) for destination
      const markerA = `pin-l-a+ea580c(${data.origen.lng.toFixed(5)},${data.origen.lat.toFixed(5)})`
      const markerB = `pin-l-b+d32f2f(${data.destino.lng.toFixed(5)},${data.destino.lat.toFixed(5)})`

      // Peajes markers (yellow, small pin with P)
      const peajeMarkers = data.peajes.slice(0, 5).map(p =>
        `pin-s-p+f59e0b(${p.lon.toFixed(5)},${p.lat.toFixed(5)})`
      )

      // Paradas seguras markers
      const paradaMarkers = data.paradasSeguras.slice(0, 8).map(p => {
        // Restaurante=blue, Estación=purple, Hospedaje=teal
        const color = p.tipo === 'restaurante' ? '2196f3' : p.tipo === 'estacion_servicio' ? '9c27b0' : '009688'
        const letter = p.tipo === 'restaurante' ? 'r' : p.tipo === 'estacion_servicio' ? 's' : 'h'
        return `pin-s-${letter}+${color}(${p.lon.toFixed(5)},${p.lat.toFixed(5)})`
      })

      let allMarkers = [...peajeMarkers, ...paradaMarkers, markerA, markerB]
      let overlays = allMarkers.join(',')

      // Add route path if available
      if (data.routeGeometry?.coordinates) {
        const simplified = this.simplifyCoords(data.routeGeometry.coordinates, 100)
        const encoded = this.encodePolyline(simplified)
        const encodedURI = encodeURIComponent(encoded)
        const pathOverlay = `path-4+ea580c-0.8(${encodedURI})`
        overlays = `${pathOverlay},${allMarkers.join(',')}`
      }

      // Check URL length - Mapbox limit is ~8192 chars
      let baseUrl = `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/${overlays}/auto/1280x800@2x?padding=60,60,60,60&logo=false&attribution=false&access_token=${this.MAPBOX_TOKEN}`

      // If URL too long, reduce polyline points or remove some markers
      if (baseUrl.length > 8000) {
        console.warn(`[RutogramaService] URL too long (${baseUrl.length}), simplifying...`)
        if (data.routeGeometry?.coordinates) {
          const simplified = this.simplifyCoords(data.routeGeometry.coordinates, 60)
          const encoded = this.encodePolyline(simplified)
          const encodedURI = encodeURIComponent(encoded)
          const pathOverlay = `path-4+ea580c-0.8(${encodedURI})`
          // Keep only origin/destination + peajes, drop paradas
          allMarkers = [...peajeMarkers.slice(0, 3), markerA, markerB]
          overlays = `${pathOverlay},${allMarkers.join(',')}`
          baseUrl = `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/${overlays}/auto/1280x800@2x?padding=60,60,60,60&logo=false&attribution=false&access_token=${this.MAPBOX_TOKEN}`
        }
      }

      console.log(`[RutogramaService] Fetching map image (${baseUrl.length} chars, ${peajeMarkers.length} peajes, ${paradaMarkers.length} paradas)`)

      const response = await fetch(baseUrl)
      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Mapbox Static API error ${response.status}: ${errorText}`)
      }

      const arrayBuffer = await response.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)
      console.log(`[RutogramaService] Map image fetched: ${(buffer.length / 1024).toFixed(0)} KB`)
      return buffer
    } catch (error) {
      console.warn('[RutogramaService] Error fetching map image:', error)
      return null
    }
  }

  // ─── PDF GENERATION ──────────────────────────────────────────

  private getLogoPath(): string {
    const isDist = __dirname.includes('/dist/')
    return isDist
      ? path.join(__dirname, '../../assets/cotransmeq-logo.png')
      : path.join(__dirname, '../../assets/cotransmeq-logo.png')
  }

  private getFontsDir(): string {
    return __dirname.includes('/dist/')
      ? path.join(__dirname, '../../assets/fonts')
      : path.join(__dirname, '../../assets/fonts')
  }

  private registerFonts(doc: typeof PDFDocument.prototype) {
    const fontsDir = this.getFontsDir()
    const regularPath = path.join(fontsDir, 'Roboto-Regular.ttf')
    const boldPath = path.join(fontsDir, 'Roboto-Bold.ttf')

    if (fs.existsSync(regularPath)) {
      doc.registerFont('Roboto', regularPath)
    }
    if (fs.existsSync(boldPath)) {
      doc.registerFont('Roboto-Bold', boldPath)
    }
  }

  private async generarPDF(data: RutogramaData, firmas: FirmaData[]): Promise<Buffer> {
    // Fetch map image before starting PDF generation
    const mapImageBuffer = await this.fetchMapImage(data)

    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: [612 * 1.02, 792 * 1.02], // LETTER + 2% (landscape swap)
          layout: 'landscape',
          margins: { top: 25, bottom: 20, left: 30, right: 30 },
        })

        this.registerFonts(doc)

        const chunks: Buffer[] = []
        doc.on('data', (chunk) => chunks.push(chunk))
        doc.on('end', () => resolve(Buffer.concat(chunks)))
        doc.on('error', reject)

        const pageW = doc.page.width   // 792 for LETTER landscape
        const pageH = doc.page.height  // 612 for LETTER landscape
        const marginL = 30
        const marginR = 30
        const contentW = pageW - marginL - marginR

        // ══════════════════════════════════════════════════
        // PÁGINA 1: Header + Información de ruta + Condiciones viales/riesgos
        // ══════════════════════════════════════════════════

        let y = this.renderHeader(doc, pageW, marginL, contentW, data)

        // ── Sección 1: Información de la Ruta ──
        y = this.renderSeccion1(doc, marginL, contentW, y, data)

        // ── Sección 2: Condiciones de la Vía y Riesgos ──
        y = this.renderSeccion2(doc, marginL, contentW, y, data)

        // ── Sección 3: Controles Operacionales ──
        // Verificar si cabe en la misma página, sino nueva página
        // Sección 3 necesita ~195px (título + 6 filas + firmas)
        if (y > pageH - 195) {
          doc.addPage()
          y = this.renderHeader(doc, pageW, marginL, contentW, data)
        }
        y = this.renderSeccion3(doc, marginL, contentW, y, data, firmas)

        // ══════════════════════════════════════════════════
        // PÁGINA 2: Mapa de la Ruta
        // ══════════════════════════════════════════════════
        if (mapImageBuffer) {
          doc.addPage()
          y = this.renderHeader(doc, pageW, marginL, contentW, data)
          this.renderSeccionMapa(doc, marginL, contentW, y, pageH, data, mapImageBuffer)
        }

        doc.end()
      } catch (error) {
        reject(error)
      }
    })
  }

  // ─── HEADER ──────────────────────────────────────────────────

  private renderHeader(
    doc: typeof PDFDocument.prototype,
    pageW: number,
    marginL: number,
    contentW: number,
    data: RutogramaData
  ): number {
    const headerH = 56
    const y = 26

    // Borde del header
    doc.rect(marginL, y, contentW, headerH).lineWidth(1.5).strokeColor(COLORS.black).stroke()

    // Columna 1: Logo
    const col1W = contentW * 0.25
    try {
      const logoPath = this.getLogoPath()
      if (fs.existsSync(logoPath)) {
        doc.image(logoPath, marginL + 8, y + 6, { width: 140, height: 42 })
      } else {
        doc.fontSize(10).font('Roboto-Bold').fillColor(COLORS.primary)
          .text('COTRANSMEQ S.A.S.', marginL + 8, y + 18)
      }
    } catch {
      doc.fontSize(10).font('Roboto-Bold').fillColor(COLORS.primary)
        .text('COTRANSMEQ S.A.S.', marginL + 8, y + 18)
    }

    // Línea divisora vertical
    doc.moveTo(marginL + col1W, y).lineTo(marginL + col1W, y + headerH).stroke()

    // Columna 2: Título
    const col2X = marginL + col1W
    const col2W = contentW * 0.50
    doc.fontSize(13).font('Roboto-Bold').fillColor(COLORS.primary)
      .text('RUTOGRAMA', col2X, y + 8, { width: col2W, align: 'center' })
    doc.fontSize(7).font('Roboto').fillColor(COLORS.darkGray)
      .text('HOJA DE RUTA - CONTROL OPERACIONAL', col2X, y + 25, { width: col2W, align: 'center' })
    doc.fontSize(6).font('Roboto').fillColor(COLORS.darkGray)
      .text('COOPERATIVA DE TRANSPORTADORES DE MAQUINARIA Y EQUIPO', col2X, y + 38, { width: col2W, align: 'center' })

    // Línea divisora vertical
    doc.moveTo(col2X + col2W, y).lineTo(col2X + col2W, y + headerH).stroke()

    // Columna 3: Código, Versión, Fecha
    const col3X = col2X + col2W
    const col3W = contentW * 0.25
    doc.fontSize(7).font('Roboto').fillColor(COLORS.black)
    doc.text('Código: HSEG-FR-23', col3X + 6, y + 7, { width: col3W - 12 })
    doc.text('Versión: 1', col3X + 6, y + 19, { width: col3W - 12 })
    doc.text(`Fecha: ${data.fecha}`, col3X + 6, y + 31, { width: col3W - 12 })
    doc.text(`Ruta: ${data.numeroRuta}`, col3X + 6, y + 43, { width: col3W - 12 })

    return y + headerH + 6
  }

  // ─── SECCIÓN 1: INFORMACIÓN DE LA RUTA ───────────────────────

  private renderSeccion1(
    doc: typeof PDFDocument.prototype,
    marginL: number,
    contentW: number,
    startY: number,
    data: RutogramaData
  ): number {
    let y = startY

    // Título de sección
    y = this.drawSectionTitle(doc, marginL, y, contentW, '1. INFORMACIÓN DE LA RUTA')

    const rowH = 16
    const col1W = contentW * 0.18  // Labels
    const col2W = contentW * 0.32  // Values
    const col3W = contentW * 0.18  // Labels
    const col4W = contentW * 0.32  // Values

    // Fila 1: Origen / Destino
    this.drawCell(doc, marginL, y, col1W, rowH, 'ORIGEN:', true, COLORS.sectionBg)
    this.drawCell(doc, marginL + col1W, y, col2W, rowH, `${data.origen.municipio} (${data.origen.departamento})`)
    this.drawCell(doc, marginL + col1W + col2W, y, col3W, rowH, 'DESTINO:', true, COLORS.sectionBg)
    this.drawCell(doc, marginL + col1W + col2W + col3W, y, col4W, rowH, `${data.destino.municipio} (${data.destino.departamento})`)
    y += rowH

    // Fila 2: Dirección específica
    this.drawCell(doc, marginL, y, col1W, rowH, 'DIR. ORIGEN:', true, COLORS.sectionBg)
    this.drawCell(doc, marginL + col1W, y, col2W, rowH, data.origen.especifico || 'N/A')
    this.drawCell(doc, marginL + col1W + col2W, y, col3W, rowH, 'DIR. DESTINO:', true, COLORS.sectionBg)
    this.drawCell(doc, marginL + col1W + col2W + col3W, y, col4W, rowH, data.destino.especifico || 'N/A')
    y += rowH

    // Fila 3: Distancia / Duración estimada
    this.drawCell(doc, marginL, y, col1W, rowH, 'DISTANCIA:', true, COLORS.sectionBg)
    this.drawCell(doc, marginL + col1W, y, col2W, rowH, data.distanciaKm > 0 ? `${data.distanciaKm.toFixed(1)} km` : 'No calculada')
    this.drawCell(doc, marginL + col1W + col2W, y, col3W, rowH, 'DURACIÓN EST.:', true, COLORS.sectionBg)
    this.drawCell(doc, marginL + col1W + col2W + col3W, y, col4W, rowH, data.duracionHoras > 0 ? `${data.duracionHoras.toFixed(1)} horas` : 'No calculada')
    y += rowH

    // Fila 4: Velocidad / Cliente
    this.drawCell(doc, marginL, y, col1W, rowH, 'VEL. SEGURA:', true, COLORS.sectionBg)
    this.drawCell(doc, marginL + col1W, y, col2W, rowH, `${data.velocidadSegura} km/h`)
    this.drawCell(doc, marginL + col1W + col2W, y, col3W, rowH, 'CLIENTE:', true, COLORS.sectionBg)
    this.drawCell(doc, marginL + col1W + col2W + col3W, y, col4W, rowH, data.cliente)
    y += rowH

    // Fila 5: Conductor / Vehículo
    this.drawCell(doc, marginL, y, col1W, rowH, 'CONDUCTOR:', true, COLORS.sectionBg)
    this.drawCell(doc, marginL + col1W, y, col2W, rowH, data.conductor)
    this.drawCell(doc, marginL + col1W + col2W, y, col3W, rowH, 'VEHÍCULO:', true, COLORS.sectionBg)
    this.drawCell(doc, marginL + col1W + col2W + col3W, y, col4W, rowH, `${data.vehiculo} - ${data.placa}`)
    y += rowH

    // Fila 6: Ruta alterna
    this.drawCell(doc, marginL, y, col1W, rowH, 'RUTA ALTERNA:', true, COLORS.sectionBg)
    this.drawCell(doc, marginL + col1W, y, col1W + col2W + col3W + col4W - col1W, rowH, data.rutaAlterna || 'No especificada')
    y += rowH

    // Fila 7: Observaciones (ancho completo para textos largos)
    const obsH = 24
    this.drawCell(doc, marginL, y, col1W, obsH, 'OBSERVACIONES:', true, COLORS.sectionBg)
    this.drawCell(doc, marginL + col1W, y, col2W + col3W + col4W, obsH, data.observaciones || 'Sin observaciones')
    y += obsH

    return y + 6
  }

  // ─── SECCIÓN 2: CONDICIONES DE LA VÍA Y RIESGOS ─────────────

  private renderSeccion2(
    doc: typeof PDFDocument.prototype,
    marginL: number,
    contentW: number,
    startY: number,
    data: RutogramaData
  ): number {
    let y = startY

    y = this.drawSectionTitle(doc, marginL, y, contentW, '2. CONDICIONES DE LA VÍA Y RIESGOS')

    // ── Sub-tabla 2A: Estado de la Vía ──
    const subTitleH = 13
    doc.rect(marginL, y, contentW, subTitleH).fillAndStroke(COLORS.primaryLight, COLORS.cellBorder)
    doc.fontSize(7).font('Roboto-Bold').fillColor(COLORS.primary)
      .text('ESTADO DE LA VÍA', marginL + 4, y + 3, { width: contentW - 8, align: 'center' })
    y += subTitleH

    // Grid de vías: 4 columnas con checkboxes
    const viaItems: { label: string; checked: boolean }[] = [
      { label: 'Trocha', checked: data.vias.trocha },
      { label: 'Destapada / Afirmado', checked: data.vias.afirmado },
      { label: 'Mixto', checked: data.vias.mixto },
      { label: 'Pavimentada', checked: data.vias.pavimentada },
    ]

    const checkRowH = 16
    const checkColW = contentW / 4

    for (let i = 0; i < viaItems.length; i++) {
      const x = marginL + (i * checkColW)
      this.drawCheckboxCell(doc, x, y, checkColW, checkRowH, viaItems[i].label, viaItems[i].checked)
    }
    y += checkRowH

    // ── Sub-tabla 2B: Riesgos de la Vía ──
    doc.rect(marginL, y, contentW, subTitleH).fillAndStroke(COLORS.primaryLight, COLORS.cellBorder)
    doc.fontSize(7).font('Roboto-Bold').fillColor(COLORS.primary)
      .text('RIESGOS IDENTIFICADOS EN LA VÍA', marginL + 4, y + 3, { width: contentW - 8, align: 'center' })
    y += subTitleH

    // Grid de riesgos: 3 columnas x 2 filas
    const riesgoItems: { label: string; checked: boolean }[] = [
      { label: 'Desniveles / Pendientes fuertes', checked: data.riesgos.desniveles },
      { label: 'Deslizamientos / Derrumbes', checked: data.riesgos.deslizamientos },
      { label: 'Sin señalización vial', checked: data.riesgos.sinSenalizacion },
      { label: 'Presencia de animales', checked: data.riesgos.animales },
      { label: 'Paso peatonal / Zonas pobladas', checked: data.riesgos.peatones },
      { label: 'Tráfico alto / Congestión', checked: data.riesgos.traficoAlto },
    ]

    const riskColW = contentW / 3
    // Row 1
    for (let i = 0; i < 3; i++) {
      const x = marginL + (i * riskColW)
      this.drawCheckboxCell(doc, x, y, riskColW, checkRowH, riesgoItems[i].label, riesgoItems[i].checked)
    }
    y += checkRowH
    // Row 2
    for (let i = 3; i < 6; i++) {
      const x = marginL + ((i - 3) * riskColW)
      this.drawCheckboxCell(doc, x, y, riskColW, checkRowH, riesgoItems[i].label, riesgoItems[i].checked)
    }
    y += checkRowH

    // ── Sub-tabla 2C: Peajes ──
    doc.rect(marginL, y, contentW, subTitleH).fillAndStroke(COLORS.primaryLight, COLORS.cellBorder)
    doc.fontSize(7).font('Roboto-Bold').fillColor(COLORS.primary)
      .text(`PEAJES EN LA RUTA (${data.peajes.length})`, marginL + 4, y + 3, { width: contentW - 8, align: 'center' })
    y += subTitleH

    if (data.peajes.length > 0) {
      const peajeRowH = 13
      // Header
      const pColW = [contentW * 0.08, contentW * 0.52, contentW * 0.20, contentW * 0.20]
      this.drawCell(doc, marginL, y, pColW[0], peajeRowH, '#', true, COLORS.lightGray)
      this.drawCell(doc, marginL + pColW[0], y, pColW[1], peajeRowH, 'NOMBRE DEL PEAJE', true, COLORS.lightGray)
      this.drawCell(doc, marginL + pColW[0] + pColW[1], y, pColW[2], peajeRowH, 'LATITUD', true, COLORS.lightGray)
      this.drawCell(doc, marginL + pColW[0] + pColW[1] + pColW[2], y, pColW[3], peajeRowH, 'LONGITUD', true, COLORS.lightGray)
      y += peajeRowH

      // Max 5 peajes para caber en 1 página
      data.peajes.slice(0, 5).forEach((peaje, idx) => {
        this.drawCell(doc, marginL, y, pColW[0], peajeRowH, `${idx + 1}`)
        this.drawCell(doc, marginL + pColW[0], y, pColW[1], peajeRowH, peaje.nombre)
        this.drawCell(doc, marginL + pColW[0] + pColW[1], y, pColW[2], peajeRowH, peaje.lat.toFixed(4))
        this.drawCell(doc, marginL + pColW[0] + pColW[1] + pColW[2], y, pColW[3], peajeRowH, peaje.lon.toFixed(4))
        y += peajeRowH
      })
    } else {
      const noPeajeH = 16
      this.drawCell(doc, marginL, y, contentW, noPeajeH, 'No se identificaron peajes en la ruta o no se pudo calcular la ruta')
      y += noPeajeH
    }

    return y + 6
  }

  // ─── SECCIÓN 3: CONTROLES OPERACIONALES ──────────────────────

  private renderSeccion3(
    doc: typeof PDFDocument.prototype,
    marginL: number,
    contentW: number,
    startY: number,
    data: RutogramaData,
    firmas: FirmaData[]
  ): number {
    let y = startY

    y = this.drawSectionTitle(doc, marginL, y, contentW, '3. CONTROLES OPERACIONALES')

    const rowH = 16
    const col1W = contentW * 0.30
    const col2W = contentW * 0.70

    // Paradas seguras
    this.drawCell(doc, marginL, y, col1W, rowH, 'PARADAS SEGURAS:', true, COLORS.sectionBg)
    this.drawCell(doc, marginL + col1W, y, col2W, rowH, 'Estaciones de servicio, bahías de parqueo, peajes, zonas autorizadas')
    y += rowH

    // Puntos de control
    this.drawCell(doc, marginL, y, col1W, rowH, 'PUNTOS DE CONTROL:', true, COLORS.sectionBg)
    this.drawCell(doc, marginL + col1W, y, col2W, rowH, 'Salida, llegada, puntos intermedios verificados por operaciones')
    y += rowH

    // Pernocta autorizada
    this.drawCell(doc, marginL, y, col1W, rowH, 'PERNOCTA AUTORIZADA:', true, COLORS.sectionBg)
    this.drawCell(doc, marginL + col1W, y, col2W, rowH, 'Según autorización del Área de Operaciones')
    y += rowH

    // Control de jornada
    this.drawCell(doc, marginL, y, col1W, rowH, 'CONTROL DE JORNADA:', true, COLORS.sectionBg)
    this.drawCell(doc, marginL + col1W, y, col2W, rowH, 'Máximo 10 horas de conducción, descanso mínimo de 30 min cada 4 horas (Res. 1565/2014)')
    y += rowH

    // Notificaciones
    this.drawCell(doc, marginL, y, col1W, rowH, 'NOTIFICACIONES:', true, COLORS.sectionBg)
    this.drawCell(doc, marginL + col1W, y, col2W, rowH, 'Reportar novedades al Centro de Operaciones y HSEQ')
    y += rowH

    // Equipos de emergencia
    this.drawCell(doc, marginL, y, col1W, rowH, 'EQUIPO EMERGENCIA:', true, COLORS.sectionBg)
    this.drawCell(doc, marginL + col1W, y, col2W, rowH, 'Botiquín, extintor, triángulos, chaleco reflectivo, linterna, kit de carretera')
    y += rowH

    // ── Espacio para firmas ──
    y += 10

    const firmaW = contentW / 2
    const firmaH = 58
    const imgAreaH = 38  // Espacio para la imagen de la firma
    const textAreaH = firmaH - imgAreaH // Espacio para nombre + cargo

    // ── Firma Jefe de Operaciones ──
    const firmaOps = firmas.find(f => f.cargo === 'Jefe de Operaciones')
    const boxOpsX = marginL
    const boxOpsW = firmaW - 5

    doc.rect(boxOpsX, y, boxOpsW, firmaH).stroke()
    // Línea separadora entre imagen y texto
    doc.moveTo(boxOpsX, y + imgAreaH).lineTo(boxOpsX + boxOpsW, y + imgAreaH).stroke()

    if (firmaOps?.imageBuffer) {
      try {
        doc.image(firmaOps.imageBuffer, boxOpsX + 4, y + 2, {
          fit: [boxOpsW - 8, imgAreaH - 4],
          align: 'center',
          valign: 'center'
        })
      } catch (err) {
        console.warn('[RutogramaService] Error dibujando firma Operaciones:', err)
      }
    }
    // Nombre + cargo dentro del recuadro (zona de texto)
    doc.fontSize(6).font('Roboto-Bold').fillColor(COLORS.darkGray)
      .text(firmaOps?.nombre || '', boxOpsX + 4, y + imgAreaH + 3, { width: boxOpsW - 8, align: 'center', lineBreak: false })
    doc.fontSize(5).font('Roboto').fillColor(COLORS.darkGray)
      .text('Jefe de Operaciones', boxOpsX + 4, y + imgAreaH + 12, { width: boxOpsW - 8, align: 'center', lineBreak: false })

    // ── Firma HSEQ ──
    const firmaHSEQ = firmas.find(f => f.cargo === 'Coordinadora HSEQ')
    const boxHseqX = marginL + firmaW

    doc.rect(boxHseqX, y, boxOpsW, firmaH).stroke()
    doc.moveTo(boxHseqX, y + imgAreaH).lineTo(boxHseqX + boxOpsW, y + imgAreaH).stroke()

    if (firmaHSEQ?.imageBuffer) {
      try {
        doc.image(firmaHSEQ.imageBuffer, boxHseqX + 4, y + 2, {
          fit: [boxOpsW - 8, imgAreaH - 4],
          align: 'center',
          valign: 'center'
        })
      } catch (err) {
        console.warn('[RutogramaService] Error dibujando firma HSEQ:', err)
      }
    }
    doc.fontSize(6).font('Roboto-Bold').fillColor(COLORS.darkGray)
      .text(firmaHSEQ?.nombre || '', boxHseqX + 4, y + imgAreaH + 3, { width: boxOpsW - 8, align: 'center', lineBreak: false })
    doc.fontSize(5).font('Roboto').fillColor(COLORS.darkGray)
      .text('Coordinadora HSEQ', boxHseqX + 4, y + imgAreaH + 12, { width: boxOpsW - 8, align: 'center', lineBreak: false })

    y += firmaH

    return y + 4
  }

  // ─── SECCIÓN MAPA (PÁGINA 2) ────────────────────────────────

  private renderSeccionMapa(
    doc: typeof PDFDocument.prototype,
    marginL: number,
    contentW: number,
    startY: number,
    pageH: number,
    data: RutogramaData,
    mapImageBuffer: Buffer
  ): void {
    let y = startY

    // ── Título de sección ──
    y = this.drawSectionTitle(doc, marginL, y, contentW, '4. MAPA DE LA RUTA')

    // ── Tabla de coordenadas ──
    const infoRowH = 16
    const col1W = contentW * 0.10  // Punto (A/B)
    const col2W = contentW * 0.30  // Ubicación
    const col3W = contentW * 0.30  // Dirección específica
    const col4W = contentW * 0.15  // Latitud
    const col5W = contentW * 0.15  // Longitud

    // Header de la tabla
    const headerCols = [
      { x: marginL, w: col1W, text: 'PUNTO' },
      { x: marginL + col1W, w: col2W, text: 'UBICACIÓN' },
      { x: marginL + col1W + col2W, w: col3W, text: 'DIRECCIÓN ESPECÍFICA' },
      { x: marginL + col1W + col2W + col3W, w: col4W, text: 'LATITUD' },
      { x: marginL + col1W + col2W + col3W + col4W, w: col5W, text: 'LONGITUD' },
    ]
    for (const col of headerCols) {
      doc.rect(col.x, y, col.w, infoRowH).fillAndStroke(COLORS.headerBg, COLORS.black)
      doc.fontSize(7).font('Roboto-Bold').fillColor(COLORS.headerText)
        .text(col.text, col.x + 4, y + 4, { width: col.w - 8, lineBreak: false })
    }
    y += infoRowH

    // Fila A - Origen
    this.drawCell(doc, marginL, y, col1W, infoRowH, '  A', true, '#fff7ed')
    this.drawCell(doc, marginL + col1W, y, col2W, infoRowH, `${data.origen.municipio} (${data.origen.departamento})`)
    this.drawCell(doc, marginL + col1W + col2W, y, col3W, infoRowH, data.origen.especifico || 'No especificada')
    this.drawCell(doc, marginL + col1W + col2W + col3W, y, col4W, infoRowH, data.origen.lat.toFixed(5))
    this.drawCell(doc, marginL + col1W + col2W + col3W + col4W, y, col5W, infoRowH, data.origen.lng.toFixed(5))
    // Orange dot for A
    doc.circle(marginL + 10, y + infoRowH / 2, 4).fill(COLORS.accent)
    doc.fontSize(5).font('Roboto-Bold').fillColor(COLORS.white)
      .text('A', marginL + 7.5, y + infoRowH / 2 - 3.5, { width: 6, align: 'center', lineBreak: false })
    y += infoRowH

    // Fila B - Destino
    this.drawCell(doc, marginL, y, col1W, infoRowH, '  B', true, '#ffebee')
    this.drawCell(doc, marginL + col1W, y, col2W, infoRowH, `${data.destino.municipio} (${data.destino.departamento})`)
    this.drawCell(doc, marginL + col1W + col2W, y, col3W, infoRowH, data.destino.especifico || 'No especificada')
    this.drawCell(doc, marginL + col1W + col2W + col3W, y, col4W, infoRowH, data.destino.lat.toFixed(5))
    this.drawCell(doc, marginL + col1W + col2W + col3W + col4W, y, col5W, infoRowH, data.destino.lng.toFixed(5))
    // Red dot for B
    doc.circle(marginL + 10, y + infoRowH / 2, 4).fill('#d32f2f')
    doc.fontSize(5).font('Roboto-Bold').fillColor(COLORS.white)
      .text('B', marginL + 7.5, y + infoRowH / 2 - 3.5, { width: 6, align: 'center', lineBreak: false })
    y += infoRowH

    // ── Fila resumen: Distancia y Duración ──
    const halfW = contentW / 2
    this.drawCell(doc, marginL, y, halfW, infoRowH,
      `DISTANCIA TOTAL: ${data.distanciaKm > 0 ? data.distanciaKm.toFixed(1) + ' km' : 'No calculada'}`,
      true, COLORS.sectionBg)
    this.drawCell(doc, marginL + halfW, y, halfW, infoRowH,
      `DURACIÓN ESTIMADA: ${data.duracionHoras > 0 ? data.duracionHoras.toFixed(1) + ' horas' : 'No calculada'}`,
      true, COLORS.sectionBg)
    y += infoRowH

    // ── Mapa ──
    y += 4

    const legendH = 30 // Espacio para leyenda de markers + disclaimer
    const mapAvailableH = pageH - y - 18 - legendH // bottom margin + leyenda
    const mapW = contentW
    const mapH = Math.min(mapAvailableH, contentW * 0.55) // Reducido para acomodar leyenda

    // Border around map
    doc.rect(marginL, y, mapW, mapH).lineWidth(1).strokeColor(COLORS.cellBorder).stroke()

    try {
      doc.image(mapImageBuffer, marginL + 1, y + 1, {
        width: mapW - 2,
        height: mapH - 2,
        fit: [mapW - 2, mapH - 2],
        align: 'center',
        valign: 'center'
      })
    } catch (err) {
      console.warn('[RutogramaService] Error drawing map image:', err)
      // Fallback text
      doc.fontSize(12).font('Roboto').fillColor(COLORS.darkGray)
        .text('Mapa no disponible', marginL, y + mapH / 2 - 10, { width: mapW, align: 'center' })
    }

    y += mapH

    // ── Leyenda de markers ──
    y += 4

    const legendItems = [
      { color: '#ea580c', label: 'A  Origen', letter: 'A' },
      { color: '#d32f2f', label: 'B  Destino', letter: 'B' },
      { color: '#f59e0b', label: 'P  Peaje', letter: 'P' },
      { color: '#2196f3', label: 'R  Restaurante', letter: 'R' },
      { color: '#9c27b0', label: 'S  Est. Servicio', letter: 'S' },
      { color: '#009688', label: 'H  Hospedaje', letter: 'H' },
    ]

    const itemW = contentW / legendItems.length
    const dotR = 4

    for (let i = 0; i < legendItems.length; i++) {
      const item = legendItems[i]
      const ix = marginL + i * itemW
      // Dot
      doc.circle(ix + 8, y + 5, dotR).fill(item.color)
      doc.fontSize(4).font('Roboto-Bold').fillColor(COLORS.white)
        .text(item.letter, ix + 8 - dotR, y + 5 - 3, { width: dotR * 2, align: 'center', lineBreak: false })
      // Label
      doc.fontSize(6).font('Roboto').fillColor(COLORS.darkGray)
        .text(item.label, ix + 16, y + 2, { width: itemW - 20, lineBreak: false })
    }

    y += 14
    doc.fontSize(5.5).font('Roboto').fillColor(COLORS.darkGray)
      .text(`Mapa generado con Mapbox • ${data.peajes.length} peaje(s) y ${data.paradasSeguras.length} parada(s) segura(s) identificadas • Las rutas son aproximadas`,
        marginL, y, { width: contentW, align: 'center', lineBreak: false })
  }

  // ─── DRAWING HELPERS ─────────────────────────────────────────

  private drawSectionTitle(
    doc: typeof PDFDocument.prototype,
    x: number,
    y: number,
    width: number,
    title: string
  ): number {
    const h = 15
    doc.rect(x, y, width, h).fillAndStroke(COLORS.headerBg, COLORS.black)
    doc.fontSize(8).font('Roboto-Bold').fillColor(COLORS.headerText)
      .text(title, x + 6, y + 3, { width: width - 12 })
    return y + h
  }

  private drawCell(
    doc: typeof PDFDocument.prototype,
    x: number,
    y: number,
    w: number,
    h: number,
    text: string,
    bold: boolean = false,
    bgColor: string | null = null
  ) {
    if (bgColor) {
      doc.rect(x, y, w, h).fillAndStroke(bgColor, COLORS.cellBorder)
    } else {
      doc.rect(x, y, w, h).strokeColor(COLORS.cellBorder).stroke()
    }

    doc.fontSize(7)
      .font(bold ? 'Roboto-Bold' : 'Roboto')
      .fillColor(COLORS.black)
      .text(text, x + 4, y + (h > 20 ? 4 : (h - 7) / 2), {
        width: w - 8,
        height: h - 4,
        ellipsis: true,
      })
  }

  private drawCheckboxCell(
    doc: typeof PDFDocument.prototype,
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    checked: boolean
  ) {
    // Cell border
    doc.rect(x, y, w, h).strokeColor(COLORS.cellBorder).stroke()

    // Checkbox
    const boxSize = 9
    const boxX = x + 6
    const boxY = y + (h - boxSize) / 2

    doc.rect(boxX, boxY, boxSize, boxSize).lineWidth(0.8).strokeColor(COLORS.black).stroke()

    if (checked) {
      // Draw checkmark in orange
      doc.save()
      doc.strokeColor(COLORS.checkOrange).lineWidth(1.5)
      doc.moveTo(boxX + 2, boxY + boxSize / 2)
        .lineTo(boxX + boxSize / 2 - 1, boxY + boxSize - 2)
        .lineTo(boxX + boxSize - 2, boxY + 2)
        .stroke()
      doc.restore()
    }

    // Label text
    doc.fontSize(7).font('Roboto').fillColor(COLORS.black)
      .text(label, boxX + boxSize + 4, y + (h - 7) / 2, { width: w - boxSize - 16 })
  }
}
