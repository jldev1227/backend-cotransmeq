# 🧪 Tests del Módulo de Acciones Correctivas y Preventivas

## ✅ Confirmación: Backend Completado

### 📋 Componentes Implementados

#### 1. **Base de Datos**
- ✅ Tabla `acciones_correctivas_preventivas` creada
- ✅ 29 campos (28 de matriz + creado_por_id)
- ✅ Índices optimizados (accion_numero, tipo, estado, fecha)
- ✅ Relación con tabla `users`
- ✅ Migración aplicada exitosamente

#### 2. **Backend (NestJS/Fastify)**
- ✅ **Service** (`acciones-correctivas.service.ts`)
  - CRUD completo (crear, listar, actualizar, eliminar)
  - Filtros avanzados (tipo, estado, riesgo, fechas, búsqueda)
  - Paginación
  - Estadísticas generales
  - Conversión automática de fechas
  
- ✅ **Controller** (`acciones-correctivas.controller.ts`)
  - 8 endpoints REST
  - Manejo de errores
  - Autenticación requerida
  
- ✅ **Routes** (`acciones-correctivas.routes.ts`)
  - Validación Fastify schemas
  - Documentación Swagger
  
- ✅ **PDF Generator** (`pdf-generator-acciones.service.ts`)
  - Formato profesional
  - 5 secciones organizadas
  - Logo Cotransmeq
  - Campos de texto con altura dinámica

#### 3. **Endpoints Disponibles**

```bash
BASE_URL="http://localhost:4000/api"

# 1. Crear Acción Correctiva/Preventiva
POST ${BASE_URL}/acciones-correctivas
Headers: Authorization: Bearer {TOKEN}
Body: {
  "accion_numero": "A26_1",
  "lugar_sede": "Yopal",
  "proceso_origen_hallazgo": "OPERACIONES",
  "descripcion_hallazgo": "Incumplimiento de procedimientos de seguridad",
  "tipo_hallazgo_detectado": "NC. MAYOR",
  "valoracion_riesgo": "ALTO",
  "tipo_accion_ejecutar": "CORRECTIVA",
  "analisis_causas": "1. Falta de capacitación\n2. Desconocimiento de protocolos\n3. Supervisión insuficiente",
  "descripcion_accion_plan": "Implementar programa de capacitación trimestral",
  "fecha_identificacion_hallazgo": "2026-01-14",
  "fecha_limite_implementacion": "2026-03-14",
  "responsable_ejecucion": "Coordinador HSEQ",
  "estado_accion_planeada": "En Proceso"
}

# 2. Listar Acciones (con filtros y paginación)
GET ${BASE_URL}/acciones-correctivas?page=1&limit=20
GET ${BASE_URL}/acciones-correctivas?tipo_accion_ejecutar=CORRECTIVA
GET ${BASE_URL}/acciones-correctivas?estado_accion_planeada=En Proceso
GET ${BASE_URL}/acciones-correctivas?valoracion_riesgo=ALTO
GET ${BASE_URL}/acciones-correctivas?busqueda=seguridad
GET ${BASE_URL}/acciones-correctivas?fecha_desde=2026-01-01&fecha_hasta=2026-12-31

# 3. Obtener Acción por ID
GET ${BASE_URL}/acciones-correctivas/{id}

# 4. Obtener Acción por Número
GET ${BASE_URL}/acciones-correctivas/numero/A26_1

# 5. Actualizar Acción
PUT ${BASE_URL}/acciones-correctivas/{id}
Body: {
  "estado_accion_planeada": "Cumplidas",
  "evaluacion_cierre_eficaz": "EFICAZ",
  "fecha_cierre_definitivo": "2026-03-10"
}

# 6. Eliminar Acción
DELETE ${BASE_URL}/acciones-correctivas/{id}

# 7. Obtener Estadísticas
GET ${BASE_URL}/acciones-correctivas/estadisticas

# 8. Exportar PDF
GET ${BASE_URL}/acciones-correctivas/{id}/exportar-pdf
```

## 🧪 Script de Prueba Completo

### Paso 1: Obtener Token de Autenticación

```bash
# Usa tus credenciales reales
TOKEN=$(curl -s -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "correo": "TU_EMAIL@cotransmeq.com",
    "password": "TU_PASSWORD"
  }' | jq -r '.token')

echo "Token: $TOKEN"
```

### Paso 2: Crear Acción de Prueba

