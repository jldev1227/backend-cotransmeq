#!/bin/sh
# Re-baseline del historial de migraciones en PRODUCCIÓN (Railway).
#
# Se corre UNA sola vez, después del re-baseline hecho en local (2026-08-26).
# A partir de ahí, producción solo recibe `prisma migrate deploy`.
#
# Contexto: el historial nunca fue reconstruible — 27 migraciones creaban 63 de
# las 116 tablas y no había migración inicial. Arrastraba además una migración
# muerta desde julio y 27 foreign keys duplicadas. Prisma no podía levantar la shadow
# database, concluía «drift» y ofrecía un reset; ese reset es el que venía
# vaciando `formularios_asistencia`. Ahora el repo tiene un baseline completo
# (`prisma/migrations/00000000000000_baseline`) y una migración de reconciliación.
#
# Uso:
#   RAILWAY_URL="postgresql://..." ./scripts/prisma-production-baseline.sh
#
# El script NO toca datos: solo reescribe la tabla `_prisma_migrations`.
# Aun así exige un dump previo y una confirmación explícita.

set -e
cd "$(dirname "$0")/.."

if [ -z "$RAILWAY_URL" ]; then
  echo "Falta RAILWAY_URL. Exporta la URL de producción y vuelve a intentarlo." >&2
  exit 1
fi

PG18=/opt/homebrew/opt/postgresql@18/bin
PSQL="$PG18/psql"
[ -x "$PSQL" ] || PSQL=psql

echo "Paso 0: dump de seguridad."
STAMP=$(date +%Y%m%d_%H%M)
DUMP="$HOME/backups/cotransmeq/railway_prebaseline_$STAMP.dump"
mkdir -p "$(dirname "$DUMP")"
"$PG18/pg_dump" "$RAILWAY_URL" -Fc --no-owner --no-privileges -f "$DUMP"
"$PG18/pg_restore" -l "$DUMP" > /dev/null
echo "  dump verificado: $DUMP"

echo
echo "Paso 1: estado actual de _prisma_migrations en producción."
"$PSQL" "$RAILWAY_URL" -c "select count(*) as filas, count(distinct migration_name) as nombres from _prisma_migrations;"

echo
printf 'Se va a REEMPLAZAR _prisma_migrations por una sola fila (el baseline). Escribe BASELINE para continuar: '
read -r RESPUESTA
[ "$RESPUESTA" = "BASELINE" ] || { echo "Cancelado."; exit 1; }

echo
echo "Paso 2: vaciar el historial."
"$PSQL" "$RAILWAY_URL" -v ON_ERROR_STOP=1 -c "TRUNCATE _prisma_migrations;"

echo
echo "Paso 3: registrar el baseline como aplicado (sin ejecutar su SQL)."
DATABASE_URL="$RAILWAY_URL" npx prisma migrate resolve --applied 00000000000000_baseline

echo
echo "Paso 4: aplicar las migraciones posteriores al baseline (dedupe de FKs + reconciliación)."
DATABASE_URL="$RAILWAY_URL" npx prisma migrate deploy

echo
echo "Paso 5: comprobación."
DATABASE_URL="$RAILWAY_URL" npx prisma migrate status
"$PSQL" "$RAILWAY_URL" -c "select 'formularios_asistencia' as tabla, count(*) from formularios_asistencia
                           union all select 'respuestas_asistencia', count(*) from respuestas_asistencia;"

echo
echo "Listo. De aquí en adelante: solo 'prisma migrate deploy' contra producción."
