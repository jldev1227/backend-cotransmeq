-- Script de migración de datos de recargos entre bases de datos PostgreSQL
-- Origen: 100.106.115.11 (transmeralda_db_18_7_2025)
-- Destino: Azure PostgreSQL (cotransmeq.postgres.database.azure.com)

-- Ejecutar este script en dos pasos:
-- 1. Exportar datos desde origen
-- 2. Importar datos a destino

-- ============================================================
-- PASO 1: EXPORTAR DATOS (ejecutar en base de origen)
-- ============================================================

-- Conectar a base de origen:
-- psql -h 100.106.115.11 -U postgres -d transmeralda_db_18_7_2025

-- Exportar tipos_recargos
\copy (SELECT * FROM tipos_recargos WHERE deleted_at IS NULL ORDER BY created_at) TO '/tmp/tipos_recargos.csv' WITH CSV HEADER;

-- Exportar configuraciones_salarios
\copy (SELECT * FROM configuraciones_salarios WHERE deleted_at IS NULL ORDER BY created_at) TO '/tmp/configuraciones_salarios.csv' WITH CSV HEADER;

-- Exportar recargos_planillas
\copy (SELECT * FROM recargos_planillas WHERE deleted_at IS NULL ORDER BY created_at) TO '/tmp/recargos_planillas.csv' WITH CSV HEADER;

-- Exportar dias_laborales_planillas
\copy (SELECT * FROM dias_laborales_planillas WHERE deleted_at IS NULL ORDER BY created_at) TO '/tmp/dias_laborales_planillas.csv' WITH CSV HEADER;

-- Exportar detalles_recargos_dias
\copy (SELECT * FROM detalles_recargos_dias WHERE deleted_at IS NULL ORDER BY created_at) TO '/tmp/detalles_recargos_dias.csv' WITH CSV HEADER;

-- Exportar historial_recargos_planillas (opcional)
\copy (SELECT * FROM historial_recargos_planillas ORDER BY fecha_accion) TO '/tmp/historial_recargos_planillas.csv' WITH CSV HEADER;

-- Exportar snapshots_recargos_planillas (opcional)
\copy (SELECT * FROM snapshots_recargos_planillas ORDER BY created_at) TO '/tmp/snapshots_recargos_planillas.csv' WITH CSV HEADER;

-- ============================================================
-- PASO 2: IMPORTAR DATOS (ejecutar en base de destino Azure)
-- ============================================================

-- Conectar a base de destino:
-- psql "postgresql://admintransmeralda:SASesmeralda2025@cotransmeq.postgres.database.azure.com:5432/postgres?sslmode=require"

-- Importar tipos_recargos
\copy tipos_recargos FROM '/tmp/tipos_recargos.csv' WITH CSV HEADER;

-- Importar configuraciones_salarios
\copy configuraciones_salarios FROM '/tmp/configuraciones_salarios.csv' WITH CSV HEADER;

-- Importar recargos_planillas
\copy recargos_planillas FROM '/tmp/recargos_planillas.csv' WITH CSV HEADER;

-- Importar dias_laborales_planillas
\copy dias_laborales_planillas FROM '/tmp/dias_laborales_planillas.csv' WITH CSV HEADER;

-- Importar detalles_recargos_dias
\copy detalles_recargos_dias FROM '/tmp/detalles_recargos_dias.csv' WITH CSV HEADER;

-- Importar historial_recargos_planillas (opcional)
\copy historial_recargos_planillas FROM '/tmp/historial_recargos_planillas.csv' WITH CSV HEADER;

-- Importar snapshots_recargos_planillas (opcional)
\copy snapshots_recargos_planillas FROM '/tmp/snapshots_recargos_planillas.csv' WITH CSV HEADER;
