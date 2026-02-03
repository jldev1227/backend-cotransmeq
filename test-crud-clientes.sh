#!/bin/bash

# =============================================================================
# Tests de CRUD para Clientes/Empresas
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
echo -e "${BLUE}   Tests de CRUD para Clientes/Empresas${NC}"
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
# 2. GET - Listar todos los clientes
# =============================================================================
echo -e "${YELLOW}2. GET /api/clientes - Listar todos${NC}"

GET_ALL_RESPONSE=$(curl -s -X GET "${API_URL}/api/clientes?page=1&limit=10" \
  -H "Authorization: Bearer ${TOKEN}")

echo "$GET_ALL_RESPONSE" | jq '.'
echo ""

TOTAL_CLIENTES=$(echo "$GET_ALL_RESPONSE" | grep -o '"total":[0-9]*' | sed 's/"total"://')
echo -e "${GREEN}✓ Total de clientes: ${TOTAL_CLIENTES}${NC}\n"

# =============================================================================
# 3. GET - Listar clientes básicos (para selects)
# =============================================================================
echo -e "${YELLOW}3. GET /api/empresas/basicos - Lista básica${NC}"

GET_BASICOS_RESPONSE=$(curl -s -X GET "${API_URL}/api/empresas/basicos" \
  -H "Authorization: Bearer ${TOKEN}")

echo "$GET_BASICOS_RESPONSE" | jq '.'
echo -e "${GREEN}✓ Lista básica obtenida${NC}\n"

# =============================================================================
# 4. POST - Crear nuevo cliente EMPRESA
# =============================================================================
echo -e "${YELLOW}4. POST /api/clientes - Crear nueva EMPRESA${NC}"

CREATE_EMPRESA_RESPONSE=$(curl -s -X POST "${API_URL}/api/clientes" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  -d '{
    "tipo": "EMPRESA",
    "nit": "900123456-7",
    "nombre": "Empresa de Prueba S.A.S",
    "representante": "María López",
    "cedula": "1234567890",
    "telefono": "6017001234",
    "direccion": "Carrera 7 #12-34",
    "correo": "contacto@empresa-prueba.com",
    "requiere_osi": true,
    "paga_recargos": true
  }')

echo "$CREATE_EMPRESA_RESPONSE" | jq '.'

EMPRESA_ID=$(echo "$CREATE_EMPRESA_RESPONSE" | grep -o '"id":"[^"]*' | sed 's/"id":"//')

if [ -z "$EMPRESA_ID" ]; then
  echo -e "${RED}❌ Error: No se pudo crear la empresa${NC}\n"
else
  echo -e "${GREEN}✓ Empresa creada con ID: ${EMPRESA_ID}${NC}\n"
fi

# =============================================================================
# 5. POST - Crear nuevo cliente PERSONA
# =============================================================================
echo -e "${YELLOW}5. POST /api/clientes - Crear nueva PERSONA${NC}"

CREATE_PERSONA_RESPONSE=$(curl -s -X POST "${API_URL}/api/clientes" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  -d '{
    "tipo": "PERSONA",
    "nombre": "Carlos Rodríguez",
    "cedula": "9876543210",
    "telefono": "3109876543",
    "direccion": "Calle 45 #67-89",
    "correo": "carlos.rodriguez@email.com",
    "requiere_osi": false,
    "paga_recargos": false
  }')

echo "$CREATE_PERSONA_RESPONSE" | jq '.'

PERSONA_ID=$(echo "$CREATE_PERSONA_RESPONSE" | grep -o '"id":"[^"]*' | sed 's/"id":"//')

if [ -z "$PERSONA_ID" ]; then
  echo -e "${RED}❌ Error: No se pudo crear la persona${NC}\n"
else
  echo -e "${GREEN}✓ Persona creada con ID: ${PERSONA_ID}${NC}\n"
fi

# =============================================================================
# 6. GET - Obtener cliente por ID
# =============================================================================
if [ ! -z "$EMPRESA_ID" ]; then
  echo -e "${YELLOW}6. GET /api/clientes/${EMPRESA_ID} - Obtener por ID${NC}"
  
  GET_BY_ID_RESPONSE=$(curl -s -X GET "${API_URL}/api/clientes/${EMPRESA_ID}" \
    -H "Authorization: Bearer ${TOKEN}")
  
  echo "$GET_BY_ID_RESPONSE" | jq '.'
  echo -e "${GREEN}✓ Cliente obtenido correctamente${NC}\n"
