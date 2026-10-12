#!/bin/bash

# Script de migración usando INSERT con ON CONFLICT
# Migra datos de recargos de PostgreSQL origen a Azure

set -e

# Colores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuración
# Las credenciales salen del entorno, nunca del código: este archivo está
# versionado y las que tenía escritas quedaron en el historial de git.
ORIGEN_URL="${MIGRACION_ORIGEN_URL:?Falta MIGRACION_ORIGEN_URL}"

DESTINO_URL="${MIGRACION_DESTINO_URL:?Falta MIGRACION_DESTINO_URL}"

echo -e "${BLUE}🚀 Iniciando migración de recargos con ON CONFLICT...${NC}\n"

# Función para migrar con INSERT SELECT vía dblink
migrate_with_upsert() {
    local table=$1
    local conflict_column=$2
    
    echo -e "${BLUE}📊 Migrando $table...${NC}"
    
    # Crear tabla temporal con datos de origen
    psql -d "$ORIGEN_URL" -t -c "
        SELECT COUNT(*) FROM $table WHERE deleted_at IS NULL;
    " | xargs
    
    local count=$(psql -d "$ORIGEN_URL" -t -c "
        SELECT COUNT(*) FROM $table WHERE deleted_at IS NULL;
    " | xargs)
    
    echo -e "${GREEN}  ✅ $count registros en origen${NC}"
}

# Migrar usando pg_dump y pg_restore con formato custom
echo -e "${BLUE}📦 Exportando tipos_recargos desde origen...${NC}"
pg_dump -d "$ORIGEN_URL" \
    --table=tipos_recargos --data-only --column-inserts --on-conflict-do-nothing \
    > /tmp/tipos_recargos.sql 2>&1

echo -e "${BLUE}📥 Importando tipos_recargos a Azure...${NC}"
psql "$DESTINO_URL" < /tmp/tipos_recargos.sql 2>&1 | grep -E "(INSERT|ERROR)" || true

echo -e "${BLUE}📦 Exportando configuraciones_salarios...${NC}"
pg_dump -d "$ORIGEN_URL" \
    --table=configuraciones_salarios --data-only --column-inserts --on-conflict-do-nothing \
    > /tmp/configuraciones_salarios.sql 2>&1

echo -e "${BLUE}📥 Importando configuraciones_salarios...${NC}"
psql "$DESTINO_URL" < /tmp/configuraciones_salarios.sql 2>&1 | grep -E "(INSERT|ERROR)" || true

echo -e "${BLUE}📦 Exportando recargos_planillas...${NC}"
pg_dump -d "$ORIGEN_URL" \
    --table=recargos_planillas --data-only --column-inserts --on-conflict-do-nothing \
    > /tmp/recargos_planillas.sql 2>&1

echo -e "${BLUE}📥 Importando recargos_planillas...${NC}"
psql "$DESTINO_URL" < /tmp/recargos_planillas.sql 2>&1 | grep -E "(INSERT|ERROR)" || true

echo -e "${BLUE}📦 Exportando dias_laborales_planillas...${NC}"
pg_dump -d "$ORIGEN_URL" \
    --table=dias_laborales_planillas --data-only --column-inserts --on-conflict-do-nothing \
    > /tmp/dias_laborales_planillas.sql 2>&1

echo -e "${BLUE}📥 Importando dias_laborales_planillas...${NC}"
psql "$DESTINO_URL" < /tmp/dias_laborales_planillas.sql 2>&1 | grep -E "(INSERT|ERROR)" || true

echo -e "${BLUE}📦 Exportando detalles_recargos_dias...${NC}"
pg_dump -d "$ORIGEN_URL" \
    --table=detalles_recargos_dias --data-only --column-inserts --on-conflict-do-nothing \
    > /tmp/detalles_recargos_dias.sql 2>&1

echo -e "${BLUE}📥 Importando detalles_recargos_dias...${NC}"
psql "$DESTINO_URL" < /tmp/detalles_recargos_dias.sql 2>&1 | grep -E "(INSERT|ERROR)" || true

echo -e "\n${GREEN}✅ Migración completada!${NC}"
