import { describe, expect, it } from "vitest";

import { scanForSecrets } from "./secrets.js";

describe("scanForSecrets", () => {
  it.each([
    ["a GitHub token", `token: ghp_${"aB3".repeat(12)}`],
    ["an Anthropic key", "key sk-ant-api03-abcdefghijklmnopqrstuvwxyz"],
    ["an AWS key", "AKIAIOSFODNN7EXAMPLE"],
    ["a private key", "-----BEGIN OPENSSH PRIVATE KEY-----"],
    ["an inbox token", `ost_${"Zx9_".repeat(11)}`],
    // Assembled at runtime so that secret scanners on this repository do not flag the fixture.
    ["a random string", ["secret=", "Q8vT2mLp9XrK", "4wNz7bYc3HdF", "6jGs1aEu"].join("")],
  ])("flags %s", (_label, text) => {
    const hits = scanForSecrets(`first line\n${text}\n`);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.index).toBe(1);
    expect(text).not.toBe(hits[0]?.preview);
  });

  it.each([
    ["commit and content hashes", "base_blob: 4f1c2e9a0b7d3c5e6f8091a2b3c4d5e6f7a8b9c0 9b1f0c4f1c2e9a0b7d3c5e6f8091a2b3c4d5e6f7a8b9c04f1c2e9a0b7d3c5e"],
    ["signatures", "signature: \"ed25519:Q8vT2mLp9XrK4wNz7bYc3HdF6jGs1aEu/Q8vT2mLp9XrK4wNz7bYc3HdF6jGs1aEu+Q8vT2mLp9XrK4wNz7bYc3HdF6jGs1aEu==\""],
    ["share links and UUIDs", "https://chatgpt.com/share/6720f3a1-8b2c-8000-9d4e-0f1a2b3c4d5e"],
    ["ordinary prose", "OctoSprout_is_a_personal_markdown_first_workspace_for_ideas"],
    ["record IDs", "OS-C-7K3QX OS-PROP-8V3KD"],
  ])("ignores %s", (_label, text) => {
    expect(scanForSecrets(text)).toEqual([]);
  });
});
