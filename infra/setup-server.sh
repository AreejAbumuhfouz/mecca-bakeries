#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu 24.04 VPS (Hostinger) for Mecca Bakeries. Run as root.
#   APP_DOMAIN=app.example.com API_DOMAIN=api.example.com ADMIN_EMAIL=you@example.com ./setup-server.sh
set -euo pipefail
: "${APP_DOMAIN:?set APP_DOMAIN}" "${API_DOMAIN:?set API_DOMAIN}" "${ADMIN_EMAIL:?set ADMIN_EMAIL}"

apt-get update
apt-get install -y curl git nginx postgresql postgresql-contrib chromium-browser fonts-noto-core \
  certbot python3-certbot-nginx rclone ufw unattended-upgrades
# Node.js 22 LTS + pnpm
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs
corepack enable && corepack prepare pnpm@10.28.0 --activate

# Firewall: SSH and the web only.
ufw allow OpenSSH && ufw allow 'Nginx Full' && ufw --force enable
dpkg-reconfigure -f noninteractive unattended-upgrades
timedatectl set-timezone Asia/Amman

# App user, folders, database.
id mecca >/dev/null 2>&1 || useradd --system --create-home --shell /bin/bash mecca
mkdir -p /opt/mecca /var/backups/mecca /etc/mecca
chown mecca:mecca /opt/mecca /var/backups/mecca
DB_PASS="$(openssl rand -hex 24)"
sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'mecca') THEN
    CREATE ROLE mecca LOGIN PASSWORD '$DB_PASS';
  END IF;
END \$\$;
SQL
sudo -u postgres createdb -O mecca mecca_bakeries 2>/dev/null || true
echo "Database password for mecca: $DB_PASS  (put it in apps/api/.env and /etc/mecca/backup.env)"

# nginx + SSL
sed -e "s/app.example.com/$APP_DOMAIN/g" -e "s/api.example.com/$API_DOMAIN/g" \
  "$(dirname "$0")/nginx/mecca.conf" > /etc/nginx/sites-available/mecca
ln -sf /etc/nginx/sites-available/mecca /etc/nginx/sites-enabled/mecca
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
certbot --nginx --non-interactive --agree-tos -m "$ADMIN_EMAIL" -d "$APP_DOMAIN" -d "$API_DOMAIN"

# Services
cp "$(dirname "$0")"/systemd/*.service "$(dirname "$0")"/systemd/*.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable mecca-api mecca-web mecca-backup.timer
echo "✓ Server ready. Next: clone the code into /opt/mecca as the mecca user, fill the .env files, run infra/deploy.sh"
