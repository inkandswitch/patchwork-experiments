// scene.toolbar: the bar of tools (EDITOR.md, "The interface"), a row along the top
// presenting the scene commands (the null target) of every running
// extension on the focus path, in two clusters: the editor's, at the left,
// made while the Edit hand is held (show includes "toolbar", or says nothing), and the world's,
// at the right, in every body (show includes "world": a game's Play, a
// table's Lift all cups, a boat's Come aboard), so a world command sits at the
// same place looking, walking, seated or editing. Each is a button, a
// toggle (aria-pressed from `checked`) or a picker (`choices`/`value`), in
// running order then command order. It owns no verbs of its own: frame,
// measure, grid, units… are each part's command.
//
// The editor's cluster is in groups (PLANS.md §5), by a command's `group`:
// history (undo, redo), tools (Select, Move…), the rest (a package's, X-ray),
// panels (the drawer's tabs), view (frame, grid, axes, bounds) and settings,
// which sit behind one gear, in a popover (units, snap); within a group, a
// command's `order` (default 0) comes first, then running order. A command with an
// `icon` (../shared/icons.js) is drawn as it, its name its label and tooltip. The
// panels group (the drawer's tabs) isn't the bar's: the drawer's rail shows
// it (../native/drawer.js).
//
// Each flush it works out every control's state; the DOM is touched only for
// controls whose state changed, so a picker keeps its focus and a hover costs
// nothing.
//
// Across linked docs it holds the scene commands of the stages on the focus
// path, the focus first, out to the outermost (EDITOR.md, "The interface": entered in a
// game aboard, the game's and the boat's), each worked out in its own
// stage's context and run there. It doesn't follow the pointer, so it
// doesn't change under it.
//
// It shows while some extension on the focus path has a command that is
// the bar's in this body, whether or not that applies just now (barEntries'
// `shown`): its height depends on which extensions run, never on a
// command's state, so the canvas under it doesn't jump as Play or Lift all
// comes and goes. With none (a plain scene, looking) there is no bar. The
// editor's cluster scrolls sideways when the view is too narrow for it; the
// world's sits outside that scroll, always in view at the right end.
//
// A button doesn't take the focus from a mouse press: the focus stays where
// it was (the tool's root, where the keys are heard), so the next Space or
// Enter that no key claims goes on to the stage and doesn't run the button
// again (the router lets an unclaimed key through), whatever the body. From
// the keyboard (Tab, then Space) a button is focused as any button is.

import css from "./toolbar.css?inline";
import { barEntries, cleanChoices, controlKey, controlKind, tooltip } from "./toolbar-commands.js";
import { localChanged } from "../shared/shallow.js";
import { hintFor, shortcutHintFor } from "./keymap.js";
import { onMac } from "./shortcuts.js";
import { resolverState } from "./resolver.js";
import { ICONS } from "../shared/icons.js";
import { whileEditing } from "./editing.js";

/** The editor's groups, in the order they sit (a command without a group is "other"). */
export const GROUPS = Object.freeze(["history", "tools", "other", "panels", "view", "settings"]);
export const groupOf = (command) => (GROUPS.includes(command?.group) ? command.group : "other");

