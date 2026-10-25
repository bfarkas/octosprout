/**
 * The Inbox Service: turns requests into capture records, with idempotency
 * (spec §15.2, §15.3).
 *
 * The idempotency index (key -> capture) is derived from the working tree, so
 * it includes unpushed commits and survives restarts without a database.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { generateId, parseRecord, sha256Hex } from "@octosprout/core";

import { ConflictError, type WriteOperation, type WriteResult } from "../git/write-service.js";
import { buildCapture } from "./capture.js";
import type { InboxRequest } from "./request.js";

/** What the inbox needs from the Git write service. */
export interface CaptureWriter {
  submit(operation: WriteOperation): Promise<WriteResult>;
  commitFor(path: string): Promise<{ commit: string; onRemote: boolean } | undefined>;
}

export interface CaptureStatus {
  id: string;
  path: string;
  /** `committed` means present on the remote branch; `pending` means committed locally only. */
  status: "committed" | "pending";
  commit: string;
}

export type InboxOutcome =
  | ({ kind: "created" } & CaptureStatus)
  | ({ kind: "replay" } & CaptureStatus)
  | { kind: "conflict"; id: string };

interface IndexedCapture {
  id: string;
  path: string;
  contentSha256: string;
}

export interface InboxServiceOptions {
  writer: CaptureWriter;
  /** The write service's clone. */
  repoDir: string;
  now?: () => Date;
  /** Overrides the random part of new IDs. For tests. */
  random?: () => string;
  /** New IDs to try if one is already taken by a file the index has not seen. */
  maxIdAttempts?: number;
}

const CAPTURES_DIR = "records/captures";

export class InboxService {
  readonly #writer: CaptureWriter;
  readonly #repoDir: string;
  readonly #now: () => Date;
  readonly #random: (() => string) | undefined;
  readonly #maxIdAttempts: number;
  readonly #byKey = new Map<string, IndexedCapture>();
  readonly #ids = new Set<string>();
  readonly #inflight = new Map<string, Promise<unknown>>();

  constructor(options: InboxServiceOptions) {
    this.#writer = options.writer;
    this.#repoDir = options.repoDir;
    this.#now = options.now ?? (() => new Date());
    this.#random = options.random;
    this.#maxIdAttempts = options.maxIdAttempts ?? 5;
    this.reindex();
  }

  /** Rebuilds the index from the working tree. Call after pulling in remote changes. */
  reindex(): void {
    this.#byKey.clear();
    this.#ids.clear();
    const walk = (dir: string): void => {
      let entries;
      try {
        entries = readdirSync(join(this.#repoDir, dir), { withFileTypes: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw error;
      }
      for (const entry of entries) {
        const path = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(path);
        else if (entry.isFile() && entry.name.endsWith(".md")) this.#indexFile(path);
      }
    };
    walk(CAPTURES_DIR);
  }

  #indexFile(path: string): void {
    const parsed = parseRecord(readFileSync(join(this.#repoDir, path), "utf8"));
    if (!parsed.ok) return;
    const { id, idempotency_key: key, content_sha256: sha } = parsed.record.frontmatter;
    if (typeof id !== "string") return;
    this.#ids.add(id);
    if (typeof key === "string" && typeof sha === "string") {
      this.#byKey.set(key, { id, path, contentSha256: sha });
    }
  }

  /**
   * Stores a capture, or answers a replay of an earlier request.
   * `receivedVia` is `token:<name>`, `web-session` or `cli`.
   */
  async submit(request: InboxRequest, receivedVia: string): Promise<InboxOutcome> {
    const key = request.idempotencyKey;
    // Requests with the same key run one after another, so the second sees the first's capture.
    for (let pending = this.#inflight.get(key); pending; pending = this.#inflight.get(key)) {
      await pending.catch(() => {});
    }

    const existing = this.#byKey.get(key);
    if (existing) {
      if (sha256Hex(request.text) !== existing.contentSha256) return { kind: "conflict", id: existing.id };
      const status = await this.#statusOf(existing);
      if (status) return { kind: "replay", ...status };
      // The capture is in neither the remote nor the local history (it was moved to a pending
      // branch), so there is nothing to replay. Store it again.
      this.#byKey.delete(key);
    }

    const work = this.#create(request, receivedVia);
    this.#inflight.set(key, work);
    try {
      return await work;
    } finally {
      this.#inflight.delete(key);
    }
  }

  /** The current status of the capture stored under an idempotency key. */
  async statusByKey(key: string): Promise<CaptureStatus | undefined> {
    const existing = this.#byKey.get(key);
    return existing ? this.#statusOf(existing) : undefined;
  }

  async #statusOf(entry: IndexedCapture): Promise<CaptureStatus | undefined> {
    const found = await this.#writer.commitFor(entry.path);
    if (!found) return undefined;
    return { id: entry.id, path: entry.path, status: found.onRemote ? "committed" : "pending", commit: found.commit };
  }

  async #create(request: InboxRequest, receivedVia: string): Promise<InboxOutcome> {
    const receivedAt = this.#now();
    for (let attempt = 0; attempt < this.#maxIdAttempts; attempt++) {
      const id = generateId("capture", {
        exists: (candidate) => this.#ids.has(candidate),
        ...(this.#random ? { random: this.#random } : {}),
      });
      const capture = buildCapture(request, { id, receivedAt, receivedVia });
      try {
        const result = await this.#writer.submit({
          operation: "capture",
          actor: actorFor(receivedVia),
          subject: `capture: ${id} (${request.source})`,
          // The file must not exist yet; a clash means another writer took this ID.
          preconditions: [{ path: capture.path, baseBlob: null }],
          changes: [{ path: capture.path, content: capture.content }],
        });
        if (result.status === "unchanged") throw new Error("A new capture produced no change.");

        this.#ids.add(id);
        this.#byKey.set(request.idempotencyKey, { id, path: capture.path, contentSha256: sha256Hex(request.text) });
        return {
          kind: "created",
          id,
          path: capture.path,
          status: result.status === "committed" ? "committed" : "pending",
          commit: result.commit,
        };
      } catch (error) {
        if (!(error instanceof ConflictError)) throw error;
        this.#ids.add(id);
      }
    }
    throw new Error(`Could not allocate a free capture ID after ${this.#maxIdAttempts} attempts.`);
  }
}

function actorFor(receivedVia: string): string {
  if (receivedVia === "web-session") return "user:web";
  return receivedVia; // `token:<name>` or `cli`
}
