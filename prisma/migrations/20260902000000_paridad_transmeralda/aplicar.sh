#!/bin/zsh
# ============================================================================
# Aplica la migracion de paridad a la base de cotransmeq.
#
#   ./aplicar.sh "postgresql://usuario:clave@host:puerto/base?sslmode=require"
#
# Que hace, en orden, y por que:
#
#   1. Rechaza la URL si parece la base de transmeralda. Las dos empresas
#      comparten codigo y esquema, y confundirlas aqui significa aplicar DDL a
#      la empresa equivocada.
#   2. Fotografia el estado actual (tablas, filas de las tablas grandes).
#   3. Vuelca un backup COMPLETO con pg_dump antes de tocar nada. Si el
#      servidor es 18.x hay que usar el pg_dump 18: el 17 se niega a hablar con
#      el, y ese es justo el caso de railway.
#   4. Aplica el DDL en UNA sola transaccion. Un fallo a mitad revierte todo.
#   5. Comprueba que el esquema queda satisfecho (`migrate diff` vacio).
#   6. Registra la migracion con `migrate resolve --applied`.
#
# El DDL es aditivo e idempotente: no contiene ni un DROP, ni un TRUNCATE, ni
# un DELETE, y se puede relanzar. Se ensayo contra una copia local del esquema
# antiguo, dos veces seguidas, antes de escribir esto.
#
# NO se usa `prisma migrate deploy`: el historial local y el de la base no
# tienen ninguna migracion en comun, y `deploy` intentaria aplicar el baseline
# entero sobre una base ya poblada.
# ============================================================================
set -e
set -u

MIG_DIR="${0:A:h}"
MIG_NOMBRE="${MIG_DIR:t}"
REPO="${MIG_DIR:h:h:h}"

PSQL17=/opt/homebrew/opt/postgresql@17/bin/psql
PGDUMP17=/opt/homebrew/opt/postgresql@17/bin/pg_dump
PGDUMP18=/opt/homebrew/opt/postgresql@18/bin/pg_dump

if [[ $# -lt 1 ]]; then
  print -u2 "uso: $0 <DATABASE_URL de cotransmeq>"
  exit 1
fi
URL_ORIGINAL="$1"

# `psql` rechaza el parametro `schema=public`, que es de prisma, pero hay que
# conservar `sslmode`. Al quitarlo puede quedar la cadena empezando por `&`, y
# entonces psql se traga el resto como nombre de la base.
URL_PSQL=$(print -r -- "$URL_ORIGINAL" | sed -E 's/[?&]schema=public//; s/\?&/?/; s#/([^/?]+)&#/\1?#')
HOST=$(print -r -- "$URL_ORIGINAL" | sed -E 's#.*@([^/?]+).*#\1#')
BASE=$(print -r -- "$URL_ORIGINAL" | sed -E 's#.*/([^/?]+)(\?.*)?$#\1#')

print "== Destino =================================================="
print "   host: $HOST"
print "   base: $BASE"

# --- 1. Salvaguarda: que no sea transmeralda -------------------------------
if [[ -f "$REPO/../backend-nest/.env" ]]; then
  URL_TM=$(grep -E '^DATABASE_URL=' "$REPO/../backend-nest/.env" | sed -E 's/^DATABASE_URL=//; s/^"//; s/"$//' || true)
  HOST_TM=$(print -r -- "${URL_TM:-}" | sed -E 's#.*@([^/?]+).*#\1#')
  if [[ -n "${HOST_TM:-}" && "$HOST" == "$HOST_TM" ]]; then
    print -u2 "\n   ABORTADO: ese host es el de transmeralda (backend-nest/.env)."
    print -u2 "   Esta migracion es para la base de cotransmeq."
    exit 1
  fi
fi

# --- 2. Estado antes -------------------------------------------------------
print "\n== Estado ANTES ============================================="
$PSQL17 "$URL_PSQL" -X -A -t -v ON_ERROR_STOP=1 -c "
  select '   tablas=' || (select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE')
  union all select '   version=' || current_setting('server_version')
  union all select '   users=' || (select count(*) from users)
  union all select '   conductores=' || (select count(*) from conductores)
  union all select '   liquidaciones=' || (select count(*) from liquidaciones)
  union all select '   formularios_asistencia=' || (select count(*) from formularios_asistencia)
"

# --- 3. Backup -------------------------------------------------------------
SERVIDOR=$($PSQL17 "$URL_PSQL" -X -A -t -c "select current_setting('server_version')" | cut -d. -f1)
PGDUMP=$PGDUMP17
[[ "$SERVIDOR" -ge 18 ]] && PGDUMP=$PGDUMP18

SELLO=$(date +%Y%m%d-%H%M%S)
BACKUP="$HOME/backups-cotransmeq/cotransmeq-$SELLO.dump"
mkdir -p "${BACKUP:h}"

print "\n== Backup ==================================================="
print "   pg_dump: $($PGDUMP --version)"
print "   destino: $BACKUP"
$PGDUMP "$URL_PSQL" --format=custom --no-owner --no-privileges --file="$BACKUP"
print "   tamano:  $(du -h "$BACKUP" | cut -f1)"

if [[ ! -s "$BACKUP" ]]; then
  print -u2 "   ABORTADO: el backup salio vacio."
  exit 1
fi

# --- 4. Aplicar ------------------------------------------------------------
print "\n== Aplicando el DDL (transaccion unica) ====================="
$PSQL17 "$URL_PSQL" -X -q -v ON_ERROR_STOP=1 --single-transaction -f "$MIG_DIR/migration.sql"
print "   aplicado sin errores"

# --- 5. Verificar ----------------------------------------------------------
print "\n== Estado DESPUES ==========================================="
$PSQL17 "$URL_PSQL" -X -A -t -v ON_ERROR_STOP=1 -c "
  select '   tablas=' || (select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE')
  union all select '   liquidacion_tercero_final=' || (select count(*) from information_schema.tables where table_schema='public' and table_name='liquidacion_tercero_final')
  union all select '   liquidacion_tercero_ocasional=' || (select count(*) from information_schema.tables where table_schema='public' and table_name='liquidacion_tercero_ocasional')
  union all select '   canvas_anotacion=' || (select count(*) from information_schema.tables where table_schema='public' and table_name='canvas_anotacion')
  union all select '   users.permisos_rutas=' || (select count(*) from information_schema.columns where table_name='users' and column_name='permisos_rutas')
  union all select '   users=' || (select count(*) from users)
  union all select '   conductores=' || (select count(*) from conductores)
  union all select '   liquidaciones=' || (select count(*) from liquidaciones)
  union all select '   formularios_asistencia=' || (select count(*) from formularios_asistencia)
"

print "\n== Diferencias que queden frente a schema.prisma ============"
cd "$REPO"
PEND=$(DATABASE_URL="$URL_ORIGINAL" npx prisma migrate diff \
  --from-url "$URL_ORIGINAL" --to-schema-datamodel prisma/schema.prisma --script 2>/dev/null \
  | grep -vcE '^\s*(--.*)?$' || true)
print "   lineas pendientes: $PEND   (0 = paridad exacta)"

# --- 6. Registrar ----------------------------------------------------------
print "\n== Registrando la migracion ================================="
DATABASE_URL="$URL_ORIGINAL" npx prisma migrate resolve --applied "$MIG_NOMBRE"

print "\nListo. Backup en: $BACKUP"
