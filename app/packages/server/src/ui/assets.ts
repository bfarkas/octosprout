/**
 * Static assets, embedded so the build needs no file copying.
 */

export const APP_CSS = `
:root {
  color-scheme: light dark;
  --paper: #f8faf6;
  --sidebar: #f1f6ee;
  --surface: #fdfefc;
  --column: #f4f8f2;
  --text: #1e2721;
  --muted: #5f6b63;
  --border: #dde5da;
  --violet: #7753d6;
  --violet-soft: #eee8fc;
  --violet-text: #5b3bb8;
  --violet-line: #c9bbf2;
  --on-violet: #ffffff;
  --green: #34785d;
  --green-soft: #e3f1e8;
  --danger: #b4323a;
  --danger-soft: #fbe6e8;
  --warn: #8a5a00;
  --warn-soft: #f7ecd6;
  --shade: rgba(28, 40, 30, 0.16);
  --font: ui-rounded, system-ui, -apple-system, "Segoe UI", sans-serif;
  --mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: dark) {
  :root {
    --paper: #111712; --sidebar: #182019; --surface: #1a231c; --column: #141b15;
    --text: #e7ede6; --muted: #9aa79c; --border: #2a352c;
    --violet: #a78bfa; --violet-soft: #2a2350; --violet-text: #c4b2ff; --violet-line: #4a3d86; --on-violet: #15101f;
    --green: #72c795; --green-soft: #1b3125; --danger: #ff8a8f; --danger-soft: #3b1d21;
    --warn: #f0b84d; --warn-soft: #362a12; --shade: rgba(0, 0, 0, 0.5);
  }
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--paper); color: var(--text); font: 16px/1.5 var(--font); }
a { color: var(--violet-text); }
code, .mono { font-family: var(--mono); font-size: 0.88em; }
[hidden] { display: none !important; }
:focus-visible { outline: 2px solid var(--violet); outline-offset: 2px; }

/* Shell: sidebar, top bar, content. Pages without the shell (sign-in) are just main. */
.shell { display: grid; grid-template-columns: 14rem minmax(0, 1fr); min-height: 100vh; min-height: 100dvh; }
.side { background: var(--sidebar); border-right: 1px solid var(--border); display: flex; flex-direction: column; gap: 1.25rem; padding: 1.1rem 0.9rem; position: sticky; top: 0; height: 100vh; height: 100dvh; }
.brand { display: flex; align-items: center; gap: 0.6rem; font-weight: 800; font-size: 1.2rem; letter-spacing: -0.02em; padding: 0 0.3rem; color: var(--text); text-decoration: none; }
.brand img { width: 2.2rem; height: 2.2rem; object-fit: contain; flex: none; }
.sidenav { display: grid; gap: 0.2rem; }
.sidenav a, .sidefoot a, .sidefoot button { display: flex; align-items: center; gap: 0.65rem; padding: 0.55rem 0.7rem; border-radius: 12px; color: var(--muted); text-decoration: none; font-weight: 500; }
.sidenav svg, .sidefoot svg { width: 1.15rem; height: 1.15rem; flex: none; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
.sidenav a:hover, .sidefoot a:hover, .sidefoot button:hover { color: var(--text); }
.sidenav a[aria-current="page"], .sidefoot a[aria-current="page"] { background: var(--surface); color: var(--violet-text); font-weight: 700; box-shadow: 0 1px 2px var(--shade); }
.side .capture { display: flex; align-items: center; justify-content: center; gap: 0.4rem; font-weight: 600; color: var(--green); background: var(--green-soft); border: 1px solid var(--green); border-radius: 12px; padding: 0.6rem; text-decoration: none; }
.side .capture[aria-current="page"] { box-shadow: 0 0 0 2px var(--green-soft); }
.sidefoot { margin-top: auto; display: grid; gap: 0.1rem; }
.sidefoot button { font: inherit; background: none; border: 0; cursor: pointer; width: 100%; }
.content { min-width: 0; display: flex; flex-direction: column; }
.topbar { display: flex; align-items: center; gap: 0.75rem; padding: 0.8rem 1.5rem; border-bottom: 1px solid var(--border); background: var(--surface); position: sticky; top: 0; z-index: 5; }
.crumbs { font-size: 0.78rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.crumbs b { color: var(--violet-text); }
.sync-global { margin-left: auto; display: inline-flex; align-items: center; gap: 0.4rem; font-size: 0.85rem; font-weight: 700; color: var(--green); white-space: nowrap; font-variant-numeric: tabular-nums; }
.sync-global.pending { color: var(--warn); }
.sync-global.conflict { color: var(--danger); }
.dot { width: 0.6rem; height: 0.6rem; border-radius: 50%; background: currentColor; box-shadow: 0 0 0 3px var(--green-soft); display: inline-block; flex: none; }
.pending .dot { box-shadow: 0 0 0 3px var(--warn-soft); }
.conflict .dot { box-shadow: 0 0 0 3px var(--danger-soft); }
main { width: 100%; max-width: 44rem; margin: 0 auto; padding: 1.25rem 16px 3rem; }
main.wide { max-width: none; padding: 1.4rem 1.5rem 1.5rem; }
.shell main { margin: 0; }
.shell main:not(.wide) { margin: 0 auto; }
@media (max-width: 760px) {
  .shell { grid-template-columns: minmax(0, 1fr); }
  .side { position: static; height: auto; flex-direction: row; flex-wrap: wrap; align-items: center; gap: 0.3rem 0.4rem; padding: 0.5rem 0.6rem; border-right: 0; border-bottom: 1px solid var(--border); }
  .brand span, .sidenav a span, .side .capture span, .sidefoot span, .crumbs .group, .sync-global .label { display: none; }
  .brand { padding: 0; }
  .sidenav { display: flex; flex: 1 1 0; min-width: 0; overflow-x: auto; gap: 0.1rem; scrollbar-width: none; }
  .sidenav a { flex: none; justify-content: center; padding: 0.6rem; }
  .sidefoot { margin-top: 0; display: flex; flex: none; gap: 0.1rem; }
  .sidefoot a, .sidefoot button { justify-content: center; padding: 0.6rem; }
  .side .capture { flex: none; width: 2.6rem; height: 2.6rem; padding: 0; border-radius: 50%; }
  .topbar { padding: 0.6rem 0.75rem; }
  main.wide { padding: 1rem 0.75rem; }
}

/* Text and forms */
h1 { font-size: 1.6rem; font-weight: 800; letter-spacing: -0.03em; margin: 0.5rem 0 0.75rem; display: flex; align-items: baseline; gap: 0.6rem; flex-wrap: wrap; }
h1 .meta { font-size: 1rem; font-weight: 500; letter-spacing: 0; }
h2 { font-size: 1.1rem; margin: 1.5rem 0 0.5rem; }
label { display: block; font-weight: 600; margin: 1rem 0 0.25rem; }
input[type="text"], input[type="url"], input[type="password"], input[type="search"], textarea, select {
  width: 100%; padding: 0.6rem 0.7rem; font: inherit; color: inherit;
  background: var(--surface); border: 1px solid var(--border); border-radius: 12px;
}
textarea { min-height: 12rem; resize: vertical; }
.button, button {
  font: inherit; font-weight: 600; cursor: pointer; border-radius: 12px; padding: 0.6rem 1rem;
  border: 1px solid var(--violet); background: var(--violet); color: var(--on-violet);
  text-decoration: none; display: inline-block;
}
button.secondary, .button.secondary { background: var(--surface); color: var(--violet-text); border-color: var(--border); }
button.link { background: none; border: none; color: var(--violet-text); padding: 0.25rem 0; text-decoration: underline; font-weight: 500; }
button:disabled { opacity: 0.6; cursor: progress; }
.actions { margin-top: 1rem; display: flex; gap: 0.75rem; align-items: center; flex-wrap: wrap; }
.status { margin-top: 1rem; min-height: 1.5rem; }
.status.error { color: var(--danger); }
.status.ok { color: var(--green); }
.status.pending { color: var(--warn); }
.hint, .meta { color: var(--muted); font-size: 0.9rem; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 0.8rem 1rem; margin: 0.75rem 0; box-shadow: 0 1px 2px var(--shade); }
.card pre { white-space: pre-wrap; overflow-wrap: anywhere; margin: 0.5rem 0 0; font: inherit; }
.card summary { list-style: none; cursor: pointer; }
.card summary::-webkit-details-marker { display: none; }
.card .toggle { color: var(--violet-text); font-size: 0.9rem; }
.card .toggle::after { content: "Show all"; }
.card details[open] .toggle::after { content: "Show less"; }
.card details[open] .preview { display: none; }
ul.plain { list-style: none; padding: 0; margin: 0; }
.banner { border: 1px solid var(--warn); color: var(--warn); background: var(--warn-soft); border-radius: 14px; padding: 0.6rem 0.9rem; margin: 0.75rem 0; font-size: 0.92rem; }
.eyebrow { font-size: 0.75rem; letter-spacing: 0.14em; text-transform: uppercase; color: var(--green); font-weight: 800; }

/* Boards (boards.md) */
.boardhead { display: flex; flex-wrap: wrap; align-items: end; gap: 0.5rem 1rem; }
.boardhead h1 { font-size: 2.1rem; letter-spacing: -0.035em; line-height: 1.1; margin: 0; }
.filter { display: flex; gap: 0.5rem; align-items: center; margin-left: auto; }
.boardhead > .button { padding: 0.45rem 0.9rem; }
.boardhead > div + .button { margin-left: auto; }
.filter label { margin: 0; font-weight: 500; color: var(--muted); font-size: 0.9rem; white-space: nowrap; }
.filter select { width: auto; max-width: 14rem; padding: 0.4rem 0.6rem; }
.jump { display: none; gap: 0.4rem; overflow-x: auto; padding: 0.75rem 0 0; scrollbar-width: none; }
.jump a { font-size: 0.8rem; white-space: nowrap; border: 1px solid var(--border); background: var(--surface); color: var(--text); border-radius: 999px; padding: 0.2rem 0.65rem; text-decoration: none; }
.jump a b { color: var(--muted); font-weight: 500; margin-left: 0.25rem; }
.board { display: flex; gap: 1rem; align-items: stretch; margin-top: 1.1rem; overflow-x: auto; padding-bottom: 0.5rem; }
.col { flex: 1 1 0; min-width: 14.5rem; background: var(--column); border: 1px solid var(--border); border-radius: 18px; padding: 0.85rem 0.75rem 1rem; min-height: 22rem; transition: opacity 0.15s, border-color 0.15s, background 0.15s; }
.col[open] { display: flex; flex-direction: column; gap: 0.65rem; }
.col > summary { list-style: none; cursor: pointer; display: flex; align-items: baseline; gap: 0.4rem; font-weight: 700; font-size: 1.02rem; padding: 0 0.3rem; }
.col > summary::-webkit-details-marker { display: none; }
.col > summary .count { margin-left: auto; color: var(--muted); font-weight: 600; font-size: 0.9rem; font-variant-numeric: tabular-nums; }
.col:not([open]) { flex: 0 0 3.1rem; min-width: 0; padding: 0.85rem 0.3rem; }
.col:not([open]) > summary { writing-mode: vertical-rl; transform: rotate(180deg); justify-content: flex-end; padding: 0; margin: 0 auto; }
.col:not([open]) > summary .count { margin-left: 0; }
.col.gated > summary .label { color: var(--violet-text); }
.colhint { font-size: 0.82rem; color: var(--green); padding: 0 0.3rem; margin-top: -0.35rem; }
.cards { display: grid; grid-template-columns: minmax(0, 1fr); gap: 0.75rem; align-content: start; }
.empty { font-size: 0.82rem; color: var(--muted); border: 1px dashed var(--border); border-radius: 14px; padding: 0.8rem; text-align: center; }
.dragging .col.drop-no { opacity: 0.4; }
.dragging .col.drop-ok { border-style: dashed; border-color: var(--green); }
.dragging .col.drop-ok.over { background: var(--green-soft); }
.dragging .col.drop-gate { border-style: dashed; border-color: var(--violet); }
.dragging .col.drop-gate.over { background: var(--violet-soft); }
.bcard { min-width: 0; background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 0.85rem 0.9rem 0.8rem; display: grid; gap: 0.45rem; box-shadow: 0 1px 2px var(--shade); }
.bcard.flash { animation: flash 1.6s ease-out; }
@keyframes flash { from { box-shadow: 0 0 0 3px var(--green); } to { box-shadow: 0 1px 2px var(--shade); } }
.bcard.lifted { opacity: 0.35; }
.bcard-top { display: flex; gap: 0.4rem; align-items: start; }
.grip { flex: none; width: 1.5rem; height: 1.6rem; margin: -0.05rem 0 0 -0.35rem; padding: 0; border: 0; border-radius: 8px; background: none; color: var(--muted); cursor: grab; touch-action: none; font-size: 1rem; line-height: 1; display: grid; place-items: center; }
.grip:hover { background: var(--column); color: var(--violet-text); }
.grip:disabled { visibility: hidden; }
.btitle { font-weight: 700; font-size: 1.02rem; color: var(--text); text-decoration: none; line-height: 1.3; min-width: 0; overflow-wrap: anywhere; }
a.btitle:hover { color: var(--violet-text); }
.bmeta { font-size: 0.85rem; color: var(--muted); line-height: 1.45; overflow-wrap: anywhere; }
.chips { display: flex; flex-wrap: wrap; gap: 0.3rem; }
.chip { font-size: 0.75rem; font-weight: 600; border-radius: 999px; padding: 0.1rem 0.55rem; background: var(--column); color: var(--muted); border: 1px solid var(--border); }
.chip.block { color: var(--danger); border-color: transparent; background: var(--danger-soft); font-weight: 800; }
.chip.ready { color: var(--green); border-color: var(--green); background: var(--green-soft); font-weight: 800; }
button.chip { font-family: inherit; cursor: pointer; text-align: left; }
.bfoot { display: flex; align-items: center; gap: 0.5rem; justify-content: space-between; margin-top: 0.2rem; }
.move { min-width: 0; flex: 0 1 9rem; display: flex; }
.move select { appearance: none; -webkit-appearance: none; font-size: 0.92rem; font-weight: 500; color: var(--violet-text); background: var(--violet-soft); border: 1px solid transparent; border-radius: 10px; padding: 0.35rem 0.75rem; text-overflow: ellipsis; cursor: pointer; }
.move select:hover { border-color: var(--violet-line); }
.move select:disabled { opacity: 0.5; cursor: default; }
.sync { font-size: 0.8rem; white-space: nowrap; display: inline-flex; align-items: center; gap: 0.3rem; color: var(--muted); font-variant-numeric: tabular-nums; }
.sync.committed { color: var(--green); font-weight: 700; }
.sync.pending { color: var(--warn); font-weight: 700; }
.sync.saving::before { content: ""; width: 0.6rem; height: 0.6rem; border: 2px solid var(--muted); border-right-color: transparent; border-radius: 50%; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.ghost { position: fixed; pointer-events: none; z-index: 50; transform: rotate(2deg); box-shadow: 0 14px 30px var(--shade); margin: 0; }
dialog { border: 1px solid var(--border); border-radius: 18px; background: var(--surface); color: var(--text); padding: 0; width: min(34rem, calc(100vw - 32px)); box-shadow: 0 20px 50px var(--shade); }
dialog::backdrop { background: var(--shade); }
.dlg { padding: 1.1rem 1.2rem; display: grid; gap: 0.65rem; }
.dlg h2 { margin: 0; font-size: 1.15rem; }
.dlg p { margin: 0; }
.dlg .actions { justify-content: flex-end; margin-top: 0.25rem; }
.three { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
.three th, .three td { text-align: left; padding: 0.35rem 0.45rem; border-bottom: 1px solid var(--border); vertical-align: top; }
.three th { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
.three td.changed { background: var(--warn-soft); }
.tablewrap { overflow-x: auto; }
.toast { position: fixed; left: 50%; bottom: calc(1rem + env(safe-area-inset-bottom, 0px)); transform: translateX(-50%); background: var(--text); color: var(--paper); padding: 0.5rem 1rem; border-radius: 12px; font-size: 0.88rem; z-index: 60; max-width: calc(100vw - 32px); }
@media (max-width: 760px) {
  .boardhead h1 { font-size: 1.6rem; }
  .filter { margin-left: 0; }
  .jump { display: flex; }
  .board { scroll-snap-type: x mandatory; gap: 0.6rem; margin-inline: -0.75rem; padding-inline: 0.75rem; scroll-padding-inline: 0.75rem; }
  .col[open] { flex: 0 0 84%; min-width: 0; scroll-snap-align: start; min-height: 16rem; }
}
/* Approvals and proposals */
.diff { font-family: var(--mono); font-size: 0.78rem; background: var(--column); border: 1px solid var(--border); border-radius: 12px; padding: 0.55rem 0.7rem; overflow: auto; max-height: 18rem; white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; }
.card pre.diff { font-family: var(--mono); font-size: 0.78rem; margin: 0; }
.proposal .status:empty { display: none; }
.diff .del { color: var(--danger); }
.diff .add { color: var(--green); }
dialog.approve { width: min(44rem, calc(100vw - 32px)); }
dialog.approve .dlg ul { margin: 0; padding-left: 1.2rem; }
.badge { font-size: 0.72rem; font-weight: 800; letter-spacing: 0.04em; border-radius: 999px; padding: 0.1rem 0.5rem; background: var(--column); color: var(--muted); border: 1px solid var(--border); white-space: nowrap; }
.badge.gated { color: var(--violet-text); background: var(--violet-soft); border-color: var(--violet-line); }
.badge.applied { color: var(--green); background: var(--green-soft); border-color: transparent; }
.badge.rejected, .badge.stale { color: var(--danger); background: var(--danger-soft); border-color: transparent; }
.proposal h2 { margin: 0 0 0.25rem; font-size: 1.05rem; display: flex; gap: 0.5rem; align-items: baseline; flex-wrap: wrap; }
.proposal .actions { margin-top: 0.6rem; }
.proposal details { margin-top: 0.5rem; }
.proposal summary { cursor: pointer; color: var(--violet-text); font-size: 0.9rem; }
.bulk { display: flex; gap: 0.75rem; align-items: center; flex-wrap: wrap; margin: 0.5rem 0 0.25rem; }
.select-row { display: inline-flex; gap: 0.4rem; align-items: center; font-weight: 500; margin: 0; }

/* Health */
.facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr)); gap: 0.75rem; margin: 1rem 0; }
.fact { background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 0.7rem 0.9rem; display: grid; gap: 0.15rem; overflow-wrap: anywhere; }
.fact.ok strong { color: var(--green); }
.fact.warn strong { color: var(--warn); }
.fact.bad strong, .fact.bad a { color: var(--danger); }
.banner.alert { border-color: var(--danger); color: var(--danger); background: var(--danger-soft); }
a.sync-global { text-decoration: none; }

/* Lists and search */
.topsearch { margin-left: auto; flex: 0 1 16rem; min-width: 0; }
.topsearch input { padding: 0.35rem 0.7rem; border-radius: 999px; font-size: 0.9rem; }
.topsearch + .sync-global { margin-left: 0.5rem; }
.listrow { display: grid; gap: 0.2rem; margin: 0.6rem 0; }
.listrow .chips { margin-top: 0.15rem; }
.snippet { color: var(--muted); font-size: 0.9rem; overflow-wrap: anywhere; }
mark { background: var(--violet-soft); color: inherit; border-radius: 4px; padding: 0 0.1rem; }
.searchform { display: flex; gap: 0.5rem; flex-wrap: wrap; }
.searchform input { flex: 1 1 14rem; width: auto; }
.searchform select { width: auto; }
.filters { display: flex; }
.filters a[aria-current="page"] { border-color: var(--violet); color: var(--violet-text); font-weight: 700; }
@media (max-width: 760px) { .topsearch { flex-basis: 8rem; } }

/* Promotion wizard */
.wizard { max-width: 56rem; }
.wizard section { margin-top: 1.25rem; }
.wizard h2 { display: flex; gap: 0.5rem; align-items: baseline; }
.review { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1rem; }
.review h3 { font-size: 0.75rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); margin: 0.75rem 0 0.25rem; }
.choices { display: flex; flex-wrap: wrap; gap: 0.5rem 1.25rem; }
.choices label { display: inline-flex; gap: 0.4rem; align-items: center; margin: 0; font-weight: 500; }
@media (max-width: 760px) { .review { grid-template-columns: minmax(0, 1fr); } }

/* Triage */
.banner.info { border-color: var(--green); color: var(--green); background: var(--green-soft); }
.triage-button { float: right; margin: -0.2rem 0 0.4rem 0.75rem; padding: 0.35rem 0.8rem; font-size: 0.9rem; }
.triage { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr); gap: 1.5rem; align-items: start; margin-top: 0.5rem; }
.triage .capture-text { margin: 1rem 0 0; max-height: 70vh; overflow: auto; }
.picks { display: grid; gap: 0.4rem; max-height: 22rem; overflow: auto; margin-top: 0.6rem; }
.pick { display: flex; gap: 0.6rem; align-items: start; font-weight: 400; margin: 0; padding: 0.55rem 0.7rem; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); cursor: pointer; }
.pick:has(input:checked) { border-color: var(--violet); background: var(--violet-soft); }
.pick input { margin-top: 0.3rem; }
@media (max-width: 900px) { .triage { grid-template-columns: minmax(0, 1fr); } }

/* Record detail and editor */
.recordhead { display: flex; flex-wrap: wrap; align-items: end; gap: 0.75rem 1rem; }
.recordhead h1 { font-size: 2rem; letter-spacing: -0.035em; line-height: 1.15; margin: 0.15rem 0 0.25rem; }
.recordhead .meta { margin: 0; }
.recordactions { margin-left: auto; display: flex; gap: 0.6rem; align-items: center; }
.recordactions .move { flex: 0 1 12rem; }
.recordgrid { display: grid; grid-template-columns: minmax(0, 1fr) 20rem; gap: 1.5rem; margin-top: 1rem; align-items: start; }
.recordbody { background: var(--surface); border: 1px solid var(--border); border-radius: 18px; padding: 1rem 1.25rem; min-width: 0; }
.recordside { display: grid; gap: 0.25rem; font-size: 0.92rem; min-width: 0; }
.recordside h2 { font-size: 0.75rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); margin: 0.75rem 0 0.25rem; }
.facts li { padding: 0.2rem 0; overflow-wrap: anywhere; }
.rel { font-family: var(--mono); font-size: 0.78rem; color: var(--green); margin-right: 0.25rem; }
.markdown { overflow-wrap: anywhere; }
.markdown h1, .markdown h2, .markdown h3 { margin: 1.1rem 0 0.4rem; display: block; }
.markdown > :first-child { margin-top: 0; }
.markdown pre { background: var(--column); border: 1px solid var(--border); border-radius: 12px; padding: 0.6rem 0.8rem; overflow-x: auto; }
.markdown code { font-family: var(--mono); font-size: 0.88em; }
.markdown table { border-collapse: collapse; display: block; overflow-x: auto; }
.markdown th, .markdown td { border: 1px solid var(--border); padding: 0.3rem 0.5rem; }
.markdown blockquote { margin: 0.5rem 0; padding-left: 0.8rem; border-left: 3px solid var(--violet-line); color: var(--muted); }
.markdown li.task { list-style: none; margin-left: -1.3rem; }
pre.verbatim { white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; font: inherit; }
.tabs { display: inline-flex; max-width: 100%; overflow-x: auto; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); margin: 1rem 0 0.25rem; scrollbar-width: none; }
.tabs .tab { flex: none; white-space: nowrap; border: 0; border-radius: 0; background: none; color: var(--text); padding: 0.4rem 0.9rem; font-weight: 500; }
.tabs .tab + .tab { border-left: 1px solid var(--border); }
.tabs .tab[aria-selected="true"] { background: var(--violet); color: var(--on-violet); }
#editor { max-width: 52rem; }
fieldset { border: 1px solid var(--border); border-radius: 14px; margin: 1rem 0 0; padding: 0.5rem 0.9rem 0.6rem; }
legend { font-weight: 600; padding: 0 0.3rem; }
.rows { display: grid; gap: 0.5rem; margin: 0.25rem 0 0.4rem; }
.row { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; }
.row select { width: auto; flex: 0 0 auto; }
.row input { flex: 1 1 10rem; width: auto; min-width: 0; }
textarea.code { font-family: var(--mono); font-size: 0.9rem; line-height: 1.45; }
textarea.tall { min-height: 24rem; }
.three-way { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.75rem; }
.three-way h3 { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin: 0.5rem 0 0.25rem; }
.three-way pre { font-family: var(--mono); font-size: 0.78rem; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 0.5rem 0.6rem; overflow: auto; max-height: 24rem; margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.three-way .changed { background: var(--warn-soft); }
#findings li { color: var(--danger); font-size: 0.9rem; }
@media (max-width: 900px) {
  .recordgrid { grid-template-columns: minmax(0, 1fr); }
  .three-way { grid-template-columns: minmax(0, 1fr); }
  .recordactions { margin-left: 0; }
}
@media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
`;

