/**
 * End-to-end check in a real browser (spec §20, UI and auth).
 *
 * Starts the built server against a local bare repository that plays GitHub,
 * then drives Chromium with a virtual WebAuthn authenticator through:
 * passkey registration at /setup, capturing from the form, signing out and
 * back in, the Inbox view, moving cards on the Tasks board, and editing a
 * record, including a conflict merged by hand.
 *
 * It exercises the client scripts and the real browser WebAuthn API, which
 * the unit tests cannot. It does not replace trying it on an iPhone.
 *
 *   pnpm build && pnpm e2e
 *
 * Needs Playwright's Chromium: `pnpm exec playwright install chromium` once.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chromium } from "playwright";

import { renderRecord } from "../packages/core/dist/index.js";
import { startServer } from "../packages/server/dist/index.js";

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
  // A bare repository standing in for GitHub, with three tasks for the board.
  const remote = join(root, "remote.git");
  const seed = join(root, "seed");
  git(root, "init", "-q", "--bare", "-b", "main", remote);
  git(root, "clone", "-q", remote, seed);
  const contract = "## Objective\nX\n\n## Acceptance criteria\n- [ ] Y\n\n## Verification\nZ\n";
  const taskFile = (id, title, status, links = []) =>
    renderRecord(
      { id, type: "task", schema_version: 1, title, status, created: "2026-10-25T15:00:00Z", updated: "2026-10-25T15:00:00Z", links, refs: [{ kind: "repo", url: "https://github.com/bfarkas/x" }] },
      contract,
    );
  const seedTask = (id, ...args) => {
    mkdirSync(join(seed, "records/tasks"), { recursive: true });
    writeFileSync(join(seed, `records/tasks/${id}--task.md`), taskFile(id, ...args));
  };
  seedTask("OS-T-2B7KC", "Status route", "in_progress", [{ rel: "blocks", id: "OS-T-H4V9X" }]);
  seedTask("OS-T-H4V9X", "Conflict dialog", "blocked");
  seedTask("OS-T-5NM3A", "Pointer drag", "backlog");
  git(seed, "add", "-A");
  git(seed, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "first commit");
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
  await page.click('.side a[title="Capture"]');
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
  await page.click('.side a[title="Inbox"]');
  await page.waitForURL(`${origin}/`);
  assert.ok(await page.isVisible(`article#${id}`));
  assert.ok((await page.textContent(`article#${id}`)).includes("<b>not bold</b> & more"), "text is shown literally, not interpreted");
  assert.equal(await page.locator(`article#${id} b`).count(), 0, "no HTML element was created from capture text");
  await noHorizontalScroll();
  step("capture is on the remote and shown in the Inbox, escaped");

  // A long capture: collapsed shows a preview, expanded shows the text exactly once.
  const longText = `Long note. ${"lorem ipsum ".repeat(40)}LAST-WORDS`;
  await page.goto(`${origin}/capture`);
  await page.fill("#text", longText);
  await page.click("button[type=submit]");
  await page.waitForFunction(() => /Saved OS-C-/.test(document.getElementById("status").textContent));
  const longId = /OS-C-[0-9A-HJKMNP-TV-Z]{5}/.exec(await page.textContent("#status"))[0];
  await page.goto(`${origin}/`);
  const card = page.locator(`article#${longId}`);
  assert.ok(!(await card.innerText()).includes("LAST-WORDS"), "collapsed card shows only the preview");
  // The label is CSS-generated content, which innerText does not include.
  const toggleLabel = () => card.locator(".toggle").evaluate((element) => getComputedStyle(element, "::after").content);
  assert.equal(await toggleLabel(), '"Show all"');
  await card.locator("summary").click();
  const expanded = await card.innerText();
  assert.equal(expanded.split("Long note.").length, 2, "expanded card shows the text once, not preview + full");
  assert.ok(expanded.includes("LAST-WORDS"));
  assert.equal(await toggleLabel(), '"Show less"');
  step("a long capture expands to its full text without repeating the preview");

  // Sign out, then sign back in with the passkey.
  await page.click('.side [data-action="logout"]');
  await page.waitForURL(`${origin}/login`);
  assert.equal((await page.goto(`${origin}/`)).status(), 401);
  step("signed out: / answers 401 again");

  await page.goto(`${origin}/login`);
  await page.click("#sign-in");
  await page.waitForURL(`${origin}/`);
  assert.ok(await page.isVisible(`article#${id}`));
  step("signed back in with the passkey");

  // The share-sheet link, opened while signed out: sign in, come back, and the text is still there.
  // iOS Shortcuts' "URL Encode" leaves characters such as & + = # unencoded, so do the same.
  const sharedText = "Brief from ChatGPT: a+b & c=d #tag\n100% ready";
  const shortcutEncoded = encodeURIComponent(sharedText).replace(/%26/g, "&").replace(/%2B/g, "+").replace(/%3D/g, "=").replace(/%23/g, "#");
  await page.click('.side [data-action="logout"]');
  await page.waitForURL(`${origin}/login`);
  assert.equal((await page.goto(`${origin}/capture#source=chatgpt&text=${shortcutEncoded}`)).status(), 401);
  await page.getByRole("link", { name: "Sign in with a passkey" }).click();
  await page.waitForURL(`${origin}/login`);
  await page.click("#sign-in");
  await page.waitForURL((url) => url.pathname === "/capture");
  await page.waitForFunction(() => document.getElementById("text").value !== "");
  assert.equal(await page.inputValue("#text"), sharedText, "shared text survives sign-in exactly");
  assert.equal(new URL(page.url()).hash, "", "the fragment is cleared once read");
  await page.click("button[type=submit]");
  await page.waitForFunction(() => /Saved OS-C-/.test(document.getElementById("status").textContent));
  const sharedId = /OS-C-[0-9A-HJKMNP-TV-Z]{5}/.exec(await page.textContent("#status"))[0];
  assert.equal(git(remote, "log", "-1", "--format=%s", "main"), `capture: ${sharedId} (chatgpt)`);
  const sharedFile = git(remote, "ls-tree", "-r", "--name-only", "main").split("\n").find((path) => path.endsWith(`${sharedId}.md`));
  assert.ok(execFileSync("git", ["show", `main:${sharedFile}`], { cwd: remote, encoding: "utf8" }).endsWith(`---\n${sharedText}`));
  step("share link opened while signed out: sign-in returns to it and saves the text exactly, as chatgpt");

  // ChatGPT's share button gives only a link to the chat. Copy the answer, share the link,
  // then Paste & save: the answer becomes the text and the link and source are kept.
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
  await page.goto(`${origin}/capture#source=chatgpt&text=${encodeURIComponent("https://chatgpt.com/s/t_example")}`);
  assert.equal(await page.inputValue("#source_url"), "https://chatgpt.com/s/t_example");
  assert.match(await page.textContent("#status"), /Only a link was shared/);
  await page.evaluate(() => navigator.clipboard.writeText("The answer I copied from ChatGPT"));
  await page.evaluate(() => (document.getElementById("status").textContent = ""));
  await page.click("#paste-save");
  await page.waitForFunction(() => /Saved OS-C-/.test(document.getElementById("status").textContent));
  const chatId = /OS-C-[0-9A-HJKMNP-TV-Z]{5}/.exec(await page.textContent("#status"))[0];
  assert.equal(git(remote, "log", "-1", "--format=%s", "main"), `capture: ${chatId} (chatgpt)`);
  const chatFile = git(remote, "ls-tree", "-r", "--name-only", "main").split("\n").find((path) => path.endsWith(`${chatId}.md`));
  const chatRecord = execFileSync("git", ["show", `main:${chatFile}`], { cwd: remote, encoding: "utf8" });
  assert.ok(chatRecord.includes("source_url: https://chatgpt.com/s/t_example"));
  assert.ok(chatRecord.endsWith("---\nThe answer I copied from ChatGPT"));
  assert.equal(await page.inputValue("#source_url"), "");
  step("a shared chat link plus Paste & save stores the copied answer with the link, as chatgpt");

  // Paste & save, as from the home screen app. Clear the previous "Saved" message first.
  await page.evaluate(() => (document.getElementById("status").textContent = ""));
  await page.evaluate(() => navigator.clipboard.writeText("Pasted from the clipboard"));
  await page.click("#paste-save");
  await page.waitForFunction(() => /Saved OS-C-/.test(document.getElementById("status").textContent));
  assert.match(git(remote, "log", "-1", "--format=%s", "main"), /^capture: OS-C-[0-9A-Z]{5} \(web\)$/);
  assert.equal(await page.inputValue("#text"), "");
  step("Paste & save stores the clipboard in one tap");

  // Installable: the manifest and its icons load.
  const manifest = await page.evaluate(async () => (await fetch("/manifest.webmanifest")).json());
  assert.equal(manifest.start_url, "/capture");
  for (const icon of manifest.icons) assert.equal((await page.request.get(`${origin}${icon.src}`)).status(), 200);
  step("web app manifest and icons are served");

  // Create an inbox token in the UI, use it as the Shortcut would, then revoke it.
  page.on("dialog", (dialog) => dialog.accept());
  await page.click('.side a[title="Settings"]');
  await page.waitForURL(`${origin}/settings`);
  await noHorizontalScroll();
  await page.fill("#token-name", "iphone-shortcut");
  await page.click("#token-form button[type=submit]");
  await page.waitForSelector("#new-token:not([hidden])");
  const token = (await page.textContent("#new-token-value")).trim();
  assert.match(token, /^ost_/);
  const viaToken = (key) =>
    fetch(`${origin}/api/v1/inbox`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ text: "from the shortcut", idempotency_key: key, source: "shortcut" }),
    });
  assert.equal((await viaToken("e2e-shortcut-0001")).status, 201);
  step("created an inbox token in Settings; it stores a capture");

  await page.reload();
  await page.click('[data-action="revoke-token"][data-name="iphone-shortcut"]');
  await page.waitForSelector('[data-action="revoke-token"]', { state: "detached" });
  assert.equal((await viaToken("e2e-shortcut-0002")).status, 401);
  step("revoked the token in Settings; it is refused");

  // The cookie is the hardened kind.
  const cookies = await context.cookies();
  const session = cookies.find((cookie) => cookie.name === "__Host-octosprout_session");
  assert.ok(session, "session cookie is set");
  assert.equal(session.httpOnly, true);
  assert.equal(session.secure, true);
  assert.equal(session.sameSite, "Strict");
  step("session cookie is __Host-, Secure, HttpOnly, SameSite=Strict");

  // The Tasks board at 375 px: Move to…, which also unblocks the task it blocked.
  const column = (id) => page.evaluate((cardId) => document.getElementById(`card-${cardId}`)?.closest(".col")?.dataset.status, id);
  await page.click('.side a[title="Tasks"]');
  await page.waitForURL(`${origin}/tasks`);
  await noHorizontalScroll();
  assert.equal(await column("OS-T-H4V9X"), "blocked");
  assert.match(await page.textContent("#card-OS-T-H4V9X"), /blocked by OS-T-2B7KC/);
  await page.selectOption("#card-OS-T-2B7KC select", "done");
  await page.waitForSelector("#col-done #card-OS-T-2B7KC .sync.committed");
  assert.equal(await column("OS-T-H4V9X"), "ready");
  assert.equal(git(remote, "log", "-1", "--format=%s", "main"), "status: OS-T-2B7KC in_progress -> done (+1 unblocked)");
  step("Move to… on the Tasks board commits the move and unblocks the blocked task");

  // Drag by the grip.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.reload();
  const grip = await page.locator("#card-OS-T-5NM3A .grip").boundingBox();
  const target = await page.locator("#col-in_progress").boundingBox();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + 80, { steps: 8 });
  assert.equal(await page.evaluate(() => document.getElementById("col-in_progress").classList.contains("drop-ok")), true);
  await page.mouse.up();
  await page.waitForSelector("#col-in_progress #card-OS-T-5NM3A .sync.committed");
  step("dragging a card by its grip moves it");

  // A change pushed from another clone makes the next move a conflict.
  git(seed, "pull", "-q", "origin", "main");
  writeFileSync(join(seed, "records/tasks/OS-T-5NM3A--task.md"), taskFile("OS-T-5NM3A", "Pointer drag", "blocked"));
  git(seed, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-am", "mac change");
  git(seed, "push", "-q", "origin", "HEAD:main");
  await page.selectOption("#card-OS-T-5NM3A select", "done");
  await page.waitForSelector("#dlg-conflict[open]");
  assert.match(await page.textContent("#dlg-conflict"), /blocked/);
  await page.click('#dlg-conflict button[value="theirs"]');
  await page.waitForFunction(() => document.getElementById("card-OS-T-5NM3A")?.closest(".col")?.dataset.status === "blocked");
  step("a move against a stale card shows the conflict dialog and keeps the current version");

  // Record detail and the editor: a form edit, then a conflict merged by hand.
  await page.click("#card-OS-T-2B7KC .btitle");
  await page.waitForURL(`${origin}/records/OS-T-2B7KC`);
  await page.click('a[href$="/edit"]');
  await page.waitForURL(`${origin}/records/OS-T-2B7KC/edit`);
  await page.fill("#title", "Status route, edited");
  await page.fill("#tags", "api boards");
  await page.click("#save");
  await page.waitForURL(`${origin}/records/OS-T-2B7KC`);
  assert.equal(await page.textContent("h1"), "Status route, edited");
  assert.equal(git(remote, "log", "-1", "--format=%s", "main"), "edit: OS-T-2B7KC Status route, edited");
  step("a form edit on Record detail is committed");

  await page.click('a[href$="/edit"]');
  await page.fill("#title", "Edited in the browser");
  git(seed, "pull", "-q", "origin", "main");
  const macPath = join(seed, "records/tasks/OS-T-2B7KC--task.md");
  writeFileSync(macPath, readFileSync(macPath, "utf8").replace("## Objective\nX", "## Objective\nX, from the Mac"));
  git(seed, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-am", "mac edit");
  git(seed, "push", "-q", "origin", "HEAD:main");
  await page.click("#save");
  await page.waitForSelector("#merge:not([hidden])");
  const mergedText = await page.inputValue("#merged");
  assert.match(mergedText, /title: Edited in the browser/);
  await page.fill("#merged", mergedText.replace("## Objective\nX", "## Objective\nX, from the Mac"));
  await page.click("#save-merged");
  await page.waitForURL(`${origin}/records/OS-T-2B7KC`);
  assert.equal(await page.textContent("h1"), "Edited in the browser");
  assert.match(await page.textContent(".markdown"), /from the Mac/);
  step("a conflicting edit opens the three-way merge, and the merged text is saved");

  // Triage: a capture becomes an idea, another is composted.
  await page.click('.side a[title="Inbox"]');
  await page.waitForURL(`${origin}/`);
  const newCount = async () => Number((await page.textContent("h1 .meta")).match(/\d+/)[0]);
  const before = await newCount();
  const firstCapture = await page.getAttribute(".card[id^='OS-C-']", "id");
  await page.click(`#${firstCapture} .triage-button`);
  await page.waitForURL(`${origin}/inbox/${firstCapture}/triage`);
  await page.fill("#title-idea", "An idea from the Inbox");
  await page.click('form[data-pane="idea"] button[type=submit]');
  await page.waitForURL(/\/records\/OS-I-[0-9A-Z]{5}$/);
  assert.equal(await page.textContent("h1"), "An idea from the Inbox");
  assert.match(await page.textContent(".recordside"), new RegExp(`derived_from\\s+.*${firstCapture}`));
  assert.match(git(remote, "log", "-1", "--format=%s", "main"), new RegExp(`^triage: ${firstCapture} -> OS-I-`));
  await page.click('.side a[title="Inbox"]');
  assert.equal(await newCount(), before - 1);
  step("a capture triaged into an idea leaves the Inbox and links back to it");

  const secondCapture = await page.getAttribute(".card[id^='OS-C-']", "id");
  await page.click(`#${secondCapture} .triage-button`);
  await page.click('.tab[data-tab="compost"]');
  await page.click('form[data-pane="compost"] button[type=submit]');
  await page.waitForURL(`${origin}/`);
  assert.equal(await newCount(), before - 2);
  assert.equal(git(remote, "log", "-1", "--format=%s", "main"), `triage: ${secondCapture} composted`);
  step("a composted capture leaves the Inbox");

  console.log("\nAll browser checks passed.");
} finally {
  await browser?.close();
  await server?.close();
  rmSync(root, { recursive: true, force: true });
}
