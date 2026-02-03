#!/bin/bash

# Script de pruebas de filtros para el endpoint de servicios
# Usa curl para hacer requests HTTP

BASE_URL="http://localhost:4000/api"

# Colores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Contador de tests
TESTS_PASSED=0
TESTS_FAILED=0

# Función para imprimir encabezados de test
print_test() {
    echo ""
    echo "================================================================================"
    echo -e "${CYAN}TEST: $1${NC}"
    echo "================================================================================"
}

# Función para imprimir éxito
print_success() {
    echo -e "${GREEN}✅ $1${NC}"
    ((TESTS_PASSED++))
}

# Función para imprimir error
print_error() {
    echo -e "${RED}❌ $1${NC}"
    ((TESTS_FAILED++))
}

# Función para imprimir info
print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

# Función para imprimir warning
print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

# Función para hacer request y extraer datos
make_request() {
    local endpoint="$1"
    local params="$2"
    local url="${BASE_URL}${endpoint}?${params}"
    
    # Imprimir a stderr para no contaminar la salida JSON
    echo -e "${BLUE}ℹ️  Request: $url${NC}" >&2
    
    response=$(curl -s "$url")
    echo "$response"
}

# Función para contar resultados
count_results() {
    local response="$1"
    echo "$response" | jq -r '.data | length' 2>/dev/null || echo "0"
}

# Función para validar campo en resultados
validate_field() {
    local response="$1"
    local field="$2"
    local expected="$3"
    
    # Contar cuántos tienen el valor esperado
    local matches=$(echo "$response" | jq -r ".data[] | select(.$field == \"$expected\") | .$field" 2>/dev/null | wc -l)
    local total=$(count_results "$response")
    
    if [ "$total" -eq 0 ]; then
        print_warning "Sin resultados para validar"
        return 0
    fi
    
    if [ "$matches" -eq "$total" ]; then
        print_success "Todos los $total resultados tienen $field = $expected"
        return 0
    else
        print_error "Solo $matches de $total resultados tienen $field = $expected"
        return 1
    fi
}

echo -e "${CYAN}"
echo "🧪 INICIANDO PRUEBAS DE FILTROS DE SERVICIOS"
echo "==============================================="
echo -e "${NC}"

# TEST 0: Obtener datos de prueba
print_test "OBTENIENDO DATOS DE PRUEBA"
sample_data=$(make_request "/servicios" "limit=1")

if [ "$(count_results "$sample_data")" -eq 0 ]; then
    print_error "No hay servicios en la base de datos para hacer pruebas"
    exit 1
fi

# Extraer IDs de prueba
CONDUCTOR_ID=$(echo "$sample_data" | jq -r '.data[0].conductor_id // empty')
VEHICULO_ID=$(echo "$sample_data" | jq -r '.data[0].vehiculo_id // empty')
CLIENTE_ID=$(echo "$sample_data" | jq -r '.data[0].cliente_id // empty')
ESTADO=$(echo "$sample_data" | jq -r '.data[0].estado // empty')

print_success "Datos de prueba obtenidos:"
echo "  - conductor_id: $CONDUCTOR_ID"
echo "  - vehiculo_id: $VEHICULO_ID"
echo "  - cliente_id: $CLIENTE_ID"
echo "  - estado: $ESTADO"

# TEST 1: Filtrar por conductor
if [ -n "$CONDUCTOR_ID" ]; then
    print_test "1. Filtrar por conductor_id"
    result=$(make_request "/servicios" "conductor_id=$CONDUCTOR_ID&limit=50")
    count=$(count_results "$result")
    
    if [ "$count" -gt 0 ]; then
        validate_field "$result" "conductor_id" "$CONDUCTOR_ID"
    else
        print_warning "No se encontraron resultados"
    fi
else
    print_warning "TEST 1: No hay conductor_id disponible"
fi

