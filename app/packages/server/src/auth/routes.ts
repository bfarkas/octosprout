/**
 * Passkey authentication and session guard (spec §18.2).
 *
 *  - Single user; several passkeys can be registered.
 *  - First passkey, and recovery, go through /setup with the setup token.
 *  - Sessions are server-side behind a `__Host-` cookie. State-changing
 *    requests must pass an Origin check and carry the session's CSRF token.
 *  - Login and setup attempts are rate-limited per IP.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { RateLimiter } from "../http/rate-limit.js";
import { AUTH_JS, APP_CSS, APP_JS, MANIFEST, RETURN_JS } from "../ui/assets.js";
import { BOARD_JS } from "../ui/board-script.js";
import { RECORD_JS } from "../ui/record-script.js";
import { TRIAGE_JS } from "../ui/triage.js";
import { page, signInRequiredPage } from "../ui/html.js";
import { ChallengeStore } from "./challenges.js";
import type { PasskeyStore } from "./passkeys.js";
import { clearedSessionCookie, readCookie, SESSION_COOKIE, sessionCookie, type Session, type SessionStore } from "./sessions.js";

export interface AuthOptions {
  passkeys: PasskeyStore;
  sessions: SessionStore;
  /** WebAuthn relying party ID, e.g. `octosprout.de`. */
  rpId: string;
  /** The exact origin of the app, e.g. `https://app.octosprout.de`. */
  origin: string;
  rpName?: string;
  /** The setup token (a secret). Without one, /setup is disabled. */
  setupToken?: string;
  now?: () => number;
}

declare module "fastify" {
  interface FastifyRequest {
    session: Session | null;
    sessionId: string | null;
  }
}

/** `packages/server/static/`, resolved from `src/auth/` or `dist/auth/`. */
const STATIC_DIR = new URL("../../static/", import.meta.url);
const ICONS = ["icon-180.png", "icon-192.png", "icon-512.png", "icon-maskable-512.png"];

const sha256 = (value: string): Buffer => createHash("sha256").update(value, "utf8").digest();
const safeEqual = (a: string, b: string): boolean => timingSafeEqual(sha256(a), sha256(b));
const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function wantsHtml(request: FastifyRequest): boolean {
  return request.method === "GET" && (request.headers.accept ?? "").includes("text/html");
}

/** The 401 for anything that needs a session. Navigations get a page with a link to /login. */
export function denyUnauthenticated(request: FastifyRequest, reply: FastifyReply): FastifyReply {
  if (wantsHtml(request)) return reply.code(401).type("text/html; charset=utf-8").send(signInRequiredPage());
  return reply.code(401).send({ error: "unauthorized" });
}

