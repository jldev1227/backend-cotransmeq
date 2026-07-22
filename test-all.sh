#!/bin/bash

# =============================================================================
# Test Suite Completo - Todos los CRUDs
# =============================================================================

# Colores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Banner
echo -e "${CYAN}"
echo "╔════════════════════════════════════════════════════════════════════════════╗"
echo "║                                                                            ║"
echo "║              🚀 COTRANSMEQ - Test Suite Completo 🚀                     ║"
echo "║                                                                            ║"
echo "║                    Tests de CRUDs - API Backend                            ║"
echo "║                                                                            ║"
echo "╚════════════════════════════════════════════════════════════════════════════╝"
echo -e "${NC}\n"

# Verificar que jq esté instalado
if ! command -v jq &> /dev/null; then
    echo -e "${RED}❌ Error: jq no está instalado${NC}"
    echo "Instala jq para ejecutar estos tests:"
    echo "  macOS: brew install jq"
    echo "  Linux: sudo apt-get install jq"
    exit 1
fi

# Verificar que el backend esté corriendo
echo -e "${YELLOW}Verificando backend...${NC}"
if ! curl -s http://localhost:4000/api/auth/login > /dev/null 2>&1; then
    echo -e "${RED}❌ Error: El backend no está corriendo en puerto 4000${NC}"
    echo "Inicia el backend con:"
    echo "  cd backend-nest"
    echo "  npm run dev"
    exit 1
fi
echo -e "${GREEN}✓ Backend respondiendo en puerto 4000${NC}\n"

# Contador de resultados
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

# Función para ejecutar test
run_test() {
    local test_name=$1
    local test_script=$2
    
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    
    echo -e "${MAGENTA}═══════════════════════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}📋 Ejecutando: ${test_name}${NC}"
    echo -e "${MAGENTA}═══════════════════════════════════════════════════════════════════${NC}\n"
    
    if bash "$test_script"; then
        PASSED_TESTS=$((PASSED_TESTS + 1))
        echo -e "\n${GREEN}✅ ${test_name} completado exitosamente${NC}\n"
    else
        FAILED_TESTS=$((FAILED_TESTS + 1))
        echo -e "\n${RED}❌ ${test_name} falló${NC}\n"
    fi
    
    echo ""
    read -p "Presiona Enter para continuar con el siguiente test..." -r
    echo ""
}

# Ejecutar todos los tests
echo -e "${YELLOW}Iniciando suite de tests...${NC}\n"
sleep 1

# Test 1: Conductores
run_test "Test de Conductores" "./test-crud-conductores.sh"

# Test 2: Clientes
run_test "Test de Clientes/Empresas" "./test-crud-clientes.sh"

# Test 3: Vehículos
run_test "Test de Vehículos" "./test-crud-vehiculos.sh"

# Resumen Final
echo -e "${CYAN}"
echo "╔════════════════════════════════════════════════════════════════════════════╗"
echo "║                                                                            ║"
echo "║                        📊 RESUMEN DE TESTS 📊                              ║"
echo "║                                                                            ║"
echo "╚════════════════════════════════════════════════════════════════════════════╝"
echo -e "${NC}\n"

echo -e "${BLUE}Total de suites ejecutadas:${NC} $TOTAL_TESTS"
echo -e "${GREEN}Suites exitosas:${NC} $PASSED_TESTS"
echo -e "${RED}Suites fallidas:${NC} $FAILED_TESTS"
echo ""

if [ $FAILED_TESTS -eq 0 ]; then
    echo -e "${GREEN}╔════════════════════════════════════════════════════════════════════════════╗"
    echo -e "║                                                                            ║"
    echo -e "║               ✅ ¡TODOS LOS TESTS PASARON EXITOSAMENTE! ✅                 ║"
    echo -e "║                                                                            ║"
    echo -e "╚════════════════════════════════════════════════════════════════════════════╝${NC}"
else
    echo -e "${YELLOW}╔════════════════════════════════════════════════════════════════════════════╗"
    echo -e "║                                                                            ║"
    echo -e "║                  ⚠️  ALGUNOS TESTS FALLARON ⚠️                            ║"
    echo -e "║                                                                            ║"
    echo -e "║            Revisa los logs anteriores para más detalles                   ║"
    echo -e "║                                                                            ║"
    echo -e "╚════════════════════════════════════════════════════════════════════════════╝${NC}"
fi

echo ""
echo -e "${CYAN}═══════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}Endpoints testeados:${NC}"
echo ""
echo -e "  🚗 ${GREEN}Conductores:${NC}"
echo "     • GET    /api/conductores"
echo "     • GET    /api/conductores/:id"
echo "     • POST   /api/conductores"
echo "     • PUT    /api/conductores/:id"
echo "     • PATCH  /api/conductores/:id/estado"
echo "     • DELETE /api/conductores/:id"
echo ""
echo -e "  🏢 ${GREEN}Clientes/Empresas:${NC}"
echo "     • GET    /api/clientes"
echo "     • GET    /api/empresas/basicos"
echo "     • GET    /api/clientes/buscar"
echo "     • GET    /api/clientes/:id"
echo "     • POST   /api/clientes"
echo "     • PUT    /api/clientes/:id"
echo "     • DELETE /api/clientes/:id"
echo ""
echo -e "  🚙 ${GREEN}Vehículos:${NC}"
echo "     • GET    /api/vehiculos"
echo "     • GET    /api/flota/basicos"
echo "     • GET    /api/vehiculos/:id"
echo "     • POST   /api/vehiculos"
echo "     • PUT    /api/vehiculos/:id"
echo "     • PATCH  /api/vehiculos/:id/estado"
echo "     • PATCH  /api/vehiculos/:id/kilometraje"
echo "     • DELETE /api/vehiculos/:id"
echo ""
echo -e "${CYAN}═══════════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${YELLOW}📖 Para más información, revisa:${NC}"
echo "   • API_DOCUMENTATION.md - Documentación completa de la API"
echo "   • CRUD_IMPLEMENTATION_SUMMARY.md - Resumen de implementación"
echo ""
echo -e "${GREEN}Gracias por usar el test suite de Cotransmeq! 🚀${NC}"
echo ""
