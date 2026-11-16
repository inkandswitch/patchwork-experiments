// The drawer: one panel at the stage's right with a tab for each docked
// element (TOOLS.md §6). An extension docks an element of its own with
// api.dock(el, { title, onClose }) and gets back close(); the element then
// sits in a pane of the drawer, under a tab with its title and a ×, until
// its caller closes it, the × does, or its extension stops. The × is a
// person closing it, so only the × calls onClose: the caller hears of the
// closes it didn't make itself. A pane is an embedded document (src/embed.js),
// so the keys typed in it are its own, never the scene's; unless it's docked
// with `embed: false` (the stage's own chrome: the inspector, the outline),
// whose keys are the stage's like any of its parts'.
//
// One pane shows at a time. Docking one shows it (unless it's docked with
// `show: false` beside a pane already shown: the inspector following the
// selection doesn't cover the parts bin the viewer is using); closing the
// one shown shows the one shown before it; the tabs stay in the order they
// were docked. With nothing docked, the drawer leaves the edge, which then
// takes no room.
//
// The drawer is as wide as the kind of pane it shows (TOOLS.md §6): the
// stage's own chrome (embed: false) a side panel's width, anything else a
// docked editor's room. A grip on its left edge sets the shown kind's width,
// the viewer's own (view prefs `drawer.chrome`, `drawer.editor`): drag it,
// arrow it, or double-click it to give that kind its default back. So the
// width is a function of the kind shown, that kind's pref and the stage's
// size, and nothing else: docking, closing, retitling or switching between
// panes of one kind never moves it, and a window resize never rewrites a
// pref (the CSS clamps what it shows, so the scene keeps its share).
//
// The model is pure and the DOM follows it: `docked`, `shown` and `undocked`
// below, the widths' `kindOf`, `widthFor`, `dragged` and `stepped`, and
// createDrawer, which keeps an element per docked key.

import { EMBED_ATTR } from "../embed.js";

/** No panes. `order` is the tabs' order (docking order); `recent` the same keys, the one shown first. */
export const EMPTY = Object.freeze({ order: Object.freeze([]), recent: Object.freeze([]) });

const state = (order, recent) => Object.freeze({ order: Object.freeze(order), recent: Object.freeze(recent) });

/** The pane shown, or null with none docked. Pure. */
export const shownOf = (s) => s.recent[0] ?? null;

/** Show `key`'s pane, if it's docked. Pure. */
export function shown(s, key) {
  if (!s.order.includes(key) || s.recent[0] === key) return s;
  return state(s.order, [key, ...s.recent.filter((k) => k !== key)]);
}

/** Dock `key` and show it; docking it again only shows it. Pure. */
export function docked(s, key) {
  if (s.order.includes(key)) return shown(s, key);
  return state([...s.order, key], [key, ...s.recent]);
}

/** Dock `key` behind what's shown (shown itself only when nothing else is); docking it again changes nothing. Pure. */
export function dockedBehind(s, key) {
  if (s.order.includes(key)) return s;
  return state([...s.order, key], [...s.recent, key]);
}

/** Undock `key`: the pane shown before it shows, if it was the one shown. Pure. */
export function undocked(s, key) {
  if (!s.order.includes(key)) return s;
  return state(
    s.order.filter((k) => k !== key),
    s.recent.filter((k) => k !== key),
  );
}

/** The two kinds of pane, each with a width of its own. */
export const KINDS = Object.freeze(["chrome", "editor"]);

/** A pane's kind: the stage's own chrome (docked with `embed: false`) or an editor. Pure. */
export const kindOf = (embed) => (embed === false ? "chrome" : "editor");

/** The narrowest and widest a viewer may set the drawer (px); the CSS narrows it further to keep the scene's share. */
export const MIN_PX = 220;
export const MAX_PX = 1200;

/** The pref key a kind's width is kept under. */
export const prefKey = (kind) => `drawer.${kind}`;

const clampPx = (px) => Math.min(MAX_PX, Math.max(MIN_PX, Math.round(px)));

/**
 * A kind's width as the viewer set it (px) in `prefs`, or null for its
 * default. A value that isn't a number in [MIN_PX, MAX_PX] is no setting at
 * all, not one to clamp: only the grip writes it, and the grip never writes
 * one. Pure.
 */
