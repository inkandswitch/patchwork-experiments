// scene.toolbar: the bar of tools (STAGE.md, "The interface"), a row along the top
// presenting the scene commands (the null target) of every running
// extension on the focus path, in two clusters: the editor's, at the left,
// only in Edit (show includes "toolbar", or says nothing), and the world's,
// at the right, in every body (show includes "world": a game's Play, a
// table's Lift all cups, a boat's Come aboard), so a world command sits at the
// same place looking, walking, seated or editing. Each is a button, a
// toggle (aria-pressed from `checked`) or a picker (`choices`/`value`), in
// running order then command order. It owns no verbs of its own; what used
// to be hard-wired here (frame, measure, grid, units…) is each part's
// command now.
//
// Each flush it works out every control's state; the DOM is touched only for
// controls whose state changed, so a picker keeps its focus and a hover costs
// nothing.
//
// Across linked docs it holds the scene commands of the stages on the focus
// path, the focus first, out to the outermost (STAGE.md, "The interface": entered in a
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
import { barEntries, cleanChoices, controlKey, controlKind, localChanged, tooltip } from "./toolbar-commands.js";
import { hintFor, segmentsOf } from "../keymap.js";
import { resolverState } from "./resolver.js";

function create(api) {
  api.style(css);
  const edge = api.edge("top");
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
      el.className = "button";
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
      if (el.textContent !== label) el.textContent = label;
      if (c.kind === "toggle") el.setAttribute("aria-pressed", String(!!state.checked));
      else el.removeAttribute("aria-pressed");
    }
  }

  function render(scene, view) {
    const keys = resolverState(api);
    // the focus path's stages, each its own commands in its own context (each key is the resolver's: shown only where pressing it does this)
    const path = typeof api.path === "function" ? api.path({ focus: true }) : [];
    const segs = path.length ? path.map((seg) => ({ stage: seg.stage, collected: seg.collect("commands"), ctx: seg.context(null) })) : segmentsOf(keys);
    const entries = barEntries(segs, view);
    const seen = new Set();
    const place = (el, items) => {
      const ks = [];
      const els = [];
      for (const it of items) {
        const item = { ...it, key: hintFor({ ext: it.ext, command: it.command, target: null, stage: it.stage }, keys) };
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
        els.push(c.el);
      }
      const next = ks.join("\u0001");
      if (next !== orders.get(el)) {
        orders.set(el, next);
        el.replaceChildren(...els);
      }
    };
    place(row, entries.editor);
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
