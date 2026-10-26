/**
 * The server's record index (spec §4.2), kept in step with the write clone.
 *
 * It is rebuilt from the working tree at startup and after a sync that moved
 * HEAD, and the paths an operation touched are re-read after every write,
 * whether it committed, was dropped after a rebase, or failed.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { CONFIG_PATH, DEFAULT_CONFIG, parseWorkspaceConfig, readWorkspaceFiles, RecordIndex, type WorkspaceConfig } from "@octosprout/core";

import type { WriteOperation, WriteResult } from "../git/write-service.js";

export interface Writer {
  submit(operation: WriteOperation): Promise<WriteResult>;
  commitFor(path: string): Promise<{ commit: string; onRemote: boolean } | undefined>;
}

export class WorkspaceRecords {
  readonly #repoDir: string;
  #index: RecordIndex;

  constructor(repoDir: string) {
    this.#repoDir = repoDir;
    this.#index = new RecordIndex(readWorkspaceFiles(repoDir));
  }

  get index(): RecordIndex {
    return this.#index;
  }

  /** The workspace's `octosprout.yaml`, read on demand; defaults if it is missing or unreadable. */
  config(): WorkspaceConfig {
    try {
      return parseWorkspaceConfig(readFileSync(join(this.#repoDir, CONFIG_PATH), "utf8")).config;
    } catch {
      return DEFAULT_CONFIG;
    }
  }

  /** Rebuilds the whole index from the working tree. */
  reindex(): void {
    this.#index = new RecordIndex(readWorkspaceFiles(this.#repoDir));
  }

  /** Re-reads the given paths from the working tree. */
  refresh(paths: Iterable<string>): void {
    for (const path of paths) {
      let content: Buffer;
      try {
        content = readFileSync(join(this.#repoDir, path));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        this.#index.remove(path);
        continue;
      }
      this.#index.set({ path, content });
    }
  }

  /** Wraps a writer so that every write refreshes the paths it touched. */
  indexing(writer: Writer): Writer {
    return {
      submit: async (operation) => {
        try {
          return await writer.submit(operation);
        } finally {
          this.refresh(operation.changes.map((change) => change.path));
        }
      },
      commitFor: (path) => writer.commitFor(path),
    };
  }
}
