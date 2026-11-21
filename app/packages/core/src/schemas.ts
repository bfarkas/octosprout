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

type ProposalSchema = { $id: string; properties: { operations: { items: { oneOf: Array<{ properties: { op: { const: string } } }> } } } };

const SCHEMA_FILE =/^([a-z]+)\.v(\d+)\.schema\.json$/;

export class SchemaRegistry {
  readonly #ajv = new Ajv2020({ allErrors: true, strict: true });
  readonly #validators = new Map<string, ValidateFunction>();
  readonly #operations = new Map<string, ValidateFunction>();

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
    const proposal = entries.find((e) => e.name === "proposal" && e.version === 1)?.schema as ProposalSchema | undefined;
    proposal?.properties.operations.items.oneOf.forEach((branch, i) => {
      this.#operations.set(branch.properties.op.const, this.#ajv.getSchema(`${proposal.$id}#/properties/operations/items/oneOf/${i}`)!);
    });
  }

  /** What is wrong with one operation (spec §9.3), checked against its kind's branch of the proposal schema; empty if it is valid. */
  operationProblems(operation: unknown): string[] {
    const validate = this.#operations.get(String((operation as { op?: unknown } | null)?.op));
    if (!validate) return [`unknown op; use one of ${[...this.#operations.keys()].join(", ")}`];
    if (validate(operation)) return [];
    return (validate.errors ?? []).map((e) => {
      const extra = (e.params as { additionalProperty?: string }).additionalProperty;
      return `${e.instancePath ? `${e.instancePath.slice(1)} ` : ""}${e.message}${extra ? `: ${extra}` : ""}`;
    });
  }

  /** Returns the validator for a record type (or `workspace`, for `octosprout.yaml`) and schema version, if supported. */
  get(type: RecordType | "workspace", schemaVersion: number): ValidateFunction | undefined {
    return this.#validators.get(`${type}@${schemaVersion}`);
  }
}
