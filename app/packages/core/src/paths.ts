/**
 * Workspace paths (spec §9.3): relative, with `/` separators, never leaving
 * the workspace or touching `.git`, and never escaping it through a symbolic
 * link. The server and the CLI resolve every path a client or proposal names
 * through `resolveInside` before they read or write it.
 */
import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, sep } from "node:path";

/** True if `path` is a workspace-relative path that stays inside the workspace and out of `.git`. */
export function isWorkspacePath(path: string): boolean {
  return (
    path !== "" &&
    !path.includes("\0") &&
    !path.includes("\\") &&
    !isAbsolute(path) &&
    !path.split("/").some((segment) => segment === "" || segment === "." || segment === ".." || segment.toLowerCase() === ".git")
  );
}

/**
 * The absolute path of `path` inside `root`, or undefined if it is not a
 * workspace path or a symbolic link on the way leads outside `root`. The
 * file itself need not exist yet.
 */
export function resolveInside(root: string, path: string): string | undefined {
  if (!isWorkspacePath(path)) return undefined;
  const target = join(root, path);
  let probe = target;
  while (!existsSync(probe)) {
    const parent = dirname(probe);
    if (parent === probe) return undefined;
    probe = parent;
  }
  const realRoot = realpathSync(root);
  const real = realpathSync(probe);
  return real === realRoot || real.startsWith(realRoot + sep) ? target : undefined;
}
