#!/bin/bash

# Tests simples de búsqueda
BASE_URL="http://localhost:4000/api/servicios"

echo "════════════════════════════════════════════════════════════════"
echo "🔍 TESTS DE BÚSQUEDA EXHAUSTIVA"
echo "════════════════════════════════════════════════════════════════"
echo ""

# Colores
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

test_search() {
    local description=$1
    local term=$2
    
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}TEST:${NC} $description"
    echo -e "Término de búsqueda: '$term'"
    echo ""
    
    response=$(curl -s "${BASE_URL}?search=${term}&limit=3")
    total=$(echo "$response" | jq -r '.pagination.total // 0')
    
    echo -e "${GREEN}Resultados encontrados: $total${NC}"
    
    if [ "$total" -gt 0 ]; then
        echo ""
        echo "Primeros resultados:"
        echo "$response" | jq -r '.data[] | "  • Cliente: \(.cliente.nombre // "N/A") | Conductor: \((.conductor.nombre // "N/A") + " " + (.conductor.apellido // "")) | Vehículo: \(.vehiculo.placa // "N/A") | Estado: \(.estado) | Origen: \(.origen_especifico // .origen.nombre_municipio // "N/A")"' | head -3
    fi
    echo ""
}

echo "1️⃣  BÚSQUEDA POR CLIENTE"
test_search "Cliente: CATERING" "CATERING"
test_search "Cliente: ATINA" "ATINA"
test_search "Cliente: FEPCO" "FEPCO"

echo "2️⃣  BÚSQUEDA POR CONDUCTOR"
test_search "Conductor: ALVARO" "ALVARO"
test_search "Conductor: PEREZ" "PEREZ"
test_search "Conductor: ELKIN" "ELKIN"

echo "3️⃣  BÚSQUEDA POR VEHÍCULO"
test_search "Placa: QLR" "QLR"
test_search "Placa: GZZ" "GZZ"
test_search "Marca: CHEVROLET" "CHEVROLET"

echo "4️⃣  BÚSQUEDA POR UBICACIÓN"
test_search "Origen: Yopal" "Yopal"
test_search "Origen: Villanueva" "Villanueva"
test_search "Destino: Tauramena" "Tauramena"
test_search "Departamento: Casanare" "Casanare"

echo "5️⃣  BÚSQUEDA POR ESTADO"
test_search "Estado: realizado" "realizado"
test_search "Estado: en_curso" "en_curso"
test_search "Estado: solicitado" "solicitado"

echo "6️⃣  BÚSQUEDA POR OTROS CAMPOS"
test_search "Observaciones: Cambio" "Cambio"
test_search "Propósito: personal" "personal"

echo "════════════════════════════════════════════════════════════════"
echo "✅ Tests completados"
echo "════════════════════════════════════════════════════════════════"
