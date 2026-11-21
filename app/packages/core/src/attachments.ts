/**
 * Image attachments (ADR009): raster images committed under `attachments/`,
 * linked from records with relative Markdown image links.
 */
import { lstatSync, readdirSync } from "node:fs";
import { join, posix } from "node:path";

import { isWorkspacePath } from "./paths.js";

export const ATTACHMENTS_DIR = "attachments";
export const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;

/** Allowed extensions and the content type each is served with. No SVG: it can carry scripts. */
export const ATTACHMENT_TYPES: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

export interface AttachmentFile {
  path: string;
  size: number;
}

/** The content type for an attachment path, or undefined if the type is not allowed. */
export function attachmentType(path: string): string | undefined {
  const ext = /\.([^./]+)$/.exec(path)?.[1]?.toLowerCase();
  return ext === undefined ? undefined : ATTACHMENT_TYPES[ext];
}

/**
 * The workspace path an image link in the record at `recordPath` points at,
 * if it is a relative link that resolves into `attachments/`.
 */
export function resolveAttachment(recordPath: string, src: string): string | undefined {
  if (src === "" || /^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith("/") || src.startsWith("#")) return undefined;
  let decoded: string;
  try {
    decoded = decodeURIComponent(src.split(/[?#]/)[0]!);
  } catch {
    return undefined;
  }
  const path = posix.normalize(posix.join(posix.dirname(recordPath), decoded));
  return path.startsWith(`${ATTACHMENTS_DIR}/`) && isWorkspacePath(path) ? path : undefined;
}

// shortcut: a regex, not a Markdown parser, so links inside code blocks count too; parse with markdown-it if that bites.
const IMAGE_LINK = /!\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;

/** The attachment paths the image links in a record body point at, in order, with their lines. */
export function attachmentLinks(recordPath: string, body: string): Array<{ path: string; line: number }> {
  const links: Array<{ path: string; line: number }> = [];
  for (const match of body.matchAll(IMAGE_LINK)) {
    const path = resolveAttachment(recordPath, match[1]!);
    if (path) links.push({ path, line: body.slice(0, match.index).split("\n").length });
  }
  return links;
}

/** Every file under `attachments/` in a checkout, with its size. Symbolic links are skipped. */
export function listAttachments(root: string): AttachmentFile[] {
  const files: AttachmentFile[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const relative = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(relative);
      else if (entry.isFile()) files.push({ path: relative, size: lstatSync(join(root, relative)).size });
    }
  };
  try {
    if (!lstatSync(join(root, ATTACHMENTS_DIR)).isSymbolicLink()) walk(ATTACHMENTS_DIR);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
