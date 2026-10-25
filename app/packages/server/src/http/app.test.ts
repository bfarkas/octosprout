import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";

import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { git, Sandbox } from "../git/test-helpers.js";
import { GitWriteService } from "../git/write-service.js";
import { InboxService } from "../inbox/service.js";
import { buildApp, MAX_BODY_BYTES } from "./app.js";
import { RateLimiter } from "./rate-limit.js";
import { TokenStore } from "./tokens.js";

let sandbox: Sandbox;
let stateDir: string;
let tokens: TokenStore;
let token: string;
let writer: GitWriteService;
let app: FastifyInstance;
let logs: string[];
let clock: number;

beforeEach(async () => {
  sandbox = await Sandbox.create();
  stateDir = mkdtempSync(join(tmpdir(), "octosprout-state-"));
  tokens = new TokenStore(stateDir);
  token = tokens.create("iphone-shortcut");
  writer = new GitWriteService({ repoDir: sandbox.server, retryBaseMs: 1, lockTimeoutMs: 2000, networkTimeoutMs: 5000 });
  const inbox = new InboxService({ writer, repoDir: sandbox.server });
  logs = [];
  clock = 0;
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      logs.push(chunk.toString());
      callback();
    },
  });
  app = buildApp({
    inbox,
    tokens,
    rateLimiter: new RateLimiter({ now: () => clock }),
    logger: { level: "info", stream },
  });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  sandbox.dispose();
  rmSync(stateDir, { recursive: true, force: true });
});

const auth = (value = token) => ({ authorization: `Bearer ${value}` });
const post = (payload: unknown, headers: Record<string, string> = auth()) =>
  app.inject({ method: "POST", url: "/api/v1/inbox", headers: { "content-type": "application/json; charset=utf-8", ...headers }, payload: payload as string });
const body = (response: LightMyRequestResponse) => response.json() as Record<string, unknown>;
const valid = { text: "Working title: Garden metaphor\n", idempotency_key: "20261025T140310-48213", source: "chatgpt" };

