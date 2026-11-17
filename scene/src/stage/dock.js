// The drawer: one panel at the stage's right with a tab for each docked
// element (STAGE.md, "The interface"). An extension docks an element of its own with
// api.dock(el, { title, onClose }) and gets back close(); the element then
// sits in a pane of the drawer, under a tab with its title and a ×, until
// its caller closes it, the × does, or its extension stops. The × is a
// person closing it, so only the × calls onClose: the caller hears of the
// closes it didn't make itself. A pane is an embedded document (src/embed.js),
// so the keys typed in it are its own, never the scene's; unless it's docked
// with `embed: false` (the stage's own chrome: the inspector, the parts bin),
// whose keys are the stage's like any of its parts'.
//
// One pane shows at a time. Docking one shows it (unless it's docked with
// `show: false` beside a pane already shown: the inspector following the
// selection doesn't cover the parts bin the viewer is using); closing the
// one shown shows the one shown before it; the tabs stay in the order they
// were docked. With nothing docked, the drawer leaves the edge, which then
// takes no room.
//
// The drawer is as wide as the kind of pane it shows (STAGE.md, "The interface"): the
// stage's own chrome (embed: false) a side panel's width, anything else a
// docked editor's room. A grip on its left edge sets the shown kind's width,
// the viewer's own (view prefs `drawer.chrome`, `drawer.editor`): drag it,
// arrow it, or double-click it to give that kind its default back. So the
// width is a function of the kind shown, that kind's pref and the stage's
// size, and nothing else: docking, closing, retitling or switching between
// panes of one kind never moves it, and a window resize never rewrites a
// pref (the CSS clamps what it shows, so the scene keeps its share).
//
// A document can be docked as well as an element (STAGE.md, "The interface", "Documents
// in the drawer"): dockDocument({ url, toolId, title }) docks the host's view
// of it (embed.js documentView, in a documentBox) in a pane of the editor kind, keyed by
// docKey(url, toolId), so docking one key again only shows (keeping its title)
// its tab, and there is at most one pane per key. These panes are the view's
// (api.view.dock), not an extension's: no extension stopping closes them,
// only their ×, their close(), or the view going. The tab strip takes a drop
// of any Patchwork document (dnd.js: a sidebar's, an outline row's, an
// inspector section's header) and docks each one; a drag over the strip is
// the strip's, so nothing dropped there reaches the scene.
//
// The model is pure and the DOM follows it: `docked`, `shown` and `undocked`
// below, the widths' `kindOf`, `widthFor`, `dragged` and `stepped`, and
// createDrawer, which keeps an element per docked key.

import { EMBED_ATTR, documentBox, documentView } from "../embed.js";
import { docKey, hasPatchworkDrop, parseAutomergeUrl, parsePatchworkDrop } from "../dnd.js";

