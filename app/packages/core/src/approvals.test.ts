import { generateKeyPairSync } from "node:crypto";

import { describe, expect, it } from "vitest";

import { type Approval, canonicalJson, formatPublicKey, opsSha256, parsePrivateKey, parsePublicKey, signApproval, verifyApproval } from "./approvals.js";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const keys = [{ id: "rei3-2026-10", key: publicKey }];
const operations = [{ op: "set_status", id: "OS-I-2HD9W", base_blob: "9ae1", status: "transplanted" }];
const sign = () => signApproval("OS-PROP-8V3KD", operations, "approved", "2026-10-25T15:07:42Z", { id: "rei3-2026-10", privateKey });

describe("canonicalJson", () => {
  it("sorts keys at every level and drops whitespace", () => {
    expect(canonicalJson({ b: 1, a: [{ z: true, y: null }], "é": "ü\n" })).toBe('{"a":[{"y":null,"z":true}],"b":1,"é":"ü\\n"}');
  });

  it("does not depend on key order", () => {
    expect(opsSha256([{ op: "x", id: "a" }])).toBe(opsSha256([{ id: "a", op: "x" }]));
  });
});

describe("approvals", () => {
  it("round-trip: sign, then verify", () => {
    const approval = sign();
    expect(approval).toMatchObject({ decision: "approved", key_id: "rei3-2026-10", ops_sha256: opsSha256(operations) });
    expect(approval.signature).toMatch(/^ed25519:[A-Za-z0-9+/]+={0,2}$/);
    expect(verifyApproval("OS-PROP-8V3KD", operations, approval, keys)).toEqual({ ok: true });
  });

  it.each([
    ["changed operations", "OS-PROP-8V3KD", [{ ...operations[0], status: "composted" }], {}, "ops_mismatch"],
    ["another proposal", "OS-PROP-11111", operations, {}, "bad_signature"],
    ["a changed decision", "OS-PROP-8V3KD", operations, { decision: "rejected" }, "bad_signature"],
    ["a changed time", "OS-PROP-8V3KD", operations, { at: "2026-10-25T15:07:43Z" }, "bad_signature"],
    ["an unknown key", "OS-PROP-8V3KD", operations, { key_id: "laptop" }, "unknown_key"],
    ["a garbage signature", "OS-PROP-8V3KD", operations, { signature: "ed25519:AAAA" }, "bad_signature"],
  ])("rejects %s", (_label, id, ops, change, reason) => {
    expect(verifyApproval(id, ops, { ...sign(), ...change } as Approval, keys)).toEqual({ ok: false, reason });
  });

  it("rejects a signature by an untrusted key under a trusted key ID", () => {
    const other = generateKeyPairSync("ed25519").privateKey;
    const forged = signApproval("OS-PROP-8V3KD", operations, "approved", "2026-10-25T15:07:42Z", { id: "rei3-2026-10", privateKey: other });
    expect(verifyApproval("OS-PROP-8V3KD", operations, forged, keys)).toEqual({ ok: false, reason: "bad_signature" });
  });
});

describe("keys", () => {
  it("formats and parses public keys", () => {
    const text = formatPublicKey(publicKey);
    expect(text).toMatch(/^ed25519:[A-Za-z0-9+/]{43}=$/);
    expect(formatPublicKey(privateKey)).toBe(text);
    expect(formatPublicKey(parsePublicKey(text)!)).toBe(text);
  });

  it.each(["ed25519:AAAA", "rsa:AAAA", `ed25519:${"A".repeat(43)}`])("rejects %s", (text) => {
    expect(parsePublicKey(text)).toBeUndefined();
  });

  it("reads a PEM private key and refuses other key types", () => {
    const pem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    expect(formatPublicKey(parsePrivateKey(pem))).toBe(formatPublicKey(publicKey));
    const rsa = generateKeyPairSync("rsa", { modulusLength: 1024 }).privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    expect(() => parsePrivateKey(rsa)).toThrow(/Ed25519/);
  });
});
