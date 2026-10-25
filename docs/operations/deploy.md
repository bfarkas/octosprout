# Deploying octosprout-server to rei3

Covers the inbox service as built so far (spec §18.1). Passkey login, the web
UI and approvals are not deployed yet.

## 1. DNS and Caddy

1. Point `app.octosprout.de` at rei3 (A/AAAA record).
2. Add the site block from [`deploy/Caddyfile.example`](../../deploy/Caddyfile.example)
   to Caddy's configuration and reload Caddy. It obtains the Let's Encrypt
   certificate automatically and enforces the 512 KiB body limit.

## 2. Deploy key

The server pushes to `octosprout-private` with an SSH deploy key that has
write access to that one repository.

```sh
ssh-keygen -t ed25519 -N '' -C octosprout-server -f deploy_key
```

1. On GitHub, open `octosprout-private` → Settings → Deploy keys → Add deploy
   key. Paste `deploy_key.pub` and tick **Allow write access**.
2. Move the private key to `/etc/octosprout/secrets/deploy_key` on rei3
   (`chmod 600`, owned by root) and delete the local copy.

The container copies the key to its state directory with mode 0600 at start,
and pins GitHub's host key on first use.

## 3. Build and start

```sh
docker build -f deploy/Dockerfile -t octosprout-server:latest .
cp deploy/compose.example.yaml /srv/octosprout/compose.yaml
docker compose -f /srv/octosprout/compose.yaml up -d
docker compose -f /srv/octosprout/compose.yaml logs -f octosprout
```

On first start the server clones `octosprout-private` into the `octosprout-repo`
volume. The log line `workspace ready` reports the head commit and the number
of unpushed commits.

## 4. Create an inbox token

```sh
docker compose -f /srv/octosprout/compose.yaml exec octosprout \
  node /opt/octosprout/app/packages/server/dist/main.js token create iphone-shortcut
```

The token is printed once; only its hash is stored (in the state volume).
Put it into the iOS Shortcut ([`deploy/shortcut/`](../../deploy/shortcut/README.md)).
Revoke it with `token revoke <name>`, list tokens with `token list`.

## 5. Check it end to end

```sh
curl -sS https://app.octosprout.de/healthz
curl -sS -X POST https://app.octosprout.de/api/v1/inbox \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json; charset=utf-8' \
  -d '{"text":"deployment check","idempotency_key":"deploy-check-0001","source":"cli"}'
```

Expect `201` with a capture ID and commit, and a new commit on
`octosprout-private`. Repeating the same request returns `200` with the same ID.

## Operating notes

- `202 pending` means the capture is committed in the server's clone but GitHub
  was unreachable. The server retries every 60 seconds (backing off to 15
  minutes) and after a restart. Nothing is lost.
- A log line `unresolved pending branches need attention` means a pending commit
  could not be rebased. It is preserved on a local `octosprout/pending/*`
  branch in the repo volume.
- Configuration is by environment variable; see
  [`config.ts`](../../app/packages/server/src/config.ts).
