import PDFDocument from 'pdfkit';
import axios from 'axios';
import { prisma } from '../../config/prisma';

interface RutogramaData {
  servicioId: string;
  numeroRuta: string;
  fecha: string;
  origen: {
    municipio: string;
    especifico: string;
    lat: number;
    lng: number;
  };
  destino: {
    municipio: string;
    especifico: string;
    lat: number;
    lng: number;
  };
  distanciaKm: number;
  duracionHoras: number;
  velocidadSegura: number;
  rutaAlterna?: string;
  observaciones?: string;
}

export class RutogramaService {
  private readonly MAPBOX_TOKEN = process.env.VITE_MAPBOX_ACCESS_TOKEN || process.env.MAPBOX_ACCESS_TOKEN || '';
  private readonly OVERPASS_API = 'https://overpass-api.de/api/interpreter';

  constructor() {
    if (!this.MAPBOX_TOKEN) {
      console.warn('⚠️  [RutogramaService] MAPBOX_ACCESS_TOKEN no configurado');
    } else {
      console.log(`✅ [RutogramaService] Token Mapbox cargado: ${this.MAPBOX_TOKEN.substring(0, 10)}...`);
    }
  }

  /**
   * Genera un rutograma en PDF para un servicio
   */
  async generarRutograma(servicioId: string): Promise<Buffer> {
    console.log(`[RutogramaService] Generando rutograma para servicio ${servicioId}`);

    // 1. Obtener datos del servicio
    const servicio = await prisma.servicio.findUnique({
      where: { id: servicioId },
      include: {
        municipios_servicio_origen_idTomunicipios: true,
        municipios_servicio_destino_idTomunicipios: true,
        clientes: true,
        conductores: true,
        vehiculos: true
      }
    });

    if (!servicio) {
      throw new Error('Servicio no encontrado');
    }

    // 2. Calcular ruta con Mapbox
    const routeData = await this.calcularRuta(
      [servicio.origen_longitud, servicio.origen_latitud],
      [servicio.destino_longitud, servicio.destino_latitud]
    );

    // 3. Obtener peajes y puntos críticos
    const peajes = await this.obtenerPeajes(routeData.geometry);

    // 4. Generar mapa estático
    const mapaImagen = await this.generarMapaEstatico(
      routeData.geometry,
      peajes,
      [servicio.origen_longitud, servicio.origen_latitud],
      [servicio.destino_longitud, servicio.destino_latitud]
    );

    // 5. Generar PDF
    const pdfBuffer = await this.generarPDF({
      servicioId: servicio.id,
      numeroRuta: `RUTA-${servicio.id.substring(0, 8).toUpperCase()}`,
      fecha: new Date().toLocaleDateString('es-CO'),
      origen: {
        municipio: servicio.municipios_servicio_origen_idTomunicipios.nombre_municipio,
        especifico: servicio.origen_especifico || '',
        lat: servicio.origen_latitud || 0,
        lng: servicio.origen_longitud || 0
      },
      destino: {
        municipio: servicio.municipios_servicio_destino_idTomunicipios.nombre_municipio,
        especifico: servicio.destino_especifico || '',
        lat: servicio.destino_latitud || 0,
        lng: servicio.destino_longitud || 0
      },
      distanciaKm: routeData.distance / 1000,
      duracionHoras: routeData.duration / 3600,
      velocidadSegura: 80,
      observaciones: servicio.observaciones || '',
      mapaImagen,
      peajes,
      cliente: servicio.clientes?.nombre || 'N/A',
      conductor: servicio.conductores
        ? `${servicio.conductores.nombre} ${servicio.conductores.apellido}`
        : 'No asignado',
      vehiculo: servicio.vehiculos
        ? `${servicio.vehiculos.placa} - ${servicio.vehiculos.marca} ${servicio.vehiculos.modelo}`
        : 'No asignado'
    });

    return pdfBuffer;
  }

