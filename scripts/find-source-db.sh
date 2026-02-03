#!/bin/bash

# Script para ayudarte a identificar tu base de datos origen

echo "🔍 IDENTIFICANDO TU BASE DE DATOS POSTGRESQL ORIGEN"
echo "=================================================="
echo ""

# Función para verificar conexión
check_connection() {
    local host=$1
    local port=$2
    local user=$3
    local dbname=$4
    
    echo "Probando conexión:"
    echo "  Host: $host"
    echo "  Port: $port"
    echo "  User: $user"
    echo "  Database: $dbname"
    echo ""
    
    # Intentar conexión (pedirá password)
    if psql -h "$host" -p "$port" -U "$user" -d "$dbname" -c "SELECT version();" > /dev/null 2>&1; then
        echo "✅ CONEXIÓN EXITOSA!"
        echo ""
        
        # Listar bases de datos
        echo "📋 Bases de datos disponibles:"
        psql -h "$host" -p "$port" -U "$user" -d "$dbname" -c "\l" -t | head -20
        echo ""
        
        # Contar tablas principales
        echo "📊 Tablas principales encontradas:"
        for table in usuarios conductores vehiculos clientes servicio liquidaciones; do
            count=$(psql -h "$host" -p "$port" -U "$user" -d "$dbname" -t -c "SELECT COUNT(*) FROM $table;" 2>/dev/null || echo "N/A")
            printf "  %-20s %s\n" "$table:" "$count"
        done
        echo ""
        
        return 0
    else
        echo "❌ No se pudo conectar"
        echo ""
        return 1
    fi
}

echo "Vamos a probar algunas configuraciones comunes..."
echo ""

# Configuración 1: localhost con usuario postgres
echo "============================================"
echo "OPCIÓN 1: PostgreSQL Local (localhost)"
echo "============================================"
read -p "¿Intentar con localhost? (y/n): " choice
if [ "$choice" == "y" ]; then
    read -p "Usuario (default: postgres): " user
    user=${user:-postgres}
    read -p "Puerto (default: 5432): " port
    port=${port:-5432}
    read -p "Base de datos (default: cotransmeq): " dbname
    dbname=${dbname:-cotransmeq}
    
    check_connection "localhost" "$port" "$user" "$dbname"
fi

echo ""

# Configuración 2: Servidor remoto
echo "============================================"
echo "OPCIÓN 2: Servidor Remoto"
echo "============================================"
read -p "¿Probar con un servidor remoto? (y/n): " choice
if [ "$choice" == "y" ]; then
    read -p "Host/IP: " host
    read -p "Puerto (default: 5432): " port
    port=${port:-5432}
    read -p "Usuario: " user
    read -p "Base de datos: " dbname
    
    check_connection "$host" "$port" "$user" "$dbname"
fi

echo ""
echo "============================================"
echo "📝 RESUMEN"
echo "============================================"
echo ""
echo "Una vez que identifiques tu base de datos origen,"
echo "edita los siguientes archivos:"
echo ""
echo "  1. scripts/migrate-to-azure.ts (líneas 4-11)"
echo "  2. scripts/check-databases.ts (líneas 4-11)"
echo ""
echo "Reemplaza estos valores:"
echo ""
echo "  const sourceDb = new Client({"
echo "    host: 'TU_HOST',           // localhost o IP"
echo "    port: TU_PUERTO,           // generalmente 5432"
echo "    user: 'TU_USUARIO',        // ej: postgres"
echo "    password: 'TU_PASSWORD',   // tu password"
echo "    database: 'TU_DATABASE',   // ej: cotransmeq"
echo "    ssl: false                 // o true si usas SSL"
echo "  });"
echo ""
echo "Luego ejecuta:"
echo "  npm run migrate:check    # Para verificar"
echo "  npm run migrate:to-azure # Para migrar"
echo ""
