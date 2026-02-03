#!/bin/bash

# Script para probar todos los filtros del endpoint GET /api/servicios
# Asegúrate de que el servidor esté corriendo en http://localhost:4000

BASE_URL="http://localhost:4000/api/servicios"

echo "════════════════════════════════════════════════════════════════"
echo "🧪 TEST DE FILTROS - ENDPOINT GET /api/servicios"
echo "════════════════════════════════════════════════════════════════"
echo ""

# Colores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Función para hacer requests y mostrar resultados
test_endpoint() {
    local description=$1
    local url=$2
    local show_full=${3:-false}
    
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}TEST:${NC} $description"
    echo -e "${BLUE}URL:${NC} $url"
    echo ""
    
    response=$(curl -s "$url")
    
    # Verificar si hay error
    if echo "$response" | jq -e '.success == false' > /dev/null 2>&1; then
        echo -e "${RED}❌ ERROR:${NC}"
        echo "$response" | jq '.'
        return
    fi
    
    # Extraer datos
    total=$(echo "$response" | jq -r '.pagination.total // 0')
    page=$(echo "$response" | jq -r '.pagination.page // 1')
    limit=$(echo "$response" | jq -r '.pagination.limit // 20')
    totalPages=$(echo "$response" | jq -r '.pagination.totalPages // 0')
    count=$(echo "$response" | jq '.data | length')
    
    echo -e "${GREEN}✅ RESULTADOS:${NC}"
    echo "   Total de servicios: $total"
    echo "   Página: $page de $totalPages"
    echo "   Servicios en esta página: $count"
    echo ""
    
    if [ "$show_full" = "true" ] || [ "$count" -le 3 ]; then
        echo -e "${PURPLE}📋 SERVICIOS:${NC}"
        echo "$response" | jq -r '.data[] | "   • ID: \(.id[0:8])... | Estado: \(.estado) | Cliente: \(.cliente.nombre // "N/A") | Conductor: \((.conductor.nombre // "N/A") + " " + (.conductor.apellido // "")) | Vehículo: \(.vehiculo.placa // "N/A") | Origen: \(.origen_especifico // .origen.nombre_municipio // "N/A") | Destino: \(.destino_especifico // .destino.nombre_municipio // "N/A")"'
    else
        echo -e "${PURPLE}📋 PRIMEROS 3 SERVICIOS:${NC}"
        echo "$response" | jq -r '.data[0:3][] | "   • ID: \(.id[0:8])... | Estado: \(.estado) | Cliente: \(.cliente.nombre // "N/A") | Conductor: \((.conductor.nombre // "N/A") + " " + (.conductor.apellido // "")) | Vehículo: \(.vehiculo.placa // "N/A") | Origen: \(.origen_especifico // .origen.nombre_municipio // "N/A") | Destino: \(.destino_especifico // .destino.nombre_municipio // "N/A")"'
    fi
    
    echo ""
}

echo "════════════════════════════════════════════════════════════════"
echo "1️⃣  TEST BÁSICO - Sin filtros"
echo "════════════════════════════════════════════════════════════════"
test_endpoint "Obtener primeros 5 servicios sin filtros" \
    "${BASE_URL}?page=1&limit=5"

echo "════════════════════════════════════════════════════════════════"
echo "2️⃣  FILTRO POR ESTADO"
echo "════════════════════════════════════════════════════════════════"

test_endpoint "Servicios con estado: solicitado" \
    "${BASE_URL}?estado=solicitado&limit=5"

test_endpoint "Servicios con estado: en_curso" \
    "${BASE_URL}?estado=en_curso&limit=5"

test_endpoint "Servicios con estado: realizado" \
    "${BASE_URL}?estado=realizado&limit=5"

test_endpoint "Servicios con estado: cancelado" \
    "${BASE_URL}?estado=cancelado&limit=5"

echo "════════════════════════════════════════════════════════════════"
echo "3️⃣  BÚSQUEDA GENERAL (search)"
echo "════════════════════════════════════════════════════════════════"

echo -e "${CYAN}ℹ️  El parámetro 'search' busca en:${NC}"
echo "   • origen_especifico"
echo "   • destino_especifico"
echo "   • cliente.nombre"
echo "   • conductor.nombre"
echo "   • conductor.apellido"
echo "   • vehiculo.placa"
echo ""

