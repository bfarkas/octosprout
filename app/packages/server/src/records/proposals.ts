/**
 * Proposals and signed approvals (spec §9).
 *
 * Applying a proposal re-checks every `base_blob`, applies its operations,
 * signs the approval with the server's key, writes `approval:` into each
 * record whose consequential state it authorizes, and commits all of it as
 * one commit. A consequential proposal also needs a passkey verification
 * from the last five minutes. Consequential moves made in the browser go
 * through the same path: the server writes a proposal and applies it in the
 * same commit.
 */
import {
  applyOperations,
  classifyOperations,
  CONFIG_PATH,
  completeOperations,
  decideProposal,
  formatPublicKey,
  generateId,
  proposalPath,
  readOperations,
  renderProposal,
  signApproval,
  stampApprovals,
  withApprovalKeys,
  workspaceLookup,
  type Classification,
  type FileChange,
  type Operation,
  type WorkspaceLookup,
} from "@octosprout/core";

import type { SigningKey } from "../approvals/signing-key.js";
import { ConflictError, ValidationRejectedError, type WriteResult } from "../git/write-service.js";
import { formatTimestamp } from "../inbox/capture.js";
import type { StatusMoveDeps } from "./status.js";

export interface ProposalDeps extends StatusMoveDeps {
  /** The server's signing key. Without it nothing can be approved or rejected. */
  signingKey?: SigningKey;
  head: () => Promise<string>;
}

export type DecisionOutcome =
  | { kind: "done"; status: "committed" | "pending"; commit: string; proposal: string; consequential: boolean }
  | { kind: "not_found" }
  | { kind: "not_pending"; status: string }
  | { kind: "no_key" }
  /** A consequential approval needs a fresh passkey verification first. */
  | { kind: "reverify_required"; reasons: string[] }
  /** The workspace moved on; the proposal was marked stale. */
  | { kind: "stale"; message: string }
  | { kind: "invalid"; message: string; findings?: ValidationRejectedError["findings"] }
  | { kind: "conflict"; path: string };

export interface Preview {
  ok: boolean;
  message?: string;
  classification?: Classification;
  /** Every changed file: path, before and after. */
  diff?: Array<{ path: string; before: string | null; after: string | null }>;
}

export class ProposalService {
  readonly #deps: ProposalDeps;

  constructor(deps: ProposalDeps) {
    this.#deps = deps;
  }

  get hasKey(): boolean {
    return this.#deps.signingKey !== undefined;
  }

  /** True when approvals can be made: the server has a signing key and octosprout.yaml trusts it. */
  approvalsReady(): boolean {
    const key = this.#deps.signingKey;
    return key !== undefined && this.#deps.records.config().approvalKeys.some((trusted) => formatPublicKey(trusted.key) === key.publicKey);
  }

  get signingKey(): SigningKey | undefined {
    return this.#deps.signingKey;
  }

  #now(): string {
    return formatTimestamp((this.#deps.now ?? (() => new Date()))());
  }

  #lookup(): WorkspaceLookup {
    const { records } = this.#deps;
    return workspaceLookup(records.index, (path) => records.readFile(path));
  }

