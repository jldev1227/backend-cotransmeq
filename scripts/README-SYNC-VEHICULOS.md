# Script de Sincronización de Estados de Vehículos

Este script actualiza automáticamente los estados de los vehículos basándose en sus servicios activos.

## 📋 Lógica de Actualización

El script aplica las siguientes reglas:

- **SERVICIO**: Si el vehículo tiene al menos un servicio con estado `en_curso`
- **DISPONIBLE**: Si el vehículo NO tiene servicios en estado `en_curso`

## 🚀 Uso

### Opción 1: Usar npm script (Recomendado)

```bash
# Versión JavaScript (más rápida)
npm run sync:vehiculos

# Versión TypeScript
npm run sync:vehiculos:ts
```

### Opción 2: Ejecución directa

```bash
# JavaScript
node scripts/sync-vehiculo-estados.js

# TypeScript
npx ts-node scripts/sync-vehiculo-estados.ts
# o
npx tsx scripts/sync-vehiculo-estados.ts
```

## 📊 Salida del Script

El script proporciona información detallada:

```
🚀 Iniciando sincronización de estados de vehículos...

📊 Total de vehículos encontrados: 131

✅ LPZ245: DISPONIBLE -> SERVICIO (1 servicio(s) en curso)
✅ ABC123: SERVICIO -> DISPONIBLE (0 servicio(s) en curso)

============================================================
📋 RESUMEN DE SINCRONIZACIÓN
============================================================
Total de vehículos procesados: 131
✅ Vehículos actualizados: 2
⚪ Sin cambios: 128
❌ Errores: 1
============================================================

📝 DETALLE DE ACTUALIZACIONES:
------------------------------------------------------------
  LPZ245     | DISPONIBLE      -> SERVICIO
  ABC123     | SERVICIO        -> DISPONIBLE
------------------------------------------------------------

📊 DISTRIBUCIÓN ACTUAL DE ESTADOS:
------------------------------------------------------------
  DISPONIBLE          : 85 vehículos
  SERVICIO            : 12 vehículos
  MANTENIMIENTO       : 20 vehículos
  INACTIVO            : 14 vehículos
------------------------------------------------------------

✨ Sincronización completada exitosamente!
```

## ⚙️ Características

- ✅ **Seguro**: Solo actualiza vehículos que necesitan cambios
- ✅ **Informativo**: Muestra detalles de cada actualización
- ✅ **Estadísticas**: Proporciona resumen completo
- ✅ **Manejo de errores**: Continúa procesando aunque falle un vehículo
- ✅ **Transaccional**: Usa Prisma para garantizar integridad

## 🔄 Cuándo Ejecutar

Ejecuta este script cuando:

1. Necesites sincronizar estados después de cambios manuales
2. Quieras verificar la consistencia entre servicios y vehículos
3. Después de migraciones o actualizaciones masivas
4. Como parte de un proceso de mantenimiento programado

## ⚠️ Notas Importantes

- El script solo actualiza vehículos cuyo estado sea diferente al calculado
- No modifica vehículos en estados: `MANTENIMIENTO`, `INACTIVO`, `DESVINCULADO`, `NO_DISPONIBLE`
- Los cambios se guardan inmediatamente en la base de datos
- Requiere conexión a la base de datos configurada en `.env`

## 🔧 Automatización (Opcional)

Para ejecutar el script automáticamente, puedes configurar un cron job:

### Linux/Mac (crontab)

```bash
# Ejecutar cada hora
0 * * * * cd /ruta/al/proyecto && npm run sync:vehiculos >> /var/log/sync-vehiculos.log 2>&1

# Ejecutar cada 15 minutos
*/15 * * * * cd /ruta/al/proyecto && npm run sync:vehiculos >> /var/log/sync-vehiculos.log 2>&1
```

### Windows (Task Scheduler)

Crea una tarea programada que ejecute:
```
cmd /c "cd C:\ruta\al\proyecto && npm run sync:vehiculos"
```

## 🐛 Solución de Problemas

### Error: "Cannot find module '@prisma/client'"

```bash
npm install
npx prisma generate
```

### Error: "Environment variable not found"

Verifica que el archivo `.env` existe y contiene `DATABASE_URL`

### Error de conexión a base de datos

Verifica:
- La cadena de conexión en `.env`
- Que la base de datos esté en ejecución
- Los permisos de acceso

## 📝 Código Fuente

- **TypeScript**: `scripts/sync-vehiculo-estados.ts`
- **JavaScript**: `scripts/sync-vehiculo-estados.js`

Ambos archivos tienen la misma funcionalidad, elige el que prefieras.