# Obtener algunos valores reales para buscar
echo -e "${YELLOW}Obteniendo datos reales para buscar...${NC}"
sample=$(curl -s "${BASE_URL}?limit=1")
cliente_nombre=$(echo "$sample" | jq -r '.data[0].cliente.nombre // empty' | head -c 5)
conductor_nombre=$(echo "$sample" | jq -r '.data[0].conductor.nombre // empty' | head -c 4)
vehiculo_placa=$(echo "$sample" | jq -r '.data[0].vehiculo.placa // empty' | head -c 3)
origen=$(echo "$sample" | jq -r '.data[0].origen_especifico // .data[0].origen.nombre_municipio // empty' | head -c 5)

echo ""

if [ ! -z "$cliente_nombre" ]; then
    test_endpoint "Buscar por cliente (parcial: '$cliente_nombre')" \
        "${BASE_URL}?search=${cliente_nombre}&limit=5"
fi

if [ ! -z "$conductor_nombre" ]; then
    test_endpoint "Buscar por conductor (parcial: '$conductor_nombre')" \
        "${BASE_URL}?search=${conductor_nombre}&limit=5"
fi

if [ ! -z "$vehiculo_placa" ]; then
    test_endpoint "Buscar por placa (parcial: '$vehiculo_placa')" \
        "${BASE_URL}?search=${vehiculo_placa}&limit=5"
fi

if [ ! -z "$origen" ]; then
    test_endpoint "Buscar por origen (parcial: '$origen')" \
        "${BASE_URL}?search=${origen}&limit=5"
fi

echo "════════════════════════════════════════════════════════════════"
echo "4️⃣  FILTROS POR ID (conductor, vehículo, cliente)"
echo "════════════════════════════════════════════════════════════════"

# Obtener IDs reales
echo -e "${YELLOW}Obteniendo IDs reales...${NC}"
sample=$(curl -s "${BASE_URL}?limit=1")
conductor_id=$(echo "$sample" | jq -r '.data[0].conductor.id // empty')
vehiculo_id=$(echo "$sample" | jq -r '.data[0].vehiculo.id // empty')
cliente_id=$(echo "$sample" | jq -r '.data[0].cliente.id // empty')

echo ""

if [ ! -z "$conductor_id" ]; then
    test_endpoint "Filtrar por conductor_id: ${conductor_id:0:8}..." \
        "${BASE_URL}?conductor_id=${conductor_id}&limit=5"
fi

if [ ! -z "$vehiculo_id" ]; then
    test_endpoint "Filtrar por vehiculo_id: ${vehiculo_id:0:8}..." \
        "${BASE_URL}?vehiculo_id=${vehiculo_id}&limit=5"
fi

if [ ! -z "$cliente_id" ]; then
    test_endpoint "Filtrar por cliente_id: ${cliente_id:0:8}..." \
        "${BASE_URL}?cliente_id=${cliente_id}&limit=5"
fi

echo "════════════════════════════════════════════════════════════════"
echo "5️⃣  FILTROS POR FECHA"
echo "════════════════════════════════════════════════════════════════"

echo -e "${CYAN}ℹ️  Campos de fecha disponibles:${NC}"
echo "   • fecha_solicitud (default)"
echo "   • fecha_realizacion"
echo "   • created_at"
echo "   • fecha_finalizacion"
echo ""

# Fechas de prueba
fecha_hoy=$(date +%Y-%m-%d)
fecha_hace_7_dias=$(date -v-7d +%Y-%m-%d 2>/dev/null || date -d '7 days ago' +%Y-%m-%d 2>/dev/null)
fecha_hace_30_dias=$(date -v-30d +%Y-%m-%d 2>/dev/null || date -d '30 days ago' +%Y-%m-%d 2>/dev/null)

test_endpoint "Servicios de los últimos 7 días (fecha_solicitud)" \
    "${BASE_URL}?fecha_desde=${fecha_hace_7_dias}&fecha_hasta=${fecha_hoy}&campo_fecha=fecha_solicitud&limit=5"

test_endpoint "Servicios de los últimos 30 días (created_at)" \
    "${BASE_URL}?fecha_desde=${fecha_hace_30_dias}&fecha_hasta=${fecha_hoy}&campo_fecha=created_at&limit=5"

test_endpoint "Servicios desde hace 7 días (sin fecha_hasta)" \
    "${BASE_URL}?fecha_desde=${fecha_hace_7_dias}&campo_fecha=fecha_solicitud&limit=5"

test_endpoint "Servicios hasta hoy (sin fecha_desde)" \
    "${BASE_URL}?fecha_hasta=${fecha_hoy}&campo_fecha=created_at&limit=5"

echo "════════════════════════════════════════════════════════════════"
echo "6️⃣  ORDENAMIENTO"
echo "════════════════════════════════════════════════════════════════"

echo -e "${CYAN}ℹ️  Campos de ordenamiento disponibles:${NC}"
echo "   • fecha_solicitud"
echo "   • fecha_realizacion"
echo "   • estado"
echo "   • cliente"
echo "   • conductor"
echo "   • created_at (default)"
echo ""

