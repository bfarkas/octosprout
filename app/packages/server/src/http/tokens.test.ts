import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RateLimiter } from "./rate-limit.js";
import { TOKEN_PREFIX, TokenStore } from "./tokens.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "octosprout-tokens-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("TokenStore", () => {
  it("creates tokens that verify, and rejects everything else", () => {
    const store = new TokenStore(dir);
    const token = store.create("iphone-shortcut");
    expect(token.startsWith(TOKEN_PREFIX)).toBe(true);
    expect(store.verify(token)).toEqual({ name: "iphone-shortcut", scope: "inbox:write" });
    expect(store.verify(`${token}x`)).toBeUndefined();
    expect(store.verify("ost_nope")).toBeUndefined();
    expect(store.verify("")).toBeUndefined();
  });

  it("stores only a hash, in a private file", () => {
    const store = new TokenStore(dir);
    const token = store.create("iphone-shortcut");
    const file = join(dir, "tokens.json");
    expect(readFileSync(file, "utf8")).not.toContain(token);
    expect(statSync(file).mode & 0o077).toBe(0);
  });

  it("keeps tokens across restarts", () => {
    const token = new TokenStore(dir).create("iphone-shortcut");
    expect(new TokenStore(dir).verify(token)?.name).toBe("iphone-shortcut");
  });

  it("revokes tokens, durably, and allows the name to be reused", () => {
    const store = new TokenStore(dir);
    const old = store.create("iphone-shortcut");
    expect(store.revoke("iphone-shortcut")).toBe(true);
    expect(store.revoke("iphone-shortcut")).toBe(false);
    expect(store.verify(old)).toBeUndefined();
    expect(new TokenStore(dir).verify(old)).toBeUndefined();

    const fresh = store.create("iphone-shortcut");
    expect(store.verify(fresh)?.name).toBe("iphone-shortcut");
    expect(store.verify(old)).toBeUndefined();
  });

  it("refuses duplicate active names and invalid names", () => {
    const store = new TokenStore(dir);
    store.create("one");
    expect(() => store.create("one")).toThrow(/already exists/);
    for (const name of ["", "has space", "a/b", "x".repeat(65), "é"]) expect(() => store.create(name)).toThrow();
  });

  it("lists tokens without their hashes", () => {
    const store = new TokenStore(dir);
    store.create("one");
    expect(JSON.stringify(store.list())).not.toContain("sha256");
    expect(store.list()).toEqual([expect.objectContaining({ name: "one", scope: "inbox:write" })]);
  });
});

describe("RateLimiter", () => {
  it("allows a burst, then the sustained rate", () => {
    let now = 0;
    const limiter = new RateLimiter({ capacity: 10, perMinute: 30, now: () => now });
    for (let i = 0; i < 10; i++) expect(limiter.take("a").allowed).toBe(true);
    expect(limiter.take("a")).toEqual({ allowed: false, retryAfterSeconds: 2 });

    now += 2000; // two seconds refill one request at 30/minute
    expect(limiter.take("a").allowed).toBe(true);
    expect(limiter.take("a").allowed).toBe(false);
  });

  it("limits each key separately and never exceeds the burst", () => {
    let now = 0;
    const limiter = new RateLimiter({ now: () => now });
    for (let i = 0; i < 10; i++) limiter.take("a");
    expect(limiter.take("a").allowed).toBe(false);
    expect(limiter.take("b").allowed).toBe(true);

    now += 3_600_000;
    let allowed = 0;
    while (limiter.take("a").allowed) allowed++;
    expect(allowed).toBe(10);
  });
});
