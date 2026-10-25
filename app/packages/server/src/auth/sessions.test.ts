import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PasskeyStore } from "./passkeys.js";
import { ChallengeStore } from "./challenges.js";
import { clearedSessionCookie, readCookie, SESSION_COOKIE, SESSION_IDLE_MS, SessionStore, sessionCookie } from "./sessions.js";

let dir: string;
let now: number;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "octosprout-auth-"));
  now = Date.parse("2026-10-25T12:00:00Z");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const DAY = 24 * 60 * 60 * 1000;

describe("SessionStore", () => {
  it("creates sessions that can be looked up, and stores only hashes", () => {
    const store = new SessionStore(dir, () => now);
    const { id, csrf } = store.create("cred-1");
    expect(store.lookup(id)).toMatchObject({ csrf, credentialId: "cred-1" });
    expect(store.lookup("unknown")).toBeUndefined();

    const file = join(dir, "sessions.json");
    expect(readFileSync(file, "utf8")).not.toContain(id);
    expect(statSync(file).mode & 0o077).toBe(0);
  });

  it("expires sessions after 30 idle days, and use extends them", () => {
    const store = new SessionStore(dir, () => now);
    const { id } = store.create("cred-1");

    now += 29 * DAY;
    expect(store.lookup(id)).toBeDefined(); // slides the timeout
    now += 29 * DAY;
    expect(store.lookup(id)).toBeDefined();
    now += SESSION_IDLE_MS + DAY;
    expect(store.lookup(id)).toBeUndefined();
  });

  it("survives a restart, and drops sessions that expired meanwhile", () => {
    const first = new SessionStore(dir, () => now);
    const kept = first.create("cred-1");
    const second = first.create("cred-1");

    expect(new SessionStore(dir, () => now).lookup(kept.id)).toBeDefined();
    now += SESSION_IDLE_MS + DAY;
    const restarted = new SessionStore(dir, () => now);
    expect(restarted.lookup(kept.id)).toBeUndefined();
    expect(restarted.lookup(second.id)).toBeUndefined();
  });

  it("destroys one session or all of them", () => {
    const store = new SessionStore(dir, () => now);
    const a = store.create("c");
    const b = store.create("c");
    store.destroy(a.id);
    expect(store.lookup(a.id)).toBeUndefined();
    expect(store.lookup(b.id)).toBeDefined();
    store.destroyAll();
    expect(store.lookup(b.id)).toBeUndefined();
    expect(new SessionStore(dir, () => now).lookup(b.id)).toBeUndefined();
  });
});

describe("cookies", () => {
  it("builds a __Host- cookie: Secure, HttpOnly, SameSite=Strict, Path=/, no Domain", () => {
    const cookie = sessionCookie("abc");
    expect(cookie.startsWith(`${SESSION_COOKIE}=abc;`)).toBe(true);
    expect(SESSION_COOKIE.startsWith("__Host-")).toBe(true);
    for (const attribute of ["Path=/", "Secure", "HttpOnly", "SameSite=Strict"]) expect(cookie).toContain(attribute);
    expect(cookie).not.toContain("Domain");
    expect(clearedSessionCookie()).toContain("Max-Age=0");
  });

  it("reads a cookie from a header", () => {
    expect(readCookie(`a=1; ${SESSION_COOKIE}=xyz; b=2`, SESSION_COOKIE)).toBe("xyz");
    expect(readCookie("a=1", SESSION_COOKIE)).toBeUndefined();
    expect(readCookie(undefined, SESSION_COOKIE)).toBeUndefined();
    expect(readCookie(`x${SESSION_COOKIE}=1`, SESSION_COOKIE)).toBeUndefined();
  });
});

describe("PasskeyStore", () => {
  const passkey = { id: "cred-1", publicKey: "key", counter: 0, name: "iPhone", created: "2026-10-25T12:00:00Z" };

  it("keeps a stable user handle and the registered passkeys across restarts", () => {
    const store = new PasskeyStore(dir);
    store.add(passkey);
    const reopened = new PasskeyStore(dir);
    expect(reopened.userId).toEqual(store.userId);
    expect(reopened.userId).toHaveLength(32);
    expect(reopened.list()).toEqual([passkey]);
  });

  it("rejects duplicates, records use and removes passkeys", () => {
    const store = new PasskeyStore(dir);
    store.add(passkey);
    expect(() => store.add(passkey)).toThrow(/already registered/);
    store.recordUse("cred-1", 7, new Date("2026-10-26T00:00:00Z"));
    expect(new PasskeyStore(dir).find("cred-1")).toMatchObject({ counter: 7, lastUsed: "2026-10-26T00:00:00.000Z" });
    expect(store.remove("cred-1")).toBe(true);
    expect(store.remove("cred-1")).toBe(false);
    expect(new PasskeyStore(dir).list()).toEqual([]);
  });
});

describe("ChallengeStore", () => {
  it("accepts a challenge once, for its own kind, before it expires", () => {
    const store = new ChallengeStore(() => now);
    store.remember("one", "login");
    expect(store.consume("one", "register")).toBe(false);
    expect(store.consume("one", "login")).toBe(false); // the failed attempt used it up

    store.remember("two", "login");
    expect(store.consume("two", "login")).toBe(true);
    expect(store.consume("two", "login")).toBe(false);

    store.remember("three", "login");
    now += 6 * 60 * 1000;
    expect(store.consume("three", "login")).toBe(false);
  });
});