# TEST 2: Filtrar por cliente
if [ -n "$CLIENTE_ID" ]; then
    print_test "2. Filtrar por cliente_id"
    result=$(make_request "/servicios" "cliente_id=$CLIENTE_ID&limit=50")
    count=$(count_results "$result")
    
    if [ "$count" -gt 0 ]; then
        validate_field "$result" "cliente_id" "$CLIENTE_ID"
    else
        print_warning "No se encontraron resultados"
    fi
else
    print_warning "TEST 2: No hay cliente_id disponible"
fi

# TEST 3: Filtrar por vehículo
if [ -n "$VEHICULO_ID" ]; then
    print_test "3. Filtrar por vehiculo_id"
    result=$(make_request "/servicios" "vehiculo_id=$VEHICULO_ID&limit=50")
    count=$(count_results "$result")
    
    if [ "$count" -gt 0 ]; then
        validate_field "$result" "vehiculo_id" "$VEHICULO_ID"
    else
        print_warning "No se encontraron resultados"
    fi
else
    print_warning "TEST 3: No hay vehiculo_id disponible"
fi

# TEST 4: Filtrar por conductor + cliente
if [ -n "$CONDUCTOR_ID" ] && [ -n "$CLIENTE_ID" ]; then
    print_test "4. Filtrar por conductor_id + cliente_id"
    result=$(make_request "/servicios" "conductor_id=$CONDUCTOR_ID&cliente_id=$CLIENTE_ID&limit=50")
    count=$(count_results "$result")
    
    if [ "$count" -gt 0 ]; then
        print_success "$count servicios encontrados con conductor + cliente"
        # Validar ambos campos
        validate_field "$result" "conductor_id" "$CONDUCTOR_ID"
        validate_field "$result" "cliente_id" "$CLIENTE_ID"
    else
        print_warning "No se encontraron resultados con esta combinación"
    fi
else
    print_warning "TEST 4: No hay datos suficientes para probar combinación"
fi

# TEST 5: Filtrar por vehículo + conductor + cliente
if [ -n "$VEHICULO_ID" ] && [ -n "$CONDUCTOR_ID" ] && [ -n "$CLIENTE_ID" ]; then
    print_test "5. Filtrar por vehiculo_id + conductor_id + cliente_id"
    result=$(make_request "/servicios" "vehiculo_id=$VEHICULO_ID&conductor_id=$CONDUCTOR_ID&cliente_id=$CLIENTE_ID&limit=50")
    count=$(count_results "$result")
    
    if [ "$count" -gt 0 ]; then
        print_success "$count servicios encontrados con vehículo + conductor + cliente"
        validate_field "$result" "vehiculo_id" "$VEHICULO_ID"
        validate_field "$result" "conductor_id" "$CONDUCTOR_ID"
        validate_field "$result" "cliente_id" "$CLIENTE_ID"
    else
        print_warning "No se encontraron resultados con esta combinación"
    fi
else
    print_warning "TEST 5: No hay datos suficientes para probar combinación completa"
fi

# TEST 6: Filtrar por estado
if [ -n "$ESTADO" ]; then
    print_test "6. Filtrar por estado"
    result=$(make_request "/servicios" "estado=$ESTADO&limit=50")
    count=$(count_results "$result")
    
    if [ "$count" -gt 0 ]; then
        validate_field "$result" "estado" "$ESTADO"
    else
        print_warning "No se encontraron resultados"
    fi
fi

# TEST 7: Filtrar por rango de fechas (fecha_solicitud)
print_test "7. Filtrar por fecha_desde y fecha_hasta (fecha_solicitud)"
FECHA_HOY=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
FECHA_HACE_30_DIAS=$(date -u -v-30d +"%Y-%m-%dT%H:%M:%S.000Z" 2>/dev/null || date -u -d "30 days ago" +"%Y-%m-%dT%H:%M:%S.000Z")

