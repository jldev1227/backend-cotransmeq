#!/bin/bash

# Script de Testing Completo - Funcionalidad Ocultar Registros
# Fecha: 25-01-2026

TOKEN="${TOKEN:?Falta TOKEN: un token de sesión del dashboard}"
API_URL="http://localhost:4000/api"

echo "========================================="
echo " TEST COMPLETO: Funcionalidad Ocultar"
echo "========================================="
echo ""

# =====================================================
# PARTE 1: CREAR REGISTROS DE PRUEBA EN MODO OCULTO
# =====================================================

echo "📝 PARTE 1: Creando registros de prueba..."
echo ""

# 1. Crear conductor de prueba
echo "1️⃣  Creando conductor de prueba..."
CONDUCTOR_RESPONSE=$(curl -s -X POST "${API_URL}/conductores" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "nombre": "CONDUCTOR",
    "apellido": "OCULTO_TEST",
    "cedula": "99999999",
    "telefono": "3001234567",
    "email": "conductor.oculto@test.com",
    "direccion": "Calle Test 123",
    "estado": "activo"
  }')

CONDUCTOR_ID=$(echo $CONDUCTOR_RESPONSE | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "✅ Conductor creado: $CONDUCTOR_ID"
echo ""

# 2. Crear vehículo de prueba
echo "2️⃣  Creando vehículo de prueba..."
VEHICULO_RESPONSE=$(curl -s -X POST "${API_URL}/vehiculos" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "placa": "TEST999",
    "marca": "CHEVROLET",
    "modelo": "2024",
    "clase_vehiculo": "AUTOMOVIL",
    "conductor_id": "'$CONDUCTOR_ID'",
    "estado": "activo"
  }')

VEHICULO_ID=$(echo $VEHICULO_RESPONSE | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "✅ Vehículo creado: $VEHICULO_ID"
echo ""

# 3. Crear empresa de prueba
echo "3️⃣  Creando empresa de prueba..."
EMPRESA_RESPONSE=$(curl -s -X POST "${API_URL}/clientes" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "tipo": "EMPRESA",
    "nit": "999999999-9",
    "nombre": "EMPRESA OCULTA TEST",
    "telefono": "3009876543",
    "correo": "empresa.oculta@test.com"
  }')

EMPRESA_ID=$(echo $EMPRESA_RESPONSE | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "✅ Empresa creada: $EMPRESA_ID"
echo ""

# =====================================================
# PARTE 2: OCULTAR LOS REGISTROS
# =====================================================

echo "========================================="
echo "📝 PARTE 2: Ocultando registros..."
echo "========================================="
echo ""

# 1. Ocultar conductor
echo "1️⃣  Ocultando conductor..."
curl -s -X PATCH "${API_URL}/conductores/${CONDUCTOR_ID}/ocultar" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"oculto": true}' > /dev/null
echo "✅ Conductor ocultado"
echo ""

# 2. Ocultar vehículo
echo "2️⃣  Ocultando vehículo..."
curl -s -X PATCH "${API_URL}/vehiculos/${VEHICULO_ID}/ocultar" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"oculto": true}' > /dev/null
echo "✅ Vehículo ocultado"
echo ""

# 3. Ocultar empresa
echo "3️⃣  Ocultando empresa..."
curl -s -X PATCH "${API_URL}/clientes/${EMPRESA_ID}/ocultar" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"oculto": true}' > /dev/null
echo "✅ Empresa ocultada"
echo ""

# =====================================================
# PARTE 3: VERIFICAR QUE NO APARECEN EN LISTADOS NORMALES
# =====================================================

echo "========================================="
echo "📝 PARTE 3: Verificando listados normales..."
echo "========================================="
echo ""

# 1. Verificar conductor NO aparece
echo "1️⃣  Verificando conductor NO aparece en listado normal..."
CONDUCTOR_NORMAL=$(curl -s "${API_URL}/conductores?search=OCULTO_TEST" \
  -H "Authorization: Bearer ${TOKEN}")
COUNT_CONDUCTOR=$(echo $CONDUCTOR_NORMAL | grep -o "$CONDUCTOR_ID" | wc -l)

if [ $COUNT_CONDUCTOR -eq 0 ]; then
  echo "✅ PASS: Conductor NO aparece en listado normal"
else
  echo "❌ FAIL: Conductor SÍ aparece en listado normal (no debería)"
fi
echo ""

# 2. Verificar vehículo NO aparece
echo "2️⃣  Verificando vehículo NO aparece en listado normal..."
VEHICULO_NORMAL=$(curl -s "${API_URL}/vehiculos" \
  -H "Authorization: Bearer ${TOKEN}")
