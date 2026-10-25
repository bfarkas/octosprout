/**
 * Static assets, embedded so the build needs no file copying.
 */

export const APP_CSS = `
:root {
  color-scheme: light dark;
  --bg: #fbfaf7;
  --surface: #ffffff;
  --text: #1d2521;
  --muted: #5b6760;
  --border: #d9dfda;
  --accent: #1f6b4f;
  --accent-text: #ffffff;
  --danger: #a3261f;
  --warn: #8a5a00;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #121714;
    --surface: #1a211d;
    --text: #e8ece9;
    --muted: #9aa69f;
    --border: #2d3832;
    --accent: #5cc49a;
    --accent-text: #0c1511;
    --danger: #ff8f86;
    --warn: #f0b84d;
  }
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
}
main { max-width: 42rem; margin: 0 auto; padding: 1rem 16px 3rem; }
h1 { font-size: 1.4rem; margin: 1rem 0 0.75rem; }
a { color: var(--accent); }
.nav {
  display: flex; gap: 1rem; align-items: center;
  padding: 0.75rem 16px; border-bottom: 1px solid var(--border); background: var(--surface);
}
.nav a { text-decoration: none; padding: 0.25rem 0; border-bottom: 2px solid transparent; }
.nav a[aria-current="page"] { border-bottom-color: var(--accent); font-weight: 600; }
.nav .link { margin-left: auto; }
label { display: block; font-weight: 600; margin: 1rem 0 0.25rem; }
input[type="text"], input[type="url"], input[type="password"], textarea {
  width: 100%; padding: 0.6rem 0.7rem; font: inherit; color: inherit;
  background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
}
textarea { min-height: 12rem; resize: vertical; }
.button, button {
  font: inherit; cursor: pointer; border-radius: 8px; padding: 0.6rem 1rem;
  border: 1px solid var(--accent); background: var(--accent); color: var(--accent-text);
  text-decoration: none; display: inline-block;
}
button.link { background: none; border: none; color: var(--accent); padding: 0.25rem 0; text-decoration: underline; }
button:disabled { opacity: 0.6; cursor: progress; }
.actions { margin-top: 1rem; display: flex; gap: 0.75rem; align-items: center; flex-wrap: wrap; }
.status { margin-top: 1rem; min-height: 1.5rem; }
.status.error { color: var(--danger); }
.status.ok { color: var(--accent); }
.status.pending { color: var(--warn); }
.hint, .meta { color: var(--muted); font-size: 0.9rem; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 0.75rem 1rem; margin: 0.75rem 0; }
.card pre { white-space: pre-wrap; overflow-wrap: anywhere; margin: 0.5rem 0 0; font: inherit; }
.banner { border: 1px solid var(--warn); color: var(--warn); border-radius: 8px; padding: 0.5rem 0.75rem; margin: 0.75rem 0; }
`;

