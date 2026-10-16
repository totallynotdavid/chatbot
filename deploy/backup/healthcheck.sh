#!/bin/sh
# Healthy while a backup has succeeded within two intervals plus a margin for
# the backup itself.
set -eu

interval=${BACKUP_INTERVAL_SECONDS:?set BACKUP_INTERVAL_SECONDS}
minutes=$((interval * 2 / 60 + 10))

[ -n "$(find /tmp/last-ok -mmin "-$minutes" 2>/dev/null)" ]
