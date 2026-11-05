// scene.kits (always on): which kits this viewer has, from a small button at
// the bottom left of the view. It lists every registered kit (scene:kit) with
// a checkbox. This viewer's kits are chosenKits(local.kits, doc): the doc's
// suggestion plus what they turned on, minus what they turned off (STAGE.md,
// "Kits"); a toggle writes that delta to local.kits, so a later change to the
// suggestion still reaches them. "Suggest for everyone" writes this viewer's
// list to doc.view.kits (and clears their delta, which it now matches).

import css from "./kits.css?inline";
import { chosenKits, suggestedKits } from "../kits.js";

const strings = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);

/**
 * local.kits after turning one kit on or off: the smallest delta against the
 * doc's suggestion. Pure.
 * @param {{ on?: string[], off?: string[] } | null} mine  local.kits
 * @param {object} doc
 * @param {string} kit
 * @param {boolean} want
 * @returns {{ on: string[], off: string[] }}
 */
export function toggleKit(mine, doc, kit, want) {
  const suggested = suggestedKits(doc);
  let on = strings(mine?.on).filter((k) => k !== kit);
  let off = strings(mine?.off).filter((k) => k !== kit);
  if (want && !suggested.includes(kit)) on = [...on, kit];
  if (!want && suggested.includes(kit)) off = [...off, kit];
  // anything the suggestion already says needs no delta
  on = on.filter((k) => !suggested.includes(k));
  off = off.filter((k) => suggested.includes(k));
  return Object.freeze({ on: Object.freeze(on), off: Object.freeze(off) });
}

const listOf = (reg) => {
  try {
    return (reg?.filter?.(() => true) ?? []).filter((k) => k && typeof k.id === "string");
  } catch {
    return [];
  }
};

function create(api) {
  api.style(css);
  const overlay = api.overlay();
  overlay.classList.add("kits-layer");
  const wrap = document.createElement("div");
  wrap.className = "kits";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "button kits-button";
  button.textContent = "Kits";
  button.title = "Kits: which sets of tools you have in this scene";
  button.setAttribute("aria-haspopup", "true");
  button.setAttribute("aria-expanded", "false");
  const pop = document.createElement("div");
  pop.className = "kits-pop";
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", "Kits");
  pop.hidden = true;
  wrap.append(pop, button);
  overlay.append(wrap);

  let reg = null;
  let kits = [];
  let renderedKey = "";
  let closeOffs = [];

  Promise.resolve(api.registry("scene:kit"))
    .then((r) => {
      if (api.signal.aborted) return;
      reg = r ?? null;
      kits = listOf(reg);
      try {
        const off = reg?.on?.("changed", () => {
          kits = listOf(reg);
          render();
        });
        if (typeof off === "function") api.signal.addEventListener("abort", off, { once: true });
      } catch {
        // what's installed now is what's listed
      }
      render();
    })
    .catch(() => {});

  const isOpen = () => !pop.hidden;

  function setOpen(v) {
    if (v === isOpen()) return;
    pop.hidden = !v;
    button.setAttribute("aria-expanded", String(v));
    for (const off of closeOffs) off();
    closeOffs = [];
    if (!v) return;
    renderedKey = "";
    render();
    closeOffs = [
      api.listen(
        document,
        "pointerdown",
        (e) => {
          if (!wrap.contains(e.target)) setOpen(false);
        },
        true,
      ),
      api.listen(wrap, "keydown", (e) => {
        e.stopPropagation(); // the list's keys are its own, never scene shortcuts
        if (e.key === "Escape") {
          e.preventDefault();
          setOpen(false);
          button.focus({ preventScroll: true });
        }
      }),
    ];
    pop.querySelector("input")?.focus({ preventScroll: true });
  }
  button.addEventListener("click", () => setOpen(!isOpen()));

  function render() {
    if (!isOpen()) return;
    const doc = api.doc();
    const mine = api.local.get().kits;
    const chosen = chosenKits(mine, doc);
    const suggested = suggestedKits(doc);
    const same = chosen.length === suggested.length && chosen.every((k, i) => k === suggested[i]);
    const key = JSON.stringify([kits.map((k) => [k.id, k.name]), chosen, suggested]);
    if (key === renderedKey) return;
    renderedKey = key;
    const head = document.createElement("div");
    head.className = "kits-title";
    head.textContent = "Kits";
    const list = document.createElement("ul");
    list.className = "kits-list";
    for (const k of kits) {
      const li = document.createElement("li");
      const label = document.createElement("label");
      label.className = "toggle";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.dataset.kit = k.id;
      box.checked = chosen.includes(k.id);
      box.addEventListener("change", () => {
        const next = toggleKit(api.local.get().kits, api.doc(), k.id, box.checked);
        api.local.swap((m) => ({ ...m, kits: next }));
      });
      const name = document.createElement("span");
      name.textContent = String(k.name ?? k.id);
      label.append(box, name);
      if (suggested.includes(k.id)) {
        const tag = document.createElement("span");
        tag.className = "tag";
        tag.textContent = "suggested";
        tag.title = "This scene suggests it to everyone";
        label.append(tag);
      }
      li.append(label);
      list.append(li);
    }
    if (!kits.length) {
      const li = document.createElement("li");
      li.className = "kits-empty";
      li.textContent = "No kits are installed.";
      list.append(li);
    }
    const suggest = document.createElement("button");
    suggest.type = "button";
    suggest.className = "button link kits-suggest";
    suggest.textContent = "Suggest for everyone";
    suggest.title = "Make your kits what this scene suggests to everyone who opens it";
    suggest.disabled = same;
    suggest.addEventListener("click", () => {
      const list = chosenKits(api.local.get().kits, api.doc());
      api.change((d) => {
        if (!d.view) d.view = {};
        d.view.kits = [...list];
      });
      api.local.swap((m) => ({
        ...m,
        kits: Object.freeze({ on: Object.freeze([]), off: Object.freeze([]) }),
      }));
    });
    // Rebuilding drops whatever had focus in here (the box just ticked), and
    // focus that leaves the stage's DOM for nowhere goes back to its root:
    // Escape would no longer close this, nor Space tick the box again. Keep it
    // on the same control.
    const had = pop.contains(document.activeElement) ? document.activeElement : null;
    const kit = had?.dataset?.kit;
    const wasSuggest = had?.classList?.contains("kits-suggest");
    pop.replaceChildren(head, list, suggest);
    const again = kit != null ? [...list.querySelectorAll("input[data-kit]")].find((b) => b.dataset.kit === kit) : wasSuggest && !suggest.disabled ? suggest : had ? pop.querySelector("input") : null;
    again?.focus({ preventScroll: true });
  }

  return {
    update(scene, local, prev) {
      if (!isOpen()) return;
      if (prev?.scene?.d?.view?.kits !== scene.d?.view?.kits || prev?.local?.kits !== local.kits) render();
    },
    dispose() {
      for (const off of closeOffs) off();
      closeOffs = [];
    },
  };
}

export default { create };
