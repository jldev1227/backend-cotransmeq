# Implementación de Auditoría: creado_por_id en Recargos

## 📋 Resumen
Se implementó la captura automática del usuario que crea o modifica recargos, utilizando el token JWT Bearer para identificar al usuario.

## 🔧 Cambios Realizados

### 1. Backend - Rutas de Recargos
**Archivo:** `src/modules/recargos/recargos.routes.ts`

**Cambio:** Se agregó el middleware de autenticación a todas las rutas de recargos.

```typescript
import { authMiddleware } from '../../middlewares/auth.middleware'

export async function recargosRoutes(fastify: FastifyInstance) {
  // Aplicar middleware de autenticación a todas las rutas de recargos
  fastify.addHook('onRequest', authMiddleware)
  
  // ... resto de las rutas
}
```

**Efecto:** 
- Ahora todas las rutas de recargos requieren autenticación
- El usuario se extrae del token JWT y se adjunta a `request.user`
- Sin token válido, las peticiones retornan 401 Unauthorized

### 2. Controlador de Recargos
**Archivo:** `src/modules/recargos/recargos.controller.ts`

**Cambios:** Ya existía la captura de `userId` en los métodos:
- ✅ `crear()` - línea 19
- ✅ `actualizar()` - línea 128
- ✅ `eliminar()` - línea 164
- ✅ `liquidar()` - línea 236
- ✅ `duplicar()` - línea 262

```typescript
const userId = (request as any).user?.id
```

### 3. Servicio de Recargos
**Archivo:** `src/modules/recargos/recargos.service.ts`

**Cambios:** Ya existía el uso de `userId` en:
- ✅ `create()` - asigna `creado_por_id` en línea 342
- ✅ `update()` - asigna `actualizado_por_id` en línea 504
- ✅ `duplicar()` - pasa `userId` a `create()`

**Detalles de implementación:**

```typescript
// En create():
const recargo = await prisma.recargos_planillas.create({
  data: {
    // ... otros campos
    creado_por_id: userId,  // ← Usuario del token JWT
    // ...
    dias_laborales_planillas: {
      create: dias_laborales.map(dia => ({
        // ...
        creado_por_id: userId,  // ← Usuario en días laborales
        detalles_recargos_dias: {
          create: detalles.map(detalle => ({
            // ...
            creado_por_id: userId  // ← Usuario en detalles
          }))
        }
      }))
    }
  }
})

// En update():
const updateData = {
  actualizado_por_id: userId,  // ← Usuario que actualiza
  version: { increment: 1 },
  // ...
}
```

### 4. Middleware de Autenticación
**Archivo:** `src/middlewares/auth.middleware.ts`

**Funcionamiento:** (Ya existente, sin cambios)
```typescript
export async function authMiddleware(request: FastifyRequest, reply: FastifyReply) {
  const auth = request.headers['authorization']
  // Extrae token del header "Authorization: Bearer <token>"
  const token = auth.split(' ')[1]
  const payload = jwt.verify(token, env.JWT_SECRET)
  ;(request as any).user = payload  // ← Adjunta usuario a request
}
```

### 5. Frontend - API Client
**Archivo:** `src/lib/api/apiClient.ts`

**Funcionamiento:** (Ya existente, sin cambios)
```typescript
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('transmeralda_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`  // ← Envía token
  }
  return config
})
```

## 🗄️ Base de Datos

### Campos de Auditoría
**Tabla:** `recargos_planillas`
- `creado_por_id` (UUID, FK → users.id)
- `actualizado_por_id` (UUID, FK → users.id)
- `created_at` (timestamp)
- `updated_at` (timestamp)
- `version` (integer) - Se incrementa en cada actualización

**Tabla:** `dias_laborales_planillas`
- `creado_por_id` (UUID, FK → users.id)
- `created_at` (timestamp)
- `updated_at` (timestamp)

**Tabla:** `detalles_recargos_dias`
- `creado_por_id` (UUID, FK → users.id)
- `created_at` (timestamp)
- `updated_at` (timestamp)

### Script de Migración para Datos Existentes
**Archivo:** `fix-creado-por-id.sql`

Este script asigna automáticamente el primer usuario activo como creador de los recargos existentes que tienen `creado_por_id = NULL`.

**Ejecución:**
```bash
PGPASSWORD="MEQ900**" psql -h cotransmeq.postgres.database.azure.com \
  -U Cotrans900 -d postgres -p 5432 -f fix-creado-por-id.sql
```

## ✅ Verificación

### 1. Crear un nuevo recargo
1. Iniciar sesión en el frontend
2. Crear un recargo desde la interfaz
3. Verificar en la base de datos:

```sql
SELECT 
  r.id,
  r.numero_planilla,
  r.creado_por_id,
  u.nombre || ' ' || u.apellido as creado_por
FROM recargos_planillas r
LEFT JOIN users u ON r.creado_por_id = u.id
WHERE r.id = '<ID_DEL_RECARGO>'
```

### 2. Actualizar un recargo
1. Editar un recargo existente
2. Verificar el campo `actualizado_por_id`:

```sql
SELECT 
  r.id,
  r.numero_planilla,
  r.version,
  r.actualizado_por_id,
  u.nombre || ' ' || u.apellido as actualizado_por,
  r.updated_at
FROM recargos_planillas r
LEFT JOIN users u ON r.actualizado_por_id = u.id
WHERE r.id = '<ID_DEL_RECARGO>'
```

### 3. Ver en el Modal de Visualización
El modal `ModalVisualizarRecargo.svelte` ya muestra esta información en el tab de "Auditoría".

## 🔍 Debugging

### Backend Logs
El servicio ya tiene logs de debug que muestran el proceso:

```typescript
console.log('📊 [CREATE] Datos recibidos:', JSON.stringify(data, null, 2))
console.log('📊 [CREATE] userId capturado:', userId)
```

### Verificar Token en Request
```typescript
// En cualquier controlador
console.log('👤 Usuario:', (request as any).user)
// Debería mostrar: { id: '...', correo: '...', rol: '...', ... }
```

## 🚨 Consideraciones

### Seguridad
- ✅ El token JWT se valida en cada request
- ✅ El token expira después de cierto tiempo (configurado en JWT_SECRET)
- ✅ No se pueden crear/modificar recargos sin autenticación

### Integridad de Datos
- ⚠️ Los recargos creados ANTES de esta implementación tienen `creado_por_id = NULL`
- 💡 Usa el script `fix-creado-por-id.sql` para asignar un usuario por defecto
- 🔄 Los nuevos recargos siempre tendrán el usuario que los creó

### Relaciones
- `creado_por_id` → `users.id`
- `actualizado_por_id` → `users.id`
- Ambas son claves foráneas con restricción `ON DELETE SET NULL`

## 📝 Próximos Pasos (Opcional)

1. **Historial de Cambios:** Implementar tabla `recargos_planillas_historial` para guardar todos los cambios
2. **Logs de Auditoría:** Tabla de logs con todas las acciones realizadas
3. **Validación de Permisos:** Verificar que el usuario tenga permisos para crear/editar recargos
4. **Notificaciones:** Enviar notificaciones cuando se crea/modifica un recargo

## 🎉 Resultado Final

Ahora cada recargo creado o modificado registrará automáticamente:
- ✅ Quién lo creó (`creado_por_id`)
- ✅ Cuándo se creó (`created_at`)
- ✅ Quién lo modificó por última vez (`actualizado_por_id`)
- ✅ Cuándo se modificó (`updated_at`)
- ✅ Cuántas veces se ha modificado (`version`)

Esta información es visible en el tab "Auditoría" del modal de visualización de recargos.
