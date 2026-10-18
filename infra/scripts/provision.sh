#!/usr/bin/env bash
# Prepare a fresh Ubuntu 24.04 LTS server for dr-rayhab.com. Run once, as
# root, from a checkout of this repository (docs/production-runbook.md, step 4):
#
#   sudo ADMIN_EMAIL=you@example.com bash infra/scripts/provision.sh
#
# It is safe to run again: every step checks before it changes anything.
#
# What it does:
#   - system updates, automatic security updates, a firewall (22, 80, 443),
#     fail2ban, and SSH keys only (no passwords, no root login);
#   - Docker Engine with the compose plugin, Nginx, certbot;
#   - a "deploy" user that CI connects as, allowed to run Docker;
#   - /srv/rayhab/{production,staging} for site releases and settings;
#   - Let's Encrypt certificates for dr-rayhab.com, www and staging;
#   - the Nginx sites from infra/nginx.
set -euo pipefail

DOMAIN="${DOMAIN:-dr-rayhab.com}"
STAGING="${STAGING:-staging.$DOMAIN}"
ADMIN_EMAIL="${ADMIN_EMAIL:?set ADMIN_EMAIL for Let's Encrypt notices}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WITH_STAGING="${WITH_STAGING:-1}"

[ "$(id -u)" -eq 0 ] || { echo "Run as root (sudo)." >&2; exit 1; }
. /etc/os-release
[ "${ID:-}" = "ubuntu" ] || echo "Warning: written for Ubuntu 24.04; this is ${PRETTY_NAME:-unknown}." >&2

step() { printf '\n== %s\n' "$*"; }

step "System packages and automatic security updates"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y
apt-get install -y ca-certificates curl gnupg ufw fail2ban unattended-upgrades nginx certbot apache2-utils rsync
dpkg-reconfigure -f noninteractive unattended-upgrades

step "Firewall: SSH, HTTP and HTTPS only"
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

step "SSH: keys only, no root login"
install -d -m 755 /etc/ssh/sshd_config.d
cat > /etc/ssh/sshd_config.d/10-rayhab.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
EOF
systemctl reload ssh || systemctl reload sshd || true
systemctl enable --now fail2ban

step "Docker Engine and the compose plugin"
if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker

step "The deploy user (CI connects as this user)"
if ! id deploy >/dev/null 2>&1; then
  adduser --disabled-password --gecos "Rayhab deploy" deploy
fi
usermod -aG docker deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
touch /home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys
echo "Add the CI public key to /home/deploy/.ssh/authorized_keys (runbook step 9)."

step "Directories"
for env in production staging; do
  install -d -m 755 -o deploy -g deploy "/srv/rayhab/$env" "/srv/rayhab/$env/site" "/srv/rayhab/$env/site/releases"
  if [ ! -f "/srv/rayhab/$env/app.env" ]; then
    install -m 600 -o deploy -g deploy "$REPO_DIR/infra/env.example" "/srv/rayhab/$env/app.env"
    echo "Fill in /srv/rayhab/$env/app.env (runbook step 8)."
  fi
done
install -d -m 755 -o deploy -g deploy /srv/rayhab/bin
install -m 755 -o deploy -g deploy "$REPO_DIR/infra/scripts/deploy.sh" /srv/rayhab/bin/deploy.sh
install -m 644 -o deploy -g deploy "$REPO_DIR/infra/compose.yaml" /srv/rayhab/bin/compose.yaml
install -d -m 755 /var/www/letsencrypt

step "Certificates (HTTP challenge on a temporary site)"
names=(-d "$DOMAIN" -d "www.$DOMAIN")
need_cert() { [ ! -f "/etc/letsencrypt/live/$1/fullchain.pem" ]; }
if need_cert "$DOMAIN" || { [ "$WITH_STAGING" = 1 ] && need_cert "$STAGING"; }; then
  cat > /etc/nginx/sites-available/rayhab-acme <<EOF
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;
    location /.well-known/acme-challenge/ { root /var/www/letsencrypt; }
    location / { return 404; }
}
EOF
  rm -f /etc/nginx/sites-enabled/default
  ln -sf /etc/nginx/sites-available/rayhab-acme /etc/nginx/sites-enabled/rayhab-acme
  nginx -t && systemctl reload nginx
  need_cert "$DOMAIN" && certbot certonly --webroot -w /var/www/letsencrypt "${names[@]}" \
    --email "$ADMIN_EMAIL" --agree-tos --no-eff-email --non-interactive
  if [ "$WITH_STAGING" = 1 ] && need_cert "$STAGING"; then
    certbot certonly --webroot -w /var/www/letsencrypt -d "$STAGING" \
      --email "$ADMIN_EMAIL" --agree-tos --no-eff-email --non-interactive
  fi
  rm -f /etc/nginx/sites-enabled/rayhab-acme
fi
# Renewal reloads Nginx so it picks up the new certificate.
install -d /etc/letsencrypt/renewal-hooks/deploy
printf '#!/bin/sh\nsystemctl reload nginx\n' > /etc/letsencrypt/renewal-hooks/deploy/reload-nginx
chmod 755 /etc/letsencrypt/renewal-hooks/deploy/reload-nginx

step "Nginx sites"
install -d /etc/nginx/snippets
install -m 644 "$REPO_DIR"/infra/nginx/snippets/*.conf /etc/nginx/snippets/
install -m 644 "$REPO_DIR/infra/nginx/dr-rayhab.com.conf" /etc/nginx/sites-available/dr-rayhab.com
ln -sf /etc/nginx/sites-available/dr-rayhab.com /etc/nginx/sites-enabled/dr-rayhab.com
if [ "$WITH_STAGING" = 1 ]; then
  install -m 644 "$REPO_DIR/infra/nginx/staging.dr-rayhab.com.conf" /etc/nginx/sites-available/staging.dr-rayhab.com
  ln -sf /etc/nginx/sites-available/staging.dr-rayhab.com /etc/nginx/sites-enabled/staging.dr-rayhab.com
  if [ ! -f /etc/nginx/rayhab-staging.htpasswd ]; then
    echo "Choose the staging password (user: rayhab):"
    htpasswd -c /etc/nginx/rayhab-staging.htpasswd rayhab
  fi
fi
# Until the first deploy there is no site; a placeholder keeps Nginx happy.
for env in production staging; do
  if [ ! -e "/srv/rayhab/$env/site/current" ]; then
    install -d -o deploy -g deploy "/srv/rayhab/$env/site/releases/placeholder"
    echo '<!doctype html><title>Rayhab</title><p>Coming soon.</p>' > "/srv/rayhab/$env/site/releases/placeholder/index.html"
    echo '<!doctype html><title>Not found</title><p>Not found.</p>' > "/srv/rayhab/$env/site/releases/placeholder/404.html"
    ln -sfn "/srv/rayhab/$env/site/releases/placeholder" "/srv/rayhab/$env/site/current"
  fi
done
nginx -t
systemctl reload nginx

step "Done"
cat <<EOF
Next (docs/production-runbook.md):
  - step 8: fill in /srv/rayhab/production/app.env (and staging), mode 600
  - step 9: add the CI deploy key to /home/deploy/.ssh/authorized_keys
  - step 10: run the "Deploy" workflow in GitHub
EOF
