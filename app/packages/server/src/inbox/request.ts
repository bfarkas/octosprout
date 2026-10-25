/**
 * Inbox API request validation (spec §15.2).
 */
import { Buffer } from "node:buffer";

export const MAX_TEXT_CHARACTERS = 100_000;
export const MAX_SOURCE_DETAIL_CHARACTERS = 64;
export const MAX_URL_CHARACTERS = 2048;

export const CAPTURE_SOURCES = ["shortcut", "chatgpt", "claude", "apple-notes", "web", "cli", "other"] as const;
export type CaptureSource = (typeof CAPTURE_SOURCES)[number];

export interface InboxRequest {
  /** Stored verbatim, untrimmed. */
  text: string;
  idempotencyKey: string;
  source: CaptureSource;
  /** The submitted value when it was not a known source. */
  sourceDetail?: string;
  sourceUrl?: string;
  /** Stored as provided, for reference. */
  clientCreatedAt?: string;
}

export class InvalidRequestError extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = "InvalidRequestError";
  }
}

const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,128}$/;
const HTTPS_URL = /^https:\/\/[^\s]+$/;
const RFC_3339 = /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/;

/** Decodes a request body as strict UTF-8 JSON, so invalid bytes are rejected instead of replaced. */
export function parseJsonBody(raw: Buffer): unknown {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
  } catch {
    throw new InvalidRequestError("body", "The request body is not valid UTF-8.");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new InvalidRequestError("body", "The request body is not valid JSON.");
  }
}

function codePoints(text: string): number {
  let count = 0;
  for (const _ of text) count++;
  return count;
}

function optionalString(body: Record<string, unknown>, field: string): string | undefined {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new InvalidRequestError(field, `'${field}' must be a string.`);
  return value;
}

export function parseInboxRequest(body: unknown): InboxRequest {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new InvalidRequestError("body", "The request body must be a JSON object.");
  }
  const fields = body as Record<string, unknown>;

  const text = fields.text;
  if (typeof text !== "string") throw new InvalidRequestError("text", "'text' is required and must be a string.");
  if (!text.isWellFormed()) throw new InvalidRequestError("text", "'text' is not valid Unicode.");
  if (text.trim() === "") throw new InvalidRequestError("text", "'text' must not be empty.");
  if (codePoints(text) > MAX_TEXT_CHARACTERS) {
    throw new InvalidRequestError("text", `'text' must be at most ${MAX_TEXT_CHARACTERS} characters.`);
  }

  const idempotencyKey = fields.idempotency_key;
  if (typeof idempotencyKey !== "string" || !IDEMPOTENCY_KEY.test(idempotencyKey)) {
    throw new InvalidRequestError("idempotency_key", "'idempotency_key' is required: 8-128 characters from A-Z a-z 0-9 . _ : -");
  }

  const request: InboxRequest = { text, idempotencyKey, source: "other" };

  const source = optionalString(fields, "source");
  if (source !== undefined) {
    if ((CAPTURE_SOURCES as readonly string[]).includes(source)) {
      request.source = source as CaptureSource;
    } else if (source !== "") {
      request.sourceDetail = [...source].slice(0, MAX_SOURCE_DETAIL_CHARACTERS).join("");
    }
  }

  const sourceUrl = optionalString(fields, "source_url");
  if (sourceUrl !== undefined) {
    if (sourceUrl.length > MAX_URL_CHARACTERS || !HTTPS_URL.test(sourceUrl) || !URL.canParse(sourceUrl)) {
      throw new InvalidRequestError("source_url", `'source_url' must be an https URL of at most ${MAX_URL_CHARACTERS} characters.`);
    }
    request.sourceUrl = sourceUrl;
  }

  const clientCreatedAt = optionalString(fields, "client_created_at");
  if (clientCreatedAt !== undefined) {
    if (clientCreatedAt.length > 64 || !RFC_3339.test(clientCreatedAt) || Number.isNaN(Date.parse(clientCreatedAt))) {
      throw new InvalidRequestError("client_created_at", "'client_created_at' must be an RFC 3339 timestamp.");
    }
    request.clientCreatedAt = clientCreatedAt;
  }

  return request;
}
