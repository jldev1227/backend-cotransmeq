# API Documentation - CRUDs

## Resumen

Este documento detalla todos los endpoints disponibles para los CRUDs de:
- **Conductores**
- **Clientes/Empresas**
- **Vehículos**

Base URL: `http://localhost:4000`

## Autenticación

Todos los endpoints requieren autenticación mediante token JWT excepto los endpoints públicos.

### Login
```bash
POST /api/auth/login
Content-Type: application/json

{
  "correo": "admin@cotransmeq.com",
  "password": "admin123"
}

Response:
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "uuid",
    "nombre": "Admin",
    "correo": "admin@cotransmeq.com",
    "role": "admin"
  }
}
```

---

## 🚗 Conductores

### 1. Listar todos los conductores
```bash
GET /api/conductores?page=1&limit=50&search=&estado=&sede_trabajo=
Authorization: Bearer {token}

Response:
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "nombre": "Juan Carlos",
      "apellido": "Pérez González",
      "numero_identificacion": "1234567890",
      "email": "juan.perez@test.com",
      "telefono": "3001234567",
      "estado": "ACTIVO",
      "sede_trabajo": "Yopal",
      "cargo": "CONDUCTOR",
      "categoria_licencia": "C2",
      "vencimiento_licencia": "2026-12-31",
      "foto_signed_url": "https://...",
      "created_at": "2024-01-01T00:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 100,
    "totalPages": 2
  }
}
```

### 2. Obtener conductor por ID
```bash
GET /api/conductores/:id
Authorization: Bearer {token}

Response:
{
  "success": true,
  "data": {
    "id": "uuid",
    "nombre": "Juan Carlos",
    "apellido": "Pérez González",
    "tipo_identificacion": "CC",
    "numero_identificacion": "1234567890",
    "email": "juan.perez@test.com",
    "telefono": "3001234567",
    "fecha_nacimiento": "1990-05-15",
    "genero": "M",
    "direccion": "Calle 123 #45-67",
    "cargo": "CONDUCTOR",
    "fecha_ingreso": "2024-01-01",
    "salario_base": 2500000,
    "estado": "ACTIVO",
    "eps": "NUEVA EPS",
    "fondo_pension": "PORVENIR",
    "arl": "SURA",
    "tipo_contrato": "INDEFINIDO",
    "categoria_licencia": "C2",
    "vencimiento_licencia": "2026-12-31",
    "sede_trabajo": "Yopal",
    "tipo_sangre": "O+",
    "foto_url": "conductores/123/foto.jpg",
    "foto_signed_url": "https://...",
    "created_at": "2024-01-01T00:00:00.000Z",
    "updated_at": "2024-01-01T00:00:00.000Z"
  }
}
```

### 3. Crear nuevo conductor
```bash
POST /api/conductores
Authorization: Bearer {token}
Content-Type: application/json

{
  "nombre": "Juan Carlos",
  "apellido": "Pérez González",
  "tipo_identificacion": "CC",
  "numero_identificacion": "1234567890",
  "email": "juan.perez@test.com",
  "telefono": "3001234567",
  "fecha_nacimiento": "1990-05-15",
  "genero": "M",
  "direccion": "Calle 123 #45-67",
  "cargo": "CONDUCTOR",
  "fecha_ingreso": "2024-01-01",
  "salario_base": 2500000,
  "estado": "ACTIVO",
  "eps": "NUEVA EPS",
  "fondo_pension": "PORVENIR",
  "arl": "SURA",
  "tipo_contrato": "INDEFINIDO",
  "categoria_licencia": "C2",
  "vencimiento_licencia": "2026-12-31",
  "sede_trabajo": "Yopal",
  "tipo_sangre": "O+"
}

Response: 201 Created
{
  "success": true,
  "message": "Conductor creado exitosamente",
  "data": { /* conductor creado */ }
}
```

### 4. Actualizar conductor
```bash
PUT /api/conductores/:id
Authorization: Bearer {token}
Content-Type: application/json

{
  "nombre": "Juan Carlos ACTUALIZADO",
  "apellido": "Pérez González",
  "email": "juan.updated@test.com",
  "telefono": "3009876543",
  "direccion": "Calle Nueva 456 #78-90",
  "salario_base": 2800000
}

Response: 200 OK
{
  "success": true,
  "message": "Conductor actualizado exitosamente",
  "data": { /* conductor actualizado */ }
}
```

