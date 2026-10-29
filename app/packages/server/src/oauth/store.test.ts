import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { OAuthStore } from "./store.js";

const RESOURCE = "https://app.example.test/mcp";
let dir: string;
let clock: Date;
let store: OAuthStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "octosprout-oauth-store-"));
  clock = new Date("2026-10-29T12:00:00Z");
  store = new OAuthStore(dir, () => clock);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function connect() {
  const client = store.register("Claude", ["https://claude.ai/api/mcp/auth_callback"]);
  const pending = store.pending({ clientId: client.id, redirectUri: client.redirectUris[0]!, challenge: "c", resource: RESOURCE, scope: ["workspace", "offline_access"] });
  const code = store.exchangeCode(store.issueCode(pending))!;
  return { client, code, tokens: store.issueTokens(code.grant, true)! };
}

describe("OAuthStore", () => {
  it("accepts an access token only for its resource and only for an hour", () => {
    const { tokens } = connect();
    expect(store.verifyAccess(tokens.access, RESOURCE)).toBeDefined();
    expect(store.verifyAccess(tokens.access, "https://other.example/mcp")).toBeUndefined();
    clock = new Date(clock.getTime() + 60 * 60_000);
    expect(store.verifyAccess(tokens.access, RESOURCE)).toBeUndefined();
  });

  it("caps anonymous registrations by dropping the oldest clients without a grant", () => {
    const { client } = connect();
    for (let i = 0; i < 250; i++) store.register(`spam${i}`, ["http://localhost/cb"]);
    expect(store.clients()).toHaveLength(200);
    expect(store.client(client.id)).toBeDefined();
  });

  it("refuses a grant without the workspace scope", () => {
    const client = store.register("Claude", ["https://claude.ai/api/mcp/auth_callback"]);
    const code = store.exchangeCode(store.issueCode(store.pending({ clientId: client.id, redirectUri: client.redirectUris[0]!, challenge: "c", resource: RESOURCE, scope: ["offline_access"] })))!;
    expect(store.verifyAccess(store.issueTokens(code.grant, true)!.access, RESOURCE)).toBeUndefined();
  });

  it("uses each code once", () => {
    const client = store.register("Claude", ["https://claude.ai/api/mcp/auth_callback"]);
    const code = store.issueCode(store.pending({ clientId: client.id, redirectUri: client.redirectUris[0]!, challenge: "c", resource: RESOURCE, scope: ["workspace"] }));
    expect(store.exchangeCode(code)).toBeDefined();
    expect(store.exchangeCode(code)).toBeUndefined();
  });

  it("revokes the whole grant when a rotated refresh token is reused", () => {
    const { client, tokens } = connect();
    const rotated = store.refresh(tokens.refresh!, client.id);
    expect(rotated).toMatchObject({ access: expect.any(String) });
    expect(store.refresh(tokens.refresh!, client.id)).toBe("reuse");
    expect(store.verifyAccess((rotated as { access: string }).access, RESOURCE)).toBeUndefined();
    expect(store.grants()).toEqual([]);
  });

  it("ends a revoked grant's access at once, also for a fresh store on the same file", () => {
    const { tokens } = connect();
    const [grant] = store.grants();
    expect(store.revoke(grant!.id)).toBe(true);
    expect(new OAuthStore(dir, () => clock).verifyAccess(tokens.access, RESOURCE)).toBeUndefined();
  });
});