  /**
   * Calcula la ruta usando Mapbox Directions API
   */
  private async calcularRuta(
    origen: [number, number],
    destino: [number, number]
  ): Promise<any> {
    try {
      const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${origen[0]},${origen[1]};${destino[0]},${destino[1]}`;
      const params = {
        access_token: this.MAPBOX_TOKEN,
        geometries: 'geojson',
        overview: 'full',
        steps: true,
        language: 'es'
      };

      const response = await axios.get(url, { params });
      const route = response.data.routes[0];

      return {
        geometry: route.geometry,
        distance: route.distance,
        duration: route.duration,
        steps: route.legs[0].steps
      };
    } catch (error) {
      console.error('[RutogramaService] Error calculando ruta:', error);
      throw new Error('No se pudo calcular la ruta');
    }
  }

  /**
   * Obtiene peajes en la ruta usando OpenStreetMap Overpass API
   */
  private async obtenerPeajes(geometry: any): Promise<any[]> {
    try {
      // Crear bbox de la geometría
      const coords = geometry.coordinates;
      const lats = coords.map((c: number[]) => c[1]);
      const lngs = coords.map((c: number[]) => c[0]);
      const bbox = [
        Math.min(...lats),
        Math.min(...lngs),
        Math.max(...lats),
        Math.max(...lngs)
      ];

      // Query Overpass para peajes
      const query = `
        [out:json];
        (
          node["barrier"="toll_booth"](${bbox[0]},${bbox[1]},${bbox[2]},${bbox[3]});
          node["amenity"="toll_booth"](${bbox[0]},${bbox[1]},${bbox[2]},${bbox[3]});
        );
        out body;
      `;

      const response = await axios.post(
        this.OVERPASS_API,
        `data=${encodeURIComponent(query)}`,
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 10000
        }
      );

      return response.data.elements || [];
    } catch (error: any) {
      console.warn('[RutogramaService] Error obteniendo peajes:', error.message);
      return [];
    }
  }

  /**
   * Genera un mapa estático con Mapbox Static Images API
   */
  private async generarMapaEstatico(
    geometry: any,
    peajes: any[],
    origen: [number, number],
    destino: [number, number]
  ): Promise<Buffer> {
    try {
      // Colores aleatorios para los marcadores de peajes
      const coloresAleatorios = [
        'ff6b6b', // Rojo
        '4ecdc4', // Turquesa
        'ffe66d', // Amarillo
        '95e1d3', // Verde agua
        'ff8c42', // Naranja
        'a8e6cf', // Verde menta
        'ffd3b6', // Durazno
        'ffaaa5', // Rosa
        'aa96da', // Púrpura
        '3dc1d3'  // Cian
      ];

      // Extraer coordenadas de la geometría (simplificar para evitar URL muy larga)
      const coordinates = geometry.coordinates || [];
      // Tomar cada 10º punto para simplificar la línea
      const simplifiedCoords = coordinates.filter((_: any, i: number) => i % 10 === 0 || i === coordinates.length - 1);
      
      // Construir el path de la ruta (formato: lng,lat lng,lat lng,lat...)
      const routePath = simplifiedCoords.map((coord: [number, number]) => `${coord[0]},${coord[1]}`).join(' ');
      
      // Path overlay: path-{width}+{color}-{opacity}({encoded polyline})
      // Usamos color azul (#3b82f6) con grosor 5 y opacidad 0.8
      const pathOverlay = `path-5+3b82f6-0.8(${encodeURIComponent(routePath)})`;

      // Marcadores: origen (verde), destino (rojo)
      const markers: string[] = [];
      markers.push(`pin-l-a+22c55e(${origen[0]},${origen[1]})`); // Origen verde con letra A
      markers.push(`pin-l-b+ef4444(${destino[0]},${destino[1]})`); // Destino rojo con letra B

      // Agregar peajes con números (1-9) y colores aleatorios (máximo 10)
      peajes.slice(0, 10).forEach((peaje, index) => {
        const colorAleatorio = coloresAleatorios[index % coloresAleatorios.length];
        const numero = (index + 1) % 10; // Números del 1 al 9, luego 0
        markers.push(`pin-s-${numero}+${colorAleatorio}(${peaje.lon},${peaje.lat})`);
      });

      // Calcular bbox manualmente para aplicar zoom out del 10%
      const allLats = [
        origen[1],
        destino[1],
        ...peajes.slice(0, 10).map(p => p.lat)
      ];
      const allLngs = [
        origen[0],
        destino[0],
        ...peajes.slice(0, 10).map(p => p.lon)
      ];

      const minLng = Math.min(...allLngs);
      const maxLng = Math.max(...allLngs);
      const minLat = Math.min(...allLats);
      const maxLat = Math.max(...allLats);

      // Aplicar zoom out del 10% adicional (padding)
      const lngPadding = (maxLng - minLng) * 0.10;
      const latPadding = (maxLat - minLat) * 0.10;

      const bbox = [
        (minLng - lngPadding).toFixed(6),
        (minLat - latPadding).toFixed(6),
        (maxLng + lngPadding).toFixed(6),
        (maxLat + latPadding).toFixed(6)
      ].join(',');

      // Construir URL con path de ruta + marcadores + bbox personalizado
      // El order importa: primero el path (línea), luego los markers (puntos)
      const overlays = `${pathOverlay},${markers.join(',')}`;
      const url = `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/${overlays}/[${bbox}]/1200x800@2x`;
      
      const params = {
        access_token: this.MAPBOX_TOKEN,
        attribution: false,
        logo: false
      };

      console.log('[RutogramaService] Bbox aplicado:', bbox);
      console.log('[RutogramaService] Peajes en el mapa:', peajes.slice(0, 10).length);
      console.log('[RutogramaService] URL mapa (longitud):', url.length);

      const response = await axios.get(url, {
        params,
        responseType: 'arraybuffer',
        timeout: 30000
      });

      return Buffer.from(response.data);
    } catch (error) {
      console.error('[RutogramaService] Error generando mapa estático:', error);
      if (axios.isAxiosError(error)) {
        console.error('Status:', error.response?.status);
        console.error('StatusText:', error.response?.statusText);
      }
      throw new Error('No se pudo generar el mapa');
    }
  }

  /**
   * Genera el PDF del rutograma
   */
  private async generarPDF(data: any): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'LETTER',
        margins: { top: 40, bottom: 40, left: 40, right: 40 }
      });

      const buffers: Buffer[] = [];
      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', reject);

      // Header
      doc
        .fontSize(20)
        .font('Helvetica-Bold')
        .fillColor('#f97316')
        .text('RUTOGRAMA', { align: 'center' });

      doc
        .fontSize(10)
        .fillColor('#000')
        .text(`Versión: 2`, { align: 'right' })
        .text(`Fecha: ${data.fecha}`, { align: 'right' })
        .moveDown();

      // Datos Generales
      doc
        .fontSize(14)
        .font('Helvetica-Bold')
        .fillColor('#f97316')
        .text('DATOS GENERALES', { underline: true })
        .moveDown(0.5);

      doc.fontSize(10).font('Helvetica').fillColor('#000');

      this.agregarFila(doc, 'No. RUTA:', data.numeroRuta);
      this.agregarFila(
        doc,
        'ORIGEN / DESTINO:',
        `${data.origen.municipio} - ${data.destino.municipio}`
      );
      this.agregarFila(doc, 'DISTANCIA TOTAL:', `${data.distanciaKm.toFixed(1)} km`);
      this.agregarFila(
        doc,
        'DURACIÓN ESTIMADA:',
        `${data.duracionHoras.toFixed(1)} horas`
      );
      this.agregarFila(doc, 'VELOCIDAD SEGURA:', `${data.velocidadSegura} km/h`);
      this.agregarFila(doc, 'CLIENTE:', data.cliente);
      this.agregarFila(doc, 'CONDUCTOR:', data.conductor);
      this.agregarFila(doc, 'VEHÍCULO:', data.vehiculo);

      doc.moveDown();

      // Origen y Destino Específicos
      doc
        .fontSize(12)
        .font('Helvetica-Bold')
        .fillColor('#f97316')
        .text('ORIGEN Y DESTINO ESPECÍFICOS')
        .moveDown(0.5);

      doc.fontSize(10).font('Helvetica').fillColor('#000');
      this.agregarFila(doc, 'Origen:', data.origen.especifico || data.origen.municipio);
      this.agregarFila(
        doc,
        'Coordenadas:',
        `${data.origen.lat.toFixed(6)}, ${data.origen.lng.toFixed(6)}`
      );
      this.agregarFila(doc, 'Destino:', data.destino.especifico || data.destino.municipio);
      this.agregarFila(
        doc,
        'Coordenadas:',
        `${data.destino.lat.toFixed(6)}, ${data.destino.lng.toFixed(6)}`
      );

      doc.moveDown();

      // Mapa
      if (data.mapaImagen) {
        doc.addPage();
        doc
          .fontSize(14)
          .font('Helvetica-Bold')
          .fillColor('#f97316')
          .text('MAPA DE RUTA', { align: 'center' })
          .moveDown();

        doc.image(data.mapaImagen, {
          fit: [500, 400],
          align: 'center'
        });

        doc.moveDown();
      }

      // Peajes
      if (data.peajes && data.peajes.length > 0) {
        doc
          .fontSize(12)
          .font('Helvetica-Bold')
          .fillColor('#f97316')
          .text(`PEAJES IDENTIFICADOS (${Math.min(data.peajes.length, 10)})`)
          .moveDown(0.5);

        doc.fontSize(9).font('Helvetica').fillColor('#666');
        doc.text('Los números corresponden a los marcadores en el mapa', { align: 'center' });
        doc.moveDown(0.5);

        // Colores de los marcadores (deben coincidir con generarMapaEstatico)
        const colores = [
          { hex: '#ff6b6b', nombre: 'Rojo' },
          { hex: '#4ecdc4', nombre: 'Turquesa' },
          { hex: '#ffe66d', nombre: 'Amarillo' },
          { hex: '#95e1d3', nombre: 'Verde agua' },
          { hex: '#ff8c42', nombre: 'Naranja' },
          { hex: '#a8e6cf', nombre: 'Verde menta' },
          { hex: '#ffd3b6', nombre: 'Durazno' },
          { hex: '#ffaaa5', nombre: 'Rosa' },
          { hex: '#aa96da', nombre: 'Púrpura' },
          { hex: '#3dc1d3', nombre: 'Cian' }
        ];

        doc.fontSize(10).font('Helvetica').fillColor('#000');
        data.peajes.slice(0, 10).forEach((peaje: any, index: number) => {
          const numero = (index + 1) % 10 || 10;
          const color = colores[index % colores.length];
          
          // Número con círculo de color
          doc
            .circle(doc.x, doc.y + 5, 8)
            .fillAndStroke(color.hex, '#333')
            .fillColor('#fff')
            .fontSize(8)
            .font('Helvetica-Bold')
            .text(numero.toString(), doc.x - 8, doc.y - 3, { width: 16, align: 'center' });
          
          // Información del peaje
          doc
            .fontSize(10)
            .font('Helvetica')
            .fillColor('#000')
            .text(
              ` ${peaje.tags?.name || 'Peaje sin nombre'} - ${peaje.lat?.toFixed(4)}, ${peaje.lon?.toFixed(4)}`,
              doc.x + 20,
              doc.y - 10
            );
          
          doc.moveDown(0.3);
        });

        doc.moveDown();
      }

      // Observaciones
      if (data.observaciones) {
        doc
          .fontSize(12)
          .font('Helvetica-Bold')
          .fillColor('#f97316')
          .text('OBSERVACIONES')
          .moveDown(0.5);

        doc.fontSize(10).font('Helvetica').fillColor('#000').text(data.observaciones);
      }

      // Footer
      doc
        .fontSize(8)
        .fillColor('#666')
        .text(
          'Señor conductor: cualquier ruta no planificada debe ser autorizada por el Área de Operaciones.',
          40,
          doc.page.height - 60,
          { align: 'center', width: doc.page.width - 80 }
        );

      doc.end();
    });
  }

  private agregarFila(doc: PDFKit.PDFDocument, label: string, value: string) {
    doc
      .font('Helvetica-Bold')
      .text(label, { continued: true })
      .font('Helvetica')
      .text(` ${value}`);
  }
}
