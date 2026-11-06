// scene.sidebar: the panel stack at the right (old tool.js "panels", ~2029-2089).
//
// It presents every running extension's `panels` ([{ id, title, pinned?, mount(el) }]):
// each a <section> with a title that folds it, in running order. Every panel
// starts open; folding is this viewer's alone (localStorage
// "scene-panels:<url>"). A `pinned` panel (the inspector's) never folds.
//
// mount(body, { head, section }) is called once per panel object; what it
// returns gets update(scene, local) every flush and dispose() when its
// extension stops (or hands out a different panel under the same id). A panel
// that has nothing to show hides itself by setting its body's `hidden`; the
// sidebar then hides the whole section, title and all, at once (it watches
// the attribute), not only on the next flush.
//
// "Panel" (P) shows and hides the whole sidebar, per viewer (the pref
// `scene.sidebar.hidden`, never the doc).

import css from "./sidebar.css?inline";

const HIDDEN = "scene.sidebar.hidden";

function readFolds(key) {
  const out = new Map();
  try {
    const saved = JSON.parse(globalThis.localStorage?.getItem(key) ?? "null");
    if (saved && typeof saved === "object") for (const [k, v] of Object.entries(saved)) if (typeof v === "boolean") out.set(k, v);
  } catch {
    // defaults only
  }
  return out;
}

function writeFolds(key, folds) {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(Object.fromEntries(folds)));
  } catch {
    // private window: this session only
  }
}

/** Is this panel folded: never if pinned; else the viewer's choice, else open. Pure. */
export function isFolded(id, folds, pinned = false) {
  return !pinned && folds.get(id) === true;
}

function create(api) {
  api.style(css);
  const foldKey = `scene-panels:${api.url ?? "scene"}`;
  const folds = readFolds(foldKey);
  const edge = api.edge("right");
  const aside = document.createElement("aside");
  aside.className = "sidebar";
  aside.setAttribute("aria-label", "Panels");
  edge.append(aside);

  /** panel id → { ext, panel, section, body, title, view } */
  const mounted = new Map();
  let lastOrder = "";
  let lastLayout = "";

  const hidden = () => !!api.pref(HIDDEN, false);

  function toggleFold(id) {
    const entry = mounted.get(id);
    if (!entry || entry.panel.pinned) return;
    folds.set(id, !entry.section.hasAttribute("data-folded"));
    writeFolds(foldKey, folds);
    layout(true);
  }

  function mount(ext, panel) {
    const section = document.createElement("section");
    section.className = "panel ext-panel";
    section.dataset.panel = panel.id;
    section.dataset.ext = ext;
    const head = document.createElement("div");
    head.className = "panel-head";
    const title = document.createElement("h3");
    title.className = "panel-title";
    title.textContent = String(panel.title ?? panel.id);
    if (!panel.pinned) {
      title.dataset.collapse = "";
      title.tabIndex = 0;
      title.setAttribute("role", "button");
      title.addEventListener("click", () => toggleFold(panel.id));
      title.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        e.stopPropagation();
        toggleFold(panel.id);
      });
    }
    head.append(title);
    const body = document.createElement("div");
    body.className = "panel-body";
    section.append(head, body);
    let view = null;
    try {
      view = panel.mount?.(body, { head, section }) ?? null;
    } catch (err) {
      console.warn(`[scene] panel “${panel.id}” (${ext}) failed to mount`, err);
    }
    // A body hidden or shown between flushes (a panel whose content arrives
    // on its own: the parts bin's registry) shows or hides its section then.
    const watch = typeof MutationObserver === "function" ? new MutationObserver(() => shown()) : null;
    watch?.observe(body, { attributes: true, attributeFilter: ["hidden"] });
    return { ext, panel, section, body, title, view, watch };
  }

  /** Each section shown as its body is; the sidebar only while one is. */
  function shown() {
    for (const entry of mounted.values()) {
      const off = !!entry.body.hidden;
      if (entry.section.hidden !== off) entry.section.hidden = off;
    }
    const any = [...mounted.values()].some((e) => !e.section.hidden);
    if (aside.hidden !== !any) aside.hidden = !any;
  }

  function unmount(entry) {
    entry.watch?.disconnect();
    try {
      entry.view?.dispose?.();
    } catch (err) {
      console.warn(`[scene] panel “${entry.panel.id}” (${entry.ext}) failed to dispose`, err);
    }
    entry.section.remove();
  }

  // Which panels there are: mount what's new, dispose what's gone.
  function reconcile() {
    const want = new Map();
    for (const { id: ext, value } of api.collect("panels")) {
      if (!Array.isArray(value)) continue;
      for (const p of value) if (p && p.id != null && !want.has(String(p.id))) want.set(String(p.id), { ext, panel: p });
    }
    for (const [id, entry] of [...mounted]) {
      const w = want.get(id);
      if (w && w.panel === entry.panel && w.ext === entry.ext) continue;
      unmount(entry);
      mounted.delete(id);
    }
    const fresh = [];
    for (const [id, { ext, panel }] of want) {
      if (mounted.has(id)) continue;
      mounted.set(id, mount(ext, panel));
      fresh.push(id);
    }
    return { ids: [...want.keys()], fresh };
  }

  // Order and folding, touched only when they change.
  function layout(force = false) {
    const order = [...mounted.keys()];
    const key = JSON.stringify([order, [...folds]]);
    if (!force && key === lastLayout) return;
    lastLayout = key;
    const orderKey = order.join("\u0000");
    if (orderKey !== lastOrder) {
      lastOrder = orderKey;
      aside.replaceChildren(...order.map((id) => mounted.get(id).section));
    }
    for (const id of order) {
      const { section, title, panel } = mounted.get(id);
      const fold = isFolded(id, folds, !!panel.pinned);
      section.toggleAttribute("data-folded", fold);
      if (title.dataset.collapse != null) title.setAttribute("aria-expanded", String(!fold));
    }
  }

  function refresh(scene, local) {
    for (const entry of mounted.values()) {
      try {
        entry.view?.update?.(scene, local);
      } catch (err) {
        console.warn(`[scene] panel “${entry.panel.id}” (${entry.ext}) failed to update`, err);
      }
    }
    shown();
  }

  return {
    update(scene, local) {
      const isHidden = hidden();
      if (edge.hidden !== isHidden) edge.hidden = isHidden;
      reconcile();
      layout();
      // a hidden sidebar's panels wait until it's shown again
      if (isHidden) return;
      refresh(scene, local);
    },
    commands: [
      {
        id: "panel",
        name: "Panel",
        key: "p",
        state: (target) => (target == null ? { checked: !hidden(), title: "Show or hide the side panel" } : null),
        run: () => api.setPref(HIDDEN, !hidden()),
      },
    ],
    dispose() {
      for (const entry of mounted.values()) unmount(entry);
      mounted.clear();
    },
  };
}

export default { create };
