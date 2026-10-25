/**
 * `octosprout validate [--ci] [--json] [path…]` (spec §19).
 *
 * The whole workspace is always loaded, because link and duplicate checks
 * need every record. Paths only narrow which findings are reported.
 */
import { hasErrors, validateDirectory, type Finding } from "@octosprout/core";

export interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
}

interface Options {
  ci: boolean;
  json: boolean;
  paths: string[];
}

function parseArgs(args: readonly string[]): Options | string {
  const options: Options = { ci: false, json: false, paths: [] };
  for (const arg of args) {
    if (arg === "--ci") options.ci = true;
    else if (arg === "--json") options.json = true;
    else if (arg.startsWith("-")) return `Unknown option ${arg}`;
    else options.paths.push(arg.replace(/\\/g, "/").replace(/^\.\//, ""));
  }
  return options;
}

function matches(path: string, filters: readonly string[]): boolean {
  if (filters.length === 0) return true;
  return filters.some((filter) => {
    const prefix = filter.replace(/\/+$/, "");
    return path === prefix || path.startsWith(`${prefix}/`);
  });
}

/** GitHub Actions workflow command, so CI shows findings inline. */
function annotation(f: Finding): string {
  const escape = (text: string) => text.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  const location = `file=${escape(f.path)}${f.line === undefined ? "" : `,line=${f.line}`},title=${f.code}`;
  return `::${f.severity} ${location}::${escape(`${f.message} ${f.hint}`)}`;
}

function formatText(f: Finding): string {
  const where = f.line === undefined ? f.path : `${f.path}:${f.line}`;
  const id = f.id === undefined ? "" : ` [${f.id}]`;
  return `${where}${id}\n  ${f.severity} ${f.code}: ${f.message}\n  hint: ${f.hint}`;
}

/** Returns the process exit code: 0 clean, 1 errors found, 2 usage or I/O error. */
export function runValidate(args: readonly string[], cwd: string, io: Io): number {
  const options = parseArgs(args);
  if (typeof options === "string") {
    io.err(`octosprout validate: ${options}\nusage: octosprout validate [--ci] [--json] [path…]`);
    return 2;
  }

  let findings: Finding[];
  try {
    findings = validateDirectory(cwd).filter((f) => matches(f.path, options.paths));
  } catch (error) {
    io.err(`octosprout validate: ${(error as Error).message}`);
    return 2;
  }

  if (options.json) {
    io.out(JSON.stringify(findings, null, 2));
  } else if (options.ci) {
    for (const f of findings) io.out(annotation(f));
  } else {
    for (const f of findings) io.out(formatText(f));
  }

  const errors = findings.filter((f) => f.severity === "error").length;
  const warnings = findings.length - errors;
  if (!options.json) {
    io.err(findings.length === 0 ? "No findings." : `${errors} error(s), ${warnings} warning(s).`);
  }
  return hasErrors(findings) ? 1 : 0;
}
