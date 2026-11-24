// scene.body: the body chip, the Edit toggle, who's here, and the Esc hint
// (STAGE.md, "Bodies", "Hands").
//
// - The chip ("Look ▾", "Walk ▾") names the body on top of the stack. Its
//   menu offers the stage's Look (the orbit camera, ../stage/bodies.js:
//   choosing it leaves every body), then any body a running extension offers
//   that can start "here" (a body that needs a place, a seat or a station,
//   says `here: false` and is entered by that thing's verb instead), and
//   Leave pops the top body (never Look): standing up returns to walking,
//   and from walking or a seat to Look.
// - Edit, beside the chip, picks up the editor's hand or puts it down: a
//   surface of scene.edit's `edit` command, pressed as its state is checked.
//   It is not a body: you can walk or sit holding it.
// - Who's here: each person present in the focus doc, with their body and
//   what they hold (every hand, top last: "Edit, Measure, X-ray"), from presence (the view
//   says every viewer's on every channel it acts on: a person at another
//   placement of this doc shows as what they're doing there).
// - The Esc hint names the layer the next Escape pops (stage/ladder.js),
//   and after the browser has released the pointer, that a click takes it
//   back. With no keyboard (the input is touch) it is the Escape key: it
//   says what it does ("Put it back") and a finger on it presses Escape
//   (../hold-key.js), so a shown rung is one a finger can pop.
// It writes nothing to the doc.

import css from "./body.css?inline";
import { LOOK, commandState, flatCommands } from "../stage/public.js";
import { EDIT_HAND } from "./editing.js";
import { holdKey } from "../hold-key.js";
import { focusReader, perFocus } from "../per-focus.js";

/** The command the Edit button is a surface of. */
const EDIT_COMMAND = Object.freeze({ ext: "scene.edit", command: "edit" });

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

/** What a view holds, as peers are told it: its hands' names, top last (an open menu is passed over). Pure. */
export const heldNames = (view) => (Array.isArray(view?.hands) ? view.hands.filter((h) => h?.kind !== "popover" && typeof h?.name === "string").map((h) => h.name) : []);

/**
 * Who's here, from presence: [{ session, viewer, body, held, you }], this
 * view first, the others in session order; `held` every hand's name, top
 * last; a person whose view hasn't said its body yet is in Look. Pure.
 * @param {object} presence  api.channel.peers() (each peer's `body` and `held`, as its view says them)
 * @param {string | null} self  this view's session
 * @param {{ body?: { id, label }, hands?: { kind, name }[] }} mine  this view's
 */
