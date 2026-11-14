// scene.toolbar: a row along the top presenting every running extension's
// commands for the scene (the null target) that are meant for a toolbar (show
// includes "toolbar", or says nothing): a button, a toggle (aria-pressed from
// `checked`) or a picker (`choices`/`value`), in running order then command
// order. It owns no verbs of its own; what used to be hard-wired here (frame,
// measure, grid, units…) is each part's command now.
//
// Each flush it works out every control's state; the DOM is touched only for
// controls whose state changed, so a picker keeps its focus and a hover costs
// nothing.
//
// Across linked docs it holds the scene commands of the stages on the focus
// path, the focus first, out to the outermost (TOOLS.md §6: entered in a
// game aboard, the game's and the boat's), each worked out in its own
// stage's context and run there. It doesn't follow the pointer, so it
// doesn't change under it.
//
// The toolbar is the editor's (../stage/bodies.js): it shows only in the Edit
// body. Elsewhere (looking, walking, seated) there is no bar: a package's
// command meant for it (arena's Play, the cups' Lift all) is still in the
// menu and on its key.

import css from "./toolbar.css?inline";
import { applicable, cleanChoices, controlKey, controlKind, flatCommands, localChanged, tooltip } from "./toolbar-commands.js";
import { hintFor, segmentsOf } from "../keymap.js";
import { resolverState } from "./resolver.js";
import { editing } from "../stage/bodies.js";

/** Does the toolbar show? Only in Edit, with something on it. Pure. */
export const toolbarShown = (view, count) => editing(view) && count > 0;

function create(api) {
  api.style(css);
  const edge = api.edge("top");
  const bar = document.createElement("div");
  bar.className = "toolbar";
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", "Scene");
  const row = document.createElement("div");
  row.className = "cluster tools";
  bar.append(row);
  edge.append(bar);

  /** control key ("stage\0ext\0command") → { el, sig, kind, choices } */
  const controls = new Map();
  let order = "";

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
    const items = editing(view) ? segs.flatMap((seg) => applicable(flatCommands(seg.collected), null, seg.ctx, "toolbar").map((it) => ({ ...it, stage: seg.stage, key: hintFor({ ext: it.ext, command: it.command, target: null, stage: seg.stage }, keys) }))) : [];
    const seen = new Set();
    const els = [];
    for (const item of items) {
      const k = keyOf(item.ext, item.command.id, item.stage);
      if (seen.has(k)) continue;
      seen.add(k);
      const kind = controlKind(item.state);
      let c = controls.get(k);
      // a control that changes kind (button ↔ picker) is made again
      if (c && (c.kind === "choices") !== (kind === "choices")) c = null;
      if (!c) controls.set(k, (c = build(item)));
      c.kind = kind;
      const sig = controlKey(item);
      if (c.sig !== sig) paint(c, item, sig);
      els.push(c.el);
    }
    for (const k of [...controls.keys()]) if (!seen.has(k)) controls.delete(k);
    const nextOrder = [...seen].join("\u0001");
    if (nextOrder !== order) {
      order = nextOrder;
      row.replaceChildren(...els);
    }
    edge.hidden = !toolbarShown(view, els.length);
  }

  return {
    update(scene, local, prev, view) {
      if (prev?.scene === scene && !localChanged(prev?.local, local) && !localChanged(prev?.view, view)) return;
      render(scene, view);
    },
  };
}

export default { create };
