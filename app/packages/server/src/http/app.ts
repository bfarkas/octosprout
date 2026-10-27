/**
 * The HTTP application: the inbox API (spec §15.2) and the health check.
 *
 * Every endpoint requires authentication. Inbox tokens are accepted only on
 * `/api/v1/inbox*`; anything else answers 401.
 */
import Fastify, { type FastifyError, type FastifyInstance, type FastifyReply, type FastifyRequest, type FastifyServerOptions } from "fastify";

import { denyUnauthenticated, registerAuth, type AuthOptions } from "../auth/routes.js";
import { ValidationRejectedError, type WriteStatus } from "../git/write-service.js";
import { InvalidRequestError, parseInboxRequest, parseJsonBody } from "../inbox/request.js";
import type { CaptureStatus, InboxOutcome, InboxService } from "../inbox/service.js";
import { registerRecordRoutes } from "../records/routes.js";
import type { HealthService } from "../health/health.js";
import type { ProposalService } from "../records/proposals.js";
import { registerHealthPage } from "../ui/health.js";
import type { StatusMoveDeps } from "../records/status.js";
import { registerBoards } from "../ui/boards.js";
import { approvalKeySection, registerProposalPages } from "../ui/proposals.js";
import { registerLists } from "../ui/lists.js";
import { registerNewRecord } from "../ui/new-record.js";
import { registerPromotion } from "../ui/promote.js";
import { registerRecordPages } from "../ui/records.js";
import { registerTriagePage } from "../ui/triage.js";
import { registerSettings, registerUi } from "../ui/routes.js";
import { RateLimiter } from "./rate-limit.js";
import type { TokenStore } from "./tokens.js";

/** Body limit, also enforced at Caddy (spec §15.2). */
export const MAX_BODY_BYTES = 512 * 1024;

export interface AppOptions {
  inbox: InboxService;
  tokens: TokenStore;
  /** Browser sign-in. Without it, only the token-protected inbox API is served. */
  auth?: AuthOptions & { status: () => Promise<WriteStatus> };
  /** The record index and writer behind the boards. Needs `auth`. */
  records?: StatusMoveDeps & { proposals?: ProposalService };
  /** The health panel and the status API's validation and CI details. */
  health?: HealthService;
  rateLimiter?: RateLimiter;
  logger?: FastifyServerOptions["logger"];
  /** Trust `X-Forwarded-For` from these proxies only (Caddy). */
  trustProxy?: FastifyServerOptions["trustProxy"];
}

declare module "fastify" {
  interface FastifyRequest {
    inboxToken: { name: string } | null;
  }
}

const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,128}$/;

/** Sources the browser form may report; anything else is recorded as `web`. */
const SHARE_SOURCES = new Set(["web", "shortcut", "chatgpt", "claude", "apple-notes"]);

function statusBody(status: CaptureStatus): Record<string, string> {
  return status.status === "committed"
    ? { id: status.id, status: "committed", commit: status.commit, path: status.path }
    : { id: status.id, status: "pending", local_commit: status.commit };
}

/** Maps an inbox outcome to the response of spec §15.2. */
function respondWithOutcome(reply: FastifyReply, outcome: InboxOutcome): FastifyReply {
  if (outcome.kind === "conflict") return reply.code(409).send({ error: "idempotency_conflict", id: outcome.id });
  if (outcome.kind === "created") return reply.code(outcome.status === "committed" ? 201 : 202).send(statusBody(outcome));
  return reply.code(200).send(statusBody(outcome));
}

function unauthorized(reply: FastifyReply): FastifyReply {
  return reply.code(401).header("WWW-Authenticate", "Bearer").send({ error: "unauthorized" });
}

