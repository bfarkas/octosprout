import { describe, expect, it } from "vitest";

import { InvalidRequestError, parseInboxRequest, parseJsonBody } from "./request.js";

const valid = { text: "hello", idempotency_key: "20261025T140310-48213" };
const fieldOf = (body: unknown): string | undefined => {
  try {
    parseInboxRequest(body);
  } catch (error) {
    return (error as InvalidRequestError).field;
  }
  return undefined;
};

describe("parseInboxRequest", () => {
  it("accepts a minimal request and keeps the text verbatim", () => {
    const text = "  \r\n---\n🌱  é trailing  \n\n";
    expect(parseInboxRequest({ ...valid, text })).toEqual({ text, idempotencyKey: valid.idempotency_key, source: "other" });
  });

  it("accepts every field", () => {
    expect(
      parseInboxRequest({
        ...valid,
        source: "chatgpt",
        source_url: "https://chatgpt.com/share/abc123",
        client_created_at: "2026-10-25T16:03:10+02:00",
      }),
    ).toMatchObject({ source: "chatgpt", sourceUrl: "https://chatgpt.com/share/abc123", clientCreatedAt: "2026-10-25T16:03:10+02:00" });
  });

  it("stores an unknown source as other, with the submitted value as detail", () => {
    expect(parseInboxRequest({ ...valid, source: "telegram" })).toMatchObject({ source: "other", sourceDetail: "telegram" });
    expect(parseInboxRequest({ ...valid, source: "x".repeat(100) }).sourceDetail).toHaveLength(64);
    expect(parseInboxRequest({ ...valid, source: "" })).not.toHaveProperty("sourceDetail");
  });

  it("counts characters, not UTF-16 units, against the text limit", () => {
    expect(fieldOf({ ...valid, text: "🌱".repeat(100_000) })).toBeUndefined();
    expect(fieldOf({ ...valid, text: "🌱".repeat(100_001) })).toBe("text");
  });

  it.each([
    ["a non-object body", [], "body"],
    ["a null body", null, "body"],
    ["missing text", { idempotency_key: valid.idempotency_key }, "text"],
    ["numeric text", { ...valid, text: 5 }, "text"],
    ["blank text", { ...valid, text: " \n\t " }, "text"],
    ["a lone surrogate", { ...valid, text: "bad \ud800" }, "text"],
    ["a missing key", { text: "hi" }, "idempotency_key"],
    ["a short key", { ...valid, idempotency_key: "short" }, "idempotency_key"],
    ["a long key", { ...valid, idempotency_key: "a".repeat(129) }, "idempotency_key"],
    ["a key with a space", { ...valid, idempotency_key: "has space 123" }, "idempotency_key"],
    ["a non-string source", { ...valid, source: 5 }, "source"],
    ["an http URL", { ...valid, source_url: "http://example.com" }, "source_url"],
    ["a URL with whitespace", { ...valid, source_url: "https://example.com/a b" }, "source_url"],
    ["a too-long URL", { ...valid, source_url: `https://example.com/${"a".repeat(2048)}` }, "source_url"],
    ["a bad client timestamp", { ...valid, client_created_at: "yesterday" }, "client_created_at"],
    ["a client timestamp without an offset", { ...valid, client_created_at: "2026-10-25T16:03:10" }, "client_created_at"],
  ])("rejects %s", (_label, body, field) => {
    expect(fieldOf(body)).toBe(field);
  });

  it("accepts keys made only of digits and symbols", () => {
    expect(fieldOf({ ...valid, idempotency_key: "12345678" })).toBeUndefined();
    expect(fieldOf({ ...valid, idempotency_key: "a.b_c:d-e" })).toBeUndefined();
  });
});

describe("parseJsonBody", () => {
  it("parses UTF-8 JSON", () => {
    expect(parseJsonBody(Buffer.from('{"text":"é🌱"}', "utf8"))).toEqual({ text: "é🌱" });
  });

  it("rejects invalid UTF-8 instead of replacing bytes", () => {
    expect(() => parseJsonBody(Buffer.from([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d]))).toThrow(/UTF-8/);
  });

  it("rejects invalid JSON", () => {
    expect(() => parseJsonBody(Buffer.from("{nope"))).toThrow(/JSON/);
  });
});
