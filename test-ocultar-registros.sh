#!/bin/bash

# Script de testing para funcionalidad "Ocultar Registros"
# Fecha: 26-01-2026

TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhNjg4Mjc3OC01OTY1LTQxMmMtYWIwMi03YTYyZmZkMDU3NTAiLCJlbWFpbCI6IjEyMjdqbGRldkBnbWFpbC5jb20iLCJyb2xlIjoiYWRtaW4iLCJpYXQiOjE3Mzc4NTA5NTgsImV4cCI6MjcwNTU0NjQ5NTh9.z0Aq4MXHP3a6VU03eDr2qU4g3eVt-TH_9G_NLfNJj6Q"
API_URL="http://localhost:4000/api"

echo "========================================="
echo " TEST: Funcionalidad Ocultar Registros"
echo "========================================="
echo ""

# 1. Obtener un conductor
echo "1️⃣  Obteniendo conductor de prueba..."
CONDUCTOR_RESPONSE=$(curl -s -X GET "${API_URL}/conductores?limit=1" \
  -H "Authorization: Bearer ${TOKEN}")

CONDUCTOR_ID=$(echo $CONDUCTOR_RESPONSE | jq -r '.data[0].id')
CONDUCTOR_NOMBRE=$(echo $CONDUCTOR_RESPONSE | jq -r '.data[0].nombre + " " + .data[0].apellido')

echo "✅ Conductor: $CONDUCTOR_NOMBRE (ID: $CONDUCTOR_ID)"
echo ""

# 2. Verificar que tiene oculto=false
echo "2️⃣  Verificando estado inicial (oculto=false)..."
CONDUCTOR_DETAIL=$(curl -s -X GET "${API_URL}/conductores/${CONDUCTOR_ID}" \
  -H "Authorization: Bearer ${TOKEN}")

OCULTO_INICIAL=$(echo $CONDUCTOR_DETAIL | jq -r '.data.oculto')
echo "Estado oculto inicial: $OCULTO_INICIAL"
echo ""

# 3. Ocultar el conductor
echo "3️⃣  Ocultando conductor..."
OCULTAR_RESPONSE=$(curl -s -X PATCH "${API_URL}/conductores/${CONDUCTOR_ID}/ocultar" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"oculto": true}')

echo "Respuesta: $(echo $OCULTAR_RESPONSE | jq '.message')"
echo ""

# 4. Verificar que NO aparece en listado normal
echo "4️⃣  Verificando que NO aparece en listado normal..."
LISTADO_NORMAL=$(curl -s -X GET "${API_URL}/conductores?search=${CONDUCTOR_NOMBRE}" \
  -H "Authorization: Bearer ${TOKEN}")

COUNT_NORMAL=$(echo $LISTADO_NORMAL | jq '.data | length')
echo "Conductores encontrados en listado normal: $COUNT_NORMAL (esperado: 0)"
echo ""

# 5. Verificar que SÍ aparece en listado de ocultos
echo "5️⃣  Verificando que SÍ aparece en listado de ocultos..."
LISTADO_OCULTOS=$(curl -s -X GET "${API_URL}/conductores/ocultos?search=${CONDUCTOR_NOMBRE}" \
  -H "Authorization: Bearer ${TOKEN}")

COUNT_OCULTOS=$(echo $LISTADO_OCULTOS | jq '.data | length')
echo "Conductores encontrados en listado ocultos: $COUNT_OCULTOS (esperado: 1)"

if [ $COUNT_OCULTOS -eq 1 ]; then
  echo "✅ Test pasado: El conductor está en la lista de ocultos"
else
  echo "❌ Test fallido: El conductor NO está en la lista de ocultos"
fi
echo ""

# 6. Restaurar conductor (mostrar de nuevo)
echo "6️⃣  Restaurando conductor (mostrar de nuevo)..."
MOSTRAR_RESPONSE=$(curl -s -X PATCH "${API_URL}/conductores/${CONDUCTOR_ID}/ocultar" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"oculto": false}')

echo "Respuesta: $(echo $MOSTRAR_RESPONSE | jq '.message')"
echo ""

# 7. Verificar que vuelve a aparecer en listado normal
echo "7️⃣  Verificando que vuelve a aparecer en listado normal..."
LISTADO_FINAL=$(curl -s -X GET "${API_URL}/conductores?search=${CONDUCTOR_NOMBRE}" \
  -H "Authorization: Bearer ${TOKEN}")

COUNT_FINAL=$(echo $LISTADO_FINAL | jq '.data | length')
echo "Conductores encontrados: $COUNT_FINAL (esperado: 1)"

if [ $COUNT_FINAL -eq 1 ]; then
  echo "✅ Test pasado: El conductor está visible de nuevo"
else
  echo "❌ Test fallido: El conductor NO está visible"
fi
echo ""

echo "========================================="
echo " RESUMEN DE TESTS"
echo "========================================="
echo "✅ COMPLETADO: Tests de funcionalidad ocultar conductores"
echo ""
echo "📝 PENDIENTE:"
echo "  - Implementar endpoints para vehículos"
echo "  - Implementar endpoints para empresas/clientes"
echo "  - Crear páginas frontend"
echo ""
