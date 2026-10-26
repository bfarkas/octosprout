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
button.secondary { background: none; color: var(--accent); }
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
ul.plain { list-style: none; padding: 0; margin: 0; }
h2 { font-size: 1.1rem; margin: 1.5rem 0 0.5rem; }
[hidden] { display: none !important; }
.banner { border: 1px solid var(--warn); color: var(--warn); border-radius: 8px; padding: 0.5rem 0.75rem; margin: 0.75rem 0; }
`;

const RETURN_KEY = "octosprout.return";

/**
 * On the "sign in required" page: remember the page the user wanted, including its
 * fragment (which is where shared text travels), so sign-in can go back there.
 */
export const RETURN_JS = `
(() => {
  const pages = ["/", "/capture", "/settings"];
  try {
    if (pages.includes(location.pathname)) {
      sessionStorage.setItem("${RETURN_KEY}", location.pathname + location.search + location.hash);
    }
  } catch (_) {}
})();
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

  // Back to the page that asked for sign-in, if any. Only same-origin paths are accepted.
  const afterSignIn = () => {
    let target = "/";
    try {
      const saved = sessionStorage.getItem("${RETURN_KEY}");
      sessionStorage.removeItem("${RETURN_KEY}");
      if (saved && saved.startsWith("/") && !saved.startsWith("//")) target = saved;
    } catch (_) {}
    window.location.assign(target);
  };

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
        afterSignIn();
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
        afterSignIn();
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
    const button = form.querySelector("button[type=submit]");
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

    // Text shared from the iOS share sheet arrives in the fragment: /capture#source=chatgpt&text=…
    // The fragment never reaches the server, so the text is not written to any access log.
    // "text" must be the last parameter; everything after "text=" is the text, even "&" or "#".
    let source = "web";
    let key = null;
    const takeShared = () => {
      const fragment = location.hash.slice(1);
      const at = fragment.startsWith("text=") ? 0 : fragment.indexOf("&text=") + 1;
      if (at === 0 && !fragment.startsWith("text=")) return;
      const encoded = fragment.slice(at + "text=".length);
      let shared;
      try {
        shared = decodeURIComponent(encoded);
      } catch (_) {
        shared = encoded;
      }
      source = "web";
      for (const part of fragment.slice(0, at).split("&")) {
        const [name, value] = part.split("=");
        if (name === "source" && value) source = value;
      }
      if (shared.trim()) {
        form.elements.text.value = shared;
        form.elements.source_url.value = /^https:\\/\\/\\S+$/.test(shared.trim()) ? shared.trim() : "";
        key = null;
        remember(shared);
        show("Shared text is ready. Check it and tap Save.");
      }
      // Drop the fragment so a reload after saving does not bring the text back.
      history.replaceState(null, "", location.pathname + location.search);
    };
    takeShared();
    // Safari may reuse a tab that is already on /capture; then only the fragment changes.
    window.addEventListener("hashchange", takeShared);

    // One idempotency key per attempt: a retry of the same text can never create a duplicate.
    form.elements.text.addEventListener("input", () => {
      key = null;
      source = "web";
      remember(form.elements.text.value);
    });

    const paste = document.getElementById("paste-save");
    paste.addEventListener("click", async () => {
      if (!navigator.clipboard || !navigator.clipboard.readText) {
        show("This browser cannot read the clipboard. Paste into the field and tap Save.", "error");
        return;
      }
      let pasted;
      try {
        pasted = await navigator.clipboard.readText();
      } catch (_) {
        show("Clipboard access was not allowed. Paste into the field and tap Save.", "error");
        return;
      }
      if (!pasted.trim()) return show("The clipboard is empty.", "error");
      form.elements.text.value = pasted;
      key = null;
      source = "web";
      remember(pasted);
      form.requestSubmit();
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const text = form.elements.text.value;
      if (!text.trim()) return show("Write something first.", "error");
      button.disabled = true;
      show("Saving…");
      key = key || "web-" + crypto.randomUUID();
      const payload = { text, idempotency_key: key, source };
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
        source = "web";
        if (data.status === "pending") show("Saved " + data.id + " (sync pending)", "pending");
        else show("Saved " + data.id + " ✓", "ok");
      } catch (error) {
        show((error && error.message ? error.message : String(error)) + " Your text is still here; try again.", "error");
      } finally {
        button.disabled = false;
      }
    });
  }

  const tokenForm = document.getElementById("token-form");
  if (tokenForm) {
    const status = document.getElementById("status");
    const show = (text, kind) => {
      status.textContent = text;
      status.className = "status " + (kind || "");
    };
    const call = async (method, url, body) => {
      const csrf = await csrfToken();
      const response = await fetch(url, {
        method,
        credentials: "same-origin",
        headers: { "content-type": "application/json", "x-csrf-token": csrf },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || data.error || response.statusText);
      return data;
    };

    tokenForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        const created = await call("POST", "/api/v1/tokens", { name: tokenForm.elements.name.value });
        document.getElementById("new-token-value").textContent = created.token;
        document.getElementById("new-token").hidden = false;
        tokenForm.reset();
        show("Created token " + created.name + ".", "ok");
      } catch (error) {
        show(error.message, "error");
      }
    });

    for (const button of document.querySelectorAll('[data-action="revoke-token"]')) {
      button.addEventListener("click", async () => {
        if (!window.confirm("Revoke token " + button.dataset.name + "? Anything using it stops working.")) return;
        try {
          await call("DELETE", "/api/v1/tokens/" + encodeURIComponent(button.dataset.name));
          window.location.reload();
        } catch (error) {
          show(error.message, "error");
        }
      });
    }
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

/** Lets iOS and others install the app on the home screen, opening straight into Capture. */
export const MANIFEST = JSON.stringify(
  {
    id: "/",
    name: "OctoSprout",
    short_name: "OctoSprout",
    description: "Capture ideas into your OctoSprout workspace.",
    start_url: "/capture",
    scope: "/",
    display: "standalone",
    background_color: "#f4f1ff",
    theme_color: "#1f6b4f",
    icons: [
      { src: "/static/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/static/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/static/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  },
  null,
  2,
);
