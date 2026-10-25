/**
 * Validation findings (spec §19). Every finding reports the code, severity,
 * file path, line where possible, the record ID, a message and a fix hint.
 */

export const VALIDATION_CODES = [
  "OSV001",
  "OSV002",
  "OSV003",
  "OSV004",
  "OSV005",
  "OSV006",
  "OSV011",
] as const;

export type ValidationCode = (typeof VALIDATION_CODES)[number];

export type Severity = "error" | "warning";

export interface Finding {
  code: ValidationCode;
  severity: Severity;
  /** Workspace-relative path with `/` separators. */
  path: string;
  line?: number;
  /** Record ID, when the file declares a readable one. */
  id?: string;
  message: string;
  hint: string;
}

export function hasErrors(findings: readonly Finding[]): boolean {
  return findings.some((finding) => finding.severity === "error");
}
