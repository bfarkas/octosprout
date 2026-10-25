/**
 * Per-key token bucket (spec §15.2: 30 requests per minute, burst of 10).
 */

export interface RateLimitOptions {
  /** Maximum burst. */
  capacity?: number;
  /** Sustained requests per minute. */
  perMinute?: number;
  now?: () => number;
}

export type RateLimitResult = { allowed: true } | { allowed: false; retryAfterSeconds: number };

export class RateLimiter {
  readonly #capacity: number;
  readonly #refillPerMs: number;
  readonly #now: () => number;
  readonly #buckets = new Map<string, { tokens: number; updated: number }>();

  constructor(options: RateLimitOptions = {}) {
    this.#capacity = options.capacity ?? 10;
    this.#refillPerMs = (options.perMinute ?? 30) / 60_000;
    this.#now = options.now ?? Date.now;
  }

  take(key: string): RateLimitResult {
    const now = this.#now();
    const bucket = this.#buckets.get(key) ?? { tokens: this.#capacity, updated: now };
    bucket.tokens = Math.min(this.#capacity, bucket.tokens + (now - bucket.updated) * this.#refillPerMs);
    bucket.updated = now;
    this.#buckets.set(key, bucket);

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return { allowed: true };
    }
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((1 - bucket.tokens) / this.#refillPerMs / 1000)) };
  }
}
