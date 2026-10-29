/** The small workspace surface used by the MCP tools and their plans. */
import type { Operation, RecordIndex, RecordType, WorkspaceConfig } from "@octosprout/core";

export interface McpBackend {
  readonly root: string;
  readonly index: RecordIndex;
  config(): WorkspaceConfig;
  now(): string;
  newId(type: RecordType, taken?: ReadonlySet<string>): string;
  propose(input: { title: string; rationale: string; operations: readonly Operation[]; actor: string; session?: string }): Promise<McpProposal> | McpProposal;
  sync(): Promise<McpSyncResult> | McpSyncResult;
}

export interface McpProposal {
  kind: "proposed";
  proposal: string;
  consequential: boolean;
  reasons: string[];
  commit?: string;
}

export interface McpSyncResult {
  pushed: boolean;
  findings?: ReadonlyArray<{ severity: string }>;
}