/** The owner of the documents docked in the drawer: the view's, so no extension's closeOwner reaches them. */
const DOCS = Symbol("the view's documents");

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
 * closes everything an owner docked, without onClose (it is stopping);
 * dockDocument({ url, toolId, title }) → close docks a document, the view's.
 * `onChange({ tabs, shown, docs })` hears every change of what's docked or
 * shown (the stage publishes it as view.drawer, so a surface showing whether
 * a tab is open, the toolbar's toggles, or whether a document is docked, an
 * inspector section, hears of it too): `docs` is the docked documents' keys,
 * in docking order.
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
  /** The grip's drag under way: { id, kind, startPx, startX, moved, px } */
  let drag = null;
  /** The keys the grip took that are still down (their codes) */
  const mine = new Set();
  /** content element → { owner, pane, tab, name, embed, doc, onClose, close } (`doc`: a document's key, else null) */
  const entries = new Map();
  /** The content element docked for a document's key, or null */
  const paneOf = (key) => {
    for (const [content, e] of entries) if (e.doc === key) return content;
    return null;
  };

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
    // a drag outlives neither its drawer nor its kind being shown (its pointerup lands elsewhere),
    // and a key the grip took doesn't outlive its drawer (a removed grip may lose focus without a blur)
    if (drag && shownKind() !== drag.kind) drag = null;
    if (!drawer.isConnected) mine.clear();
    refreshWidth();
    const titles = model.order.map((k) => entries.get(k)?.name.textContent ?? "");
    const docKeys = model.order.map((k) => entries.get(k)?.doc).filter((k) => k != null);
    onChange({ tabs: titles, shown: on ? (entries.get(on)?.name.textContent ?? null) : null, docs: docKeys });
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
    // a drag under way shows where it is; else the kind's pref
    const px = !kind ? null : drag?.moved ? drag.px : widthFor(prefs(), kind);
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
  grip.addEventListener("pointerdown", (e) => {
    const kind = shownKind();
    if (!kind || e.button !== 0) return;
    e.preventDefault();
    drag = { id: e.pointerId, kind, startPx: current(kind), startX: e.clientX, moved: false, px: null };
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
    drag.px = dragged(drag.startPx, drag.startX, e.clientX);
    refreshWidth();
  };
  const endDrag = (e, keep) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (keep) follow(e);
    const d = drag;
    drag = null;
    // a press that didn't move (a click, half a double-click) stores nothing
    if (keep && d.moved) store(d.kind, d.px);
    else refreshWidth();
  };
  // a move with the button up is no drag's (its pointerup went elsewhere): that drag is over
  grip.addEventListener("pointermove", (e) => {
    if (drag && e.pointerId === drag.id) (e.buttons & 1 ? follow(e) : endDrag(e, false));
  });
  grip.addEventListener("pointerup", (e) => endDrag(e, true));
  grip.addEventListener("pointercancel", (e) => endDrag(e, false));
  grip.addEventListener("lostpointercapture", (e) => endDrag(e, false));
  grip.addEventListener("dblclick", (e) => {
    const kind = shownKind();
    if (!kind) return;
    e.preventDefault();
    store(kind, undefined);
  });
  // A key the grip takes is the grip's from its keydown to its keyup (or the
  // grip's losing focus, or its drawer going); an auto-repeat of a key that
  // went down elsewhere (held at the stage, then focus came here) is not, and
  // neither is its keyup: both go on to whoever holds it, so a held key is
  // always let go.
  grip.addEventListener("keydown", (e) => {
    const code = e.code || e.key;
    if (e.repeat && !mine.has(code)) return;
    const kind = shownKind();
    const px = kind ? stepped(current(kind), e.key, e.shiftKey) : null;
    if (px == null) return;
    e.preventDefault();
    e.stopPropagation();
    mine.add(code);
    store(kind, px);
  });
  grip.addEventListener("keyup", (e) => {
    if (mine.delete(e.code || e.key)) e.stopPropagation();
  });
  grip.addEventListener("blur", () => mine.clear());

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

  function dock(owner, content, { title, onClose, embed = true, show = true, doc = null } = {}) {
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
    const e = { owner, pane, tab, name, embed: !!embed, doc, onClose: typeof onClose === "function" ? onClose : null, close: () => void remove(content) };
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

  /**
   * Dock a document (the view's: STAGE.md, "The interface"): its view in an editor pane,
   * one per docKey(url, toolId); docking a key that's docked shows its tab,
   * under the title it was first docked with. → close. A url that isn't a document's docks
   * nothing (a version's heads are dropped: a pane follows the latest).
   */
  function dockDocument({ url, toolId = null, title } = {}) {
    const u = parseAutomergeUrl(url);
    if (!u) return () => {};
    const tool = typeof toolId === "string" && toolId ? toolId : null;
    const key = docKey(u, tool);
    // docked already: shown, under the title it was docked with
    const had = paneOf(key);
    if (had) return dock(DOCS, had, { doc: key });
    const content = documentBox("stage-drawer-doc");
    content.append(documentView({ url: u, toolId: tool, label: title }));
    return dock(DOCS, content, { title: title || "Document", embed: true, doc: key });
  }

  // The tab strip takes documents: any drag over it is its own (none reaches the scene's drop, or anything
  // else in the stage), and one that carries a Patchwork document may drop here, docking each.
  const dropping = (on) => tabs.classList.toggle("drop-over", on);
  const over = (e) => {
    e.stopPropagation();
    if (!hasPatchworkDrop(e.dataTransfer)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    dropping(true);
  };
  tabs.addEventListener("dragenter", over);
  tabs.addEventListener("dragover", over);
  tabs.addEventListener("dragleave", (e) => {
    e.stopPropagation();
    if (!(e.relatedTarget instanceof Node) || !tabs.contains(e.relatedTarget)) dropping(false);
  });
  tabs.addEventListener("drop", (e) => {
    e.stopPropagation();
    e.preventDefault();
    dropping(false);
    for (const item of parsePatchworkDrop(e.dataTransfer)) dockDocument({ url: item.url, toolId: item.toolId, title: item.name });
  });

  /** Close everything (the view is going): no onClose, nothing left docked. */
  function dispose() {
    for (const key of [...entries.keys()]) remove(key);
  }

  return {
    el: drawer,
    grip,
    dock,
    dockDocument,
    closeOwner,
    dispose,
    /** the stored widths changed (a pref, here or in another tab): show the shown kind's */
    refreshWidth,
    /** for tests: the docked elements in tab order, and the one shown */
    state: () => ({ order: [...model.order], shown: shownOf(model) }),
  };
}
