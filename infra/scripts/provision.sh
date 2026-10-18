#!/usr/bin/env bash
# Prepare a fresh Ubuntu Server 26.04 LTS for dr-rayhab.com. Run once, as
# root, from a checkout of this repository (docs/production-runbook.md, step 4):
#
#   sudo ADMIN_EMAIL=you@example.com bash infra/scripts/provision.sh
#
# Safe to run again: every step checks before it changes anything.
#
# What it sets up:
#   - updates, automatic security updates, a firewall (22, 80, 443),
#     fail2ban, SSH keys only (no passwords, no root login);
#   - Apache 2 (event MPM, HTTP/2, TLS) with PHP-FPM and the API's PHP
#     extensions; certbot; msmtp for outgoing mail;
#   - a "deploy" user that CI connects as;
#   - /srv/rayhab/{production,staging} for releases and settings;
#   - Let's Encrypt certificates for dr-rayhab.com, www and staging;
#   - the Apache sites, the PHP settings and the cron worker from infra/.
set -euo pipefail

DOMAIN="${DOMAIN:-dr-rayhab.com}"
STAGING="${STAGING:-staging.$DOMAIN}"
ADMIN_EMAIL="${ADMIN_EMAIL:?set ADMIN_EMAIL, for certificate expiry notices}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WITH_STAGING="${WITH_STAGING:-1}"

[ "$(id -u)" -eq 0 ] || { echo "Run as root (sudo)." >&2; exit 1; }
# shellcheck source=/dev/null
. /etc/os-release
[ "${ID:-}" = "ubuntu" ] || echo "Warning: written for Ubuntu 26.04; this is ${PRETTY_NAME:-unknown}." >&2

step() { printf '\n== %s\n' "$*"; }

step "System packages and automatic security updates"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y
apt-get install -y ca-certificates curl ufw fail2ban unattended-upgrades rsync \
  apache2 apache2-utils certbot \
  php-fpm php-cli php-pgsql php-curl php-mbstring \
  msmtp msmtp-mta postgresql-client
dpkg-reconfigure -f noninteractive unattended-upgrades

PHPV="$(php -r 'echo PHP_MAJOR_VERSION.".".PHP_MINOR_VERSION;')"
FPM="php${PHPV}-fpm"
echo "PHP $PHPV ($FPM)"

step "Firewall: SSH, HTTP and HTTPS only"
ufw allow OpenSSH
ufw allow 'Apache Full'
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

step "Apache: event MPM, PHP-FPM, TLS, HTTP/2"
a2dismod -q "php${PHPV}" mpm_prefork >/dev/null 2>&1 || true
a2enmod -q mpm_event proxy_fcgi setenvif rewrite headers ssl http2 macro deflate alias auth_basic authn_file
a2enconf -q "$FPM"
a2dissite -q 000-default >/dev/null 2>&1 || true

step "PHP settings"
for sapi in fpm cli; do
  install -m 644 "$REPO_DIR/infra/php/99-rayhab.ini" "/etc/php/$PHPV/$sapi/conf.d/99-rayhab.ini"
done
systemctl enable --now "$FPM"
systemctl restart "$FPM"

step "The deploy user (CI connects as this user)"
if ! id deploy >/dev/null 2>&1; then
  adduser --disabled-password --gecos "Rayhab deploy" deploy
fi
usermod -aG www-data deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
touch /home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys
# A deploy reloads PHP-FPM (new code, fresh opcache), and nothing else as root.
echo "deploy ALL=(root) NOPASSWD: /usr/bin/systemctl reload $FPM" > /etc/sudoers.d/rayhab-deploy
chmod 440 /etc/sudoers.d/rayhab-deploy
visudo -cf /etc/sudoers.d/rayhab-deploy

step "Directories and settings files"
install -d -m 755 -o deploy -g deploy /srv/rayhab /srv/rayhab/bin
for env in production staging; do
  for d in "" /site /site/releases /api /api/releases; do install -d -m 755 -o deploy -g deploy "/srv/rayhab/$env$d"; done
  if [ ! -f "/srv/rayhab/$env/app.env" ]; then
    install -m 640 -o deploy -g www-data "$REPO_DIR/infra/env.example" "/srv/rayhab/$env/app.env"
    echo "Fill in /srv/rayhab/$env/app.env (runbook step 8)."
  fi
