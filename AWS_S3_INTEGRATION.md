# Integración con AWS S3 para Archivos y URLs Firmadas

## 📋 Estado Actual

### ✅ Ya Configurado
- **Credenciales AWS**: Configuradas en `.env`
  - `AWS_ACCESS_KEY_ID=<tu_access_key_id>`
  - `AWS_SECRET_ACCESS_KEY=<tu_secret_access_key>`
  - `AWS_REGION=us-east-2`
  - `AWS_S3_BUCKET_NAME=cotransmeq`

- **Módulo AWS**: `src/config/aws.ts`
  - ✅ `getS3SignedUrl()` - Genera URLs firmadas
  - ✅ `uploadToS3()` - Sube archivos
  - ✅ `deleteFromS3()` - Elimina archivos
  - ✅ `checkS3ObjectExists()` - Verifica existencia

- **Módulos con S3**:
  - ✅ **Conductores**: Ya usa S3 para fotos
  - ✅ **Servicios**: Ya genera URLs firmadas para fotos de conductores

### ⚠️ Pendiente de Migrar a S3

1. **Tabla `documento`**
   - `ruta_archivo`: String (path local)
   - `nombre_archivo`: String
   - Tipo: PDFs de licencias, cédulas, etc.

2. **Tabla `liquidaciones`**
   - `archivo_planilla_url`: String (URL o path)
   - `archivo_planilla_nombre`: String
   - `archivo_planilla_tipo`: String (MIME type)
   - `archivo_planilla_tama_o`: Int (tamaño)
   - Tipo: PDFs de planillas de liquidación

---

## 🎯 Plan de Migración

### Fase 1: Migrar Archivos Existentes a S3

#### 1.1 Documentos (Tabla `documento`)

**Estructura de keys en S3:**
```
documentos/{conductor_id}/{tipo_documento}/{filename}
```

Ejemplo:
```
documentos/123e4567-e89b-12d3-a456-426614174000/licencia/licencia_conduccion.pdf
documentos/123e4567-e89b-12d3-a456-426614174000/cedula/cedula_ciudadania.pdf
```

**Script de Migración:**
```typescript
// scripts/migrate-documentos-to-s3.ts
import { PrismaClient } from '@prisma/client'
import { uploadToS3 } from '../src/config/aws'
import * as fs from 'fs/promises'
import * as path from 'path'

const prisma = new PrismaClient()

async function migrateDocumentosToS3() {
  const documentos = await prisma.documento.findMany()
  
  for (const doc of documentos) {
    if (!doc.ruta_archivo) continue
    
    try {
      // Leer archivo del sistema local
      const filePath = path.join(process.cwd(), doc.ruta_archivo)
      const fileBuffer = await fs.readFile(filePath)
      
      // Generar key de S3
      const s3Key = `documentos/${doc.conductor_id || doc.vehiculo_id}/${doc.tipo_documento}/${doc.nombre_archivo}`
      
      // Subir a S3
      await uploadToS3(s3Key, fileBuffer, 'application/pdf')
      
      // Actualizar registro en BD
      await prisma.documento.update({
        where: { id: doc.id },
        data: { ruta_archivo: s3Key }
      })
      
      console.log(`✅ Migrado: ${doc.nombre_archivo}`)
    } catch (error) {
      console.error(`❌ Error migrando ${doc.nombre_archivo}:`, error)
    }
  }
}

migrateDocumentosToS3()
```

#### 1.2 Planillas de Liquidación (Tabla `liquidaciones`)

**Estructura de keys en S3:**
```
liquidaciones/{conductor_id}/{periodo}/{filename}
```

Ejemplo:
```
liquidaciones/123e4567-e89b-12d3-a456-426614174000/2026-01/planilla_enero_2026.pdf
```

**Script de Migración:**
```typescript
// scripts/migrate-planillas-to-s3.ts
import { PrismaClient } from '@prisma/client'
import { uploadToS3 } from '../src/config/aws'
import * as fs from 'fs/promises'
import * as path from 'path'

const prisma = new PrismaClient()

async function migratePlanillasToS3() {
  const liquidaciones = await prisma.liquidaciones.findMany({
    where: {
      archivo_planilla_url: { not: null }
    }
  })
  
  for (const liq of liquidaciones) {
    if (!liq.archivo_planilla_url) continue
    
    try {
      // Si ya es una URL de S3, saltar
      if (liq.archivo_planilla_url.startsWith('liquidaciones/')) {
        console.log(`⏭️  Ya en S3: ${liq.archivo_planilla_nombre}`)
        continue
      }
      
      // Leer archivo del sistema local
      const filePath = path.join(process.cwd(), liq.archivo_planilla_url)
      const fileBuffer = await fs.readFile(filePath)
      
      // Generar key de S3
      const periodo = `${liq.periodo_start.getFullYear()}-${String(liq.periodo_start.getMonth() + 1).padStart(2, '0')}`
      const s3Key = `liquidaciones/${liq.conductor_id}/${periodo}/${liq.archivo_planilla_nombre}`
      
      // Subir a S3
      await uploadToS3(s3Key, fileBuffer, liq.archivo_planilla_tipo || 'application/pdf')
      
      // Actualizar registro en BD
      await prisma.liquidaciones.update({
        where: { id: liq.id },
        data: { archivo_planilla_url: s3Key }
      })
      
      console.log(`✅ Migrado: ${liq.archivo_planilla_nombre}`)
    } catch (error) {
      console.error(`❌ Error migrando ${liq.archivo_planilla_nombre}:`, error)
    }
  }
}

migratePlanillasToS3()
```

