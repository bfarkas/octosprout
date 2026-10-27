/**
 * Record JSON API for the browser UI: status moves and board versions
 * (boards.md §3, §5). Every route needs a session; moves also need the
 * Origin and CSRF checks of `requireSession`.
 */
import type { RecordType } from "@octosprout/core";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { FormEdit } from "@octosprout/core";

import { editRecord } from "./edit.js";
import { triageCapture, type TriageAction } from "./triage.js";
import { moveStatus, type StatusMoveDeps } from "./status.js";

export interface RecordRoutesOptions extends StatusMoveDeps {
  requireSession: (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply | undefined>;
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
        return reply.code(403).send({ error: "approval_required", move: outcome.move, from: outcome.from, to: outcome.to });
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
        return reply.code(403).send({ error: "approval_required", message: outcome.message });
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