### 5. Actualizar estado del conductor
```bash
PATCH /api/conductores/:id/estado
Authorization: Bearer {token}
Content-Type: application/json

{
  "estado": "SUSPENDIDO"
}

Response: 200 OK
{
  "success": true,
  "message": "Estado actualizado exitosamente",
  "data": { /* conductor actualizado */ }
}
```

Estados válidos:
- `ACTIVO`
- `INACTIVO`
- `SUSPENDIDO`
- `RETIRADO`
- `VACACIONES`
- `INCAPACIDAD`

### 6. Eliminar conductor (soft delete)
```bash
DELETE /api/conductores/:id
Authorization: Bearer {token}

Response: 200 OK
{
  "success": true,
  "message": "Conductor eliminado exitosamente"
}
```

### 7. Subir foto del conductor
```bash
POST /api/conductores/:id/foto
Authorization: Bearer {token}
Content-Type: multipart/form-data

file: <archivo imagen>

Response: 200 OK
{
  "success": true,
  "message": "Foto subida exitosamente",
  "data": {
    "foto_url": "conductores/123/foto.jpg",
    "foto_signed_url": "https://..."
  }
}
```

### 8. Eliminar foto del conductor
```bash
DELETE /api/conductores/:id/foto
Authorization: Bearer {token}

Response: 200 OK
{
  "success": true,
  "message": "Foto eliminada exitosamente"
}
```

---

## 🏢 Clientes/Empresas

### 1. Listar todos los clientes
```bash
GET /api/clientes?page=1&limit=20
Authorization: Bearer {token}

Response:
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "tipo": "EMPRESA",
      "nit": "900123456-7",
      "nombre": "Empresa de Prueba S.A.S",
      "representante": "María López",
      "cedula": "1234567890",
      "telefono": "6017001234",
      "direccion": "Carrera 7 #12-34",
      "correo": "contacto@empresa.com",
      "requiere_osi": true,
      "paga_recargos": true,
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 50,
    "totalPages": 3
  }
}
```

### 2. Lista básica de clientes (para selects)
```bash
GET /api/empresas/basicos
Authorization: Bearer {token}

Response:
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "nombre": "Empresa ABC",
      "nit": "900123456-7",
      "tipo": "EMPRESA"
    }
  ],
  "count": 50
}
```

### 3. Buscar clientes con filtros
```bash
GET /api/clientes/buscar?tipo=EMPRESA&search=Prueba&requiere_osi=true&paga_recargos=true
Authorization: Bearer {token}

Response:
{
  "success": true,
  "data": [ /* clientes filtrados */ ]
}
```

### 4. Obtener cliente por ID
```bash
GET /api/clientes/:id
Authorization: Bearer {token}

Response:
{
  "success": true,
  "data": {
    "id": "uuid",
    "tipo": "EMPRESA",
    "nit": "900123456-7",
    "nombre": "Empresa de Prueba S.A.S",
    "representante": "María López",
    "cedula": "1234567890",
    "telefono": "6017001234",
    "direccion": "Carrera 7 #12-34",
    "correo": "contacto@empresa.com",
    "requiere_osi": true,
    "paga_recargos": true,
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z"
  }
}
```

### 5. Crear nuevo cliente EMPRESA
```bash
POST /api/clientes
Authorization: Bearer {token}
Content-Type: application/json

{
  "tipo": "EMPRESA",
  "nit": "900123456-7",
  "nombre": "Empresa de Prueba S.A.S",
  "representante": "María López",
  "cedula": "1234567890",
  "telefono": "6017001234",
  "direccion": "Carrera 7 #12-34",
  "correo": "contacto@empresa.com",
  "requiere_osi": true,
  "paga_recargos": true
}

Response: 201 Created
{
  "success": true,
  "message": "Cliente creado exitosamente",
  "data": { /* cliente creado */ }
}
```

### 6. Crear nuevo cliente PERSONA
```bash
POST /api/clientes
Authorization: Bearer {token}
Content-Type: application/json

{
  "tipo": "PERSONA",
  "nombre": "Carlos Rodríguez",
  "cedula": "9876543210",
  "telefono": "3109876543",
  "direccion": "Calle 45 #67-89",
  "correo": "carlos@email.com",
  "requiere_osi": false,
  "paga_recargos": false
}

Response: 201 Created
{
  "success": true,
  "message": "Cliente creado exitosamente",
  "data": { /* cliente creado */ }
}
```

