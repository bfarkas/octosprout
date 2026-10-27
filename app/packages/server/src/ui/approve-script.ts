/**
 * /static/approve.js: the confirmation for consequential changes (spec §9.1):
 * a dialog with the reasons and the diff, then a fresh passkey assertion
 * (§9.3), then the approved request. Pages call
 * `window.octosproutApprove(preview, title, send)`, where `preview` is the
 * server's 403 `approval_required` answer and `send()` repeats the request
 * with `approve: true`. It resolves to `{ response, data }`, or `null` if the
 * user cancelled. `window.octosproutReverify()` asks for the passkey alone.
 */
export const APPROVE_JS = String.raw`
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
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };

  async function csrf() {
    const response = await fetch("/api/v1/session", { credentials: "same-origin" });
    if (!response.ok) throw new Error("Your session has ended. Sign in again.");
    return (await response.json()).csrf;
  }

  async function post(url, body) {
    const response = await fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", "x-csrf-token": await csrf() },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || data.error || response.statusText);
    return data;
  }

  /** A fresh passkey assertion for this session (§9.3). */
  async function reverify() {
    const options = await post("/api/v1/auth/reverify/options", {});
    options.challenge = toBuffer(options.challenge);
    for (const credential of options.allowCredentials || []) credential.id = toBuffer(credential.id);
    const credential = await navigator.credentials.get({ publicKey: options });
    await post("/api/v1/auth/reverify/verify", {
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
  }

  /** Lines removed and added, in file order; unchanged lines are left out. */
  function diffLines(before, after) {
    const old = (before || "").split("\n");
    const next = (after || "").split("\n");
    const kept = new Set(next);
    const had = new Set(old);
    const out = [];
    for (const line of old) if (!kept.has(line)) out.push(["del", "- " + line]);
    for (const line of next) if (!had.has(line)) out.push(["add", "+ " + line]);
    return out;
  }

  function build(preview, title) {
    const dialog = document.createElement("dialog");
    dialog.className = "approve";
    const form = document.createElement("form");
    form.method = "dialog";
    form.className = "dlg";
    const h2 = document.createElement("h2");
    h2.textContent = title;
    form.appendChild(h2);
    const reasons = (preview.classification && preview.classification.reasons) || [];
    if (reasons.length) {
      const ul = document.createElement("ul");
      ul.className = "hint";
      for (const reason of reasons) {
        const li = document.createElement("li");
        li.textContent = reason;
        ul.appendChild(li);
      }
      form.appendChild(ul);
    }
    for (const file of preview.diff || []) {
      const label = document.createElement("p");
      label.className = "mono hint";
      label.textContent = file.after === null ? file.path + " (deleted)" : file.before === null ? file.path + " (new)" : file.path;
      form.appendChild(label);
      const pre = document.createElement("pre");
      pre.className = "diff";
      for (const [kind, text] of diffLines(file.before, file.after)) {
        const span = document.createElement("span");
        span.className = kind;
        span.textContent = text + "\n";
        pre.appendChild(span);
      }
      form.appendChild(pre);
    }
    const note = document.createElement("p");
    note.className = "hint";
    note.textContent = "Your passkey is asked for again. The change is committed with a signed approval.";
    form.appendChild(note);
    const actions = document.createElement("div");
    actions.className = "actions";
    const cancel = document.createElement("button");
    cancel.className = "secondary";
    cancel.value = "cancel";
    cancel.textContent = "Cancel";
    const ok = document.createElement("button");
    ok.value = "ok";
    ok.textContent = "Approve with passkey";
    actions.append(cancel, ok);
    form.appendChild(actions);
    dialog.appendChild(form);
    document.body.appendChild(dialog);
    return dialog;
  }

  window.octosproutReverify = reverify;

  window.octosproutApprove = (preview, title, send) =>
    new Promise((resolve, reject) => {
      if (!preview || !preview.ok) {
        reject(new Error(preview && preview.message ? preview.message : "This change needs the server's approval key. See Settings."));
        return;
      }
      const dialog = build(preview, title);
      dialog.addEventListener("close", async () => {
        const confirmed = dialog.returnValue === "ok";
        dialog.remove();
        if (!confirmed) return resolve(null);
        try {
          await reverify();
          const response = await send();
          resolve({ response: response, data: await response.json().catch(() => ({})) });
        } catch (error) {
          reject(error && error.name === "NotAllowedError" ? new Error("The passkey check was cancelled. Nothing was changed.") : error);
        }
      });
      dialog.showModal();
    });
})();
`;
