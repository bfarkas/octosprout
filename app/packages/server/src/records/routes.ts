/**
 * Record JSON API for the browser UI: status moves and board versions
 * (boards.md §3, §5). Every route needs a session; moves also need the
 * Origin and CSRF checks of `requireSession`.
 */
import type { RecordType } from "@octosprout/core";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { FormEdit, Operation } from "@octosprout/core";

import { editRecord } from "./edit.js";
import type { DecisionOutcome, ProposalService } from "./proposals.js";
import { triageCapture, type TriageAction } from "./triage.js";
import { moveStatus, type StatusMoveDeps } from "./status.js";

export interface RecordRoutesOptions extends StatusMoveDeps {
  requireSession: (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply | undefined>;
  /** True if the session verified a passkey in the last five minutes. */
  recentlyVerified: (request: FastifyRequest) => boolean;
  proposals?: ProposalService;
}

/** Maps an approval decision to its HTTP response. */
function respondDecision(reply: FastifyReply, outcome: DecisionOutcome, extra: Record<string, unknown> = {}): FastifyReply {
  switch (outcome.kind) {
    case "done":
      return reply.send({ status: outcome.status, commit: outcome.commit, proposal: outcome.proposal, ...extra });
    case "not_found":
      return reply.code(404).send({ error: "not_found" });
    case "not_pending":
      return reply.code(422).send({ error: "not_pending", message: `The proposal is already ${outcome.status}.` });
    case "no_key":
      return reply.code(503).send({ error: "no_signing_key", message: "The server has no approval signing key, so nothing can be approved." });
    case "reverify_required":
      return reply.code(428).send({ error: "reverify_required", reasons: outcome.reasons, message: "Confirm with your passkey first." });
    case "stale":
      return reply.code(409).send({ error: "stale", message: outcome.message });
    case "conflict":
      return reply.code(409).send({ error: "conflict", path: outcome.path });
    case "invalid":
      return reply.code(422).send({
        error: outcome.findings ? "validation" : "invalid",
        message: outcome.message,
        ...(outcome.findings ? { findings: outcome.findings.map(({ code, path, message, hint }) => ({ code, path, message, hint })) } : {}),
      });
  }
}

/** Board name in URLs → record type. */
export const BOARDS: Readonly<Record<string, RecordType>> = {
  ideas: "idea",
  tasks: "task",
  projects: "project",
  decisions: "decision",
};

const SHA = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

export function registerRecordRoutes(app: FastifyInstance, options: RecordRoutesOptions): void {
  const { requireSession, records } = options;

  app.post<{ Params: { id: string } }>("/api/v1/records/:id/status", { preHandler: requireSession }, async (request, reply) => {
    const body = (request.body ?? {}) as { to?: unknown; base_blob?: unknown };
    if (typeof body.to !== "string" || body.to === "") {
      return reply.code(400).send({ error: "invalid_request", field: "to", message: "'to' is required." });
    }
    if (typeof body.base_blob !== "string" || !SHA.test(body.base_blob)) {
      return reply.code(400).send({ error: "invalid_request", field: "base_blob", message: "'base_blob' must be the blob SHA the page was rendered from." });
    }

    const outcome = await moveStatus(options, { id: request.params.id, to: body.to, baseBlob: body.base_blob, actor: "user:web" });
    // A consequential move the user confirmed is proposed and applied in one commit (§9.1).
    if (outcome.kind === "approval_required" && (body as { approve?: unknown }).approve === true && (outcome.move === "approval" || outcome.move === "bulk")) {
      if (!options.proposals) return reply.code(503).send({ error: "no_signing_key" });
      const decision = await options.proposals.proposeAndApply({
        title: `Move ${request.params.id} from ${outcome.from} to ${outcome.to}`,
        rationale: "Moved in the browser and confirmed with a passkey.",
        operations: outcome.operations,
        actor: "user:web",
        verified: options.recentlyVerified(request),
      });
      return respondDecision(reply, decision, { base_blob: records.index.get(request.params.id)?.blob });
    }
    switch (outcome.kind) {
      case "moved":
        request.log.info({ id: request.params.id, to: body.to, unblocked: outcome.unblocked.length, status: outcome.status }, "status moved");
        return { status: outcome.status, commit: outcome.commit, base_blob: outcome.base_blob, unblocked: outcome.unblocked };
      case "unchanged":
        return { status: "unchanged" };
      case "not_found":
        return reply.code(404).send({ error: "not_found" });
      case "transition":
        return reply.code(422).send({ error: "transition", from: outcome.from, to: outcome.to });
      case "approval_required":
        return reply.code(403).send({ error: "approval_required", move: outcome.move, from: outcome.from, to: outcome.to, ...(options.proposals?.hasKey ? options.proposals.preview(outcome.operations) : {}) });
      case "conflict": {
        const { kind: _kind, ...conflict } = outcome;
        return reply.code(409).send({ error: "conflict", ...conflict });
      }
      case "invalid":
        return reply.code(422).send({
          error: "validation",
          findings: outcome.findings.map(({ code, path, message, hint }) => ({ code, path, message, hint })),
        });
    }
  });

  app.put<{ Params: { id: string } }>("/api/v1/records/:id", { preHandler: requireSession }, async (request, reply) => {
    const body = (request.body ?? {}) as { base_blob?: unknown; content?: unknown; form?: unknown };
    if (typeof body.base_blob !== "string" || !SHA.test(body.base_blob)) {
      return reply.code(400).send({ error: "invalid_request", field: "base_blob", message: "'base_blob' must be the blob SHA the editor was loaded from." });
    }
    const form = body.content === undefined ? parseForm(body.form) : undefined;
    if (body.content !== undefined && typeof body.content !== "string") {
      return reply.code(400).send({ error: "invalid_request", field: "content", message: "'content' must be the whole file as a string." });
    }
    if (body.content === undefined && typeof form === "string") {
      const field = form === "form" ? "form" : `form.${form}`;
      return reply.code(400).send({ error: "invalid_request", field, message: form === "form" ? "Send either 'content' or 'form'." : `'${field}' is malformed.` });
    }

    const outcome = await editRecord(options, {
      id: request.params.id,
      baseBlob: body.base_blob,
      actor: "user:web",
      ...(typeof body.content === "string" ? { content: body.content } : { form: form as FormEdit }),
    });
    if (outcome.kind === "approval_required" && (body as { approve?: unknown }).approve === true) {
      if (!options.proposals) return reply.code(503).send({ error: "no_signing_key" });
      const decision = await options.proposals.proposeAndApply({
        title: `Edit ${request.params.id}`,
        rationale: "Edited in the browser and confirmed with a passkey.",
        operations: outcome.operations,
        actor: "user:web",
        verified: options.recentlyVerified(request),
      });
      return respondDecision(reply, decision, { base_blob: records.index.get(request.params.id)?.blob });
    }
    switch (outcome.kind) {
      case "saved":
        request.log.info({ id: request.params.id, status: outcome.status }, "record edited");
        return { status: outcome.status, commit: outcome.commit, base_blob: outcome.base_blob };
      case "unchanged":
        return { status: "unchanged" };
      case "not_found":
        return reply.code(404).send({ error: "not_found" });
      case "forbidden":
        return reply.code(422).send({ error: "forbidden", ...(outcome.field ? { field: outcome.field } : {}), message: outcome.message });
      case "approval_required":
        return reply.code(403).send({ error: "approval_required", message: outcome.message, ...(options.proposals?.hasKey ? options.proposals.preview(outcome.operations) : {}) });
      case "conflict": {
        const { kind: _kind, ...conflict } = outcome;
        return reply.code(409).send({ error: "conflict", ...conflict });
      }
      case "invalid":
        return reply.code(422).send({ error: "validation", findings: outcome.findings.map(({ code, path, message, hint }) => ({ code, path, message, hint })) });
    }
  });

  app.post<{ Params: { id: string } }>("/api/v1/captures/:id/triage", { preHandler: requireSession }, async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    if (typeof body.base_blob !== "string" || !SHA.test(body.base_blob)) {
      return reply.code(400).send({ error: "invalid_request", field: "base_blob", message: "'base_blob' must be the capture's blob SHA." });
    }
    const triage = parseTriage(body);
    if (typeof triage === "string") return reply.code(400).send({ error: "invalid_request", field: triage, message: `'${triage}' is missing or malformed.` });

    const outcome = await triageCapture(options, { captureId: request.params.id, baseBlob: body.base_blob, actor: "user:web", triage });
    switch (outcome.kind) {
      case "done":
        request.log.info({ capture: request.params.id, action: triage.action, id: outcome.id, status: outcome.status }, "capture triaged");
        return { status: outcome.status, commit: outcome.commit, id: outcome.id };
      case "not_found":
        return reply.code(404).send({ error: "not_found" });
      case "forbidden":
        return reply.code(422).send({ error: "forbidden", message: outcome.message });
      case "conflict":
        return reply.code(409).send({ error: "conflict", path: outcome.path, current_blob: outcome.current_blob });
      case "invalid":
        return reply.code(422).send({ error: "validation", findings: outcome.findings.map(({ code, path, message, hint }) => ({ code, path, message, hint })) });
    }
  });