### 7. Actualizar cliente
```bash
PUT /api/clientes/:id
Authorization: Bearer {token}
Content-Type: application/json

{
  "tipo": "EMPRESA",
  "nit": "900123456-7",
  "nombre": "Empresa ACTUALIZADA S.A.S",
  "representante": "María López García",
  "telefono": "6017001234",
  "direccion": "Carrera 7 #12-34 Piso 5",
  "correo": "contacto@empresa-actualizada.com"
}

Response: 200 OK
{
  "success": true,
  "message": "Cliente actualizado exitosamente",
  "data": { /* cliente actualizado */ }
}
```

### 8. Eliminar cliente
```bash
DELETE /api/clientes/:id
Authorization: Bearer {token}

Response: 200 OK
{
  "success": true,
  "message": "Cliente eliminado exitosamente"
}
```

---

## 🚙 Vehículos

### 1. Listar todos los vehículos
```bash
GET /api/vehiculos?estado=DISPONIBLE
Authorization: Bearer {token}

Response:
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "placa": "ABC123",
      "marca": "Chevrolet",
      "linea": "NHR",
      "modelo": "2020",
      "color": "Blanco",
      "clase_vehiculo": "Camión",
      "estado": "DISPONIBLE",
      "kilometraje": 50000,
      "conductor_id": "uuid",
      "conductores": {
        "nombre": "Juan",
        "apellido": "Pérez"
      },
      "created_at": "2024-01-01T00:00:00.000Z"
    }
  ],
  "count": 25
}
```

### 2. Lista básica de vehículos (para selects)
```bash
GET /api/flota/basicos
Authorization: Bearer {token}

Response:
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "placa": "ABC123",
      "marca": "Chevrolet",
      "modelo": "2020",
      "estado": "DISPONIBLE"
    }
  ],
  "count": 25
}
```

### 3. Obtener vehículo por ID
```bash
GET /api/vehiculos/:id
Authorization: Bearer {token}

Response:
{
  "success": true,
  "data": {
    "id": "uuid",
    "placa": "ABC123",
    "marca": "Chevrolet",
    "linea": "NHR",
    "modelo": "2020",
    "color": "Blanco",
    "clase_vehiculo": "Camión",
    "tipo_carroceria": "Estacas",
    "combustible": "Diesel",
    "numero_motor": "1234567890",
    "vin": "VIN1234567890",
    "numero_serie": "NS1234567890",
    "numero_chasis": "CH1234567890",
    "propietario_nombre": "Juan Pérez",
    "propietario_identificacion": "1234567890",
    "kilometraje": 50000,
    "estado": "DISPONIBLE",
    "fecha_matricula": "2020-01-15",
    "conductor_id": "uuid",
    "conductores": {
      "nombre": "Juan",
      "apellido": "Pérez",
      "foto_signed_url": "https://..."
    },
    "created_at": "2024-01-01T00:00:00.000Z",
    "updated_at": "2024-01-01T00:00:00.000Z"
  }
}
```

### 4. Crear nuevo vehículo
```bash
POST /api/vehiculos
Authorization: Bearer {token}
Content-Type: application/json

{
  "placa": "ABC123",
  "marca": "Chevrolet",
  "linea": "NHR",
  "modelo": "2020",
  "color": "Blanco",
  "clase_vehiculo": "Camión",
  "tipo_carroceria": "Estacas",
  "combustible": "Diesel",
  "numero_motor": "1234567890",
  "vin": "VIN1234567890",
  "numero_serie": "NS1234567890",
  "numero_chasis": "CH1234567890",
  "propietario_nombre": "Juan Pérez",
  "propietario_identificacion": "1234567890",
  "kilometraje": 50000,
  "estado": "DISPONIBLE",
  "fecha_matricula": "2020-01-15",
  "conductor_id": "uuid-optional"
}

Response: 201 Created
{
  "success": true,
  "message": "Vehículo creado exitosamente",
  "data": { /* vehículo creado */ }
}
```

