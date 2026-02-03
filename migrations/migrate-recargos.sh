#!/bin/bash

# Script automatizado de migración de recargos entre PostgreSQL
# Origen: 100.106.115.11 (transmeralda_db_18_7_2025)
# Destino: Azure PostgreSQL

set -e  # Exit on error

# Colores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuración
ORIGEN_HOST="100.106.115.11"
ORIGEN_DB="transmeralda_db_18_7_2025"
ORIGEN_USER="postgres"

DESTINO_URL="postgresql://admintransmeralda:SASesmeralda2025@cotransmeq.postgres.database.azure.com:5432/postgres?sslmode=require"

TEMP_DIR="/tmp/recargos_migration_$(date +%Y%m%d_%H%M%S)"
mkdir -p "$TEMP_DIR"

echo -e "${BLUE}🚀 Iniciando migración de recargos...${NC}\n"
echo -e "${YELLOW}Origen: $ORIGEN_HOST/$ORIGEN_DB${NC}"
echo -e "${YELLOW}Destino: Azure PostgreSQL${NC}"
echo -e "${YELLOW}Temp Dir: $TEMP_DIR${NC}\n"

# Función para exportar tabla
export_table() {
    local table=$1
    local where_clause=$2
    local order_by=$3
    
    echo -e "${BLUE}📤 Exportando $table...${NC}"
    
    local query="SELECT * FROM $table"
    if [ ! -z "$where_clause" ]; then
        query="$query WHERE $where_clause"
    fi
    if [ ! -z "$order_by" ]; then
        query="$query ORDER BY $order_by"
    fi
    
    PGPASSWORD=Transmeralda2025 psql -h "$ORIGEN_HOST" -U "$ORIGEN_USER" -d "$ORIGEN_DB" \
        -c "\copy ($query) TO '$TEMP_DIR/$table.csv' WITH CSV HEADER"
    
    local count=$(wc -l < "$TEMP_DIR/$table.csv")
    count=$((count - 1))  # Restar header
    echo -e "${GREEN}  ✅ $count registros exportados${NC}"
}

# Función para importar tabla
import_table() {
    local table=$1
    
    if [ ! -f "$TEMP_DIR/$table.csv" ]; then
        echo -e "${RED}  ❌ Archivo $table.csv no encontrado${NC}"
        return 1
    fi
    
    local count=$(wc -l < "$TEMP_DIR/$table.csv")
    count=$((count - 1))  # Restar header
    
    if [ $count -eq 0 ]; then
        echo -e "${YELLOW}  ⚠️  No hay datos para importar en $table${NC}"
        return 0
    fi
    
    echo -e "${BLUE}📥 Importando $table ($count registros)...${NC}"
    
    psql "$DESTINO_URL" -c "\copy $table FROM '$TEMP_DIR/$table.csv' WITH CSV HEADER" 2>&1
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}  ✅ $table importado correctamente${NC}"
    else
        echo -e "${RED}  ❌ Error importando $table${NC}"
        return 1
    fi
}

# Función para contar registros en destino
count_table() {
    local table=$1
    local where_clause=$2
    
    local query="SELECT COUNT(*) FROM $table"
    if [ ! -z "$where_clause" ]; then
        query="$query WHERE $where_clause"
    fi
    
    local count=$(psql "$DESTINO_URL" -t -c "$query" | xargs)
    echo "$count"
}

echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}PASO 1: EXPORTAR DATOS DESDE ORIGEN${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"

# Exportar tablas en orden
export_table "tipos_recargos" "deleted_at IS NULL" "created_at"
export_table "configuraciones_salarios" "deleted_at IS NULL" "created_at"
export_table "recargos_planillas" "deleted_at IS NULL" "created_at"

# Exportar solo dias_laborales con recargos válidos
echo -e "${BLUE}📤 Exportando dias_laborales_planillas (solo con referencias válidas)...${NC}"
PGPASSWORD=Transmeralda2025 psql -h "$ORIGEN_HOST" -U "$ORIGEN_USER" -d "$ORIGEN_DB" \
    -c "\copy (SELECT dlp.* FROM dias_laborales_planillas dlp INNER JOIN recargos_planillas rp ON dlp.recargo_planilla_id = rp.id WHERE dlp.deleted_at IS NULL AND rp.deleted_at IS NULL ORDER BY dlp.created_at) TO '$TEMP_DIR/dias_laborales_planillas.csv' WITH CSV HEADER"
count=$(wc -l < "$TEMP_DIR/dias_laborales_planillas.csv")
count=$((count - 1))
echo -e "${GREEN}  ✅ $count registros exportados${NC}"

# Exportar solo detalles con dias_laborales válidos
echo -e "${BLUE}📤 Exportando detalles_recargos_dias (solo con referencias válidas)...${NC}"
PGPASSWORD=Transmeralda2025 psql -h "$ORIGEN_HOST" -U "$ORIGEN_USER" -d "$ORIGEN_DB" \
    -c "\copy (SELECT drd.* FROM detalles_recargos_dias drd INNER JOIN dias_laborales_planillas dlp ON drd.dia_laboral_id = dlp.id INNER JOIN recargos_planillas rp ON dlp.recargo_planilla_id = rp.id WHERE drd.deleted_at IS NULL AND dlp.deleted_at IS NULL AND rp.deleted_at IS NULL ORDER BY drd.created_at) TO '$TEMP_DIR/detalles_recargos_dias.csv' WITH CSV HEADER"
count=$(wc -l < "$TEMP_DIR/detalles_recargos_dias.csv")
count=$((count - 1))
echo -e "${GREEN}  ✅ $count registros exportados${NC}"

export_table "historial_recargos_planillas" "" "fecha_accion"

# Exportar solo snapshots con recargos válidos
echo -e "${BLUE}📤 Exportando snapshots_recargos_planillas (solo con referencias válidas)...${NC}"
PGPASSWORD=Transmeralda2025 psql -h "$ORIGEN_HOST" -U "$ORIGEN_USER" -d "$ORIGEN_DB" \
    -c "\copy (SELECT srp.* FROM snapshots_recargos_planillas srp INNER JOIN recargos_planillas rp ON srp.recargo_planilla_id = rp.id WHERE rp.deleted_at IS NULL ORDER BY srp.created_at) TO '$TEMP_DIR/snapshots_recargos_planillas.csv' WITH CSV HEADER"
count=$(wc -l < "$TEMP_DIR/snapshots_recargos_planillas.csv")
count=$((count - 1))
echo -e "${GREEN}  ✅ $count registros exportados${NC}"

echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}PASO 2: IMPORTAR DATOS A AZURE POSTGRESQL${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"

# Importar tablas en orden (respetando foreign keys)
import_table "tipos_recargos"
import_table "configuraciones_salarios"
import_table "recargos_planillas"
import_table "dias_laborales_planillas"
import_table "detalles_recargos_dias"
import_table "historial_recargos_planillas"
import_table "snapshots_recargos_planillas"

echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}VERIFICACIÓN POST-MIGRACIÓN${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"

# Verificar conteos
echo -e "${YELLOW}Tabla                              | Registros${NC}"
echo -e "${YELLOW}-----------------------------------|----------${NC}"

count=$(count_table "tipos_recargos" "deleted_at IS NULL")
printf "%-35s| %s\n" "tipos_recargos" "$count"

count=$(count_table "configuraciones_salarios" "deleted_at IS NULL")
printf "%-35s| %s\n" "configuraciones_salarios" "$count"

count=$(count_table "recargos_planillas" "deleted_at IS NULL")
printf "%-35s| %s\n" "recargos_planillas" "$count"

count=$(count_table "dias_laborales_planillas" "deleted_at IS NULL")
printf "%-35s| %s\n" "dias_laborales_planillas" "$count"

count=$(count_table "detalles_recargos_dias" "deleted_at IS NULL")
printf "%-35s| %s\n" "detalles_recargos_dias" "$count"

count=$(count_table "historial_recargos_planillas" "")
printf "%-35s| %s\n" "historial_recargos_planillas" "$count"

count=$(count_table "snapshots_recargos_planillas" "")
printf "%-35s| %s\n" "snapshots_recargos_planillas" "$count"

echo -e "\n${GREEN}✅ Migración completada!${NC}"
echo -e "${YELLOW}📁 Archivos CSV guardados en: $TEMP_DIR${NC}"
echo -e "${YELLOW}💡 Puedes eliminar los archivos con: rm -rf $TEMP_DIR${NC}\n"
