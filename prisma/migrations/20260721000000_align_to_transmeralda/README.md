# Migración: Cotransmeq → Esquema de Transmeralda

**Fecha:** 2026-07-21
**Origen (target):** `transmeralda/backend-nest/prisma/schema.prisma` (más completo y actual)
**Destino (source):** `cotransmeq/backend-nest-main 2/prisma/schema.prisma` (antiguo)

---

## 1. Resumen ejecutivo

| Concepto                 | Transmeralda | Cotransmeq (antes) | Diferencia |
|--------------------------|-------------:|-------------------:|-----------:|
| Modelos                  | 86           | 54                 | +32        |
| Enums                    | 45           | 29                 | +16        |
| Modelos solo en origen   | 32           | —                  | crear      |
| Modelos solo en destino  | —            | 0                  | (ninguno)  |
| Modelos comunes          | 54           | 54                 | modificar  |

**Aplica:** todos los modelos comunes de Cotransmeq con las diferencias detectadas.

---

## 2. Contenido de la carpeta

```
20260721000000_align_to_transmeralda/
├── migration.sql    ← Script SQL principal (ejecutable)
└── README.md        ← Este archivo
```

---

## 3. Cambios aplicados (por sección del migration.sql)

| §  | Sección                                            | Resumen                                                   |
|----|----------------------------------------------------|-----------------------------------------------------------|
| 0  | Pre-requisitos                                     | `CREATE EXTENSION pgcrypto`                               |
| 1  | 16 enums nuevos                                    | Crear 16 enums que solo existen en transmeralda           |
| 2  | 3 enums actualizados                               | Añadir valores a `enum_terceros_tipo_persona` y `enum_conductores_estado`; reemplazar `tipo_servicio_tarifa_enum` |
| 3  | Normalizar enums case-sensitive                    | `enum_conductores_estado` y `enum_vehiculos_estado` (Postgres distingue mayúsculas) |
| 4  | 60+ columnas añadidas                              | A 13 tablas comunes                                       |
| 5  | Modificar tipos de columnas                        | Decimales (15,2)→(12,2), (6,2)→(5,2), (5,2)→(4,2) y nulabilidad |
| 6  | Eliminar columnas obsoletas (COMENTADAS)           | `share_token`, `share_token_expires_at` y 6 cols de `registro_dia_laboral` |
| 7  | 9+ índices/unique/FK nuevos                        | En tablas existentes                                      |
| 8  | 30 tablas nuevas (32 - 2 que son opcionales/@@ignore) | Solo en transmeralda                                     |
| 9  | Relaciones renombradas                             | Notas sobre `@relation` (afectan solo al cliente Prisma)  |
| 10 | Verificaciones post-migración                      | Queries de validación                                     |

---

## 4. Decisiones interpretativas (REQUIEREN REVISIÓN DE NEGOCIO)

Estas decisiones se tomaron porque los datos de Cotransmeq no son 100% compatibles con la nueva estructura. **Validar con el equipo de negocio antes de ejecutar en producción.**

### 4.1 `vehiculos.estado`: mapeo de `NO_DISPONIBLE`

Cotransmeq tiene el valor `NO_DISPONIBLE` que **no existe** en Transmeralda. Se mapeó a `inactivo` (interpretación razonable). **Otras opciones posibles:** `disponible`, `mantenimiento`, o agregar `NO_DISPONIBLE` al nuevo enum.

```sql
UPDATE vehiculos SET estado = 'inactivo' WHERE estado = 'NO_DISPONIBLE';
```

**Si necesitas conservarlo como valor distinto**, edita la SECCIÓN 3.2 del `migration.sql` y reemplaza el bloque por:

```sql
ALTER TYPE enum_vehiculos_estado_new ADD VALUE 'NO_DISPONIBLE';
UPDATE vehiculos SET estado = 'NO_DISPONIBLE' WHERE estado = 'NO_DISPONIBLE';
```

### 4.2 `tipo_servicio_tarifa_enum`: reemplazo total

Los valores antiguos (`HORA_24`, `HORA_12`, `HORA`, `KILOMETRO`) **no existen** en el nuevo esquema (`TRANSPORTE_*`). Se usó el siguiente mapeo:

