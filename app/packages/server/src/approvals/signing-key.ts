/**
 * The server's approval signing key (spec §9.4, §18.1): an Ed25519 private
 * key in PEM, mounted as the `approval_signing_key` Docker secret. Only the
 * server holds it; the workspace lists its public key in octosprout.yaml.
 */
import { createHash, generateKeyPairSync, type KeyObject } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

import { formatPublicKey, parsePrivateKey } from "@octosprout/core";

export interface SigningKey {
  /** `key_id` in approvals: `server-` and the first 8 hex digits of the public key's SHA-256. */
  id: string;
  privateKey: KeyObject;
  /** `ed25519:<base64>`, as octosprout.yaml lists it. */
  publicKey: string;
}

export function signingKeyFrom(privateKey: KeyObject): SigningKey {
  const publicKey = formatPublicKey(privateKey);
  const id = `server-${createHash("sha256").update(publicKey).digest("hex").slice(0, 8)}`;
  return { id, privateKey, publicKey };
}

export function loadSigningKey(file: string): SigningKey {
  return signingKeyFrom(parsePrivateKey(readFileSync(file, "utf8")));
}

/** Writes a new key to `file` (mode 0600). Refuses to overwrite an existing file. */
export function generateSigningKeyFile(file: string): SigningKey {
  const { privateKey } = generateKeyPairSync("ed25519");
  writeFileSync(file, privateKey.export({ format: "pem", type: "pkcs8" }), { mode: 0o600, flag: "wx" });
  return signingKeyFrom(privateKey);
}

/** The octosprout.yaml entry for a key. */
export function keyEntry(key: SigningKey): string {
  return `  - id: ${key.id}\n    key: "${key.publicKey}"\n`;
}