export function widthFor(prefs, kind) {
  const v = prefs?.[prefKey(kind)];
  return typeof v === "number" && Number.isFinite(v) && v >= MIN_PX && v <= MAX_PX ? v : null;
}

/** The width a drag gives: the drawer is at the right, so moving left widens it. Pure. */
export const dragged = (startPx, startX, x) => clampPx(startPx + (startX - x));

/** The width a key on the grip gives, or null for a key that isn't the grip's (it goes on). Pure. */
export function stepped(px, key, shift = false) {
  const step = shift ? 64 : 16;
  if (key === "ArrowLeft") return clampPx(px + step);
  if (key === "ArrowRight") return clampPx(px - step);
  if (key === "Home") return MIN_PX;
  if (key === "End") return MAX_PX;
  return null;
}

const make = (tag, cls, attrs = {}) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};

let paneIds = 0;

/**
 * The drawer's DOM, in `parent` (the stage's right edge) while anything is
 * docked. dock(owner, el, { title, onClose }) → close; closeOwner(owner)
 * closes everything an owner docked, without onClose (it is stopping).
 * `onChange({ tabs, shown })` hears every change of what's docked or shown
 * (the stage publishes it as local.drawer, so a surface showing whether a
 * tab is open, the toolbar's toggles, hears of it too).
 * The widths are the viewer's prefs: `prefs()` reads them and
 * `setPref(key, px)` stores one (undefined: back to the default); the stage
 * calls refreshWidth() when they change, here or in another tab.
 */
