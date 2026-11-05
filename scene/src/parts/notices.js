// scene.notices: what the scene has to say, over the view.
//   - toasts (bottom centre): local.notices, which api.notify() adds and the
//     stage expires; a notice that goes fades out (old tool.js toast).
//   - HUD pills (top left): the load summary from local.status ("Loading 40
//     of 74…", "Building 2…", "3 errors"; old tool.js renderHud ~1233-1250),
//     then every running extension's hud(scene, local) in running order.

import css from "./notices.css?inline";
import { localChanged } from "./toolbar-commands.js";

const FADE_MS = 250;
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

  function renderToasts(notices) {
    const list = Array.isArray(notices) ? notices.slice(-MAX_TOASTS) : [];
    const ids = new Set(list.map((n) => n.id));
    for (const [id, el] of [...shown]) {
      if (ids.has(id)) continue;
      shown.delete(id);
      el.dataset.leaving = "";
      const t = setTimeout(() => {
        timers.delete(t);
        el.remove();
      }, FADE_MS);
      timers.add(t);
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

  function hudItems(scene, local) {
    const out = loadSummary(scene.objects, local.status);
    for (const { id, value } of api.collect("hud")) {
      if (typeof value !== "function") continue;
      let items;
      try {
        items = value(scene, local);
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

  function renderHud(scene, local) {
    const items = hudItems(scene, local);
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

  return {
    update(scene, local, prev) {
      if (local.notices !== prev?.local?.notices) renderToasts(local.notices);
      // a hover alone changes no pill
      if (prev?.scene !== scene || localChanged(prev?.local, local)) renderHud(scene, local);
    },
    dispose() {
      for (const t of timers) clearTimeout(t);
      timers.clear();
    },
  };
}

export default { create };
