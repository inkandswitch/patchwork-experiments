// scene.notices (native, a view plugin): what the scene has to say, over the
// view, provided as "notices" (NATIVE.md, "Native services").
//   - toasts (bottom centre): `use("notices").notify(text, kind?)` adds one
//     for 6 s; one saying what one still showing says replaces it; a notice
//     that goes fades out.
//   - HUD pills (top left): the load summary from local.status ("Loading 40
//     of 74…", "Building 2…", "3 errors"),
//     then every running extension's hud(scene, local) in running order;
//     read again when the scene, local or view state changes, or when an
//     extension says its lines changed (`use("notices").changed()`: a status
//     learned later, as a keeper's deck step, changes nothing the stage sees).

import css from "./notices.css?inline";
import { localChanged } from "../shared/shallow.js";

const FADE_MS = 250;
/** How long a notice shows. */
const NOTICE_MS = 6_000;
const MAX_TOASTS = 4;

/**
 * The load summary as pills: [{ text, state }]. Pure.
 * "Loading" counts what's shown and has content to load (a group has none).
 * @param {object} objects  scene.objects
 * @param {object} status   local.status: { [id]: { state } }
 */
export function loadSummary(objects, status) {
  const states = Object.entries(status ?? {})
    .filter(([id]) => objects?.[id])
    .map(([, s]) => s?.state);
  const count = (st) => states.filter((s) => s === st).length;
  const loading = count("loading");
  const building = count("building");
  const errors = count("error");
  const out = [];
  if (loading) {
    let total = 0;
    for (const [id, o] of Object.entries(objects ?? {})) {
      if (!o || o.kind === "group") continue;
      if (status?.[id] || (o.visible !== false && (o.sourceUrl || o.renderUrl))) total++;
    }
    total = Math.max(total, loading);
    out.push({
      text: `Loading ${total - loading} of ${total}…`,
      state: "loading",
    });
  }
  if (building) out.push({ text: `Building ${building}…`, state: "building" });
  if (errors)
    out.push({
      text: `${errors} error${errors > 1 ? "s" : ""}`,
      state: "error",
    });
  return out;
}

/**
 * The notices after one more: a notice saying what one still showing says
 * (the same text and kind) replaces it, so it shows once (three tables laid
 * at once each saying "Pick a seat" is one prompt), timed from now. Pure.
 * @param {readonly object[] | undefined} list  @param {{ text: string, kind: string }} n
 */
export function withNotice(list, n) {
  return Object.freeze([...(list ?? []).filter((x) => x.text !== n.text || x.kind !== n.kind), n]);
}

const STATES = new Set(["loading", "building", "error", "warn", "info", "stale"]);

function create(api) {
  api.style(css);
  const overlay = api.overlay();
  overlay.classList.add("notices-layer");
  const hud = document.createElement("div");
  hud.className = "hud";
  hud.setAttribute("aria-live", "polite");
  const toasts = document.createElement("div");
  toasts.className = "toasts";
  toasts.setAttribute("role", "status");
  overlay.append(hud, toasts);

  const shown = new Map(); // notice id → element
  const timers = new Set();
  let hudKey = "";
  let told = null; // the last { scene, local, view } update gave: what changed() draws the pills from
  let redraw = false;
  let notices = Object.freeze([]);
  let seq = 0;
  const later = (ms, fn) => {
    const t = api.after(ms, () => (timers.delete(t), fn()));
    timers.add(t);
  };
  function notify(text, kind, from) {
    const n = Object.freeze({ id: `n${++seq}`, text: String(text ?? ""), kind: kind ?? "info", at: api.now(), from });
    renderToasts((notices = withNotice(notices, n)));
    later(NOTICE_MS, () => notices.includes(n) && renderToasts((notices = Object.freeze(notices.filter((x) => x !== n)))));
    return n.id;
  }

  function renderToasts(all) {
    const list = all.slice(-MAX_TOASTS);
    const ids = new Set(list.map((n) => n.id));
    for (const [id, el] of [...shown]) {
      if (ids.has(id)) continue;
      shown.delete(id);
      el.dataset.leaving = "";
      later(FADE_MS, () => el.remove());
    }
    for (const n of list) {
      if (shown.has(n.id)) continue;
      const el = document.createElement("div");
      el.className = "toast";
      el.dataset.kind = n.kind ?? "info";
      el.dataset.notice = n.id;
      el.textContent = n.text;
      el.title = n.text;
      shown.set(n.id, el);
      toasts.append(el);
    }
  }

  function hudItems(scene, local, view) {
    const out = loadSummary(scene.objects, local.status);
    for (const { id, value } of api.collect("hud")) {
      if (typeof value !== "function") continue;
      let items;
      try {
        items = value(scene, local, view);
      } catch (err) {
        console.warn(`[scene] extension “${id}”: hud failed`, err);
        continue;
      }
      for (const it of Array.isArray(items) ? items : [])
        if (it?.text)
          out.push({
            text: String(it.text),
            state: STATES.has(it.state) ? it.state : "loading",
            title: it.title,
            ext: id,
          });
    }
    return out;
  }

  function renderHud(scene, local, view) {
    const items = hudItems(scene, local, view);
    const key = JSON.stringify(items);
    if (key === hudKey) return;
    hudKey = key;
    hud.replaceChildren(
      ...items.map((it) => {
        const el = document.createElement("span");
        el.className = "pill";
        el.dataset.state = it.state;
        if (it.ext) el.dataset.ext = it.ext;
        if (it.title) el.title = String(it.title);
        el.textContent = it.text;
        return el;
      }),
    );
  }

  // an extension's lines changed: read every hud again, once, after what's calling now is done
  function changed() {
    if (redraw || !told) return;
    redraw = true;
    queueMicrotask(() => {
      redraw = false;
      if (told) renderHud(told.scene, told.local, told.view);
    });
  }

  return {
    // (`from`: another extension of the caller's stage it speaks for, as telling does)
    provides: {
      notices: ({ id, signal, runs }) =>
        Object.freeze({
          notify: (text, kind, o) => (signal.aborted ? null : notify(text, kind, o?.from != null && runs?.(o.from) ? o.from : id)),
          changed: () => void (signal.aborted || changed()),
        }),
    },
    /** what shows, oldest first: { id, text, kind, at, from } (for tests and probes) */
    get notices() {
      return notices;
    },
    update(scene, local, prev, view) {
      told = { scene, local, view };
      // a hover alone changes no pill
      if (prev?.scene !== scene || localChanged(prev?.local, local) || localChanged(prev?.view, view)) renderHud(scene, local, view);
    },
    dispose() {
      told = null;
      for (const cancel of timers) cancel();
      timers.clear();
    },
  };
}

export default { create };
