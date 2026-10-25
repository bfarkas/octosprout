/**
 * Server-side sessions (spec §18.2): a random ID in a `__Host-` cookie, with a
 * 30-day idle timeout. Only the ID's hash is stored.
 */
import { createHash, randomBytes } from "node:crypto";
import { join } from "node:path";

import { StateFile } from "./state-file.js";

export const SESSION_COOKIE = "__Host-octosprout_session";
export const SESSION_IDLE_MS = 30 * 24 * 60 * 60 * 1000;
/** How often a session's last-seen time is written back to disk. */
const PERSIST_INTERVAL_MS = 10 * 60 * 1000;

export interface Session {
  /** SHA-256 of the session ID. */
  idHash: string;
  csrf: string;
  credentialId: string;
  created: string;
  lastSeen: string;
}

const hash = (id: string): string => createHash("sha256").update(id).digest("hex");

export class SessionStore {
  readonly #file: StateFile<{ sessions: Session[] }>;
  readonly #now: () => number;
  #sessions: Session[];
  #lastPersisted = 0;

  constructor(stateDir: string, now: () => number = Date.now) {
    this.#now = now;
    this.#file = new StateFile(join(stateDir, "sessions.json"), () => ({ sessions: [] }));
    this.#sessions = this.#file.load().sessions;
    this.#purge();
  }

  #persist(): void {
    this.#file.save({ sessions: this.#sessions });
    this.#lastPersisted = this.#now();
  }

  #purge(): void {
    const cutoff = this.#now() - SESSION_IDLE_MS;
    const live = this.#sessions.filter((session) => Date.parse(session.lastSeen) > cutoff);
    if (live.length !== this.#sessions.length) {
      this.#sessions = live;
      this.#persist();
    }
  }

  /** Starts a session. The returned ID goes into the cookie and is not recoverable later. */
  create(credentialId: string): { id: string; csrf: string } {
    this.#purge();
    const id = randomBytes(32).toString("base64url");
    const csrf = randomBytes(32).toString("base64url");
    const now = new Date(this.#now()).toISOString();
    this.#sessions.push({ idHash: hash(id), csrf, credentialId, created: now, lastSeen: now });
    this.#persist();
    return { id, csrf };
  }

  /** Returns the live session for a cookie value and extends its idle timeout. */
  lookup(id: string): Session | undefined {
    const session = this.#sessions.find((candidate) => candidate.idHash === hash(id));
    if (!session) return undefined;
    const now = this.#now();
    if (now - Date.parse(session.lastSeen) > SESSION_IDLE_MS) {
      this.#purge();
      return undefined;
    }
    session.lastSeen = new Date(now).toISOString();
    if (now - this.#lastPersisted > PERSIST_INTERVAL_MS) this.#persist();
    return session;
  }

  destroy(id: string): void {
    const before = this.#sessions.length;
    this.#sessions = this.#sessions.filter((session) => session.idHash !== hash(id));
    if (this.#sessions.length !== before) this.#persist();
  }

  destroyAll(): void {
    this.#sessions = [];
    this.#persist();
  }
}

/** Reads one cookie from a `Cookie` header. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index > 0 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return undefined;
}

/** `__Host-` cookies must be Secure, have no Domain and use Path=/. */
export function sessionCookie(id: string): string {
  return `${SESSION_COOKIE}=${id}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${SESSION_IDLE_MS / 1000}`;
}

export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0`;
}
