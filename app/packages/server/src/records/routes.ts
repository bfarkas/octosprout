/**
 * Record JSON API for the browser UI: status moves and board versions
 * (boards.md §3, §5). Every route needs a session; moves also need the
 * Origin and CSRF checks of `requireSession`.
 */
import type { RecordType } from "@octosprout/core";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

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

  app.get<{ Params: { board: string } }>("/api/v1/boards/:board/version", { preHandler: requireSession }, async (request, reply) => {
    const type = BOARDS[request.params.board];
    if (!type) return reply.code(404).send({ error: "not_found" });
    const version = records.index.version(type);
    return reply.header("ETag", `"${version}"`).send({ version });
  });
}
