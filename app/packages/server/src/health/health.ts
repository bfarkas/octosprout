/**
 * The health panel's data (spec §12.2, §18.4, §18.5): validation of the
 * server's clone, cached per commit; pending pushes and their age; the last
 * fetch and push; pending branches; and the last CI run.
 */
import { validateDirectory, type Finding } from "@octosprout/core";

import type { WriteStatus } from "../git/write-service.js";
import type { CiState, CiStatus } from "./ci.js";

/** Unpushed commits older than this raise an alert (§18.5). */
export const PENDING_ALERT_MS = 60 * 60 * 1000;

export interface Health {
  write: WriteStatus;
  /** True when a commit has waited for more than an hour to be pushed. */
  pendingAlert: boolean;
  findings: Finding[];
  errors: number;
  warnings: number;
  ci: CiState;
}

export class HealthService {
  readonly #repoDir: string;
  readonly #status: () => Promise<WriteStatus>;
  readonly #ci: CiStatus;
  readonly #now: () => number;
  #validated: { head: string; findings: Finding[] } | undefined;

  constructor(options: { repoDir: string; status: () => Promise<WriteStatus>; ci: CiStatus; now?: () => number }) {
    this.#repoDir = options.repoDir;
    this.#status = options.status;
    this.#ci = options.ci;
    this.#now = options.now ?? Date.now;
  }

  async health(): Promise<Health> {
    const write = await this.#status();
    if (this.#validated?.head !== write.head) this.#validated = { head: write.head, findings: validateDirectory(this.#repoDir) };
    const findings = this.#validated.findings;
    return {
      write,
      pendingAlert: write.oldestPending !== undefined && this.#now() - Date.parse(write.oldestPending) > PENDING_ALERT_MS,
      findings,
      errors: findings.filter((f) => f.severity === "error").length,
      warnings: findings.filter((f) => f.severity === "warning").length,
      ci: await this.#ci.state(),
    };
  }
}