function create(api) {
  api.style(css);
  const edge = api.overlay("top");
  const bar = document.createElement("div");
  bar.className = "toolbar";
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", "Scene");
  const row = document.createElement("div");
  row.className = "cluster tools";
  // (the world's cluster, right-aligned: the same place in every body)
  const world = document.createElement("div");
  world.className = "cluster world";
  bar.append(row, world);
  edge.append(bar);

  // each group's element in the editor's cluster; settings is a gear and its popover
  const groupEls = new Map(GROUPS.map((g) => {
    const el = document.createElement("div");
    el.className = "bar-group";
    el.dataset.group = g;
    return [g, el];
  }));
  const gear = document.createElement("button");
  gear.type = "button";
  gear.className = "button icon-button settings-toggle";
  gear.innerHTML = ICONS.settings;
  gear.setAttribute("aria-label", "Settings");
  gear.setAttribute("aria-expanded", "false");
  gear.title = "Settings: units, snap";
  gear.addEventListener("mousedown", (e) => e.preventDefault());
  const pop = document.createElement("div");
  pop.className = "settings-popover";
  pop.hidden = true;
  const settings = groupEls.get("settings");
  settings.append(gear, pop);
  let releasePop = null;
  function shut() {
    if (pop.hidden) return;
    pop.hidden = true;
    gear.setAttribute("aria-expanded", "false");
    const r = releasePop;
    releasePop = null;
    r?.();
  }
  gear.addEventListener("click", () => {
    if (!pop.hidden) return shut();
    pop.hidden = false;
    gear.setAttribute("aria-expanded", "true");
    // a popover (STAGE.md, "Hands"): Escape closes it, and the canvas is its while it's open
    releasePop = api.popover?.(shut) ?? null;
  });
  // the editor's cluster is chrome: there (and its popover's outside click heard) while the Edit hand is held
  const cluster = whileEditing(api, () => {
    const off = api.listen(document, "pointerdown", (e) => {
      if (!pop.hidden && !settings.contains(e.target)) shut();
    }, true);
    return () => {
      off();
      shut();
    };
  });
  // (settings outside the row's sideways scroll, which would clip its popover)
  row.append(...[...groupEls.values()].filter((g) => g !== settings));
  bar.insertBefore(settings, world);

  /** control key ("stage\0ext\0command") → { el, sig, kind, choices } */
  const controls = new Map();
  /** each cluster's running order, as keys (to touch its children only when it changes) */
  const orders = new Map([
    [row, ""],
    [world, ""],
  ]);

  const keyOf = (ext, id, stage) => `${stage ?? ""}\u0000${ext}\u0000${id}`;

  function build(item) {
    const { ext, command, state, stage } = item;
    // (run in the stage it's from)
    const invoke = (value) => api.run({ ...(stage !== undefined ? { stage } : {}), ext, command: command.id, target: null, value });
    const mine = () => controls.get(keyOf(ext, command.id, stage));
    const kind = controlKind(state);
    let el;
    if (kind === "choices") {
      el = document.createElement("select");
      el.className = "picker";
      el.addEventListener("change", () => {
        const choice = mine()?.choices?.[el.selectedIndex];
        if (choice) invoke(choice.value);
      });
    } else {
      el = document.createElement("button");
      el.type = "button";
      el.className = ICONS[command.icon] ? "button icon-button" : "button";
      if (ICONS[command.icon]) el.innerHTML = ICONS[command.icon];
      // (a mouse press doesn't move the focus: see the header)
      el.addEventListener("mousedown", (e) => e.preventDefault());
      el.addEventListener("click", () => {
        const c = mine();
        if (c?.kind === "toggle") invoke(!c.checked);
        else invoke();
      });
    }
    el.dataset.ext = ext;
    el.dataset.command = command.id;
    return { el, kind, sig: null, choices: null, checked: false };
  }

  function paint(c, item, sig) {
    const { command, state } = item;
    const el = c.el;
    c.sig = sig;
    c.checked = !!state.checked;
    const title = tooltip(command, state, item.key);
    if (el.title !== title) el.title = title;
    el.disabled = !!state.disabled;
    if (c.kind === "choices") {
      const choices = cleanChoices(state.choices);
      c.choices = choices;
      el.setAttribute("aria-label", String(command.name ?? command.id));
      const opts = choices.map((ch, i) => {
        const o = el.options[i] ?? document.createElement("option");
        o.value = String(i);
        o.textContent = ch.label;
        return o;
      });
      if (el.options.length !== opts.length || opts.some((o, i) => el.options[i] !== o)) el.replaceChildren(...opts);
      const at = choices.findIndex((ch) => ch.value === state.value || (ch.value != null && state.value != null && String(ch.value) === String(state.value)));
      el.selectedIndex = at;
    } else {
      const label = String(state.label ?? command.name ?? command.id);
      // an icon's label is its accessible name and tooltip; anything else shows it
      if (ICONS[command.icon]) el.setAttribute("aria-label", label);
      else if (el.textContent !== label) el.textContent = label;
      if (c.kind === "toggle") el.setAttribute("aria-pressed", String(!!state.checked));
      else el.removeAttribute("aria-pressed");
    }
  }

  /** A setting in the popover: its control with its name beside it (a toggle's name is its own label). */
  const wrappers = new WeakMap();
  function labelled(el, item) {
    let w = wrappers.get(el);
    if (!w) {
      w = document.createElement("label");
      w.className = "setting";
      const name = document.createElement("span");
      name.className = "setting-name";
      w.append(name, el);
      wrappers.set(el, w);
    }
    const kind = controlKind(item.state);
    const name = kind === "choices" ? String(item.command.name ?? item.command.id) : "";
    if (w.firstChild.textContent !== name) w.firstChild.textContent = name;
    return w;
  }

  function render(scene, view) {
    const keys = resolverState(api);
    // the focus path's stages, each its own commands in its own context (each key is the resolver's: shown only where pressing it does this)
    const segs = api.path({ focus: true }).map((seg) => ({ stage: seg.stage, collected: seg.collect("commands"), ctx: seg.context(null) }));
    const entries = barEntries(segs, view, !!cluster());
    const seen = new Set();
    const place = (el, items, wrap = null) => {
      const ks = [];
      const els = [];
      for (const it of items) {
        // its key, else its ⌘ shortcut, each shown only where pressing it does this (the resolver's: H3)
        const verb = { ext: it.ext, command: it.command, target: null, stage: it.stage };
        const item = { ...it, key: hintFor(verb, keys) || shortcutHintFor(verb, keys, onMac()) };
        const k = keyOf(item.ext, item.command.id, item.stage);
        seen.add(k);
        const kind = controlKind(item.state);
        let c = controls.get(k);
        // a control that changes kind (button ↔ picker) is made again
        if (c && (c.kind === "choices") !== (kind === "choices")) c = null;
        if (!c) controls.set(k, (c = build(item)));
        c.kind = kind;
        const sig = controlKey(item);
        if (c.sig !== sig) paint(c, item, sig);
        ks.push(k);
        els.push(wrap ? wrap(c.el, item) : c.el);
      }
      const next = ks.join("\u0001");
      if (next !== orders.get(el)) {
        orders.set(el, next);
        el.replaceChildren(...els);
      }
    };
    for (const g of GROUPS) {
      // (the panels are the drawer's rail's)
      if (g === "panels") {
        groupEls.get(g).hidden = true;
        continue;
      }
      // in a group: by `order` (default 0), then running order and command order
      const items = entries.editor.filter((it) => groupOf(it.command) === g).sort((a, b) => (Number(a.command.order) || 0) - (Number(b.command.order) || 0));
      if (g === "settings") {
        // each setting labelled, in the popover
        place(pop, items, (el, item) => labelled(el, item));
        settings.hidden = !items.length;
      } else {
        place(groupEls.get(g), items);
        groupEls.get(g).hidden = !items.length;
      }
    }
    place(world, entries.world);
    for (const k of [...controls.keys()]) if (!seen.has(k)) controls.delete(k);
    edge.hidden = !entries.shown;
  }

  return {
    update(scene, local, prev, view) {
      if (prev?.scene === scene && !localChanged(prev?.local, local) && !localChanged(prev?.view, view)) return;
      render(scene, view);
    },
  };
}

export default { create };
