#!/bin/sh
# Backs up once at start and then every BACKUP_INTERVAL_SECONDS. A failed run is
# logged and tried again at the next interval. healthcheck.sh reports failure
# once no run has succeeded for two intervals.
set -u

interval=${BACKUP_INTERVAL_SECONDS:?set BACKUP_INTERVAL_SECONDS}
trap 'exit 0' TERM INT

while :; do
  if backup.sh; then
    touch /tmp/last-ok
  else
    echo "backup failed, retrying in ${interval}s" >&2
  fi
  sleep "$interval" &
  wait $!
done
