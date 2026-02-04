# 🗺️ Sistema de Generación de Rutogramas

## Descripción

Sistema automatizado para generar rutogramas profesionales en PDF para cada servicio de transporte, incluyendo:

- ✅ Mapa con la ruta trazada
- ✅ Marcadores de origen y destino
- ✅ Identificación de peajes en la ruta
- ✅ Distancia y duración estimada
- ✅ Coordenadas GPS
- ✅ Información del servicio (cliente, conductor, vehículo)
- ✅ Observaciones y recomendaciones de seguridad

## Stack Tecnológico

### APIs Utilizadas (100% GRATU ITAS)

1. **Mapbox Directions API**
   - Cálculo de rutas optimizadas
   - Geometría de la ruta (polyline)
   - Duración y distancia
   - Límite: 50,000 requests/mes gratis

2. **Mapbox Static Images API**
   - Generación de mapas estáticos con la ruta
   - Marcadores personalizados
   - Alta calidad (1200x800@2x)
   - Límite: 50,000 requests/mes gratis

3. **OpenStreetMap Overpass API**
   - Identificación de peajes
   - Completamente gratuito
   - Sin límites estrictos

### Librerías

- **PDFKit**: Generación de PDFs
- **Polyline**: Codificación de rutas para Mapbox
- **Axios**: Peticiones HTTP

## Instalación

```bash
# Instalar dependencias
npm install pdfkit @types/pdfkit polyline @types/polyline

# Configurar variable de entorno
# Agregar a .env:
MAPBOX_ACCESS_TOKEN=tu_token_aqui
```

## Uso

### 1. Generar Rutograma desde el Backend

```typescript
// Endpoint: GET /api/servicios/:id/rutograma

// Ejemplo con curl:
curl -X GET "http://localhost:4000/api/servicios/abc-123-def/rutograma" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  --output rutograma.pdf
```

### 2. Desde el Frontend (SvelteKit)

```svelte
<script>
  async function descargarRutograma(servicioId: string) {
    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_URL}/api/servicios/${servicioId}/rutograma`,
        {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        }
      );

      if (!response.ok) {
        throw new Error('Error al generar rutograma');
      }

      // Crear blob y descargar
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `rutograma-${servicioId}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Error:', error);
    }
  }
</script>

<button on:click={() => descargarRutograma(servicio.id)}>
  📄 Descargar Rutograma
</button>
```

## Características del PDF Generado

### Secciones Incluidas

1. **Header**
   - Título "RUTOGRAMA"
   - Versión y fecha

2. **Datos Generales**
   - Número de ruta
   - Origen / Destino
   - Distancia total (km)
   - Duración estimada (horas)
   - Velocidad segura recomendada
   - Cliente
   - Conductor asignado
   - Vehículo asignado

3. **Origen y Destino Específicos**
   - Direcciones específicas
   - Coordenadas GPS (lat, lng)

4. **Mapa de Ruta**
   - Imagen del mapa con la ruta trazada
   - Marcador verde: Origen
   - Marcador rojo: Destino
   - Marcadores amarillos: Peajes identificados
   - Ruta en color azul

5. **Peajes Identificados**
   - Lista de peajes encontrados en la ruta
   - Coordenadas de cada peaje

6. **Observaciones**
   - Notas específicas del servicio
   - Recomendaciones de seguridad

7. **Footer**
   - Aviso de autorización de rutas

## Personalización

### Cambiar Colores de Marcadores

En `rutograma.service.ts`, modifica los marcadores:

```typescript
markers.push(`pin-l-marker+00ff00(${origen[0]},${origen[1]})`); // Verde
markers.push(`pin-l-marker+ff0000(${destino[0]},${destino[1]})`); // Rojo
markers.push(`pin-s-toll+ffff00(${peaje.lon},${peaje.lat})`); // Amarillo
```

Colores disponibles:
- `+00ff00` - Verde
- `+ff0000` - Rojo
- `+ffff00` - Amarillo
- `+0080ff` - Azul
- `+ff00ff` - Magenta
- `+000000` - Negro

### Cambiar Tamaño del Mapa

```typescript
const url = `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/${overlays}/auto/1200x800@2x`;
//                                                                                      ^^^^^^^^
//                                                                                      ancho x alto
```

Tamaños recomendados:
- `800x600` - Estándar
- `1200x800` - Alta definición
- `1600x1200` - Muy alta definición

### Cambiar Estilo del Mapa

Estilos disponibles en Mapbox:
- `streets-v12` - Calles (predeterminado)
- `satellite-v9` - Satélite
- `outdoors-v12` - Exterior
- `light-v11` - Claro
- `dark-v11` - Oscuro