done
install -m 755 -o deploy -g deploy "$REPO_DIR/infra/scripts/deploy.sh" /srv/rayhab/bin/deploy.sh
install -m 755 -o deploy -g deploy "$REPO_DIR/infra/scripts/backup.sh" /srv/rayhab/bin/backup.sh
install -d -m 700 -o deploy -g deploy /srv/rayhab/backups
echo "$FPM" > /srv/rayhab/bin/fpm-service
install -d -m 775 -o www-data -g www-data /var/log/rayhab
touch /var/log/rayhab/backup.log && chown deploy:deploy /var/log/rayhab/backup.log
cat > /etc/logrotate.d/rayhab <<'EOF'
/var/log/rayhab/*.log {
    weekly
    rotate 8
    compress
    missingok
    notifempty
    copytruncate
}
EOF

step "Outgoing mail (msmtp)"
if [ ! -f /etc/msmtprc ]; then
  cat > /etc/msmtprc <<'EOF'
# Outgoing mail for the Rayhab API, through Resend's SMTP (runbook step 6.0).
# Replace the password with a Resend API key (sending access only).
defaults
auth           on
tls            on
tls_starttls   on
tls_trust_file /etc/ssl/certs/ca-certificates.crt
logfile        /var/log/rayhab/msmtp.log

account        rayhab
host           smtp.resend.com
port           587
from           bookings@dr-rayhab.com
user           resend
password       REPLACE-WITH-RESEND-API-KEY

account default : rayhab
EOF
fi
chown root:www-data /etc/msmtprc
chmod 640 /etc/msmtprc

step "Certificates (HTTP challenge on a temporary site)"
install -d -m 755 /var/www/letsencrypt
need_cert() { [ ! -f "/etc/letsencrypt/live/$1/fullchain.pem" ]; }
if need_cert "$DOMAIN" || { [ "$WITH_STAGING" = 1 ] && need_cert "$STAGING"; }; then
  cat > /etc/apache2/sites-available/rayhab-acme.conf <<'EOF'
<VirtualHost *:80>
    ServerName localhost
    DocumentRoot /var/www/letsencrypt
    <Directory /var/www/letsencrypt>
        Require all granted
    </Directory>
</VirtualHost>
EOF
  a2ensite -q rayhab-acme
  apache2ctl configtest && systemctl reload apache2
  if need_cert "$DOMAIN"; then
    certbot certonly --webroot -w /var/www/letsencrypt -d "$DOMAIN" -d "www.$DOMAIN" \
      --email "$ADMIN_EMAIL" --agree-tos --no-eff-email --non-interactive
  fi
  if [ "$WITH_STAGING" = 1 ] && need_cert "$STAGING"; then
    certbot certonly --webroot -w /var/www/letsencrypt -d "$STAGING" \
      --email "$ADMIN_EMAIL" --agree-tos --no-eff-email --non-interactive
  fi
  a2dissite -q rayhab-acme
fi
# Renewal reloads Apache so it serves the new certificate.
install -d /etc/letsencrypt/renewal-hooks/deploy
printf '#!/bin/sh\nsystemctl reload apache2\n' > /etc/letsencrypt/renewal-hooks/deploy/reload-apache
chmod 755 /etc/letsencrypt/renewal-hooks/deploy/reload-apache

step "Apache sites"
install -m 644 "$REPO_DIR/infra/apache/rayhab.conf" /etc/apache2/conf-available/rayhab.conf
# The PHP-FPM socket for this PHP version, if the generic link is missing.
if [ ! -S /run/php/php-fpm.sock ]; then
  sed -i "s#/run/php/php-fpm.sock#/run/php/php${PHPV}-fpm.sock#" /etc/apache2/conf-available/rayhab.conf
fi
a2enconf -q rayhab
install -m 644 "$REPO_DIR/infra/apache/dr-rayhab.com.conf" /etc/apache2/sites-available/dr-rayhab.com.conf
a2ensite -q dr-rayhab.com
if [ "$WITH_STAGING" = 1 ]; then
  install -m 644 "$REPO_DIR/infra/apache/staging.dr-rayhab.com.conf" /etc/apache2/sites-available/staging.dr-rayhab.com.conf
  a2ensite -q staging.dr-rayhab.com
  if [ ! -f /etc/apache2/rayhab-staging.htpasswd ]; then
    echo "Choose the staging password (user: rayhab):"
    htpasswd -c /etc/apache2/rayhab-staging.htpasswd rayhab
  fi
fi
# Until the first deploy there is no site; a placeholder keeps Apache happy.
for env in production staging; do
  if [ ! -e "/srv/rayhab/$env/site/current" ]; then
    p="/srv/rayhab/$env/site/releases/placeholder"
    install -d -o deploy -g deploy "$p"
    echo '<!doctype html><title>Rayhab</title><p>Coming soon.</p>' > "$p/index.html"
    echo '<!doctype html><title>Not found</title><p>Not found.</p>' > "$p/404.html"
    ln -sfn "$p" "/srv/rayhab/$env/site/current"
  fi
done
apache2ctl configtest
systemctl reload apache2

step "The worker (cron)"
install -m 644 "$REPO_DIR/infra/cron/rayhab" /etc/cron.d/rayhab

step "Done"
cat <<EOF
Next (docs/production-runbook.md):
  - step 6: put the SMTP account into /etc/msmtprc
  - step 8: fill in /srv/rayhab/production/app.env (and staging) and migrate.env
  - step 9: add the CI deploy key to /home/deploy/.ssh/authorized_keys
  - step 10: run the "Deploy to the server" workflow in GitHub
EOF