```bash
RESPONSE=$(curl -s -X POST http://localhost:4000/api/acciones-correctivas \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "accion_numero": "TEST_001",
    "lugar_sede": "Yopal",
    "proceso_origen_hallazgo": "OPERACIONES",
    "componente_elemento_referencia": "Prestación de Servicio",
    "fuente_genero_hallazgo": "Inspección de Seguridad",
    "marco_legal_normativo": "Código Nacional de Tránsito y Políticas HSEQ",
    "fecha_identificacion_hallazgo": "2026-01-14",
    "descripcion_hallazgo": "Se identificó incumplimiento en el uso de EPP durante la operación de vehículos",
    "tipo_hallazgo_detectado": "NC. MAYOR",
    "variable_categoria_analisis": "Seguridad y Salud en el Trabajo",
    "correccion_solucion_inmediata": "Suspensión temporal del conductor hasta capacitación",
    "fecha_implementacion": "2026-01-15",
    "valoracion_riesgo": "ALTO",
    "requiere_actualizar_matriz": "Sí, actualizar matriz de riesgos SST",
    "tipo_accion_ejecutar": "CORRECTIVA",
    "analisis_causas": "1. ¿Por qué no usó EPP? - Porque olvidó llevarlo\n2. ¿Por qué lo olvidó? - Falta de hábito y rutina\n3. ¿Por qué falta el hábito? - Capacitación insuficiente\n4. ¿Por qué la capacitación es insuficiente? - No hay programa de refuerzo periódico\n5. ¿Por qué no hay programa? - CAUSA RAÍZ: Falta de planificación en el SGSST",
    "descripcion_accion_plan": "1. Implementar programa de capacitación mensual sobre uso de EPP\n2. Crear checklist diario de verificación de EPP\n3. Establecer sanciones progresivas por incumplimiento\n4. Reconocimientos mensuales a conductores que cumplan 100%",
    "fecha_limite_implementacion": "2026-03-14",
    "responsable_ejecucion": "Coordinador HSEQ / Jefe de Operaciones",
    "fecha_seguimiento": "2026-02-14",
    "estado_accion_planeada": "En Proceso",
    "descripcion_estado_observaciones": "Se está ejecutando el programa de capacitación. Primera sesión realizada el 20-01-2026 con asistencia del 90% del personal.",
    "fecha_evaluacion_eficacia": null,
    "criterio_evaluacion_eficacia": "Reducción del 100% de incidentes relacionados con no uso de EPP durante 3 meses consecutivos",
    "analisis_evidencias_cierre": null,
    "evaluacion_cierre_eficaz": null,
    "soporte_cierre_eficaz": null,
    "fecha_cierre_definitivo": null,
    "responsable_cierre": "Coordinador HSEQ"
  }')

echo "$RESPONSE" | jq .

# Extraer ID de la acción creada
ACCION_ID=$(echo "$RESPONSE" | jq -r '.data.id')
echo "Acción ID: $ACCION_ID"
```

### Paso 3: Listar Acciones

```bash
echo "\n=== LISTAR TODAS LAS ACCIONES ==="
curl -s -X GET "http://localhost:4000/api/acciones-correctivas?page=1&limit=10" \
  -H "Authorization: Bearer $TOKEN" | jq .

echo "\n=== FILTRAR POR TIPO CORRECTIVA ==="
curl -s -X GET "http://localhost:4000/api/acciones-correctivas?tipo_accion_ejecutar=CORRECTIVA" \
  -H "Authorization: Bearer $TOKEN" | jq .

echo "\n=== FILTRAR POR RIESGO ALTO ==="
curl -s -X GET "http://localhost:4000/api/acciones-correctivas?valoracion_riesgo=ALTO" \
  -H "Authorization: Bearer $TOKEN" | jq .

echo "\n=== BUSCAR POR TEXTO ==="
curl -s -X GET "http://localhost:4000/api/acciones-correctivas?busqueda=EPP" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

### Paso 4: Obtener por ID y por Número

```bash
echo "\n=== OBTENER POR ID ==="
curl -s -X GET "http://localhost:4000/api/acciones-correctivas/$ACCION_ID" \
  -H "Authorization: Bearer $TOKEN" | jq .

echo "\n=== OBTENER POR NÚMERO ==="
curl -s -X GET "http://localhost:4000/api/acciones-correctivas/numero/TEST_001" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

### Paso 5: Actualizar Acción (simular progreso)

```bash
echo "\n=== ACTUALIZAR ACCIÓN ==="
curl -s -X PUT "http://localhost:4000/api/acciones-correctivas/$ACCION_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "estado_accion_planeada": "Cumplidas",
    "fecha_evaluacion_eficacia": "2026-06-14",
    "analisis_evidencias_cierre": "Se evidencian registros de capacitación mensual desde enero hasta mayo 2026. Checklist diario implementado y sin incidentes de no uso de EPP durante 3 meses consecutivos (marzo-mayo 2026).",
    "evaluacion_cierre_eficaz": "EFICAZ",
    "soporte_cierre_eficaz": "Registros de asistencia a capacitaciones, checklist diarios firmados, reportes mensuales de cumplimiento al 100%",
    "fecha_cierre_definitivo": "2026-06-14"
  }' | jq .
```

