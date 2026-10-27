import { describe, expect, it } from "vitest";

import { parseRecord, renderRecord, setFrontmatterFields, sha256Hex } from "./record.js";

function parsed(text: string) {
  const result = parseRecord(text);
  if (!result.ok) throw new Error(result.error.message);
  return result.record;
}

describe("parseRecord", () => {
  it("splits frontmatter from the body and keeps timestamps as strings", () => {
    const record = parsed("---\nid: OS-C-7K3QX\ncreated: 2026-10-25T14:03:11Z\n---\nhello\n");
    expect(record.frontmatter).toEqual({ id: "OS-C-7K3QX", created: "2026-10-25T14:03:11Z" });
    expect(record.body).toBe("hello\n");
  });

  it("records the file line of each top-level key", () => {
    const record = parsed("---\nid: a\ntags: [x]\nstatus: new\n---\n");
    expect(record.keyLines).toEqual({ id: 2, tags: 3, status: 4 });
  });

  it("keeps the body verbatim: CRLF, leading dashes, whitespace and emoji", () => {
    const body = "  ---\r\nline one \r\n\r\n🌱 <b>x</b>\n\n";
    expect(parsed(`---\nid: a\n---\n${body}`).body).toBe(body);
  });

  it("only treats the first closing delimiter as the end of the frontmatter", () => {
    expect(parsed("---\nid: a\n---\n---\nid: b\n---\n").body).toBe("---\nid: b\n---\n");
  });

  it("accepts a closing delimiter at the end of the file and empty frontmatter", () => {
    expect(parsed("---\nid: a\n---").body).toBe("");
    expect(parsed("---\n---\nbody").frontmatter).toEqual({});
  });

  it.each([
    ["no frontmatter", "just text\n"],
    ["a BOM", "﻿---\nid: a\n---\n"],
    ["an unclosed block", "---\nid: a\nbody\n"],
    ["a CRLF closing line", "---\nid: a\r\n---\r\nbody"],
    ["invalid YAML", "---\nid: [unclosed\n---\n"],
    ["duplicate keys", "---\nid: a\nid: b\n---\n"],
    ["a non-mapping", "---\n- a\n- b\n---\n"],
  ])("rejects %s", (_label, text) => {
    expect(parseRecord(text).ok).toBe(false);
  });
});

describe("renderRecord", () => {
  it("round-trips frontmatter, x- keys and the body", () => {
    const frontmatter = {
      id: "OS-I-2HD9W",
      created: "2026-10-25T15:00:00Z",
      tags: ["memory", "agents"],
      links: [{ rel: "derived_from", id: "OS-C-7K3QX" }],
      "x-board": { lane: 2 },
    };
    const body = "## Motivation\r\n\n";
    const record = parsed(renderRecord(frontmatter, body));
    expect(record.frontmatter).toEqual(frontmatter);
    expect(record.body).toBe(body);
  });
});

describe("sha256Hex", () => {
  it("hashes UTF-8 bytes", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("setFrontmatterFields", () => {
  const text = [
    "---",
    "id: OS-T-QF81M",
    "title: Old  # keep",
    "tags: [a, b]",
    "links:",
    "  - { rel: blocks, id: OS-T-AAAAA }",
    "refs:",
    "  - kind: repo",
    "    url: https://github.com/bfarkas/x",
    "x-board: { lane: 1 }",
    "---",
    "body\n",
  ].join("\n");

  it("replaces only the named fields and keeps the rest byte for byte", () => {
    const out = setFrontmatterFields(text, {
      title: "New: title",
      tags: ["c"],
      links: [{ rel: "blocks", id: "OS-T-AAAAA" }, { rel: "relates_to", id: "OS-I-2HD9W" }],
    });
    expect(out).toBe(
      [
        "---",
        "id: OS-T-QF81M",
        'title: "New: title"  # keep',
        "tags: [c]",
        "links:",
        "  - { rel: blocks, id: OS-T-AAAAA }",
        "  - { rel: relates_to, id: OS-I-2HD9W }",
        "refs:",
        "  - kind: repo",
        "    url: https://github.com/bfarkas/x",
        "x-board: { lane: 1 }",
        "---",
        "body\n",
      ].join("\n"),
    );
  });

  it("quotes list items that are not plain words", () => {
    expect(setFrontmatterFields("---\n---\n", { tags: ["a-b", "x: y", "1"] })).toBe('---\ntags: [a-b, "x: y", "1"]\n---\n');
  });

  it("removes fields set to undefined or an empty list, and appends new ones", () => {
    const out = setFrontmatterFields(text, { links: undefined, tags: [], refs: [{ kind: "pr", url: "https://github.com/bfarkas/x/pull/1", note: "first slice" }], approval: "OS-PROP-8V3KD" });
    expect(out).toBe(
      [
        "---",
        "id: OS-T-QF81M",
        "title: Old  # keep",
        "refs:",
        "  - kind: pr",
        "    url: https://github.com/bfarkas/x/pull/1",
        "    note: first slice",
        "x-board: { lane: 1 }",
        "approval: OS-PROP-8V3KD",
        "---",
        "body\n",
      ].join("\n"),
    );
    const parsed = parseRecord(out);
    expect(parsed.ok && parsed.record.frontmatter.refs).toEqual([{ kind: "pr", url: "https://github.com/bfarkas/x/pull/1", note: "first slice" }]);
  });
});