export function buildApp(options: AppOptions): FastifyInstance {
  const { inbox, tokens } = options;
  const rateLimiter = options.rateLimiter ?? new RateLimiter();

  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: MAX_BODY_BYTES,
    routerOptions: { ignoreTrailingSlash: true },
    exposeHeadRoutes: false,
    trustProxy: options.trustProxy ?? false,
  });

  app.decorateRequest("inboxToken", null);

  // Parse JSON ourselves, from bytes, so invalid UTF-8 is an error and not silently replaced.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (_request, body, done) => {
    try {
      done(null, parseJsonBody(body as Buffer));
    } catch (error) {
      done(error as Error);
    }
  });

  app.addHook("onSend", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Content-Security-Policy", "default-src 'self'");
  });

  // Anonymous requests get 401 everywhere, including for paths that do not exist.
  app.setNotFoundHandler((request, reply) => (options.auth ? denyUnauthenticated(request, reply) : unauthorized(reply)));

  app.setErrorHandler((error: FastifyError | Error, request, reply) => {
    if (error instanceof InvalidRequestError) {
      return reply.code(400).send({ error: "invalid_request", field: error.field, message: error.message });
    }
    const code = (error as FastifyError).code;
    if (code === "FST_ERR_CTP_BODY_TOO_LARGE") return reply.code(413).send({ error: "payload_too_large" });
    if (code === "FST_ERR_CTP_INVALID_MEDIA_TYPE") {
      return reply.code(415).send({ error: "unsupported_media_type", message: "Send the request as application/json." });
    }
    if (code?.startsWith("FST_ERR_CTP_")) {
      return reply.code(400).send({ error: "invalid_request", field: "body", message: error.message });
    }
    // Never log request bodies: the error and the route are enough.
    request.log.error({ err: error }, "request failed");
    if (error instanceof ValidationRejectedError) return reply.code(500).send({ error: "internal_error" });
    return reply.code(503).send({ error: "unavailable", message: "The capture could not be stored. Nothing was saved." });
  });

  app.get("/healthz", async () => ({ status: "ok" }));

  if (options.auth) {
    const { status, ...authOptions } = options.auth;
    const { requireSession, recentlyVerified } = registerAuth(app, authOptions);
    // §18.4: the pending count, the last push, the last fetch and validation totals.
    app.get("/api/v1/status", { preHandler: requireSession }, async () => {
      const writer = await status();
      const base = {
        head: writer.head,
        pending: writer.pending,
        pending_branches: writer.pendingBranches,
        oldest_pending: writer.oldestPending ?? null,
        last_fetch: writer.lastFetch ?? null,
        last_push: writer.lastPush ?? null,
      };
      if (!options.health) return base;
      const h = await options.health.health();
      return {
        ...base,
        pending_alert: h.pendingAlert,
        validation: { errors: h.errors, warnings: h.warnings },
        ci: h.ci.kind === "ok" ? (h.ci.run ? { conclusion: h.ci.run.conclusion, status: h.ci.run.status, url: h.ci.run.url, sha: h.ci.run.sha } : null) : { unavailable: h.ci.kind },
      };
    });
    if (options.health) registerHealthPage(app, { requireSession, health: options.health });

    // The browser capture form uses the same pipeline as the inbox API (spec §12.2).
    app.post("/api/v1/capture", { preHandler: requireSession }, async (request, reply) => {
      const body = typeof request.body === "object" && request.body !== null ? (request.body as Record<string, unknown>) : request.body;
      // The page says where shared text came from (the iOS share link can name it); anything else is "web".
      const fields = typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : undefined;
      const source = typeof fields?.source === "string" && SHARE_SOURCES.has(fields.source) ? fields.source : "web";
      const parsed = parseInboxRequest(fields ? { ...fields, source } : body);
      const outcome = await inbox.submit(parsed, "web-session");
      if (outcome.kind === "created") {
        request.log.info({ id: outcome.id, size: Buffer.byteLength(parsed.text), source: parsed.source, token: "web-session" }, "capture stored");
      }
      return respondWithOutcome(reply, outcome);
    });

    // Token management (spec §18.2: "Created and revoked in the UI").
    app.get("/api/v1/tokens", { preHandler: requireSession }, async () => ({ tokens: tokens.list() }));
    app.post("/api/v1/tokens", { preHandler: requireSession }, async (request, reply) => {
      const name = (request.body as { name?: unknown } | null)?.name;
      if (typeof name !== "string") return reply.code(400).send({ error: "invalid_request", field: "name", message: "'name' is required." });
      try {
        const token = tokens.create(name);
        request.log.info({ name }, "inbox token created");
        return reply.code(201).send({ name, token });
      } catch (error) {
        return reply.code(400).send({ error: "invalid_request", field: "name", message: (error as Error).message });
      }
    });
    app.delete<{ Params: { name: string } }>("/api/v1/tokens/:name", { preHandler: requireSession }, async (request, reply) => {
      if (!tokens.revoke(request.params.name)) return reply.code(404).send({ error: "not_found" });
      request.log.info({ name: request.params.name }, "inbox token revoked");
      return { ok: true };
    });

    if (options.records) {
      registerRecordRoutes(app, { ...options.records, requireSession, recentlyVerified });
      const proposals = options.records.proposals;
      const approvals = () => proposals?.approvalsReady() ?? false;
      registerBoards(app, { requireSession, records: options.records.records, status, approvals, ...(options.records.now ? { now: options.records.now } : {}) });
      registerRecordPages(app, { ...options.records, requireSession, status, approvals });
      registerNewRecord(app, { requireSession, records: options.records.records, status });
      registerLists(app, { requireSession, records: options.records.records, status, ...(options.records.now ? { now: options.records.now } : {}) });
      if (proposals) registerPromotion(app, { requireSession, recentlyVerified, records: options.records.records, proposals, status, ...(options.records.now ? { now: options.records.now } : {}) });
      if (proposals) registerProposalPages(app, { requireSession, records: options.records.records, proposals, status, ...(options.records.now ? { now: options.records.now } : {}) });
      registerTriagePage(app, { requireSession, records: options.records.records, status, ...(options.records.now ? { now: options.records.now } : {}) });
    }

    const proposalService = options.records?.proposals;
    const recordsForUi = options.records?.records;
    const ui = {
      requireSession,
      inbox,
      tokens,
      passkeys: options.auth.passkeys,
      status,
      ...(proposalService && recordsForUi ? { approvalKey: () => approvalKeySection(proposalService, recordsForUi) } : {}),
    };
    registerUi(app, ui);
    registerSettings(app, ui);
  }

  app.register(
    async (scope) => {
      scope.addHook("onRequest", async (request, reply) => {
        const match = /^Bearer (\S+)$/.exec(request.headers.authorization ?? "");
        const token = match?.[1] === undefined ? undefined : tokens.verify(match[1]);
        if (!token) return unauthorized(reply);

        const limit = rateLimiter.take(token.name);
        if (!limit.allowed) {
          return reply.code(429).header("Retry-After", String(limit.retryAfterSeconds)).send({ error: "rate_limited" });
        }
        request.inboxToken = { name: token.name };
      });

      const methodNotAllowed = (allow: string) => async (_request: FastifyRequest, reply: FastifyReply) =>
        reply.code(405).header("Allow", allow).send({ error: "method_not_allowed" });

      scope.post("/", async (request, reply) => {
        const parsed = parseInboxRequest(request.body);
        const token = request.inboxToken!.name;
        const outcome = await inbox.submit(parsed, `token:${token}`);
        if (outcome.kind === "created") {
          request.log.info({ id: outcome.id, size: Buffer.byteLength(parsed.text), source: parsed.source, token }, "capture stored");
        }
        return respondWithOutcome(reply, outcome);
      });
      scope.route({ method: ["GET", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"], url: "/", handler: methodNotAllowed("POST") });

      scope.get<{ Params: { key: string } }>("/:key", async (request, reply) => {
        const { key } = request.params;
        const status = IDEMPOTENCY_KEY.test(key) ? await inbox.statusByKey(key) : undefined;
        if (!status) return reply.code(404).send({ error: "not_found" });
        return reply.code(200).send(statusBody(status));
      });
      scope.route({ method: ["POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"], url: "/:key", handler: methodNotAllowed("GET") });
    },
    { prefix: "/api/v1/inbox" },
  );

  return app;
}
