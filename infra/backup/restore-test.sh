#!/usr/bin/env bash
# Proves the latest backup can really be restored: restores it into a scratch database,
# compares row counts and money totals with the live database, then drops the scratch
# database. Run monthly (and after any change to the backup setup). Exit code 0 = good.
set -euo pipefail
ENV_FILE="${BACKUP_ENV:-/etc/mecca/backup.env}"
# shellcheck disable=SC1090
[ -f "$ENV_FILE" ] && source "$ENV_FILE"
: "${DATABASE_URL:?DATABASE_URL is not set}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/mecca}"
here="$(cd "$(dirname "$0")" && pwd)"

dump="${1:-$(ls -1t "$BACKUP_DIR"/db_*.dump | head -1)}"
[ -f "$dump" ] || { echo "no backup found in $BACKUP_DIR"; exit 1; }
echo "Testing $dump"

# Same server, database name with a _restore_test suffix.
base="${DATABASE_URL%%\?*}"
query="${DATABASE_URL#"$base"}"
admin_url="${base%/*}/postgres$query"
scratch="$(basename "$base")_restore_test"
scratch_url="${base%/*}/$scratch$query"

psql -q "$admin_url" -c "drop database if exists $scratch" -c "create database $scratch"
trap 'psql -q "$admin_url" -c "drop database if exists $scratch" >/dev/null' EXIT

"$here/restore.sh" "$dump" "$scratch_url"

check="$(cat <<'SQL'
select concat_ws(', ',
  (select count(*) from customers) || ' customers',
  (select count(*) from orders) || ' orders',
  (select count(*) from invoices) || ' invoices',
  (select count(*) from payments) || ' payments',
  (select coalesce(sum(total), 0) from invoices where status <> 'cancelled') || ' fils invoiced',
  (select coalesce(sum(amount), 0) from payments where status = 'received') || ' fils received')
SQL
)"
restored="$(psql -Atq "$scratch_url" -c "$check")"
echo "restored: $restored"
# Live data can only have grown since the backup; same numbers right after a backup.
live="$(psql -Atq "$DATABASE_URL" -c "$check")"
echo "live:     $live"
[ -n "$restored" ] || { echo "✗ restored database is empty"; exit 1; }
[ "$restored" = "$live" ] && echo "✓ the restored copy matches the live database exactly"
echo "✓ restore test passed"
