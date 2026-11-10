#!/usr/bin/env bash
# Restores a backup made by backup.sh.
#   restore.sh <db_….dump> <target database url> [uploads_….tar.gz] [uploads parent dir]
# The target database is emptied first (--clean). To restore over production: stop the API,
# restore, start the API. Usually restore into a new database first and check it.
set -euo pipefail
dump="${1:?usage: restore.sh <dump file> <database url> [uploads tar] [uploads parent dir]}"
target="${2:?target database url is required}"
uploads="${3:-}"
uploads_parent="${4:-/opt/mecca/apps/api}"

pg_restore --list "$dump" >/dev/null
echo "→ restoring database into $(echo "$target" | sed -E 's#//[^@]*@#//***@#')"
pg_restore --clean --if-exists --no-owner --no-privileges --single-transaction --dbname="$target" "$dump"

if [ -n "$uploads" ]; then
  echo "→ restoring uploaded files into $uploads_parent"
  tar -xzf "$uploads" -C "$uploads_parent"
fi
echo "✓ restore done"
