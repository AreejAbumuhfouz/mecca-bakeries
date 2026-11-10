#!/usr/bin/env bash
# Deploys the latest main branch on the server. Run as the mecca user from /opt/mecca.
# Takes a backup first, so a bad migration can be rolled back with infra/backup/restore.sh.
set -euo pipefail
cd /opt/mecca
echo "→ backup before deploying"
BACKUP_ENV=/etc/mecca/backup.env ./infra/backup/backup.sh
echo "→ code"
git fetch origin && git checkout main && git pull --ff-only
echo "→ packages"
pnpm install --frozen-lockfile
echo "→ build"
pnpm --filter @mecca/shared build
pnpm --filter @mecca/api build
pnpm --filter @mecca/web build
echo "→ database migrations"
pnpm --filter @mecca/api db:migrate
echo "→ restart"
sudo systemctl restart mecca-api mecca-web
sleep 3
curl -fsS http://127.0.0.1:4000/api/health && echo && echo "✓ deployed $(git rev-parse --short HEAD)"
