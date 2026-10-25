/**
 * Record identifiers: `<PREFIX>-<TYPE>-<RAND>` (spec §6.1).
 */
import { randomBytes } from "node:crypto";

import {
  LIBRARY_TYPE_CODES,
  TYPE_CODES,
  type LibraryTypeCode,
  type RecordType,
  type TypeCode,
} from "./types.js";

/** Crockford Base32: `0-9` and `A-Z` excluding `I L O U`. */
export const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export const RAND_LENGTH = 5;

export const PRIVATE_PREFIX = "OS";
export const LIBRARY_PREFIX = "OSL";

export type ParsedId =
  | { prefix: typeof PRIVATE_PREFIX; code: TypeCode; type: RecordType; rand: string; id: string }
  | { prefix: typeof LIBRARY_PREFIX; code: LibraryTypeCode; rand: string; id: string };

const ID_PATTERN = /^(OSL|OS)-([A-Z]+)-([0-9A-HJKMNP-TV-Z]{5})$/;

const TYPE_BY_CODE = new Map<string, RecordType>(
  Object.entries(TYPE_CODES).map(([type, code]) => [code, type as RecordType]),
);

/**
 * Parses an ID case-insensitively and returns its canonical (uppercase) form,
 * or `undefined` if the string is not a valid ID.
 */
export function parseId(input: string): ParsedId | undefined {
  const id = input.toUpperCase();
  const match = ID_PATTERN.exec(id);
  if (!match) return undefined;
  const [, prefix, code, rand] = match as unknown as [string, string, string, string];

  if (prefix === PRIVATE_PREFIX) {
    const type = TYPE_BY_CODE.get(code);
    if (!type) return undefined;
    return { prefix, code: code as TypeCode, type, rand, id };
  }
  if ((LIBRARY_TYPE_CODES as readonly string[]).includes(code)) {
    return { prefix: LIBRARY_PREFIX, code: code as LibraryTypeCode, rand, id };
  }
  return undefined;
}

export function isId(input: string): boolean {
  return parseId(input) !== undefined;
}

/** Renders an ID in canonical uppercase form. Throws if it is not a valid ID. */
export function normalizeId(input: string): string {
  const parsed = parseId(input);
  if (!parsed) throw new Error(`Invalid OctoSprout ID: ${JSON.stringify(input)}`);
  return parsed.id;
}

/** Generates `RAND_LENGTH` Crockford Base32 characters from a CSPRNG. */
export function randomPart(): string {
  // 256 is a multiple of 32, so masking each byte to 5 bits is unbiased.
  const bytes = randomBytes(RAND_LENGTH);
  let out = "";
  for (const byte of bytes) out += CROCKFORD_ALPHABET[byte & 31];
  return out;
}

export interface GenerateIdOptions {
  /** Returns true if the ID is already taken (index or working tree lookup). */
  exists?: (id: string) => boolean;
  /** Collision retries before giving up. */
  maxAttempts?: number;
  /** Override for tests. */
  random?: () => string;
}

/**
 * Generates a new private record ID, retrying on collision (spec §6.1).
 * IDs are never renumbered; callers detect collisions with `exists`.
 */
export function generateId(type: RecordType, options: GenerateIdOptions = {}): string {
  const { exists = () => false, maxAttempts = 16, random = randomPart } = options;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const id = `${PRIVATE_PREFIX}-${TYPE_CODES[type]}-${random()}`;
    if (!exists(id)) return id;
  }
  throw new Error(`Could not allocate a unique ${type} ID after ${maxAttempts} attempts`);
}
