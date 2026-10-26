/**
 * HTML helpers. The CSP is `default-src 'self'`, so pages use no inline
 * scripts or styles: all behaviour is in /static/*.js and all styling in
 * /static/app.css.
 */

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Escapes text for HTML content and attribute values. Everything user-provided goes through this. */
export function esc(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (char) => ESCAPES[char]!);
}

export type NavKey = "inbox" | "ideas" | "tasks" | "projects" | "decisions" | "capture" | "settings";

export interface PageOptions {
  title: string;
  /** Value of `data-page`, which the client scripts dispatch on. */
  page: string;
  body: string;
  /** Script files from /static, loaded deferred. */
  scripts?: readonly string[];
  /** Show the app shell (signed-in pages), with this navigation entry current. */
  nav?: NavKey;
  /** Top bar breadcrumb: a group and the page, e.g. ["Workspace", "Tasks"]. */
  crumbs?: readonly [string, string];
  /** The write clone's state, for the top bar's sync indicator. */
  sync?: { pending: number; head: string };
  /** Use the full width (boards) instead of a reading column. */
  wide?: boolean;
}

const ICONS = {
  inbox: '<path d="M3 12l2.4-7h9.2L17 12v4H3z"/><path d="M3 12h4l1 2h4l1-2h4"/>',
  ideas: '<path d="M10 17V9"/><path d="M10 9C10 6 8 4 4 4c0 3 2 5 6 5z"/><path d="M10 11c0-3 2-5 6-5 0 3-2 5-6 5z"/>',
  tasks: '<rect x="3" y="3" width="14" height="14" rx="3.5"/><path d="M7 10l2 2 4-4"/>',
  projects: '<path d="M3 6.5A2.5 2.5 0 015.5 4H8l2 2h4.5A2.5 2.5 0 0117 8.5v5a2.5 2.5 0 01-2.5 2.5h-9A2.5 2.5 0 013 13.5z"/>',
  decisions: '<path d="M6 3h6l3 3v11H6z"/><path d="M12 3v3h3"/><path d="M8.5 11h4M8.5 14h4"/>',
  settings: '<circle cx="10" cy="10" r="2.5"/><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4"/>',
  signout: '<path d="M8 4H5v12h3"/><path d="M12 6l4 4-4 4"/><path d="M16 10H8"/>',
} as const;

const NAV: ReadonlyArray<{ key: NavKey; href: string; label: string; icon: keyof typeof ICONS }> = [
  { key: "inbox", href: "/", label: "Inbox", icon: "inbox" },
  { key: "ideas", href: "/ideas", label: "Ideas", icon: "ideas" },
  { key: "tasks", href: "/tasks", label: "Tasks", icon: "tasks" },
  { key: "projects", href: "/projects", label: "Projects", icon: "projects" },
  { key: "decisions", href: "/decisions", label: "Decisions", icon: "decisions" },
];

const icon = (name: keyof typeof ICONS): string => `<svg viewBox="0 0 20 20" aria-hidden="true">${ICONS[name]}</svg>`;

const BRAND = `<a class="brand" href="/" title="OctoSprout"><svg viewBox="0 0 32 32" aria-hidden="true"><path class="leaf" d="M16.4 7.2c-.2-2.6 1.2-4.6 4.4-5.4.6 2.9-1.2 5-4.4 5.4z"/><path class="head" d="M16 7C9.8 7 6 11.3 6 16.8v6.4c0 1.5 1.1 2.6 2.4 2.6s2.4-1.1 2.4-2.6v-.6c0 1.5 1.1 2.6 2.4 2.6s2.4-1.1 2.4-2.6c0 1.5 1.1 2.6 2.4 2.6s2.4-1.1 2.4-2.6v.6c0 1.5 1.1 2.6 2.4 2.6S26 24.7 26 23.2v-6.4C26 11.3 22.2 7 16 7z"/><circle class="eye" cx="12.6" cy="16.4" r="1.7"/><circle class="eye" cx="19.4" cy="16.4" r="1.7"/></svg><span>OctoSprout</span></a>`;

function sidebar(current: NavKey): string {
  const link = (item: { key: NavKey; href: string; label: string; icon: keyof typeof ICONS }) =>
    `<a href="${item.href}" title="${item.label}"${item.key === current ? ' aria-current="page"' : ""}>${icon(item.icon)}<span>${item.label}</span></a>`;
  return `<aside class="side">
${BRAND}
<nav class="sidenav" aria-label="Main">${NAV.map(link).join("")}</nav>
<a class="capture" href="/capture" title="Capture"${current === "capture" ? ' aria-current="page"' : ""}>+ <span>Capture</span></a>
<div class="sidefoot">${link({ key: "settings", href: "/settings", label: "Settings", icon: "settings" })}<button type="button" data-action="logout" title="Sign out">${icon("signout")}<span>Sign out</span></button></div>
</aside>`;
}

/** The top bar's summary of the write clone: up to date, or commits waiting to be pushed. */
export function syncIndicator(sync: { pending: number; head: string } | undefined): string {
  if (!sync) return "";
  const short = esc(sync.head.slice(0, 7));
  return sync.pending > 0
    ? `<span class="sync-global pending" id="sync-global" role="status"><span class="dot"></span><span class="label">${sync.pending} pending ·</span> ${short}</span>`
    : `<span class="sync-global" id="sync-global" role="status"><span class="dot"></span><span class="label">Up to date ·</span> ${short}</span>`;
}

export function page(options: PageOptions): string {
  const scripts = (options.scripts ?? []).map((src) => `<script src="/static/${esc(src)}" defer></script>`).join("");
  const main = `<main${options.wide ? ' class="wide"' : ""}>
${options.body}
</main>`;
  const crumbs = options.crumbs
    ? `<div class="crumbs"><span class="group">${esc(options.crumbs[0])} / </span><b>${esc(options.crumbs[1])}</b></div>`
    : `<div class="crumbs"><b>${esc(options.title)}</b></div>`;
  const content = options.nav
    ? `<div class="shell">
${sidebar(options.nav)}
<div class="content">
<header class="topbar">${crumbs}${syncIndicator(options.sync)}</header>
${main}
</div>
</div>`
    : main;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<meta name="referrer" content="no-referrer">
<title>${esc(options.title)} · OctoSprout</title>
<link rel="stylesheet" href="/static/app.css">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/static/icon-180.png">
<meta name="apple-mobile-web-app-title" content="OctoSprout">
<meta name="theme-color" content="#f8faf6" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#111712" media="(prefers-color-scheme: dark)">
</head>
<body data-page="${esc(options.page)}">
${content}
${scripts}
</body>
</html>
`;
}

export function signInRequiredPage(): string {
  return page({
    title: "Sign in required",
    page: "denied",
    // Remembers where you were going (including shared text in the URL fragment) for after sign-in.
    scripts: ["return.js"],
    body: `<h1>Sign in required</h1>
<p><a class="button" href="/login">Sign in with a passkey</a></p>`,
  });
}
