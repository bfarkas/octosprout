/** The small workspace surface used by the MCP tools and their plans. */
import type { Operation, RecordIndex, RecordType, WorkspaceConfig } from "@octosprout/core";

export interface McpBackend {
  readonly root: string;
  readonly index: RecordIndex;
  config(): WorkspaceConfig;
  now(): string;
  newId(type: RecordType, taken?: ReadonlySet<string>): string;
  /** Commits a routine change to tasks directly (ADR008); anything else becomes a proposal. */
  write(input: { operations: readonly Operation[]; title: string; rationale: string; actor: string; operation: string; subject: string; session?: string }): Promise<McpWrite> | McpWrite;
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

export type McpWrite = { kind: "committed"; commit: string } | McpProposal;

export interface McpSyncResult {
  pushed: boolean;
  findings?: ReadonlyArray<{ severity: string }>;
}
