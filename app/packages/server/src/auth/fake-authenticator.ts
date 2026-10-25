/**
 * A software WebAuthn authenticator for tests: ES256 keys, "none" attestation,
 * user presence and verification always set. It produces the same JSON a
 * browser would send.
 */
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";

type Cbor = number | string | Buffer | Map<number | string, Cbor>;

/** Minimal CBOR encoder: unsigned and negative integers, byte and text strings, maps. */
function cbor(value: Cbor): Buffer {
  const head = (major: number, length: number): Buffer => {
    if (length < 24) return Buffer.from([(major << 5) | length]);
    if (length < 256) return Buffer.from([(major << 5) | 24, length]);
    if (length < 65536) return Buffer.from([(major << 5) | 25, length >> 8, length & 255]);
    throw new Error("too long for the test encoder");
  };
  if (typeof value === "number") return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (typeof value === "string") {
    const bytes = Buffer.from(value, "utf8");
    return Buffer.concat([head(3, bytes.length), bytes]);
  }
  if (Buffer.isBuffer(value)) return Buffer.concat([head(2, value.length), value]);
  return Buffer.concat([head(5, value.size), ...[...value].flatMap(([k, v]) => [cbor(k), cbor(v)])]);
}

const b64u = (buffer: Buffer): string => buffer.toString("base64url");
const sha256 = (data: Buffer | string): Buffer => createHash("sha256").update(data).digest();

interface CreationOptions {
  challenge: string;
}
interface RequestOptions {
  challenge: string;
}

export class FakeAuthenticator {
  readonly credentialId = randomBytes(32);
  counter = 0;
  readonly #privateKey: KeyObject;
  readonly #x: Buffer;
  readonly #y: Buffer;

  constructor(
    private readonly rpId: string,
    private readonly origin: string,
  ) {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    this.#privateKey = privateKey;
    const jwk = publicKey.export({ format: "jwk" });
    this.#x = Buffer.from(jwk.x!, "base64url");
    this.#y = Buffer.from(jwk.y!, "base64url");
  }

  get id(): string {
    return b64u(this.credentialId);
  }

  #clientData(type: string, challenge: string, origin = this.origin): Buffer {
    return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }), "utf8");
  }

  /** The response to `navigator.credentials.create()`. */
  create(options: CreationOptions, overrides: { origin?: string } = {}): Record<string, unknown> {
    const coseKey = new Map<number, Cbor>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, this.#x],
      [-3, this.#y],
    ]);
    const idLength = Buffer.alloc(2);
    idLength.writeUInt16BE(this.credentialId.length);
    const authData = Buffer.concat([
      sha256(this.rpId),
      Buffer.from([0x45]), // user present, user verified, attested credential data
      Buffer.alloc(4),
      Buffer.alloc(16), // AAGUID
      idLength,
      this.credentialId,
      cbor(coseKey),
    ]);
    const attestationObject = cbor(
      new Map<string, Cbor>([
        ["fmt", "none"],
        ["attStmt", new Map()],
        ["authData", authData],
      ]),
    );
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key",
      authenticatorAttachment: "platform",
      clientExtensionResults: {},
      response: {
        clientDataJSON: b64u(this.#clientData("webauthn.create", options.challenge, overrides.origin)),
        attestationObject: b64u(attestationObject),
        transports: ["internal"],
      },
    };
  }

  /** The response to `navigator.credentials.get()`. */
  get(options: RequestOptions, overrides: { counter?: number } = {}): Record<string, unknown> {
    this.counter = overrides.counter ?? this.counter + 1;
    const counter = Buffer.alloc(4);
    counter.writeUInt32BE(this.counter);
    const authenticatorData = Buffer.concat([sha256(this.rpId), Buffer.from([0x05]), counter]);
    const clientData = this.#clientData("webauthn.get", options.challenge);
    const signature = sign("sha256", Buffer.concat([authenticatorData, sha256(clientData)]), this.#privateKey);
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key",
      authenticatorAttachment: "platform",
      clientExtensionResults: {},
      response: {
        clientDataJSON: b64u(clientData),
        authenticatorData: b64u(authenticatorData),
        signature: b64u(signature),
        userHandle: b64u(randomBytes(32)),
      },
    };
  }
}