| Antiguo     | Nuevo (transmeralda)                |
|-------------|-------------------------------------|
| `HORA_24`   | `TRANSPORTE_DE_PERSONAL_EN_CAMIONETA` |
| `HORA_12`   | `TRANSPORTE_DE_PERSONAL_EN_BUSETA`    |
| `HORA`      | `TRANSPORTE_ADICIONAL_HORA_ADICIONAL`  |
| `KILOMETRO` | `TRANSPORTE_ADICIONAL_KM_ADICIONAL`    |

**Si el mapeo no corresponde con la semántica del negocio**, edita la SECCIÓN 2.3 del `migration.sql`.

### 4.3 Columnas obsoletas (SECCIÓN 6) — COMENTADAS

Por seguridad, los `DROP COLUMN` de `share_token`/`share_token_expires_at` (en `liquidaciones`) y de las 6 columnas de `registro_dia_laboral` (movidas a `registro_dia_laboral_segmento`) están **comentados**.

**Si los datos existentes pueden perderse sin problema**, descomentar la SECCIÓN 6 del `migration.sql`.

**Si se requiere migrar datos**, hay que escribir una migración de datos adicional antes de eliminar las columnas. Ejemplo para `registro_dia_laboral`:

```sql
INSERT INTO registro_dia_laboral_segmento (
  id, registro_dia_id, vehiculo_placa, hora_inicio, hora_fin,
  horas_conducidas, created_at, updated_at
)
SELECT
  gen_random_uuid(), id, vehiculo_placa, hora_inicio, hora_fin,
  horas_conducidas, NOW(), NOW()
FROM registro_dia_laboral
WHERE hora_inicio IS NOT NULL;
```

### 4.4 Reducciones de precisión Decimal

Varios campos cambian a precisión menor (`(15,2)→(12,2)`, `(6,2)→(5,2)`, `(5,2)→(4,2)`). El script incluye **validaciones previas** que abortan la operación si hay valores que no caben. Si esto ocurre, la transacción hará rollback automático.

**Para validar manualmente antes:**

```sql
SELECT MAX(valor_servicios)        FROM liquidacion_servicio;        -- debe ser <= 9,999,999,999.99
SELECT MAX(valor_unitario)        FROM liquidacion_servicio_item;
SELECT MAX(valor_liquidar)         FROM liquidacion_tercero;
SELECT MAX(total_horas_trabajadas) FROM recargos_planillas;         -- debe ser <= 999.99
SELECT MAX(horas)                  FROM detalles_recargos_dias;     -- debe ser <= 99.99
```

### 4.5 `recargos_planillas.servicio_id`: cambio de `onDelete`

Cotransmeq: `ON DELETE SET NULL`. Transmeralda: implícito `NO ACTION`. Si se elimina un `servicio` con `recargos_planillas` referenciándolo, ahora **bloqueará el borrado** del servicio en lugar de poner el FK a NULL.

**Si necesitas mantener `SET NULL`**, edita la SECCIÓN 7.7 y elimina la línea que recrea la constraint.

### 4.6 Renombramientos de `@relation` (no afectan BD)

Prisma usa los nombres de `@relation` (ej. `liquidacion_servicio_creado_por`) en el cliente, no en la BD. Los renombramientos entre cotransmeq y transmeralda solo requieren regenerar el cliente:

```bash
npx prisma generate
```

**No requieren migración SQL.**

---

## 5. Pre-requisitos

1. **Backup completo** de la base de datos de Cotransmeq.
2. PostgreSQL >= 12 (usa `gen_random_uuid()` de pgcrypto).
3. Permisos para: `CREATE TYPE`, `ALTER TYPE`, `CREATE TABLE`, `ALTER TABLE`, `DROP TYPE`, `RENAME VALUE`.
4. Verificar que las migraciones previas de Cotransmeq ya estén aplicadas (ver tabla `_prisma_migrations`).

---

## 6. Ejecución

### Opción A: Prisma Migrate (recomendado)

```bash
cd "/Users/julianlopez/Desktop/Cotransmeq/backend-nest-main 2"
npx prisma migrate deploy
npx prisma generate
```

Prisma detecta la nueva carpeta `20260721000000_align_to_transmeralda/` y aplica `migration.sql` dentro de una transacción.

### Opción B: Manual con psql

```bash
psql "postgresql://USER:PASS@HOST:PORT/DBNAME" \
  -f "prisma/migrations/20260721000000_align_to_transmeralda/migration.sql"
```

