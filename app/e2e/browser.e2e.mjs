/**
 * End-to-end check in a real browser (spec §20, UI and auth).
 *
 * Starts the built server against a local bare repository that plays GitHub,
 * then drives Chromium with a virtual WebAuthn authenticator through:
 * passkey registration at /setup, capturing from the form, signing out and
 * back in, and the Inbox view.
 *
 * It exercises the client scripts and the real browser WebAuthn API, which
 * the unit tests cannot. It does not replace trying it on an iPhone.
 *
 *   pnpm build && pnpm e2e
 *
 * Requires Playwright with a Chromium build (see README).
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startServer } from "../packages/server/dist/index.js";

const { chromium } = createRequire(import.meta.url)("playwright");

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
    probe.on("error", reject);
  });
}

const root = mkdtempSync(join(tmpdir(), "octosprout-e2e-"));
let server;
let browser;
try {
  // A bare repository standing in for GitHub, with one commit.
  const remote = join(root, "remote.git");
  const seed = join(root, "seed");
  git(root, "init", "-q", "--bare", "-b", "main", remote);
  git(root, "clone", "-q", remote, seed);
  git(seed, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "first commit");
  git(seed, "push", "-q", "origin", "HEAD:main");

  const port = await freePort();
  const origin = `http://localhost:${port}`;
  mkdirSync(join(root, "secrets"));
  writeFileSync(join(root, "secrets", "setup_token"), "e2e-setup-token\n");

  server = await startServer({
    repoDir: join(root, "repo"),
    stateDir: join(root, "state"),
    host: "127.0.0.1",
    port,
    remoteUrl: remote,
    rpId: "localhost",
    origin,
    setupTokenFile: join(root, "secrets", "setup_token"),
    trustProxy: false,
    syncIntervalMs: 1000,
    logLevel: "silent",
  });

  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 375, height: 700 } });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });

  const step = (name) => console.log(`ok  ${name}`);
  const noHorizontalScroll = async () =>
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "page scrolls horizontally at 375px");

  // Anonymous visitors are sent to sign in, not shown data.
  const anonymous = await page.goto(`${origin}/`);
  assert.equal(anonymous.status(), 401);
  await page.getByRole("link", { name: "Sign in with a passkey" }).click();
  await page.waitForURL(`${origin}/login`);
  step("anonymous / answers 401 with a link to /login");

  // Register the first passkey with the setup token.
  await page.goto(`${origin}/setup`);
  await noHorizontalScroll();
  await page.fill("#setup_token", "wrong-token");
  await page.click("button[type=submit]");
  await page.waitForSelector("#status.error");
  step("a wrong setup token is refused");

  await page.fill("#setup_token", "e2e-setup-token");
  await page.fill("#name", "Virtual iPhone");
  await page.click("button[type=submit]");
  await page.waitForURL(`${origin}/`);
  assert.match(await page.textContent("h1"), /Inbox/);
  await noHorizontalScroll();
  step("passkey registered at /setup; signed in");

  // Capture from the form.
  await page.click("nav >> text=Capture");
  await page.waitForURL(`${origin}/capture`);
  await noHorizontalScroll();
  await page.fill("#text", "Idea from the browser:\n<b>not bold</b> & more");
  await page.fill("#source_url", "https://example.com/source");
  await page.click("button[type=submit]");
  await page.waitForFunction(() => /Saved OS-C-[0-9A-Z]{5}/.test(document.getElementById("status").textContent));
  const saved = await page.textContent("#status");
  assert.match(saved, /Saved OS-C-[0-9A-HJKMNP-TV-Z]{5} ✓/);
  assert.equal(await page.inputValue("#text"), "", "form is cleared after a save");
  step(`captured from the form: ${saved}`);

  // The capture is in Git on the remote, then visible in the Inbox.
  const id = /OS-C-[0-9A-HJKMNP-TV-Z]{5}/.exec(saved)[0];
  assert.match(git(remote, "log", "-1", "--format=%s", "main"), new RegExp(`capture: ${id} \\(web\\)`));
  await page.click("nav >> text=Inbox");
  await page.waitForURL(`${origin}/`);
  assert.ok(await page.isVisible(`article#${id}`));
  assert.ok((await page.textContent(`article#${id}`)).includes("<b>not bold</b> & more"), "text is shown literally, not interpreted");
  assert.equal(await page.locator(`article#${id} b`).count(), 0, "no HTML element was created from capture text");
  await noHorizontalScroll();
  step("capture is on the remote and shown in the Inbox, escaped");

  // Sign out, then sign back in with the passkey.
  await page.click("text=Sign out");
  await page.waitForURL(`${origin}/login`);
  assert.equal((await page.goto(`${origin}/`)).status(), 401);
  step("signed out: / answers 401 again");

  await page.goto(`${origin}/login`);
  await page.click("#sign-in");
  await page.waitForURL(`${origin}/`);
  assert.ok(await page.isVisible(`article#${id}`));
  step("signed back in with the passkey");

  // The cookie is the hardened kind.
  const cookies = await context.cookies();
  const session = cookies.find((cookie) => cookie.name === "__Host-octosprout_session");
  assert.ok(session, "session cookie is set");
  assert.equal(session.httpOnly, true);
  assert.equal(session.secure, true);
  assert.equal(session.sameSite, "Strict");
  step("session cookie is __Host-, Secure, HttpOnly, SameSite=Strict");

  console.log("\nAll browser checks passed.");
} finally {
  await browser?.close();
  await server?.close();
  rmSync(root, { recursive: true, force: true });
}
