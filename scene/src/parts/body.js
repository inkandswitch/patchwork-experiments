// scene.body: the body chip, who's here, and the Esc hint (TOOLS.md §4, §6).
//
// - The chip ("Look ▾", "Edit ▾", "Walk ▾") names the body on top of the
//   stack. Its menu offers the stage's Look and Edit (the orbit camera,
//   ../stage/bodies.js: choosing one leaves every body over it), then any
//   body a running extension offers that can start "here" (a body that
//   needs a place, a seat or a station, says `here: false` and is entered by
//   that thing's verb instead), and Leave pops the top body (never Look or
//   Edit): standing up returns to walking, and from walking or a seat to
//   Look.
// - Who's here: each person present, with their body and held tool, from
//   presence (this part publishes this view's as `body` and `held`).
// - The Esc hint names the layer the next Escape pops (stage/ladder.js),
//   and after the browser has released the pointer, that a click takes it
//   back.
// It writes nothing to the doc.

import css from "./body.css?inline";
import { LOOK, STAGE_BODIES } from "../stage/bodies.js";

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

/**
 * Who's here, from presence: [{ session, viewer, body, held, you }], this
 * view first, the others in session order; a person with no body published
 * yet is in Look. Pure.
 * @param {object} presence  api.presence.get()
 * @param {string} ext  this part's id (where body and held are published)
 * @param {string | null} self  this view's session
 * @param {{ body?: { id, label }, held?: { name } | null }} mine  this view's local
 */
export function whoIsHere(presence, ext, self, mine) {
  const out = [{ session: self, viewer: null, body: mine?.body?.label ?? LOOK.label, held: mine?.held?.name ?? null, you: true }];
  for (const [session, p] of Object.entries(presence ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (session === self) continue;
    const k = p?.keys?.[ext] ?? {};
    out.push({ session, viewer: p?.viewer ?? null, body: typeof k.body?.label === "string" ? k.body.label : LOOK.label, held: typeof k.held?.name === "string" ? k.held.name : null, you: false });
  }
  return out;
}

/** The bodies the chip offers: the stage's Look and Edit, then those that can start "here", by label. Pure. */
export function chipBodies(collected) {
  const out = STAGE_BODIES.map((b) => ({ id: b.id, label: b.label }));
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
  const hint = el("div", "body-escape");
  hint.setAttribute("aria-live", "polite");
  bar.append(people, chip);
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
    const local = api.local.get();
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
          if (!api.body.enter(b.id, null)) api.notify(`Couldn't ${b.label.toLowerCase()} here.`);
        }, { checked: on }),
      );
    }
    if ((local.body?.depth ?? 0) > 0) box.append(item(`Leave (${local.body.label})`, () => api.body.leave()));
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

  let shown = "";
  function render() {
    const local = api.local.get();
    const list = whoIsHere(api.presence.get(), api.id, api.session ?? null, local);
    const esc = local.pointer?.released ? "Click the view to take the pointer back" : local.escape?.hint ? `Esc: ${local.escape.hint}` : "";
    const key = JSON.stringify([list.map((p) => [p.session, p.you ? "You" : nameOf(p.viewer), p.body, p.held]), local.body?.label, local.body?.depth, esc]);
    if (key === shown) return;
    shown = key;
    people.replaceChildren(
      ...list.map((p) => {
        const row = el("span", "body-person");
        row.dataset.session = p.session ?? "";
        if (p.you) row.dataset.you = "";
        row.textContent = [p.you ? "You" : nameOf(p.viewer), p.body.toLowerCase(), p.held].filter(Boolean).join(" · ");
        return row;
      }),
    );
    chip.textContent = `${local.body?.label ?? LOOK.label} ▾`;
    chip.title = (local.body?.depth ?? 0) > 0 ? "Your body: change it, or leave it" : "Your body: change it";
    hint.textContent = esc;
    hint.hidden = !esc;
  }

  // publish this view's body and held tool, for everyone's "who's here"
  let published = "";
  function publish() {
    const local = api.local.get();
    const body = { id: local.body?.id ?? LOOK.id, label: local.body?.label ?? LOOK.label };
    const held = local.held ? { name: local.held.name } : undefined;
    const key = JSON.stringify([body, held ?? null]);
    if (key === published) return;
    published = key;
    api.presence.set("body", body);
    api.presence.set("held", held);
  }

  api.presence.watch(() => api.schedule(render));

  return {
    update() {
      publish();
      render();
    },
    dispose() {
      closeMenu();
    },
  };
}

export default { create };