test_endpoint "Ordenar por fecha_solicitud ASC" \
    "${BASE_URL}?orderBy=fecha_solicitud&orderDirection=asc&limit=3" \
    "true"

test_endpoint "Ordenar por fecha_solicitud DESC" \
    "${BASE_URL}?orderBy=fecha_solicitud&orderDirection=desc&limit=3" \
    "true"

test_endpoint "Ordenar por estado ASC" \
    "${BASE_URL}?orderBy=estado&orderDirection=asc&limit=3" \
    "true"

test_endpoint "Ordenar por cliente ASC" \
    "${BASE_URL}?orderBy=cliente&orderDirection=asc&limit=3" \
    "true"

test_endpoint "Ordenar por conductor DESC" \
    "${BASE_URL}?orderBy=conductor&orderDirection=desc&limit=3" \
    "true"

echo "════════════════════════════════════════════════════════════════"
echo "7️⃣  FILTROS COMBINADOS"
echo "════════════════════════════════════════════════════════════════"

test_endpoint "Estado + Búsqueda" \
    "${BASE_URL}?estado=realizado&search=${origen}&limit=5"

if [ ! -z "$conductor_id" ]; then
    test_endpoint "Conductor + Rango de fechas" \
        "${BASE_URL}?conductor_id=${conductor_id}&fecha_desde=${fecha_hace_30_dias}&fecha_hasta=${fecha_hoy}&limit=5"
fi

if [ ! -z "$cliente_id" ]; then
    test_endpoint "Cliente + Estado + Ordenamiento" \
        "${BASE_URL}?cliente_id=${cliente_id}&estado=realizado&orderBy=fecha_solicitud&orderDirection=desc&limit=5"
fi

echo "════════════════════════════════════════════════════════════════"
echo "8️⃣  PAGINACIÓN"
echo "════════════════════════════════════════════════════════════════"

test_endpoint "Página 1 (3 items por página)" \
    "${BASE_URL}?page=1&limit=3" \
    "true"

test_endpoint "Página 2 (3 items por página)" \
    "${BASE_URL}?page=2&limit=3" \
    "true"

echo "════════════════════════════════════════════════════════════════"
echo "9️⃣  CASOS ESPECIALES Y EDGE CASES"
echo "════════════════════════════════════════════════════════════════"

test_endpoint "Búsqueda sin resultados" \
    "${BASE_URL}?search=ZZZZZZ_NO_EXISTE_123&limit=5"

test_endpoint "Estado inválido (debería devolver vacío)" \
    "${BASE_URL}?estado=estado_inexistente&limit=5"

test_endpoint "Página muy alta (debería devolver vacío)" \
    "${BASE_URL}?page=9999&limit=5"

test_endpoint "Múltiples filtros restrictivos" \
    "${BASE_URL}?estado=cancelado&fecha_desde=${fecha_hace_7_dias}&fecha_hasta=${fecha_hoy}&limit=5"

echo "════════════════════════════════════════════════════════════════"
echo "🏁 TESTS COMPLETADOS"
echo "════════════════════════════════════════════════════════════════"
echo ""
echo -e "${GREEN}✅ Todos los tests han sido ejecutados${NC}"
echo ""
echo -e "${CYAN}📊 RESUMEN DE PARÁMETROS SOPORTADOS:${NC}"
echo ""
echo "  Query Params:"
echo "    • page          - Número de página (default: 1)"
echo "    • limit         - Items por página (default: 20)"
echo "    • estado        - Filtro por estado del servicio"
echo "    • search        - Búsqueda en múltiples campos"
echo "    • conductor_id  - Filtro por ID de conductor"
echo "    • vehiculo_id   - Filtro por ID de vehículo"
echo "    • cliente_id    - Filtro por ID de cliente"
echo "    • fecha_desde   - Fecha inicio (YYYY-MM-DD)"
echo "    • fecha_hasta   - Fecha fin (YYYY-MM-DD)"
echo "    • campo_fecha   - Campo de fecha a filtrar (default: fecha_solicitud)"
echo "    • orderBy       - Campo para ordenar"
echo "    • orderDirection - Dirección del orden (asc/desc, default: desc)"
echo ""
echo -e "${CYAN}🔍 CAMPOS DONDE BUSCA 'search':${NC}"
echo "    • origen_especifico"
echo "    • destino_especifico"
echo "    • cliente.nombre"
echo "    • conductor.nombre"
echo "    • conductor.apellido"
echo "    • vehiculo.placa"
echo ""
echo "════════════════════════════════════════════════════════════════"
