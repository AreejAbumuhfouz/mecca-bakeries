#!/usr/bin/env bash
# Daily backup of the Mecca Bakeries database and uploaded files.
#   - pg_dump (custom format) + a tar of the uploads folder, named by date and time
#   - kept on the server for KEEP_DAYS days
#   - copied off the server with rclone (Backblaze B2, Google Drive, S3 … any rclone remote)
#   - optional ping to a monitoring URL (healthchecks.io) so a missed backup raises an alert
# Settings come from /etc/mecca/backup.env (see backup.env.example). Run by mecca-backup.timer.
set -euo pipefail

ENV_FILE="${BACKUP_ENV:-/etc/mecca/backup.env}"
# shellcheck disable=SC1090
[ -f "$ENV_FILE" ] && source "$ENV_FILE"

: "${DATABASE_URL:?DATABASE_URL is not set}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/mecca}"
UPLOAD_DIR="${UPLOAD_DIR:-/opt/mecca/apps/api/uploads}"
KEEP_DAYS="${KEEP_DAYS:-14}"
RCLONE_REMOTE="${RCLONE_REMOTE:-}"
HEALTHCHECK_URL="${HEALTHCHECK_URL:-}"

stamp="$(TZ=Asia/Amman date +%Y-%m-%d_%H%M)"
mkdir -p "$BACKUP_DIR"
db_file="$BACKUP_DIR/db_$stamp.dump"
files_file="$BACKUP_DIR/uploads_$stamp.tar.gz"

fail() {
  echo "BACKUP FAILED: $1" >&2
  [ -n "$HEALTHCHECK_URL" ] && curl -fsS -m 10 --retry 3 "$HEALTHCHECK_URL/fail" >/dev/null || true
  exit 1
}
trap 'fail "line $LINENO"' ERR

echo "→ database"
pg_dump --format=custom --no-owner --no-privileges --file="$db_file" "$DATABASE_URL"
pg_restore --list "$db_file" >/dev/null # the file must be readable

echo "→ uploaded files"
if [ -d "$UPLOAD_DIR" ]; then
  tar -czf "$files_file" -C "$(dirname "$UPLOAD_DIR")" "$(basename "$UPLOAD_DIR")"
fi

( cd "$BACKUP_DIR" && sha256sum "db_$stamp.dump" $( [ -f "$files_file" ] && echo "uploads_$stamp.tar.gz" ) ) > "$BACKUP_DIR/SHA256_$stamp.txt"

if [ -n "$RCLONE_REMOTE" ]; then
  echo "→ off-site copy to $RCLONE_REMOTE"
  rclone copy "$BACKUP_DIR" "$RCLONE_REMOTE" --include "*_$stamp.*" --include "SHA256_$stamp.txt"
  # Same retention off-site.
  rclone delete "$RCLONE_REMOTE" --min-age "${KEEP_DAYS}d" || true
fi

echo "→ removing local backups older than $KEEP_DAYS days"
find "$BACKUP_DIR" -type f -mtime +"$KEEP_DAYS" -delete

size="$(du -h "$db_file" | cut -f1)"
echo "✓ backup $stamp done (database $size)"
[ -n "$HEALTHCHECK_URL" ] && curl -fsS -m 10 --retry 3 "$HEALTHCHECK_URL" >/dev/null || true
