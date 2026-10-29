/** Durable OAuth clients, pending requests, grants and token hashes. */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface OAuthClient { id: string; name: string; redirectUris: string[]; created: string }
interface Pending { id: string; clientId: string; redirectUri: string; state?: string; challenge: string; resource: string; scope: string[]; expires: string }
interface Code { hash: string; clientId: string; redirectUri: string; challenge: string; resource: string; scope: string[]; grant: string; expires: string }
interface Grant { id: string; clientId: string; resource: string; scope: string[]; created: string; lastUsed?: string; revoked?: string; access: Array<{ hash: string; expires: string }>; refresh: Array<{ hash: string; expires: string; used?: string }> }
interface Data { clients: OAuthClient[]; pending: Pending[]; codes: Code[]; grants: Grant[] }

const hash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const random = (prefix: string) => `${prefix}${randomBytes(32).toString("base64url")}`;
const equal = (a: string, b: string) => timingSafeEqual(Buffer.from(hash(a), "hex"), Buffer.from(b, "hex"));

export function sanitizeClientName(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9._-]/g, "-").replace(/-+/g, "-").slice(0, 64) || "mcp";
}

export class OAuthStore {
  readonly #file: string;
  #data: Data = { clients: [], pending: [], codes: [], grants: [] };
  #seen = "";

  constructor(stateDir: string, private readonly now: () => Date = () => new Date()) {
    this.#file = join(stateDir, "oauth.json");
    this.#refresh();
  }

  #signature(): string {
    try { const stat = statSync(this.#file); return `${stat.ino}:${stat.size}:${stat.mtimeMs}`; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing"; throw error; }
  }
  #refresh(): void {
    const signature = this.#signature();
    if (signature === this.#seen) return;
    try { this.#data = JSON.parse(readFileSync(this.#file, "utf8")) as Data; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    this.#data.clients ??= []; this.#data.pending ??= []; this.#data.codes ??= []; this.#data.grants ??= [];
    this.#seen = signature;
    this.#purge();
  }
  #save(): void {
    this.#purge();
    mkdirSync(dirname(this.#file), { recursive: true });
    const temp = `${this.#file}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify(this.#data, null, 2)}\n`, { mode: 0o600 }); chmodSync(temp, 0o600); renameSync(temp, this.#file); this.#seen = this.#signature();
  }
  #purge(): void {
    const now = this.now().toISOString();
    this.#data.pending = this.#data.pending.filter((x) => x.expires > now);
    this.#data.codes = this.#data.codes.filter((x) => x.expires > now);
    for (const grant of this.#data.grants) {
      grant.access = grant.access.filter((x) => x.expires > now);
      // Used refresh tokens stay until expiry, so reusing one still revokes the grant.
      grant.refresh = grant.refresh.filter((x) => x.expires > now);
    }
  }
  clients(): readonly OAuthClient[] { this.#refresh(); return this.#data.clients; }
  client(id: string): OAuthClient | undefined { this.#refresh(); return this.#data.clients.find((x) => x.id === id); }
  register(name: string, redirectUris: string[]): OAuthClient {
    this.#refresh(); const client = { id: random("osc_"), name: sanitizeClientName(name), redirectUris, created: this.now().toISOString() }; this.#data.clients.push(client); this.#save(); return client;
  }
  pending(input: Omit<Pending, "id" | "expires">): Pending {
    this.#refresh(); const value = { ...input, id: random("osp_"), expires: new Date(this.now().getTime() + 10 * 60_000).toISOString() }; this.#data.pending.push(value); this.#save(); return value;
  }
  getPending(id: string): Pending | undefined {
    this.#refresh();
    return this.#data.pending.find((value) => value.id === id);
  }
  consumePending(id: string): Pending | undefined {
    this.#refresh(); const index = this.#data.pending.findIndex((x) => x.id === id); if (index < 0) return undefined; const [value] = this.#data.pending.splice(index, 1); this.#save(); return value;
  }
  issueCode(pending: Pending): string {
    this.#refresh(); const secret = random("osac_"); const grant = random("osg_");
    this.#data.grants.push({ id: grant, clientId: pending.clientId, resource: pending.resource, scope: pending.scope, created: this.now().toISOString(), access: [], refresh: [] });
    this.#data.codes.push({ hash: hash(secret), clientId: pending.clientId, redirectUri: pending.redirectUri, challenge: pending.challenge, resource: pending.resource, scope: pending.scope, grant, expires: new Date(this.now().getTime() + 60_000).toISOString() }); this.#save(); return secret;
  }
  exchangeCode(code: string): Code | undefined {
    this.#refresh(); const index = this.#data.codes.findIndex((x) => equal(code, x.hash)); if (index < 0) return undefined; const [value] = this.#data.codes.splice(index, 1); this.#save(); return value;
  }
  issueTokens(grantId: string, offline: boolean): { access: string; refresh?: string; expiresIn: number } | undefined {
    this.#refresh(); const grant = this.#data.grants.find((x) => x.id === grantId && !x.revoked); if (!grant) return undefined;
    const access = random("osa_"); grant.access.push({ hash: hash(access), expires: new Date(this.now().getTime() + 60 * 60_000).toISOString() });
    let refresh: string | undefined;
    if (offline) { refresh = random("osr_"); grant.refresh.push({ hash: hash(refresh), expires: new Date(this.now().getTime() + 30 * 24 * 60 * 60_000).toISOString() }); }
    grant.lastUsed = this.now().toISOString(); this.#save(); return { access, ...(refresh ? { refresh } : {}), expiresIn: 3600 };
  }
  refresh(secret: string, clientId: string): { access: string; refresh?: string; expiresIn: number } | "reuse" | undefined {
    this.#refresh();
    for (const grant of this.#data.grants) for (const token of grant.refresh) if (equal(secret, token.hash)) {
      if (grant.clientId !== clientId || grant.revoked || token.expires <= this.now().toISOString()) return undefined;
      if (token.used) { grant.revoked = this.now().toISOString(); this.#save(); return "reuse"; }
      token.used = this.now().toISOString(); this.#save(); return this.issueTokens(grant.id, true);
    }
    return undefined;
  }
  verifyAccess(secret: string, resource: string): { client: OAuthClient; grant: Grant } | undefined {
    this.#refresh(); const now = this.now().toISOString();
    for (const grant of this.#data.grants) for (const token of grant.access) if (equal(secret, token.hash) && !grant.revoked && token.expires > now && grant.resource === resource) {
      const client = this.#data.clients.find((x) => x.id === grant.clientId); if (!client) return undefined; grant.lastUsed = now; this.#save(); return { client, grant };
    }
    return undefined;
  }
  grants(): Array<{ id: string; client: OAuthClient; created: string; lastUsed?: string }> { this.#refresh(); return this.#data.grants.filter((g) => !g.revoked).flatMap((g) => { const client = this.#data.clients.find((c) => c.id === g.clientId); return client ? [{ id: g.id, client, created: g.created, ...(g.lastUsed ? { lastUsed: g.lastUsed } : {}) }] : []; }); }
  revoke(grantId: string): boolean { this.#refresh(); const grant = this.#data.grants.find((x) => x.id === grantId && !x.revoked); if (!grant) return false; grant.revoked = this.now().toISOString(); this.#save(); return true; }
}
