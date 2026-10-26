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

export interface PageOptions {
  title: string;
  /** Value of `data-page`, which the client scripts dispatch on. */
  page: string;
  body: string;
  /** Script files from /static, loaded deferred. */
  scripts?: readonly string[];
  /** Show the navigation bar (signed-in pages). */
  nav?: "inbox" | "capture" | "settings";
}

const NAV = [
  { key: "inbox", href: "/", label: "Inbox" },
  { key: "capture", href: "/capture", label: "Capture" },
  { key: "settings", href: "/settings", label: "Settings" },
] as const;

export function page(options: PageOptions): string {
  const nav = options.nav
    ? `<nav class="nav" aria-label="Main">${NAV.map(
        (item) => `<a href="${item.href}"${item.key === options.nav ? ' aria-current="page"' : ""}>${item.label}</a>`,
      ).join("")}<button type="button" class="link" data-action="logout">Sign out</button></nav>`
    : "";
  const scripts = (options.scripts ?? []).map((src) => `<script src="/static/${esc(src)}" defer></script>`).join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="referrer" content="no-referrer">
<title>${esc(options.title)} · OctoSprout</title>
<link rel="stylesheet" href="/static/app.css">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/static/icon-180.png">
<meta name="apple-mobile-web-app-title" content="OctoSprout">
<meta name="theme-color" content="#1f6b4f">
</head>
<body data-page="${esc(options.page)}">
${nav}<main>
${options.body}
</main>
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
