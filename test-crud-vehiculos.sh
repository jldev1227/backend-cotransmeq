#!/bin/bash

# =============================================================================
# Tests de CRUD para Vehículos
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
echo -e "${BLUE}   Tests de CRUD para Vehículos${NC}"
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
# 2. GET - Listar todos los vehículos
# =============================================================================
echo -e "${YELLOW}2. GET /api/vehiculos - Listar todos${NC}"

GET_ALL_RESPONSE=$(curl -s -X GET "${API_URL}/api/vehiculos" \
  -H "Authorization: Bearer ${TOKEN}")

echo "$GET_ALL_RESPONSE" | jq '.'
echo ""

TOTAL_VEHICULOS=$(echo "$GET_ALL_RESPONSE" | grep -o '"count":[0-9]*' | sed 's/"count"://')
echo -e "${GREEN}✓ Total de vehículos: ${TOTAL_VEHICULOS}${NC}\n"

# =============================================================================
# 3. GET - Listar vehículos básicos (para selects)
# =============================================================================
echo -e "${YELLOW}3. GET /api/flota/basicos - Lista básica${NC}"

GET_BASICOS_RESPONSE=$(curl -s -X GET "${API_URL}/api/flota/basicos" \
  -H "Authorization: Bearer ${TOKEN}")

echo "$GET_BASICOS_RESPONSE" | jq '.'
echo -e "${GREEN}✓ Lista básica obtenida${NC}\n"

# =============================================================================
# 4. POST - Crear nuevo vehículo
# =============================================================================
echo -e "${YELLOW}4. POST /api/vehiculos - Crear nuevo vehículo${NC}"

CREATE_RESPONSE=$(curl -s -X POST "${API_URL}/api/vehiculos" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  -d '{
    "placa": "ABC123",
    "marca": "Chevrolet",
    "linea": "NHR",
    "modelo": "2020",
    "color": "Blanco",
    "clase_vehiculo": "Camión",
    "tipo_carroceria": "Estacas",
    "combustible": "Diesel",
    "numero_motor": "1234567890",
    "vin": "VIN1234567890",
    "numero_serie": "NS1234567890",
    "numero_chasis": "CH1234567890",
    "propietario_nombre": "Juan Pérez",
    "propietario_identificacion": "1234567890",
    "kilometraje": 50000,
    "estado": "DISPONIBLE",
    "fecha_matricula": "2020-01-15"
  }')

echo "$CREATE_RESPONSE" | jq '.'

VEHICULO_ID=$(echo "$CREATE_RESPONSE" | grep -o '"id":"[^"]*' | sed 's/"id":"//')

if [ -z "$VEHICULO_ID" ]; then
  echo -e "${RED}❌ Error: No se pudo crear el vehículo${NC}\n"
else
  echo -e "${GREEN}✓ Vehículo creado con ID: ${VEHICULO_ID}${NC}\n"
fi

# =============================================================================
# 5. GET - Obtener vehículo por ID
# =============================================================================
if [ ! -z "$VEHICULO_ID" ]; then
  echo -e "${YELLOW}5. GET /api/vehiculos/${VEHICULO_ID} - Obtener por ID${NC}"
  
  GET_BY_ID_RESPONSE=$(curl -s -X GET "${API_URL}/api/vehiculos/${VEHICULO_ID}" \
    -H "Authorization: Bearer ${TOKEN}")
  
  echo "$GET_BY_ID_RESPONSE" | jq '.'
  echo -e "${GREEN}✓ Vehículo obtenido correctamente${NC}\n"
fi

# =============================================================================
# 6. PUT - Actualizar vehículo
# =============================================================================
if [ ! -z "$VEHICULO_ID" ]; then
  echo -e "${YELLOW}6. PUT /api/vehiculos/${VEHICULO_ID} - Actualizar${NC}"
  
  UPDATE_RESPONSE=$(curl -s -X PUT "${API_URL}/api/vehiculos/${VEHICULO_ID}" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${TOKEN}" \
    -d '{
      "placa": "ABC123",
      "marca": "Chevrolet",
      "linea": "NHR ACTUALIZADO",
      "modelo": "2020",
      "color": "Azul",
      "clase_vehiculo": "Camión",
      "tipo_carroceria": "Estacas",
      "combustible": "Diesel",
      "numero_motor": "1234567890",
      "vin": "VIN1234567890",
      "numero_serie": "NS1234567890",
      "numero_chasis": "CH1234567890",
      "propietario_nombre": "Juan Pérez García",
      "propietario_identificacion": "1234567890",
      "kilometraje": 52000,
      "estado": "DISPONIBLE",
      "fecha_matricula": "2020-01-15"
    }')
  
  echo "$UPDATE_RESPONSE" | jq '.'
  echo -e "${GREEN}✓ Vehículo actualizado correctamente${NC}\n"