---

### Fase 2: Actualizar Servicios para Servir URLs Firmadas

#### 2.1 Servicio de Documentos

**Actualizar `documentos.service.ts`:**

```typescript
import { getS3SignedUrl } from '../../config/aws'

// Agregar transformación de URLs
async function transformDocumentoData(documento: any) {
  if (documento && documento.ruta_archivo) {
    try {
      // Si es una key de S3, generar URL firmada
      if (documento.ruta_archivo.startsWith('documentos/')) {
        documento.url_firmada = await getS3SignedUrl(documento.ruta_archivo, 3600) // 1 hora
      }
    } catch (error) {
      console.error('Error generando URL firmada:', error)
      documento.url_firmada = null
    }
  }
  return documento
}

// Aplicar en métodos de consulta
async findByConduc</s>
(documento: string) {
  const documentos = await prisma.documento.findMany({
    where: { conductor_id: conductorId }
  })
  
  // Transformar cada documento
  return Promise.all(documentos.map(transformDocumentoData))
}
```

#### 2.2 Servicio de Liquidaciones

**Actualizar `liquidaciones.service.ts`:**

```typescript
import { getS3SignedUrl } from '../../config/aws'

async function transformLiquidacionData(liquidacion: any) {
  if (liquidacion && liquidacion.archivo_planilla_url) {
    try {
      // Si es una key de S3, generar URL firmada
      if (liquidacion.archivo_planilla_url.startsWith('liquidaciones/')) {
        liquidacion.archivo_planilla_url_firmada = await getS3SignedUrl(
          liquidacion.archivo_planilla_url, 
          7200 // 2 horas para PDFs grandes
        )
      }
    } catch (error) {
      console.error('Error generando URL firmada para planilla:', error)
      liquidacion.archivo_planilla_url_firmada = null
    }
  }
  return liquidacion
}

// Aplicar en métodos de consulta
async findById(id: string) {
  const liquidacion = await prisma.liquidaciones.findUnique({
    where: { id }
  })
  
  if (!liquidacion) return null
  
  return transformLiquidacionData(liquidacion)
}
```

---

### Fase 3: Actualizar Endpoints de Upload

#### 3.1 Upload de Documentos

**Actualizar `documentos.controller.ts`:**

```typescript
@Post('upload')
@UseInterceptors(FileInterceptor('file'))
async uploadDocumento(
  @UploadedFile() file: Express.Multer.File,
  @Body() data: UploadDocumentoDto
) {
  // Generar key de S3
  const s3Key = `documentos/${data.conductor_id || data.vehiculo_id}/${data.tipo_documento}/${file.originalname}`
  
  // Subir a S3
  await uploadToS3(s3Key, file.buffer, file.mimetype)
  
  // Guardar en BD con la key de S3
  const documento = await prisma.documento.create({
    data: {
      nombre_archivo: file.originalname,
      ruta_archivo: s3Key, // Guardar key de S3, no path local
      tipo_documento: data.tipo_documento,
      conductor_id: data.conductor_id,
      vehiculo_id: data.vehiculo_id
    }
  })
  
  // Retornar con URL firmada
  return {
    ...documento,
    url_firmada: await getS3SignedUrl(s3Key, 3600)
  }
}
```

#### 3.2 Upload de Planillas

**Actualizar `liquidaciones.controller.ts`:**

```typescript
@Post(':id/planilla')
@UseInterceptors(FileInterceptor('file'))
async uploadPlanilla(
  @Param('id') liquidacionId: string,
  @UploadedFile() file: Express.Multer.File
) {
  const liquidacion = await prisma.liquidaciones.findUnique({
    where: { id: liquidacionId }
  })
  
  if (!liquidacion) throw new NotFoundException()
  
  // Generar key de S3
  const periodo = `${liquidacion.periodo_start.getFullYear()}-${String(liquidacion.periodo_start.getMonth() + 1).padStart(2, '0')}`
  const s3Key = `liquidaciones/${liquidacion.conductor_id}/${periodo}/${file.originalname}`
  
  // Subir a S3
  await uploadToS3(s3Key, file.buffer, file.mimetype)
  
  // Actualizar BD
  await prisma.liquidaciones.update({
    where: { id: liquidacionId },
    data: {
      archivo_planilla_url: s3Key,
      archivo_planilla_nombre: file.originalname,
      archivo_planilla_tipo: file.mimetype,
      archivo_planilla_tama_o: file.size
    }
  })
  
  return {
    success: true,
    url_firmada: await getS3SignedUrl(s3Key, 7200)
  }
}
```

