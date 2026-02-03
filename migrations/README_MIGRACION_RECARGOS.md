# Migración de Datos de Recargos

Este script migra los datos del módulo de recargos desde la base de datos MySQL local a Azure PostgreSQL.

## Tablas que se migran

1. **tipos_recargos** - Tipos de recargos (HED, HEN, HEFD, HEFN, RN, RD)
2. **configuraciones_salarios** - Configuración de salarios por empresa
3. **recargos_planillas** - Planillas de recargos mensuales
4. **dias_laborales_planillas** - Días laborados en cada planilla
5. **detalles_recargos_dias** - Detalles de recargos calculados por día
6. **historial_recargos_planillas** - Historial de cambios
7. **snapshots_recargos_planillas** - Snapshots de versiones

## Pre-requisitos

1. Tener acceso a ambas bases de datos (MySQL y PostgreSQL Azure)
2. Instalar dependencias adicionales:

```bash
npm install mysql2 pg
```

## Configuración

Agregar las siguientes variables al archivo `.env`:

```bash
# MySQL (Origen)
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=tu_password
MYSQL_DATABASE=transmeralda_db

# PostgreSQL Azure (Destino) - Ya configurado
DATABASE_URL="postgresql://admintransmeralda:SASesmeralda2025@cotransmeq.postgres.database.azure.com:5432/postgres?schema=public&sslmode=require"
```

## Ejecución

### Opción 1: Migración completa

```bash
node migrations/migrate-recargos.js
```

### Opción 2: Migración con log detallado

```bash
node migrations/migrate-recargos.js 2>&1 | tee migrations/recargos-migration.log
```

## Orden de Migración

El script migra las tablas en el siguiente orden para respetar las relaciones de foreign keys:

1. `tipos_recargos` (no tiene dependencias)
2. `configuraciones_salarios` (depende de empresas/clientes)
3. `recargos_planillas` (depende de conductores, vehiculos, empresas)
4. `dias_laborales_planillas` (depende de recargos_planillas)
5. `detalles_recargos_dias` (depende de dias_laborales_planillas y tipos_recargos)
6. `historial_recargos_planillas` (opcional, histórico)
7. `snapshots_recargos_planillas` (opcional, snapshots)

## Estrategia de Conflictos

- **ON CONFLICT DO UPDATE**: Para tablas de configuración y datos principales
- **ON CONFLICT DO NOTHING**: Para tablas de historial y snapshots

Esto permite re-ejecutar el script sin duplicar datos.

## Verificación Post-Migración

### 1. Verificar conteo de registros

```sql
-- En PostgreSQL Azure
SELECT 
  'tipos_recargos' as tabla, COUNT(*) as total FROM tipos_recargos WHERE deleted_at IS NULL
UNION ALL
SELECT 'configuraciones_salarios', COUNT(*) FROM configuraciones_salarios WHERE deleted_at IS NULL
UNION ALL
SELECT 'recargos_planillas', COUNT(*) FROM recargos_planillas WHERE deleted_at IS NULL
UNION ALL
SELECT 'dias_laborales_planillas', COUNT(*) FROM dias_laborales_planillas WHERE deleted_at IS NULL
UNION ALL
SELECT 'detalles_recargos_dias', COUNT(*) FROM detalles_recargos_dias WHERE deleted_at IS NULL;
```

### 2. Verificar integridad referencial

```sql
-- Verificar que todos los recargos tienen conductor, vehiculo y empresa válidos
SELECT COUNT(*) 
FROM recargos_planillas rp
LEFT JOIN conductores c ON rp.conductor_id = c.id
LEFT JOIN vehiculos v ON rp.vehiculo_id = v.id
LEFT JOIN empresas e ON rp.empresa_id = e.id
WHERE c.id IS NULL OR v.id IS NULL OR e.id IS NULL;
-- Debe retornar 0
```

### 3. Probar el endpoint

```bash
curl http://localhost:4000/api/recargos?mes=1&año=2026&page=1&limit=50
```

## Troubleshooting

### Error: "relation already exists"

Las tablas ya existen en Azure. El script usa `ON CONFLICT` para actualizar, no debería dar este error.

### Error: "foreign key constraint violation"

Asegúrate de que las tablas referenciadas (conductores, vehiculos, empresas/clientes) ya existen y tienen los IDs correctos.

### Error: "connection timeout"

Verifica la conectividad a ambas bases de datos:

```bash
# MySQL
mysql -h localhost -u root -p transmeralda_db

# PostgreSQL Azure
psql "postgresql://admintransmeralda:SASesmeralda2025@cotransmeq.postgres.database.azure.com:5432/postgres?sslmode=require"
```

### Error: "tipos_recargos not found"

Si la tabla tipos_recargos no existe en MySQL, necesitas crearla primero o omitir su migración.

## Rollback

Si necesitas revertir la migración:

```sql
-- ⚠️ CUIDADO: Esto elimina todos los datos de recargos
BEGIN;

DELETE FROM snapshots_recargos_planillas;
DELETE FROM historial_recargos_planillas;
DELETE FROM detalles_recargos_dias;
DELETE FROM dias_laborales_planillas;
DELETE FROM recargos_planillas;
DELETE FROM configuraciones_salarios;
-- tipos_recargos generalmente no se elimina porque puede ser usado por otros módulos

ROLLBACK; -- O COMMIT si estás seguro
```

## Estadísticas Esperadas

Después de la migración, deberías ver algo como:

```
============================================================
📊 RESUMEN DE MIGRACIÓN
============================================================
✅ tipos_recargos                     6/6 (errores: 0)
✅ configuraciones_salarios           12/12 (errores: 0)
✅ recargos_planillas                 145/145 (errores: 0)
✅ dias_laborales_planillas           3820/3820 (errores: 0)
✅ detalles_recargos_dias             18450/18450 (errores: 0)
✅ historial_recargos_planillas       287/287 (errores: 0)
✅ snapshots_recargos_planillas       58/58 (errores: 0)
============================================================
```

## Soporte

Si encuentras errores durante la migración, revisa:

1. Los logs del script
2. Las constraints de las tablas en el schema de Prisma
3. Los datos en la base de datos MySQL de origen
4. La conectividad a ambas bases de datos
