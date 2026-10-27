/**
 * Outstanding WebAuthn challenges. Each is single-use and expires quickly.
 */

export type ChallengeKind = "register" | "login" | "reverify";

const TTL_MS = 5 * 60 * 1000;
const MAX_OUTSTANDING = 1000;

export class ChallengeStore {
  readonly #now: () => number;
  readonly #pending = new Map<string, { kind: ChallengeKind; expires: number }>();

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  remember(challenge: string, kind: ChallengeKind): void {
    const now = this.#now();
    for (const [key, value] of this.#pending) if (value.expires <= now) this.#pending.delete(key);
    if (this.#pending.size >= MAX_OUTSTANDING) {
      const oldest = this.#pending.keys().next().value;
      if (oldest !== undefined) this.#pending.delete(oldest);
    }
    this.#pending.set(challenge, { kind, expires: now + TTL_MS });
  }

  /** True once for a live challenge of this kind; it cannot be used again. */
  consume(challenge: string, kind: ChallengeKind): boolean {
    const entry = this.#pending.get(challenge);
    this.#pending.delete(challenge);
    return entry !== undefined && entry.kind === kind && entry.expires > this.#now();
  }
}
