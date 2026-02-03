#!/bin/bash

# Script de recuperación desde backup

echo "🔄 RESTAURAR DESDE BACKUP"
echo "========================"
echo ""

# Verificar que existan backups
if [ ! -d "." ]; then
    echo "❌ Error: ejecuta este script desde la carpeta backend-nest"
    exit 1
fi

# Listar backups disponibles
echo "📦 Backups disponibles:"
ls -lh backup_*.dump 2>/dev/null || echo "  No se encontraron backups en esta carpeta"
echo ""

# Menú de opciones
echo "¿Qué deseas hacer?"
echo ""
echo "1) Restaurar backup en Azure (DESTINO)"
echo "2) Restaurar backup en origen (LOCAL)"
echo "3) Ver información de un backup"
echo "4) Salir"
echo ""

read -p "Selecciona una opción (1-4): " option

case $option in
    1)
        echo ""
        echo "============================================"
        echo "RESTAURAR EN AZURE (DESTINO)"
        echo "============================================"
        read -p "Nombre del archivo de backup: " backup_file
        
        if [ ! -f "$backup_file" ]; then
            echo "❌ Error: archivo no encontrado"
            exit 1
        fi
        
        echo ""
        echo "⚠️  ADVERTENCIA: Esto reemplazará TODOS los datos en Azure!"
        read -p "¿Estás seguro? (escribe 'SI' para confirmar): " confirm
        
        if [ "$confirm" != "SI" ]; then
            echo "❌ Cancelado"
            exit 0
        fi
        
        echo ""
        echo "🔄 Restaurando en Azure..."
        echo "   Host: cotransmeq.postgres.database.azure.com"
        echo "   User: admintransmeralda"
        echo "   Database: postgres"
        echo ""
        
        pg_restore -h cotransmeq.postgres.database.azure.com \
                   -U admintransmeralda \
                   -d postgres \
                   --clean \
                   --if-exists \
                   --verbose \
                   "$backup_file"
        
        if [ $? -eq 0 ]; then
            echo ""
            echo "✅ Restauración completada exitosamente!"
        else
            echo ""
            echo "❌ Error durante la restauración"
            exit 1
        fi
        ;;
        
    2)
        echo ""
        echo "============================================"
        echo "RESTAURAR EN ORIGEN (LOCAL)"
        echo "============================================"
        read -p "Nombre del archivo de backup: " backup_file
        
        if [ ! -f "$backup_file" ]; then
            echo "❌ Error: archivo no encontrado"
            exit 1
        fi
        
        read -p "Host (default: localhost): " host
        host=${host:-localhost}
        read -p "Puerto (default: 5432): " port
        port=${port:-5432}
        read -p "Usuario (default: postgres): " user
        user=${user:-postgres}
        read -p "Base de datos (default: cotransmeq): " database
        database=${database:-cotransmeq}
        
        echo ""
        echo "⚠️  ADVERTENCIA: Esto reemplazará TODOS los datos en la base de datos origen!"
        read -p "¿Estás seguro? (escribe 'SI' para confirmar): " confirm
        
        if [ "$confirm" != "SI" ]; then
            echo "❌ Cancelado"
            exit 0
        fi
        
        echo ""
        echo "🔄 Restaurando..."
        
        pg_restore -h "$host" \
                   -p "$port" \
                   -U "$user" \
                   -d "$database" \
                   --clean \
                   --if-exists \
                   --verbose \
                   "$backup_file"
        
        if [ $? -eq 0 ]; then
            echo ""
            echo "✅ Restauración completada exitosamente!"
        else
            echo ""
            echo "❌ Error durante la restauración"
            exit 1
        fi
        ;;
        
    3)
        echo ""
        echo "============================================"
        echo "INFORMACIÓN DEL BACKUP"
        echo "============================================"
        read -p "Nombre del archivo de backup: " backup_file
        
        if [ ! -f "$backup_file" ]; then
            echo "❌ Error: archivo no encontrado"
            exit 1
        fi
        
        echo ""
        echo "📊 Información del backup:"
        pg_restore --list "$backup_file" | head -50
        echo ""
        echo "... (mostrando primeras 50 líneas)"
        echo ""
        
        # Contar tablas
        table_count=$(pg_restore --list "$backup_file" | grep "TABLE DATA" | wc -l)
        echo "📋 Total de tablas: $table_count"
        ;;
        
    4)
        echo "👋 Saliendo..."
        exit 0
        ;;
        
    *)
        echo "❌ Opción inválida"
        exit 1
        ;;
esac

echo ""
echo "✅ Operación completada"
echo ""