export interface Guards {
  /** Requires a live session. State-changing requests also need a matching Origin and CSRF token. */
  requireSession: (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply | undefined>;
}

export function registerAuth(app: FastifyInstance, options: AuthOptions): Guards {
  const { passkeys, sessions, rpId, origin } = options;
  const rpName = options.rpName ?? "OctoSprout";
  const challenges = new ChallengeStore(options.now);
  const attempts = new RateLimiter({ capacity: 10, perMinute: 20, ...(options.now ? { now: options.now } : {}) });

  app.decorateRequest("session", null);
  app.decorateRequest("sessionId", null);

  const requireSession: Guards["requireSession"] = async (request, reply) => {
    const id = readCookie(request.headers.cookie, SESSION_COOKIE);
    const session = id ? sessions.lookup(id) : undefined;
    if (!id || !session) return denyUnauthenticated(request, reply);

    if (STATE_CHANGING.has(request.method)) {
      if (request.headers.origin !== origin) return reply.code(403).send({ error: "bad_origin" });
      const csrf = request.headers["x-csrf-token"];
      if (typeof csrf !== "string" || !safeEqual(csrf, session.csrf)) return reply.code(403).send({ error: "bad_csrf" });
    }
    request.session = session;
    request.sessionId = id;
    return undefined;
  };

  // --- Public pages and assets -------------------------------------------

  const asset = (path: string, type: string, body: string | Buffer): void => {
    app.get(path, async (_request, reply) => reply.type(type).header("Cache-Control", "no-cache").send(body));
  };
  asset("/static/app.css", "text/css; charset=utf-8", APP_CSS);
  asset("/static/auth.js", "text/javascript; charset=utf-8", AUTH_JS);
  asset("/static/app.js", "text/javascript; charset=utf-8", APP_JS);
  asset("/static/return.js", "text/javascript; charset=utf-8", RETURN_JS);
  asset("/static/board.js", "text/javascript; charset=utf-8", BOARD_JS);
  asset("/static/record.js", "text/javascript; charset=utf-8", RECORD_JS);
  asset("/static/triage.js", "text/javascript; charset=utf-8", TRIAGE_JS);
  asset("/manifest.webmanifest", "application/manifest+json; charset=utf-8", MANIFEST);
  for (const icon of ICONS) asset(`/static/${icon}`, "image/png", readFileSync(new URL(icon, STATIC_DIR)));

  app.get("/login", async (_request, reply) =>
    reply.type("text/html; charset=utf-8").send(
      page({
        title: "Sign in",
        page: "login",
        scripts: ["auth.js"],
        body: `<h1>Sign in</h1>
<p>Use the passkey you registered for OctoSprout.</p>
<div class="actions"><button type="button" id="sign-in">Sign in with passkey</button></div>
<p id="status" class="status" role="status" aria-live="polite"></p>
<p class="hint">No passkey yet, or a new device? <a href="/setup">Register one</a>.</p>`,
      }),
    ),
  );

  if (options.setupToken !== undefined) {
    app.get("/setup", async (_request, reply) =>
      reply.type("text/html; charset=utf-8").send(
        page({
          title: "Register a passkey",
          page: "setup",
          scripts: ["auth.js"],
          body: `<h1>Register a passkey</h1>
<form id="setup-form" autocomplete="off">
<label for="setup_token">Setup token</label>
<input type="password" id="setup_token" name="setup_token" required autocomplete="off">
<label for="name">Device name</label>
<input type="text" id="name" name="name" value="" placeholder="iPhone" maxlength="64" autocomplete="off">
<div class="actions"><button type="submit">Register passkey</button></div>
</form>
<p id="status" class="status" role="status" aria-live="polite"></p>
<p class="hint">The setup token lives on the server. Rotate it after use.</p>`,
        }),
      ),
    );
  }

  // --- Auth API ----------------------------------------------------------

  app.register(
    async (scope) => {
      // Cross-site POSTs and brute force are rejected before any work is done.
      scope.addHook("preHandler", async (request, reply) => {
        if (request.method !== "POST" || request.url.startsWith("/api/v1/auth/logout")) return undefined;
        if (request.headers.origin !== origin) return reply.code(403).send({ error: "bad_origin" });
        const limit = attempts.take(request.ip);
        if (!limit.allowed) {
          return reply.code(429).header("Retry-After", String(limit.retryAfterSeconds)).send({ error: "rate_limited" });
        }
        return undefined;
      });

      const fields = (request: FastifyRequest): Record<string, unknown> =>
        typeof request.body === "object" && request.body !== null && !Array.isArray(request.body) ? (request.body as Record<string, unknown>) : {};

      const setupAllowed = (body: Record<string, unknown>): boolean =>
        options.setupToken !== undefined && typeof body.setup_token === "string" && safeEqual(body.setup_token, options.setupToken);

      const deviceName = (body: Record<string, unknown>): string => {
        const name = typeof body.name === "string" ? body.name.trim().slice(0, 64) : "";
        return name === "" ? "passkey" : name;
      };

      const startSession = (reply: FastifyReply, credentialId: string): { csrf: string } => {
        const session = sessions.create(credentialId);
        reply.header("Set-Cookie", sessionCookie(session.id));
        return { csrf: session.csrf };
      };

      const transportsOf = (stored: readonly string[] | undefined) => stored as AuthenticatorTransportFuture[] | undefined;

      scope.post("/register/options", async (request, reply) => {
        if (!setupAllowed(fields(request))) return reply.code(401).send({ error: "invalid_setup_token" });
        const registration = await generateRegistrationOptions({
          rpName,
          rpID: rpId,
          userName: "owner",
          userID: new Uint8Array(passkeys.userId),
          attestationType: "none",
          excludeCredentials: passkeys.list().map((passkey) => ({ id: passkey.id, ...(passkey.transports ? { transports: transportsOf(passkey.transports)! } : {}) })),
          authenticatorSelection: { residentKey: "required", userVerification: "required" },
        });
        challenges.remember(registration.challenge, "register");
        return registration;
      });

      scope.post("/register/verify", async (request, reply) => {
        const body = fields(request);
        if (!setupAllowed(body)) return reply.code(401).send({ error: "invalid_setup_token" });
        try {
          const verification = await verifyRegistrationResponse({
            response: body.response as RegistrationResponseJSON,
            expectedChallenge: (challenge) => challenges.consume(challenge, "register"),
            expectedOrigin: origin,
            expectedRPID: rpId,
            requireUserVerification: true,
          });
          if (!verification.verified) return reply.code(400).send({ error: "verification_failed" });

          const { credential } = verification.registrationInfo;
          passkeys.add({
            id: credential.id,
            publicKey: Buffer.from(credential.publicKey).toString("base64url"),
            counter: credential.counter,
            ...(credential.transports ? { transports: [...credential.transports] } : {}),
            name: deviceName(body),
            created: new Date(options.now?.() ?? Date.now()).toISOString(),
          });
          return { ok: true, ...startSession(reply, credential.id) };
        } catch (error) {
          request.log.warn({ err: error }, "passkey registration failed");
          return reply.code(400).send({ error: "verification_failed", message: "The passkey could not be verified." });
        }
      });

      scope.post("/login/options", async (_request, reply) => {
        if (passkeys.list().length === 0) {
          return reply.code(409).send({ error: "no_passkeys", message: "No passkey is registered yet. Register one at /setup." });
        }
        const authentication = await generateAuthenticationOptions({
          rpID: rpId,
          userVerification: "required",
          allowCredentials: passkeys.list().map((passkey) => ({ id: passkey.id, ...(passkey.transports ? { transports: transportsOf(passkey.transports)! } : {}) })),
        });
        challenges.remember(authentication.challenge, "login");
        return authentication;
      });

      scope.post("/login/verify", async (request, reply) => {
        const response = fields(request).response as AuthenticationResponseJSON | undefined;
        const passkey = typeof response?.id === "string" ? passkeys.find(response.id) : undefined;
        const failed = () => reply.code(401).send({ error: "login_failed", message: "Sign-in failed." });
        if (!response || !passkey) return failed();
        try {
          const verification = await verifyAuthenticationResponse({
            response,
            expectedChallenge: (challenge) => challenges.consume(challenge, "login"),
            expectedOrigin: origin,
            expectedRPID: rpId,
            credential: {
              id: passkey.id,
              publicKey: new Uint8Array(Buffer.from(passkey.publicKey, "base64url")),
              counter: passkey.counter,
              ...(passkey.transports ? { transports: transportsOf(passkey.transports)! } : {}),
            },
            requireUserVerification: true,
          });
          if (!verification.verified) return failed();
          passkeys.recordUse(passkey.id, verification.authenticationInfo.newCounter, new Date(options.now?.() ?? Date.now()));
          return { ok: true, ...startSession(reply, passkey.id) };
        } catch (error) {
          request.log.warn({ err: error }, "passkey login failed");
          return failed();
        }
      });

      scope.post("/logout", { preHandler: requireSession }, async (request, reply) => {
        if (request.sessionId) sessions.destroy(request.sessionId);
        reply.header("Set-Cookie", clearedSessionCookie());
        return { ok: true };
      });
    },
    { prefix: "/api/v1/auth" },
  );

  // --- Session information -----------------------------------------------

  app.get("/api/v1/session", { preHandler: requireSession }, async (request) => ({
    authenticated: true,
    csrf: request.session!.csrf,
    passkeys: passkeys.list().map(({ id, name, created, lastUsed }) => ({ id, name, created, lastUsed })),
  }));

  return { requireSession };
}
