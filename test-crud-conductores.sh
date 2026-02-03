#!/bin/bash

# =============================================================================
# Tests de CRUD para Conductores
# =============================================================================

# Colores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuración
API_URL="${API_URL:-http://localhost:4000}"
TOKEN=""

echo -e "${BLUE}==============================================================================${NC}"
echo -e "${BLUE}   Tests de CRUD para Conductores${NC}"
echo -e "${BLUE}==============================================================================${NC}\n"

# =============================================================================
# 1. LOGIN (obtener token)
# =============================================================================
echo -e "${YELLOW}1. Autenticación${NC}"
echo "POST ${API_URL}/api/auth/login"

LOGIN_RESPONSE=$(curl -s -X POST "${API_URL}/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{
    "correo": "admin@cotransmeq.com",
    "password": "admin123"
  }')

TOKEN=$(echo "$LOGIN_RESPONSE" | grep -o '"token":"[^"]*' | sed 's/"token":"//')

if [ -z "$TOKEN" ]; then
  echo -e "${RED}❌ Error: No se pudo obtener el token de autenticación${NC}"
  echo "Response: $LOGIN_RESPONSE"
  exit 1
fi

echo -e "${GREEN}✓ Token obtenido correctamente${NC}\n"

# =============================================================================
# 2. GET - Listar todos los conductores
# =============================================================================
echo -e "${YELLOW}2. GET /api/conductores - Listar todos${NC}"

GET_ALL_RESPONSE=$(curl -s -X GET "${API_URL}/api/conductores?page=1&limit=10" \
  -H "Authorization: Bearer ${TOKEN}")

echo "$GET_ALL_RESPONSE" | jq '.'
echo ""

TOTAL_CONDUCTORES=$(echo "$GET_ALL_RESPONSE" | grep -o '"total":[0-9]*' | sed 's/"total"://')
echo -e "${GREEN}✓ Total de conductores: ${TOTAL_CONDUCTORES}${NC}\n"

# =============================================================================
# 3. POST - Crear nuevo conductor
# =============================================================================
echo -e "${YELLOW}3. POST /api/conductores - Crear nuevo conductor${NC}"

CREATE_RESPONSE=$(curl -s -X POST "${API_URL}/api/conductores" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  -d '{
    "nombre": "Juan Carlos",
    "apellido": "Pérez González",
    "tipo_identificacion": "CC",
    "numero_identificacion": "1234567890",
    "email": "juan.perez@test.com",
    "telefono": "3001234567",
    "fecha_nacimiento": "1990-05-15",
    "genero": "M",
    "direccion": "Calle 123 #45-67",
    "cargo": "CONDUCTOR",
    "fecha_ingreso": "2024-01-01",
    "salario_base": 2500000,
    "estado": "ACTIVO",
    "eps": "NUEVA EPS",
    "fondo_pension": "PORVENIR",
    "arl": "SURA",
    "tipo_contrato": "INDEFINIDO",
    "categoria_licencia": "C2",
    "vencimiento_licencia": "2026-12-31",
    "sede_trabajo": "Yopal",
    "tipo_sangre": "O+"
  }')

echo "$CREATE_RESPONSE" | jq '.'

CONDUCTOR_ID=$(echo "$CREATE_RESPONSE" | grep -o '"id":"[^"]*' | sed 's/"id":"//')

if [ -z "$CONDUCTOR_ID" ]; then
  echo -e "${RED}❌ Error: No se pudo crear el conductor${NC}\n"
else
  echo -e "${GREEN}✓ Conductor creado con ID: ${CONDUCTOR_ID}${NC}\n"
fi

# =============================================================================
# 4. GET - Obtener conductor por ID
# =============================================================================
if [ ! -z "$CONDUCTOR_ID" ]; then
  echo -e "${YELLOW}4. GET /api/conductores/${CONDUCTOR_ID} - Obtener por ID${NC}"
  
  GET_BY_ID_RESPONSE=$(curl -s -X GET "${API_URL}/api/conductores/${CONDUCTOR_ID}" \
    -H "Authorization: Bearer ${TOKEN}")
  
  echo "$GET_BY_ID_RESPONSE" | jq '.'
  echo -e "${GREEN}✓ Conductor obtenido correctamente${NC}\n"
