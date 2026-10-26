# Deploying octosprout-server to rei3

Covers what is built so far (spec §18.1): the inbox API, passkey sign-in, the
Inbox view, the capture form and token management. Boards, proposals and
approvals come later.

## 1. DNS and Caddy

1. Point `app.octosprout.de` at rei3 (A/AAAA record).
2. Add the site block from [`deploy/Caddyfile.example`](../../deploy/Caddyfile.example)
   to Caddy's configuration and reload Caddy. It obtains the Let's Encrypt
   certificate automatically and enforces the 512 KiB body limit.

If Caddy has a global `acme_dns` (as on rei3, Hetzner DNS-01), certificates are
issued by DNS-01 and port 80 need not be reachable; the DNS API token must be
able to edit the zone. Otherwise HTTP-01 needs ports 80 and 443 forwarded to the
host. With Caddy on the host network, `reverse_proxy 127.0.0.1:8080` applies.

## 2. Deploy key

The server pushes to `octosprout-private` with an SSH deploy key that has
write access to that one repository.

```sh
ssh-keygen -t ed25519 -N '' -C octosprout-server -f deploy_key
```

1. On GitHub, open `octosprout-private` → Settings → Deploy keys → Add deploy
   key. Paste `deploy_key.pub` and tick **Allow write access**.
2. Move the private key to `/etc/octosprout/secrets/deploy_key` on rei3
   (owned by root) and delete the local copy.

Compose file secrets keep the host's owner and mode, and the container runs as
`node` (uid/gid 1000). A root-only `600` file is therefore unreadable in the
container (`EACCES: copyfile '/run/secrets/deploy_key'`). Make both secret files
group-readable by gid 1000 and let that group traverse the directories:

```sh
sudo chgrp 1000 /etc/octosprout /etc/octosprout/secrets /etc/octosprout/secrets/*
sudo chmod 710 /etc/octosprout /etc/octosprout/secrets
sudo chmod 640 /etc/octosprout/secrets/deploy_key /etc/octosprout/secrets/setup_token
```

GitHub accepts a deploy key on one repository only; add it to `octosprout-private`
and nowhere else.

The container copies the key to its state directory with mode 0600 at start,
and pins GitHub's host key on first use.

## 3. Setup token

The setup token authorizes registering a passkey at `/setup`, for the first
device and for recovery.

```sh
openssl rand -base64 32 | sudo tee /etc/octosprout/secrets/setup_token >/dev/null
sudo chmod 600 /etc/octosprout/secrets/setup_token
```

Rotate it (replace the file and restart) after you have registered your
devices. Without a setup token, `/setup` is disabled.

## 4. Build and start

```sh
docker build -f deploy/Dockerfile -t octosprout-server:latest .
mkdir -p /srv/octosprout && cp deploy/compose.example.yaml /srv/octosprout/compose.yaml
docker compose -f /srv/octosprout/compose.yaml up -d
docker compose -f /srv/octosprout/compose.yaml logs -f octosprout
```

On first start the server clones `octosprout-private` into the `octosprout-repo`
volume. The log line `workspace ready` reports the head commit and the number
of unpushed commits.

## 5. Register your passkeys

1. Open `https://app.octosprout.de/setup` on your iPhone (Safari), enter the
   setup token, name the device and confirm with Face ID. You are signed in.
2. Repeat on your Mac and any other device. Several passkeys can be registered.
3. Sign out and back in once on each device to confirm.

The passkeys are bound to `octosprout.de` and `https://app.octosprout.de`. If
you change either setting, every passkey stops working and you register again.

## 6. Create an inbox token

In the app, open **Settings**, create a token named `iphone-shortcut` and copy
it. It is shown once; only its hash is stored (in the state volume). Put it into
the iOS Shortcut ([`deploy/shortcut/`](../../deploy/shortcut/README.md)).
Revoke it in Settings when needed.

Without a browser, the CLI does the same:

```sh
docker compose -f /srv/octosprout/compose.yaml exec octosprout \
  node /opt/octosprout/app/packages/server/dist/main.js token create iphone-shortcut
```

(`token revoke <name>` and `token list` are also available.)

Tokens created or revoked with the CLI take effect on the running server
immediately, like tokens managed in the Settings page: the server re-reads
`tokens.json` whenever it changes, so no restart is needed.

## 7. Check it end to end

```sh
curl -sS https://app.octosprout.de/healthz
curl -sS -X POST https://app.octosprout.de/api/v1/inbox \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json; charset=utf-8' \
  -d '{"text":"deployment check","idempotency_key":"deploy-check-0001","source":"cli"}'
```

Expect `201` with a capture ID and commit, and a new commit on
`octosprout-private`. Repeating the same request returns `200` with the same ID.
The capture appears in the Inbox at `https://app.octosprout.de/`.

## Operating notes

- `202 pending` means the capture is committed in the server's clone but GitHub
  was unreachable. The server retries every 60 seconds (backing off to 15
  minutes) and after a restart. Nothing is lost.
- A log line `unresolved pending branches need attention` means a pending commit
  could not be rebased. It is preserved on a local `octosprout/pending/*`
  branch in the repo volume.
- Configuration is by environment variable; see
  [`config.ts`](../../app/packages/server/src/config.ts).