COUNT_VEHICULO=$(echo $VEHICULO_NORMAL | grep -o "$VEHICULO_ID" | wc -l)

if [ $COUNT_VEHICULO -eq 0 ]; then
  echo "✅ PASS: Vehículo NO aparece en listado normal"
else
  echo "❌ FAIL: Vehículo SÍ aparece en listado normal (no debería)"
fi
echo ""

# 3. Verificar empresa NO aparece
echo "3️⃣  Verificando empresa NO aparece en listado normal..."
EMPRESA_NORMAL=$(curl -s "${API_URL}/clientes?search=OCULTA" \
  -H "Authorization: Bearer ${TOKEN}")
COUNT_EMPRESA=$(echo $EMPRESA_NORMAL | grep -o "$EMPRESA_ID" | wc -l)

if [ $COUNT_EMPRESA -eq 0 ]; then
  echo "✅ PASS: Empresa NO aparece en listado normal"
else
  echo "❌ FAIL: Empresa SÍ aparece en listado normal (no debería)"
fi
echo ""

# =====================================================
# PARTE 4: VERIFICAR QUE SÍ APARECEN EN LISTADOS DE OCULTOS
# =====================================================

echo "========================================="
echo "📝 PARTE 4: Verificando listados de ocultos..."
echo "========================================="
echo ""

# 1. Verificar conductor SÍ aparece en ocultos
echo "1️⃣  Verificando conductor SÍ aparece en listado de ocultos..."
CONDUCTOR_OCULTO=$(curl -s "${API_URL}/conductores/ocultos" \
  -H "Authorization: Bearer ${TOKEN}")
COUNT_CONDUCTOR_OCULTO=$(echo $CONDUCTOR_OCULTO | grep -o "$CONDUCTOR_ID" | wc -l)

if [ $COUNT_CONDUCTOR_OCULTO -gt 0 ]; then
  echo "✅ PASS: Conductor SÍ aparece en listado de ocultos"
else
  echo "❌ FAIL: Conductor NO aparece en listado de ocultos (debería aparecer)"
fi
echo ""

# 2. Verificar vehículo SÍ aparece en ocultos
echo "2️⃣  Verificando vehículo SÍ aparece en listado de ocultos..."
VEHICULO_OCULTO=$(curl -s "${API_URL}/vehiculos/ocultos" \
  -H "Authorization: Bearer ${TOKEN}")
COUNT_VEHICULO_OCULTO=$(echo $VEHICULO_OCULTO | grep -o "$VEHICULO_ID" | wc -l)

if [ $COUNT_VEHICULO_OCULTO -gt 0 ]; then
  echo "✅ PASS: Vehículo SÍ aparece en listado de ocultos"
else
  echo "❌ FAIL: Vehículo NO aparece en listado de ocultos (debería aparecer)"
fi
echo ""

# 3. Verificar empresa SÍ aparece en ocultos
echo "3️⃣  Verificando empresa SÍ aparece en listado de ocultos..."
EMPRESA_OCULTA=$(curl -s "${API_URL}/clientes/ocultos" \
  -H "Authorization: Bearer ${TOKEN}")
COUNT_EMPRESA_OCULTA=$(echo $EMPRESA_OCULTA | grep -o "$EMPRESA_ID" | wc -l)

if [ $COUNT_EMPRESA_OCULTA -gt 0 ]; then
  echo "✅ PASS: Empresa SÍ aparece en listado de ocultos"
else
  echo "❌ FAIL: Empresa NO aparece en listado de ocultos (debería aparecer)"
fi
echo ""

# =====================================================
# PARTE 5: CREAR SERVICIO CON CONDUCTOR OCULTO
# =====================================================

echo "========================================="
echo "📝 PARTE 5: Testing con Servicios y Recargos..."
echo "========================================="
echo ""

