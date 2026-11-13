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
// The model is pure and the DOM follows it: `docked`, `shown` and `undocked`
// below, and createDrawer, which keeps an element per docked key.

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
 */
export function createDrawer({ parent, onChange = () => {} }) {
  const drawer = make("aside", "stage-drawer", { "aria-label": "Drawer" });
  const tabs = make("div", "stage-drawer-tabs", { role: "tablist" });
  const panes = make("div", "stage-drawer-panes");
  drawer.append(tabs, panes);

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
    // the stage's own chrome (the inspector, the outline) is as narrow as the side panel was; a docked editor gets room
    drawer.toggleAttribute("data-narrow", !!on && entries.get(on)?.embed === false);
    if (model.order.length && drawer.parentNode !== parent) parent.append(drawer);
    else if (!model.order.length && drawer.parentNode) drawer.remove();
    const titles = model.order.map((k) => entries.get(k)?.name.textContent ?? "");
    onChange({ tabs: titles, shown: on ? (entries.get(on)?.name.textContent ?? null) : null });
  }

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
    dock,
    closeOwner,
    /** for tests: the docked elements in tab order, and the one shown */
    state: () => ({ order: [...model.order], shown: shownOf(model) }),
  };
}
