/**
 * Wires the services together and starts listening.
 */
import { readFileSync } from "node:fs";

import { PasskeyStore } from "./auth/passkeys.js";
import { SessionStore } from "./auth/sessions.js";
import { prepareRepo } from "./bootstrap.js";
import type { ServerConfig } from "./config.js";
import { GitWriteService } from "./git/write-service.js";
import { buildApp } from "./http/app.js";
import { TokenStore } from "./http/tokens.js";
import { InboxService } from "./inbox/service.js";
import { loadSigningKey } from "./approvals/signing-key.js";
import { CiStatus, githubRepo } from "./health/ci.js";
import { HealthService } from "./health/health.js";
import { ProposalService } from "./records/proposals.js";
import { WorkspaceRecords } from "./records/workspace.js";
import { ServerMcpBackend } from "./mcp/backend.js";
import { OAuthStore, sanitizeClientName } from "./oauth/store.js";
import { RateLimiter } from "./http/rate-limit.js";

export interface RunningServer {
  /** The address the server is listening on. */
  address: string;
  writer: GitWriteService;
  inbox: InboxService;
  records: WorkspaceRecords;
  tokens: TokenStore;
  close(): Promise<void>;
}

export async function startServer(config: ServerConfig): Promise<RunningServer> {
  const { cloned } = await prepareRepo(config);

  const writer = new GitWriteService({ repoDir: config.repoDir });
  const records = new WorkspaceRecords(config.repoDir);
  const inbox = new InboxService({ writer: records.indexing(writer), repoDir: config.repoDir });
  // Triage changes a capture's status; the Inbox lists from its own idempotency index.
  records.onChange((paths) => {
    if (paths !== "all" && paths.some((path) => path.startsWith("records/captures/"))) inbox.reindex();
  });
  const tokens = new TokenStore(config.stateDir);
  const oauth = new OAuthStore(config.stateDir);
  const passkeys = new PasskeyStore(config.stateDir);
  const recordDeps = { records, writer: { ...records.indexing(writer), readBlob: (sha: string) => writer.readBlob(sha), history: (path: string, limit?: number) => writer.history(path, limit) } };
  const signingKey = config.approvalKeyFile ? loadSigningKey(config.approvalKeyFile) : undefined;
  const proposals = new ProposalService({ ...recordDeps, ...(signingKey ? { signingKey } : {}), head: async () => (await writer.status()).head });
  const setupToken = config.setupTokenFile ? readFileSync(config.setupTokenFile, "utf8").trim() : undefined;
  const app = buildApp({
    inbox,
    tokens,
    auth: {
      passkeys,
      sessions: new SessionStore(config.stateDir),
      rpId: config.rpId,
      origin: config.origin,
      ...(setupToken ? { setupToken } : {}),
      status: () => writer.status(),
    },
    records: { ...recordDeps, proposals },
    remoteMcp: {
      origin: config.origin,
      backend: new ServerMcpBackend(records, proposals),
      authenticateBearer: (request) => {
        const match = /^Bearer (\S+)$/.exec(request.headers.authorization ?? "");
        const verified = match ? oauth.verifyAccess(match[1]!, `${config.origin}/mcp`) : undefined;
        return verified ? { actor: `agent:${sanitizeClientName(verified.client.name)}` } : undefined;
      },
      oauth: { origin: config.origin, rpId: config.rpId, passkeys, store: oauth, rateLimiter: new RateLimiter() },
    },
    health: new HealthService({
      repoDir: config.repoDir,
      status: () => writer.status(),
      ci: new CiStatus({
        ...(config.githubTokenFile ? { token: readFileSync(config.githubTokenFile, "utf8").trim() } : {}),
        ...(githubRepo(config.remoteUrl) ? { repo: githubRepo(config.remoteUrl)! } : {}),
      }),
    }),
    logger: { level: config.logLevel },
    trustProxy: config.trustProxy,
  });

  // Report pending commits left by an earlier run, and resume pushing them (spec §8.3).
  const status = await writer.status();
  app.log.info({ cloned, head: status.head, pending: status.pending, pendingBranches: status.pendingBranches, approvalKey: signingKey?.id ?? null }, "workspace ready");
  if (!signingKey) app.log.warn("no approval signing key (OCTOSPROUT_APPROVAL_KEY_FILE): consequential changes cannot be approved");
  if (status.pendingBranches.length > 0) {
    app.log.warn({ branches: status.pendingBranches }, "unresolved pending branches need attention");
  }

  let indexedHead = status.head;
  const background = writer.startBackgroundSync({
    intervalMs: config.syncIntervalMs,
    onSynced: async () => {
      // Pick up changes pushed from other clones (the Mac) into the indexes.
      const { head } = await writer.status();
      if (head !== indexedHead) {
        indexedHead = head;
        records.reindex();
        inbox.reindex();
      }
    },
    onError: (error) => app.log.error({ err: error }, "background sync failed"),
  });
  // Push anything left over from a previous run without waiting for the first interval.
  if (status.pending > 0) void writer.sync().catch((error: unknown) => app.log.error({ err: error }, "startup sync failed"));

  const address = await app.listen({ host: config.host, port: config.port });
  return {
    address,
    writer,
    inbox,
    records,
    tokens,
    close: async () => {
      background.stop();
      await app.close();
    },
  };
}