# Obtener IDs de origen y destino para crear servicio
echo "1️⃣  Obteniendo origen y destino para crear servicio..."
ORIGEN_ID=$(curl -s "${API_URL}/ciudades?limit=1" -H "Authorization: Bearer ${TOKEN}" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
DESTINO_ID=$(curl -s "${API_URL}/ciudades?limit=2" -H "Authorization: Bearer ${TOKEN}" | grep -o '"id":"[^"]*"' | tail -1 | cut -d'"' -f4)

# Crear servicio con conductor oculto
echo "2️⃣  Creando servicio con conductor oculto..."
SERVICIO_RESPONSE=$(curl -s -X POST "${API_URL}/servicios" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "conductor_id": "'$CONDUCTOR_ID'",
    "vehiculo_id": "'$VEHICULO_ID'",
    "cliente_id": "'$EMPRESA_ID'",
    "origen_id": "'$ORIGEN_ID'",
    "destino_id": "'$DESTINO_ID'",
    "fecha_solicitud": "2026-01-25T10:00:00Z",
    "fecha_realizacion": "2026-01-25T14:00:00Z",
    "numero_planilla": "TEST-OCULTO-'$(date +%s)'",
    "estado": "solicitado",
    "valor": 500000
  }')

SERVICIO_ID=$(echo $SERVICIO_RESPONSE | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -z "$SERVICIO_ID" ]; then
  echo "❌ FAIL: No se pudo crear el servicio"
else
  echo "✅ Servicio creado: $SERVICIO_ID"
fi
echo ""

# Verificar que el servicio NO aparece en listado normal (porque conductor está oculto)
echo "3️⃣  Verificando que servicio NO aparece en listado normal..."
sleep 2
SERVICIOS_NORMAL=$(curl -s "${API_URL}/servicios?mes=1&ano=2026" \
  -H "Authorization: Bearer ${TOKEN}")
COUNT_SERVICIO=$(echo $SERVICIOS_NORMAL | grep -o "$SERVICIO_ID" | wc -l)

if [ $COUNT_SERVICIO -eq 0 ]; then
  echo "✅ PASS: Servicio NO aparece (conductor está oculto)"
else
  echo "⚠️  INFO: Servicio aparece (verificar si debe filtrarse por conductor oculto)"
fi
echo ""

# Verificar recargos
echo "4️⃣  Verificando recargos del servicio..."
RECARGOS=$(curl -s "${API_URL}/recargos?mes=1&ano=2026" \
  -H "Authorization: Bearer ${TOKEN}")

if [ -n "$SERVICIO_ID" ]; then
  COUNT_RECARGO=$(echo $RECARGOS | grep -o "$SERVICIO_ID" | wc -l)
  
  if [ $COUNT_RECARGO -eq 0 ]; then
    echo "✅ PASS: Recargo NO aparece (servicio con conductor oculto)"
  else
    echo "⚠️  INFO: Recargo aparece (verificar si debe filtrarse)"
  fi
fi
echo ""

# =====================================================
# PARTE 6: RESTAURAR REGISTROS
# =====================================================

echo "========================================="
echo "📝 PARTE 6: Restaurando registros..."
echo "========================================="
echo ""

# 1. Mostrar conductor
echo "1️⃣  Mostrando conductor..."
curl -s -X PATCH "${API_URL}/conductores/${CONDUCTOR_ID}/ocultar" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"oculto": false}' > /dev/null
echo "✅ Conductor visible nuevamente"
echo ""

# 2. Mostrar vehículo
echo "2️⃣  Mostrando vehículo..."
curl -s -X PATCH "${API_URL}/vehiculos/${VEHICULO_ID}/ocultar" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"oculto": false}' > /dev/null
echo "✅ Vehículo visible nuevamente"
echo ""

# 3. Mostrar empresa
echo "3️⃣  Mostrando empresa..."
curl -s -X PATCH "${API_URL}/clientes/${EMPRESA_ID}/ocultar" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"oculto": false}' > /dev/null
echo "✅ Empresa visible nuevamente"
echo ""

# Verificar que ahora SÍ aparecen
echo "4️⃣  Verificando que ahora SÍ aparecen en listados normales..."
sleep 1

CONDUCTOR_FINAL=$(curl -s "${API_URL}/conductores?search=OCULTO_TEST" \
  -H "Authorization: Bearer ${TOKEN}")
COUNT_CONDUCTOR_FINAL=$(echo $CONDUCTOR_FINAL | grep -o "$CONDUCTOR_ID" | wc -l)

if [ $COUNT_CONDUCTOR_FINAL -gt 0 ]; then
  echo "✅ PASS: Conductor visible en listado normal"
else
  echo "❌ FAIL: Conductor NO visible en listado normal"
fi
echo ""

# =====================================================
# RESUMEN FINAL
# =====================================================

echo "========================================="
echo "📊 RESUMEN DE TESTS"
echo "========================================="
echo ""
echo "✅ Tests completados"
echo ""
echo "IDs de prueba creados:"
echo "  - Conductor: $CONDUCTOR_ID"
echo "  - Vehículo: $VEHICULO_ID"
echo "  - Empresa: $EMPRESA_ID"
echo "  - Servicio: $SERVICIO_ID"
echo ""
echo "⚠️  IMPORTANTE: Revisar manualmente si servicios y recargos"
echo "   deben filtrarse automáticamente cuando el conductor está oculto"
echo ""
echo "========================================="
