#!/usr/bin/env bash
# Nightly database backup, for while Supabase is on the Free plan (which
# keeps no backups of its own). Run by cron as "deploy" (infra/cron/rayhab):
#
#   backup.sh <production|staging>
#
# Dumps the rayhab schema with the schema owner's connection (migrate.env)
# into /srv/rayhab/backups/<env>/, compressed, readable only by deploy, and
# keeps the last 14. Copy them off the server now and then (runbook step 12).
#
# With BACKUP_RECIPIENT in migrate.env (an age public key, age1...), each dump
# is encrypted to it: the server can write backups but not read them back,
# and only the private key, kept off the server, opens them. Without it the
# dump is written unencrypted and the log says so.
# Once Supabase is on Pro, its daily backups take over and this can stay or go.
set -euo pipefail

ENV_NAME="${1:?environment: production or staging}"
BASE="/srv/rayhab/$ENV_NAME"
DIR="/srv/rayhab/backups/$ENV_NAME"
KEEP="${KEEP:-14}"

[ -f "$BASE/migrate.env" ] || { echo "Missing $BASE/migrate.env" >&2; exit 1; }
umask 077
install -d -m 700 "$DIR"

# The URL comes from migrate.env and reaches pg_dump as libpq's PG* variables,
# not on the command line, so the password never shows in a process list.
set -a
# shellcheck source=/dev/null
. "$BASE/migrate.env"
set +a
eval "$(python3 - <<'PY'
import os, shlex
from urllib.parse import urlparse, unquote, parse_qs
u = urlparse(os.environ["DATABASE_MIGRATE_URL"])
q = parse_qs(u.query)
for k, v in (("PGHOST", u.hostname), ("PGPORT", str(u.port or 5432)), ("PGUSER", unquote(u.username or "")),
             ("PGPASSWORD", unquote(u.password or "")), ("PGDATABASE", (u.path or "/postgres")[1:] or "postgres"),
             ("PGSSLMODE", q.get("sslmode", ["require"])[0])):
    print("export %s=%s" % (k, shlex.quote(v)))
PY
)"
unset DATABASE_MIGRATE_URL
RECIPIENT="${BACKUP_RECIPIENT:-}"
unset BACKUP_RECIPIENT
OUT="$DIR/rayhab-$ENV_NAME-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
if [ -n "$RECIPIENT" ]; then
  case "$RECIPIENT" in age1*) ;; *) echo "BACKUP_RECIPIENT should be an age public key (age1...)" >&2; exit 1 ;; esac
  OUT="$OUT.age"
  pg_dump --schema=rayhab --no-owner --no-privileges | gzip -9 | age -r "$RECIPIENT" > "$OUT.part"
  note="encrypted"
else
  pg_dump --schema=rayhab --no-owner --no-privileges | gzip -9 > "$OUT.part"
  note="NOT encrypted: set BACKUP_RECIPIENT (runbook step 5.8)"
fi
mv "$OUT.part" "$OUT"

# Encrypted and plain dumps count together, newest first.
find "$DIR" -maxdepth 1 -name 'rayhab-*.sql.gz*' ! -name '*.part' -printf '%f\n' | sort -r | tail -n +"$((KEEP + 1))" |
  while read -r old; do rm -f "${DIR:?}/$old"; done
echo "$(date -u +%FT%TZ) backup $OUT ($(du -h "$OUT" | cut -f1), $note)"
