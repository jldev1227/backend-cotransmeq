#!/bin/bash

TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhNjg4Mjc3OC01OTY1LTQxMmMtYWIwMi03YTYyZmZkMDU3NTAiLCJjb3JyZW8iOiIxMjI3amxkZXZAZ21haWwuY29tIiwicm9sZSI6ImFkbWluIiwiaWF0IjoxNzY4NDQxMjU2LCJleHAiOjE3NzEwMzMyNTZ9.s2bm45UHZkQwYYfwx7u9WB4exHqdxGjtozVhMz_P8Xk"
API_URL="http://localhost:4000/api"

echo "========================================="
echo " TEST FUNCIONALIDAD OCULTAR (SIMPLIFICADO)"
echo "========================================="
echo ""

# Obtener IDs existentes
echo "1️⃣  Obteniendo conductor existente..."
CONDUCTOR_ID=$(curl -s "${API_URL}/conductores?limit=1" -H "Authorization: Bearer ${TOKEN}" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "Conductor ID: $CONDUCTOR_ID"
echo ""

echo "2️⃣  Obteniendo vehículo existente..."
VEHICULO_ID=$(curl -s "${API_URL}/vehiculos?limit=1" -H "Authorization: Bearer ${TOKEN}" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "Vehículo ID: $VEHICULO_ID"
echo ""

echo "3️⃣  Obteniendo empresa existente..."
EMPRESA_ID=$(curl -s "${API_URL}/clientes?limit=1" -H "Authorization: Bearer ${TOKEN}" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "Empresa ID: $EMPRESA_ID"
echo ""

# TEST 1: Ocultar conductor
echo "========================================="
echo "TEST 1: CONDUCTOR"
echo "========================================="
echo ""

echo "a) Ocultando conductor..."
curl -s -X PATCH "${API_URL}/conductores/${CONDUCTOR_ID}/ocultar" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"oculto": true}' | jq '{success: .success, message: .message}'
echo ""

echo "b) Verificando que NO aparece en listado normal..."
COUNT=$(curl -s "${API_URL}/conductores" -H "Authorization: Bearer ${TOKEN}" | grep -c "$CONDUCTOR_ID" || echo "0")
if [ "$COUNT" = "0" ]; then
  echo "✅ PASS: Conductor NO aparece"
else
  echo "❌ FAIL: Conductor aparece ($COUNT veces)"
fi
echo ""

echo "c) Verificando que SÍ aparece en /ocultos..."
curl -s "${API_URL}/conductores/ocultos" -H "Authorization: Bearer ${TOKEN}" | jq '{success: .success, total: .total, tiene_conductor: (.data | map(.id) | contains(["'$CONDUCTOR_ID'"]))}' 
echo ""

echo "d) Restaurando conductor..."
curl -s -X PATCH "${API_URL}/conductores/${CONDUCTOR_ID}/ocultar" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"oculto": false}' | jq '{success: .success, message: .message}'
echo ""

# TEST 2: Ocultar vehículo
echo "========================================="
echo "TEST 2: VEHÍCULO"
echo "========================================="
echo ""

echo "a) Ocultando vehículo..."
curl -s -X PATCH "${API_URL}/vehiculos/${VEHICULO_ID}/ocultar" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"oculto": true}' | jq '{success: .success, message: .message}'
echo ""

echo "b) Verificando que NO aparece en listado normal..."
COUNT=$(curl -s "${API_URL}/vehiculos" -H "Authorization: Bearer ${TOKEN}" | grep -c "$VEHICULO_ID" || echo "0")
if [ "$COUNT" = "0" ]; then
  echo "✅ PASS: Vehículo NO aparece"
else
  echo "❌ FAIL: Vehículo aparece ($COUNT veces)"
fi
echo ""

echo "c) Verificando que SÍ aparece en /ocultos..."
curl -s "${API_URL}/vehiculos/ocultos" -H "Authorization: Bearer ${TOKEN}" | jq '{success: .success, total: .total, tiene_vehiculo: (.data | map(.id) | contains(["'$VEHICULO_ID'"]))}' 
echo ""

echo "d) Restaurando vehículo..."
curl -s -X PATCH "${API_URL}/vehiculos/${VEHICULO_ID}/ocultar" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"oculto": false}' | jq '{success: .success, message: .message}'
echo ""

# TEST 3: Ocultar empresa
echo "========================================="
echo "TEST 3: EMPRESA"
echo "========================================="
echo ""

echo "a) Ocultando empresa..."
curl -s -X PATCH "${API_URL}/clientes/${EMPRESA_ID}/ocultar" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"oculto": true}' | jq '{success: .success, message: .message}'
echo ""

echo "b) Verificando que NO aparece en listado normal..."
COUNT=$(curl -s "${API_URL}/clientes" -H "Authorization: Bearer ${TOKEN}" | grep -c "$EMPRESA_ID" || echo "0")
if [ "$COUNT" = "0" ]; then
  echo "✅ PASS: Empresa NO aparece"
else
  echo "❌ FAIL: Empresa aparece ($COUNT veces)"
fi
echo ""

echo "c) Verificando que SÍ aparece en /ocultos..."
curl -s "${API_URL}/clientes/ocultos" -H "Authorization: Bearer ${TOKEN}" | jq '{success: .success, data_count: (.data | length)}' 
echo ""

echo "d) Restaurando empresa..."
curl -s -X PATCH "${API_URL}/clientes/${EMPRESA_ID}/ocultar" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"oculto": false}' | jq '{success: .success, message: .message}'
echo ""

echo "========================================="
echo "✅ TESTS COMPLETADOS"
echo "========================================="
