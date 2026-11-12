// UIUX_Proj front end: presence, conflict handling, personal undo, edge states.
const ME = 1; // Joseph
let S = { users: [], objects: [], history: [], conflicts: [] };
let editing = null; // { objectId, baseVersion }
let activeConflict = null;
let viewOnly = false, solo = false, historyMode = "mine", toastTimer = null;

const $ = (id) => document.getElementById(id);
const user = (id) => S.users.find((u) => u.id === id);
function esc(s) { return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

/* ---------- network helper ---------- */
async function api(path, body) {
  const opt = body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {};
  const res = await fetch(path, opt);
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

/* ---------- toast ---------- */
function toast(text, { error = false, action = null, onAction = null } = {}) {
  clearTimeout(toastTimer);
  $("toast").className = "toast" + (error ? " error" : "");
  $("toastText").textContent = text;
  const a = $("toastAction");
  a.hidden = !action;
  a.textContent = action || "";
  a.onclick = () => { $("toast").hidden = true; onAction && onAction(); };
  $("toast").hidden = false;
  toastTimer = setTimeout(() => ($("toast").hidden = true), 6000);
}

/* ---------- load + render ---------- */
async function load(first = false) {
  if (first) $("skeleton").hidden = false;
  try {
    const r = await api("/api/state");
    if (!r.ok) throw new Error();
    S = r.data;
    render();
    if (first) setTimeout(() => ($("skeleton").hidden = true), 500);
  } catch {
    $("skeleton").hidden = true;
    toast("Couldn't sync. Your edit is saved locally.", { error: true, action: "Retry", onAction: () => load(true) });
  }
}

function render() {
  const people = solo ? S.users.filter((u) => u.id === ME) : S.users;
  $("avatars").innerHTML = people.map((u) => `<div class="avatar" style="background:${u.color}" title="${u.name}">${u.initials}</div>`).join("");
  $("emptyState").hidden = !solo;
  $("phone").style.visibility = solo ? "hidden" : "visible";

  $("objects").innerHTML = S.objects.map((o) => {
    const ed = o.editing_user_id && o.editing_user_id !== ME ? user(o.editing_user_id) : null;
    const hasConflict = S.conflicts.some((c) => c.object_id === o.id);
    const cls = hasConflict ? "conflict" : ed ? "editing" : "";
    const badge = hasConflict
      ? `<span class="badge conflict">&#9888; Conflict</span>`
      : ed ? `<span class="badge" style="background:${ed.color}">&#9679; ${ed.name} is editing</span>` : "";
    return `<div class="obj">${badge}
      <button class="obj-btn ${cls}" data-id="${o.id}" ${viewOnly ? "disabled" : ""} aria-label="Edit ${esc(o.name)}">${esc(o.label)}</button></div>`;
  }).join("");
  document.querySelectorAll(".obj-btn").forEach((b) => (b.onclick = () => openEditor(+b.dataset.id)));

  $("cursors").innerHTML = solo ? "" : S.users.filter((u) => u.id !== ME).map((u, i) => {
    const pos = i === 0 ? "right:22%;top:34%" : "left:30%;top:60%";
    return `<div class="cursor" style="--c:${u.color};${pos}"><i></i><span>${u.name}</span></div>`;
  }).join("");

  const n = S.conflicts.length;
  $("conflictPill").hidden = !n;
  $("conflictPill").textContent = `\u26A0 ${n} conflict${n > 1 ? "s" : ""}`;

  renderHistory();
  refreshUndoTip();
}

function renderHistory() {
  const items = S.history.filter((h) => historyMode === "all" || h.user_id === ME).slice(0, 8);
  const verb = { edit: "changed label", resolve: "resolved a conflict", undo: "undid a change", restore: "restored a version" };
  $("history").innerHTML = items.length ? items.map((h) => `
    <li><div class="avatar" style="background:${h.user_color}">${h.user_name[0]}</div>
      <div class="${h.undone ? "undone" : ""}"><b>${h.user_id === ME ? "You" : h.user_name}</b> ${verb[h.action] || h.action}
        <small>${esc(h.new_value ?? "")} &middot; ${h.time}
        ${h.new_value && !viewOnly ? `&middot; <button class="restore" data-e="${h.id}">Restore</button>` : ""}</small></div></li>`).join("")
    : `<li class="muted">No changes yet.</li>`;
  document.querySelectorAll(".restore").forEach((b) => (b.onclick = () => restore(+b.dataset.e)));
}

/* ---------- presence + editing ---------- */
async function openEditor(objectId) {
  if (viewOnly) return;
  const o = S.objects.find((x) => x.id === objectId);
  editing = { objectId, baseVersion: o.version };
  await api("/api/presence", { object_id: objectId, user_id: ME, editing: true });
  $("labelInput").value = o.label;
  $("editor").hidden = false;
  $("labelInput").focus();
}

async function closeEditor() {
  if (editing) await api("/api/presence", { object_id: editing.objectId, user_id: ME, editing: false });
  editing = null;
  $("editor").hidden = true;
  load();
}

$("saveBtn").onclick = async () => {
  if (!editing) return;
  const r = await api("/api/edit", {
    object_id: editing.objectId, user_id: ME, new_value: $("labelInput").value, base_version: editing.baseVersion,
  });
  if (r.status === 409) { showBanner(r.data.conflict); await closeEditor(); return; }
  if (!r.ok) return toast(r.data.error || "Couldn't save.", { error: true });
  await closeEditor();
  toast("Saved.", { action: "Undo", onAction: undo });
};
$("cancelBtn").onclick = closeEditor;
$("labelInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("saveBtn").click();
  if (e.key === "Escape") closeEditor();
});

$("simBtn").onclick = async () => {
  if (!editing) return;
  await api("/api/simulate", { object_id: editing.objectId, new_value: "Log in" });
  toast("Alex changed this label to \u201CLog in\u201D while you were editing.");
};

/* ---------- conflict banner ---------- */
function showBanner(c) {
  activeConflict = c;
  $("bannerTitle").textContent = "Conflict on Login button";
  $("bannerText").textContent = `You and ${c.theirs_name} both changed the label. Choose what to keep.`;
  $("mineVal").textContent = c.mine_value;
  $("theirsWho").textContent = `${c.theirs_name}'s:`;
  $("theirsVal").textContent = c.theirs_value;
  $("banner").hidden = false;
}
document.querySelectorAll("[data-choice]").forEach((b) => (b.onclick = async () => {
  if (!activeConflict) return;
  const r = await api(`/api/conflict/${activeConflict.id}/resolve`, { choice: b.dataset.choice });
  $("banner").hidden = true;
  activeConflict = null;
  await load();
  toast(r.ok ? r.data.message : r.data.error, { error: !r.ok, action: r.ok && b.dataset.choice !== "theirs" ? "Undo" : null, onAction: undo });
}));
$("conflictPill").onclick = () => { const c = S.conflicts[0]; if (c) showBanner(c); };

/* ---------- personal undo + restore ---------- */
async function undo() {
  const r = await api("/api/undo", { user_id: ME });
  await load();
  toast(r.ok ? r.data.message : r.data.error, { error: !r.ok });
}
async function restore(eid) {
  const r = await api(`/api/history/${eid}/restore`, { user_id: ME });
  await load();
  toast(r.ok ? r.data.message : r.data.error, { error: !r.ok, action: r.ok ? "Undo" : null, onAction: undo });
}
$("undoBtn").onclick = undo;

async function refreshUndoTip() {
  const r = await api(`/api/undo/peek?user_id=${ME}`);
  const e = r.data.edit;
  $("undoTip").textContent = e
    ? `Undo your change: ${e.new_value}. Teammates' edits stay.`
    : "Nothing of yours to undo.";
}
$("undoBtn").onmouseenter = () => ($("undoTip").hidden = false);
$("undoBtn").onmouseleave = () => ($("undoTip").hidden = true);
$("undoBtn").onfocus = () => ($("undoTip").hidden = false);
$("undoBtn").onblur = () => ($("undoTip").hidden = true);

/* ---------- history filter ---------- */
$("segMine").onclick = () => { historyMode = "mine"; $("segMine").className = "on"; $("segAll").className = ""; renderHistory(); };
$("segAll").onclick = () => { historyMode = "all"; $("segAll").className = "on"; $("segMine").className = ""; renderHistory(); };

/* ---------- edge states ---------- */
window.addEventListener("offline", () => { $("offlineBar").hidden = false; });
window.addEventListener("online", () => { $("offlineBar").hidden = true; load(); toast("Back online. Changes merged."); });
if (!navigator.onLine) $("offlineBar").hidden = false;

$("demoBtn").onclick = () => ($("demoMenu").hidden = !$("demoMenu").hidden);
document.querySelectorAll("[data-demo]").forEach((b) => (b.onclick = async () => {
  $("demoMenu").hidden = true;
  const k = b.dataset.demo;
  if (k === "empty") { solo = !solo; render(); }
  if (k === "loading") {
    $("skeleton").hidden = false; $("history").hidden = true;
    setTimeout(() => { $("skeleton").hidden = true; $("history").hidden = false; }, 2500);
  }
  if (k === "error") toast("Couldn't sync. Your edit is saved locally.", { error: true, action: "Retry", onAction: () => load(true) });
  if (k === "offline") $("offlineBar").hidden = !$("offlineBar").hidden;
  if (k === "viewonly") {
    viewOnly = !viewOnly;
    $("viewOnlyBadge").hidden = !viewOnly;
    render();
    if (viewOnly) toast("You have view-only access.", { action: "Request edit access", onAction: () => toast("Request sent to the file owner.") });
  }
  if (k === "reset") {
    await api("/api/reset", {});
    solo = viewOnly = false;
    $("viewOnlyBadge").hidden = true;
    $("banner").hidden = true;
    await load();
    toast("Demo reset.");
  }
}));
$("inviteBtn").onclick = () => { solo = false; render(); toast("Invite link copied."); };
$("shareBtn").onclick = () => toast("Link copied: anyone with the link can view.");

/* ---------- start ---------- */
load(true);
setInterval(() => { if (!editing && navigator.onLine) load(); }, 4000);