### 5. Actualizar vehículo
```bash
PUT /api/vehiculos/:id
Authorization: Bearer {token}
Content-Type: application/json

{
  "placa": "ABC123",
  "marca": "Chevrolet",
  "linea": "NHR ACTUALIZADO",
  "modelo": "2020",
  "color": "Azul",
  "kilometraje": 52000,
  "estado": "DISPONIBLE"
}

Response: 200 OK
{
  "success": true,
  "message": "Vehículo actualizado exitosamente",
  "data": { /* vehículo actualizado */ }
}
```

### 6. Actualizar estado del vehículo
```bash
PATCH /api/vehiculos/:id/estado
Authorization: Bearer {token}
Content-Type: application/json

{
  "estado": "MANTENIMIENTO"
}

Response: 200 OK
{
  "success": true,
  "message": "Estado actualizado exitosamente",
  "data": { /* vehículo actualizado */ }
}
```

Estados válidos:
- `DISPONIBLE`
- `SERVICIO`
- `MANTENIMIENTO`
- `DESVINCULADO`

### 7. Actualizar kilometraje
```bash
PATCH /api/vehiculos/:id/kilometraje
Authorization: Bearer {token}
Content-Type: application/json

{
  "kilometraje": 53500
}

Response: 200 OK
{
  "success": true,
  "message": "Kilometraje actualizado exitosamente",
  "data": { /* vehículo actualizado */ }
}
```

### 8. Asignar conductor al vehículo
```bash
PATCH /api/vehiculos/:id/conductor
Authorization: Bearer {token}
Content-Type: application/json

{
  "conductor_id": "uuid"
}

Response: 200 OK
{
  "success": true,
  "message": "Conductor asignado exitosamente",
  "data": { /* vehículo actualizado */ }
}
```

### 9. Eliminar vehículo
```bash
DELETE /api/vehiculos/:id
Authorization: Bearer {token}

Response: 200 OK
{
  "success": true,
  "message": "Vehículo eliminado exitosamente"
}
```

---

## Scripts de Test

Se han creado 3 scripts bash para probar todos los endpoints:

### 1. Test de Conductores
```bash
cd backend-nest
./test-crud-conductores.sh
```

### 2. Test de Clientes
```bash
cd backend-nest
./test-crud-clientes.sh
```

### 3. Test de Vehículos
```bash
cd backend-nest
./test-crud-vehiculos.sh
```

Todos los scripts:
- ✅ Realizan autenticación automática
- ✅ Prueban todos los endpoints CRUD
- ✅ Incluyen colores para mejor visualización
- ✅ Preguntan confirmación antes de eliminar datos
- ✅ Muestran respuestas formateadas con `jq`

---

## Códigos de Respuesta HTTP

| Código | Significado |
|--------|-------------|
| 200 | OK - Operación exitosa |
| 201 | Created - Recurso creado exitosamente |
| 400 | Bad Request - Error en los datos enviados |
| 401 | Unauthorized - Token inválido o expirado |
| 403 | Forbidden - No tiene permisos |
| 404 | Not Found - Recurso no encontrado |
| 500 | Internal Server Error - Error del servidor |

---

## Notas Importantes

1. **Autenticación**: Todos los endpoints requieren header `Authorization: Bearer {token}`
2. **CORS**: El backend está configurado para aceptar peticiones desde el frontend
3. **Paginación**: Los endpoints de listado soportan `?page=1&limit=50`
4. **Filtros**: Se puede filtrar por múltiples campos usando query params
5. **Soft Delete**: Los registros eliminados no se borran, solo se marcan como inactivos
6. **S3**: Las fotos de conductores se suben a AWS S3 y se generan URLs firmadas
7. **Validaciones**: El backend valida todos los campos requeridos y formatos

---

## Frontend

Los dashboards en el frontend están ubicados en:

- `/dashboard/conductores` - Gestión de conductores
- `/dashboard/clientes` - Gestión de clientes/empresas
- `/dashboard/flota` - Gestión de vehículos

Cada dashboard incluye:
- ✅ Tabla con paginación
- ✅ Filtros y búsqueda
- ✅ Ordenamiento por columnas
- ✅ Modales de creación/edición
- ✅ Vista de detalle individual
- ✅ Acciones (ver, editar, eliminar)
- ✅ Responsive design
- ✅ Animaciones suaves
