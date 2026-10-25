/**
 * The registered WebAuthn credentials of the single user (spec §18.2).
 */
import { randomBytes } from "node:crypto";
import { join } from "node:path";

import { StateFile } from "./state-file.js";

export interface StoredPasskey {
  /** Base64url credential ID. */
  id: string;
  /** Base64url COSE public key. */
  publicKey: string;
  counter: number;
  transports?: string[];
  /** Friendly name, e.g. "iPhone". */
  name: string;
  created: string;
  lastUsed?: string;
}

interface PasskeyFile {
  /** Base64url WebAuthn user handle; stable, random and not personal data. */
  userId: string;
  passkeys: StoredPasskey[];
}

export class PasskeyStore {
  readonly #file: StateFile<PasskeyFile>;
  #data: PasskeyFile;

  constructor(stateDir: string) {
    this.#file = new StateFile(join(stateDir, "passkeys.json"), () => ({ userId: randomBytes(32).toString("base64url"), passkeys: [] }));
    this.#data = this.#file.load();
    this.#file.save(this.#data);
  }

  get userId(): Buffer {
    return Buffer.from(this.#data.userId, "base64url");
  }

  list(): readonly StoredPasskey[] {
    return this.#data.passkeys;
  }

  find(id: string): StoredPasskey | undefined {
    return this.#data.passkeys.find((passkey) => passkey.id === id);
  }

  add(passkey: StoredPasskey): void {
    if (this.find(passkey.id)) throw new Error("This passkey is already registered.");
    this.#data.passkeys.push(passkey);
    this.#file.save(this.#data);
  }

  /** Records a successful sign-in and the authenticator's new signature counter. */
  recordUse(id: string, counter: number, now: Date = new Date()): void {
    const passkey = this.find(id);
    if (!passkey) return;
    passkey.counter = counter;
    passkey.lastUsed = now.toISOString();
    this.#file.save(this.#data);
  }

  remove(id: string): boolean {
    const before = this.#data.passkeys.length;
    this.#data.passkeys = this.#data.passkeys.filter((passkey) => passkey.id !== id);
    if (this.#data.passkeys.length === before) return false;
    this.#file.save(this.#data);
    return true;
  }
}