describe("POST /api/v1/inbox", () => {
  it("returns 201 with the capture ID, commit and path once it is on the remote", async () => {
    const response = await post(valid);
    expect(response.statusCode).toBe(201);
    const result = body(response);
    expect(result).toMatchObject({ status: "committed", id: expect.stringMatching(/^OS-C-/) });
    expect(result.path).toBe(`records/captures/${new Date().toISOString().slice(0, 4)}/${new Date().toISOString().slice(5, 7)}/${result.id as string}.md`);
    expect(await git(sandbox.remote, "rev-parse", "main")).toBe(result.commit);
    expect(await git(sandbox.remote, "log", "-1", "--format=%B")).toContain("OctoSprout-Actor: token:iphone-shortcut");
  });

  it("returns 202 and never claims 'committed' while the push is pending", async () => {
    await sandbox.goOffline();
    const response = await post(valid);
    expect(response.statusCode).toBe(202);
    expect(body(response)).toMatchObject({ status: "pending", local_commit: expect.stringMatching(/^[0-9a-f]{40}$/) });
    expect(body(response)).not.toHaveProperty("commit");

    await sandbox.goOnline();
    await writer.sync();
    const status = await app.inject({ method: "GET", url: `/api/v1/inbox/${valid.idempotency_key}`, headers: auth() });
    expect(body(status)).toMatchObject({ status: "committed" });
  });

  it("returns 200 for a replay, and 409 when the key is reused with different text", async () => {
    const first = body(await post(valid));
    const replay = await post(valid);
    expect(replay.statusCode).toBe(200);
    expect(body(replay)).toEqual(first);

    const conflict = await post({ ...valid, text: "different" });
    expect(conflict.statusCode).toBe(409);
    expect(body(conflict)).toEqual({ error: "idempotency_conflict", id: first.id });
    expect(await git(sandbox.remote, "rev-list", "--count", "main")).toBe("2");
  });

  it.each([
    ["missing text", { idempotency_key: valid.idempotency_key }, "text"],
    ["blank text", { ...valid, text: "   " }, "text"],
    ["a short key", { ...valid, idempotency_key: "abc" }, "idempotency_key"],
    ["an http URL", { ...valid, source_url: "http://example.com" }, "source_url"],
    ["a non-object body", [1, 2], "body"],
  ])("returns 400 for %s", async (_label, payload, field) => {
    const response = await post(JSON.stringify(payload));
    expect(response.statusCode).toBe(400);
    expect(body(response)).toMatchObject({ error: "invalid_request", field, message: expect.any(String) });
  });

  it("returns 400 for invalid UTF-8 and for invalid JSON", async () => {
    const bytes = Buffer.concat([Buffer.from('{"text":"'), Buffer.from([0xff, 0xfe]), Buffer.from('","idempotency_key":"abcdefgh"}')]);
    const invalidUtf8 = await post(bytes as unknown as string);
    expect(invalidUtf8.statusCode).toBe(400);
    expect(body(invalidUtf8).message).toMatch(/UTF-8/);

    expect((await post("{not json")).statusCode).toBe(400);
    expect((await post("")).statusCode).toBe(400);
  });

  it("returns 413 for bodies over 512 KiB and 415 for other content types", async () => {
    const big = await post(JSON.stringify({ ...valid, text: "x".repeat(MAX_BODY_BYTES) }));
    expect(big.statusCode).toBe(413);

    const plain = await app.inject({ method: "POST", url: "/api/v1/inbox", headers: { ...auth(), "content-type": "text/plain" }, payload: "hello" });
    expect(plain.statusCode).toBe(415);
  });

  it("stores awkward text exactly as submitted", async () => {
    const text = "  \r\n---\r\n🌱 <script>alert(1)</script> \n\n";
    const response = await post(JSON.stringify({ ...valid, text }));
    expect(response.statusCode).toBe(201);
    const stored = await git(sandbox.remote, "show", `main:${body(response).path as string}`);
    expect(stored).toContain("<script>alert(1)</script>");
    expect(stored).toContain("source: chatgpt");
  });

  it("returns 503 and stores nothing when the capture cannot be written", async () => {
    const failing = buildApp({
      inbox: { submit: () => Promise.reject(new Error("ENOSPC: no space left on device")), statusByKey: () => Promise.resolve(undefined) } as unknown as InboxService,
      tokens,
    });
    const response = await failing.inject({ method: "POST", url: "/api/v1/inbox", headers: { ...auth(), "content-type": "application/json" }, payload: JSON.stringify(valid) });
    expect(response.statusCode).toBe(503);
    expect(body(response).error).toBe("unavailable");
    await failing.close();
  });
});

