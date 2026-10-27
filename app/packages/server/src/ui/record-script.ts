/**
 * /static/record.js: status moves on Record detail, and the editor (spec
 * §8.4, §12.2): form or whole-file saves with the loaded `base_blob`,
 * unsaved input kept in localStorage until the server acknowledges it, and
 * the three-way merge after a 409.
 */
export const RECORD_JS = String.raw`
(() => {
  let csrf = null;
  async function token() {
    if (csrf) return csrf;
    const response = await fetch("/api/v1/session", { credentials: "same-origin" });
    if (!response.ok) throw new Error("Your session has ended. Sign in again.");
    csrf = (await response.json()).csrf;
    return csrf;
  }
  async function call(method, url, body) {
    const response = await fetch(url, {
      method: method,
      credentials: "same-origin",
      headers: { "content-type": "application/json", "x-csrf-token": await token() },
      body: JSON.stringify(body),
    });
    return { response: response, data: await response.json().catch(() => ({})) };
  }
  const status = document.getElementById("status");
  const show = (text, kind) => {
    status.textContent = text;
    status.className = "status " + (kind || "");
  };
  const explain = (response, data) => {
    if (response.status === 401) return "Your session has ended. Sign in again; your changes are kept in this browser.";
    if (data.error === "approval_required") return data.message || "This change needs approval with your passkey.";
    if (data.error === "forbidden") return data.message;
    if (data.error === "validation") return "The change would make the record invalid:";
    if (data.error === "transition") return data.from + " cannot move to " + data.to + ".";
    return data.message || data.error || "Saving failed. Nothing was saved.";
  };

  // --- Record detail: status moves ----------------------------------------

  const record = document.getElementById("record");
  const move = document.getElementById("move");
  if (record && move) {
    move.addEventListener("change", async () => {
      const to = move.value;
      if (!to) return;
      move.disabled = true;
      show("Saving…");
      try {
        const { response, data } = await call("POST", "/api/v1/records/" + encodeURIComponent(record.dataset.id) + "/status", { to: to, base_blob: record.dataset.blob });
        if (response.ok) return location.reload();
        if (response.status === 409) show("This record changed since the page loaded. Reload to see the current version.", "error");
        else show(explain(response, data), "error");
      } catch (error) {
        show(error.message, "error");
      }
      move.value = "";
      move.disabled = false;
    });
  }

  // --- Editor ----------------------------------------------------------------

  const editor = document.getElementById("editor");
  if (!editor) return;
  const id = editor.dataset.id;
  let baseBlob = editor.dataset.blob;
  const DRAFT = "octosprout.edit." + id;
  const form = document.getElementById("edit-form");
  const raw = document.getElementById("raw");
  const findings = document.getElementById("findings");
  const detail = "/records/" + encodeURIComponent(id);
  let tab = "form";

  function selectTab(name) {
    tab = name;
    for (const button of editor.querySelectorAll(".tab")) button.setAttribute("aria-selected", String(button.dataset.tab === name));
    for (const pane of editor.querySelectorAll("[data-pane]")) {
      if (pane.tagName === "FORM") pane.hidden = pane.dataset.pane !== name;
    }
  }
  for (const button of editor.querySelectorAll(".tab")) button.addEventListener("click", () => selectTab(button.dataset.tab));

  // Repeating rows for links and refs: the last row in each list is a blank one to fill in.
  function wireRow(row) {
    const remove = row.querySelector('[data-action="remove-row"]');
    remove.addEventListener("click", () => {
      row.remove();
      remember();
    });
  }
  for (const row of editor.querySelectorAll(".row")) wireRow(row);
  for (const button of editor.querySelectorAll('[data-action="add-row"]')) {
    button.addEventListener("click", () => {
      const list = editor.querySelector('[data-rows="' + button.dataset.for + '"]');
      const template = list.lastElementChild;
      const row = template.cloneNode(true);
      for (const input of row.querySelectorAll("input")) input.value = "";
      list.appendChild(row);
      wireRow(row);
      row.querySelector("input").focus();
    });
  }

  function formValues() {
    const values = {};
    if (form.elements.title) values.title = form.elements.title.value;
    values.tags = form.elements.tags.value.split(/[\s,]+/).filter(Boolean);
    const links = editor.querySelector('[data-rows="link"]');
    if (links) {
      values.links = [];
      for (const row of links.querySelectorAll(".row")) {
        const target = row.querySelector('[name="id"]').value.trim();
        if (target) values.links.push({ rel: row.querySelector('[name="rel"]').value, id: target });
      }
    }
    const refs = editor.querySelector('[data-rows="ref"]');
    if (refs) {
      values.refs = [];
      for (const row of refs.querySelectorAll(".row")) {
        const url = row.querySelector('[name="url"]').value.trim();
        const note = row.querySelector('[name="note"]').value.trim();
        if (url) values.refs.push(note ? { kind: row.querySelector('[name="kind"]').value, url: url, note: note } : { kind: row.querySelector('[name="kind"]').value, url: url });
      }
    }
    if (form.elements.body && !form.elements.body.readOnly) values.body = form.elements.body.value;
    return values;
  }

  // --- Drafts: nothing typed is lost until the server has it ----------------

  function remember() {
    try {
      localStorage.setItem(DRAFT, JSON.stringify({ blob: baseBlob, tab: tab, form: formValues(), raw: raw.value }));
    } catch (_) {}
  }
  function forget() {
    try {
      localStorage.removeItem(DRAFT);
    } catch (_) {}
  }
  editor.addEventListener("input", remember);
  editor.addEventListener("change", remember);

  function restore(draft) {
    if (form.elements.title && draft.form.title !== undefined) form.elements.title.value = draft.form.title;
    form.elements.tags.value = (draft.form.tags || []).join(" ");
    if (form.elements.body && draft.form.body !== undefined && !form.elements.body.readOnly) form.elements.body.value = draft.form.body;
    for (const kind of ["link", "ref"]) {
      const list = editor.querySelector('[data-rows="' + kind + '"]');
      const items = draft.form[kind + "s"];
      if (!list || !items) continue;
      const template = list.lastElementChild.cloneNode(true);
      list.textContent = "";
      for (const item of items.concat([null])) {
        const row = template.cloneNode(true);
        for (const input of row.querySelectorAll("input, select")) {
          const value = item ? item[input.name] : undefined;
          if (input.tagName === "SELECT") {
            if (value) input.value = value;
          } else input.value = value || "";
        }
        list.appendChild(row);
        wireRow(row);
      }
    }
    raw.value = draft.raw;
    selectTab(draft.tab || "form");
  }

  try {
    const saved = JSON.parse(localStorage.getItem(DRAFT) || "null");
    if (saved) {
      restore(saved);
      // Edits made on an older version save against that version, which the server answers with the merge view.
      if (saved.blob !== baseBlob) baseBlob = saved.blob;
      document.getElementById("draft-note").hidden = false;
    }
  } catch (_) {}
  document.querySelector('[data-action="discard-draft"]').addEventListener("click", () => {
    forget();
    location.reload();
  });

  // --- Saving ------------------------------------------------------------

  async function save(payload) {
    findings.textContent = "";
    show("Saving…");
    let result;
    try {
      result = await call("PUT", "/api/v1/records/" + encodeURIComponent(id), payload);
    } catch (error) {
      return show(error.message + " Your changes are kept in this browser.", "error");
    }
    const { response, data } = result;
    if (response.ok) {
      forget();
      location.assign(detail);
      return;
    }
    if (response.status === 409) return merge(data);
    show(explain(response, data), "error");
    for (const finding of data.findings || []) {
      const li = document.createElement("li");
      li.className = "card";
      li.textContent = finding.code + ": " + finding.message + " " + finding.hint;
      findings.appendChild(li);
    }
  }

  document.getElementById("save").addEventListener("click", () => {
    if (tab === "raw") save({ base_blob: baseBlob, content: raw.value });
    else save({ base_blob: baseBlob, form: formValues() });
  });

  // --- Three-way merge (§8.4) ---------------------------------------------

  const mergeView = document.getElementById("merge");
  const merged = document.getElementById("merged");
  let currentBlob = null;

  /** Writes text into a pane, marking lines that are not in the base version. */
  function fill(pane, text, base) {
    const el = mergeView.querySelector('[data-pane="' + pane + '"]');
    el.textContent = "";
    if (text === null) {
      el.textContent = pane === "current" ? "(deleted)" : "(not available)";
      return;
    }
    const known = new Set((base || "").split("\n"));
    for (const line of text.split("\n")) {
      const span = document.createElement("span");
      span.textContent = line + "\n";
      if (base !== null && pane !== "base" && !known.has(line)) span.className = "changed";
      el.appendChild(span);
    }
  }

  function merge(data) {
    show("");
    currentBlob = data.current_blob;
    fill("base", data.base, null);
    fill("current", data.current, data.base);
    fill("mine", data.submitted, data.base);
    merged.value = data.submitted !== null ? data.submitted : raw.value;
    mergeView.hidden = false;
    document.getElementById("save-merged").disabled = !currentBlob;
    mergeView.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  document.getElementById("save-merged").addEventListener("click", () => {
    baseBlob = currentBlob;
    raw.value = merged.value;
    remember();
    save({ base_blob: currentBlob, content: merged.value });
  });
  document.querySelector('[data-action="discard-mine"]').addEventListener("click", () => {
    forget();
    location.assign(detail);
  });
})();
`;
