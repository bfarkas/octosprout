/**
 * Reading a workspace checkout from disk.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";

import type { Finding } from "./findings.js";
import { validateWorkspace, type SourceFile, type ValidateOptions } from "./validate.js";

const RECORD_DIRS = ["records", "experts", "proposals"];

/** Reads every `.md` file under the record directories of a workspace checkout. */
export function readWorkspaceFiles(root: string): SourceFile[] {
  const files: SourceFile[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const relative = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(relative);
      else if (entry.isFile() && entry.name.endsWith(".md")) {
        files.push({ path: relative.split(sep).join("/"), content: readFileSync(join(root, relative)) });
      }
    }
  };
  for (const dir of RECORD_DIRS) {
    try {
      walk(dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return files;
}

/** Validates the workspace checked out at `root`. */
export function validateDirectory(root: string, options?: ValidateOptions): Finding[] {
  return validateWorkspace(readWorkspaceFiles(root), options);
}