  /** What applying a proposal's operations would change now, for the review page and dialogs. */
  preview(operations: readonly Operation[]): Preview {
    const lookup = this.#lookup();
    const applied = applyOperations(operations, lookup, this.#now());
    if (!applied.ok) return { ok: false, message: applied.message };
    return {
      ok: true,
      classification: classifyOperations(operations, lookup, applied, this.#deps.records.config().bulkThreshold),
      diff: applied.changes.map((change) => ({
        path: change.path,
        before: lookup.byPath(change.path)?.text ?? null,
        after: "content" in change ? change.content : null,
      })),
    };
  }

  /** Commits a new pending proposal (from the UI, the CLI or an agent). */
  async create(input: { title: string; rationale: string; operations: readonly Operation[]; actor: string; session?: string }): Promise<{ kind: "created"; id: string; status: "committed" | "pending" } | { kind: "invalid"; message: string; findings?: ValidationRejectedError["findings"] }> {
    if (input.operations.length === 0) return { kind: "invalid", message: "A proposal needs at least one operation." };
    const preview = this.preview(input.operations);
    if (!preview.ok) return { kind: "invalid", message: preview.message ?? "The operations do not apply." };
    const now = this.#now();
    const id = generateId("proposal", { exists: (candidate) => this.#deps.records.index.has(candidate) });
    const path = proposalPath(id, now);
    const text = renderProposal({
      id,
      title: input.title,
      actor: input.actor,
      ...(input.session ? { session: input.session } : {}),
      baseCommit: await this.#deps.head(),
      consequential: preview.classification!.consequential,
      operations: input.operations,
      rationale: input.rationale,
      now,
    });
    try {
      const result = await this.#deps.writer.submit({
        operation: "propose",
        actor: input.actor,
        subject: `propose: ${id} ${input.title}`,
        proposal: id,
        preconditions: [{ path, baseBlob: null }],
        changes: [{ path, content: text }],
      });
      return { kind: "created", id, status: result.status === "committed" ? "committed" : "pending" };
    } catch (error) {
      if (error instanceof ValidationRejectedError) return { kind: "invalid", message: "The proposal is not valid.", findings: error.findings };
      throw error;
    }
  }

  /** Approves and applies a pending proposal in one commit. */
  async approve(id: string, options: { verified: boolean; actor: string }): Promise<DecisionOutcome> {
    const proposal = this.#deps.records.index.get(id);
    if (proposal?.type !== "proposal") return { kind: "not_found" };
    if (proposal.status !== "pending") return { kind: "not_pending", status: proposal.status };
    const operations = readOperations(proposal.frontmatter);
    if (!operations) return { kind: "invalid", message: "The proposal has no operations." };
    return this.#apply({ id: proposal.id, path: proposal.path, text: proposal.text, blob: proposal.blob, title: proposal.title, operations }, options);
  }

  /** Writes a proposal for `operations` and applies it, in the same commit. For consequential moves made in the browser. */
  async proposeAndApply(input: { title: string; rationale: string; operations: readonly Operation[]; actor: string; verified: boolean }): Promise<DecisionOutcome> {
    const now = this.#now();
    const id = generateId("proposal", { exists: (candidate) => this.#deps.records.index.has(candidate) });
    const preview = this.preview(input.operations);
    const text = renderProposal({
      id,
      title: input.title,
      actor: input.actor,
      baseCommit: await this.#deps.head(),
      consequential: preview.classification?.consequential ?? true,
      operations: input.operations,
      rationale: input.rationale,
      now,
    });
    return this.#apply({ id, path: proposalPath(id, now), text, blob: null, title: input.title, operations: input.operations }, input);
  }

  async #apply(
    proposal: { id: string; path: string; text: string; blob: string | null; title: string; operations: readonly Operation[] },
    options: { verified: boolean; actor: string },
  ): Promise<DecisionOutcome> {
    const key = this.#deps.signingKey;
    if (!key) return { kind: "no_key" };
    const now = this.#now();
    const lookup = this.#lookup();
    const applied = applyOperations(proposal.operations, lookup, now);
    if (!applied.ok) {
      if (applied.kind === "stale" && proposal.blob !== null) await this.#markStale(proposal, now, options.actor);
      return applied.kind === "stale" ? { kind: "stale", message: applied.message } : { kind: "invalid", message: applied.message };
    }
    const classification = classifyOperations(proposal.operations, lookup, applied, this.#deps.records.config().bulkThreshold);
    if (classification.consequential && !options.verified) return { kind: "reverify_required", reasons: classification.reasons };

    const operations = completeOperations(proposal.operations, lookup, applied);
    const changes: FileChange[] = stampApprovals(applied, lookup, classification.authorizes, proposal.id);
    const decided = decideProposal(proposal.text, {
      status: "applied",
      operations,
      consequential: classification.consequential,
      approval: signApproval(proposal.id, operations, "approved", now, key),
      now,
    });
    return this.#commit({
      subject: `apply-proposal: ${proposal.id} ${proposal.title}`,
      operation: "apply-proposal",
      proposal,
      decided,
      changes,
      preconditions: applied.preconditions,
      actor: options.actor,
      consequential: classification.consequential,
    });
  }

  /** Rejects a pending proposal with a signed rejection. */
  async reject(id: string, options: { actor: string }): Promise<DecisionOutcome> {
    const key = this.#deps.signingKey;
    if (!key) return { kind: "no_key" };
    const proposal = this.#deps.records.index.get(id);
    if (proposal?.type !== "proposal") return { kind: "not_found" };
    if (proposal.status !== "pending" && proposal.status !== "stale") return { kind: "not_pending", status: proposal.status };
    const operations = readOperations(proposal.frontmatter) ?? [];
    const now = this.#now();
    const decided = decideProposal(proposal.text, { status: "rejected", approval: signApproval(proposal.id, operations, "rejected", now, key), now });
    return this.#commit({
      subject: `reject-proposal: ${proposal.id} ${proposal.title}`,
      operation: "reject-proposal",
      proposal: { id: proposal.id, path: proposal.path, blob: proposal.blob },
      decided,
      changes: [],
      preconditions: [],
      actor: options.actor,
      consequential: proposal.frontmatter.consequential === true,
    });
  }

