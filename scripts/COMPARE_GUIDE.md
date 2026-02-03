# 🔍 Análisis Detallado de Bases de Datos

## ¿Qué hace este script?

El comando `npm run migrate:compare` realiza un análisis exhaustivo comparando:

### 1. 📐 Estructura de Tablas
- ✅ Verifica que ambas tablas existan
- ✅ Compara cantidad de columnas
- ✅ Identifica columnas que solo existen en origen
- ✅ Identifica columnas que solo existen en destino
- ✅ Lista columnas comunes

### 2. 📊 Datos
- ✅ Cuenta registros en ambas bases de datos
- ✅ Calcula la diferencia
- ✅ Obtiene el último registro de cada tabla
- ✅ Compara los últimos registros campo por campo

### 3. 🎯 Veredicto
- ✅ Indica si la tabla está migrada correctamente
- ✅ Señala exactamente qué está diferente
- ✅ Da recomendaciones específicas

---

## 🚀 Cómo Usar

### Paso 1: Configurar Base de Datos Origen

Edita `scripts/compare-databases.ts` (líneas 3-11):

```typescript
const sourceDb = new Client({
  host: 'localhost',              // ← Tu host aquí
  port: 5432,                     // ← Tu puerto
  user: 'postgres',               // ← Tu usuario
  password: 'tu_password',        // ← Tu password
  database: 'cotransmeq',       // ← Nombre de tu DB
  ssl: false
});
```

### Paso 2: Ejecutar el Análisis

```bash
npm run migrate:compare
```

---

## 📊 Ejemplo de Salida

```
🔍 ANÁLISIS DETALLADO DE BASES DE DATOS
====================================================================================================

📍 ORIGEN: Base de datos local (transmeralda_backend)
📍 DESTINO: Azure PostgreSQL (backend-nest)

🔌 Conectando a bases de datos...
✅ Conectado a ORIGEN
✅ Conectado a DESTINO

[1/16] Analizando usuarios... ✅
[2/16] Analizando conductores... ❌
[3/16] Analizando vehiculos... ✅
[4/16] Analizando servicio... ❌
...

====================================================================================================
📊 RESUMEN DETALLADO
====================================================================================================

📋 TABLA: servicio
────────────────────────────────────────────────────────────────────────────────────────────────────
   ✅ Existe en ambas bases de datos

   📐 ESTRUCTURA:
      Columnas en origen:  25
      Columnas en destino: 25
      Columnas comunes:    25
      ✅ Estructura IDÉNTICA

   📊 DATOS:
      Registros en origen:  1,234
      Registros en destino: 856
      Diferencia:           +378
      ❌ Número de registros DIFERENTE

   🔍 ÚLTIMO REGISTRO:
      ORIGEN:
         id: abc-123-def-456
         created_at: 2026-01-15T10:30:00.000Z
         estado: realizado
      DESTINO:
         id: xyz-789-uvw-012
         created_at: 2025-12-20T08:15:00.000Z
         estado: en_curso
      ❌ Últimos registros DIFERENTES

   🎯 VEREDICTO:
      ❌ ❌ ❌ TABLA NECESITA MIGRACIÓN
         → Faltan 378 registros en destino
         → Los últimos registros no coinciden

────────────────────────────────────────────────────────────────────────────────────────────────────

📋 TABLA: usuarios
────────────────────────────────────────────────────────────────────────────────────────────────────
   ✅ Existe en ambas bases de datos

   📐 ESTRUCTURA:
      Columnas en origen:  15
      Columnas en destino: 15
      Columnas comunes:    15
      ✅ Estructura IDÉNTICA

   📊 DATOS:
      Registros en origen:  15
      Registros en destino: 15
      Diferencia:           0
      ✅ Mismo número de registros

   🔍 ÚLTIMO REGISTRO:
      ORIGEN:
         id: user-123-abc
         created_at: 2026-01-10T15:20:00.000Z
         nombre: Admin
      DESTINO:
         id: user-123-abc
         created_at: 2026-01-10T15:20:00.000Z
         nombre: Admin
      ✅ Últimos registros COINCIDEN

   🎯 VEREDICTO:
      ✅ ✅ ✅ TABLA MIGRADA CORRECTAMENTE


====================================================================================================
🎯 RESUMEN GENERAL
====================================================================================================

✅ Tablas migradas correctamente: 10
❌ Tablas con problemas:         6
⚠️  Tablas no encontradas:        0

⚠️  ACCIÓN REQUERIDA:
   Algunas tablas tienen diferencias entre origen y destino.
   Ejecuta: npm run migrate:to-azure
```

---

## 🎯 Interpretación de Resultados

