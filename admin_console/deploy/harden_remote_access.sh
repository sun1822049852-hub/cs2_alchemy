#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${APP_ROOT:-/opt/cs2_alchemy/cs2_alchemy}"
ADMIN_CONTAINER="${ADMIN_CONTAINER:-cs2-admin}"
GATEWAY_CONTAINER="${GATEWAY_CONTAINER:-cs2-auth-gateway}"
ADMIN_IMAGE="${ADMIN_IMAGE:-node:24-bookworm-slim}"
GATEWAY_IMAGE="${GATEWAY_IMAGE:-nginx:1.27-alpine}"
ADMIN_HOST_PORT="${ADMIN_HOST_PORT:-8787}"
ADMIN_CANDIDATE_PORT="${ADMIN_CANDIDATE_PORT:-28787}"
PUBLIC_HOST_PORT="${PUBLIC_HOST_PORT:-80}"
ENV_FILE="${ENV_FILE:-$APP_ROOT/tmp/qq-mail.local.env}"
GATEWAY_CONFIG="${GATEWAY_CONFIG:-$APP_ROOT/admin_console/deploy/cs2-auth-gateway.nginx.conf}"
RENDERED_GATEWAY_CONFIG="${RENDERED_GATEWAY_CONFIG:-$APP_ROOT/tmp/cs2-auth-gateway.rendered.conf}"
ADMIN_WORKDIR="${ADMIN_WORKDIR:-$APP_ROOT/admin_console}"
ADMIN_ENV_MOUNT_PATH="${ADMIN_ENV_MOUNT_PATH:-/runtime/control-plane.env}"
CANDIDATE_CONTAINER="${CANDIDATE_CONTAINER:-${ADMIN_CONTAINER}-candidate}"

require_file() {
  local path="$1"
  if [[ ! -f "$path" ]]; then
    echo "missing required file: $path" >&2
    exit 1
  fi
}

remove_container() {
  local name="$1"
  sudo docker rm -f "$name" >/dev/null 2>&1 || true
}

wait_for_http_ok() {
  local url="$1"
  local attempts="${2:-30}"
  local delay="${3:-1}"
  local attempt=1

  while (( attempt <= attempts )); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep "$delay"
    ((attempt++))
  done

  echo "timed out waiting for $url" >&2
  return 1
}

require_file "$ENV_FILE"
require_file "$GATEWAY_CONFIG"
require_file "$ADMIN_WORKDIR/package.json"
cleanup_candidate() {
  remove_container "$CANDIDATE_CONTAINER"
}
trap cleanup_candidate EXIT

mkdir -p "$(dirname "$RENDERED_GATEWAY_CONFIG")"
sed \
  -e "s/__PUBLIC_HOST_PORT__/${PUBLIC_HOST_PORT}/g" \
  -e "s/__ADMIN_HOST_PORT__/${ADMIN_HOST_PORT}/g" \
  "$GATEWAY_CONFIG" > "$RENDERED_GATEWAY_CONFIG"

echo "[cs2-auth-hardening] ensuring admin_console dependencies"
if [[ -f "$ADMIN_WORKDIR/package-lock.json" ]]; then
  sudo docker run --rm \
    -w /app/admin_console \
    -v "$APP_ROOT:/app" \
    "$ADMIN_IMAGE" \
    npm ci --omit=dev >/dev/null
else
  sudo docker run --rm \
    -w /app/admin_console \
    -v "$APP_ROOT:/app" \
    "$ADMIN_IMAGE" \
    npm install --omit=dev >/dev/null
fi

echo "[cs2-auth-hardening] validating gateway config"
sudo docker run --rm \
  --network host \
  -v "$RENDERED_GATEWAY_CONFIG:/etc/nginx/conf.d/default.conf:ro" \
  "$GATEWAY_IMAGE" \
  nginx -t >/dev/null

echo "[cs2-auth-hardening] validating admin source on candidate port"
remove_container "$CANDIDATE_CONTAINER"
sudo docker run -d \
  --name "$CANDIDATE_CONTAINER" \
  --restart no \
  -w /app/admin_console \
  -e "CONTROL_PLANE_ENV_FILE=${ADMIN_ENV_MOUNT_PATH}" \
  -v "$APP_ROOT:/app" \
  -v "$ENV_FILE:${ADMIN_ENV_MOUNT_PATH}:ro" \
  -p "127.0.0.1:${ADMIN_CANDIDATE_PORT}:8787" \
  "$ADMIN_IMAGE" \
  node src/server.js >/dev/null

wait_for_http_ok "http://127.0.0.1:${ADMIN_CANDIDATE_PORT}/api/health"

echo "[cs2-auth-hardening] stopping previous containers"
remove_container "$GATEWAY_CONTAINER"
remove_container "$ADMIN_CONTAINER"

echo "[cs2-auth-hardening] starting local-only admin source"
sudo docker run -d \
  --name "$ADMIN_CONTAINER" \
  --restart unless-stopped \
  -w /app/admin_console \
  -e "CONTROL_PLANE_ENV_FILE=${ADMIN_ENV_MOUNT_PATH}" \
  -v "$APP_ROOT:/app" \
  -v "$ENV_FILE:${ADMIN_ENV_MOUNT_PATH}:ro" \
  -p "127.0.0.1:${ADMIN_HOST_PORT}:8787" \
  "$ADMIN_IMAGE" \
  node src/server.js >/dev/null

wait_for_http_ok "http://127.0.0.1:${ADMIN_HOST_PORT}/api/health"
remove_container "$CANDIDATE_CONTAINER"

echo "[cs2-auth-hardening] starting public auth gateway on :${PUBLIC_HOST_PORT}"
sudo docker run -d \
  --name "$GATEWAY_CONTAINER" \
  --restart unless-stopped \
  --network host \
  -v "$RENDERED_GATEWAY_CONFIG:/etc/nginx/conf.d/default.conf:ro" \
  "$GATEWAY_IMAGE" >/dev/null

wait_for_http_ok "http://127.0.0.1:${PUBLIC_HOST_PORT}/api/health"

echo "[cs2-auth-hardening] local admin source: http://127.0.0.1:${ADMIN_HOST_PORT}/admin"
echo "[cs2-auth-hardening] public auth gateway: http://127.0.0.1:${PUBLIC_HOST_PORT}/api/health"
