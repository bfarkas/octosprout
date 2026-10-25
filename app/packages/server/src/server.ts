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

export interface RunningServer {
  /** The address the server is listening on. */
  address: string;
  writer: GitWriteService;
  inbox: InboxService;
  tokens: TokenStore;
  close(): Promise<void>;
}

export async function startServer(config: ServerConfig): Promise<RunningServer> {
  const { cloned } = await prepareRepo(config);

  const writer = new GitWriteService({ repoDir: config.repoDir });
  const inbox = new InboxService({ writer, repoDir: config.repoDir });
  const tokens = new TokenStore(config.stateDir);
  const setupToken = config.setupTokenFile ? readFileSync(config.setupTokenFile, "utf8").trim() : undefined;
  const app = buildApp({
    inbox,
    tokens,
    auth: {
      passkeys: new PasskeyStore(config.stateDir),
      sessions: new SessionStore(config.stateDir),
      rpId: config.rpId,
      origin: config.origin,
      ...(setupToken ? { setupToken } : {}),
      status: () => writer.status(),
    },
    logger: { level: config.logLevel },
    trustProxy: config.trustProxy,
  });

  // Report pending commits left by an earlier run, and resume pushing them (spec §8.3).
  const status = await writer.status();
  app.log.info({ cloned, head: status.head, pending: status.pending, pendingBranches: status.pendingBranches }, "workspace ready");
  if (status.pendingBranches.length > 0) {
    app.log.warn({ branches: status.pendingBranches }, "unresolved pending branches need attention");
  }

  let indexedHead = status.head;
  const background = writer.startBackgroundSync({
    intervalMs: config.syncIntervalMs,
    onSynced: async () => {
      // Pick up changes pushed from other clones (the Mac) into the idempotency index.
      const { head } = await writer.status();
      if (head !== indexedHead) {
        indexedHead = head;
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
    tokens,
    close: async () => {
      background.stop();
      await app.close();
    },
  };
}