  const proposals = options.proposals;
  if (proposals) {
    app.post("/api/v1/proposals", { preHandler: requireSession }, async (request, reply) => {
      const body = (request.body ?? {}) as Record<string, unknown>;
      if (!isString(body.title) || body.title.trim() === "") return reply.code(400).send({ error: "invalid_request", field: "title", message: "'title' is required." });
      if (!Array.isArray(body.operations) || !body.operations.every((op) => typeof op === "object" && op !== null && isString((op as { op?: unknown }).op))) {
        return reply.code(400).send({ error: "invalid_request", field: "operations", message: "'operations' must be a list of operations (§9.3)." });
      }
      const created = await proposals.create({
        title: body.title.trim(),
        rationale: isString(body.rationale) ? body.rationale : "",
        operations: body.operations as Operation[],
        actor: "user:web",
      });
      if (created.kind === "invalid") {
        return reply.code(422).send({ error: created.findings ? "validation" : "invalid", message: created.message, ...(created.findings ? { findings: created.findings.map(({ code, path, message, hint }) => ({ code, path, message, hint })) } : {}) });
      }
      return reply.code(201).send({ id: created.id, status: created.status });
    });

    app.post<{ Params: { id: string } }>("/api/v1/proposals/:id/approve", { preHandler: requireSession }, async (request, reply) =>
      respondDecision(reply, await proposals.approve(request.params.id, { verified: options.recentlyVerified(request), actor: "user:web" })),
    );

    app.post<{ Params: { id: string } }>("/api/v1/proposals/:id/reject", { preHandler: requireSession }, async (request, reply) =>
      respondDecision(reply, await proposals.reject(request.params.id, { actor: "user:web" })),
    );

    // Bulk approval is for routine proposals only: it never counts as a passkey verification (§9.1).
    app.post("/api/v1/proposals/approve-bulk", { preHandler: requireSession }, async (request, reply) => {
      const ids = (request.body as { ids?: unknown } | null)?.ids;
      if (!Array.isArray(ids) || !ids.every(isString) || ids.length === 0) return reply.code(400).send({ error: "invalid_request", field: "ids", message: "'ids' must list proposal IDs." });
      const results: Array<{ id: string; result: string; message?: string }> = [];
      for (const id of ids) {
        const outcome = await proposals.approve(id, { verified: false, actor: "user:web" });
        results.push(
          outcome.kind === "done"
            ? { id, result: outcome.status }
            : { id, result: outcome.kind, ...(outcome.kind === "stale" || outcome.kind === "invalid" ? { message: outcome.message } : {}) },
        );
      }
      return { results };
    });

    // The first key: the server trusts its own key, with a proposal it signs itself (setup, §9.4).
    app.post("/api/v1/approval-key/trust", { preHandler: requireSession }, async (request, reply) => {
      const plan = proposals.trustKeyOperations();
      if (!plan.ok) return reply.code(422).send({ error: "invalid", message: plan.message });
      return respondDecision(
        reply,
        await proposals.proposeAndApply({
          title: `Trust the server's approval key ${proposals.signingKey!.id}`,
          rationale: "The workspace trusted no approval key yet. The server adds its own public key to approval_public_keys, confirmed with a passkey.",
          operations: plan.operations,
          actor: "user:web",
          verified: options.recentlyVerified(request),
        }),
      );
    });
  }

