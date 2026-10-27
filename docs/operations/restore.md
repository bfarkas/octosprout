# Restoring OctoSprout

Rebuilds a working instance after losing rei3, the Docker volumes or the state
directory (spec §18.5). [`deploy.md`](deploy.md) has the details of each
setup step; this runbook says what to restore, in which order, and how to
check each step.

## What survives where

| Data | Where it lives | If lost |
|---|---|---|
| Records, proposals, approvals, `octosprout.yaml` | GitHub `octosprout-private`, plus the Mac checkout | Restore from the other copy (step 2) |
| Unpushed commits | The `octosprout-repo` volume only | Lost. The health panel and the red sync indicator warn after an hour |
| Passkeys, sessions, inbox token hashes | The `octosprout-state` volume | Register passkeys again with the setup token; issue new tokens |
| Deploy key, setup token | `/etc/octosprout/secrets` on rei3 | Generate new ones (step 4) |
| Approval signing key | `/etc/octosprout/secrets` on rei3 | Retire it, then generate and trust a new one (step 4); old approvals stay valid |

The approval signing key is the one secret worth backing up. Back up
`/etc/octosprout/secrets` with the other rei3 backups, but never into either
repository.

## 0. Before you start

- If the old host is still reachable, check the health panel or the
  `workspace ready` log line for unpushed commits. If there are any, run
  `git push` in the repo volume, or copy the volume, before you tear anything
  down.
- On the Mac, run `octosprout sync` in the checkout. This makes GitHub and
  the Mac hold the same history.

## 1. Provision the host

A host with Docker, the Compose plugin and Caddy. Follow
[deploy §1](deploy.md#1-dns-and-caddy) for DNS and the Caddy site block.

**Check:** `https://app.octosprout.de` answers with a valid certificate. It
returns `502` until step 3.

## 2. Make sure the workspace is whole

GitHub is the backup of record.
- **The GitHub repository is intact:** do nothing; the server clones it on
  first start.
- **GitHub was lost:** create an empty private repository `octosprout-private`
  and push the Mac checkout to it (`git push origin main`).

**Check:** a fresh clone validates:

```sh
git clone git@github.com:bfarkas/octosprout-private.git /tmp/restore-check
cd /tmp/restore-check && octosprout validate
```

Expect `No findings.`, or only warnings. The private repository's `Validate`
workflow checks the same on every push.

## 3. Deploy with Compose

Build the image and start it as in [deploy §5](deploy.md#5-build-and-start),
with the restored or new secrets from step 4 in place. On first start the
server clones `octosprout-private` into the empty `octosprout-repo` volume.

**Check:** the log line `workspace ready` names the same head commit as
GitHub, with 0 pending. `curl -sS https://app.octosprout.de/healthz` returns
`{"status":"ok"}`.

## 4. Restore or recreate the secrets

| Secret | Restored from backup | Recreated |
|---|---|---|
| `deploy_key` | Copy it back | New key, as in [deploy §2](deploy.md#2-deploy-key). Remove the old deploy key on GitHub |
| `setup_token` | Copy it back, then rotate it after step 5 | New token, as in [deploy §3](deploy.md#3-setup-token) |
| `approval_signing_key` | Copy it back: approvals work at once | New key, as in [deploy §4](deploy.md#4-approval-signing-key). Then follow the steps below |
| `github_token` (optional) | Copy it back | New read-only token |

All secret files need group 1000 and mode 640, as in deploy §2.

**A new approval signing key** has to be trusted before anything consequential
can be approved. Only the lost key could have approved that, so the recovery
goes through your own push access instead:
1. On the Mac, edit `octosprout.yaml` by hand. Add `status: retired` to the
   lost key's entry in `approval_public_keys` and keep the entry, so old
   approvals keep validating.
2. Commit with plain `git commit`. `octosprout` would turn the change into a
   proposal. Push it; the pre-push hook validates the result.
3. After step 5, open **Settings**. With no active key left, it offers
   **Trust this server's approval key**. Confirm it with your passkey. The
   server adds its key in a commit it signs itself.

**Check:** **Settings** shows the approval key as trusted.

## 5. Register a passkey again

Passkeys live in the state volume. If it was lost, open `/setup` on the iPhone
and on the Mac with the setup token ([deploy §6](deploy.md#6-register-your-passkeys)).
Remove the old entries from the devices' password managers. After that, rotate
the setup token.

**Check:** sign out and back in on each device.

## 6. Set up mobile capture again

The Shortcut and the home screen app use the passkey session; set them up as
in [deploy §7](deploy.md#7-set-up-capturing-on-the-iphone). Issue new inbox
tokens only for the API clients that need them. Old tokens were stored only as
hashes in the lost state volume, so they cannot be restored.

## 7. Verify end to end

1. Share a line of text to **OctoSprout** on the iPhone and tap **Save**.
2. Expect a capture ID. The capture appears in the Inbox, and a new commit
   appears on `octosprout-private`.
3. Triage it into an idea on the triage page.
4. On the Mac, run `octosprout sync` and `octosprout show <idea ID>`.
5. Check the health panel (`/health`): the workspace is valid, nothing is
   pending, and CI is green.

The restore is done when all five steps pass.

## Drill log

The MVP requires executing this runbook end to end on a scratch host (spec §20,
"Recovery"). Use a throwaway host name and a copy of the repository, not the
live instance. Record each drill here:

| Date | Host | Scenario (what was lost) | Result | Notes |
|---|---|---|---|---|
| 2026-10-27 | rei3, scratch project `octosprout-drill` (port 8091, local mirror; not a separate host) | Compose volumes and state lost. Repository rebuilt from a mirror of `octosprout-private`; approval key restored from a copy | Partial. Passed: step 2 (fresh clone validates, `No findings.`), step 3 (`workspace ready` at `a173c6a`, 0 pending, `/healthz` 200), step 4 (approval key `server-c61e62a0` matches the trusted key), and the capture write path (`201` with `OS-C-4VEWY`, `200` on replay, commit on the mirror). Not run: step 1 (same host), steps 5 and 6 and the device checks in step 7 (need the iPhone and Mac) | The drill used a local mirror instead of GitHub, so the deploy key was not needed. Approval round trip in the private repository's CI: run 40588401750 on `a173c6a` (`validate --ci`, `No findings.`). A tampered approval fails with OSV012 locally. The MVP sign-off still needs a separate scratch host and the device steps |