  async #markStale(proposal: { id: string; path: string; text: string; blob: string | null; title: string }, now: string, actor: string): Promise<void> {
    try {
      await this.#deps.writer.submit({
        operation: "status",
        actor,
        subject: `status: ${proposal.id} pending -> stale`,
        proposal: proposal.id,
        preconditions: [{ path: proposal.path, baseBlob: proposal.blob }],
        changes: [{ path: proposal.path, content: decideProposal(proposal.text, { status: "stale", now }) }],
      });
    } catch (error) {
      if (!(error instanceof ConflictError)) throw error;
    }
  }

  async #commit(input: {
    subject: string;
    operation: string;
    proposal: { id: string; path: string; blob: string | null };
    decided: string;
    changes: FileChange[];
    preconditions: ReadonlyArray<{ path: string; baseBlob: string | null }>;
    actor: string;
    consequential: boolean;
  }): Promise<DecisionOutcome> {
    let result: WriteResult;
    try {
      result = await this.#deps.writer.submit({
        operation: input.operation,
        actor: input.actor,
        subject: input.subject,
        proposal: input.proposal.id,
        preconditions: [{ path: input.proposal.path, baseBlob: input.proposal.blob }, ...input.preconditions],
        changes: [{ path: input.proposal.path, content: input.decided }, ...input.changes],
      });
    } catch (error) {
      if (error instanceof ConflictError) return { kind: "conflict", path: error.path };
      if (error instanceof ValidationRejectedError) {
        return { kind: "invalid", message: `It would add ${error.findings.length} validation error(s).`, findings: error.findings };
      }
      throw error;
    }
    if (result.status === "unchanged") return { kind: "invalid", message: "Nothing changed." };
    return { kind: "done", status: result.status, commit: result.commit, proposal: input.proposal.id, consequential: input.consequential };
  }

  /**
   * The operations that make the workspace trust this server's key: an
   * update (or creation) of octosprout.yaml. Offered only while it trusts no key.
   */
  trustKeyOperations(): { ok: true; operations: Operation[] } | { ok: false; message: string } {
    const key = this.#deps.signingKey;
    if (!key) return { ok: false, message: "The server has no approval signing key." };
    const { records } = this.#deps;
    // The server trusts itself only while no active key could approve it instead: on first
    // setup, or after the owner retired a lost key with a commit of their own (restore runbook).
    const trusted = records.config().approvalKeys;
    if (trusted.some((k) => k.status === "active")) return { ok: false, message: "The workspace already trusts an approval key; adding another needs an approval." };
    const file = records.readFile(CONFIG_PATH);
    const kept = trusted.map((k) => ({ id: k.id, key: formatPublicKey(k.key), status: k.status }));
    const content = withApprovalKeys(file?.text, [...kept, { id: key.id, key: key.publicKey }]);
    return {
      ok: true,
      operations: file ? [{ op: "update", path: CONFIG_PATH, base_blob: file.blob, content }] : [{ op: "create", path: CONFIG_PATH, content }],
    };
  }
}
