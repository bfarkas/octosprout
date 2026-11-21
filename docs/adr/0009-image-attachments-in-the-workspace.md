# ADR009 - Image attachments live in the workspace repository
* Date: Nov 21, 2026
* Status: ADOPTED
* Author: bfarkas (drafted with Claude Code)

## Decision
Records can show images, such as mockups of planned UIs or reference screenshots. The
image files are committed to the workspace under `attachments/<record ID>/`, and a
record links to them with an ordinary relative Markdown image link:

```markdown
![Settings mockup](../../attachments/OS-P-0XZ4K/settings-mockup.png)
```

**Files.**
- Only raster images: `.png`, `.jpg`/`.jpeg`, `.gif` and `.webp`. No SVG, because an SVG can carry scripts.
- At most 2 MB per file. Larger files should be scaled down or exported again, not kept in git.
- `attachments/<record ID>/` is the convention. The folder belongs to the record that first used the image; other records may link to it too.

**Adding images.** Images are committed with git, from the Mac or by an agent working in
the workspace checkout, like any other file. There is no upload in the browser or through
MCP yet.

**Showing images.** The server serves `GET /attachments/<path>` from the write clone,
behind passkey login, for the allowed types only, with `X-Content-Type-Options: nosniff`.
The record page rewrites a relative image link that resolves into `attachments/` to that
route. Other image sources are dropped, and the CSP (`default-src 'self'`) still blocks
remote images.

**Validation (OSV014).** `octosprout validate`, the health panel and CI check that:
- every file under `attachments/` has an allowed type and is at most 2 MB (error);
- every image link in a record that resolves into `attachments/` points at an existing file (warning).

The write service and the MCP servers validate the records they change without listing
attachments, so OSV014 never blocks a record write.

**Agents.** The handoff bundle (§11.3) lists the attachments the task, its project and
its decisions link to, as workspace paths, so a coding agent with the workspace checked
out can open them.

## Context
Projects in OctoSprout now include UI work, where a mockup or reference picture says
more than a paragraph. Records are Markdown files only: `readWorkspaceFiles` reads `.md`
files, nothing served images, and the CSP blocks remote ones. Linking to an image host
would fail in the UI and keep the picture out of git history, backups and the agent's
checkout.

## Options Considered
### Option 1 (SELECTED): Plain files in the workspace repository, committed with git
#### Consequences
 * Adopted because: the workspace stays the single source of truth (§2). Images get history, backups and attribution from git, and agents with the checkout can read them.
 * Adopted because: it needs only a read route, a link rewrite and a validation check. No new storage, upload or write path.
 * Adopted despite: images grow the repository for good, even after they are deleted. The 2 MB limit keeps this small at the expected number of mockups.
 * Adopted despite: images can't be added from the iPhone or the browser yet.

### Option 2: Git LFS
#### Consequences
 * Rejected because: it adds an LFS server, a client setup on every checkout and on the server, and breaks plain clones. Not worth it at mockup sizes.

### Option 3: An external image host or object storage, linked by URL
#### Consequences
 * Rejected because: images would live outside the workspace, need their own access control and backups, and the CSP would have to allow another origin.

### Option 4: Upload through the browser and MCP now
#### Consequences
 * Deferred: binary writes through the write service, proposals that carry images, and size limits on request bodies are a larger change. Reconsider once images are in use.

## Advice
 * None recorded.

## Supporting Material
 * Spec §5.2, §11.3, §12.2, §19
 * [app/packages/core/src/attachments.ts](../../app/packages/core/src/attachments.ts): types, limits and link resolution
 * [app/packages/server/src/ui/markdown.ts](../../app/packages/server/src/ui/markdown.ts): the image link rewrite
