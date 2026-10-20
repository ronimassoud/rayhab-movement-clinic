#!/usr/bin/env bash
# Put the Supabase and Resend settings onto the server. Run on YOUR computer
# (Git Bash on Windows, or a Mac or Linux terminal), from the repository:
#
#   bash infra/scripts/push-settings.sh production you@dr-rayhab.com
#   bash infra/scripts/push-settings.sh staging    you@dr-rayhab.com
#
# It reads infra/connect.<env>.env (see infra/connect.example.env), and on the
# server, with sudo (it asks for your password there):
#   - merges those values into /srv/rayhab/<env>/app.env, keeping anything
#     else already set there (a WhatsApp token, policy text);
#   - writes /srv/rayhab/<env>/migrate.env;
#   - writes /etc/msmtprc for Resend's SMTP.
# Owners and modes are set so only the web server, the worker and the deploy
# can read them. Nothing is printed, and nothing secret goes on a command line.
set -euo pipefail

ENV_NAME="${1:?environment: production or staging}"
TARGET="${2:?your admin login on the server, e.g. you@dr-rayhab.com}"
case "$ENV_NAME" in production|staging) ;; *) echo "unknown environment $ENV_NAME" >&2; exit 2 ;; esac
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC="$HERE/infra/connect.$ENV_NAME.env"
[ -f "$SRC" ] || { echo "Fill in $SRC first (copy infra/connect.example.env)." >&2; exit 1; }

val() { sed -n "s/^$1=//p" "$SRC" | tail -n 1; }
for k in SUPABASE_URL SUPABASE_ANON_KEY DATABASE_URL DATABASE_MIGRATE_URL RESEND_API_KEY EMAIL_FROM STAFF_EMAILS PUBLIC_ORIGIN; do
  [ -n "$(val "$k")" ] || { echo "$k is empty in $SRC." >&2; exit 1; }
done
case "$(val SUPABASE_URL)" in https://*.supabase.co) ;; *) echo "SUPABASE_URL should look like https://<ref>.supabase.co" >&2; exit 1 ;; esac
for k in DATABASE_URL DATABASE_MIGRATE_URL; do
  case "$(val "$k")" in postgres://*|postgresql://*) ;; *) echo "$k should start with postgres://" >&2; exit 1 ;; esac
done
case "$(val DATABASE_URL)" in *rayhab_app*) ;; *) echo "DATABASE_URL should sign in as rayhab_app (infra/supabase/setup.sql), not postgres." >&2; exit 1 ;; esac
case "$(val RESEND_API_KEY)" in re_*) ;; *) echo "RESEND_API_KEY should start with re_" >&2; exit 1 ;; esac
case "$(val BACKUP_RECIPIENT)" in ''|age1*) ;; *) echo "BACKUP_RECIPIENT should be an age public key (age1...)" >&2; exit 1 ;; esac
[ -n "$(val BACKUP_RECIPIENT)" ] || echo "Note: BACKUP_RECIPIENT is empty, so nightly backups stay unencrypted (runbook step 5.8)."

# APP_SECRET: made once, then kept in your file so later runs reuse it.
if [ -z "$(val APP_SECRET)" ]; then
  secret="$(openssl rand -base64 48 | tr -d '\n/+=')"
  if grep -q '^APP_SECRET=' "$SRC"; then
    sed -i.bak "s|^APP_SECRET=.*|APP_SECRET=$secret|" "$SRC" && rm -f "$SRC.bak"
  else
    printf 'APP_SECRET=%s\n' "$secret" >> "$SRC"
  fi
  echo "Generated APP_SECRET and saved it in $SRC."
fi

umask 077
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

whish=disabled
[ "$ENV_NAME" = staging ] && whish=sandbox
{
  echo "DEPLOY_ENV=$ENV_NAME"
  echo "PUBLIC_ORIGIN=$(val PUBLIC_ORIGIN)"
  echo "APP_SECRET=$(val APP_SECRET)"
  echo "DATABASE_URL=$(val DATABASE_URL)"
  echo "AUTH_DRIVER=supabase"
  echo "SUPABASE_URL=$(val SUPABASE_URL)"
  echo "SUPABASE_ANON_KEY=$(val SUPABASE_ANON_KEY)"
  echo "EMAIL_DRIVER=mail"
  echo "EMAIL_FROM=$(val EMAIL_FROM)"
  echo "STAFF_EMAILS=$(val STAFF_EMAILS)"
  echo "WHISH_DRIVER=$whish"
} > "$WORK/app.patch"
{
  echo "DATABASE_MIGRATE_URL=$(val DATABASE_MIGRATE_URL)"
  [ -z "$(val BACKUP_RECIPIENT)" ] || echo "BACKUP_RECIPIENT=$(val BACKUP_RECIPIENT)"
} > "$WORK/migrate.env"

from_addr="$(val EMAIL_FROM | sed -n 's/.*<\(.*\)>.*/\1/p')"
[ -n "$from_addr" ] || from_addr="$(val EMAIL_FROM)"
cat > "$WORK/msmtprc" <<EOF
# Outgoing mail for the Rayhab API, through Resend's SMTP.
# Written by infra/scripts/push-settings.sh.
defaults
auth           on
tls            on
tls_starttls   on
tls_trust_file /etc/ssl/certs/ca-certificates.crt
logfile        /var/log/rayhab/msmtp.log

account        rayhab
host           smtp.resend.com
port           587
from           $from_addr
user           resend
password       $(val RESEND_API_KEY)

account default : rayhab
EOF

# Runs on the server as root: merge, install, clean up.
cat > "$WORK/apply.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
ENV_NAME="$1"; D="$2"; T="/srv/rayhab/$ENV_NAME"
[ -d "$T" ] || { echo "$T does not exist: run infra/scripts/provision.sh first." >&2; exit 1; }
tmp="$(mktemp)"
if [ -f "$T/app.env" ]; then cat "$T/app.env" > "$tmp"; fi
while IFS= read -r line; do
  [ -n "$line" ] || continue
  K="${line%%=*}"
  if grep -q "^$K=" "$tmp"; then
    K="$K" L="$line" awk -F= '$1 == ENVIRON["K"] { print ENVIRON["L"]; next } { print }' "$tmp" > "$tmp.n" && mv "$tmp.n" "$tmp"
  else
    printf '%s\n' "$line" >> "$tmp"
  fi
done < "$D/app.patch"
install -m 640 -o deploy -g www-data "$tmp" "$T/app.env"
install -m 600 -o deploy -g deploy "$D/migrate.env" "$T/migrate.env"
install -m 640 -o root -g www-data "$D/msmtprc" /etc/msmtprc
rm -rf "$D" "$tmp"
echo "Installed: $T/app.env (640), $T/migrate.env (600), /etc/msmtprc (640)."
EOF

# A fresh private folder on the server (mktemp makes it 700, owned by you).
REMOTE="$(ssh "$TARGET" 'mktemp -d /tmp/rayhab-settings.XXXXXX')"
case "$REMOTE" in /tmp/rayhab-settings.*) ;; *) echo "Could not make a folder on the server." >&2; exit 1 ;; esac
scp -q "$WORK/app.patch" "$WORK/migrate.env" "$WORK/msmtprc" "$WORK/apply.sh" "$TARGET:$REMOTE/"
# The paths are meant to expand here, on your computer.
# shellcheck disable=SC2029
ssh -t "$TARGET" "sudo bash '$REMOTE/apply.sh' '$ENV_NAME' '$REMOTE'"
echo "Next: deploy (runbook step 10), then run the doctor on the server (step 8.4)."
