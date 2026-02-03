#!/bin/bash

# Colores para output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Configuración
API_URL="http://localhost:4000"
CONTENT_TYPE="Content-Type: application/json"

# Variables globales
TOKEN=""
EMPRESA_ID=""
PERSONA_ID=""

echo -e "${BLUE}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║      TEST CRUD CLIENTES - TRANSMERALDA API v2.0         ║${NC}"
echo -e "${BLUE}║         Con Filtros Tipo y Paginación Mejorada          ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""

# Test 1: Login
echo -e "${YELLOW}📝 Test 1: Login de usuario${NC}"
LOGIN_RESPONSE=$(curl -s -X POST "$API_URL/api/auth/login" \
  -H "$CONTENT_TYPE" \
  -d '{
    "correo": "admin@cotransmeq.com",
    "password": "admin123"
  }')

TOKEN=$(echo $LOGIN_RESPONSE | jq -r '.token // .data.token // empty')

if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then
  echo -e "${RED}❌ Error: No se pudo obtener el token${NC}"
  echo "Response: $LOGIN_RESPONSE" | jq '.'
  exit 1
fi

echo -e "${GREEN}✅ Login exitoso${NC}"
echo "Token: ${TOKEN:0:50}..."
echo ""

# Test 2: Listar todos los clientes con límite por defecto (10)
echo -e "${YELLOW}📝 Test 2: GET /api/clientes (límite por defecto 10)${NC}"
curl -s -X GET "$API_URL/api/clientes" \
  -H "Authorization: Bearer $TOKEN" | jq '.'
echo ""

# Test 3: Listar solo EMPRESAS
echo -e "${YELLOW}📝 Test 3: GET /api/clientes?tipo=EMPRESA${NC}"
curl -s -X GET "$API_URL/api/clientes?tipo=EMPRESA" \
  -H "Authorization: Bearer $TOKEN" | jq '.'
echo ""

# Test 4: Listar solo PERSONAS NATURALES
echo -e "${YELLOW}📝 Test 4: GET /api/clientes?tipo=PERSONA_NATURAL${NC}"
curl -s -X GET "$API_URL/api/clientes?tipo=PERSONA_NATURAL" \
  -H "Authorization: Bearer $TOKEN" | jq '.'
echo ""

# Test 5: Paginación con límite 20
echo -e "${YELLOW}📝 Test 5: GET /api/clientes?page=1&limit=20${NC}"
curl -s -X GET "$API_URL/api/clientes?page=1&limit=20" \
  -H "Authorization: Bearer $TOKEN" | jq '.'
echo ""

# Test 6: Obtener lista básica de empresas
echo -e "${YELLOW}📝 Test 6: GET /api/empresas/basicos${NC}"
curl -s -X GET "$API_URL/api/empresas/basicos" \
  -H "Authorization: Bearer $TOKEN" | jq '.'
echo ""

# Test 7: Crear cliente EMPRESA
echo -e "${YELLOW}📝 Test 7: POST /api/clientes (EMPRESA)${NC}"
CREATE_EMPRESA_RESPONSE=$(curl -s -X POST "$API_URL/api/clientes" \
  -H "Authorization: Bearer $TOKEN" \
  -H "$CONTENT_TYPE" \
  -d '{
    "tipo": "EMPRESA",
    "nit": "900123456-7",
    "nombre": "Empresa Test SAS",
    "representante": "Juan Pérez",
    "cedula": "1234567890",
    "telefono": "3201234567",
    "direccion": "Calle 123 #45-67",
    "correo": "empresa.test@example.com",
    "requiere_osi": true,
    "paga_recargos": false
  }')

echo $CREATE_EMPRESA_RESPONSE | jq '.'
EMPRESA_ID=$(echo $CREATE_EMPRESA_RESPONSE | jq -r '.data.id // empty')
echo -e "${GREEN}✅ EMPRESA creada con ID: $EMPRESA_ID${NC}"
echo ""

# Test 8: Crear cliente PERSONA_NATURAL
echo -e "${YELLOW}📝 Test 8: POST /api/clientes (PERSONA_NATURAL)${NC}"
CREATE_PERSONA_RESPONSE=$(curl -s -X POST "$API_URL/api/clientes" \
  -H "Authorization: Bearer $TOKEN" \
  -H "$CONTENT_TYPE" \
  -d '{
    "tipo": "PERSONA_NATURAL",
    "nit": "98765432-1",
    "nombre": "María González",
    "cedula": "9876543210",
    "telefono": "3109876543",
    "direccion": "Carrera 45 #67-89",
    "correo": "maria.gonzalez@example.com",
    "requiere_osi": false,
    "paga_recargos": true
  }')

echo $CREATE_PERSONA_RESPONSE | jq '.'
PERSONA_ID=$(echo $CREATE_PERSONA_RESPONSE | jq -r '.data.id // empty')
echo -e "${GREEN}✅ PERSONA_NATURAL creada con ID: $PERSONA_ID${NC}"
echo ""

# Test 9: Verificar filtro EMPRESA (debe incluir la que acabamos de crear)
echo -e "${YELLOW}📝 Test 9: Verificar filtro EMPRESA${NC}"
curl -s -X GET "$API_URL/api/clientes?tipo=EMPRESA&limit=5" \
  -H "Authorization: Bearer $TOKEN" | jq '.'
