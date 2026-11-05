// scene.sidebar: the panel stack at the right (old tool.js "panels", ~2029-2089).
//
// It presents every running extension's `panels` ([{ id, title, pinned?, mount(el) }]):
// each a <section> with a title that folds it. The order is doc.view.panels
// first (old docs: the panels that start open, in that order), then running
// order. A panel the doc lists nowhere starts folded when the doc lists any;
// after that, folding is this viewer's alone (localStorage
// "scene-panels:<url>"). A `pinned` panel (the inspector's) never folds.
//
// mount(body, { head, section }) is called once per panel object; what it
// returns gets update(scene, local) every flush and dispose() when its
// extension stops (or hands out a different panel under the same id). A panel
// that has nothing to show hides itself by setting its body's `hidden`; the
// sidebar then hides the whole section, title and all.
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

/**
 * The panel order: the doc's list first (ids that are there), then the rest
 * in the order given. Pure.
 * @param {string[]} ids  in running order
 * @param {string[] | null} listed  doc.view.panels
 */
export function panelOrder(ids, listed) {
  if (!Array.isArray(listed)) return [...ids];
  const l = listed.filter((x) => typeof x === "string");
  return [...l.filter((id) => ids.includes(id)), ...ids.filter((id) => !l.includes(id))];
}

/** Is this panel folded: never if pinned; else the viewer's choice, else folded when the doc lists others but not it. Pure. */
export function isFolded(id, folds, listed, pinned = false) {
  if (pinned) return false;
  if (folds.has(id)) return folds.get(id);
  return Array.isArray(listed) && !listed.includes(id);
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
    layout(api.doc().view?.panels ?? null, true);
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
    return { ext, panel, section, body, title, view };
  }

  function unmount(entry) {
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
  function layout(listed, force = false) {
    const ids = [...mounted.keys()];
    const order = panelOrder(ids, listed);
    const key = JSON.stringify([order, Array.isArray(listed) ? listed : null, [...folds]]);
    if (!force && key === lastLayout) return;
    lastLayout = key;
    const orderKey = order.join("\u0000");
    if (orderKey !== lastOrder) {
      lastOrder = orderKey;
      aside.replaceChildren(...order.map((id) => mounted.get(id).section));
    }
    for (const id of order) {
      const { section, title, panel } = mounted.get(id);
      const fold = isFolded(id, folds, listed, !!panel.pinned);
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
      const off = !!entry.body.hidden;
      if (entry.section.hidden !== off) entry.section.hidden = off;
    }
    const any = [...mounted.values()].some((e) => !e.section.hidden);
    if (aside.hidden !== !any) aside.hidden = !any;
  }

  return {
    update(scene, local) {
      const isHidden = hidden();
      if (edge.hidden !== isHidden) edge.hidden = isHidden;
      reconcile();
      layout(scene?.d?.view?.panels ?? null);
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