export function whoIsHere(presence, self, mine) {
  const out = [{ session: self, viewer: null, body: mine?.body?.label ?? LOOK.label, held: heldNames(mine), you: true }];
  for (const [session, p] of Object.entries(presence ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (session === self) continue;
    out.push({ session, viewer: p?.viewer ?? null, body: typeof p?.body?.label === "string" ? p.body.label : LOOK.label, held: Array.isArray(p?.held) ? p.held.filter((h) => typeof h?.name === "string").map((h) => h.name) : [], you: false });
  }
  return out;
}

/** The bodies the chip offers: the stage's Look, then those that can start "here", by label. Pure. */
export function chipBodies(collected) {
  const out = [{ id: LOOK.id, label: LOOK.label }];
  const seen = new Set(out.map((b) => b.id));
  for (const { value } of collected ?? []) {
    for (const def of Array.isArray(value) ? value : []) {
      if (!def || typeof def.id !== "string" || seen.has(def.id) || def.here === false) continue;
      seen.add(def.id);
      out.push({ id: def.id, label: String(def.label ?? def.id) });
    }
  }
  return out;
}

function create(api) {
  api.style(css);
  const overlay = api.overlay();
  overlay.classList.add("body-layer");
  const bar = el("div", "body-bar");
  const people = el("div", "body-people");
  people.setAttribute("aria-label", "Who's here");
  const chip = el("button", "button body-chip");
  chip.type = "button";
  chip.setAttribute("aria-haspopup", "menu");
  const edit = el("button", "button body-edit", EDIT_HAND);
  edit.type = "button";
  edit.title = "Pick up the editor: select, move and change things";
  edit.addEventListener("click", () => {
    api.run({ ...EDIT_COMMAND, target: null });
    api.root.focus?.({ preventScroll: true });
  });
  const hint = el("div", "body-escape");
  hint.setAttribute("aria-live", "polite");
  // a key only while it shows as one (data-key: the only time it takes a pointer)
  const escKey = holdKey(hint, api.root, "Escape");
  bar.append(people, edit, chip);
  overlay.append(hint, bar);

  const names = new Map(); // viewer → name (contact docs, looked up once)
  function nameOf(viewer) {
    if (!viewer) return "Someone";
    if (names.has(viewer)) return names.get(viewer) ?? "Someone";
    names.set(viewer, null);
    if (String(viewer).startsWith("automerge:")) {
      Promise.resolve(api.repo?.find?.(viewer))
        .then((h) => {
          const n = h?.doc?.()?.name;
          if (n) names.set(viewer, String(n));
          render();
        })
        .catch(() => {});
    }
    return "Someone";
  }

  let menu = null; // { el, release }
  function closeMenu() {
    if (!menu) return;
    const m = menu;
    menu = null;
    m.el.remove();
    m.release?.();
    m.off?.();
  }
  function openMenu() {
    closeMenu();
    const box = el("div", "body-menu");
    box.setAttribute("role", "menu");
    const local = api.view.get();
    const item = (label, fn, { checked = null } = {}) => {
      const b = el("button", "menu-item", label);
      b.type = "button";
      b.setAttribute("role", checked == null ? "menuitem" : "menuitemradio");
      if (checked != null) b.setAttribute("aria-checked", String(checked));
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        closeMenu();
        fn();
        api.root.focus?.({ preventScroll: true });
      });
      return b;
    };
    for (const b of chipBodies(api.collect("bodies"))) {
      const on = local.body?.id === b.id;
      box.append(
        item(b.label, () => {
          if (on) return;
          if (!api.focus()?.body.enter(b.id, null)) api.use("notices")?.notify(`Couldn't ${b.label.toLowerCase()} here.`);
        }, { checked: on }),
      );
    }
    if ((local.body?.depth ?? 0) > 0) box.append(item(`Leave (${local.body.label})`, () => api.focus()?.body.leave()));
    if (!box.childElementCount) return;
    bar.append(box);
    const onOutside = (e) => {
      if (menu && !box.contains(e.target) && e.target !== chip) closeMenu();
    };
    document.addEventListener("pointerdown", onOutside, true);
    menu = { el: box, release: api.popover(() => closeMenu()), off: () => document.removeEventListener("pointerdown", onOutside, true) };
    box.querySelector("button")?.focus?.({ preventScroll: true });
  }
  chip.addEventListener("click", () => (menu ? closeMenu() : openMenu()));

  // who's here is the focus doc's presence: heard again wherever the focus goes
  const presence = perFocus(api, (f) => {
    f.channel.watch(() => f.schedule(render));
    return f.channel;
  });
  /** The Edit command's state, as the focus's context gives it, or null where it doesn't run. */
  function editState() {
    const r = focusReader(api);
    const e = r && flatCommands(r.collect("commands")).find((c) => c.ext === EDIT_COMMAND.ext && c.command.id === EDIT_COMMAND.command);
    return e ? commandState(e.command, null, r.context(null)) : null;
  }
  let shown = "";
  function render() {
    const local = api.view.get();
    const list = whoIsHere(presence()?.peers() ?? {}, presence()?.session ?? null, local);
    const touch = !!local.pointer?.touch;
    const rung = local.escape?.hint ?? "";
    const esc = local.pointer?.released ? "Click the view to take the pointer back" : !rung ? "" : touch ? rung[0].toUpperCase() + rung.slice(1) : `Esc: ${rung}`;
    const isKey = touch && !local.pointer?.released && !!rung;
    const on = !!editState()?.checked;
    const key = JSON.stringify([list.map((p) => [p.session, p.you ? "You" : nameOf(p.viewer), p.body, p.held]), local.body?.label, local.body?.depth, on, esc, isKey]);
    if (key === shown) return;
    shown = key;
    people.replaceChildren(
      ...list.map((p) => {
        const row = el("span", "body-person");
        row.dataset.session = p.session ?? "";
        if (p.you) row.dataset.you = "";
        row.textContent = [p.you ? "You" : nameOf(p.viewer), p.body.toLowerCase(), p.held.join(", ")].filter(Boolean).join(" · ");
        return row;
      }),
    );
    chip.textContent = `${local.body?.label ?? LOOK.label} ▾`;
    chip.title = (local.body?.depth ?? 0) > 0 ? "Your body: change it, or leave it" : "Your body: change it";
    edit.setAttribute("aria-pressed", String(on));
    edit.title = on ? "Put the editor down" : "Pick up the editor: select, move and change things";
    hint.textContent = esc;
    hint.hidden = !esc;
    if (isKey) {
      hint.dataset.key = "Escape";
      hint.setAttribute("role", "button");
    } else {
      if ("key" in hint.dataset) escKey.letGo();
      delete hint.dataset.key;
      hint.removeAttribute("role");
    }
  }

  return {
    update() {
      render();
    },
    dispose() {
      closeMenu();
      escKey.letGo();
    },
  };
}

export default { create };