> Para registrar la migración en el historial de Prisma después:
>
> ```sql
> INSERT INTO "_prisma_migrations" (id, checksum, migration_name, finished_at, applied_steps_count, logs)
> VALUES (
>   gen_random_uuid()::text,
>   '0000000000000000000000000000000000000000000000000000000000000000',
>   '20260721000000_align_to_transmeralda',
>   NOW(), 1, NULL
> );
> ```
>
> El checksum correcto se genera al ejecutar `prisma migrate dev` o `prisma migrate resolve --applied`.

### Opción C: Prisma Migrate con dry-run

```bash
npx prisma migrate diff \
  --from-url "$DATABASE_URL_OLD" \
  --to-schema-datamodel prisma/schema.prisma \
  --script > /tmp/diff.sql

# Comparar /tmp/diff.sql con nuestro migration.sql
```

---

## 7. Verificación post-aplicación

```sql
-- Conteo de tablas (debe ser 86 + SequelizeMeta + bonificaciones_backup(ign))
SELECT COUNT(*) FROM information_schema.tables
  WHERE table_schema = 'public' AND table_type = 'BASE TABLE';

-- Enums creados (debe incluir los 16 nuevos)
SELECT typname FROM pg_type WHERE typtype = 'e' ORDER BY typname;

-- Columnas con deleted_at (soft delete añadido)
SELECT table_name, column_name
  FROM information_schema.columns
  WHERE column_name = 'deleted_at' AND table_schema = 'public'
  ORDER BY table_name;

-- Verificar índices únicos nuevos
SELECT conname, conrelid::regclass
  FROM pg_constraint
  WHERE contype = 'u' AND conname IN (
    'uniq_recargo_origen_planilla',
    'firmas_desprendibles_token_key',
    'bono_config_visual_config_liquidacion_id_anio_key',
    'aprobaciones_accion_accion_id_key',
    'ciclos_seguimiento_eficacia_accion_correctiva_id_numero__key',
    'evidencias_eficacia_cierre_accion_correctiva_id_orden_key',
    'liquidacion_tercero_final_item_liquidacion_tercero_final_id_l_key',
    'certificado_tercero_tercero_id_certificado_id_key',
    'formulario_sarlaft_ptee_documento_formulario_id_tipo_doc_key'
  );

-- Verificar que los defaults de enums están en minúscula
SELECT t.typname, e.enumlabel
  FROM pg_enum e
  JOIN pg_type t ON e.enumtypid = t.oid
  WHERE t.typname IN ('enum_conductores_estado', 'enum_vehiculos_estado')
  ORDER BY t.typname, e.enumsortorder;

-- Confirmar migración registrada
SELECT migration_name, finished_at IS NOT NULL AS applied
  FROM "_prisma_migrations"
  WHERE migration_name = '20260721000000_align_to_transmeralda';
```

---

## 8. Rollback (en caso de fallo)

La migración está envuelta en una transacción de Prisma. Si algo falla durante `migrate deploy`, **se hace rollback automático**.

Para ejecución manual con `psql`, agregar al inicio del script:

```sql
BEGIN;
-- ... resto del script ...
COMMIT;
```

Y ante un fallo:

```sql
ROLLBACK;
```

Después del rollback, restaurar desde el backup:

```bash
pg_restore -d <dbname> <backup.dump>
```

---

## 9. Próximos pasos sugeridos

1. **Reemplazar el `schema.prisma` de Cotransmeq** con el de Transmeralda (o unificar el código).
2. **Regenerar el cliente Prisma**: `npx prisma generate`.
3. **Sincronizar el código de aplicación** (módulos, services, controllers) que use los nuevos modelos/enums.
4. **Validar tipos generados** con `npx tsc --noEmit` en el backend.
5. **Smoke test** de los módulos más críticos: liquidaciones, recargos, vehículos, acciones correctivas.

---

## 10. Archivos modificados por esta migración

- ✅ 30 tablas nuevas creadas
- ✅ 16 enums nuevos creados
- ✅ 3 enums actualizados
- ✅ 60+ columnas añadidas a tablas existentes
- ✅ ~20 columnas con tipo modificado
- ✅ 9+ índices/unique/FK nuevos
- ⚠️ 0 columnas eliminadas (DROP COLUMN comentadas por seguridad)
- ⚠️ 1 FK con cambio de comportamiento (`recargos_planillas.servicio_id`)
- ⚠️ ~6 renombramientos de `@relation` (afectan solo al cliente Prisma)