/** Sign-in and passkey registration (spec §18.2). Runs on /login and /setup. */
export const AUTH_JS = `
(() => {
  const toBuffer = (value) => {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  };
  const toBase64Url = (buffer) => {
    let binary = "";
    for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, "");
  };

  async function post(url, body) {
    const response = await fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || data.error || response.statusText);
    return data;
  }

  const status = document.getElementById("status");
  const show = (text, kind) => {
    status.textContent = text;
    status.className = "status " + (kind || "");
  };
  const fail = (error) => {
    if (error && error.name === "NotAllowedError") return show("Cancelled.", "error");
    show(error && error.message ? error.message : String(error), "error");
  };

  if (!window.PublicKeyCredential) {
    show("This browser does not support passkeys.", "error");
    return;
  }

  const page = document.body.dataset.page;

  if (page === "login") {
    const button = document.getElementById("sign-in");
    button.addEventListener("click", async () => {
      button.disabled = true;
      show("Waiting for your passkey…");
      try {
        const options = await post("/api/v1/auth/login/options", {});
        options.challenge = toBuffer(options.challenge);
        for (const credential of options.allowCredentials || []) credential.id = toBuffer(credential.id);
        const credential = await navigator.credentials.get({ publicKey: options });
        await post("/api/v1/auth/login/verify", {
          response: {
            id: credential.id,
            rawId: toBase64Url(credential.rawId),
            type: credential.type,
            clientExtensionResults: credential.getClientExtensionResults(),
            authenticatorAttachment: credential.authenticatorAttachment,
            response: {
              clientDataJSON: toBase64Url(credential.response.clientDataJSON),
              authenticatorData: toBase64Url(credential.response.authenticatorData),
              signature: toBase64Url(credential.response.signature),
              userHandle: credential.response.userHandle ? toBase64Url(credential.response.userHandle) : undefined,
            },
          },
        });
        window.location.assign("/");
      } catch (error) {
        fail(error);
        button.disabled = false;
      }
    });
  }

  if (page === "setup") {
    const form = document.getElementById("setup-form");
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = form.querySelector("button");
      button.disabled = true;
      show("Waiting for your passkey…");
      const credentials = { setup_token: form.elements.setup_token.value, name: form.elements.name.value };
      try {
        const options = await post("/api/v1/auth/register/options", credentials);
        options.challenge = toBuffer(options.challenge);
        options.user.id = toBuffer(options.user.id);
        for (const credential of options.excludeCredentials || []) credential.id = toBuffer(credential.id);
        const credential = await navigator.credentials.create({ publicKey: options });
        await post("/api/v1/auth/register/verify", {
          ...credentials,
          response: {
            id: credential.id,
            rawId: toBase64Url(credential.rawId),
            type: credential.type,
            clientExtensionResults: credential.getClientExtensionResults(),
            authenticatorAttachment: credential.authenticatorAttachment,
            response: {
              clientDataJSON: toBase64Url(credential.response.clientDataJSON),
              attestationObject: toBase64Url(credential.response.attestationObject),
              transports: credential.response.getTransports ? credential.response.getTransports() : [],
            },
          },
        });
        window.location.assign("/");
      } catch (error) {
        fail(error);
        button.disabled = false;
      }
    });
  }
})();
`;

/** Behaviour of signed-in pages. */
export const APP_JS = `
(() => {
  async function csrfToken() {
    const response = await fetch("/api/v1/session", { credentials: "same-origin" });
    if (!response.ok) throw new Error("Your session has ended. Sign in again.");
    return (await response.json()).csrf;
  }

  const form = document.getElementById("capture-form");
  if (form) {
    const status = document.getElementById("status");
    const button = form.querySelector("button");
    const DRAFT = "octosprout.capture.draft";
    const show = (text, kind) => {
      status.textContent = text;
      status.className = "status " + (kind || "");
    };
    const remember = (value) => {
      try {
        if (value) localStorage.setItem(DRAFT, value);
        else localStorage.removeItem(DRAFT);
      } catch (_) {}
    };

    // An unsent draft survives a reload or a failed save (nothing is lost until the server acknowledges it).
    try {
      form.elements.text.value = localStorage.getItem(DRAFT) || "";
    } catch (_) {}

    // One idempotency key per attempt: a retry of the same text can never create a duplicate.
    let key = null;
    form.elements.text.addEventListener("input", () => {
      key = null;
      remember(form.elements.text.value);
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const text = form.elements.text.value;
      if (!text.trim()) return show("Write something first.", "error");
      button.disabled = true;
      show("Saving…");
      key = key || "web-" + crypto.randomUUID();
      const payload = { text, idempotency_key: key };
      if (form.elements.source_url.value.trim()) payload.source_url = form.elements.source_url.value.trim();
      try {
        const csrf = await csrfToken();
        const response = await fetch("/api/v1/capture", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json", "x-csrf-token": csrf },
          body: JSON.stringify(payload),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.message || data.error || response.statusText);
        form.elements.text.value = "";
        form.elements.source_url.value = "";
        remember("");
        key = null;
        if (data.status === "pending") show("Saved " + data.id + " (sync pending)", "pending");
        else show("Saved " + data.id + " ✓", "ok");
      } catch (error) {
        show((error && error.message ? error.message : String(error)) + " Your text is still here; try again.", "error");
      } finally {
        button.disabled = false;
      }
    });
  }

  for (const button of document.querySelectorAll('[data-action="logout"]')) {
    button.addEventListener("click", async () => {
      try {
        const csrf = await csrfToken();
        await fetch("/api/v1/auth/logout", { method: "POST", credentials: "same-origin", headers: { "x-csrf-token": csrf } });
      } finally {
        window.location.assign("/login");
      }
    });
  }
})();
`;
