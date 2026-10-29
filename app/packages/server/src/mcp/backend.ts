/** The MCP view of the server workspace. Writes remain pending proposals. */
import { generateId, type Operation, type RecordType } from "@octosprout/core";
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
    const outcome = await this.proposals.create(input);
    if (outcome.kind === "invalid") throw new Error(outcome.message);
    return {
      kind: "proposed",
      proposal: outcome.id,
      consequential: preview.classification!.consequential,
      reasons: preview.classification!.reasons,
    };
  }

  sync(): McpSyncResult {
    // GitWriteService pushes each successful server write itself.
    return { pushed: true };
  }
}
