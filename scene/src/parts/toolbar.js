// scene.toolbar: a row along the top presenting every running extension's
// commands for the scene (the null target) that are meant for a toolbar (show
// includes "toolbar", or says nothing): a button, a toggle (aria-pressed from
// `checked`) or a picker (`choices`/`value`), in running order then command
// order. It owns no verbs of its own; what used to be hard-wired here (frame,
// measure, grid, units, the gizmo…) is each part's command now.
//
// Each flush it works out every control's state; the DOM is touched only for
// controls whose state changed, so a picker keeps its focus and a hover costs
// nothing.

import css from "./toolbar.css?inline";
import { applicable, cleanChoices, controlKey, controlKind, flatCommands, localChanged, tooltip } from "./toolbar-commands.js";

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

  /** control key ("ext\0command") → { el, sig, kind, choices } */
  const controls = new Map();
  let order = "";

  const keyOf = (ext, id) => `${ext}\u0000${id}`;
  const invoke = (ext, command, value) => api.run({ ext, command, target: null, value });

  function build(item) {
    const { ext, command, state } = item;
    const kind = controlKind(state);
    let el;
    if (kind === "choices") {
      el = document.createElement("select");
      el.className = "picker";
      el.addEventListener("change", () => {
        const c = controls.get(keyOf(ext, command.id));
        const choice = c?.choices?.[el.selectedIndex];
        if (choice) invoke(ext, command.id, choice.value);
      });
    } else {
      el = document.createElement("button");
      el.type = "button";
      el.className = "button";
      el.addEventListener("click", () => {
        const c = controls.get(keyOf(ext, command.id));
        if (c?.kind === "toggle") invoke(ext, command.id, !c.checked);
        else invoke(ext, command.id);
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
    const title = tooltip(command, state);
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

  function render(scene, local) {
    const items = applicable(flatCommands(api.collect("commands")), null, { scene, local }, "toolbar");
    const seen = new Set();
    const els = [];
    for (const item of items) {
      const k = keyOf(item.ext, item.command.id);
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
    edge.hidden = els.length === 0;
  }

  return {
    update(scene, local, prev) {
      if (prev?.scene === scene && !localChanged(prev?.local, local)) return;
      render(scene, local);
    },
  };
}

export default { create };