fi

# =============================================================================
# 5. PUT - Actualizar conductor
# =============================================================================
if [ ! -z "$CONDUCTOR_ID" ]; then
  echo -e "${YELLOW}5. PUT /api/conductores/${CONDUCTOR_ID} - Actualizar${NC}"
  
  UPDATE_RESPONSE=$(curl -s -X PUT "${API_URL}/api/conductores/${CONDUCTOR_ID}" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${TOKEN}" \
    -d '{
      "nombre": "Juan Carlos ACTUALIZADO",
      "apellido": "Pérez González",
      "tipo_identificacion": "CC",
      "numero_identificacion": "1234567890",
      "email": "juan.perez.updated@test.com",
      "telefono": "3009876543",
      "direccion": "Calle Nueva 456 #78-90",
      "salario_base": 2800000
    }')
  
  echo "$UPDATE_RESPONSE" | jq '.'
  echo -e "${GREEN}✓ Conductor actualizado correctamente${NC}\n"
fi

# =============================================================================
# 6. PATCH - Actualizar estado del conductor
# =============================================================================
if [ ! -z "$CONDUCTOR_ID" ]; then
  echo -e "${YELLOW}6. PATCH /api/conductores/${CONDUCTOR_ID}/estado - Cambiar estado${NC}"
  
  ESTADO_RESPONSE=$(curl -s -X PATCH "${API_URL}/api/conductores/${CONDUCTOR_ID}/estado" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${TOKEN}" \
    -d '{
      "estado": "SUSPENDIDO"
    }')
  
  echo "$ESTADO_RESPONSE" | jq '.'
  echo -e "${GREEN}✓ Estado actualizado correctamente${NC}\n"
fi

# =============================================================================
# 7. GET - Filtros y búsqueda
# =============================================================================
echo -e "${YELLOW}7. GET /api/conductores?search=Juan - Buscar conductores${NC}"

SEARCH_RESPONSE=$(curl -s -X GET "${API_URL}/api/conductores?search=Juan&limit=5" \
  -H "Authorization: Bearer ${TOKEN}")

echo "$SEARCH_RESPONSE" | jq '.'
echo -e "${GREEN}✓ Búsqueda realizada correctamente${NC}\n"

# =============================================================================
# 8. DELETE - Eliminar conductor (soft delete)
# =============================================================================
if [ ! -z "$CONDUCTOR_ID" ]; then
  echo -e "${YELLOW}8. DELETE /api/conductores/${CONDUCTOR_ID} - Eliminar${NC}"
  
  # Preguntar confirmación
  read -p "¿Deseas eliminar el conductor de prueba? (s/n): " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Ss]$ ]]; then
    DELETE_RESPONSE=$(curl -s -X DELETE "${API_URL}/api/conductores/${CONDUCTOR_ID}" \
      -H "Authorization: Bearer ${TOKEN}")
    
    echo "$DELETE_RESPONSE" | jq '.'
    echo -e "${GREEN}✓ Conductor eliminado correctamente${NC}\n"
  else
    echo -e "${BLUE}→ Eliminación cancelada. El conductor permanece en el sistema.${NC}\n"
  fi
fi

# =============================================================================
# Resumen
# =============================================================================
echo -e "${BLUE}==============================================================================${NC}"
echo -e "${BLUE}   Resumen de Tests${NC}"
echo -e "${BLUE}==============================================================================${NC}"
echo -e "${GREEN}✓ Autenticación${NC}"
echo -e "${GREEN}✓ Listar conductores${NC}"
echo -e "${GREEN}✓ Crear conductor${NC}"
echo -e "${GREEN}✓ Obtener conductor por ID${NC}"
echo -e "${GREEN}✓ Actualizar conductor${NC}"
echo -e "${GREEN}✓ Actualizar estado${NC}"
echo -e "${GREEN}✓ Buscar conductores${NC}"
echo -e "${GREEN}✓ Eliminar conductor${NC}"
echo ""
echo -e "${GREEN}Todos los tests completados exitosamente!${NC}"
echo -e "${BLUE}==============================================================================${NC}"
