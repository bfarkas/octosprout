/** The MCP view of the server workspace. Writes remain pending proposals. */
import { generateId, readWorkspaceFiles, validateWorkspace, type Finding, type Operation, type RecordType, type SourceFile } from "@octosprout/core";
import type { McpBackend, McpProposal, McpSyncResult } from "@octosprout/cli/mcp";

import { formatTimestamp } from "../inbox/capture.js";
import type { ProposalService } from "../records/proposals.js";
import type { WorkspaceRecords } from "../records/workspace.js";

export class ServerMcpBackend implements McpBackend {
  constructor(
    private readonly records: WorkspaceRecords,
    private readonly proposals: ProposalService,
  ) {}

  get root(): string {
    return this.records.root;
  }

  get index() {
    return this.records.index;
  }

  config() {
    return this.records.config();
  }

  now(): string {
    return formatTimestamp(new Date());
  }

  newId(type: RecordType, taken: ReadonlySet<string> = new Set()): string {
    return generateId(type, { exists: (id) => this.records.index.has(id) || taken.has(id) });
  }

  async propose(input: { title: string; rationale: string; operations: readonly Operation[]; actor: string; session?: string }): Promise<McpProposal> {
    const preview = this.proposals.preview(input.operations);
    if (!preview.ok) throw new Error(preview.message ?? "The operations do not apply.");
    this.#check(preview.diff!);
    const outcome = await this.proposals.create(input);
    if (outcome.kind === "invalid") throw new Error(outcome.message);
    return {
      kind: "proposed",
      proposal: outcome.id,
      consequential: preview.classification!.consequential,
      reasons: preview.classification!.reasons,
    };
  }

  /**
   * Refuses up front a proposal that could never be applied, as the stdio
   * server does. OSV008 is left out: the approval it asks for is what the
   * proposal is for.
   */
  #check(diff: ReadonlyArray<{ path: string; after: string | null }>): void {
    const before = readWorkspaceFiles(this.records.root);
    const after = new Map<string, SourceFile>(before.map((f) => [f.path, f]));
    for (const change of diff) {
      if (change.after === null) after.delete(change.path);
      else after.set(change.path, { path: change.path, content: change.after });
    }
    const key = (f: Finding): string => `${f.code}|${f.path}|${f.message}`;
    const baseline = new Set(validateWorkspace(before).filter((f) => f.severity === "error").map(key));
    const added = validateWorkspace([...after.values()]).filter((f) => f.severity === "error" && f.code !== "OSV008" && !baseline.has(key(f)));
    if (added.length > 0) throw new Error(`The change would add ${added.length} validation error(s): ${added.map((f) => `${f.code} ${f.message}`).join("; ")}`);
  }

  sync(): McpSyncResult {
    // GitWriteService pushes each successful server write itself.
    return { pushed: true };
  }
}
