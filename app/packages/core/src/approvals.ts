/**
 * Signed approvals (spec §9.3, §9.4).
 *
 * The server signs `{proposal, ops_sha256, decision, at}` with its Ed25519
 * key; everyone else only verifies. `ops_sha256` is the SHA-256 of the
 * canonical JSON of the proposal's `operations`.
 */
import { createPrivateKey, createPublicKey, sign, verify, type KeyObject } from "node:crypto";

import { sha256Hex } from "./record.js";

export type ApprovalDecision = "approved" | "rejected";

export interface Approval {
  decision: ApprovalDecision;
  at: string;
  key_id: string;
  ops_sha256: string;
  signature: string;
}

export interface TrustedKey {
  id: string;
  key: KeyObject;
}

const KEY_PREFIX = "ed25519:";

/**
 * JSON with object keys sorted by UTF-16 code units and no whitespace, as in
 * RFC 8785 for the strings, integers and booleans records contain.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const json = JSON.stringify(value);
    if (json === undefined) throw new TypeError(`Cannot canonicalize ${typeof value}`);
    return json;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

export function opsSha256(operations: unknown): string {
  return sha256Hex(canonicalJson(operations));
}

/** The exact bytes that are signed. */
export function approvalPayload(proposalId: string, approval: Pick<Approval, "decision" | "at" | "ops_sha256">): string {
  return canonicalJson({ proposal: proposalId, ops_sha256: approval.ops_sha256, decision: approval.decision, at: approval.at });
}

/** Signs an approval for `operations` with the server's private key. */
export function signApproval(
  proposalId: string,
  operations: unknown,
  decision: ApprovalDecision,
  at: string,
  key: { id: string; privateKey: KeyObject },
): Approval {
  const ops_sha256 = opsSha256(operations);
  const signature = sign(null, Buffer.from(approvalPayload(proposalId, { decision, at, ops_sha256 }), "utf8"), key.privateKey);
  return { decision, at, key_id: key.id, ops_sha256, signature: `${KEY_PREFIX}${signature.toString("base64")}` };
}

export type ApprovalCheck =
  | { ok: true }
  | { ok: false; reason: "ops_mismatch" | "unknown_key" | "bad_signature" };

/** Checks an approval block against the proposal's operations and the trusted keys. */
export function verifyApproval(proposalId: string, operations: unknown, approval: Approval, keys: readonly TrustedKey[]): ApprovalCheck {
  if (approval.ops_sha256 !== opsSha256(operations)) return { ok: false, reason: "ops_mismatch" };
  const trusted = keys.find((k) => k.id === approval.key_id);
  if (!trusted) return { ok: false, reason: "unknown_key" };
  if (!approval.signature.startsWith(KEY_PREFIX)) return { ok: false, reason: "bad_signature" };
  const signature = Buffer.from(approval.signature.slice(KEY_PREFIX.length), "base64");
  const payload = Buffer.from(approvalPayload(proposalId, approval), "utf8");
  try {
    return verify(null, payload, trusted.key, signature) ? { ok: true } : { ok: false, reason: "bad_signature" };
  } catch {
    return { ok: false, reason: "bad_signature" };
  }
}

/** Parses `ed25519:<base64 of the raw 32-byte public key>`. */
export function parsePublicKey(text: string): KeyObject | undefined {
  if (!text.startsWith(KEY_PREFIX)) return undefined;
  const raw = Buffer.from(text.slice(KEY_PREFIX.length), "base64");
  if (raw.length !== 32 || raw.toString("base64") !== text.slice(KEY_PREFIX.length)) return undefined;
  try {
    return createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: raw.toString("base64url") }, format: "jwk" });
  } catch {
    return undefined;
  }
}

/** Formats a public key the way `approval_public_keys` lists it. */
export function formatPublicKey(key: KeyObject): string {
  const jwk = (key.type === "private" ? createPublicKey(key) : key).export({ format: "jwk" });
  if (jwk.crv !== "Ed25519" || typeof jwk.x !== "string") throw new TypeError("Not an Ed25519 key");
  return `${KEY_PREFIX}${Buffer.from(jwk.x, "base64url").toString("base64")}`;
}

/** Reads a PEM (PKCS#8) Ed25519 private key, such as the `approval_signing_key` secret. */
export function parsePrivateKey(pem: string): KeyObject {
  const key = createPrivateKey(pem);
  if (key.asymmetricKeyType !== "ed25519") throw new TypeError("The approval signing key must be an Ed25519 key");
  return key;
}
