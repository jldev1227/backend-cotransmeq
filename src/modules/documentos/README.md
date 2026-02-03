# Módulo de Documentos

Este módulo permite visualizar y gestionar documentos almacenados en AWS S3, específicamente planillas PDF asociadas a recargos.

## Endpoints

### 1. Ver Documento (Stream directo)
**GET** `/api/documentos/ver/:key`

Retorna el archivo directamente como stream para visualización en el navegador.

**Parámetros:**
- `key` (path): La clave completa del archivo en S3 (ej: `planillas/recargos/{id}/{archivo}.pdf`)

**Respuesta:**
- Content-Type: `application/pdf`
- Content-Disposition: `inline`
- Stream del archivo

**Ejemplo:**
```
GET http://localhost:4000/api/documentos/ver/planillas/recargos/b3cc6be4-8d36-4469-8ca6-79f19028b413/8837d79c-7e12-484f-8916-dd22370122c2.pdf
```

### 2. Obtener URL Firmada
**GET** `/api/documentos/url-firma?key={key}`

Genera una URL firmada con tiempo de expiración (15 minutos por defecto) para acceso temporal al documento.

**Parámetros:**
- `key` (query): La clave del archivo en S3

**Respuesta:**
```json
{
  "success": true,
  "data": {
    "url": "https://cotransmeq.s3.us-east-2.amazonaws.com/..."
  }
}
```

## Configuración

Variables de entorno requeridas en `.env`:

```env
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
AWS_REGION=us-east-2
AWS_S3_BUCKET_NAME=cotransmeq
```

## Uso desde el Frontend

### Visualizar PDF
El botón "Ver PDF" en el modal de recargos abre el documento en una nueva pestaña:

```typescript
async function visualizarPDF() {
  const baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:4000';
  const pdfUrl = `${baseUrl}/api/documentos/ver/${encodeURIComponent(recargo.planilla_s3key)}`;
  window.open(pdfUrl, '_blank');
}
```

## Características

- ✅ Stream directo desde S3 (sin almacenamiento temporal)
- ✅ Visualización inline en el navegador
- ✅ Manejo de errores (404 si no existe)
- ✅ Headers apropiados para PDF
- ✅ URLs firmadas con expiración
- ✅ Compatible con todos los navegadores modernos

## Seguridad

- Las rutas están bajo el prefijo `/api` con el middleware de autenticación
- Las URLs firmadas expiran después de 15 minutos
- Los archivos se sirven con Content-Disposition: inline (no descarga automática)
- Validación de existencia del archivo antes de servir
