# 🎯 Sistema de Migración de Base de Datos - Cotransmeq

## 📦 Archivos Creados

```
backend-nest/
└── scripts/
    ├── migrate-to-azure.ts      # 🚀 Script principal de migración
    ├── check-databases.ts        # 🔍 Script de verificación
    ├── find-source-db.sh         # 🎯 Helper para encontrar tu DB origen
    ├── QUICK_START.md            # ⚡ Guía rápida
    └── MIGRATION_README.md       # 📚 Documentación completa
```

---

## 🎬 COMENZAR AQUÍ

### Paso 1: Identificar tu Base de Datos Origen

Tienes 3 opciones:

#### Opción A: Ejecutar el script helper (Más fácil)
```bash
cd backend-nest
./scripts/find-source-db.sh
```

Este script te ayudará a:
- ✅ Probar conexiones a tu base de datos
- ✅ Ver qué bases de datos tienes
- ✅ Contar registros en tablas principales
- ✅ Obtener la información que necesitas

#### Opción B: Revisar tu proyecto antiguo

Si tienes el proyecto `transmeralda_backend`, revisa su `.env`:
```bash
cat ../transmeralda_backend/.env
```

Busca variables como:
- `DB_HOST`
- `DB_PORT`
- `DB_USER`
- `DB_PASSWORD`
- `DB_NAME`

#### Opción C: Conectar manualmente

```bash
# Intenta con localhost primero
psql -h localhost -U postgres -d cotransmeq

# Si no funciona, prueba:
psql -h 127.0.0.1 -U postgres -d cotransmeq

# O con tu IP local
psql -h 192.168.1.x -U postgres -d cotransmeq
```

---

### Paso 2: Configurar Scripts

Una vez que sepas los datos de tu base de datos origen, edita ambos scripts:

**`scripts/migrate-to-azure.ts` (líneas 4-11)**
**`scripts/check-databases.ts` (líneas 4-11)**

```typescript
const sourceDb = new Client({
  host: 'localhost',              // ← Cambia aquí
  port: 5432,                     // ← Y aquí
  user: 'postgres',               // ← Y aquí
  password: 'tu_password',        // ← Y aquí
  database: 'cotransmeq',       // ← Y aquí
  ssl: false
});
```

---

### Paso 3: Instalar Dependencias

```bash
cd backend-nest
npm install pg @types/pg
```

---

### Paso 4: Verificar (IMPORTANTE)

```bash
npm run migrate:check
```

Este comando:
- ✅ Verifica que ambas conexiones funcionen
- ✅ Muestra cuántos registros hay en cada tabla
- ✅ Te dice si hay diferencias

**Ejemplo de salida:**
```
================================================================================
TABLA                              ORIGEN         DESTINO        DIFERENCIA
================================================================================
usuarios                           15             0              ⚠️  +15
conductores                        42             0              ⚠️  +42
vehiculos                          38             0              ⚠️  +38
servicio                           1,234          0              ⚠️  +1,234
================================================================================

⚠️  Hay diferencias entre las bases de datos.
   Considera ejecutar la migración: npm run migrate:to-azure
```

---

### Paso 5: Hacer Backup

```bash
# Backup de origen
pg_dump -h localhost -U postgres -d cotransmeq -F c -f backup_$(date +%Y%m%d).dump

# Backup de Azure (opcional)
pg_dump -h cotransmeq.postgres.database.azure.com -U admintransmeralda -d postgres -F c -f backup_azure_$(date +%Y%m%d).dump
```

---

### Paso 6: Migrar

```bash
npm run migrate:to-azure
```

El script te mostrará:
- 📊 Cuántos registros hay en cada tabla
- 🗑️ Limpiará las tablas en Azure
- 📤 Copiará todos los datos
- ⏱️ Tiempo total de migración
- ✅ Resumen final

---

## 🎯 Comandos Disponibles

```bash
# Verificar conexiones y contar registros (rápido)
npm run migrate:check

# Análisis detallado: compara estructura, columnas y últimos registros
npm run migrate:compare

# Ejecutar migración completa
npm run migrate:to-azure

# Encontrar tu base de datos origen (opcional)
./scripts/find-source-db.sh
```

---

## 📊 Tablas que se Migrarán

El script migrará automáticamente estas tablas en el orden correcto:

### Grupo 1: Sin dependencias
- usuarios
- municipios  
- clientes
- subsystems
- tipos_recargos
- recargos
- documentos_requeridos_conductor

### Grupo 2: Con dependencias
- conductores
- vehiculos
- configuracion_liquidador
- configuraciones_liquidacion
- configuraciones_salarios

### Grupo 3: Servicios
- servicio
- servicio_historicos
- servicios_cancelados

### Grupo 4: Liquidaciones
- liquidaciones
- liquidacion_vehiculo
- liquidaciones_servicios
- servicio_liquidaciones

### Grupo 5: Otros
- anticipos
- bonificaciones
- pernotes
- recargos_planillas
- dias_laborales_planillas
- detalles_recargos_dias
- historial_recargos_planillas
- snapshots_recargos_planillas
- firmas_desprendibles
- mantenimientos
- documento
- formularios_asistencia
- respuestas_asistencia
- acciones_correctivas_preventivas

---

## ⚠️ Advertencias Importantes

1. **TRUNCATE**: El script borrará los datos existentes en Azure antes de copiar

2. **Backup**: SIEMPRE haz backup antes de migrar

3. **Orden**: Las tablas se migran en orden para respetar foreign keys

4. **UUIDs**: Los IDs originales se mantienen

5. **Secuencias**: Se reinician automáticamente al final

---

## ❓ FAQ

### ¿Puedo migrar solo algunas tablas?

Sí, edita el array `tablesToMigrate` en `migrate-to-azure.ts` y comenta las que no quieras.

### ¿Qué pasa si hay un error en una tabla?

El script continúa con las demás tablas y te muestra un resumen al final con los errores.

### ¿Cuánto tiempo tarda?

Depende de la cantidad de datos:
- 1,000 registros: ~10 segundos
- 10,000 registros: ~1 minuto
- 100,000 registros: ~10 minutos

### ¿Puedo ejecutarlo varias veces?

Sí, el script borra los datos existentes antes de insertar, así que puedes ejecutarlo cuantas veces necesites.

### ¿Los datos en origen se borran?

No, solo se LEEN. Los datos originales NO se modifican.

---

## 📚 Documentación Completa

- **Guía Rápida**: `QUICK_START.md`
- **Documentación Detallada**: `MIGRATION_README.md`
- **Este Resumen**: `README.md`

---

## 🆘 Ayuda

Si tienes problemas:

1. Verifica las conexiones con `npm run migrate:check`
2. Revisa que los datos de conexión sean correctos
3. Asegúrate de que psql esté instalado
4. Verifica que ambas bases de datos estén accesibles
5. Revisa los logs completos del script

---

## ✨ Listo para Empezar

```bash
# 1. Instalar dependencias
npm install pg @types/pg

# 2. Configurar scripts (editar líneas 4-11)
# - scripts/migrate-to-azure.ts
# - scripts/check-databases.ts

# 3. Verificar
npm run migrate:check

# 4. Migrar
npm run migrate:to-azure
```

---

**Creado para**: Cotransmeq SAS  
**Proyecto**: Sistema de Gestión de Transporte  
**Base de datos**: PostgreSQL → Azure PostgreSQL  

🚀 ¡Buena suerte con tu migración!