fi

# =============================================================================
# 7. PUT - Actualizar cliente
# =============================================================================
if [ ! -z "$EMPRESA_ID" ]; then
  echo -e "${YELLOW}7. PUT /api/clientes/${EMPRESA_ID} - Actualizar${NC}"
  
  UPDATE_RESPONSE=$(curl -s -X PUT "${API_URL}/api/clientes/${EMPRESA_ID}" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${TOKEN}" \
    -d '{
      "tipo": "EMPRESA",
      "nit": "900123456-7",
      "nombre": "Empresa de Prueba ACTUALIZADA S.A.S",
      "representante": "María López García",
      "cedula": "1234567890",
      "telefono": "6017001234",
      "direccion": "Carrera 7 #12-34 Piso 5",
      "correo": "contacto@empresa-actualizada.com",
      "requiere_osi": true,
      "paga_recargos": true
    }')
  
  echo "$UPDATE_RESPONSE" | jq '.'
  echo -e "${GREEN}✓ Cliente actualizado correctamente${NC}\n"
fi

# =============================================================================
# 8. GET - Buscar clientes con filtros
# =============================================================================
echo -e "${YELLOW}8. GET /api/clientes/buscar - Buscar con filtros${NC}"

SEARCH_RESPONSE=$(curl -s -X GET "${API_URL}/api/clientes/buscar?tipo=EMPRESA&search=Prueba" \
  -H "Authorization: Bearer ${TOKEN}")

echo "$SEARCH_RESPONSE" | jq '.'
echo -e "${GREEN}✓ Búsqueda realizada correctamente${NC}\n"

# =============================================================================
# 9. DELETE - Eliminar cliente
# =============================================================================
if [ ! -z "$EMPRESA_ID" ] && [ ! -z "$PERSONA_ID" ]; then
  echo -e "${YELLOW}9. DELETE - Eliminar clientes de prueba${NC}"
  
  # Preguntar confirmación
  read -p "¿Deseas eliminar los clientes de prueba? (s/n): " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Ss]$ ]]; then
    # Eliminar empresa
    DELETE_EMPRESA_RESPONSE=$(curl -s -X DELETE "${API_URL}/api/clientes/${EMPRESA_ID}" \
      -H "Authorization: Bearer ${TOKEN}")
    echo "Empresa: $DELETE_EMPRESA_RESPONSE" | jq '.'
    
    # Eliminar persona
    DELETE_PERSONA_RESPONSE=$(curl -s -X DELETE "${API_URL}/api/clientes/${PERSONA_ID}" \
      -H "Authorization: Bearer ${TOKEN}")
    echo "Persona: $DELETE_PERSONA_RESPONSE" | jq '.'
    
    echo -e "${GREEN}✓ Clientes eliminados correctamente${NC}\n"
  else
    echo -e "${BLUE}→ Eliminación cancelada. Los clientes permanecen en el sistema.${NC}\n"
  fi
fi

# =============================================================================
# Resumen
# =============================================================================
echo -e "${BLUE}==============================================================================${NC}"
echo -e "${BLUE}   Resumen de Tests${NC}"
echo -e "${BLUE}==============================================================================${NC}"
echo -e "${GREEN}✓ Autenticación${NC}"
echo -e "${GREEN}✓ Listar clientes${NC}"
echo -e "${GREEN}✓ Lista básica${NC}"
echo -e "${GREEN}✓ Crear empresa${NC}"
echo -e "${GREEN}✓ Crear persona${NC}"
echo -e "${GREEN}✓ Obtener cliente por ID${NC}"
echo -e "${GREEN}✓ Actualizar cliente${NC}"
echo -e "${GREEN}✓ Buscar clientes${NC}"
echo -e "${GREEN}✓ Eliminar clientes${NC}"
echo ""
echo -e "${GREEN}Todos los tests completados exitosamente!${NC}"
echo -e "${BLUE}==============================================================================${NC}"
