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

/** `record` shows the shell with no entry current. */
export type NavKey = "inbox" | "ideas" | "tasks" | "projects" | "decisions" | "research" | "experts" | "proposals" | "capture" | "settings" | "health" | "record";

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
  sync?: { pending: number; head: string; oldestPending?: string };
  /** Use the full width (boards) instead of a reading column. */
  wide?: boolean;
}

const ICONS = {
  inbox: '<path d="M3 12l2.4-7h9.2L17 12v4H3z"/><path d="M3 12h4l1 2h4l1-2h4"/>',
  ideas: '<path d="M10 17V9"/><path d="M10 9C10 6 8 4 4 4c0 3 2 5 6 5z"/><path d="M10 11c0-3 2-5 6-5 0 3-2 5-6 5z"/>',
  tasks: '<rect x="3" y="3" width="14" height="14" rx="3.5"/><path d="M7 10l2 2 4-4"/>',
  projects: '<path d="M3 6.5A2.5 2.5 0 015.5 4H8l2 2h4.5A2.5 2.5 0 0117 8.5v5a2.5 2.5 0 01-2.5 2.5h-9A2.5 2.5 0 013 13.5z"/>',
  decisions: '<path d="M6 3h6l3 3v11H6z"/><path d="M12 3v3h3"/><path d="M8.5 11h4M8.5 14h4"/>',
  settings: '<path d="M8.10 4.31L8.34 2.17L11.66 2.17L11.90 4.31A6.0 6.0 0 0 1 12.68 4.63L14.36 3.29L16.71 5.64L15.37 7.32A6.0 6.0 0 0 1 15.69 8.10L17.83 8.34L17.83 11.66L15.69 11.90A6.0 6.0 0 0 1 15.37 12.68L16.71 14.36L14.36 16.71L12.68 15.37A6.0 6.0 0 0 1 11.90 15.69L11.66 17.83L8.34 17.83L8.10 15.69A6.0 6.0 0 0 1 7.32 15.37L5.64 16.71L3.29 14.36L4.63 12.68A6.0 6.0 0 0 1 4.31 11.90L2.17 11.66L2.17 8.34L4.31 8.10A6.0 6.0 0 0 1 4.63 7.32L3.29 5.64L5.64 3.29L7.32 4.63A6.0 6.0 0 0 1 8.10 4.31Z"/><circle cx="10" cy="10" r="2.6"/>',
  signout: '<path d="M8 4H5v12h3"/><path d="M12 6l4 4-4 4"/><path d="M16 10H8"/>',
  research: '<path d="M4 4.5A1.5 1.5 0 015.5 3H15v12H5.5A1.5 1.5 0 004 16.5z"/><path d="M4 16.5A1.5 1.5 0 005.5 18H15v-3"/><path d="M8 7h4"/>',
  experts: '<circle cx="7.5" cy="7" r="2.5"/><path d="M3 16c.5-2.8 2.2-4.2 4.5-4.2S11.5 13.2 12 16"/><circle cx="14" cy="8" r="2"/><path d="M13 11.8c2 0 3.5 1.2 4 3.7"/>',
  health: '<path d="M2.5 10h3l2-4.5 3 9 2-4.5h5"/>',
  search: '<circle cx="9" cy="9" r="5"/><path d="M13 13l4 4"/>',
  proposals: '<path d="M10 2.5l6 2.5v4.5c0 3.8-2.6 6.6-6 8-3.4-1.4-6-4.2-6-8V5z"/><path d="M7.5 10l1.8 1.8 3.4-3.6"/>',
} as const;

const NAV: ReadonlyArray<{ key: NavKey; href: string; label: string; icon: keyof typeof ICONS }> = [
  { key: "inbox", href: "/", label: "Inbox", icon: "inbox" },
  { key: "ideas", href: "/ideas", label: "Ideas", icon: "ideas" },
  { key: "tasks", href: "/tasks", label: "Tasks", icon: "tasks" },
  { key: "projects", href: "/projects", label: "Projects", icon: "projects" },
  { key: "decisions", href: "/decisions", label: "Decisions", icon: "decisions" },
  { key: "research", href: "/research", label: "Research", icon: "research" },
  { key: "experts", href: "/experts", label: "Experts", icon: "experts" },
  { key: "proposals", href: "/proposals", label: "Proposals", icon: "proposals" },
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
<div class="sidefoot">${link({ key: "health", href: "/health", label: "Health", icon: "health" })}${link({ key: "settings", href: "/settings", label: "Settings", icon: "settings" })}<button type="button" data-action="logout" title="Sign out">${icon("signout")}<span>Sign out</span></button></div>
</aside>`;
}

/** The top bar's summary of the write clone: up to date, or commits waiting to be pushed. */
export function syncIndicator(sync: { pending: number; head: string; oldestPending?: string } | undefined): string {
  if (!sync) return "";
  const short = esc(sync.head.slice(0, 7));
  // Unpushed for more than an hour is an alert (§18.5).
  if (sync.oldestPending && Date.now() - Date.parse(sync.oldestPending) > 60 * 60 * 1000) {
    return `<a class="sync-global conflict" id="sync-global" role="alert" href="/health"><span class="dot"></span><span class="label">${sync.pending} unpushed for over an hour ·</span> ${short}</a>`;
  }
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
<header class="topbar">${crumbs}<form class="topsearch" method="get" action="/search" role="search"><input type="search" name="q" placeholder="Search" aria-label="Search records"></form>${syncIndicator(options.sync)}</header>
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
