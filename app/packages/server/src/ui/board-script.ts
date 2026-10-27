/**
 * /static/board.js: moving cards on the boards (boards.md §1, §3–§5).
 *
 * The script holds no lifecycle rules: each card lists its allowed targets in
 * `data-moves` and its blob in `data-blob`. After every answer from the
 * server the board is re-rendered from the server's HTML, so the page never
 * shows a state the server does not have.
 */
export const BOARD_JS = String.raw`
(() => {
  const board = () => document.getElementById("board");
  if (!board()) return;
  const boardName = board().dataset.board;
  const toast = document.getElementById("toast");
  let inFlight = 0;
  let csrf = null;
  let toastTimer = null;

  const say = (text) => {
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast.hidden = true), 5000);
  };

  async function token() {
    if (csrf) return csrf;
    const response = await fetch("/api/v1/session", { credentials: "same-origin" });
    if (!response.ok) throw new Error("Your session has ended. Sign in again.");
    csrf = (await response.json()).csrf;
    return csrf;
  }

  // The project filter submits itself.
  for (const select of document.querySelectorAll("select[data-autosubmit]")) {
    select.addEventListener("change", () => select.form.submit());
  }

  // --- Re-rendering from the server ---------------------------------------

  function fragmentUrl() {
    const url = new URL(location.href);
    url.searchParams.set("fragment", "board");
    url.hash = "";
    return url.pathname + url.search;
  }

  /** Swaps in the server's board, keeping which columns are open and flashing changed cards. */
  async function refresh(flash) {
    const response = await fetch(fragmentUrl(), { credentials: "same-origin" });
    if (!response.ok) return false;
    const old = board();
    const open = {};
    const blobs = {};
    for (const col of old.querySelectorAll(".col")) open[col.dataset.status] = col.open;
    for (const card of old.querySelectorAll(".bcard")) blobs[card.dataset.id] = card.dataset.blob;
    const holder = document.createElement("div");
    holder.innerHTML = await response.text();
    const fresh = holder.firstElementChild;
    for (const col of fresh.querySelectorAll(".col")) {
      if (col.dataset.status in open) col.open = open[col.dataset.status];
    }
    for (const card of fresh.querySelectorAll(".bcard")) {
      const changed = blobs[card.dataset.id] !== card.dataset.blob;
      if ((flash === true && changed) || (Array.isArray(flash) && flash.includes(card.dataset.id))) card.classList.add("flash");
    }
    old.replaceWith(fresh);
    bind();
    updateCounts();
    return true;
  }

  function updateCounts() {
    for (const link of document.querySelectorAll(".jump a")) {
      const col = document.getElementById(link.getAttribute("href").slice(1));
      if (col) link.querySelector("b").textContent = col.querySelectorAll(".bcard").length;
    }
  }

  function card(id) {
    return document.getElementById("card-" + id);
  }

  function setSync(id, text, kind) {
    const el = card(id) && card(id).querySelector(".sync");
    if (!el) return;
    el.className = "sync " + (kind || "");
    el.textContent = text;
  }

  // --- Moving -------------------------------------------------------------

  async function move(el, to, baseBlob) {
    const id = el.dataset.id;
    inFlight++;
    // Optimistic: show the card in its new column while the server answers.
    const target = document.querySelector('.col[data-status="' + CSS.escape(to) + '"] .cards');
    if (target) {
      const empty = target.querySelector(".empty");
      if (empty) empty.remove();
      target.prepend(el);
    }
    for (const control of el.querySelectorAll("select, button")) control.disabled = true;
    setSync(id, "Saving…", "saving");

    let response;
    let data = {};
    const send = async (approve) =>
      fetch("/api/v1/records/" + encodeURIComponent(id) + "/status", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", "x-csrf-token": await token() },
        body: JSON.stringify(approve ? { to: to, base_blob: baseBlob || el.dataset.blob, approve: true } : { to: to, base_blob: baseBlob || el.dataset.blob }),
      });
    try {
      response = await send(false);
      data = await response.json().catch(() => ({}));
      // A consequential move: confirm it, with the diff and a passkey, then send it again approved.
      if (response.status === 403 && data.error === "approval_required" && data.move !== "promotion" && window.octosproutApprove) {
        const label = (document.querySelector('.col[data-status="' + CSS.escape(to) + '"] .label') || {}).textContent || to;
        const approved = await window.octosproutApprove(data, "Move " + id + " to " + label + "?", () => send(true));
        if (approved === null) {
          inFlight--;
          await refresh(false);
          return;
        }
        response = approved.response;
        data = approved.data;
      }
    } catch (error) {
      inFlight--;
      await refresh(false);
      say((error && error.message) || "The move could not be sent. Nothing was saved.");
      return;
    }
    inFlight--;

    if (response.ok && (data.status === "committed" || data.status === "pending")) {
      const moved = [id].concat((data.unblocked || []).map((u) => u.id));
      await refresh(moved);
      for (const other of moved) {
        if (data.status === "committed") setSync(other, "✓ " + data.commit.slice(0, 7), "committed");
        else setSync(other, "● pending push", "pending");
      }
      if (data.unblocked && data.unblocked.length) {
        say("Moved " + id + " to " + to + ", and " + data.unblocked.length + " unblocked task" + (data.unblocked.length === 1 ? "" : "s") + " to Ready.");
      }
      return;
    }
    if (response.ok) return refresh(false);
    if (response.status === 409) {
      await refresh(true);
      return conflict(id, to, data);
    }
    await refresh(false);
    if (response.status === 401) say("Your session has ended. Sign in again.");
    else if (response.status === 403 && data.error === "approval_required" && data.move === "promotion") say("An idea is promoted with the promotion wizard.");
    else if (response.status === 403 && data.error === "approval_required") say(data.message || "This move needs the server's approval key. See Settings.");
    else if (data.error === "reverify_required") say("The passkey check expired. Try again.");
    else if (data.error === "no_signing_key") say("The server has no approval signing key, so nothing can be approved.");
    else if (data.error === "stale") say(data.message || "The record changed. Nothing was saved.");
    else if (response.status === 403) {
      csrf = null;
      say("The move was refused. Reload the page and try again.");
    } else if (data.error === "transition") say(data.from + " cannot move to " + data.to + ".");
    else if (data.error === "validation") say(data.findings && data.findings[0] ? data.findings[0].message : "The move would make the record invalid.");
    else say(data.message || data.error || "The move failed. Nothing was saved.");
  }

  /** Asks first when a task with open blockers moves to In progress or Done. */
  function request(el, to) {
    const blockers = (el.dataset.blockedBy || "").split(" ").filter(Boolean);
    if (blockers.length && (to === "in_progress" || to === "done")) {
      const dialog = document.getElementById("dlg-blocked");
      dialog.querySelector('[data-field="text"]').textContent =
        el.dataset.id + " is still blocked by " + blockers.join(", ") + ". Move it anyway?";
      dialog.returnValue = "";
      dialog.onclose = () => {
        if (dialog.returnValue === "ok") move(el, to);
        else refresh(false);
      };
      dialog.showModal();
      return;
    }
    move(el, to);
  }

  /** The three-way view for a status move: status and updated (boards.md §4). */
  function conflict(id, to, data) {
    const dialog = document.getElementById("dlg-conflict");
    const field = (text, name) => {
      const match = new RegExp("^" + name + ":[ \\t]*(.*)$", "m").exec(text || "");
      return match ? match[1].replace(/^"|"$/g, "") : "—";
    };
    const rows = dialog.querySelector('[data-field="rows"]');
    rows.textContent = "";
    for (const name of ["status", "updated"]) {
      const tr = document.createElement("tr");
      const values = [name, field(data.base, name), field(data.current, name), field(data.submitted, name)];
      values.forEach((value, i) => {
        const td = document.createElement(i === 0 ? "th" : "td");
        td.textContent = value;
        if (i === 2 && value !== values[1]) td.className = "changed";
        tr.appendChild(td);
      });
      rows.appendChild(tr);
    }
    dialog.querySelector('[data-field="id"]').textContent = id;
    dialog.querySelector('[data-field="open"]').href = "/records/" + encodeURIComponent(id);
    const gone = data.current === null;
    dialog.querySelector('[data-field="note"]').textContent = gone ? "The record no longer exists." : "Move anyway applies your move to the current version.";
    dialog.querySelector('[data-field="mine"]').hidden = gone || !data.current_blob;
    dialog.returnValue = "";
    dialog.onclose = () => {
      const el = card(id);
      if (dialog.returnValue === "mine" && el && data.current_blob) move(el, to, data.current_blob);
    };
    dialog.showModal();
  }

  // --- Drag by the grip (Pointer Events) ----------------------------------

  let drag = null;

  function columnAt(x, y) {
    const hit = document.elementFromPoint(x, y);
    return hit ? hit.closest(".col") : null;
  }

  function startDrag(event, el) {
    if (event.button !== 0 || inFlight) return;
    event.preventDefault();
    const allowed = (el.dataset.moves || "").split(" ").filter(Boolean);
    const rect = el.getBoundingClientRect();
    const ghost = el.cloneNode(true);
    ghost.classList.add("ghost");
    ghost.removeAttribute("id");
    ghost.style.width = rect.width + "px";
    document.body.appendChild(ghost);
    el.classList.add("lifted");
    board().classList.add("dragging");
    for (const col of document.querySelectorAll(".col")) {
      const status = col.dataset.status;
      if (status === el.dataset.status) continue;
      col.classList.add(allowed.includes(status) ? "drop-ok" : "drop-no");
    }
    drag = { el, ghost, dx: event.clientX - rect.left, dy: event.clientY - rect.top, over: null, pointer: event.pointerId };
    event.target.setPointerCapture(event.pointerId);
    moveGhost(event);
  }

  function moveGhost(event) {
    if (!drag || event.pointerId !== drag.pointer) return;
    drag.ghost.style.left = event.clientX - drag.dx + "px";
    drag.ghost.style.top = event.clientY - drag.dy + "px";
    const col = columnAt(event.clientX, event.clientY);
    if (drag.over && drag.over !== col) drag.over.classList.remove("over");
    drag.over = col;
    if (col) col.classList.add("over");
    // Near the board's edges, scroll it sideways so a phone can reach the next column.
    const box = board().getBoundingClientRect();
    if (event.clientX > box.right - 40) board().scrollLeft += 12;
    else if (event.clientX < box.left + 40) board().scrollLeft -= 12;
  }

  function endDrag(event, cancelled) {
    if (!drag || event.pointerId !== drag.pointer) return;
    const { el, ghost, over } = drag;
    drag = null;
    ghost.remove();
    el.classList.remove("lifted");
    board().classList.remove("dragging");
    for (const col of document.querySelectorAll(".col")) col.classList.remove("drop-ok", "drop-no", "over");
    if (cancelled || !over || over.dataset.status === el.dataset.status) return;
    if (!(el.dataset.moves || "").split(" ").includes(over.dataset.status)) {
      say(el.dataset.id + " cannot move to " + over.querySelector(".label").textContent + " from here.");
      return;
    }
    request(el, over.dataset.status);
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && drag) endDrag({ pointerId: drag.pointer }, true);
  });

  // --- Wiring -------------------------------------------------------------

  function bind() {
    for (const el of board().querySelectorAll(".bcard")) {
      const select = el.querySelector(".move select");
      select.addEventListener("change", () => {
        const to = select.value;
        select.value = "";
        if (to) request(el, to);
      });
      const grip = el.querySelector(".grip");
      grip.addEventListener("pointerdown", (event) => startDrag(event, el));
      grip.addEventListener("pointermove", moveGhost);
      grip.addEventListener("pointerup", (event) => endDrag(event, false));
      grip.addEventListener("pointercancel", (event) => endDrag(event, true));
      const unblock = el.querySelector('[data-action="unblock"]');
      if (unblock) unblock.addEventListener("click", () => move(el, "ready"));
    }
  }
  bind();

  // --- Changes from elsewhere (boards.md §5) --------------------------------

  async function check() {
    if (document.visibilityState !== "visible" || drag) return;
    let response;
    try {
      response = await fetch("/api/v1/boards/" + boardName + "/version", { credentials: "same-origin" });
    } catch (_) {
      return;
    }
    if (!response.ok) return;
    const { version } = await response.json();
    if (version === board().dataset.version) return;
    if (inFlight) say("The board changed elsewhere. It refreshes after this move.");
    else await refresh(true);
  }
  document.addEventListener("visibilitychange", check);
  setInterval(check, 60000);
})();
`;