### Paso 6: Obtener Estadísticas

```bash
echo "\n=== ESTADÍSTICAS GENERALES ==="
curl -s -X GET "http://localhost:4000/api/acciones-correctivas/estadisticas" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

### Paso 7: Exportar PDF

```bash
echo "\n=== EXPORTAR PDF ==="
curl -X GET "http://localhost:4000/api/acciones-correctivas/$ACCION_ID/exportar-pdf" \
  -H "Authorization: Bearer $TOKEN" \
  --output "accion_TEST_001.pdf"

echo "PDF generado: accion_TEST_001.pdf"
open accion_TEST_001.pdf  # En macOS
```

### Paso 8: Eliminar Acción de Prueba (Opcional)

```bash
echo "\n=== ELIMINAR ACCIÓN DE PRUEBA ==="
curl -s -X DELETE "http://localhost:4000/api/acciones-correctivas/$ACCION_ID" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

## 📊 Estructura de Respuestas

### Respuesta Exitosa (Crear/Actualizar)
```json
{
  "success": true,
  "message": "Acción correctiva/preventiva creada exitosamente",
  "data": {
    "id": "uuid",
    "accion_numero": "TEST_001",
    "lugar_sede": "Yopal",
    "proceso_origen_hallazgo": "OPERACIONES",
    // ... todos los campos ...
    "created_at": "2026-01-14T...",
    "updated_at": "2026-01-14T...",
    "usuarios": {
      "id": "uuid",
      "nombre": "Nombre Usuario",
      "correo": "usuario@cotransmeq.com"
    }
  }
}
```

### Respuesta Lista con Paginación
```json
{
  "success": true,
  "data": {
    "acciones": [ /* array de acciones */ ],
    "total": 25,
    "page": 1,
    "limit": 20,
    "totalPages": 2
  }
}
```

### Respuesta Estadísticas
```json
{
  "success": true,
  "data": {
    "total": 25,
    "por_tipo": [
      { "tipo_accion_ejecutar": "CORRECTIVA", "_count": 15 },
      { "tipo_accion_ejecutar": "PREVENTIVA", "_count": 8 },
      { "tipo_accion_ejecutar": "MEJORA", "_count": 2 }
    ],
    "por_estado": [
      { "estado_accion_planeada": "En Proceso", "_count": 10 },
      { "estado_accion_planeada": "Cumplidas", "_count": 12 },
      { "estado_accion_planeada": "Vencidas", "_count": 3 }
    ],
    "por_riesgo": [
      { "valoracion_riesgo": "ALTO", "_count": 8 },
      { "valoracion_riesgo": "MEDIO", "_count": 12 },
      { "valoracion_riesgo": "BAJO", "_count": 5 }
    ],
    "proximas_vencer": 3
  }
}
```

### Respuesta de Error
```json
{
  "success": false,
  "message": "Ya existe una acción con el número TEST_001"
}
```

## ✅ Checklist de Validación

### Base de Datos
- [x] Tabla creada correctamente
- [x] Índices aplicados
- [x] Relaciones configuradas
- [x] Migración ejecutada sin errores

### Backend
- [x] Service con todos los métodos CRUD
- [x] Controller con manejo de errores
- [x] Routes con validación
- [x] Autenticación requerida
- [x] Documentación Swagger disponible
- [x] PDF Generator funcionando

### Funcionalidades
- [x] Crear acción correctiva/preventiva
- [x] Listar con filtros múltiples
- [x] Paginación
- [x] Búsqueda general
- [x] Obtener por ID
- [x] Obtener por número
- [x] Actualizar acción
- [x] Eliminar acción
- [x] Estadísticas generales
- [x] Exportar a PDF

### Validaciones
- [x] Número de acción único
- [x] Enums validados (tipo, estado, riesgo, eficacia)
- [x] Conversión automática de fechas
- [x] Manejo de errores 400/404/500

## 🚀 Próximo Paso: Frontend

El backend está **100% completo y listo para el frontend**. 

Ahora procederemos a crear:
1. Vista de lista de acciones con tabla/cards
2. Filtros avanzados
3. Modal de formulario para crear/editar
4. Integración con API
5. Botón de exportar PDF

**¿Estás listo para pasar al frontend en `ingreso-svelte`?**