---

## 🔒 Seguridad

### URLs Firmadas - Tiempos de Expiración Recomendados

| Tipo de Archivo | Tiempo | Razón |
|-----------------|--------|-------|
| Fotos de conductores | 1 hora (3600s) | Se usan en listados, pueden recargarse |
| Documentos PDF | 2 horas (7200s) | Archivos más grandes, descarga más lenta |
| Planillas de liquidación | 2 horas (7200s) | PDFs grandes, usuario puede necesitar tiempo |

### Permisos de Bucket S3

Asegúrate de que el bucket `cotransmeq` tenga:

1. **Block Public Access**: ✅ Activado (todos los archivos privados)
2. **Bucket Policy**: Solo acceso mediante IAM credentials
3. **CORS Configuration**:
```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["GET", "PUT", "POST", "DELETE"],
    "AllowedOrigins": [
      "http://localhost:3000",
      "http://localhost:5173",
      "https://tu-dominio-produccion.com"
    ],
    "ExposeHeaders": ["ETag"]
  }
]
```

---

## 📊 Estructura Final del Bucket S3

```
cotransmeq/
├── conductores/
│   └── {conductor_id}/
│       └── fotos/
│           └── foto_perfil.jpg
├── documentos/
│   └── {conductor_id o vehiculo_id}/
│       ├── licencia/
│       │   └── licencia_conduccion.pdf
│       ├── cedula/
│       │   └── cedula_ciudadania.pdf
│       └── soat/
│           └── soat_2026.pdf
└── liquidaciones/
    └── {conductor_id}/
        └── {YYYY-MM}/
            └── planilla_liquidacion.pdf
```

---

## ✅ Checklist de Implementación

### Migración de Datos
- [ ] Ejecutar script de migración de documentos
- [ ] Ejecutar script de migración de planillas
- [ ] Verificar que todos los archivos estén en S3
- [ ] Eliminar archivos locales antiguos (hacer backup primero)

### Actualización de Código
- [ ] Actualizar `documentos.service.ts` con transformación de URLs
- [ ] Actualizar `liquidaciones.service.ts` con transformación de URLs
- [ ] Actualizar endpoints de upload para usar S3
- [ ] Agregar manejo de errores para S3

### Testing
- [ ] Probar descarga de documentos existentes
- [ ] Probar upload de nuevos documentos
- [ ] Probar descarga de planillas
- [ ] Probar upload de nuevas planillas
- [ ] Verificar URLs firmadas expiren correctamente
- [ ] Probar desde frontend que las URLs funcionen

### Seguridad
- [ ] Verificar permisos del bucket S3
- [ ] Configurar CORS en S3
- [ ] Asegurar que no haya acceso público
- [ ] Implementar rate limiting en endpoints de descarga

### Documentación
- [ ] Actualizar README con nueva estructura de archivos
- [ ] Documentar endpoints de upload/download
- [ ] Crear guía para el equipo de desarrollo

---

## 🚀 Comandos Útiles

### Ejecutar Migración
```bash
npm run migrate:documentos:s3
npm run migrate:planillas:s3
```

### Verificar Archivos en S3
```bash
aws s3 ls s3://cotransmeq/documentos/ --recursive
aws s3 ls s3://cotransmeq/liquidaciones/ --recursive
```

### Sincronizar Archivos Locales a S3
```bash
aws s3 sync ./uploads/documentos s3://cotransmeq/documentos/
aws s3 sync ./uploads/planillas s3://cotransmeq/liquidaciones/
```

---

## 📝 Notas Importantes

1. **Backup**: Antes de eliminar archivos locales, hacer backup completo
2. **URLs Firmadas**: Las URLs expiran, el frontend debe manejar la renovación
3. **Costos**: S3 cobra por almacenamiento y transferencia, monitorear uso
4. **Performance**: Considerar CDN (CloudFront) para mejorar velocidad de descarga
5. **Logs**: S3 puede generar logs de acceso para auditoría

---

## 🆘 Troubleshooting

### Error: "SignatureDoesNotMatch"
- Verificar que las credenciales AWS sean correctas
- Verificar que la región sea la correcta (us-east-2)

### Error: "Access Denied"
- Verificar permisos del usuario IAM
- Asegurar que el bucket policy permite las operaciones

### URLs Firmadas No Funcionan
- Verificar que la key del objeto sea correcta
- Verificar que el archivo exista en S3
- Verificar que no haya expirado (tiempo de expiración)

### Archivos No Se Descargan
- Verificar CORS configuration del bucket
- Verificar que Content-Type sea correcto
- Verificar que el navegador no esté bloqueando la descarga