const RETURN_KEY = "octosprout.return";

/**
 * On the "sign in required" page: remember the page the user wanted, including its
 * fragment (which is where shared text travels), so sign-in can go back there.
 */
export const RETURN_JS = `
(() => {
  const pages = ["/", "/capture", "/settings", "/health", "/ideas", "/tasks", "/projects", "/decisions", "/research", "/experts", "/proposals", "/search"];
  try {
    if (pages.includes(location.pathname) || location.pathname.startsWith("/records/") || location.pathname.startsWith("/inbox/")) {
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
        const onlyLink = /^https:\\/\\/\\S+$/.test(shared.trim());
        form.elements.source_url.value = onlyLink ? shared.trim() : "";
        key = null;
        remember(shared);
        // Some apps (ChatGPT among them) share only a link to the conversation, not its text.
        show(
          onlyLink
            ? "Only a link was shared. To capture the text behind it, copy that text, then tap Paste & save; the link is kept."
            : "Shared text is ready. Check it and tap Save.",
        );
      }
      // Drop the fragment so a reload after saving does not bring the text back.
      history.replaceState(null, "", location.pathname + location.search);
    };
    takeShared();
    // Safari may reuse a tab that is already on /capture; then only the fragment changes.
    window.addEventListener("hashchange", takeShared);

    // One idempotency key per attempt: a retry of the same text can never create a duplicate.
    // Editing shared text does not change where it came from, so the source is kept.
    form.elements.text.addEventListener("input", () => {
      key = null;
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
      // The pasted text replaces the text field; a shared link and its source stay.
      form.elements.text.value = pasted;
      key = null;
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
    background_color: "#f8faf6",
    theme_color: "#f8faf6",
    icons: [
      { src: "/static/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/static/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/static/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  },
  null,
  2,
);