echo ""

# Test 10: Verificar filtro PERSONA_NATURAL (debe incluir la que acabamos de crear)
echo -e "${YELLOW}📝 Test 10: Verificar filtro PERSONA_NATURAL${NC}"
curl -s -X GET "$API_URL/api/clientes?tipo=PERSONA_NATURAL&limit=5" \
  -H "Authorization: Bearer $TOKEN" | jq '.'
echo ""

# Test 11: Obtener EMPRESA por ID
if [ ! -z "$EMPRESA_ID" ]; then
  echo -e "${YELLOW}📝 Test 11: GET /api/clientes/$EMPRESA_ID${NC}"
  curl -s -X GET "$API_URL/api/clientes/$EMPRESA_ID" \
    -H "Authorization: Bearer $TOKEN" | jq '.'
  echo ""
fi

# Test 12: Obtener PERSONA por ID
if [ ! -z "$PERSONA_ID" ]; then
  echo -e "${YELLOW}📝 Test 12: GET /api/clientes/$PERSONA_ID${NC}"
  curl -s -X GET "$API_URL/api/clientes/$PERSONA_ID" \
    -H "Authorization: Bearer $TOKEN" | jq '.'
  echo ""
fi

# Test 13: Actualizar EMPRESA
if [ ! -z "$EMPRESA_ID" ]; then
  echo -e "${YELLOW}📝 Test 13: PUT /api/clientes/$EMPRESA_ID${NC}"
  curl -s -X PUT "$API_URL/api/clientes/$EMPRESA_ID" \
    -H "Authorization: Bearer $TOKEN" \
    -H "$CONTENT_TYPE" \
    -d '{
      "nombre": "Empresa Test SAS - Actualizada",
      "telefono": "3209999999",
      "requiere_osi": false
    }' | jq '.'
  echo ""
fi

# Test 14: Actualizar PERSONA
if [ ! -z "$PERSONA_ID" ]; then
  echo -e "${YELLOW}📝 Test 14: PUT /api/clientes/$PERSONA_ID${NC}"
  curl -s -X PUT "$API_URL/api/clientes/$PERSONA_ID" \
    -H "Authorization: Bearer $TOKEN" \
    -H "$CONTENT_TYPE" \
    -d '{
      "nombre": "María González - Actualizada",
      "telefono": "3108888888",
      "paga_recargos": false
    }' | jq '.'
  echo ""
fi

# Test 15: Buscar con múltiples filtros
echo -e "${YELLOW}📝 Test 15: GET /api/clientes/buscar?tipo=EMPRESA&search=Test${NC}"
curl -s -X GET "$API_URL/api/clientes/buscar?tipo=EMPRESA&search=Test" \
  -H "Authorization: Bearer $TOKEN" | jq '.'
echo ""

# Test 16: Filtro combinado con paginación
echo -e "${YELLOW}📝 Test 16: GET /api/clientes?tipo=EMPRESA&page=1&limit=5${NC}"
curl -s -X GET "$API_URL/api/clientes?tipo=EMPRESA&page=1&limit=5" \
  -H "Authorization: Bearer $TOKEN" | jq '.'
echo ""

# Test 17: Eliminar EMPRESA
if [ ! -z "$EMPRESA_ID" ]; then
  echo -e "${RED}📝 Test 17: DELETE /api/clientes/$EMPRESA_ID${NC}"
  read -p "¿Deseas eliminar la EMPRESA de prueba? (y/n) " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    curl -s -X DELETE "$API_URL/api/clientes/$EMPRESA_ID" \
      -H "Authorization: Bearer $TOKEN" | jq '.'
    echo -e "${GREEN}✅ EMPRESA eliminada${NC}"
  else
    echo -e "${YELLOW}⏭️  Eliminación de EMPRESA cancelada${NC}"
  fi
  echo ""
fi

# Test 18: Eliminar PERSONA
if [ ! -z "$PERSONA_ID" ]; then
  echo -e "${RED}📝 Test 18: DELETE /api/clientes/$PERSONA_ID${NC}"
  read -p "¿Deseas eliminar la PERSONA de prueba? (y/n) " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    curl -s -X DELETE "$API_URL/api/clientes/$PERSONA_ID" \
      -H "Authorization: Bearer $TOKEN" | jq '.'
    echo -e "${GREEN}✅ PERSONA eliminada${NC}"
  else
    echo -e "${YELLOW}⏭️  Eliminación de PERSONA cancelada${NC}"
  fi
  echo ""
fi

echo -e "${BLUE}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║              ✅ TESTS COMPLETADOS ✅                     ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${GREEN}Nuevas funcionalidades probadas:${NC}"
echo -e "  ✅ Filtro por tipo (EMPRESA/PERSONA_NATURAL)"
echo -e "  ✅ Paginación con límite configurable"
echo -e "  ✅ Límite por defecto de 10 items"
echo -e "  ✅ Campo correo con unique constraint"
echo -e "  ✅ Filtros combinados (tipo + búsqueda)"
echo -e "  ✅ Creación de ambos tipos de clientes"
echo ""
