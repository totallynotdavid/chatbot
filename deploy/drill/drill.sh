#!/usr/bin/env bash
# Builds the three images from this checkout and runs the production stack
# beside a Graph fake and an S3 server. It checks that every service is healthy,
# that a signed webhook POST to `web` gets a reply on the fake (a forged one is
# refused), and that an account made before a backup survives a volume wipe and
# restore. All of it lives in the project vendeya-drill, removed on exit unless
# KEEP=1.
set -euo pipefail

root=$(cd "$(dirname "$0")/../.." && pwd)
cd "$root"

project=vendeya-drill
registry=ghcr.io/totallynotdavid/chatbot
work=$(mktemp -d "${TMPDIR:-/tmp}/vendeya-drill.XXXXXX")
export BUN_VERSION
BUN_VERSION=$(sed -n 's/^bun = "\(.*\)"/\1/p' mise.toml)
export DRILL_DIR="$root/deploy/drill"

secret() { openssl rand -hex 16; }
password="drill-$(secret)"
# Values the stack reads from its env file, and the Graph fake and S3 server
# take from the same file.
cat >"$work/env" <<ENV
BACKEND_TAG=drill
WEB_TAG=drill
BACKUP_TAG=drill
TUNNEL_TOKEN=unused
PUBLIC_URL=https://drill.example
SECRETS_KEY=$(openssl rand -hex 32)
POSTGRES_PASSWORD=$(secret)
WHATSAPP_APP_SECRET=$(secret)
WHATSAPP_TOKEN=drill-token
WHATSAPP_PHONE_ID=drill-phone
WHATSAPP_WEBHOOK_VERIFY_TOKEN=$(secret)
GRAPH_API_BASE_URL=http://graph:8080
RESTIC_REPOSITORY=s3:http://s3:9000/drill
RESTIC_PASSWORD=$(secret)
AWS_ACCESS_KEY_ID=drillaccess
AWS_SECRET_ACCESS_KEY=$(secret)
BACKUP_INTERVAL_SECONDS=3600
BOT_RESPONSE_DELAY_MS=200
ENV

dc() {
  docker compose --progress quiet -p "$project" --env-file "$work/env" \
    -f deploy/compose.prod.yml -f deploy/drill/compose.drill.yml "$@"
}
step() { printf '\n== %s\n' "$*"; }

cleanup() {
  if [ "${KEEP:-0}" = 1 ]; then
    echo "stack left up as project $project; its env file is $work/env"
    return
  fi
  dc down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

step "build the images"
docker build -q -f deploy/backend.Dockerfile --build-arg "BUN_VERSION=$BUN_VERSION" \
  -t "$registry/backend:drill" .
docker build -q -f deploy/web.Dockerfile --build-arg "BUN_VERSION=$BUN_VERSION" \
  -t "$registry/web:drill" .
docker build -q -t "$registry/backup:drill" deploy/backup

step "up -d --wait on a clean host"
dc down --volumes --remove-orphans >/dev/null 2>&1 || true
dc up -d --wait
dc ps --format 'table {{.Service}}\t{{.Status}}'

step "a signed webhook POST to web produces a reply on the Graph fake"
dc exec -T graph bun /drill/probe.ts webhook

step "web accepts its own origin on a form-typed POST and refuses another"
dc exec -T graph bun /drill/probe.ts origin

step "create an account, then back up"
printf '%s\n' "$password" |
  dc exec -T backend bun src/cli/account.ts create drill-admin
dc exec -T graph bun /drill/probe.ts login drill-admin "$password"
dc exec -T postgres psql -U vendeya -d vendeya -q \
  -c "CREATE TABLE drill (note text); INSERT INTO drill VALUES ('before the backup')"
dc run --rm --no-deps backup backup.sh

step "destroy the data volumes"
dc stop backend web backup postgres
dc rm -f backend web backup postgres migrate >/dev/null
docker volume rm "${project}_data" "${project}_postgres" >/dev/null

step "restore on an empty host"
dc up -d --wait postgres s3
dc run --rm --no-deps backup sh -c 'test ! -e "$DB_PATH" && echo "no database before the restore"'
dc run --rm --no-deps backup restore.sh
dc up -d --wait

step "the account and the database survived"
dc exec -T graph bun /drill/probe.ts login drill-admin "$password"
dc exec -T postgres psql -U vendeya -d vendeya -tA -c "SELECT note FROM drill"
dc exec -T graph bun /drill/probe.ts webhook

step "a second restore refuses to overwrite a database that holds data"
if dc run --rm --no-deps backup restore.sh; then
  echo "FAIL: restore.sh overwrote a live database" >&2
  exit 1
fi

step "image sizes"
docker image ls --format '{{.Repository}}:{{.Tag}}\t{{.Size}}' "$registry/*:drill"
echo
echo "drill passed"
