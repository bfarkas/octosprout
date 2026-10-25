/**
 * Named inbox tokens (spec §18.2).
 *
 * Tokens carry the `inbox:write` scope and are shown once, at creation. Only
 * their SHA-256 hashes are stored, in the state directory (never in Git).
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const TOKEN_PREFIX = "ost_";
export const INBOX_SCOPE = "inbox:write";

/** Token names appear in `received_via` (`token:<name>`), so they must satisfy the capture schema. */
const NAME = /^[A-Za-z0-9._-]{1,64}$/;

export interface TokenRecord {
  name: string;
  /** Hex SHA-256 of the token. */
  sha256: string;
  scope: typeof INBOX_SCOPE;
  created: string;
  revoked?: string;
}

export interface VerifiedToken {
  name: string;
  scope: typeof INBOX_SCOPE;
}

const hash = (token: string): string => createHash("sha256").update(token, "utf8").digest("hex");

export class TokenStore {
  readonly #file: string;
  #tokens: TokenRecord[];

  constructor(stateDir: string) {
    this.#file = join(stateDir, "tokens.json");
    this.#tokens = this.#load();
  }

  #load(): TokenRecord[] {
    try {
      const data = JSON.parse(readFileSync(this.#file, "utf8")) as { tokens?: TokenRecord[] };
      return data.tokens ?? [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  #save(): void {
    mkdirSync(dirname(this.#file), { recursive: true });
    const temp = `${this.#file}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify({ tokens: this.#tokens }, null, 2)}\n`, { mode: 0o600 });
    chmodSync(temp, 0o600);
    renameSync(temp, this.#file);
  }

  /** Creates a token. The returned secret is the only copy; it cannot be recovered. */
  create(name: string, now: Date = new Date()): string {
    if (!NAME.test(name)) throw new Error("Token names use 1-64 characters from A-Z a-z 0-9 . _ -");
    if (this.#tokens.some((t) => t.name === name && t.revoked === undefined)) {
      throw new Error(`A token named '${name}' already exists.`);
    }
    const token = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
    this.#tokens.push({ name, sha256: hash(token), scope: INBOX_SCOPE, created: now.toISOString() });
    this.#save();
    return token;
  }

  /** Revokes the active token with this name. Returns false if there is none. */
  revoke(name: string, now: Date = new Date()): boolean {
    const record = this.#tokens.find((t) => t.name === name && t.revoked === undefined);
    if (!record) return false;
    record.revoked = now.toISOString();
    this.#save();
    return true;
  }

  list(): readonly Omit<TokenRecord, "sha256">[] {
    return this.#tokens.map(({ sha256: _sha256, ...rest }) => rest);
  }

  /** Returns the token's identity if it is valid and not revoked. */
  verify(token: string): VerifiedToken | undefined {
    if (!token.startsWith(TOKEN_PREFIX)) return undefined;
    const presented = Buffer.from(hash(token), "hex");
    let match: TokenRecord | undefined;
    // Compare against every token so the time taken does not reveal which one matched.
    for (const record of this.#tokens) {
      const equal = timingSafeEqual(presented, Buffer.from(record.sha256, "hex"));
      if (equal && record.revoked === undefined) match = record;
    }
    return match ? { name: match.name, scope: match.scope } : undefined;
  }
}