result=$(make_request "/servicios" "fecha_desde=$FECHA_HACE_30_DIAS&fecha_hasta=$FECHA_HOY&campo_fecha=fecha_solicitud&limit=50")
count=$(count_results "$result")

if [ "$count" -gt 0 ]; then
    print_success "Filtro de rango de fechas funcionó: $count servicios encontrados"
else
    print_warning "No se encontraron servicios en el rango de fechas"
fi

# TEST 8: Búsqueda por texto
print_test "8. Búsqueda por texto (search)"
result=$(make_request "/servicios" "search=cali&limit=50")
count=$(count_results "$result")

if [ "$count" -gt 0 ]; then
    print_success "Búsqueda por texto funcionó: $count servicios encontrados"
else
    print_warning "No se encontraron servicios con 'cali'"
fi

# TEST 9: Ordenamiento DESC
print_test "9. Ordenamiento por fecha_solicitud DESC"
result=$(make_request "/servicios" "orderBy=fecha_solicitud&orderDirection=desc&limit=5")
count=$(count_results "$result")

if [ "$count" -gt 1 ]; then
    # Extraer primera y segunda fecha
    fecha1=$(echo "$result" | jq -r '.data[0].fecha_solicitud')
    fecha2=$(echo "$result" | jq -r '.data[1].fecha_solicitud')
    
    print_info "Primera fecha: $fecha1"
    print_info "Segunda fecha: $fecha2"
    
    if [[ "$fecha1" > "$fecha2" ]] || [[ "$fecha1" == "$fecha2" ]]; then
        print_success "Ordenamiento DESC correcto"
    else
        print_error "Ordenamiento DESC incorrecto"
    fi
else
    print_warning "No hay suficientes datos para validar ordenamiento"
fi

# TEST 10: Ordenamiento por cliente (relación anidada)
print_test "10. Ordenamiento por cliente (relación anidada)"
result=$(make_request "/servicios" "orderBy=cliente&orderDirection=asc&limit=5")
count=$(count_results "$result")

if [ "$count" -gt 0 ]; then
    print_success "Ordenamiento por cliente ejecutado: $count servicios encontrados"
else
    print_warning "No se encontraron servicios"
fi

# TEST 11: Filtro por fecha_realizacion
print_test "11. Filtrar por fecha_realizacion (últimos 60 días)"
FECHA_HACE_60_DIAS=$(date -u -v-60d +"%Y-%m-%dT%H:%M:%S.000Z" 2>/dev/null || date -u -d "60 days ago" +"%Y-%m-%dT%H:%M:%S.000Z")

result=$(make_request "/servicios" "fecha_desde=$FECHA_HACE_60_DIAS&fecha_hasta=$FECHA_HOY&campo_fecha=fecha_realizacion&limit=50")
count=$(count_results "$result")

if [ "$count" -gt 0 ]; then
    print_success "Filtro por fecha_realizacion funcionó: $count servicios encontrados"
else
    print_warning "No se encontraron servicios con fecha_realizacion en el rango"
fi

# TEST 12: Todos los filtros combinados
print_test "12. Filtros combinados (estado + search + orderBy)"
result=$(make_request "/servicios" "estado=$ESTADO&search=via&orderBy=fecha_solicitud&orderDirection=desc&limit=20")
count=$(count_results "$result")

if [ "$count" -gt 0 ]; then
    print_success "Filtros combinados funcionaron: $count servicios encontrados"
else
    print_info "No se encontraron servicios con esta combinación de filtros"
fi

# RESUMEN
echo ""
echo "================================================================================"
echo -e "${CYAN}RESUMEN DE PRUEBAS${NC}"
echo "================================================================================"
print_success "Tests pasados: $TESTS_PASSED"
if [ "$TESTS_FAILED" -gt 0 ]; then
    print_error "Tests fallidos: $TESTS_FAILED"
fi
echo -e "${CYAN}Total: $((TESTS_PASSED + TESTS_FAILED))${NC}"
echo "================================================================================"
echo ""