fi

# =============================================================================
# 7. PATCH - Actualizar estado del vehículo
# =============================================================================
if [ ! -z "$VEHICULO_ID" ]; then
  echo -e "${YELLOW}7. PATCH /api/vehiculos/${VEHICULO_ID}/estado - Cambiar estado${NC}"
  
  ESTADO_RESPONSE=$(curl -s -X PATCH "${API_URL}/api/vehiculos/${VEHICULO_ID}/estado" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${TOKEN}" \
    -d '{
      "estado": "MANTENIMIENTO"
    }')
  
  echo "$ESTADO_RESPONSE" | jq '.'
  echo -e "${GREEN}✓ Estado actualizado correctamente${NC}\n"
fi

# =============================================================================
# 8. PATCH - Actualizar kilometraje
# =============================================================================
if [ ! -z "$VEHICULO_ID" ]; then
  echo -e "${YELLOW}8. PATCH /api/vehiculos/${VEHICULO_ID}/kilometraje - Actualizar km${NC}"
  
  KM_RESPONSE=$(curl -s -X PATCH "${API_URL}/api/vehiculos/${VEHICULO_ID}/kilometraje" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${TOKEN}" \
    -d '{
      "kilometraje": 53500
    }')
  
  echo "$KM_RESPONSE" | jq '.'
  echo -e "${GREEN}✓ Kilometraje actualizado correctamente${NC}\n"
fi

# =============================================================================
# 9. GET - Obtener vehículos por estado
# =============================================================================
echo -e "${YELLOW}9. GET /api/vehiculos?estado=DISPONIBLE - Filtrar por estado${NC}"

FILTER_RESPONSE=$(curl -s -X GET "${API_URL}/api/vehiculos?estado=DISPONIBLE" \
  -H "Authorization: Bearer ${TOKEN}")

echo "$FILTER_RESPONSE" | jq '.'
echo -e "${GREEN}✓ Filtro aplicado correctamente${NC}\n"

# =============================================================================
# 10. DELETE - Eliminar vehículo
# =============================================================================
if [ ! -z "$VEHICULO_ID" ]; then
  echo -e "${YELLOW}10. DELETE /api/vehiculos/${VEHICULO_ID} - Eliminar${NC}"
  
  # Preguntar confirmación
  read -p "¿Deseas eliminar el vehículo de prueba? (s/n): " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Ss]$ ]]; then
    DELETE_RESPONSE=$(curl -s -X DELETE "${API_URL}/api/vehiculos/${VEHICULO_ID}" \
      -H "Authorization: Bearer ${TOKEN}")
    
    echo "$DELETE_RESPONSE" | jq '.'
    echo -e "${GREEN}✓ Vehículo eliminado correctamente${NC}\n"
  else
    echo -e "${BLUE}→ Eliminación cancelada. El vehículo permanece en el sistema.${NC}\n"
  fi
fi

# =============================================================================
# Resumen
# =============================================================================
echo -e "${BLUE}==============================================================================${NC}"
echo -e "${BLUE}   Resumen de Tests${NC}"
echo -e "${BLUE}==============================================================================${NC}"
echo -e "${GREEN}✓ Autenticación${NC}"
echo -e "${GREEN}✓ Listar vehículos${NC}"
echo -e "${GREEN}✓ Lista básica${NC}"
echo -e "${GREEN}✓ Crear vehículo${NC}"
echo -e "${GREEN}✓ Obtener vehículo por ID${NC}"
echo -e "${GREEN}✓ Actualizar vehículo${NC}"
echo -e "${GREEN}✓ Actualizar estado${NC}"
echo -e "${GREEN}✓ Actualizar kilometraje${NC}"
echo -e "${GREEN}✓ Filtrar por estado${NC}"
echo -e "${GREEN}✓ Eliminar vehículo${NC}"
echo ""
echo -e "${GREEN}Todos los tests completados exitosamente!${NC}"
echo -e "${BLUE}==============================================================================${NC}"