export function createDrawer({ parent, onChange = () => {}, prefs = () => ({}), setPref = () => {} }) {
  const drawer = make("aside", "stage-drawer", { "aria-label": "Drawer" });
  const grip = make("div", "stage-drawer-grip", {
    role: "separator",
    "aria-orientation": "vertical",
    "aria-label": "Drawer width",
    "aria-valuemin": String(MIN_PX),
    "aria-valuemax": String(MAX_PX),
    tabindex: "0",
    title: "Drag to resize; double-click for the default width",
  });
  const tabs = make("div", "stage-drawer-tabs", { role: "tablist" });
  const panes = make("div", "stage-drawer-panes");
  drawer.append(grip, tabs, panes);

  let model = EMPTY;
  /** content element → { owner, pane, tab, name, onClose, close } */
  const entries = new Map();

  function render() {
    const on = shownOf(model);
    for (const key of model.order) {
      const e = entries.get(key);
      const sel = key === on;
      e.tab.setAttribute("aria-selected", String(sel));
      e.name.tabIndex = sel ? 0 : -1;
      e.pane.hidden = !sel;
    }
    if (model.order.length && drawer.parentNode !== parent) parent.append(drawer);
    else if (!model.order.length && drawer.parentNode) drawer.remove();
    refreshWidth();
    const titles = model.order.map((k) => entries.get(k)?.name.textContent ?? "");
    onChange({ tabs: titles, shown: on ? (entries.get(on)?.name.textContent ?? null) : null });
  }

  /** The kind of the pane shown, or null with none. */
  const shownKind = () => {
    const on = shownOf(model);
    return on ? kindOf(entries.get(on)?.embed) : null;
  };

  const measured = () => (drawer.isConnected ? drawer.getBoundingClientRect().width : 0);
  /** The width the person sees (what a drag or a key starts from): measured, else the kind's own, else the least. */
  const current = (kind) => measured() || widthFor(prefs(), kind) || MIN_PX;

  /** Width: the shown kind's (its default by CSS, with no pref); the grip says what's shown. */
  function refreshWidth() {
    const kind = shownKind();
    if (kind) drawer.dataset.kind = kind;
    else delete drawer.dataset.kind;
    const px = kind ? widthFor(prefs(), kind) : null;
    if (px == null) drawer.style.removeProperty("--stage-drawer-width");
    else drawer.style.setProperty("--stage-drawer-width", `${px}px`);
    const now = Math.round(measured()) || px;
    if (now) grip.setAttribute("aria-valuenow", String(now));
    else grip.removeAttribute("aria-valuenow");
  }

  /** The grip's one write: a kind's width (undefined: its default again), then shown. */
  function store(kind, px) {
    setPref(prefKey(kind), px);
    refreshWidth();
  }

  // The grip's events are the drawer's: it isn't in the port, so the router
  // never sees its presses, and the keys it takes stop here.
  let drag = null; // { id, kind, startPx, startX, moved }
  grip.addEventListener("pointerdown", (e) => {
    const kind = shownKind();
    if (!kind || e.button !== 0) return;
    e.preventDefault();
    drag = { id: e.pointerId, kind, startPx: current(kind), startX: e.clientX, moved: false };
    try {
      grip.setPointerCapture?.(e.pointerId);
    } catch {
      // (a synthetic pointer has nothing to capture)
    }
  });
  // where the pointer is now: the width it gives, shown live, once it has moved at all
  const follow = (e) => {
    if (!drag.moved && e.clientX === drag.startX) return;
    drag.moved = true;
    drawer.style.setProperty("--stage-drawer-width", `${dragged(drag.startPx, drag.startX, e.clientX)}px`);
  };
  grip.addEventListener("pointermove", (e) => {
    if (drag && e.pointerId === drag.id) follow(e);
  });
  const endDrag = (e, keep) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (keep) follow(e);
    const d = drag;
    drag = null;
    // a press that didn't move (a click, half a double-click) stores nothing
    if (keep && d.moved) store(d.kind, dragged(d.startPx, d.startX, e.clientX));
    else refreshWidth();
  };
  grip.addEventListener("pointerup", (e) => endDrag(e, true));
  grip.addEventListener("pointercancel", (e) => endDrag(e, false));
  grip.addEventListener("dblclick", (e) => {
    const kind = shownKind();
    if (!kind) return;
    e.preventDefault();
    store(kind, undefined);
  });
  grip.addEventListener("keydown", (e) => {
    const kind = shownKind();
    const px = kind ? stepped(current(kind), e.key, e.shiftKey) : null;
    if (px == null) return;
    e.preventDefault();
    e.stopPropagation();
    store(kind, px);
  });
  // (and their keyups: the router never saw these keys go down)
  grip.addEventListener("keyup", (e) => {
    if (stepped(MIN_PX, e.key, e.shiftKey) != null) e.stopPropagation();
  });

  function remove(key) {
    const e = entries.get(key);
    if (!e) return null;
    entries.delete(key);
    model = undocked(model, key);
    e.tab.remove();
    e.pane.remove();
    render();
    return e;
  }

  function dock(owner, content, { title, onClose, embed = true, show = true } = {}) {
    const had = entries.get(content);
    if (had) {
      if (title != null) had.name.textContent = String(title);
      if (typeof onClose === "function") had.onClose = onClose;
      if (show) model = docked(model, content);
      render();
      return had.close;
    }
    const id = `stage-drawer-pane-${++paneIds}`;
    const pane = make("section", "stage-drawer-pane", { role: "tabpanel", id, ...(embed ? { [EMBED_ATTR]: "" } : {}) });
    const tab = make("div", "stage-drawer-tab", { role: "presentation" });
    const name = make("button", "stage-drawer-tab-name", { type: "button", role: "tab", "aria-controls": id });
    const label = String(title ?? "Panel");
    name.textContent = label;
    const x = make("button", "stage-drawer-tab-close", { type: "button", title: `Close ${label}`, "aria-label": `Close ${label}` });
    x.textContent = "×";
    tab.append(name, x);
    pane.setAttribute("aria-labelledby", (name.id = `${id}-tab`));
    pane.append(content);
    // (tabs and panes are only ever added at the end, so the DOM keeps the model's order)
    tabs.append(tab);
    panes.append(pane);
    const e = { owner, pane, tab, name, embed: !!embed, onClose: typeof onClose === "function" ? onClose : null, close: () => void remove(content) };
    name.addEventListener("click", () => {
      if (!entries.has(content)) return;
      model = shown(model, content);
      render();
    });
    x.addEventListener("click", () => {
      const gone = remove(content);
      try {
        gone?.onClose?.();
      } catch (err) {
        console.warn("[scene] a docked panel's onClose failed", err);
      }
    });
    entries.set(content, e);
    model = show ? docked(model, content) : dockedBehind(model, content);
    render();
    return e.close;
  }

  function closeOwner(owner) {
    for (const [key, e] of [...entries]) if (e.owner === owner) remove(key);
  }

  return {
    el: drawer,
    grip,
    dock,
    closeOwner,
    /** the stored widths changed (a pref, here or in another tab): show the shown kind's */
    refreshWidth,
    /** for tests: the docked elements in tab order, and the one shown */
    state: () => ({ order: [...model.order], shown: shownOf(model) }),
  };
}
