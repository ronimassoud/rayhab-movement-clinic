#!/usr/bin/env bash
# Release one version to one environment. Run on the server as "deploy",
# by the Deploy workflow over SSH (or by hand):
#
#   deploy.sh <production|staging> <site-tarball> <api-tarball>
#
# Order, so that a failure leaves the running version in place:
#   1. unpack the site and the API into new release folders (not live yet)
#   2. run database migrations (backward compatible by rule: the running API
#      keeps working on the new schema)
#   3. switch the API to the new release and reload PHP-FPM
#   4. check /api/health; if it fails, switch the API back
#   5. switch the site to the new release; keep the last five of each
#
# DRY_RUN=1 prints what it would do without doing it.
set -euo pipefail

ENV_NAME="${1:?environment: production or staging}"
SITE_TGZ="${2:?site tarball}"
API_TGZ="${3:?api tarball}"
case "$ENV_NAME" in
  production) HOST="${RAYHAB_HOST:-dr-rayhab.com}" ;;
  staging) HOST="${RAYHAB_HOST:-staging.dr-rayhab.com}" ;;
  *) echo "unknown environment $ENV_NAME" >&2; exit 2 ;;
esac

BASE="/srv/rayhab/$ENV_NAME"
RELEASE="$(date -u +%Y%m%d%H%M%S)"
DRY="${DRY_RUN:-0}"
FPM="$(cat /srv/rayhab/bin/fpm-service 2>/dev/null || echo php-fpm)"

run() { if [ "$DRY" = 1 ]; then printf 'would run: %s\n' "$*"; else "$@"; fi; }
say() { printf '[deploy %s] %s\n' "$ENV_NAME" "$*"; }

for f in "$BASE/app.env" "$BASE/migrate.env" "$SITE_TGZ" "$API_TGZ"; do
  [ -f "$f" ] || { echo "Missing $f (runbook step 8)." >&2; exit 1; }
done
[ "$(stat -c %a "$BASE/migrate.env")" = 600 ] || { echo "$BASE/migrate.env must be mode 600." >&2; exit 1; }

PREVIOUS_API="$(readlink "$BASE/api/current" 2>/dev/null || true)"

say "unpacking release $RELEASE"
run install -d "$BASE/site/releases/$RELEASE" "$BASE/api/releases/$RELEASE"
run tar -xzf "$SITE_TGZ" -C "$BASE/site/releases/$RELEASE"
run tar -xzf "$API_TGZ" -C "$BASE/api/releases/$RELEASE"
if [ "$DRY" != 1 ]; then
  [ -f "$BASE/site/releases/$RELEASE/index.html" ] || { echo "The site tarball has no index.html at its root." >&2; exit 1; }
  [ -f "$BASE/api/releases/$RELEASE/public/index.php" ] || { echo "The API tarball has no public/index.php." >&2; exit 1; }
fi

say "migrating the database"
# The schema owner's connection, from migrate.env, for this one command only;
# the running API connects as rayhab_app.
if [ "$DRY" = 1 ]; then echo "would run: php $BASE/api/releases/$RELEASE/bin/migrate.php (with migrate.env)"; else
  ( set -a; . "$BASE/migrate.env"; set +a; php "$BASE/api/releases/$RELEASE/bin/migrate.php" )
fi

switch_api() {
  run ln -sfn "$1" "$BASE/api/current.new"
  run mv -Tf "$BASE/api/current.new" "$BASE/api/current"
  run sudo /usr/bin/systemctl reload "$FPM"
}

say "switching the API to release $RELEASE"
switch_api "$BASE/api/releases/$RELEASE"

healthy() {
  [ "$DRY" = 1 ] && return 0
  for _ in $(seq 1 15); do
    if curl -fsS --resolve "$HOST:443:127.0.0.1" "https://$HOST/api/health" >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  return 1
}

if ! healthy; then
  say "health check failed"
  if [ -n "$PREVIOUS_API" ]; then
    say "putting the previous API back ($PREVIOUS_API); the site stays as it was"
    switch_api "$PREVIOUS_API"
  fi
  run rm -rf "$BASE/site/releases/$RELEASE" "$BASE/api/releases/$RELEASE"
  exit 1
fi

say "switching the site to release $RELEASE"
run ln -sfn "$BASE/site/releases/$RELEASE" "$BASE/site/current.new"
run mv -Tf "$BASE/site/current.new" "$BASE/site/current"

say "keeping the last five releases"
if [ "$DRY" != 1 ]; then
  for kind in site api; do
    find "$BASE/$kind/releases" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort -r | tail -n +6 |
      while read -r old; do [ "$old" = placeholder ] || rm -rf "${BASE:?}/$kind/releases/$old"; done
  done
  rm -f "$SITE_TGZ" "$API_TGZ"
fi
say "done: release $RELEASE"
