#!/usr/bin/env bash
set -Eeuo pipefail

readonly EXPECTED_SHA="${1:-}"
readonly SOURCE_DIR="/opt/actions-runner/backend-cotransmeq/_work/backend-cotransmeq/backend-cotransmeq"
readonly COMPOSE_FILE="${SOURCE_DIR}/docker-compose.yml"
readonly BACKEND_ENV_FILE="/root/backend-cotransmeq/.env"
readonly CONTAINER="backend-cotransmeq-nest"
readonly PRODUCTION_IMAGE="backend-cotransmeq:production"
readonly RELEASE_IMAGE="backend-cotransmeq:${EXPECTED_SHA}"

if [[ ! "${EXPECTED_SHA}" =~ ^[0-9a-f]{40}$ ]]; then
	echo "El commit recibido no es un SHA completo válido." >&2
	exit 64
fi

if [[ "$(git -C "${SOURCE_DIR}" rev-parse HEAD)" != "${EXPECTED_SHA}" ]]; then
	echo "El checkout del runner no coincide con el commit solicitado." >&2
	exit 65
fi

exec 9>/run/lock/deploy-backend-cotransmeq.lock
flock -n 9 || {
	echo "Ya existe otro despliegue de backend-cotransmeq en ejecución." >&2
	exit 75
}

previous_image="$(docker inspect "${CONTAINER}" --format '{{.Image}}')"

docker build \
	--label "com.cotransmeq.git-sha=${EXPECTED_SHA}" \
	-t "${RELEASE_IMAGE}" \
	"${SOURCE_DIR}"
docker tag "${RELEASE_IMAGE}" "${PRODUCTION_IMAGE}"

compose_up() {
	BACKEND_ENV_FILE="${BACKEND_ENV_FILE}" docker compose \
		--project-name backend-cotransmeq \
		-f "${COMPOSE_FILE}" \
		up -d --no-deps --force-recreate backend
}

wait_healthy() {
	local attempt status
	for attempt in $(seq 1 75); do
		status="$(docker inspect "${CONTAINER}" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' 2>/dev/null || true)"
		[[ "${status}" == "healthy" ]] && return 0
		[[ "${status}" == "unhealthy" || "${status}" == "exited" || "${status}" == "dead" ]] && return 1
		sleep 2
	done
	return 1
}

if ! compose_up || ! wait_healthy || ! curl -fsS --max-time 10 http://127.0.0.1:3001/ >/dev/null; then
	echo "El backend nuevo no superó el healthcheck; restaurando la imagen anterior." >&2
	docker tag "${previous_image}" "${PRODUCTION_IMAGE}"
	compose_up
	wait_healthy || true
	exit 1
fi

echo "Despliegue de backend-cotransmeq completado en ${EXPECTED_SHA}."