```typescript
const url = `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/...`;
```

### Agregar Más Puntos de Interés

Modifica la query de Overpass para incluir otros elementos:

```typescript
const query = `
  [out:json];
  (
    node["barrier"="toll_booth"](${bbox[0]},${bbox[1]},${bbox[2]},${bbox[3]});
    node["amenity"="fuel"](${bbox[0]},${bbox[1]},${bbox[2]},${bbox[3]});        // Gasolineras
    node["amenity"="restaurant"](${bbox[0]},${bbox[1]},${bbox[2]},${bbox[3]});  // Restaurantes
    node["tourism"="hotel"](${bbox[0]},${bbox[1]},${bbox[2]},${bbox[3]});       // Hoteles
  );
  out body;
`;
```

## Límites y Consideraciones

### Límites de API Gratuitas

- **Mapbox**: 50,000 requests/mes
  - Directions API: ~1 request por rutograma
  - Static Images API: ~1 request por rutograma
  - **Total**: ~25,000 rutogramas/mes gratis

- **Overpass API**: Sin límite estricto
  - Recomendación: No más de 1 request por segundo
  - Implementado timeout de 10 segundos

### Optimizaciones

1. **Cache de rutas frecuentes**
   ```typescript
   // TODO: Implementar cache Redis
   const cacheKey = `ruta:${origenId}:${destinoId}`;
   const cached = await redis.get(cacheKey);
   if (cached) return JSON.parse(cached);
   ```

2. **Generación asíncrona**
   ```typescript
   // Para múltiples rutogramas, usar queue
   await bullQueue.add('generar-rutograma', { servicioId });
   ```

3. **Almacenamiento de PDFs**
   ```typescript
   // Guardar en S3 y servir URL en lugar de regenerar
   const s3Url = await uploadToS3(pdfBuffer, `rutogramas/${servicioId}.pdf`);
   ```

## Troubleshooting

### Error: "Not Authorized - Invalid Token"

**Causa**: Token de Mapbox inválido o expirado

**Solución**:
1. Ve a https://account.mapbox.com/access-tokens/
2. Copia tu token público (Default public token)
3. Actualiza la variable `MAPBOX_ACCESS_TOKEN` en `.env`
4. Reinicia el servidor

### Error: "No se pudo calcular la ruta"

**Causa**: Coordenadas inválidas o fuera de rango

**Solución**:
- Verifica que las coordenadas sean válidas:
  - Latitud: entre -90 y 90
  - Longitud: entre -180 y 180
- Para Colombia:
  - Latitud: entre -4 y 13
  - Longitud: entre -79 y -66

### El mapa no aparece en el PDF

**Causa**: Error al generar la imagen estática

**Solución**:
1. Verifica que el token tenga permisos para Static Images API
2. Revisa los logs para ver el error específico
3. Prueba la URL del mapa directamente en el navegador

### Peajes no se identifican

**Causa**: OpenStreetMap puede no tener todos los peajes registrados

**Solución**:
- Contribuir a OpenStreetMap agregando los peajes faltantes
- O mantener una base de datos local de peajes conocidos:
  ```typescript
  const peajesConocidos = [
    { nombre: 'Peaje Chirajara', lat: 4.5234, lng: -73.2345 },
    { nombre: 'Peaje Yopal', lat: 5.3387, lng: -72.3958 }
  ];
  ```

## Mejoras Futuras

### Corto Plazo
- [ ] Agregar waypoints intermedios (paradas programadas)
- [ ] Incluir alertas de tráfico en tiempo real
- [ ] Mostrar clima en la ruta

### Mediano Plazo
- [ ] Generar rutas alternativas
- [ ] Calcular costos de peajes
- [ ] Estimar consumo de combustible
- [ ] Incluir puntos de interés (gasolineras, hoteles, restaurantes)

### Largo Plazo
- [ ] Integración con GPS en tiempo real
- [ ] Alertas de desviación de ruta
- [ ] Historial de rutas completadas
- [ ] Análisis de rutas óptimas por histórico

## Referencias

- [Mapbox Directions API](https://docs.mapbox.com/api/navigation/directions/)
- [Mapbox Static Images API](https://docs.mapbox.com/api/maps/static-images/)
- [Overpass API](https://overpass-api.de/)
- [PDFKit Documentation](https://pdfkit.org/)
- [OpenStreetMap Wiki - Toll Roads](https://wiki.openstreetmap.org/wiki/Tag:barrier%3Dtoll_booth)

## Licencia

MIT

## Autor

Cotransmeq - Sistema de Gestión de Transporte

