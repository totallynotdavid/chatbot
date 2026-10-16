#!/bin/sh
# One backup: a consistent copy of the database, then the database copy and the
# upload stores into the restic repository, then retention. Run it by hand with
#   docker compose run --rm backup backup.sh
set -eu

: "${RESTIC_REPOSITORY:?set RESTIC_REPOSITORY}"
: "${RESTIC_PASSWORD:?set RESTIC_PASSWORD}"
: "${DB_PATH:?set DB_PATH}"
: "${UPLOAD_DIR:?set UPLOAD_DIR}"
: "${PRIVATE_DIR:?set PRIVATE_DIR}"

# A fixed path and host name let restic recognise the previous snapshot as the
# parent of this one, whichever container runs it.
stage=/tmp/stage
host=vendeya

rm -rf "$stage"
mkdir -p "$stage"

if ! restic cat config >/dev/null 2>&1; then
  restic init
fi

# `.backup` copies a database that is being written. Copying the file would not.
sqlite3 -cmd ".timeout 10000" "$DB_PATH" ".backup '$stage/database.sqlite'"
pg_dump --format=custom --file="$stage/postgres.dump"

paths="$stage"
for dir in "$UPLOAD_DIR" "$PRIVATE_DIR"; do
  if [ -d "$dir" ]; then paths="$paths $dir"; fi
done

# shellcheck disable=SC2086
restic backup --host "$host" --tag scheduled $paths
restic forget --host "$host" --keep-daily 7 --keep-weekly 4 --keep-monthly 12 --prune
restic check

rm -rf "$stage"
