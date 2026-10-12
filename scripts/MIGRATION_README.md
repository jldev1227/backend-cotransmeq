# 📦 Script de Migración de Base de Datos a Azure

Este script migra todos los datos de tu base de datos PostgreSQL actual a Azure PostgreSQL.

## ⚠️ IMPORTANTE - Antes de Ejecutar

### 1. **Configurar Datos de Origen**

Edita el archivo `migrate-to-azure.ts` en las líneas 4-11:

```typescript
const sourceDb = new Client({
  host: 'localhost',           // ← Cambia por tu host (ej: 'localhost' o IP)
  port: 5432,                  // ← Puerto de tu DB origen
  user: 'tu_usuario_origen',   // ← Usuario de tu DB origen
  password: 'tu_password_origen', // ← Password de tu DB origen
  database: 'cotransmeq',    // ← Nombre de tu DB origen
  ssl: false                   // ← Cambiar a true si tu DB origen usa SSL
});
```

### 2. **Verificar Datos de Destino**

Los datos de Azure ya están configurados (líneas 14-22), verifica que sean correctos:

```typescript
const targetDb = new Client({
  host: 'cotransmeq.postgres.database.azure.com',
  port: 5432,
  user: 'admintransmeralda',
  password: '<CLAVE>',
  database: 'postgres',
  ssl: { rejectUnauthorized: false }
});
```

### 3. **Hacer Backup (MUY IMPORTANTE)**

Antes de ejecutar, haz un backup de ambas bases de datos:

```bash
# Backup de origen
pg_dump -h localhost -U tu_usuario -d cotransmeq -F c -f backup_origen_$(date +%Y%m%d).dump

# Backup de Azure (por si acaso)
pg_dump -h cotransmeq.postgres.database.azure.com -U admintransmeralda -d postgres -F c -f backup_azure_$(date +%Y%m%d).dump
```

## 🚀 Cómo Ejecutar la Migración

### Paso 1: Instalar Dependencias

Si aún no tienes `pg` instalado:

```bash
cd backend-nest
npm install pg @types/pg
```

### Paso 2: Ejecutar el Script

```bash
# Desde la carpeta backend-nest
npx tsx scripts/migrate-to-azure.ts
```

### Paso 3: Confirmar

El script te pedirá confirmación antes de empezar:
```
⚠️  ADVERTENCIA: Esta operación eliminará los datos existentes en Azure!
⏸️  Presiona Ctrl+C para cancelar o Enter para continuar...
```

Presiona **Enter** para continuar o **Ctrl+C** para cancelar.

## 📊 Qué Hace el Script

1. **Conecta** a ambas bases de datos (origen y destino)
2. **Verifica** que cada tabla exista en origen
3. **Cuenta** cuántos registros hay en cada tabla
4. **Limpia** la tabla en destino (Azure) con `TRUNCATE CASCADE`
5. **Copia** los datos en lotes de 100 registros
6. **Reinicia** las secuencias automáticas (IDs)
7. **Muestra** un resumen completo de la migración

## 📋 Tablas que se Migran

El script migra las siguientes tablas en orden (respetando dependencias):

1. **Sin dependencias:**
   - usuarios
   - municipios
   - clientes
   - subsystems
   - tipos_recargos
   - recargos
   - documentos_requeridos_conductor

2. **Con dependencias de usuarios:**
   - conductores
   - vehiculos
   - configuracion_liquidador
   - configuraciones_liquidacion
   - configuraciones_salarios

3. **Servicios:**
   - servicio
   - servicio_historicos
   - servicios_cancelados

4. **Liquidaciones:**
   - liquidaciones
   - liquidacion_vehiculo
   - liquidaciones_servicios
   - servicio_liquidaciones

5. **Otros:**
   - anticipos, bonificaciones, pernotes
   - recargos_planillas, dias_laborales_planillas
   - firmas_desprendibles
   - formularios_asistencia, respuestas_asistencia
   - acciones_correctivas_preventivas

## 📈 Ejemplo de Salida

```
🚀 Iniciando migración de base de datos...

📍 ORIGEN: Base de datos local/actual
📍 DESTINO: Azure PostgreSQL

🔌 Conectando a bases de datos...
✅ Conectado a base de datos ORIGEN
✅ Conectado a base de datos DESTINO (Azure)

📦 Iniciando migración de tablas...
📋 Total de tablas a migrar: 34

[1/34] ▶️  Procesando: usuarios
   📊 Registros en origen: 15
   📥 Leyendo datos de origen...
   🗑️  Limpiando tabla en destino...
   📤 Insertando datos... 100% (15/15)
   ✅ Migración completada: 15 registros copiados

[2/34] ▶️  Procesando: conductores
   📊 Registros en origen: 42
   📥 Leyendo datos de origen...
   🗑️  Limpiando tabla en destino...
   📤 Insertando datos... 100% (42/42)
   ✅ Migración completada: 42 registros copiados

...

================================================================================
📊 RESUMEN DE MIGRACIÓN
================================================================================

✅ Tablas migradas exitosamente: 32
⚠️  Tablas saltadas (vacías/no existen): 2
❌ Tablas con errores: 0
📊 Total de registros copiados: 1,234
⏱️  Duración total: 45.32s

================================================================================
🎉 Migración completada!

🔌 Conexiones cerradas
```

## ⚠️ Solución de Problemas

### Error: "relation does not exist"

La tabla no existe en la base de datos destino. Asegúrate de que Prisma haya creado todas las tablas:

```bash
cd backend-nest
npx prisma migrate deploy
```

### Error: "connection refused"

Verifica que:
- Tu base de datos origen esté corriendo
- Los datos de conexión sean correctos
- Azure PostgreSQL permita conexiones desde tu IP

### Error: "foreign key constraint"

El orden de las tablas importa. El script ya está ordenado, pero si agregas nuevas tablas, asegúrate de migrar las tablas "padre" antes que las "hijas".

### La migración es muy lenta

Puedes aumentar el `batchSize` en la línea 127:

```typescript
const batchSize = 500; // Aumentar de 100 a 500
```

## 🔄 Migrar Solo Algunas Tablas

Edita el array `tablesToMigrate` en el script y comenta las que no quieras migrar:

```typescript
const tablesToMigrate = [
  'usuarios',
  'conductores',
  // 'vehiculos', // ← Esta no se migrará
  'servicio',
];
```

## 🧹 Después de la Migración

1. **Verifica los datos** en Azure:
   ```bash
   psql -h cotransmeq.postgres.database.azure.com -U admintransmeralda -d postgres
   ```

2. **Cuenta registros** en algunas tablas:
   ```sql
   SELECT COUNT(*) FROM usuarios;
   SELECT COUNT(*) FROM conductores;
   SELECT COUNT(*) FROM servicio;
   ```

3. **Actualiza tu .env** si estás cambiando de base de datos:
   ```env
   DATABASE_URL="postgresql://USUARIO:CLAVE@HOST:5432/BASE?schema=public&sslmode=require"
   ```

4. **Reinicia tu aplicación**:
   ```bash
   npm run dev
   ```

## 📞 Soporte

Si encuentras algún problema, revisa:
- Los logs completos del script
- Las conexiones a ambas bases de datos
- Que las tablas existan en destino
- Los permisos del usuario en Azure

---

✨ **Tip**: Es recomendable ejecutar este script en horarios de bajo tráfico para evitar inconsistencias en los datos.