  app.get<{ Params: { board: string } }>("/api/v1/boards/:board/version", { preHandler: requireSession }, async (request, reply) => {
    const type = BOARDS[request.params.board];
    if (!type) return reply.code(404).send({ error: "not_found" });
    const version = records.index.version(type);
    return reply.header("ETag", `"${version}"`).send({ version });
  });
}

const isString = (value: unknown): value is string => typeof value === "string";

/** A form edit, or the name of the first malformed field. */
function parseForm(value: unknown): FormEdit | string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "form";
  const raw = value as Record<string, unknown>;
  const form: FormEdit = {};
  if (raw.title !== undefined) {
    if (!isString(raw.title)) return "title";
    form.title = raw.title;
  }
  if (raw.body !== undefined) {
    if (!isString(raw.body)) return "body";
    form.body = raw.body;
  }
  if (raw.tags !== undefined) {
    if (!Array.isArray(raw.tags) || !raw.tags.every(isString)) return "tags";
    form.tags = raw.tags;
  }
  if (raw.links !== undefined) {
    if (!Array.isArray(raw.links)) return "links";
    const links: NonNullable<FormEdit["links"]> = [];
    for (const item of raw.links as unknown[]) {
      const { rel, id } = (item ?? {}) as Record<string, unknown>;
      if (!isString(rel) || !isString(id)) return "links";
      links.push({ rel, id });
    }
    form.links = links;
  }
  if (raw.refs !== undefined) {
    if (!Array.isArray(raw.refs)) return "refs";
    const refs: NonNullable<FormEdit["refs"]> = [];
    for (const item of raw.refs as unknown[]) {
      const { kind, url, note } = (item ?? {}) as Record<string, unknown>;
      if (!isString(kind) || !isString(url) || (note !== undefined && !isString(note))) return "refs";
      refs.push({ kind, url, ...(isString(note) && note !== "" ? { note } : {}) });
    }
    form.refs = refs;
  }
  return form;
}

/** A triage action, or the name of the first missing or malformed field. */
function parseTriage(body: Record<string, unknown>): TriageAction | string {
  switch (body.action) {
    case "create":
      if (body.type !== "idea" && body.type !== "task" && body.type !== "research") return "type";
      if (!isString(body.title)) return "title";
      if (!isString(body.body)) return "body";
      return { action: "create", type: body.type, title: body.title, body: body.body };
    case "attach":
      return isString(body.target) ? { action: "attach", target: body.target } : "target";
    case "compost":
    case "restore":
      return { action: body.action };
    default:
      return "action";
  }
}
