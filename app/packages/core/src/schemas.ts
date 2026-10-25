/**
 * Loads the canonical JSON Schemas from the repository's `schemas/` directory
 * (spec §6.5) and compiles frontmatter validators.
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";

import type { RecordType } from "./types.js";

/** `<repo>/schemas/`, resolved from `packages/core/{src,dist}/`. */
export const DEFAULT_SCHEMAS_DIR = fileURLToPath(new URL("../../../../schemas/", import.meta.url));

const SCHEMA_FILE = /^([a-z]+)\.v(\d+)\.schema\.json$/;

export class SchemaRegistry {
  readonly #ajv = new Ajv2020({ allErrors: true, strict: true });
  readonly #validators = new Map<string, ValidateFunction>();

  constructor(dir: string = DEFAULT_SCHEMAS_DIR) {
    const entries: Array<{ name: string; version: number; schema: { $id: string } }> = [];
    for (const file of readdirSync(dir)) {
      const match = SCHEMA_FILE.exec(file);
      if (!match) continue;
      const schema = JSON.parse(readFileSync(`${dir}/${file}`, "utf8")) as { $id: string };
      this.#ajv.addSchema(schema);
      entries.push({ name: match[1]!, version: Number(match[2]), schema });
    }
    for (const { name, version, schema } of entries) {
      if (name === "common") continue;
      this.#validators.set(`${name}@${version}`, this.#ajv.getSchema(schema.$id)!);
    }
  }

  /** Returns the frontmatter validator for a type and schema version, if supported. */
  get(type: RecordType, schemaVersion: number): ValidateFunction | undefined {
    return this.#validators.get(`${type}@${schemaVersion}`);
  }
}
