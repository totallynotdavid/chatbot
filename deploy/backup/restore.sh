#!/bin/sh
# Restores a snapshot (the latest by default) into the database and the upload
# stores. Stop the backend first, then run
#   docker compose run --rm backup restore.sh [snapshot-id] [--force]
# It refuses to write over a database that holds data unless --force is given.
set -eu

: "${RESTIC_REPOSITORY:?set RESTIC_REPOSITORY}"
: "${RESTIC_PASSWORD:?set RESTIC_PASSWORD}"
: "${DB_PATH:?set DB_PATH}"
: "${UPLOAD_DIR:?set UPLOAD_DIR}"
: "${PRIVATE_DIR:?set PRIVATE_DIR}"

snapshot=latest
force=0
for arg in "$@"; do
  case "$arg" in
    --force) force=1 ;;
    *) snapshot=$arg ;;
  esac
done

tables=$(psql --no-psqlrc --tuples-only --no-align --command \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")
if [ "$force" -eq 0 ] && { [ -s "$DB_PATH" ] || [ "$tables" -gt 0 ]; }; then
  echo "refusing to restore over a database that holds data; pass --force" >&2
  exit 1
fi

target=/tmp/restore
rm -rf "$target"
mkdir -p "$target"
restic restore "$snapshot" --host vendeya --target "$target"

# The WAL files belong to the database being replaced.
rm -f "$DB_PATH" "$DB_PATH-wal" "$DB_PATH-shm"
mkdir -p "$(dirname "$DB_PATH")"
cp "$target/tmp/stage/database.sqlite" "$DB_PATH"

pg_restore --clean --if-exists --no-owner --dbname "$PGDATABASE" \
  "$target/tmp/stage/postgres.dump"

for dir in "$UPLOAD_DIR" "$PRIVATE_DIR"; do
  if [ -d "$target$dir" ]; then
    mkdir -p "$dir"
    cp -a "$target$dir/." "$dir/"
  fi
done

rm -rf "$target"
echo "restored $snapshot"