### ✅ Tabla Migrada Correctamente
```
✅ ✅ ✅ TABLA MIGRADA CORRECTAMENTE
```
- La estructura es idéntica
- Mismo número de registros
- Los últimos registros coinciden
- **No requiere acción**

### ❌ Tabla con Estructura Diferente
```
⚠️  Solo en origen: old_column_name
⚠️  Solo en destino: new_column_name
❌ Estructura DIFERENTE
```
- Las tablas tienen columnas diferentes
- Puede ser intencional (refactorización del schema)
- **Verifica si es esperado o necesitas actualizar el schema**

### ❌ Tabla con Datos Faltantes
```
Registros en origen:  1,234
Registros en destino: 856
Diferencia:           +378
❌ Número de registros DIFERENTE
```
- Hay registros que no se han migrado
- **Ejecuta la migración: `npm run migrate:to-azure`**

### ❌ Últimos Registros Diferentes
```
❌ Últimos registros DIFERENTES
```
- El registro más reciente en origen es diferente al de destino
- Indica que la data no está sincronizada
- **Ejecuta la migración para actualizar**

---

## 🔧 Tablas que se Analizan

Por defecto, el script analiza estas tablas principales:

- usuarios
- conductores
- vehiculos
- clientes
- servicio
- liquidaciones
- municipios
- recargos
- tipos_recargos
- recargos_planillas
- dias_laborales_planillas
- anticipos
- bonificaciones
- pernotes
- mantenimientos
- documento

### Agregar más tablas

Edita el array `tablesToCheck` en `compare-databases.ts` (línea 177):

```typescript
const tablesToCheck = [
  'usuarios',
  'conductores',
  'tu_nueva_tabla', // ← Agregar aquí
];
```

---

## 🆚 Diferencias con `migrate:check`

### `npm run migrate:check` (Rápido)
- ✅ Solo cuenta registros
- ✅ Muestra diferencias numéricas
- ✅ Rápido (< 5 segundos)
- ❌ No compara estructura
- ❌ No compara datos actuales

### `npm run migrate:compare` (Completo)
- ✅ Cuenta registros
- ✅ Compara estructura de tablas
- ✅ Compara columnas
- ✅ Obtiene y compara últimos registros
- ✅ Análisis detallado
- ⚠️  Más lento (20-30 segundos)

**Recomendación**: 
- Usa `migrate:check` para verificaciones rápidas
- Usa `migrate:compare` antes de decidir migrar

---

## 💡 Casos de Uso

### Caso 1: Verificar si necesitas migrar
```bash
npm run migrate:compare
```
Si ves muchas tablas con ❌, ejecuta la migración.

### Caso 2: Verificar después de migrar
```bash
npm run migrate:to-azure
# Esperar a que termine
npm run migrate:compare
```
Deberías ver todas las tablas con ✅

### Caso 3: Debug de problemas de datos
Si algo no funciona en la app, verifica si los datos están sincronizados:
```bash
npm run migrate:compare
```
Busca la tabla específica en los resultados.

### Caso 4: Verificar schema después de cambios
Después de agregar nuevas columnas o tablas:
```bash
npm run migrate:compare
```
Verifica que las estructuras sean compatibles.

---

## ⚠️ Notas Importantes

1. **El script solo LEE datos**, no modifica nada
2. Necesitas tener acceso a ambas bases de datos
3. El script se enfoca en columnas comunes al comparar registros
4. Las diferencias de timestamps pequeñas (milisegundos) pueden ser ignoradas
5. Si las estructuras son muy diferentes, el script puede no comparar datos

---

## 🔄 Flujo de Trabajo Recomendado

```
1. npm run migrate:compare
   ↓
2. ¿Hay diferencias?
   ↓
3. Sí → npm run migrate:to-azure
   No → Todo está sincronizado ✅
   ↓
4. npm run migrate:compare (verificar)
   ↓
5. ¿Ahora está todo igual?
   Sí → ✅ Migración exitosa
   No → Revisar errores en logs
```

---

## 🆘 Solución de Problemas

### Error: "Cannot find module 'pg'"
```bash
npm install pg @types/pg
```

### Error: "connection refused"
- Verifica que ambas bases de datos estén accesibles
- Revisa los datos de conexión en el script

### Las tablas no coinciden pero debería
- Puede ser que las tablas tengan nombres ligeramente diferentes
- Verifica que estés comparando las tablas correctas
- Asegúrate de estar conectado a las bases de datos correctas

### El script es muy lento
- Normal con tablas muy grandes
- Puedes reducir el número de tablas a comparar
- O usar `migrate:check` para verificaciones rápidas

---

✨ **Tip**: Ejecuta este comando regularmente para asegurarte de que tus bases de datos permanezcan sincronizadas.
