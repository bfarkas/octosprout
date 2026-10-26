#!/usr/bin/env bash
# Starts the octosprout-server image against a throwaway bare repository and
# checks that it serves, authenticates and commits a capture.
#
#   deploy/smoke-test.sh [image]      (default: octosprout-server:ci)
#
# Needs docker, git and curl. Used by CI after building the image.
set -euo pipefail

IMAGE="${1:-octosprout-server:ci}"
NAME="octosprout-smoke-$$"
PORT="${SMOKE_PORT:-18080}"
BASE="http://127.0.0.1:${PORT}"
WORK="$(mktemp -d)"

cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then
    echo "--- container logs ---"
    docker logs "$NAME" 2>&1 | tail -n 50 || true
  fi
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  rm -rf "$WORK"
  exit "$status"
}
trap cleanup EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

# A bare repository standing in for GitHub, writable by the container's user.
git init -q --bare -b main "$WORK/remote.git"
git clone -q "$WORK/remote.git" "$WORK/seed" 2>/dev/null
git -C "$WORK/seed" -c user.name=ci -c user.email=ci@example.com commit -q --allow-empty -m "first commit"
git -C "$WORK/seed" push -q origin HEAD:main
chmod -R a+rwX "$WORK/remote.git"

docker run -d --name "$NAME" -p "127.0.0.1:${PORT}:8080" \
  -v "$WORK/remote.git:/remote.git" \
  -e OCTOSPROUT_REMOTE_URL=/remote.git \
  -e OCTOSPROUT_RP_ID=localhost \
  -e "OCTOSPROUT_ORIGIN=http://localhost:${PORT}" \
  "$IMAGE" >/dev/null

for _ in $(seq 1 60); do
  if curl -fsS "$BASE/healthz" >/dev/null 2>&1; then break; fi
  sleep 1
done
curl -fsS "$BASE/healthz" | grep -q '"ok"' || fail "health check did not come up"
echo "ok  /healthz"

TOKEN="$(docker exec "$NAME" node /opt/octosprout/app/packages/server/dist/main.js token create smoke 2>/dev/null)"
case "$TOKEN" in ost_*) ;; *) fail "token create printed '$TOKEN'" ;; esac
echo "ok  token create (CLI in the running container)"

capture() {
  curl -sS -o "$WORK/body" -w '%{http_code}' -X POST "$BASE/api/v1/inbox" \
    -H "Authorization: Bearer $1" -H 'Content-Type: application/json; charset=utf-8' \
    -d '{"text":"smoke test capture","idempotency_key":"smoke-test-0001","source":"cli"}'
}

code="$(capture "$TOKEN")"
[ "$code" = 201 ] || fail "capture answered $code: $(cat "$WORK/body")"
grep -q '"status":"committed"' "$WORK/body" || fail "capture not committed: $(cat "$WORK/body")"
git -C "$WORK/remote.git" log -1 --format=%s main | grep -q '^capture: OS-C-' || fail "no capture commit on the remote"
echo "ok  capture committed and pushed (201)"

code="$(capture "$TOKEN")"
[ "$code" = 200 ] || fail "replay answered $code"
echo "ok  replay (200)"

code="$(capture ost_wrong)"
[ "$code" = 401 ] || fail "a wrong token answered $code"
code="$(curl -sS -o /dev/null -w '%{http_code}' -H 'Accept: text/html' "$BASE/")"
[ "$code" = 401 ] || fail "anonymous / answered $code"
code="$(curl -sS -o /dev/null -w '%{http_code}' "$BASE/static/icon-180.png")"
[ "$code" = 200 ] || fail "icon answered $code"
echo "ok  401 without credentials; static assets served"

echo "Image smoke test passed."
