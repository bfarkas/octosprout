/**
 * The HTTP application: the inbox API (spec §15.2) and the health check.
 *
 * Every endpoint requires authentication. Inbox tokens are accepted only on
 * `/api/v1/inbox*`; anything else answers 401.
 */
import Fastify, { type FastifyError, type FastifyInstance, type FastifyReply, type FastifyRequest, type FastifyServerOptions } from "fastify";

import { ValidationRejectedError } from "../git/write-service.js";
import { InvalidRequestError, parseInboxRequest, parseJsonBody } from "../inbox/request.js";
import type { CaptureStatus, InboxService } from "../inbox/service.js";
import { RateLimiter } from "./rate-limit.js";
import type { TokenStore } from "./tokens.js";

/** Body limit, also enforced at Caddy (spec §15.2). */
export const MAX_BODY_BYTES = 512 * 1024;

export interface AppOptions {
  inbox: InboxService;
  tokens: TokenStore;
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

function statusBody(status: CaptureStatus): Record<string, string> {
  return status.status === "committed"
    ? { id: status.id, status: "committed", commit: status.commit, path: status.path }
    : { id: status.id, status: "pending", local_commit: status.commit };
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

  app.setNotFoundHandler((_request, reply) => unauthorized(reply));

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

        if (outcome.kind === "conflict") {
          return reply.code(409).send({ error: "idempotency_conflict", id: outcome.id });
        }
        if (outcome.kind === "created") {
          request.log.info({ id: outcome.id, size: Buffer.byteLength(parsed.text), source: parsed.source, token }, "capture stored");
          return reply.code(outcome.status === "committed" ? 201 : 202).send(statusBody(outcome));
        }
        return reply.code(200).send(statusBody(outcome));
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
