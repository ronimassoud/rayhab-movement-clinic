#!/usr/bin/env bash
# Release one version to one environment. Run on the server as "deploy",
# by the Deploy workflow over SSH (or by hand):
#
#   deploy.sh <production|staging> <image> <site-tarball>
#
#   image         e.g. ghcr.io/ronimassoud/rayhab-server:3f2a9c1e
#   site-tarball  the built site/ from CI, already copied to the server
#
# Order, so that a failure leaves the running version untouched:
#   1. pull the new image
#   2. unpack the site into a new release directory (not live yet)
#   3. run database migrations (backward compatible by rule: the old API
#      keeps working on the new schema)
#   4. start the new API and worker
#   5. check /api/health; if it fails, put the previous image back
#   6. switch the site to the new release; keep the last five
#
# DRY_RUN=1 prints what it would do without doing it.
set -euo pipefail

ENV_NAME="${1:?environment: production or staging}"
IMAGE="${2:?image, e.g. ghcr.io/owner/rayhab-server:tag}"
TARBALL="${3:?site tarball path}"
case "$ENV_NAME" in production) PORT=3000 ;; staging) PORT=3001 ;; *) echo "unknown environment $ENV_NAME" >&2; exit 2 ;; esac

BASE="/srv/rayhab/$ENV_NAME"
BIN="/srv/rayhab/bin"
APP_ENV="$BASE/app.env"
COMPOSE_ENV="$BASE/compose.env"
RELEASE="$(date -u +%Y%m%d%H%M%S)"
DRY="${DRY_RUN:-0}"

run() { if [ "$DRY" = 1 ]; then printf 'would run: %s\n' "$*"; else "$@"; fi; }
compose() { run docker compose -p "rayhab-$ENV_NAME" --env-file "$COMPOSE_ENV" -f "$BIN/compose.yaml" "$@"; }
say() { printf '[deploy %s] %s\n' "$ENV_NAME" "$*"; }

[ -f "$APP_ENV" ] || { echo "Missing $APP_ENV (runbook step 8)." >&2; exit 1; }
[ "$(stat -c %a "$APP_ENV")" = 600 ] || { echo "$APP_ENV must be mode 600." >&2; exit 1; }
[ -f "$TARBALL" ] || { echo "Missing site tarball $TARBALL." >&2; exit 1; }

PREVIOUS_IMAGE=""
if [ -f "$COMPOSE_ENV" ]; then PREVIOUS_IMAGE="$(sed -n 's/^IMAGE=//p' "$COMPOSE_ENV")"; fi

say "pulling $IMAGE"
if [ -n "${GHCR_TOKEN:-}" ]; then
  if [ "$DRY" = 1 ]; then echo "would run: docker login ghcr.io"; else
    printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u "${GHCR_USER:-deploy}" --password-stdin >/dev/null
  fi
fi
run docker pull "$IMAGE"

say "unpacking the site into release $RELEASE"
run install -d "$BASE/site/releases/$RELEASE"
run tar -xzf "$TARBALL" -C "$BASE/site/releases/$RELEASE"
if [ "$DRY" != 1 ] && [ ! -f "$BASE/site/releases/$RELEASE/index.html" ]; then
  echo "The tarball has no index.html at its root." >&2; exit 1
fi

write_compose_env() {
  if [ "$DRY" = 1 ]; then echo "would write $COMPOSE_ENV with IMAGE=$1"; return; fi
  umask 077
  printf 'IMAGE=%s\nAPI_PORT=%s\nAPP_ENV_FILE=%s\n' "$1" "$PORT" "$APP_ENV" > "$COMPOSE_ENV"
}

say "migrating the database"
# With the schema owner's connection from migrate.env, which only this
# one-off container sees; the running API connects as rayhab_app.
MIGRATE_ENV="$BASE/migrate.env"
[ -f "$MIGRATE_ENV" ] || { echo "Missing $MIGRATE_ENV (runbook step 8)." >&2; exit 1; }
run docker run --rm --network host --read-only --env-file "$MIGRATE_ENV" "$IMAGE" node dist/migrate.js
write_compose_env "$IMAGE"

say "starting the new version"
compose up -d --remove-orphans

healthy() {
  [ "$DRY" = 1 ] && return 0
  for _ in $(seq 1 30); do
    if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  return 1
}

if ! healthy; then
  say "health check failed"
  if [ -n "$PREVIOUS_IMAGE" ]; then
    say "rolling back to $PREVIOUS_IMAGE (the site stays on the previous release)"
    write_compose_env "$PREVIOUS_IMAGE"
    compose up -d --remove-orphans
  fi
  run rm -rf "$BASE/site/releases/$RELEASE"
  exit 1
fi

say "switching the site to release $RELEASE"
run ln -sfn "$BASE/site/releases/$RELEASE" "$BASE/site/current.new"
run mv -Tf "$BASE/site/current.new" "$BASE/site/current"

say "keeping the last five releases"
if [ "$DRY" != 1 ]; then
  find "$BASE/site/releases" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort -r | tail -n +6 |
    while read -r old; do [ "$old" = placeholder ] || rm -rf "${BASE:?}/site/releases/$old"; done
  rm -f "$TARBALL"
  docker image prune -f >/dev/null
fi
say "done: $IMAGE, site release $RELEASE"
