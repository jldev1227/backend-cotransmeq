#!/bin/sh
#
# Deja lista la base desechable de la suite: levanta el contenedor, espera a que
# responda y le aplica el schema.
#
#   npm run test:setup
#
# Es idempotente: si el contenedor ya está arriba, solo resincroniza el schema.
#
# Se usa `prisma db push` y NO `migrate deploy` a propósito. El historial de
# migraciones de este proyecto está desalineado con la base real, y `deploy`
# ofrece un reset que vacía tablas. Para una base efímera lo único que importa
# es que la forma coincida con `schema.prisma`, que es justo lo que hace `push`.

set -e

COMPOSE_FILE="docker-compose.test.yml"
CONTENEDOR="cotransmeq-postgres-test"
URL_TEST="postgresql://postgres:postgres@localhost:55433/cotransmeq_test?schema=public"

if ! docker info >/dev/null 2>&1; then
  echo ""
  echo "  Docker no está corriendo."
  echo "  Ábrelo (Docker Desktop) y vuelve a lanzar 'npm run test:setup'."
  echo ""
  exit 1
fi

echo "→ Levantando Postgres de test…"
docker compose -f "$COMPOSE_FILE" up -d

echo "→ Esperando a que acepte conexiones…"
i=0
while [ $i -lt 60 ]; do
  estado=$(docker inspect --format '{{.State.Health.Status}}' "$CONTENEDOR" 2>/dev/null || echo "ausente")
  if [ "$estado" = "healthy" ]; then
    break
  fi
  if [ "$estado" = "ausente" ]; then
    echo "  El contenedor $CONTENEDOR no existe. Revisa $COMPOSE_FILE."
    exit 1
  fi
  i=$((i + 1))
  sleep 2
done

if [ "$estado" != "healthy" ]; then
  echo "  El contenedor no llegó a 'healthy' en 120s. Logs:"
  docker logs --tail 30 "$CONTENEDOR"
  exit 1
fi

# Producción tiene pgcrypto instalada; si algún default de columna o alguna
# consulta la usa, sin ella el test fallaría con un error que no dice nada.
echo "→ Instalando extensiones…"
docker exec "$CONTENEDOR" psql -U postgres -d cotransmeq_test \
  -c "CREATE EXTENSION IF NOT EXISTS pgcrypto;" >/dev/null

echo "→ Aplicando schema…"
DATABASE_URL="$URL_TEST" npx prisma db push --skip-generate --accept-data-loss

# `db push` sincroniza lo que Prisma sabe declarar, y hay cosas que no sabe:
# los índices PARCIALES (`WHERE deleted_at IS NULL`) y el schema `auditoria`.
# Sin este paso la base de test no tendría ni los índices que usan las
# consultas de negocio ni la tabla donde se registran las eliminaciones, y los
# tests de borrado lógico pasarían por motivos equivocados.
echo "→ Aplicando migraciones SQL que Prisma no cubre…"
for sql in prisma/migrations/*/migration.sql; do
  case "$sql" in
    *_soft_delete_*|*_auditoria_*)
      docker exec -i "$CONTENEDOR" psql -U postgres -d cotransmeq_test -q -v ON_ERROR_STOP=1 < "$sql" \
        && echo "   ✓ $(basename "$(dirname "$sql")")"
      ;;
  esac
done

echo ""
echo "✓ Base de test lista en localhost:55433/cotransmeq_test"
echo "  Ahora: npm test"
echo ""