describe("GET /api/v1/inbox/:key", () => {
  it("returns the status of a stored capture, 404 otherwise", async () => {
    const created = body(await post(valid));
    const found = await app.inject({ method: "GET", url: `/api/v1/inbox/${valid.idempotency_key}`, headers: auth() });
    expect(found.statusCode).toBe(200);
    expect(body(found)).toEqual(created);

    const missing = await app.inject({ method: "GET", url: "/api/v1/inbox/never-seen-key", headers: auth() });
    expect(missing.statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/api/v1/inbox/bad key!", headers: auth() })).statusCode).toBe(404);
  });
});

describe("authentication and authorization", () => {
  const routes = [
    ["POST", "/api/v1/inbox"],
    ["GET", "/api/v1/inbox/abcdefgh"],
  ] as const;

  it.each(routes)("answers 401 to %s %s without a valid token", async (method, url) => {
    tokens.create("to-revoke");
    for (const headers of [
      {},
      { authorization: "Bearer ost_wrong" },
      { authorization: "Bearer" },
      { authorization: `Basic ${token}` },
      { authorization: token },
    ]) {
      const options: InjectOptions = { method, url, headers };
      if (method === "POST") options.payload = JSON.stringify(valid);
      const response = await app.inject(options);
      expect(response.statusCode, JSON.stringify(headers)).toBe(401);
      expect(response.headers["www-authenticate"]).toBe("Bearer");
    }
  });

  it("rejects a revoked token", async () => {
    tokens.revoke("iphone-shortcut");
    expect((await post(valid)).statusCode).toBe(401);
  });

  it("does not let an inbox token reach anything but the inbox routes", async () => {
    for (const url of ["/", "/api/v1/status", "/api/v1/tokens", "/capture", "/login"]) {
      const response = await app.inject({ method: "GET", url, headers: auth() });
      expect(response.statusCode, url).toBe(401);
    }
  });

  it("answers 401 before looking at an oversized or malformed body", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/inbox",
      headers: { "content-type": "application/json" },
      payload: "x".repeat(MAX_BODY_BYTES + 1),
    });
    expect(response.statusCode).toBe(401);
  });

  it("serves only POST and GET, with 405 for other methods", async () => {
    for (const method of ["PUT", "PATCH", "DELETE", "OPTIONS"] as const) {
      const response = await app.inject({ method, url: "/api/v1/inbox", headers: auth() });
      expect(response.statusCode, method).toBe(405);
      expect(response.headers.allow).toBe("POST");
    }
    expect((await app.inject({ method: "POST", url: "/api/v1/inbox/abcdefgh", headers: auth() })).statusCode).toBe(405);
    expect((await app.inject({ method: "GET", url: "/api/v1/inbox", headers: auth() })).statusCode).toBe(405);
  });

  it("serves the health check without authentication", async () => {
    const response = await app.inject({ method: "GET", url: "/healthz" });
    expect(response.statusCode).toBe(200);
    expect(body(response)).toEqual({ status: "ok" });
  });
});

describe("rate limiting", () => {
  it("answers 429 with Retry-After after the burst, per token", async () => {
    const other = tokens.create("other");
    for (let i = 0; i < 10; i++) {
      expect((await app.inject({ method: "GET", url: "/api/v1/inbox/abcdefgh", headers: auth() })).statusCode).toBe(404);
    }
    const limited = await app.inject({ method: "GET", url: "/api/v1/inbox/abcdefgh", headers: auth() });
    expect(limited.statusCode).toBe(429);
    expect(Number(limited.headers["retry-after"])).toBeGreaterThanOrEqual(1);

    expect((await app.inject({ method: "GET", url: "/api/v1/inbox/abcdefgh", headers: auth(other) })).statusCode).toBe(404);
    clock += 2000;
    expect((await app.inject({ method: "GET", url: "/api/v1/inbox/abcdefgh", headers: auth() })).statusCode).toBe(404);
  });
});

describe("hardening", () => {
  it("never logs capture text or tokens", async () => {
    const secret = "TOP-SECRET-CAPTURE-TEXT";
    await post({ ...valid, text: secret });
    await post({ ...valid, text: secret }, auth("ost_wrong"));
    await post("{not json");
    const output = logs.join("");
    expect(output).toContain("capture stored");
    expect(output).not.toContain(secret);
    expect(output).not.toContain(token);
  });

  it("logs the ID, size, source and token name of a stored capture", async () => {
    const id = body(await post(valid)).id as string;
    const line = logs.map((l) => JSON.parse(l) as Record<string, unknown>).find((l) => l.msg === "capture stored");
    expect(line).toMatchObject({ id, size: Buffer.byteLength(valid.text), source: "chatgpt", token: "iphone-shortcut" });
  });

  it("sets security headers and forbids caching", async () => {
    const response = await post(valid);
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["content-security-policy"]).toBe("default-src 'self'");
    expect(response.headers["cache-control"]).toBe("no-store");
  });
});
